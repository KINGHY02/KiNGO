import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import * as yaml from 'js-yaml'
import { ProxyDefinition } from './proxy-manager'

interface ServerInfo {
  host: string
  port: number
}

export class ConfigService {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private configPath(def: ProxyDefinition): string {
    return join(this.baseDir, def.dir, def.configFile)
  }

  private backupPath(configPath: string): string {
    const dir = dirname(configPath)
    const ext = configPath.endsWith('.yaml') ? '.yaml' : '.json'
    return join(dir, `config${ext}_backup`).replace('.yaml_backup', '.yaml_backup').replace('.json_backup', '.json_backup')
  }

  readConfig(proxyId: string, defs: ProxyDefinition[]): { content: string; format: string; backupExists: boolean } | null {
    const def = defs.find((d) => d.id === proxyId)
    if (!def) return null
    const path = this.configPath(def)
    if (!existsSync(path)) return null
    return {
      content: readFileSync(path, 'utf-8'),
      format: def.configFormat,
      backupExists: existsSync(this.backupPath(path))
    }
  }

  writeConfig(proxyId: string, content: string, defs: ProxyDefinition[]): { success: boolean; error?: string } {
    const def = defs.find((d) => d.id === proxyId)
    if (!def) return { success: false, error: `未知代理: ${proxyId}` }

    // Validate syntax before writing
    try {
      if (def.configFormat === 'yaml') {
        yaml.load(content)
      } else {
        JSON.parse(content)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `语法错误: ${msg}` }
    }

    const path = this.configPath(def)
    // Backup old config
    const backupPath = this.backupPath(path)
    if (existsSync(path)) {
      copyFileSync(path, backupPath)
    }

    writeFileSync(path, content, 'utf-8')
    return { success: true }
  }

  restoreBackup(proxyId: string, defs: ProxyDefinition[]): { success: boolean } {
    const def = defs.find((d) => d.id === proxyId)
    if (!def) return { success: false }
    const path = this.configPath(def)
    const backupPath = this.backupPath(path)
    if (!existsSync(backupPath)) return { success: false }
    copyFileSync(backupPath, path)
    return { success: true }
  }

  extractServerInfo(proxyId: string, defs: ProxyDefinition[]): ServerInfo[] {
    const def = defs.find((d) => d.id === proxyId)
    const cfg = this.readConfig(proxyId, defs)
    if (!def || !cfg) return []

    try {
      const data = cfg.format === 'yaml' ? yaml.load(cfg.content) as Record<string, unknown> : JSON.parse(cfg.content)

      switch (def.id) {
        case 'clash-meta': {
          const proxies = (data as { proxies?: Array<{ server: string; port: number }> }).proxies
          return proxies ? proxies.map((p) => ({ host: p.server, port: p.port })) : []
        }
        case 'xray': {
          const outbounds = (data as { outbounds?: Array<{ protocol: string; settings: { vnext?: Array<{ address: string; port: number }> } }> }).outbounds
          const proxy = outbounds?.find((o) => o.protocol === 'vless')
          const vnext = proxy?.settings?.vnext?.[0]
          return vnext ? [{ host: vnext.address, port: vnext.port }] : []
        }
        case 'hysteria': {
          const server = (data as { server?: string }).server
          return server ? [parseHostPort(server)] : []
        }
        case 'hysteria2': {
          const server = (data as { server?: string }).server
          return server ? [parseHostPort(server)] : []
        }
        case 'singbox': {
          const ob = (data as { outbounds?: Array<{ server: string; server_port: number }> }).outbounds
          const proxy = ob?.find((o) => o.server && o.server_port)
          return proxy ? [{ host: proxy.server, port: proxy.server_port }] : []
        }
        case 'naiveproxy': {
          const proxyUrl = (data as { proxy?: string }).proxy
          if (proxyUrl) {
            try {
              const u = new URL(proxyUrl)
              return [{ host: u.hostname, port: parseInt(u.port) || 443 }]
            } catch { return [] }
          }
          return []
        }
        case 'juicity': {
          const server = (data as { server?: string }).server
          return server ? [parseHostPort(server)] : []
        }
        case 'mieru': {
          const profiles = (data as { profiles?: Array<{ servers?: Array<{ ipAddress: string }> }> }).profiles
          const portBindings = (data as { portBindings?: Array<{ port: number }> }).portBindings
          const ip = profiles?.[0]?.servers?.[0]?.ipAddress
          const port = portBindings?.[0]?.port
          return ip ? [{ host: ip, port: port ?? 0 }] : []
        }
        case 'shadowquic': {
          const addr = (data as { outbound?: { addr?: string } }).outbound?.addr
          return addr ? [parseHostPort(addr)] : []
        }
      }
    } catch { /* ignore parse errors */ }
    return []
  }
}

function parseHostPort(str: string): ServerInfo {
  // Handle formats: "host:port" or "host"
  const parts = str.split(':')
  if (parts.length >= 2 && !isNaN(Number(parts[parts.length - 1]))) {
    const port = Number(parts.pop())
    return { host: parts.join(':'), port }
  }
  return { host: str, port: 0 }
}
