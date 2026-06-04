import * as net from 'net'
import * as http from 'http'

interface LatencyResult {
  host: string
  port: number
  latency: number  // -1 = unreachable
}

const cache = new Map<string, { result: number; time: number }>()
const CACHE_TTL = 60_000 // 60 seconds

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

// Test real proxy latency by sending an HTTP request through the local proxy port.
// This measures the full round-trip through the proxy tunnel (including QUIC/TLS handshake).
const LATENCY_TARGET = 'http://www.gstatic.com/generate_204'

export function testRealLatency(proxyPort: number, timeout = 5000): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now()

    const options: http.RequestOptions = {
      host: '127.0.0.1',
      port: proxyPort,
      path: LATENCY_TARGET,
      method: 'HEAD',
      timeout,
      headers: { 'User-Agent': 'KiNGO/1.0' }
    }

    const req = http.request(options, (res) => {
      res.resume()
      res.on('end', () => {
        const latency = Math.round(performance.now() - start)
        resolve(latency)
      })
      res.on('error', () => resolve(-1))
    })

    req.on('error', () => resolve(-1))
    req.on('timeout', () => {
      req.destroy()
      resolve(-1)
    })

    req.end()
  })
}
