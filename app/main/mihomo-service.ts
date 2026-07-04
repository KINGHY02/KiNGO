import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import * as http from 'http'
import * as https from 'https'
import * as yaml from 'js-yaml'
import Store from 'electron-store'
import { app } from 'electron'
import { execFile, execFileSync } from 'child_process'
import { ProxyManager } from './proxy-manager'
import { getCoreProfile } from './core-profiles'
import { setSettings } from './settings-store'
import { syncSystemProxy } from './system-proxy'
import { parseNodeUrls } from './protocol-parser'
import { generateClashMetaConfigFromNodes } from './config-generator'

export interface Result { success: boolean; error?: string }
export interface ClashProxy { name: string; type: string; now?: string; all?: string[]; udp?: boolean }
export interface ClashGroup { name: string; type: string; now: string | null; all: string[] }
export interface DelayResult { success: boolean; delay: number; error?: string }
export interface TunDiagnosticCheck {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  detail?: string
}
export interface TunDiagnosticReport {
  ready: boolean
  summary: string
  checks: TunDiagnosticCheck[]
}
export interface ClashConnection {
  id: string
  metadata?: Record<string, unknown>
  upload?: number
  download?: number
  chains?: string[]
  rule?: string
  rulePayload?: string
  start?: string
}

export type ClashMode = 'rule' | 'global' | 'direct'

export interface ClashRuntimeConfig {
  mode: ClashMode
}

export interface ClashProfile {
  id: string
  name: string
  updatedAt: number
  source: 'default' | 'imported' | 'url'
  active: boolean
  url?: string
  lastUpdateAttemptAt?: number | null
  lastUpdateError?: string | null
  autoUpdate?: boolean
  updateInterval?: number
}

interface ClashProfileRecord {
  id: string
  name: string
  fileName: string
  updatedAt: number
  source: 'imported' | 'url'
  url?: string
  lastUpdateAttemptAt?: number | null
  lastUpdateError?: string | null
  autoUpdate?: boolean
  updateInterval?: number
}

interface ClashProfileStore {
  activeProfileId: string
  profiles: ClashProfileRecord[]
  tunEnabled: boolean
}

const MIHOMO_CORE_ID = 'mihomo'
const DEFAULT_SECRET = 'KiNGO'
const DEFAULT_PROFILE_ID = 'default'
const DELAY_TEST_URL = 'http://cp.cloudflare.com/generate_204'

export class MihomoService {
  private store = new Store<ClashProfileStore>({
    name: 'clash-profiles',
    defaults: { activeProfileId: DEFAULT_PROFILE_ID, profiles: [], tunEnabled: false },
  })

  constructor(
    private baseDir: string,
    private proxyManager: ProxyManager,
  ) {}

  getRuntimeOptions(): { tunEnabled: boolean } {
    return { tunEnabled: !!this.store.get('tunEnabled') }
  }

  updateRuntimeOptions(options: { tunEnabled?: boolean }): Result {
    if (typeof options.tunEnabled === 'boolean') this.store.set('tunEnabled', options.tunEnabled)
    return { success: true }
  }

  diagnoseTun(): TunDiagnosticReport {
    const checks: TunDiagnosticCheck[] = []
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    const tunEnabled = !!this.store.get('tunEnabled')

    checks.push({
      key: 'switch',
      label: 'TUN 开关',
      status: tunEnabled ? 'pass' : 'warn',
      message: tunEnabled ? '已启用，下一次启动 Clash 模式时生效' : '当前未启用；如需接管系统流量，请先开启 TUN',
    })

    if (!profile) {
      checks.push({ key: 'core-profile', label: '核心定义', status: 'fail', message: 'mihomo 核心定义不存在' })
      return makeTunReport(checks)
    }

    checks.push({
      key: 'core-support',
      label: '核心能力',
      status: profile.supportsTun ? 'pass' : 'fail',
      message: profile.supportsTun ? `${profile.name} 标记为支持 TUN` : `${profile.name} 不支持 TUN`,
    })

    const executablePath = join(this.baseDir, profile.dir, profile.executable)
    checks.push({
      key: 'executable',
      label: '核心文件',
      status: existsSync(executablePath) ? 'pass' : 'fail',
      message: existsSync(executablePath) ? 'mihomo 可执行文件存在' : 'mihomo 可执行文件缺失',
      detail: executablePath,
    })

    const configPath = join(this.baseDir, profile.dir, profile.configFile)
    if (!existsSync(configPath)) {
      checks.push({
        key: 'config',
        label: '配置文件',
        status: 'fail',
        message: 'mihomo 配置文件不存在',
        detail: configPath,
      })
    } else {
      try {
        const config = (yaml.load(readFileSync(configPath, 'utf-8')) || {}) as Record<string, unknown>
        const tun = typeof config.tun === 'object' && config.tun !== null ? config.tun as Record<string, unknown> : null
        checks.push({
          key: 'config',
          label: '配置文件',
          status: 'pass',
          message: '配置文件可以解析',
          detail: configPath,
        })
        checks.push({
          key: 'tun-config',
          label: 'TUN 配置',
          status: tun?.enable === true ? 'pass' : tunEnabled ? 'warn' : 'warn',
          message: tun?.enable === true
            ? '当前配置已写入 tun.enable=true'
            : '当前配置尚未写入 tun.enable=true；重新启动 Clash 模式时会自动写入',
        })
      } catch (error) {
        checks.push({
          key: 'config',
          label: '配置文件',
          status: 'fail',
          message: `配置文件解析失败：${error instanceof Error ? error.message : String(error)}`,
          detail: configPath,
        })
      }
    }

    const admin = isProbablyElevated()
    checks.push({
      key: 'admin',
      label: '管理员权限',
      status: admin ? 'pass' : 'warn',
      message: admin ? '当前进程看起来具备管理员权限' : '未检测到管理员权限；部分 TUN/虚拟网卡场景可能启动失败',
    })

    return makeTunReport(checks)
  }

  listProfiles(): ClashProfile[] {
    const activeProfileId = this.store.get('activeProfileId') || DEFAULT_PROFILE_ID
    return [
      {
        id: DEFAULT_PROFILE_ID,
        name: '默认 Clash 配置',
        updatedAt: this.getDefaultConfigUpdatedAt(),
        source: 'default',
        active: activeProfileId === DEFAULT_PROFILE_ID,
        lastUpdateAttemptAt: null,
        lastUpdateError: null,
        autoUpdate: false,
        updateInterval: 12,
      },
      ...this.store.get('profiles').map((profile) => ({
        id: profile.id,
        name: profile.name,
        updatedAt: profile.updatedAt,
        source: profile.source,
        active: activeProfileId === profile.id,
        url: profile.url,
        lastUpdateAttemptAt: profile.lastUpdateAttemptAt ?? null,
        lastUpdateError: profile.lastUpdateError ?? null,
        autoUpdate: !!profile.autoUpdate,
        updateInterval: profile.updateInterval || 12,
      })),
    ]
  }

  saveProfile(input: { id?: string; name: string; content: string; url?: string; autoUpdate?: boolean; updateInterval?: number }): Result & { profile?: ClashProfile } {
    const name = input.name.trim()
    if (!name) return { success: false, error: '请输入配置名称' }
    const content = input.content.trim()
    if (!content) return { success: false, error: '配置内容不能为空' }

    const validation = this.validateClashYaml(content)
    if (!validation.success) return validation

    const profiles = this.store.get('profiles')
    const existing = input.id ? profiles.find((profile) => profile.id === input.id) : undefined
    const id = existing?.id || `clash_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
    const fileName = existing?.fileName || `${id}.yaml`
    this.ensureProfileDir()
    writeFileSync(join(this.profileDir(), fileName), content, 'utf-8')

    const nextRecord: ClashProfileRecord = {
      id,
      name,
      fileName,
      updatedAt: Date.now(),
      source: input.url ? 'url' : 'imported',
      url: input.url,
      lastUpdateAttemptAt: input.url ? Date.now() : null,
      lastUpdateError: null,
      autoUpdate: !!input.autoUpdate,
      updateInterval: Math.max(1, input.updateInterval || 12),
    }
    const nextProfiles = existing
      ? profiles.map((profile) => profile.id === id ? nextRecord : profile)
      : [...profiles, nextRecord]
    this.store.set('profiles', nextProfiles)

    return {
      success: true,
      profile: this.listProfiles().find((profile) => profile.id === id),
    }
  }

  async saveProfileFromUrl(input: { id?: string; name: string; url: string; autoUpdate?: boolean; updateInterval?: number }): Promise<Result & { profile?: ClashProfile }> {
    const url = input.url.trim()
    if (!url) return { success: false, error: '请输入订阅链接' }
    try {
      const content = normalizeClashSubscriptionContent(await fetchText(url))
      const result = this.saveProfile({
        id: input.id,
        name: input.name,
        content,
        url,
        autoUpdate: input.autoUpdate,
        updateInterval: input.updateInterval,
      })
      if (!result.success) return result
      return result
    } catch (error) {
      return { success: false, error: `订阅下载失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  updateProfileOptions(profileId: string, options: { autoUpdate?: boolean; updateInterval?: number }): Result {
    const profiles = this.store.get('profiles')
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return { success: false, error: '配置不存在' }
    if (!profile.url) return { success: false, error: '只有 URL 订阅配置支持自动更新' }
    this.store.set('profiles', profiles.map((item) => item.id === profileId ? {
      ...item,
      autoUpdate: options.autoUpdate ?? item.autoUpdate ?? false,
      updateInterval: Math.max(1, options.updateInterval ?? item.updateInterval ?? 12),
    } : item))
    return { success: true }
  }

  listDueAutoUpdateProfiles(now = Date.now()): ClashProfileRecord[] {
    return this.store.get('profiles').filter((profile) => {
      if (!profile.url || !profile.autoUpdate) return false
      const intervalMs = Math.max(1, profile.updateInterval || 12) * 60 * 60 * 1000
      const lastAttempt = profile.lastUpdateAttemptAt || profile.updatedAt
      return !lastAttempt || now - lastAttempt >= intervalMs
    })
  }

  async updateProfile(profileId: string): Promise<Result & { profile?: ClashProfile }> {
    const record = this.store.get('profiles').find((item) => item.id === profileId)
    if (!record) return { success: false, error: '配置不存在' }
    if (!record.url) return { success: false, error: '这个配置不是 URL 订阅，无法在线更新' }
    const profiles = this.store.get('profiles')
    const mark = (fields: Partial<ClashProfileRecord>): void => {
      this.store.set('profiles', profiles.map((item) => item.id === profileId ? { ...item, ...fields } : item))
    }
    mark({ lastUpdateAttemptAt: Date.now() })
    try {
      const content = await fetchText(record.url)
      const normalizedContent = normalizeClashSubscriptionContent(content)
      const validation = this.validateClashYaml(normalizedContent)
      if (!validation.success) {
        mark({ lastUpdateError: validation.error || '配置格式无效' })
        return validation
      }
      writeFileSync(join(this.profileDir(), record.fileName), normalizedContent, 'utf-8')
      mark({ updatedAt: Date.now(), lastUpdateError: null })
      return { success: true, profile: this.listProfiles().find((profile) => profile.id === profileId) }
    } catch (error) {
      const message = `订阅更新失败：${error instanceof Error ? error.message : String(error)}`
      mark({ lastUpdateError: message })
      return { success: false, error: message }
    }
  }

  deleteProfile(profileId: string): Result {
    if (profileId === DEFAULT_PROFILE_ID) return { success: false, error: '默认配置不能删除' }
    const profiles = this.store.get('profiles')
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return { success: false, error: '配置不存在' }
    try {
      const path = join(this.profileDir(), profile.fileName)
      if (existsSync(path)) unlinkSync(path)
    } catch { /* best effort */ }
    this.store.set('profiles', profiles.filter((item) => item.id !== profileId))
    if (this.store.get('activeProfileId') === profileId) this.store.set('activeProfileId', DEFAULT_PROFILE_ID)
    return { success: true }
  }

  async startProfile(profileId = DEFAULT_PROFILE_ID): Promise<Result & { pid?: number; profileId?: string }> {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (!profile) return { success: false, error: 'mihomo 核心定义不存在' }

    const applied = this.applyProfile(profileId)
    if (!applied.success) return applied

    const prepared = this.ensureControllerConfig()
    if (!prepared.success) return prepared

    const result = await this.proxyManager.start(profile.runtimeProxyId)
    if (!result.success) return result

    const ready = await this.waitForControllerReady(profile.runtimeProxyId)
    if (!ready.success) {
      await this.proxyManager.stop(profile.runtimeProxyId).catch(() => undefined)
      return ready
    }

    setSettings({ systemProxy: true })
    const proxyResult = await syncSystemProxy(this.proxyManager, true)
    if (!proxyResult.success) {
      await this.proxyManager.stop(profile.runtimeProxyId).catch(() => undefined)
      setSettings({ systemProxy: false })
      return { success: false, error: proxyResult.error || 'Windows 系统代理设置失败' }
    }

    this.store.set('activeProfileId', profileId)
    return { success: true, pid: result.pid, profileId }
  }

  async stop(): Promise<Result> {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (!profile) return { success: false, error: 'mihomo 核心定义不存在' }
    await this.proxyManager.stop(profile.runtimeProxyId).catch(() => undefined)
    setSettings({ systemProxy: false })
    await syncSystemProxy(this.proxyManager, true)
    return { success: true }
  }

  async getGroups(): Promise<ClashGroup[]> {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (profile && !this.proxyManager.getStatus(profile.runtimeProxyId)[0]?.running) return []
    const data = await this.request<{ proxies: Record<string, ClashProxy> }>('GET', '/proxies')
    const configuredGroupOrder = this.getConfiguredGroupOrder()
    const groupOrder = new Map(configuredGroupOrder.map((name, index) => [name, index]))
    return Object.values(data.proxies || {})
      .filter((proxy) => Array.isArray(proxy.all) && proxy.all.length > 0)
      .map((proxy) => ({ name: proxy.name, type: proxy.type, now: proxy.now || null, all: proxy.all || [] }))
      .sort((a, b) => {
        const ai = groupOrder.get(a.name)
        const bi = groupOrder.get(b.name)
        if (ai !== undefined && bi !== undefined) return ai - bi
        if (ai !== undefined) return -1
        if (bi !== undefined) return 1
        return 0
      })
  }

  async selectGroupProxy(groupName: string, proxyName: string): Promise<Result> {
    await this.request('PUT', `/proxies/${encodeURIComponent(groupName)}`, { name: proxyName })
    return { success: true }
  }

  async getConfig(): Promise<ClashRuntimeConfig> {
    const data = await this.request<{ mode?: string }>('GET', '/configs')
    return { mode: normalizeClashMode(data.mode) }
  }

  async setMode(mode: ClashMode): Promise<Result> {
    await this.request('PATCH', '/configs', { mode })
    return { success: true }
  }

  async testProxyDelay(proxyName: string): Promise<DelayResult> {
    const testTimeout = 8000
    const query = new URLSearchParams({ timeout: String(testTimeout), url: DELAY_TEST_URL })
    try {
      const data = await this.request<{ delay?: number }>(
        'GET',
        `/proxies/${encodeURIComponent(proxyName)}/delay?${query}`,
        undefined,
        { timeout: testTimeout + 3500 },
      )
      const delay = typeof data.delay === 'number' ? data.delay : -1
      return delay >= 0 ? { success: true, delay } : { success: false, delay: -1, error: '节点测速失败' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('请求超时')) return { success: false, delay: -1, error: '节点测速超时，请换一个节点或稍后重试' }
      if (message.includes('HTTP 408') || message.includes('HTTP 504')) return { success: false, delay: -1, error: '节点无响应，测速超时' }
      if (message.includes('ECONNREFUSED')) return { success: false, delay: -1, error: 'mihomo 控制接口不可用，请重新启动 Clash 模式' }
      return { success: false, delay: -1, error: `节点测速失败：${message}` }
    }
  }

  async getConnections(): Promise<ClashConnection[]> {
    const data = await this.request<{ connections?: ClashConnection[] }>('GET', '/connections')
    return data.connections || []
  }

  private applyProfile(profileId: string): Result {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (!profile) return { success: false, error: 'mihomo 核心定义不存在' }
    if (profileId === DEFAULT_PROFILE_ID) return { success: true }

    const record = this.store.get('profiles').find((item) => item.id === profileId)
    if (!record) return { success: false, error: 'Clash 配置不存在' }
    const source = join(this.profileDir(), record.fileName)
    if (!existsSync(source)) return { success: false, error: 'Clash 配置文件不存在' }

    const target = join(this.baseDir, profile.dir, profile.configFile)
    try {
      if (existsSync(target)) copyFileSync(target, `${target}.profile_backup`)
      copyFileSync(source, target)
      return { success: true }
    } catch (error) {
      return { success: false, error: `应用 Clash 配置失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private validateClashYaml(content: string): Result {
    try {
      const config = (yaml.load(content) || {}) as Record<string, unknown>
      const hasProxies = Array.isArray(config.proxies)
      const hasProviders = typeof config['proxy-providers'] === 'object' && config['proxy-providers'] !== null
      if (!hasProxies && !hasProviders) return { success: false, error: '配置中没有 proxies 或 proxy-providers' }
      return { success: true }
    } catch (error) {
      return { success: false, error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private ensureControllerConfig(): Result {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (!profile) return { success: false, error: 'mihomo 核心定义不存在' }
    const configPath = join(this.baseDir, profile.dir, profile.configFile)
    if (!existsSync(configPath)) return { success: false, error: `mihomo 配置文件不存在：${configPath}` }

    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = (yaml.load(raw) || {}) as Record<string, unknown>
      config['mixed-port'] = Number(config['mixed-port']) || profile.defaultHttpPort || 7890
      config['external-controller'] = `127.0.0.1:${profile.controllerPort || 9090}`
      config.secret = typeof config.secret === 'string' && config.secret.trim() ? config.secret : DEFAULT_SECRET
      config['allow-lan'] = false
      config.tun = buildTunConfig(config.tun, !!this.store.get('tunEnabled'))
      writeFileSync(configPath, yaml.dump(config, { lineWidth: 120, noRefs: true }), 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: `mihomo 配置准备失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private getConfiguredGroupOrder(): string[] {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    const configPath = profile ? join(this.baseDir, profile.dir, profile.configFile) : ''
    try {
      const config = (yaml.load(readFileSync(configPath, 'utf-8')) || {}) as Record<string, unknown>
      const groups = config['proxy-groups']
      if (!Array.isArray(groups)) return []
      return groups
        .map((group) => typeof group === 'object' && group !== null ? String((group as Record<string, unknown>).name || '') : '')
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private getController(): { host: string; port: number; secret: string } {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    const configPath = profile ? join(this.baseDir, profile.dir, profile.configFile) : ''
    let secret = DEFAULT_SECRET
    let port = profile?.controllerPort || 9090
    try {
      const config = yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
      if (typeof config.secret === 'string' && config.secret.trim()) secret = config.secret
      if (typeof config['external-controller'] === 'string') {
        const match = config['external-controller'].match(/:(\d+)$/)
        if (match) port = Number(match[1])
      }
    } catch { /* defaults */ }
    return { host: '127.0.0.1', port, secret }
  }

  private request<T = unknown>(method: string, path: string, body?: unknown, options: { timeout?: number } = {}): Promise<T> {
    const controller = this.getController()
    const payload = body === undefined ? null : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: controller.host,
        port: controller.port,
        path,
        method,
        timeout: options.timeout || 5000,
        headers: {
          Authorization: `Bearer ${controller.secret}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`mihomo 控制接口返回 HTTP ${res.statusCode}`))
            return
          }
          if (!data) resolve({} as T)
          else {
            try { resolve(JSON.parse(data) as T) } catch { resolve(data as T) }
          }
        })
      })
      req.on('error', (error) => reject(new Error(`mihomo 控制接口不可用：${error.message}`)))
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('mihomo 控制接口请求超时'))
      })
      if (payload) req.write(payload)
      req.end()
    })
  }

  private async waitForControllerReady(runtimeProxyId: string, timeout = 8000): Promise<Result> {
    const deadline = Date.now() + timeout
    let lastError = ''

    while (Date.now() < deadline) {
      const status = this.proxyManager.getStatus(runtimeProxyId)[0]
      if (!status?.running) {
        return { success: false, error: 'mihomo 核心启动后立即退出，请查看连接日志中的配置错误' }
      }

      try {
        await this.request('GET', '/version')
        return { success: true }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    return {
      success: false,
      error: lastError.includes('ECONNREFUSED')
        ? 'mihomo 控制接口未就绪，可能是配置无效、核心启动失败或 9090 端口不可用'
        : `mihomo 控制接口未就绪：${lastError || '请求超时'}`,
    }
  }

  private profileDir(): string {
    return join(app.getPath('userData'), 'clash-profiles')
  }

  private ensureProfileDir(): void {
    const dir = this.profileDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  private getDefaultConfigUpdatedAt(): number {
    const profile = getCoreProfile(MIHOMO_CORE_ID)
    if (!profile) return 0
    const configPath = join(this.baseDir, profile.dir, profile.configFile)
    return existsSync(configPath) ? Date.now() : 0
  }
}

async function fetchText(url: string): Promise<string> {
  try {
    return await fetchTextDirect(url)
  } catch (directError) {
    try {
      return await fetchTextViaLocalProxy(url)
    } catch (proxyError) {
      const directMessage = directError instanceof Error ? directError.message : String(directError)
      const proxyMessage = proxyError instanceof Error ? proxyError.message : String(proxyError)
      throw new Error(`直连失败：${directMessage}；本地代理更新也失败：${proxyMessage}`)
    }
  }
}

function fetchTextDirect(url: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('重定向次数过多'))
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('订阅链接格式无效'))
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`不支持的协议：${parsed.protocol}`))
      return
    }
    const client = parsed.protocol === 'http:' ? http : https
    const req = client.get(url, {
      headers: { 'User-Agent': 'KiNGO/1.0' },
      timeout: 10000,
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        const redirected = new URL(res.headers.location, url).toString()
        fetchTextDirect(redirected, redirectCount + 1).then(resolve).catch(reject)
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode || 0}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

function fetchTextViaLocalProxy(url: string): Promise<string> {
  const candidates = [
    { label: 'KiNGO/Clash 7890', args: ['--proxy', 'http://127.0.0.1:7890'] },
    { label: 'v2rayN Mixed 10808', args: ['--proxy', 'http://127.0.0.1:10808'] },
    { label: 'Mixed 10809', args: ['--proxy', 'http://127.0.0.1:10809'] },
    { label: 'SOCKS5 1080', args: ['--socks5-hostname', '127.0.0.1:1080'] },
  ]
  return candidates.reduce<Promise<string>>(
    (promise, candidate) => promise.catch(() => fetchTextWithCurl(url, candidate.args, candidate.label)),
    Promise.reject(new Error('未尝试本地代理')),
  )
}

function fetchTextWithCurl(url: string, proxyArgs: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-L',
      '--silent',
      '--show-error',
      '--max-time',
      '15',
      ...proxyArgs,
      '-A',
      'KiNGO/1.0',
      url,
    ]
    execFile('curl.exe', args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${label}: ${(stderr || error.message || '请求失败').trim()}`))
        return
      }
      if (!stdout || !stdout.trim()) {
        reject(new Error(`${label}: 返回空内容`))
        return
      }
      resolve(stdout)
    })
  })
}

function normalizeClashSubscriptionContent(content: string): string {
  const candidates = [content, decodeBase64Text(content)].filter((item): item is string => !!item && !!item.trim())
  for (const candidate of candidates) {
    if (looksLikeClashYaml(candidate)) return candidate
  }

  const lines = candidates
    .flatMap((candidate) => candidate.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
  const nodes = parseNodeUrls(lines)
  if (nodes.length === 0) return content
  return generateClashMetaConfigFromNodes(nodes)
}

function looksLikeClashYaml(content: string): boolean {
  try {
    const parsed = (yaml.load(content) || {}) as Record<string, unknown>
    return Array.isArray(parsed.proxies) || (typeof parsed['proxy-providers'] === 'object' && parsed['proxy-providers'] !== null)
  } catch {
    return false
  }
}

function decodeBase64Text(content: string): string | null {
  const cleaned = content.trim().replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!cleaned || cleaned.length % 4 === 1 || !/^[A-Za-z0-9+/]+=*$/.test(cleaned)) return null
  try {
    const padding = cleaned.length % 4
    const normalized = padding === 0 ? cleaned : cleaned + '='.repeat(4 - padding)
    const decoded = Buffer.from(normalized, 'base64').toString('utf-8')
    return /[\u0000-\u0008\u000E-\u001F]/.test(decoded) ? null : decoded
  } catch {
    return null
  }
}

function normalizeClashMode(mode: unknown): ClashMode {
  return mode === 'global' || mode === 'direct' || mode === 'rule' ? mode : 'rule'
}

function buildTunConfig(existing: unknown, enabled: boolean): Record<string, unknown> {
  const base = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  return {
    ...base,
    enable: enabled,
    stack: typeof base.stack === 'string' ? base.stack : 'system',
    'auto-route': typeof base['auto-route'] === 'boolean' ? base['auto-route'] : true,
    'auto-detect-interface': typeof base['auto-detect-interface'] === 'boolean' ? base['auto-detect-interface'] : true,
    'dns-hijack': Array.isArray(base['dns-hijack']) ? base['dns-hijack'] : ['any:53'],
  }
}

function isProbablyElevated(): boolean {
  if (process.platform !== 'win32') return true
  try {
    execFileSync('fltmc.exe', [], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

function makeTunReport(checks: TunDiagnosticCheck[]): TunDiagnosticReport {
  const failed = checks.filter((item) => item.status === 'fail')
  const warnings = checks.filter((item) => item.status === 'warn')
  if (failed.length > 0) {
    return {
      ready: false,
      summary: `TUN 当前不可用：${failed[0].message}`,
      checks,
    }
  }
  if (warnings.length > 0) {
    return {
      ready: true,
      summary: `TUN 基础条件可用，但需要注意：${warnings[0].message}`,
      checks,
    }
  }
  return {
    ready: true,
    summary: 'TUN 基础条件正常',
    checks,
  }
}
