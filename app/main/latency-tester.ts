import * as net from 'net'

interface LatencyResult {
  host: string
  port: number
  latency: number  // -1 = unreachable
}

const cache = new Map<string, { result: number; time: number }>()
const CACHE_TTL = 60_000 // 60 seconds

export function testLatency(host: string, port: number, timeout = 3000): Promise<number> {
  const cacheKey = `${host}:${port}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return Promise.resolve(cached.result)
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
  servers: { host: string; port: number }[]
): Promise<LatencyResult[]> {
  const results = await Promise.all(
    servers.map(async (s) => ({
      host: s.host,
      port: s.port,
      latency: await testLatency(s.host, s.port)
    }))
  )
  return results
}
