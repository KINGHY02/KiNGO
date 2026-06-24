// RealpingService — v2rayN Realping equivalent
// Starts proxy core per-batch → HTTP request through SOCKS5 → stops proxy
// Uses native TCPing as primary method (like v2rayN TcpingServer)
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { generateConfig } from './config-generator'
import { findNodeById, getActiveConnection } from './nodes-store'
import { setDelay } from './profile-ex-store'
import { testProxyNodes, testRealLatency } from './latency-tester'
import { BrowserWindow } from 'electron'

interface TestProgress {
  nodeId: string
  latency: number
  speed: number
  ipInfo: string
}

/**
 * Real ping through proxy (v2rayN RealpingServer)
 * Starts core, sends HTTP request through SOCKS5, measures response time
 * Returns latency in ms, -1 if unreachable
 */
export async function testNodeViaProxy(
  proxyManager: ProxyManager,
  nodeId: string,
  onProgress?: (p: TestProgress) => void
): Promise<TestProgress> {
  const found = findNodeById(nodeId)
  if (!found) return { nodeId, latency: -1, speed: 0, ipInfo: '' }

  const { node } = found
  // Use the currently-running core if available, else xray default
  const conn = getActiveConnection()
  const coreId = conn?.coreId || 'xray'
  const config = generateConfig(node, coreId)

  let latency = -1
  const result = await proxyManager.startWithConfig(coreId, config.content)
  if (result.success) {
    try {
      // Wait a moment for proxy to settle, then test through it
      await new Promise((r) => setTimeout(r, 800))
      const realLat = await testRealLatency(0) // uses SOCKS port 1080 or clash 7890
      if (realLat >= 0) {
        latency = realLat
        setDelay(nodeId, latency)
      }
    } catch { /* timeout / error */ latency = -1 }
    finally {
      await proxyManager.stop(coreId)
    }
  }

  const progress: TestProgress = { nodeId, latency, speed: 0, ipInfo: '' }
  onProgress?.(progress)
  return progress
}

/**
 * TCP ping (v2rayN TcpingServer) for multiple nodes — reports progress per-node
 */
export async function tcpingNodes(
  nodeIds: string[],
  onProgress?: (p: TestProgress) => void
): Promise<TestProgress[]> {
  const results: TestProgress[] = []
  for (const id of nodeIds) {
    const found = findNodeById(id)
    if (!found) { results.push({ nodeId: id, latency: -1, speed: 0, ipInfo: '' }); continue }
    try {
      const res = await testProxyNodes([{ host: found.node.host, port: found.node.port }], false)
      const latency = res[0]?.latency ?? -1
      setDelay(id, latency)
      const p: TestProgress = { nodeId: id, latency, speed: 0, ipInfo: '' }
      results.push(p)
      onProgress?.(p)
    } catch {
      setDelay(id, -1)
      const p: TestProgress = { nodeId: id, latency: -1, speed: 0, ipInfo: '' }
      results.push(p)
      onProgress?.(p)
    }
  }
  return results
}
