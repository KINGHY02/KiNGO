import { get as httpsGet } from 'https'
import { get as httpGetRaw } from 'http'
import { parseNodeUrl, StoredNode } from './protocol-parser'
import * as yaml from 'js-yaml'
import {
  listSubscriptions, addSubscription, getSubscription,
  updateSubscription, deleteSubscription, StoredSubscription,
} from './nodes-store'

function generateId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function httpGet(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('too many redirects'))
      return
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('invalid subscription URL'))
      return
    }

    const get = parsed.protocol === 'http:' ? httpGetRaw : httpsGet
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`unsupported protocol: ${parsed.protocol}`))
      return
    }

    const req = get(url, {
      headers: { 'User-Agent': 'KiNGO/1.0' },
      timeout: 30000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString()
        httpGet(redirected, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode || 0}`))
        return
      }
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function isBase64(s: string): boolean {
  const cleaned = s.replace(/\s/g, '')
  return cleaned.length > 0 && cleaned.length % 4 !== 1 && /^[A-Za-z0-9+/_-]+=*$/.test(cleaned)
}

function isClashYaml(s: string): boolean {
  return /\bproxies:/m.test(s)
}

export interface SubDiff { added: number; removed: number; unchanged: number }

export async function updateSubscriptionNodes(id: string): Promise<SubDiff | null> {
  const sub = getSubscription(id)
  if (!sub) return null

  const body = await httpGet(sub.url.trim())
  const newNodes: StoredNode[] = []
  let rawConfig: string | null = null

  if (isClashYaml(body)) {
    // Clash YAML — keep raw for clash-meta direct use
    rawConfig = body
    try {
      const parsed = yaml.load(body) as { proxies?: Array<Record<string, unknown>> } | undefined
      if (parsed?.proxies) {
        for (const p of parsed.proxies) {
          const node = clashProxyToNode(p as Record<string, unknown>)
          if (node) newNodes.push(node)
        }
      }
    } catch { /* keep going */ }
  }

  if (newNodes.length === 0) {
    let decoded = body
    if (isBase64(body.trim())) {
      decoded = Buffer.from(normalizeBase64(body.trim()), 'base64').toString('utf-8')
    }
    const lines = decoded.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    for (const line of lines) {
      if (line.startsWith('http://') || line.startsWith('https://')) continue
      const node = parseNodeUrl(line)
      if (node) newNodes.push(node)
    }
  }

  if (newNodes.length === 0) {
    throw new Error('no valid nodes found in subscription')
  }

  // Diff
  const nodeKey = (n: StoredNode): string => `${n.protocol}:${n.host}:${n.port}`
  const newNameSet = new Set(newNodes.map(nodeKey))
  const oldNameSet = new Set(sub.nodes.map(nodeKey))
  const oldNodeByKey = new Map(sub.nodes.map((n) => [nodeKey(n), n]))
  const added = newNodes.filter((n) => !oldNameSet.has(nodeKey(n))).length
  const removed = sub.nodes.filter((n) => !newNameSet.has(nodeKey(n))).length
  const unchanged = newNodes.length - added
  const mergedNodes = newNodes.map((node) => {
    const oldNode = oldNodeByKey.get(nodeKey(node))
    return oldNode
      ? { ...node, id: oldNode.id, latency: oldNode.latency, lastTested: oldNode.lastTested }
      : node
  })

  updateSubscription(id, {
    nodes: mergedNodes,
    rawConfig,
    lastUpdated: Date.now(),
  })

  return { added, removed, unchanged }
}

function normalizeBase64(s: string): string {
  const cleaned = s.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = cleaned.length % 4
  return padding === 0 ? cleaned : cleaned + '='.repeat(4 - padding)
}

function clashProxyToNode(p: Record<string, unknown>): StoredNode | null {
  const type = (p.type as string || '').toLowerCase()
  const server = p.server as string || ''
  const port = Number(p.port) || 443
  const name = p.name as string || `${server}:${port}`

  if (!type || !server) return null

  const protoMap: Record<string, string> = {
    vmess: 'vmess', vless: 'vless', trojan: 'trojan', ss: 'ss', ssr: 'ssr',
    hysteria: 'hysteria', hysteria2: 'hysteria2', tuic: 'tuic',
    http: 'naive', socks5: 'socks5',
    shadowsocks: 'ss', shadowsocksr: 'ssr',
  }
  let protocol = protoMap[type] || type
  if (protocol === 'ss' && String(p.cipher || '').toLowerCase().includes('2022')) {
    protocol = 'ss2022'
  }

  const details: Record<string, unknown> = {}
  const wsOpts = p['ws-opts'] as Record<string, unknown> | undefined
  const wsHeaders = wsOpts?.headers as Record<string, unknown> | undefined
  const grpcOpts = p['grpc-opts'] as Record<string, unknown> | undefined
  const xhttpOpts = p['xhttp-opts'] as Record<string, unknown> | undefined
  const realityOpts = p['reality-opts'] as Record<string, unknown> | undefined
  switch (protocol) {
    case 'hysteria':
      details.auth = p['auth-str'] || p.auth || ''
      details.sni = p.sni || server
      details.insecure = p['skip-cert-verify'] ? 1 : 0
      details.alpn = Array.isArray(p.alpn) ? (p.alpn as string[])[0] || 'h3' : (p.alpn as string || 'h3')
      details.upmbps = String(p.up || '50').replace(/[^0-9.]/g, '')
      details.downmbps = String(p.down || '200').replace(/[^0-9.]/g, '')
      break
    case 'hysteria2':
      details.auth = p['auth-str'] || p.password || p.auth || ''
      details.sni = p.sni || server
      details.insecure = p['skip-cert-verify'] ? 1 : 0
      details['obfs-password'] = p['obfs-password'] || ''
      break
    case 'tuic':
      details.uuid = p.uuid || ''
      details.password = p.password || ''
      details.sni = p.sni || server
      details.congestionControl = p['congestion-controller'] || p['congestion_control'] || 'cubic'
      details.alpn = Array.isArray(p.alpn) ? (p.alpn as string[])[0] || 'h3' : (p.alpn as string || 'h3')
      details.allowInsecure = p['skip-cert-verify'] ? 1 : 0
      break
    case 'vmess':
      details.uuid = p.uuid || ''
      details.alterId = p.alterId ?? 0
      details.security = p.cipher || 'auto'
      details.network = p.network || 'tcp'
      details.path = wsOpts?.path || p['ws-path'] || p.path || '/'
      details.hostHeader = wsHeaders?.Host || ((p['ws-headers'] as Record<string, unknown>)?.Host as string) || ''
      details.tls = p.tls ? 'tls' : ''
      details.sni = p['servername'] || p.sni || ''
      details.fingerprint = p['client-fingerprint'] || p.fingerprint || ''
      details.serviceName = grpcOpts?.['grpc-service-name'] || ''
      break
    case 'vless':
      details.uuid = p.uuid || ''
      details.flow = p.flow || ''
      details.security = p['reality-opts'] ? 'reality' : (p.tls ? 'tls' : '')
      details.sni = p['servername'] || p.sni || server
      details.fingerprint = p['client-fingerprint'] || p.fingerprint || ''
      details.network = p.network || 'tcp'
      details.path = xhttpOpts?.path || wsOpts?.path || p['ws-path'] || p.path || '/'
      details.hostHeader = xhttpOpts?.host || wsHeaders?.Host || ''
      details.pbk = realityOpts?.['public-key'] || ''
      details.sid = realityOpts?.['short-id'] || ''
      details.serviceName = grpcOpts?.['grpc-service-name'] || ''
      break
    case 'trojan':
      details.password = p.password || ''
      details.sni = p.sni || server
      details.network = p.network || 'tcp'
      details.path = wsOpts?.path || p.path || '/'
      details.hostHeader = wsHeaders?.Host || ''
      break
    case 'ss':
    case 'ss2022':
      details.method = p.cipher || 'aes-256-gcm'
      details.password = p.password || ''
      break
    default:
      Object.assign(details, p)
      break
  }

  return {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name, protocol, host: server, port,
    rawUrl: `${type}://${server}:${port}#${encodeURIComponent(name)}`,
    details, latency: null, lastTested: null, createdAt: Date.now(),
  }
}

export function createSubscription(name: string, url: string): StoredSubscription {
  const sub: StoredSubscription = {
    id: generateId(), name: name.trim(), url: url.trim(),
    nodes: [], rawConfig: null,
    lastUpdated: null, autoUpdate: false, updateInterval: 12,
  }
  addSubscription(sub)
  return sub
}

export function getSubscriptionRawConfig(id: string): string | null {
  return getSubscription(id)?.rawConfig || null
}

export { listSubscriptions, getSubscription, updateSubscription, deleteSubscription }
export type { StoredSubscription }
