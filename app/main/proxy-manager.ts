import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { testRealLatency } from './latency-tester'

export interface ProxyDefinition {
  id: string
  name: string
  dir: string
  executable: string
  args: string[]
  configFile: string
  configFormat: 'yaml' | 'json'
  port: number
  protocol: 'http' | 'socks5'
}

export interface ProxyStatus {
  id: string
  name: string
  running: boolean
  pid: number | null
  port: number
  protocol: string
  localAddress: string
  latency: number | null
}

export const PROXY_DEFINITIONS: ProxyDefinition[] = [
  {
    id: 'clash-meta', name: 'Clash.Meta', dir: 'clash.meta',
    executable: 'clash.meta-windows-386.exe', args: ['-d', '{configDir}'],
    configFile: 'config.yaml', configFormat: 'yaml',
    port: 7890, protocol: 'http'
  },
  {
    id: 'xray', name: 'Xray (VLESS+REALITY)', dir: 'Xray',
    executable: 'xray.exe', args: ['-c', '{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'hysteria', name: 'Hysteria v1', dir: 'hysteria',
    executable: 'hysteria-tun-windows-6.0-386.exe', args: ['-c', '{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'hysteria2', name: 'Hysteria v2', dir: 'hysteria2',
    executable: 'hysteria2.exe', args: ['-c', '{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'singbox', name: 'Sing-Box', dir: 'singbox',
    executable: 'sing-box.exe', args: ['run', '-c', '{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'naiveproxy', name: 'NaiveProxy', dir: 'naiveproxy',
    executable: 'naive.exe', args: ['{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'juicity', name: 'Juicity', dir: 'juicity',
    executable: 'juicity-client.exe', args: ['run', '-c', '{configPath}'],
    configFile: 'config.json', configFormat: 'json',
    port: 1080, protocol: 'socks5'
  },
  {
    id: 'mieru', name: 'Mieru', dir: 'mieru',
    executable: 'mieru.exe', args: ['start'],
    configFile: 'config.json', configFormat: 'json',
    port: 3080, protocol: 'socks5'
  },
  {
    id: 'shadowquic', name: 'ShadowQUIC', dir: 'shadowquic',
    executable: 'shadowquic.exe', args: ['-c', '{configPath}'],
    configFile: 'client.yaml', configFormat: 'yaml',
    port: 4080, protocol: 'socks5'
  }
]

export class ProxyManager extends EventEmitter {
  private processes = new Map<string, ChildProcess>()
  private statuses = new Map<string, ProxyStatus>()
  private latencyTimers = new Map<string, ReturnType<typeof setInterval>>()
  private baseDir: string

  constructor(baseDir: string) {
    super()
    this.baseDir = baseDir
    for (const def of PROXY_DEFINITIONS) {
      this.statuses.set(def.id, {
        id: def.id,
        name: def.name,
        running: false,
        pid: null,
        port: def.port,
        protocol: def.protocol,
        localAddress: `127.0.0.1:${def.port}`,
        latency: null
      })
    }
    // cleanup on exit
    app.on('before-quit', () => this.stopAll())
    process.on('exit', () => this.stopAll())
  }

  getDef(proxyId: string): ProxyDefinition | undefined {
    return PROXY_DEFINITIONS.find((d) => d.id === proxyId)
  }

  getAllDefs(): ProxyDefinition[] {
    return PROXY_DEFINITIONS
  }

  getStatus(proxyId?: string): ProxyStatus[] {
    if (proxyId) {
      const s = this.statuses.get(proxyId)
      return s ? [s] : []
    }
    return Array.from(this.statuses.values())
  }

  async start(proxyId: string): Promise<{ success: boolean; pid?: number; error?: string }> {
    const def = this.getDef(proxyId)
    if (!def) return { success: false, error: `未知代理: ${proxyId}` }

    // Check if already running
    if (this.processes.has(proxyId)) {
      return { success: false, error: '代理已在运行中' }
    }

    // Check port conflict and auto-stop conflicting proxy
    for (const [id, proc] of this.processes) {
      const otherDef = this.getDef(id)
      if (otherDef && otherDef.port === def.port) {
        await this.stop(id)
      }
    }

    const proxyDir = join(this.baseDir, def.dir)
    const exePath = join(proxyDir, def.executable)
    const configPath = join(proxyDir, def.configFile)

    // Build args by replacing placeholders
    const args = def.args.map((arg) =>
      arg.replace('{configDir}', proxyDir).replace('{configPath}', configPath)
    )

    // Mieru special: run "apply config" first, then "start"
    if (proxyId === 'mieru') {
      try {
        await this.spawnAndWait(exePath, ['apply', 'config', configPath], proxyDir)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: `Mieru config apply 失败: ${msg}` }
      }
    }

    try {
      const proc = spawn(exePath, args, {
        cwd: proxyDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      this.processes.set(proxyId, proc)
      this.updateStatus(proxyId, { running: true, pid: proc.pid ?? null })

      proc.stdout?.on('data', (data: Buffer) => {
        this.emit('log', proxyId, data.toString(), 'info')
      })

      proc.stderr?.on('data', (data: Buffer) => {
        this.emit('log', proxyId, data.toString(), 'info')
      })

      proc.on('error', (err) => {
        this.emit('log', proxyId, `进程错误: ${err.message}`, 'error')
        this.updateStatus(proxyId, { running: false, pid: null })
        this.processes.delete(proxyId)
      })

      proc.on('close', (code) => {
        this.emit('log', proxyId, `进程退出，代码: ${code}`, code === 0 ? 'info' : 'error')
        this.updateStatus(proxyId, { running: false, pid: null })
        this.processes.delete(proxyId)
      })

      this.emit('log', proxyId, `启动成功，PID: ${proc.pid}`, 'info')

      // Auto-test real latency 2s after proxy starts
      setTimeout(() => this.runLatencyTest(proxyId), 2000)

      return { success: true, pid: proc.pid ?? undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  async stop(proxyId: string): Promise<{ success: boolean; error?: string }> {
    const proc = this.processes.get(proxyId)
    if (!proc || !proc.pid) {
      return { success: false, error: '代理未运行' }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
        this.cleanup(proxyId)
        resolve({ success: true })
      }, 5000)

      proc.once('close', () => {
        clearTimeout(timeout)
        this.cleanup(proxyId)
        resolve({ success: true })
      })

      try { proc.kill('SIGTERM') } catch { /* ignore */ }
    })
  }

  stopAll(): void {
    for (const [id] of this.processes) {
      this.stop(id)
    }
  }

  private async runLatencyTest(proxyId: string): Promise<void> {
    const def = this.getDef(proxyId)
    if (!def) return

    const latency = await testRealLatency(def.port)
    this.updateStatus(proxyId, { latency })

    // Schedule periodic re-test every 30s while running
    if (latency >= 0 && this.processes.has(proxyId)) {
      const existing = this.latencyTimers.get(proxyId)
      if (existing) clearInterval(existing)
      this.latencyTimers.set(proxyId, setInterval(async () => {
        if (!this.processes.has(proxyId)) {
          const timer = this.latencyTimers.get(proxyId)
          if (timer) { clearInterval(timer); this.latencyTimers.delete(proxyId) }
          return
        }
        const newLatency = await testRealLatency(def.port)
        this.updateStatus(proxyId, { latency: newLatency })
      }, 30_000))
    }
  }

  private spawnAndWait(exePath: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(exePath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`exit code ${code}`))
      })
      proc.on('error', reject)
    })
  }

  private cleanup(proxyId: string): void {
    this.processes.delete(proxyId)
    // Clear latency timer
    const timer = this.latencyTimers.get(proxyId)
    if (timer) { clearInterval(timer); this.latencyTimers.delete(proxyId) }
    this.updateStatus(proxyId, { running: false, pid: null, latency: null })
  }

  updateStatus(proxyId: string, partial: Partial<ProxyStatus>): void {
    const current = this.statuses.get(proxyId)
    if (current) {
      Object.assign(current, partial)
      this.emit('status-changed', current)
    }
  }
}
