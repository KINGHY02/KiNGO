// Config generator — produces temporary proxy config files for any {node, core} combination.
// Each generator receives a StoredNode and returns the output config as a string (YAML or JSON).

import { StoredNode } from './protocol-parser'
import * as yaml from 'js-yaml'

// ---- Clash Meta (YAML) ----

function toClashProxyType(protocol: string): string {
  switch (protocol) {
    case 'ss':
    case 'ss2022': return 'ss'
    case 'ssr': return 'ssr'
    case 'vmess': return 'vmess'
    case 'vless': return 'vless'
    case 'trojan': return 'trojan'
    case 'hysteria': return 'hysteria'
    case 'hysteria2': return 'hysteria2'
    case 'tuic': return 'tuic'
    case 'naive': return 'http'
    default: return protocol
  }
}

function escapeYaml(s: string): string {
  // Quote strings with special chars
  if (s.length === 0) return '""'
  if (/[:{[,&\*#?|\-<>=!%@`]/.test(s) || s.includes("'") || s.includes('"')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function indent(n: number): string {
  return ' '.repeat(n)
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function listValue(value: unknown): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function nodeNetwork(d: Record<string, unknown>): string {
  return String(d.network || d.type || 'tcp')
}

function clashProxyLines(node: StoredNode): string[] {
  const type = toClashProxyType(node.protocol)
  const d = node.details
  const lines: string[] = []

  lines.push(`${indent(2)}- name: ${escapeYaml(node.name)}`)
  lines.push(`${indent(4)}type: ${type}`)
  lines.push(`${indent(4)}server: ${node.host}`)
  lines.push(`${indent(4)}port: ${node.port}`)

  switch (node.protocol) {
    case 'vmess':
      lines.push(`${indent(4)}uuid: ${escapeYaml(String(d.uuid || ''))}`)
      lines.push(`${indent(4)}alterId: ${d.alterId ?? 0}`)
      lines.push(`${indent(4)}cipher: ${d.security || 'auto'}`)
      if (d.network || d.type) lines.push(`${indent(4)}network: ${d.network || d.type}`)
      if (d.tls === 'tls') {
        lines.push(`${indent(4)}tls: true`)
        if (d.sni) lines.push(`${indent(4)}servername: ${escapeYaml(String(d.sni))}`)
        if (d.fingerprint) lines.push(`${indent(4)}fingerprint: ${d.fingerprint}`)
      }
      if ((d.network || d.type) === 'ws') {
        lines.push(`${indent(4)}ws-opts:`)
        if (d.path) lines.push(`${indent(6)}path: ${escapeYaml(String(d.path))}`)
        if (d.host || d.hostHeader) lines.push(`${indent(6)}headers:\n${indent(8)}Host: ${escapeYaml(String(d.host || d.hostHeader))}`)
      }
      break
    case 'ss':
    case 'ss2022':
      lines.push(`${indent(4)}cipher: ${d.method || 'aes-256-gcm'}`)
      lines.push(`${indent(4)}password: ${escapeYaml(String(d.password || ''))}`)
      break
    case 'trojan':
      lines.push(`${indent(4)}password: ${escapeYaml(String(d.password || ''))}`)
      lines.push(`${indent(4)}network: ${d.type || d.network || 'tcp'}`)
      lines.push(`${indent(4)}tls: true`)
      if (d.sni) lines.push(`${indent(4)}sni: ${escapeYaml(String(d.sni))}`)
      if (d.fingerprint) lines.push(`${indent(4)}fingerprint: ${d.fingerprint}`)
      if (d.alpn) lines.push(`${indent(4)}alpn:\n${indent(6)}- ${d.alpn}`)
      if (d.type === 'ws') {
        lines.push(`${indent(4)}ws-opts:`)
        if (d.path) lines.push(`${indent(6)}path: ${escapeYaml(String(d.path))}`)
        if (d.hostHeader) lines.push(`${indent(6)}headers:\n${indent(8)}Host: ${escapeYaml(String(d.hostHeader))}`)
      }
      break
    case 'vless':
      lines.push(`${indent(4)}uuid: ${escapeYaml(String(d.uuid || ''))}`)
      if (d.network || d.type) lines.push(`${indent(4)}network: ${d.network || d.type}`)
      lines.push(`${indent(4)}udp: true`)
      if (d.flow) lines.push(`${indent(4)}flow: ${d.flow}`)
      if (d.security === 'reality') {
        lines.push(`${indent(4)}tls: true`)
        lines.push(`${indent(4)}servername: ${escapeYaml(String(d.sni || node.host))}`)
        if (d.fingerprint) lines.push(`${indent(4)}client-fingerprint: ${d.fingerprint}`)
        lines.push(`${indent(4)}reality-opts:`)
        lines.push(`${indent(6)}public-key: ${escapeYaml(String(d.pbk || ''))}`)
        if (d.sid) lines.push(`${indent(6)}short-id: "${d.sid}"`)
      } else if (d.security === 'tls' || d.tls === 'tls' || isTruthy(d.tls)) {
        lines.push(`${indent(4)}tls: true`)
        lines.push(`${indent(4)}servername: ${escapeYaml(String(d.sni || node.host))}`)
        if (d.fingerprint) lines.push(`${indent(4)}fingerprint: ${d.fingerprint}`)
        if (d.alpn) lines.push(`${indent(4)}alpn:\n${indent(6)}- ${d.alpn}`)
        if (isTruthy(d.insecure)) lines.push(`${indent(4)}skip-cert-verify: true`)
      }
      if (d.network === 'ws' || d.type === 'ws') {
        lines.push(`${indent(4)}ws-opts:`)
        if (d.path) lines.push(`${indent(6)}path: ${escapeYaml(String(d.path))}`)
        if (d.host || d.hostHeader) lines.push(`${indent(6)}headers:\n${indent(8)}Host: ${escapeYaml(String(d.host || d.hostHeader))}`)
      }
      if (nodeNetwork(d) === 'grpc' && d.serviceName) {
        lines.push(`${indent(4)}grpc-opts:`)
        lines.push(`${indent(6)}grpc-service-name: ${escapeYaml(String(d.serviceName))}`)
      }
      if (nodeNetwork(d) === 'xhttp' && d.path) {
        lines.push(`${indent(4)}xhttp-opts:`)
        lines.push(`${indent(6)}path: ${escapeYaml(String(d.path))}`)
      }
      break
    case 'hysteria':
      if (d.auth) lines.push(`${indent(4)}auth-str: ${escapeYaml(String(d.auth))}`)
      lines.push(`${indent(4)}sni: ${escapeYaml(String(d.sni || node.host))}`)
      lines.push(`${indent(4)}skip-cert-verify: ${d.insecure ? 'true' : 'false'}`)
      lines.push(`${indent(4)}protocol: udp`)
      lines.push(`${indent(4)}up: "${d.upmbps || 50} Mbps"`)
      lines.push(`${indent(4)}down: "${d.downmbps || 200} Mbps"`)
      if (d.alpn) lines.push(`${indent(4)}alpn:\n${indent(6)}- ${d.alpn}`)
      break
    case 'hysteria2':
      if (d.auth) lines.push(`${indent(4)}password: ${escapeYaml(String(d.auth))}`)
      lines.push(`${indent(4)}sni: ${escapeYaml(String(d.sni || node.host))}`)
      lines.push(`${indent(4)}skip-cert-verify: ${d.insecure ? 'true' : 'false'}`)
      break
    case 'tuic':
      lines.push(`${indent(4)}uuid: ${escapeYaml(String(d.uuid || ''))}`)
      lines.push(`${indent(4)}password: ${escapeYaml(String(d.password || ''))}`)
      lines.push(`${indent(4)}sni: ${escapeYaml(String(d.sni || node.host))}`)
      if (d.congestionControl) lines.push(`${indent(4)}congestion-controller: ${d.congestionControl}`)
      if (d.allowInsecure) lines.push(`${indent(4)}skip-cert-verify: true`)
      break
    default:
      break
  }
  return lines
}

export function generateClashMetaConfig(node: StoredNode): string {
  const proxyName = escapeYaml(node.name)
  const lines: string[] = [
    'mixed-port: 7890',
    'allow-lan: false',
    'log-level: info',
    'mode: global',
    'dns:',
    '  enable: true',
    '  ipv6: false',
    '  enhanced-mode: fake-ip',
    '  nameserver:',
    '    - 223.5.5.5',
    '    - 8.8.8.8',
    'proxies:',
  ]
  lines.push(...clashProxyLines(node))
  lines.push('proxy-groups:')
  lines.push(`  - name: "\u{1F680} 手动选择"`)
  lines.push('    type: select')
  lines.push('    proxies:')
  lines.push(`      - ${proxyName}`)
  lines.push('      - DIRECT')
  lines.push('rules:')
  lines.push('  - MATCH,\u{1F680} 手动选择')
  return lines.join('\n') + '\n'
}

// ---- Sing-Box (JSON) ----

function toSingBoxType(protocol: string): string {
  switch (protocol) {
    case 'ss':
    case 'ss2022': return 'shadowsocks'
    case 'ssr': return 'shadowsocksr'
    case 'trojan': return 'trojan'
    case 'vmess': return 'vmess'
    case 'vless': return 'vless'
    case 'hysteria': return 'hysteria'
    case 'hysteria2': return 'hysteria2'
    case 'tuic': return 'tuic'
    case 'naive': return 'http'
    case 'juicity': return 'juicity'
    case 'shadowquic': return 'shadowtls'
    default: return protocol
  }
}

function buildSingBoxTransport(d: Record<string, unknown>): Record<string, unknown> | undefined {
  const network = nodeNetwork(d)
  if (network === 'ws') {
    const transport: Record<string, unknown> = { type: 'ws', path: d.path || '/' }
    if (d.host || d.hostHeader) transport.headers = { Host: d.host || d.hostHeader }
    return transport
  }
  if (network === 'grpc') {
    return { type: 'grpc', service_name: d.serviceName || d.path || '' }
  }
  if (network === 'http' || network === 'h2') {
    const transport: Record<string, unknown> = { type: 'http' }
    if (d.path) transport.path = String(d.path).split(',').filter(Boolean)
    if (d.host || d.hostHeader) transport.host = String(d.host || d.hostHeader).split(',').filter(Boolean)
    return transport
  }
  if (network === 'xhttp') {
    const transport: Record<string, unknown> = { type: 'xhttp' }
    if (d.path) transport.path = d.path
    if (d.host || d.hostHeader) transport.host = d.host || d.hostHeader
    return transport
  }
  return undefined
}

function buildSingBoxOutbound(node: StoredNode): Record<string, unknown> {
  const sbType = toSingBoxType(node.protocol)
  const d = node.details
  const out: Record<string, unknown> = {
    type: sbType,
    tag: 'manual',
    server: node.host,
    server_port: node.port,
  }

  switch (node.protocol) {
    case 'ss':
    case 'ss2022':
      out.method = d.method || 'aes-256-gcm'
      out.password = d.password || ''
      break
    case 'ssr':
      out.method = d.method || 'aes-256-gcm'
      out.password = d.password || ''
      out.protocol = d.protocol || 'origin'
      out.obfs = d.obfs || 'plain'
      break
    case 'vmess':
      out.uuid = d.uuid || ''
      out.security = d.security || 'auto'
      out.alter_id = d.alterId ?? 0
      if (d.tls === 'tls') {
        out.tls = { enabled: true, server_name: d.sni || node.host, insecure: true }
      }
      out.transport = buildSingBoxTransport(d)
      break
    case 'vless':
      out.uuid = d.uuid || ''
      out.flow = d.flow || ''
      if (d.security === 'reality') {
        out.tls = {
          enabled: true,
          server_name: d.sni || node.host,
          utls: { enabled: true, fingerprint: d.fingerprint || 'chrome' },
          reality: { enabled: true, public_key: d.pbk || '', short_id: d.sid || '' },
        }
      } else if (d.security === 'tls') {
        out.tls = { enabled: true, server_name: d.sni || node.host, insecure: true,
          ...(d.fingerprint ? { utls: { enabled: true, fingerprint: d.fingerprint } } : {}) }
      }
      out.transport = buildSingBoxTransport(d)
      break
    case 'trojan':
      out.password = d.password || ''
      out.tls = { enabled: true, server_name: d.sni || node.host, insecure: true }
      out.transport = buildSingBoxTransport(d)
      break
    case 'hysteria':
      out.auth_str = d.auth || ''
      out.up_mbps = parseInt(String(d.upmbps || '50'))
      out.down_mbps = parseInt(String(d.downmbps || '200'))
      out.tls = { enabled: true, server_name: d.sni || node.host, insecure: true }
      break
    case 'hysteria2':
      out.password = d.auth || ''
      out.tls = { enabled: true, server_name: d.sni || node.host, insecure: d.insecure ? true : false }
      break
    case 'tuic':
      out.uuid = d.uuid || ''
      out.password = d.password || ''
      out.congestion_control = d.congestionControl || 'cubic'
      out.tls = { enabled: true, server_name: d.sni || node.host, alpn: [(d.alpn || 'h3')], insecure: true }
      break
    case 'juicity':
      out.uuid = d.uuid || ''
      out.password = d.password || ''
      break
    case 'shadowquic':
      out.password = d.password || ''
      break
    case 'naive':
      out.username = d.username || ''
      out.password = d.password || ''
      break
    default:
      break
  }

  return out
}

export function generateSingBoxConfig(node: StoredNode): string {
  const outbound = buildSingBoxOutbound(node)
  const config = {
    inbounds: [{
      type: 'mixed',
      tag: 'mixed-in',
      listen: '127.0.0.1',
      listen_port: 1080,
    }],
    outbounds: [
      outbound,
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules: [],
      final: 'manual',
      auto_detect_interface: true,
    },
  }
  return JSON.stringify(config, null, 2)
}

// ---- Xray (JSON) ----

function toXrayProtocol(protocol: string): string {
  // xray supports: vmess, vless, trojan, shadowsocks, socks, http
  switch (protocol) {
    case 'ss':
    case 'ss2022': return 'shadowsocks'
    case 'ssr': return 'shadowsocks'
    default: return protocol
  }
}

function applyXrayTransport(streamSettings: Record<string, unknown>, d: Record<string, unknown>): void {
  const net = nodeNetwork(d)
  if (net === 'tcp') {
    if (d.headerType === 'http' || d.type === 'http') {
      streamSettings.network = 'tcp'
      streamSettings.tcpSettings = {
        header: {
          type: 'http',
          request: {
            path: listValue(d.path) || ['/'],
            headers: d.host || d.hostHeader ? { Host: listValue(d.host || d.hostHeader) } : undefined,
          },
        },
      }
    }
    return
  }

  streamSettings.network = net
  if (net === 'ws') {
    streamSettings.wsSettings = { path: d.path || '/' }
    if (d.host || d.hostHeader) {
      streamSettings.wsSettings = {
        ...(streamSettings.wsSettings as object),
        headers: { Host: d.host || d.hostHeader },
      }
    }
  } else if (net === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: d.serviceName || d.path || '',
      multiMode: d.mode === 'multi',
      authority: d.authority || d.host || d.hostHeader || undefined,
    }
  } else if (net === 'xhttp') {
    streamSettings.xhttpSettings = {
      path: d.path || '/',
      host: d.host || d.hostHeader || undefined,
      mode: d.mode || undefined,
    }
  } else if (net === 'http' || net === 'h2') {
    streamSettings.network = 'http'
    streamSettings.httpSettings = {
      path: listValue(d.path) || ['/'],
      host: listValue(d.host || d.hostHeader),
    }
  }
}

export function generateXrayConfig(node: StoredNode): string {
  const d = node.details
  const xrayProto = toXrayProtocol(node.protocol)

  const streamSettings: Record<string, unknown> = {}
  const needsTls = d.tls === 'tls' || d.security === 'tls'
  const needsReality = d.security === 'reality'
  if (needsTls) {
    streamSettings.security = 'tls'
    streamSettings.tlsSettings = {
      serverName: d.sni || node.host,
      allowInsecure: isTruthy(d.insecure),
      fingerprint: d.fingerprint || undefined,
      alpn: listValue(d.alpn),
    }
  } else if (needsReality) {
    streamSettings.security = 'reality'
    streamSettings.realitySettings = {
      serverName: d.sni || node.host,
      publicKey: d.pbk || '',
      shortId: d.sid || '',
      fingerprint: d.fingerprint || 'chrome',
      spiderX: d.spiderX || '/',
    }
  }
  applyXrayTransport(streamSettings, d)

  const settings: Record<string, unknown> = {}
  if (xrayProto === 'vmess' || xrayProto === 'vless') {
    const user: Record<string, unknown> = { id: d.uuid || '' }
    if (xrayProto === 'vmess') {
      user.alterId = d.alterId ?? 0
      user.security = d.security || 'auto'
    } else {
      user.encryption = d.encryption || 'none'
      if (d.flow) user.flow = d.flow
    }
    settings.vnext = [{
      address: node.host,
      port: node.port,
      users: [user],
    }]
  } else if (xrayProto === 'trojan') {
    settings.servers = [{ address: node.host, port: node.port, password: d.password || '' }]
  } else if (xrayProto === 'shadowsocks') {
    settings.servers = [{
      address: node.host,
      port: node.port,
      method: d.method || 'aes-256-gcm',
      password: d.password || '',
    }]
  }

  const config = {
    log: { loglevel: 'warning' },
    dns: {
      servers: ['8.8.8.8'],
    },
    inbounds: [{
      tag: 'in',
      port: 1080,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
    }],
    outbounds: [
      { tag: 'proxy', protocol: xrayProto, settings, ...(Object.keys(streamSettings).length > 0 ? { streamSettings } : {}) },
      { tag: 'direct', protocol: 'freedom' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [{ type: 'field', inboundTag: ['in'], network: 'tcp,udp', outboundTag: 'proxy' }],
    },
  }

  return JSON.stringify(config, null, 2)
}

// ---- Simple JSON cores (hysteria1, hysteria2, juicity, naiveproxy) ----

export function generateHysteriaConfig(node: StoredNode): string {
  const d = node.details
  const config: Record<string, unknown> = {
    server: `${node.host}:${node.port}`,
    protocol: d.protocol || 'udp',
    up_mbps: parseInt(String(d.upmbps || '50')),
    down_mbps: parseInt(String(d.downmbps || '200')),
    socks5: { listen: '127.0.0.1:1080' },
  }
  if (d.auth) config.auth = d.auth
  if (d.peer || d.sni) {
    config.tls = {
      sni: d.sni || node.host,
      insecure: d.insecure ? true : false,
    }
  }
  if (d.obfs) config.obfs = d.obfs
  return JSON.stringify(config, null, 2)
}

export function generateHysteria2Config(node: StoredNode): string {
  const d = node.details
  const config: Record<string, unknown> = {
    server: `${node.host}:${node.port}`,
    socks5: { listen: '127.0.0.1:1080' },
    tls: {
      sni: d.sni || node.host,
      insecure: d.insecure ? true : false,
    },
    bandwidth: { up: '50 mbps', down: '200 mbps' },
    quic: {
      initStreamReceiveWindow: 16777216,
      maxStreamReceiveWindow: 16777216,
      initConnReceiveWindow: 33554432,
      maxConnReceiveWindow: 33554432,
    },
    transport: { udp: { hopInterval: '30s' } },
  }
  if (d.auth) config.auth = d.auth
  if (d['obfs-password']) {
    config.obfs = { type: 'salamander', salamander: { password: d['obfs-password'] } }
  }
  return JSON.stringify(config, null, 2)
}

export function generateJuicityConfig(node: StoredNode): string {
  const d = node.details
  const config: Record<string, unknown> = {
    listen: '127.0.0.1:1080',
    server: `${node.host}:${node.port}`,
    uuid: d.uuid || '',
    password: d.password || '',
    sni: d.sni || node.host,
    allow_insecure: d.allowInsecure ? true : false,
    congestion_control: d.congestionControl || 'bbr',
    log_level: 'info',
  }
  return JSON.stringify(config, null, 2)
}

export function generateNaiveConfig(node: StoredNode): string {
  const d = node.details
  const username = d.username || ''
  const password = d.password || ''
  const auth = username ? `${username}:${password}@` : ''
  const config: Record<string, unknown> = {
    listen: 'socks://127.0.0.1:1080',
    proxy: `https://${auth}${node.host}:${node.port}`,
  }
  if (d.padding === 'true') config.padding = true
  return JSON.stringify(config, null, 2)
}

// ---- Mieru (special — 2-step: apply config then start) ----

export function generateMieruConfig(node: StoredNode): string {
  const d = node.details
  // Mieru client config is JSON
  const config: Record<string, unknown> = {
    profiles: [{
      profileName: 'manual',
      user: { name: d.username || 'default', password: d.password || '' },
      servers: [{
        ipAddress: node.host,
        portBindings: [{ port: node.port, protocol: 'TCP' }],
      }],
      mtu: 1400,
    }],
    activeProfile: 'manual',
    socks5ListenPort: 1080,
    socks5ListenLAN: false,
  }
  return JSON.stringify(config, null, 2)
}

export function generateShadowquicConfig(node: StoredNode): string {
  const d = node.details
  const config = {
    inbound: {
      type: 'socks',
      'bind-addr': '127.0.0.1:4080',
    },
    outbound: {
      type: 'shadowquic',
      addr: `${node.host}:${node.port}`,
      username: d.username || d.uuid || 'user',
      password: d.password || '',
      'server-name': d.sni || node.host,
      alpn: listValue(d.alpn) || ['h3'],
      'initial-mtu': Number(d.initialMtu || 1300),
      'congestion-control': d.congestionControl || 'bbr',
      'zero-rtt': isTruthy(d.zeroRtt),
      'over-stream': isTruthy(d.overStream),
    },
    'log-level': 'info',
  }
  return yaml.dump(config)
}

// ---- Main export ----

export function generateConfig(node: StoredNode, coreId: string): { content: string; format: 'yaml' | 'json' } {
  switch (coreId) {
    case 'clash-meta':
      return { content: generateClashMetaConfig(node), format: 'yaml' }
    case 'singbox':
      return { content: generateSingBoxConfig(node), format: 'json' }
    case 'xray':
      return { content: generateXrayConfig(node), format: 'json' }
    case 'hysteria':
      return { content: generateHysteriaConfig(node), format: 'json' }
    case 'hysteria2':
      return { content: generateHysteria2Config(node), format: 'json' }
    case 'naiveproxy':
      return { content: generateNaiveConfig(node), format: 'json' }
    case 'juicity':
      return { content: generateJuicityConfig(node), format: 'json' }
    case 'mieru':
      return { content: generateMieruConfig(node), format: 'json' }
    case 'shadowquic':
      return { content: generateShadowquicConfig(node), format: 'yaml' }
    default:
      throw new Error(`Unsupported core: ${coreId}`)
  }
}

// Returns the list of core IDs that support a given protocol
export function compatibleCores(protocol: string): Array<{ id: string; recommended: boolean }> {
  const map: Record<string, string[]> = {
    vmess: ['xray', 'clash-meta', 'singbox'],
    vless: ['xray', 'clash-meta', 'singbox'],
    trojan: ['xray', 'clash-meta', 'singbox'],
    ss: ['xray', 'clash-meta', 'singbox'],
    ss2022: ['singbox', 'clash-meta'],
    ssr: ['singbox', 'clash-meta'],
    hysteria: ['hysteria', 'clash-meta', 'singbox'],
    hysteria2: ['hysteria2', 'clash-meta', 'singbox'],
    tuic: ['clash-meta', 'singbox'],
    naive: ['naiveproxy', 'singbox'],
    juicity: ['juicity', 'singbox'],
    mieru: ['mieru'],
    shadowquic: ['shadowquic'],
  }
  const cores = map[protocol] || ['clash-meta']
  return cores.map((id, i) => ({ id, recommended: i === 0 }))
}

// For subscriptions: use raw clash YAML directly for clash-meta, convert for others
export function generateConfigFromRaw(rawConfig: string | null, coreId: string): { content: string; format: 'yaml' | 'json' } | null {
  if (!rawConfig) return null

  // clash-meta: raw YAML is already a valid config
  if (coreId === 'clash-meta') {
    return { content: rawConfig, format: 'yaml' }
  }

  // Other cores: extract first proxy from YAML and convert
  try {
    const parsed = yaml.load(rawConfig) as { proxies?: Array<Record<string, unknown>> } | undefined
    const proxy = parsed?.proxies?.[0]
    if (!proxy) return null

    // Build a StoredNode from the clash proxy entry
    const type = (proxy.type as string || '').toLowerCase()
    const server = proxy.server as string || ''
    const port = proxy.port as number || 443
    const name = proxy.name as string || `${server}:${port}`

    const protoMap: Record<string, string> = {
      vmess: 'vmess', vless: 'vless', trojan: 'trojan', ss: 'ss', ssr: 'ssr',
      hysteria: 'hysteria', hysteria2: 'hysteria2', tuic: 'tuic',
      http: 'naive', shadowsocks: 'ss', shadowsocksr: 'ssr',
    }

    const details: Record<string, unknown> = {}
    const protocol = protoMap[type] || type
    Object.assign(details, proxy)

    const node: StoredNode = {
      id: `conv_${Date.now()}`, name, protocol, host: server, port,
      rawUrl: '', details, latency: null, lastTested: null, createdAt: Date.now(),
    }

    return generateConfig(node, coreId)
  } catch {
    return null
  }
}
