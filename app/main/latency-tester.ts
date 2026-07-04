import * as net from 'net'
import * as http from 'http'

interface LatencyResult {
  host: string
  port: number
  latency: number // -1 = unreachable
}

export type LocalProxyProtocol = 'http' | 'socks5'

export interface RealLatencyResult {
  latency: number
  success: boolean
  protocol: LocalProxyProtocol
  target: string
  error?: string
  samples?: number[]
}

const cache = new Map<string, { result: number; time: number }>()
const CACHE_TTL = 60_000
const LATENCY_TARGET_URL = 'http://cp.cloudflare.com/generate_204'
const LATENCY_TARGET_HOST = 'cp.cloudflare.com'
const LATENCY_TARGET_PORT = 80
const REAL_LATENCY_ATTEMPTS = 2

export function testLatency(host: string, port: number, timeout = 3000, forceRefresh = false): Promise<number> {
  const cacheKey = `${host}:${port}`
  if (!forceRefresh) {
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return Promise.resolve(cached.result)
    }
  }

  return new Promise((resolve) => {
    const start = performance.now()
    const socket = net.createConnection({ host, port, timeout })

    socket.on('connect', () => {
      const latency = Math.round(performance.now() - start)
      socket.destroy()
      cache.set(cacheKey, { result: latency, time: Date.now() })
      resolve(latency)
    })

    socket.on('error', () => {
      cache.set(cacheKey, { result: -1, time: Date.now() })
      resolve(-1)
    })

    socket.on('timeout', () => {
      socket.destroy()
      cache.set(cacheKey, { result: -1, time: Date.now() })
      resolve(-1)
    })
  })
}

export async function testProxyNodes(
  servers: { host: string; port: number }[],
  forceRefresh = false
): Promise<LatencyResult[]> {
  const valid = servers.filter((s) => s.port > 0)
  const results = await Promise.all(
    valid.map(async (s) => ({
      host: s.host,
      port: s.port,
      latency: await testLatency(s.host, s.port, 3000, forceRefresh)
    }))
  )
  return results
}

export async function testRealLatency(
  proxyPort: number,
  protocol: LocalProxyProtocol = 'socks5',
  timeout = 5000
): Promise<number> {
  const result = await testRealLatencyDetailed(proxyPort, protocol, timeout)
  return result.latency
}

export async function testRealLatencyDetailed(
  proxyPort: number,
  protocol: LocalProxyProtocol = 'socks5',
  timeout = 5000
): Promise<RealLatencyResult> {
  const results: RealLatencyResult[] = []
  for (let i = 0; i < REAL_LATENCY_ATTEMPTS; i += 1) {
    const result = protocol === 'http'
      ? await testHttpProxyLatencyOnce(proxyPort, timeout)
      : await testSocks5ProxyLatencyOnce(proxyPort, timeout)
    results.push(result)
    if (i < REAL_LATENCY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const successful = results.filter((item) => item.success && item.latency >= 0)
  if (successful.length > 0) {
    const best = successful.sort((a, b) => a.latency - b.latency)[0]
    return {
      ...best,
      samples: successful.map((item) => item.latency)
    }
  }

  return {
    ...results[results.length - 1],
    samples: results.map((item) => item.latency).filter((latency) => latency >= 0)
  }
}

function testHttpProxyLatencyOnce(proxyPort: number, timeout: number): Promise<RealLatencyResult> {
  return new Promise((resolve) => {
    const start = performance.now()
    let settled = false
    const options: http.RequestOptions = {
      host: '127.0.0.1',
      port: proxyPort,
      path: LATENCY_TARGET_URL,
      method: 'HEAD',
      timeout,
      headers: { 'User-Agent': 'KiNGO/1.0' }
    }

    const finish = (success: boolean, error?: string): void => {
      if (settled) return
      settled = true
      resolve({
        latency: success ? Math.round(performance.now() - start) : -1,
        success,
        protocol: 'http',
        target: LATENCY_TARGET_URL,
        error
      })
    }

    const req = http.request(options, (res) => {
      res.resume()
      res.on('end', () => finish(res.statusCode !== undefined && res.statusCode < 500))
      res.on('error', () => finish(false, 'HTTP 代理响应读取失败'))
    })

    req.on('error', (err) => finish(false, err.message || 'HTTP 代理请求失败'))
    req.on('timeout', () => {
      req.destroy()
      finish(false, 'HTTP 代理测试超时')
    })

    req.end()
  })
}

function testSocks5ProxyLatencyOnce(proxyPort: number, timeout: number): Promise<RealLatencyResult> {
  return new Promise((resolve) => {
    const start = performance.now()
    const socket = net.createConnection({ host: '127.0.0.1', port: proxyPort })
    let settled = false
    let stage: 'greeting' | 'connect' | 'request' = 'greeting'
    let buffer = Buffer.alloc(0)

    const finish = (success: boolean, error?: string): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({
        latency: success ? Math.round(performance.now() - start) : -1,
        success,
        protocol: 'socks5',
        target: LATENCY_TARGET_URL,
        error
      })
    }

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      if (stage === 'greeting') {
        if (buffer.length < 2) return
        const [version, method] = buffer
        buffer = buffer.subarray(2)
        if (version !== 0x05 || method === 0xff) {
          finish(false, 'SOCKS5 握手失败')
          return
        }
        stage = 'connect'
        socket.write(buildSocks5ConnectRequest(LATENCY_TARGET_HOST, LATENCY_TARGET_PORT))
      }

      if (stage === 'connect') {
        if (buffer.length < 5) return
        if (buffer[0] !== 0x05 || buffer[1] !== 0x00) {
          finish(false, socks5ReplyMessage(buffer[1]))
          return
        }
        const consumed = socks5ReplyLength(buffer)
        if (consumed === 0 || buffer.length < consumed) return
        buffer = buffer.subarray(consumed)
        stage = 'request'
        socket.write([
          `HEAD /generate_204 HTTP/1.1`,
          `Host: ${LATENCY_TARGET_HOST}`,
          'User-Agent: KiNGO/1.0',
          'Connection: close',
          '',
          ''
        ].join('\r\n'))
      }

      if (stage === 'request') {
        const text = buffer.toString('utf8')
        if (!text.includes('\r\n')) return
        if (/^HTTP\/\d(?:\.\d)?\s+[234]\d\d/i.test(text)) finish(true)
        else finish(false, 'SOCKS5 已连接，但测试站点没有返回可用响应')
      }
    })

    socket.on('error', (err) => finish(false, err.message || 'SOCKS5 连接失败'))
    socket.on('timeout', () => finish(false, 'SOCKS5 代理测试超时'))
  })
}

function buildSocks5ConnectRequest(host: string, port: number): Buffer {
  const hostBuffer = Buffer.from(host, 'utf8')
  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
    hostBuffer,
    Buffer.from([(port >> 8) & 0xff, port & 0xff])
  ])
}

function socks5ReplyLength(buffer: Buffer): number {
  const atyp = buffer[3]
  if (atyp === 0x01) return 10
  if (atyp === 0x04) return 22
  if (atyp === 0x03) {
    if (buffer.length < 5) return 0
    return 5 + buffer[4] + 2
  }
  return 0
}

function socks5ReplyMessage(code: number): string {
  const messages: Record<number, string> = {
    0x01: 'SOCKS5 代理返回通用失败',
    0x02: 'SOCKS5 规则不允许连接',
    0x03: 'SOCKS5 网络不可达',
    0x04: 'SOCKS5 目标地址不可达',
    0x05: 'SOCKS5 目标连接被拒绝',
    0x06: 'SOCKS5 TTL 过期',
    0x07: 'SOCKS5 不支持该命令',
    0x08: 'SOCKS5 不支持该地址类型'
  }
  return messages[code] || `SOCKS5 连接失败（代码 ${code}）`
}
