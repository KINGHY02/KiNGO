import * as http from 'http'
import * as net from 'net'
import type { ProxyManager, ProxyStatus } from './proxy-manager'

export interface ExitIpInfo {
  available: boolean
  ip: string | null
  country: string | null
  countryCode: string | null
  region: string | null
  city: string | null
  isp: string | null
  source: string | null
  checkedAt: number
  error?: string
}

const IP_API_HOST = 'ip-api.com'
const IP_API_PATH = '/json/?fields=status,message,country,countryCode,regionName,city,isp,query'

export async function getExitIpInfo(proxyManager: ProxyManager): Promise<ExitIpInfo> {
  const status = pickActiveProxy(proxyManager.getStatus())
  if (!status) return unavailable('当前没有正在运行的代理核心')

  try {
    const text = status.protocol === 'http'
      ? await requestViaHttpProxy(status.port)
      : await requestViaSocks5Proxy(status.port)
    const data = JSON.parse(text) as {
      status?: string
      message?: string
      country?: string
      countryCode?: string
      regionName?: string
      city?: string
      isp?: string
      query?: string
    }
    if (data.status && data.status !== 'success') {
      return unavailable(data.message || '出口 IP 查询失败')
    }
    return {
      available: true,
      ip: data.query || null,
      country: data.country || null,
      countryCode: data.countryCode || null,
      region: data.regionName || null,
      city: data.city || null,
      isp: data.isp || null,
      source: `${status.id}:${status.port}`,
      checkedAt: Date.now(),
    }
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error), `${status.id}:${status.port}`)
  }
}

function pickActiveProxy(statuses: ProxyStatus[]): ProxyStatus | null {
  const running = statuses.filter((status) => status.running)
  return running.find((status) => status.id === 'clash-meta')
    || running[0]
    || null
}

function unavailable(error: string, source: string | null = null): ExitIpInfo {
  return {
    available: false,
    ip: null,
    country: null,
    countryCode: null,
    region: null,
    city: null,
    isp: null,
    source,
    checkedAt: Date.now(),
    error,
  }
}

function requestViaHttpProxy(proxyPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: `http://${IP_API_HOST}${IP_API_PATH}`,
      timeout: 7000,
      headers: {
        Host: IP_API_HOST,
        Accept: 'application/json',
        'User-Agent': 'KiNGO/1.0',
      },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) reject(new Error(`IP 查询接口返回 HTTP ${res.statusCode}`))
        else resolve(body)
      })
    })
    req.on('timeout', () => req.destroy(new Error('出口 IP 查询超时')))
    req.on('error', reject)
    req.end()
  })
}

function requestViaSocks5Proxy(proxyPort: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: proxyPort })
    let stage: 'greeting' | 'connect' | 'response' = 'greeting'
    let response = Buffer.alloc(0)
    let finished = false

    const fail = (error: Error): void => {
      if (finished) return
      finished = true
      socket.destroy()
      reject(error)
    }

    const done = (text: string): void => {
      if (finished) return
      finished = true
      socket.end()
      resolve(text)
    }

    socket.setTimeout(8000, () => fail(new Error('出口 IP 查询超时')))
    socket.on('error', fail)
    socket.on('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })
    socket.on('data', (chunk) => {
      if (stage === 'greeting') {
        if (chunk.length < 2) return
        if (chunk[0] !== 0x05 || chunk[1] !== 0x00) {
          fail(new Error('SOCKS5 代理握手失败'))
          return
        }
        stage = 'connect'
        socket.write(buildSocks5ConnectRequest(IP_API_HOST, 80))
        return
      }

      if (stage === 'connect') {
        if (chunk.length < 2) return
        if (chunk[1] !== 0x00) {
          fail(new Error(`SOCKS5 连接出口查询接口失败：${chunk[1]}`))
          return
        }
        stage = 'response'
        socket.write([
          `GET ${IP_API_PATH} HTTP/1.1`,
          `Host: ${IP_API_HOST}`,
          'Accept: application/json',
          'User-Agent: KiNGO/1.0',
          'Connection: close',
          '',
          '',
        ].join('\r\n'))
        return
      }

      response = Buffer.concat([response, chunk])
    })
    socket.on('end', () => {
      if (finished || stage !== 'response') return
      const raw = response.toString('utf8')
      const separator = raw.indexOf('\r\n\r\n')
      if (separator < 0) {
        fail(new Error('出口 IP 查询响应格式无效'))
        return
      }
      const header = raw.slice(0, separator)
      if (!/^HTTP\/1\.\d 2\d\d/.test(header)) {
        fail(new Error(header.split('\r\n')[0] || '出口 IP 查询失败'))
        return
      }
      done(raw.slice(separator + 4))
    })
  })
}

function buildSocks5ConnectRequest(host: string, port: number): Buffer {
  const hostBuffer = Buffer.from(host)
  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
    hostBuffer,
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
  ])
}
