// Protocol URL parser — parses share URLs (vmess://, ss://, trojan://, etc.) into structured nodes.
// Pure JS, zero external dependencies.

export interface StoredNode {
  id: string
  groupId?: string
  name: string
  protocol: string
  host: string
  port: number
  rawUrl: string
  details: Record<string, unknown>
  latency: number | null
  lastTested: number | null
  createdAt: number
}

function decodeBase64URL(s: string): string {
  // Handle URL-safe base64 (used by SSR)
  return Buffer.from(normalizeBase64(s.replace(/-/g, '+').replace(/_/g, '/')), 'base64').toString('utf-8')
}

function decodeBase64(s: string): string {
  return Buffer.from(normalizeBase64(s), 'base64').toString('utf-8')
}

function normalizeBase64(s: string): string {
  const cleaned = s.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = cleaned.length % 4
  return padding === 0 ? cleaned : cleaned + '='.repeat(4 - padding)
}

function decodeMaybeURIComponent(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

function splitHostPort(authority: string, defaultPort: number): { host: string; port: number } {
  const value = authority.trim()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end >= 0) {
      const host = value.slice(1, end)
      const rest = value.slice(end + 1)
      const port = rest.startsWith(':') ? parseInt(rest.slice(1)) || defaultPort : defaultPort
      return { host, port }
    }
  }
  const lastColon = value.lastIndexOf(':')
  if (lastColon > 0) {
    const port = parseInt(value.slice(lastColon + 1))
    if (port > 0) return { host: value.slice(0, lastColon), port }
  }
  return { host: value, port: defaultPort }
}

function parseQuery(s: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const part of s.split('&')) {
    const eq = part.indexOf('=')
    if (eq >= 0) {
      params[decodeMaybeURIComponent(part.slice(0, eq))] = decodeMaybeURIComponent(part.slice(eq + 1).replace(/\+/g, '%20'))
    }
  }
  return params
}

function generateId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function now(): number {
  return Date.now()
}

// ---- Parsers per protocol ----

function parseVmess(inner: string): StoredNode {
  const json = JSON.parse(decodeBase64(inner))
  return {
    id: generateId(),
    name: json.ps || json.add || 'VMess 节点',
    protocol: 'vmess',
    host: json.add || '',
    port: parseInt(json.port) || 443,
    rawUrl: `vmess://${inner}`,
    details: {
      uuid: json.id || '',
      alterId: json.aid ?? 0,
      security: json.scy || 'auto',
      network: json.net || 'tcp',
      type: json.type || 'none',
      hostHeader: json.host || '',
      path: json.path || '',
      tls: json.tls || '',
      sni: json.sni || '',
      fingerprint: json.fp || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseVless(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'vless',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      uuid: decodeMaybeURIComponent(url.username || ''),
      encryption: params.encryption || 'none',
      flow: params.flow || '',
      security: params.security || '',
      sni: params.sni || '',
      fingerprint: params.fp || '',
      type: params.type || 'tcp',
      hostHeader: params.host || '',
      path: params.path || '',
      alpn: params.alpn || '',
      pbk: params.pbk || '',
      sid: params.sid || '',
      spiderX: params.spiderX || '',
      serviceName: params.serviceName || '',
      authority: params.authority || '',
      mode: params.mode || '',
      headerType: params.headerType || '',
      insecure: params.allowInsecure || params.insecure || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseTrojan(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'trojan',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      password: decodeMaybeURIComponent(url.username || ''),
      sni: params.sni || url.hostname,
      alpn: params.alpn || '',
      fingerprint: params.fp || '',
      type: params.type || 'tcp',
      host: params.host || '',
      path: params.path || '',
      security: params.security || 'tls',
      serviceName: params.serviceName || '',
      authority: params.authority || '',
      insecure: params.allowInsecure || params.insecure || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseShadowsocks(url: URL): StoredNode {
  let method = ''
  let password = ''
  let host = url.hostname
  let port = parseInt(url.port) || 8388

  // Try userinfo: base64(method:password)@host:port
  if (url.username) {
    try {
      const decoded = decodeBase64(url.username)
      const colon = decoded.indexOf(':')
      if (colon >= 0) {
        method = decoded.slice(0, colon)
        password = decoded.slice(colon + 1)
      }
    } catch {
      // userinfo is plain method:password? might be in a different format
      method = url.username || ''
      password = url.password || ''
    }
  }
  // Some SS URLs have host = base64(host:port) — detect and fix
  if (!url.port || url.port === '') {
    try {
      const decoded = decodeBase64(host)
      const lastColon = decoded.lastIndexOf(':')
      if (lastColon >= 0) {
        host = decoded.slice(0, lastColon)
        port = parseInt(decoded.slice(lastColon + 1)) || 8388
      }
    } catch { /* not base64 encoded */ }
  }

  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${host}:${port}`

  return {
    id: generateId(),
    name,
    protocol: method.toLowerCase().includes('2022') ? 'ss2022' : 'ss',
    host,
    port,
    rawUrl: url.href,
    details: {
      method: method || params.encryption || 'aes-256-gcm',
      password: password || params.password || '',
      plugin: params.plugin || '',
      pluginOpts: params['plugin-opts'] || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseShadowsocksRaw(url: URL, rawUrl: string): StoredNode {
  const hashIndex = rawUrl.indexOf('#')
  const name = hashIndex >= 0
    ? decodeMaybeURIComponent(rawUrl.slice(hashIndex + 1))
    : ''
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl
  const queryIndex = withoutHash.indexOf('?')
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : url.search.slice(1)
  const params = parseQuery(query)
  const body = (queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash).slice('ss://'.length)

  let method = ''
  let password = ''
  let host = url.hostname
  let port = parseInt(url.port) || 8388

  const assignUserInfo = (userinfo: string): void => {
    const decodedUserInfo = decodeMaybeURIComponent(userinfo)
    const colon = decodedUserInfo.indexOf(':')
    if (colon >= 0) {
      method = decodedUserInfo.slice(0, colon)
      password = decodedUserInfo.slice(colon + 1)
      return
    }

    try {
      const decoded = decodeBase64(decodedUserInfo)
      const decodedColon = decoded.indexOf(':')
      if (decodedColon >= 0) {
        method = decoded.slice(0, decodedColon)
        password = decoded.slice(decodedColon + 1)
      }
    } catch { /* not base64 userinfo */ }
  }

  const at = body.lastIndexOf('@')
  if (at >= 0) {
    assignUserInfo(body.slice(0, at))
    const hp = splitHostPort(body.slice(at + 1), 8388)
    host = hp.host
    port = hp.port
  } else {
    try {
      const decoded = decodeBase64(body)
      const decodedAt = decoded.lastIndexOf('@')
      if (decodedAt >= 0) {
        assignUserInfo(decoded.slice(0, decodedAt))
        const hp = splitHostPort(decoded.slice(decodedAt + 1), 8388)
        host = hp.host
        port = hp.port
      }
    } catch { /* keep URL parser result */ }
  }

  if (!method && url.username) {
    assignUserInfo(url.password ? `${url.username}:${url.password}` : url.username)
  }

  const displayName = name || `${host}:${port}`

  return {
    id: generateId(),
    name: displayName,
    protocol: method.toLowerCase().includes('2022') ? 'ss2022' : 'ss',
    host,
    port,
    rawUrl,
    details: {
      method: method || params.encryption || 'aes-256-gcm',
      password: password || params.password || '',
      plugin: params.plugin || '',
      pluginOpts: params['plugin-opts'] || params.plugin_opts || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseSSR(inner: string): StoredNode {
  const decoded = decodeBase64URL(inner)
  // Format: host:port:protocol:method:obfs:base64_pass/?params...
  const parts = decoded.split('/?')
  const addrParts = parts[0].split(':')
  if (addrParts.length < 6) {
    return { id: generateId(), name: 'SSR 节点', protocol: 'ssr', host: '', port: 1080, rawUrl: `ssr://${inner}`, details: {}, latency: null, lastTested: null, createdAt: now() }
  }
  const params = parts[1] ? parseQuery(parts[1]) : {}
  const name = params.remarks ? decodeBase64URL(params.remarks) : `${addrParts[0]}:${addrParts[1]}`
  return {
    id: generateId(),
    name,
    protocol: 'ssr',
    host: addrParts[0],
    port: parseInt(addrParts[1]) || 1080,
    rawUrl: `ssr://${inner}`,
    details: {
      protocol: addrParts[2],
      method: addrParts[3],
      obfs: addrParts[4],
      password: decodeBase64URL(addrParts[5]),
      obfsParam: params.obfsparam ? decodeBase64URL(params.obfsparam) : '',
      protocolParam: params.protoparam ? decodeBase64URL(params.protoparam) : '',
      group: params.group ? decodeBase64URL(params.group) : '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseHysteria(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'hysteria',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      auth: params.auth || url.username || '',
      peer: params.peer || '',
      insecure: params.insecure === '1' ? 1 : 0,
      alpn: params.alpn || 'h3',
      protocol: params.protocol || 'udp',
      upmbps: params.upmbps || '50',
      downmbps: params.downmbps || '200',
      obfs: params.obfs || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseHysteria2(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'hysteria2',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      auth: url.username || params.auth || '',
      sni: params.sni || url.hostname,
      insecure: params.insecure === '1' ? 1 : 0,
      obfs: params.obfs || '',
      'obfs-password': params['obfs-password'] || '',
      pinSHA256: params.pinSHA256 || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseTuic(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'tuic',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      uuid: url.username || params.uuid || '',
      password: url.password || params.password || '',
      congestionControl: params.congestion_control || 'cubic',
      alpn: params.alpn || 'h3',
      sni: params.sni || url.hostname,
      allowInsecure: params.allow_insecure === '1' ? 1 : 0,
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseNaive(url: URL): StoredNode {
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'naive',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      username: url.username || '',
      password: url.password || '',
      padding: url.searchParams.get('padding') || 'false',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseJuicity(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'juicity',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      uuid: url.username || params.uuid || '',
      password: (url.password || params.password || '').replace(/^:/, ''),
      sni: params.sni || url.hostname,
      allowInsecure: params.allow_insecure === '1' ? 1 : 0,
      pinnedCertchainSha256: params.pinned_certchain_sha256 || '',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

function parseShadowquic(url: URL): StoredNode {
  const params = parseQuery(url.search.slice(1))
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port || '443'}`
  return {
    id: generateId(),
    name,
    protocol: 'shadowquic',
    host: url.hostname,
    port: parseInt(url.port) || 443,
    rawUrl: url.href,
    details: {
      password: params.password || '',
      sni: params.sni || url.hostname,
      quicVersion: params.quic_version || '1',
      concurrency: params.concurrency || '1',
    },
    latency: null,
    lastTested: null,
    createdAt: now(),
  }
}

// ---- Main export ----

export function parseNodeUrl(rawUrl: string): StoredNode | null {
  let trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    switch (url.protocol.replace(':', '')) {
      case 'vmess': {
        const data = url.searchParams.get('url') || url.pathname.replace('//', '')
        return parseVmess(data || trimmed.slice(8))
      }
      case 'vless': return parseVless(url)
      case 'trojan': return parseTrojan(url)
      case 'ss': {
        // SS URLs: ss://base64(method:password)@host:port#name
        // or ss://base64(method:password@host:port)#name
        return parseShadowsocksRaw(url, trimmed)
      }
      case 'ssr': {
        const inner = url.searchParams.get('url') || url.pathname.replace('//', '')
        return parseSSR(inner)
      }
      case 'hysteria': return parseHysteria(url)
      case 'hysteria2': case 'hy2': return parseHysteria2(url)
      case 'tuic': return parseTuic(url)
      case 'naive': case 'naive+https': return parseNaive(url)
      case 'juicity': return parseJuicity(url)
      case 'shadowquic': return parseShadowquic(url)
      default: return null
    }
  } catch {
    return null
  }
}

export function parseNodeUrls(rawUrls: string[]): StoredNode[] {
  return rawUrls.map(parseNodeUrl).filter((n): n is StoredNode => n !== null)
}
