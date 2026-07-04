import { EventEmitter } from 'events'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import * as net from 'net'
import * as yaml from 'js-yaml'
import Store from 'electron-store'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { ConfigService } from './config-service'
import { getAvailableSlots, switchSlot, updateConfig } from './ip-updater'
import { clearKingoSystemProxy, clearSystemProxy, getSystemProxyStatus, syncSystemProxy } from './system-proxy'
import { getSettings, setSettings } from './settings-store'
import { testRealLatencyDetailed } from './latency-tester'

export type PublicRouteConnectionState =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'failed'

export interface PublicRoute {
  id: string
  name: string
  coreId: string
  slot: number
  protocolLabel: string
  downloaded: boolean
  active: boolean
  connectionState: PublicRouteConnectionState
  lastSuccessAt: number | null
  lastError: string | null
}

export interface PublicConnectionState {
  routeId: string | null
  state: PublicRouteConnectionState
  stage: string
  error: string | null
  errorCode: PublicRouteErrorCode | null
}

export interface PublicRouteResult {
  success: boolean
  routeId?: string
  pid?: number
  error?: string
  errorCode?: PublicRouteErrorCode
}

export type PublicRouteDiagnosticStatus = 'pass' | 'warn' | 'fail'

export interface PublicRouteDiagnosticCheck {
  key: string
  label: string
  status: PublicRouteDiagnosticStatus
  message: string
  detail?: string
}

export interface PublicRouteDiagnosticReport {
  routeId: string | null
  routeName: string | null
  protocolLabel: string | null
  connected: boolean
  latency: number | null
  summary: string
  checks: PublicRouteDiagnosticCheck[]
}

export type PublicRouteErrorCode =
  | 'NO_ROUTES'
  | 'ROUTE_NOT_FOUND'
  | 'CORE_NOT_FOUND'
  | 'DOWNLOAD_FAILED'
  | 'CONFIG_SWITCH_FAILED'
  | 'CONFIG_INVALID'
  | 'PORT_CONFLICT'
  | 'CORE_START_FAILED'
  | 'PORT_NOT_READY'
  | 'SYSTEM_PROXY_FAILED'
  | 'CORE_EXITED'
  | 'CANCELLED'
  | 'UNKNOWN'

interface RouteMeta {
  routeId: string
  lastSuccessAt: number | null
  lastError: string | null
}

interface RouteMetaData {
  routes: RouteMeta[]
}

const PROTOCOL_LABELS: Record<string, string> = {
  'clash-meta': '通用',
  xray: 'VLESS',
  hysteria: 'Hysteria',
  hysteria2: 'Hysteria 2',
  singbox: 'Sing-Box',
  naiveproxy: 'Naive',
  juicity: 'Juicity',
  mieru: 'Mieru',
  shadowquic: 'ShadowQUIC',
}

interface AutoRouteCandidateResult {
  route: PublicRoute
  latency: number
}

export class PublicRouteService extends EventEmitter {
  private state: PublicConnectionState = {
    routeId: null,
    state: 'idle',
    stage: '等待连接',
    error: null,
    errorCode: null,
  }
  private intentionalStop = false
  private autoSelectCursor = Math.floor(Math.random() * 1000)
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private healthCheckFailures = 0
  private autoSwitching = false
  private excludedAutoRouteIds = new Set<string>()
  private connectRunId = 0
  private metaStore = new Store<RouteMetaData>({
    name: 'public-routes',
    defaults: { routes: [] },
  })

  constructor(
    private baseDir: string,
    private proxyManager: ProxyManager,
    private configService: ConfigService,
  ) {
    super()
    this.proxyManager.on('status-changed', (status) => {
      if (!this.state.routeId || status.running || this.state.state !== 'connected') return
      const route = this.findRoute(this.state.routeId)
      if (!route || route.coreId !== status.id || this.intentionalStop) return
      void this.handleConnectedRouteLost(route, 'Core process exited', 'CORE_EXITED')
      /*
      this.recordFailure(route.id, '线路连接已中断')
      void this.handleConnectedRouteLost(route, '线路运行组件已退出', 'CORE_EXITED')
      /*
      setSettings({ systemProxy: false })
      this.setState(route.id, 'failed', '连接已中断', '线路连接已中断，请尝试重新连接或更换线路', 'CORE_EXITED')
      clearSystemProxy()
      */
    })
  }

  listRoutes(): PublicRoute[] {
    const settings = getSettings()
    const selectedId = settings.selectedPublicRouteId || settings.lastSuccessfulRouteId
    const meta = new Map(this.metaStore.get('routes').map((item) => [item.routeId, item]))
    const routes: PublicRoute[] = []
    let index = 1

    for (const def of PROXY_DEFINITIONS) {
      for (const slot of getAvailableSlots(this.baseDir, def.dir)) {
        const id = `${def.id}:${slot.slot}`
        const routeMeta = meta.get(id)
        routes.push({
          id,
          name: `公共线路 ${String(index).padStart(2, '0')}`,
          coreId: def.id,
          slot: slot.slot,
          protocolLabel: PROTOCOL_LABELS[def.id] || def.name,
          downloaded: slot.downloaded,
          active: this.state.routeId === id && this.state.state === 'connected',
          connectionState: this.state.routeId === id ? this.state.state : 'idle',
          lastSuccessAt: routeMeta?.lastSuccessAt ?? null,
          lastError: routeMeta?.lastError ?? null,
        })
        index += 1
      }
    }

    if (!settings.selectedPublicRouteId && routes.length > 0) {
      setSettings({ selectedPublicRouteId: selectedId && routes.some((r) => r.id === selectedId) ? selectedId : routes[0].id })
    }
    return routes
  }

  getState(): PublicConnectionState {
    return { ...this.state }
  }

  selectRoute(routeId: string): PublicRouteResult {
    if (!this.findRoute(routeId)) return { success: false, error: '所选公共线路不存在', errorCode: 'ROUTE_NOT_FOUND' }
    setSettings({ selectedPublicRouteId: routeId })
    this.emit('routes-changed', this.listRoutes())
    return { success: true, routeId }
  }

  async connect(routeId?: string): Promise<PublicRouteResult> {
    const runId = ++this.connectRunId
    const routes = this.listRoutes()
    let route = routeId
      ? routes.find((item) => item.id === routeId)
      : await this.chooseBestRoute(routes, runId)
    if (!route) return { success: false, error: '没有可用的公共线路', errorCode: 'NO_ROUTES' }
    const def = PROXY_DEFINITIONS.find((item) => item.id === route.coreId)
    if (!def) return { success: false, error: '线路对应的运行组件不存在', errorCode: 'CORE_NOT_FOUND' }

    this.stopHealthMonitor()
    this.intentionalStop = true
    try {
      this.setState(route.id, 'preparing', '正在准备线路', null, null)
      clearSystemProxy()
      await this.stopRunningCores()
      this.ensureConnectActive(runId)

      if (!route.downloaded) {
        this.setState(route.id, 'preparing', '正在下载线路配置', null, null)
        const updated = await updateConfig(this.baseDir, def.dir, def.configFile, route.slot)
        this.ensureConnectActive(runId)
        if (!updated.success) throw new PublicRouteError('DOWNLOAD_FAILED', `线路配置下载失败：${updated.error || '未知错误'}`)
      }

      const switched = switchSlot(this.baseDir, def.dir, def.configFile, route.slot)
      if (!switched.success) throw new PublicRouteError('CONFIG_SWITCH_FAILED', `线路配置切换失败：${switched.error || '未知错误'}`)
      this.validateActiveConfig(def.id)
      this.ensureConnectActive(runId)

      this.setState(route.id, 'connecting', '正在建立连接', null, null)
      const started = await this.proxyManager.start(def.id)
      if (!started.success) {
        const code = started.error?.includes('端口') ? 'PORT_CONFLICT' : 'CORE_START_FAILED'
        throw new PublicRouteError(code, `线路运行组件未能启动：${started.error || '未知错误'}`)
      }

      this.ensureConnectActive(runId)

      const ready = await waitForPort(def.port, 8_000)
      if (!ready) {
        await this.proxyManager.stop(def.id).catch(() => undefined)
        throw new PublicRouteError('PORT_NOT_READY', '线路运行组件已启动，但本地连接端口未就绪')
      }

      this.ensureConnectActive(runId)

      setSettings({
        systemProxy: true,
        selectedPublicRouteId: route.id,
        lastSuccessfulRouteId: route.id,
      })
      const proxyResult = await syncSystemProxy(this.proxyManager, true)
      if (!proxyResult.success) {
        await this.proxyManager.stop(def.id).catch(() => undefined)
        throw new PublicRouteError('SYSTEM_PROXY_FAILED', proxyResult.error || 'Windows 系统代理设置失败')
      }
      this.ensureConnectActive(runId)

      const proxyStatus = this.proxyManager.getStatus(def.id)[0]
      if (!proxyStatus?.running) throw new PublicRouteError('CORE_EXITED', '线路在系统代理设置完成前意外停止')

      this.recordSuccess(route.id)
      this.setState(route.id, 'connected', '连接已建立', null, null)
      this.startHealthMonitor(route.id)
      return { success: true, routeId: route.id, pid: started.pid }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errorCode = error instanceof PublicRouteError ? error.code : 'UNKNOWN'
      clearSystemProxy()
      await this.stopRunningCores().catch(() => undefined)
      setSettings({ systemProxy: false })
      if (errorCode === 'CANCELLED') {
        this.setState(null, 'idle', '等待连接', null, null)
        return { success: false, routeId: route.id, error: message, errorCode }
      }
      this.recordFailure(route.id, message)
      this.setState(route.id, 'failed', '连接失败', message, errorCode)
      return { success: false, routeId: route.id, error: message, errorCode }
    } finally {
      this.intentionalStop = false
    }
  }

  async disconnect(): Promise<PublicRouteResult> {
    this.connectRunId += 1
    const routeId = this.state.routeId || undefined
    this.stopHealthMonitor()
    this.intentionalStop = true
    this.setState(routeId || null, 'disconnecting', '正在断开连接', null, null)
    clearSystemProxy()
    await this.stopRunningCores()
    setSettings({ systemProxy: false })
    this.setState(null, 'idle', '等待连接', null, null)
    this.intentionalStop = false
    return { success: true, routeId }
  }

  async repairNetwork(): Promise<PublicRouteResult> {
    const routeId = this.state.routeId || undefined
    this.stopHealthMonitor()
    this.intentionalStop = true
    this.setState(routeId || null, 'disconnecting', '正在恢复网络设置', null, null)
    await this.stopRunningCores()
    const cleared = clearKingoSystemProxy()
    setSettings({ systemProxy: false })
    this.setState(null, 'idle', '等待连接', null, null)
    this.intentionalStop = false
    return cleared
      ? { success: true, routeId }
      : { success: false, routeId, error: 'Windows 系统代理清理失败', errorCode: 'SYSTEM_PROXY_FAILED' }
  }

  async updateRoute(routeId: string): Promise<PublicRouteResult> {
    const route = this.findRoute(routeId)
    if (!route) return { success: false, error: '所选公共线路不存在', errorCode: 'ROUTE_NOT_FOUND' }
    const def = PROXY_DEFINITIONS.find((item) => item.id === route.coreId)
    if (!def) return { success: false, error: '线路对应的运行组件不存在', errorCode: 'CORE_NOT_FOUND' }
    const result = await updateConfig(this.baseDir, def.dir, def.configFile, route.slot)
    if (!result.success) return { success: false, routeId, error: `线路配置更新失败：${result.error || '未知错误'}`, errorCode: 'DOWNLOAD_FAILED' }
    const connectedRoute = this.state.state === 'connected' && this.state.routeId
      ? this.findRoute(this.state.routeId)
      : undefined
    if (connectedRoute?.coreId === route.coreId && connectedRoute.id !== route.id) {
      switchSlot(this.baseDir, def.dir, def.configFile, connectedRoute.slot)
    }
    this.emit('routes-changed', this.listRoutes())
    return { success: true, routeId }
  }

  async updateAll(): Promise<{ success: boolean; updated: number; failed: number }> {
    const routes = this.listRoutes()
    let updated = 0
    let failed = 0
    for (const route of routes) {
      const result = await this.updateRoute(route.id)
      if (result.success) updated += 1
      else failed += 1
    }
    return { success: failed === 0, updated, failed }
  }

  async diagnose(routeId?: string): Promise<PublicRouteDiagnosticReport> {
    const routes = this.listRoutes()
    const settings = getSettings()
    const targetId = routeId
      || this.state.routeId
      || settings.selectedPublicRouteId
      || settings.lastSuccessfulRouteId
      || routes[0]?.id
    const route = routes.find((item) => item.id === targetId) || null
    const checks: PublicRouteDiagnosticCheck[] = []

    const add = (check: PublicRouteDiagnosticCheck): void => {
      checks.push(check)
    }

    if (!route) {
      add({
        key: 'route',
        label: '线路选择',
        status: 'fail',
        message: '没有可用的公共线路',
        detail: '请先刷新公共线路列表，或检查项目目录中的核心配置。'
      })
      return {
        routeId: null,
        routeName: null,
        protocolLabel: null,
        connected: false,
        latency: null,
        summary: '暂时无法诊断：没有找到公共线路。',
        checks
      }
    }

    add({
      key: 'route',
      label: '线路选择',
      status: 'pass',
      message: `当前选择 ${route.name} · ${route.protocolLabel}`
    })

    const def = PROXY_DEFINITIONS.find((item) => item.id === route.coreId)
    if (!def) {
      add({
        key: 'core',
        label: '运行组件',
        status: 'fail',
        message: '线路对应的运行组件不存在',
        detail: `核心 ID：${route.coreId}`
      })
      return this.buildDiagnosticReport(route, checks, null)
    }

    const runtime = this.proxyManager.getRuntimePath(def.id)
    const executablePath = runtime?.executablePath || join(this.baseDir, def.dir, def.executable)
    const coreReady = !!runtime && runtime.source !== 'missing' && existsSync(executablePath)
    add({
      key: 'core',
      label: '运行组件',
      status: coreReady ? 'pass' : 'fail',
      message: coreReady ? `${def.name} 已就绪` : `${def.name} 程序文件缺失`,
      detail: runtime ? `${executablePath} (${runtime.source})` : executablePath
    })

    add({
      key: 'downloaded',
      label: '线路配置',
      status: route.downloaded ? 'pass' : 'warn',
      message: route.downloaded ? '配置缓存已存在' : '配置还未下载，连接时会自动尝试下载'
    })

    if (route.downloaded) {
      try {
        this.validateRouteConfig(route, def)
        add({
          key: 'config',
          label: '配置解析',
          status: 'pass',
          message: '该线路缓存配置可以读取'
        })
      } catch (error) {
        add({
          key: 'config',
          label: '配置解析',
          status: 'fail',
          message: '当前核心配置无法读取',
          detail: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const running = this.proxyManager.getStatus(def.id)[0]?.running === true
    add({
      key: 'process',
      label: '连接进程',
      status: running ? 'pass' : 'warn',
      message: running ? '线路运行组件正在运行' : '线路当前未运行'
    })

    const portReady = await waitForPort(def.port, 1200)
    add({
      key: 'port',
      label: '本地端口',
      status: portReady ? 'pass' : running ? 'fail' : 'warn',
      message: portReady
        ? `本地端口 127.0.0.1:${def.port} 已监听`
        : running
          ? `核心已运行，但端口 127.0.0.1:${def.port} 未就绪`
          : `端口 127.0.0.1:${def.port} 当前未监听`
    })

    const systemProxy = getSystemProxyStatus()
    const proxyEnabled = !!systemProxy.enabled || !!systemProxy.pacUrl
    add({
      key: 'system-proxy',
      label: '系统代理',
      status: proxyEnabled ? 'pass' : running ? 'fail' : 'warn',
      message: proxyEnabled ? 'Windows 系统代理已开启' : 'Windows 系统代理未开启',
      detail: systemProxy.pacUrl || systemProxy.server || undefined
    })

    let latency: number | null = null
    if (portReady) {
      const test = await testRealLatencyDetailed(def.port, def.protocol)
      latency = test.success ? test.latency : null
      add({
        key: 'proxy-chain',
        label: '代理链路',
        status: test.success ? 'pass' : 'fail',
        message: test.success ? `代理链路可用，响应约 ${test.latency}ms` : '代理链路测试失败',
        detail: test.error || `测试目标：${test.target}`
      })
    } else {
      add({
        key: 'proxy-chain',
        label: '代理链路',
        status: 'warn',
        message: '本地端口未就绪，暂时无法测试代理链路'
      })
    }

    return this.buildDiagnosticReport(route, checks, latency)
  }

  getSelectedRoute(): PublicRoute | null {
    const routes = this.listRoutes()
    const settings = getSettings()
    return routes.find((route) => route.id === settings.selectedPublicRouteId)
      || routes.find((route) => route.id === settings.lastSuccessfulRouteId)
      || routes[0]
      || null
  }

  private findRoute(routeId: string): PublicRoute | undefined {
    return this.listRoutes().find((route) => route.id === routeId)
  }

  private async chooseBestRoute(routes: PublicRoute[], runId?: number): Promise<PublicRoute | undefined> {
    const settings = getSettings()
    const availableRoutes = routes.filter((route) => !this.excludedAutoRouteIds.has(route.id))
    const fallback = availableRoutes.find((route) => route.id === settings.lastSuccessfulRouteId)
      || availableRoutes.find((route) => route.id === settings.selectedPublicRouteId)
      || availableRoutes[0]

    const downloaded = availableRoutes.filter((route) => route.downloaded)
    const orderedCandidates = this.uniqueRoutes([
      ...downloaded.filter((route) => route.id === settings.selectedPublicRouteId),
      ...downloaded.filter((route) => route.id === settings.lastSuccessfulRouteId),
      ...downloaded.filter((route) => route.lastSuccessAt),
      ...downloaded,
    ])
    const quickLimit = Math.max(1, Math.min(50, Math.floor(settings.publicRouteAutoSelectLimit || 8)))
    const candidates = settings.publicRouteAutoSelectMode === 'full'
      ? orderedCandidates
      : this.pickQuickCandidates(downloaded, settings.selectedPublicRouteId, settings.lastSuccessfulRouteId, quickLimit)

    if (candidates.length === 0) return fallback

    this.setState(null, 'preparing', '正在自动选择公共线路', null, null)
    clearSystemProxy()
    await this.stopRunningCores()
    if (runId !== undefined) this.ensureConnectActive(runId)

    const results: AutoRouteCandidateResult[] = []
    for (const candidate of candidates) {
      if (runId !== undefined) this.ensureConnectActive(runId)
      const result = await this.testRouteCandidate(candidate)
      if (result) results.push(result)
    }

    await this.stopRunningCores()
    if (runId !== undefined) this.ensureConnectActive(runId)

    const best = results.sort((a, b) => a.latency - b.latency)[0]
    return best?.route || fallback
  }

  private uniqueRoutes(routes: PublicRoute[]): PublicRoute[] {
    const seen = new Set<string>()
    return routes.filter((route) => {
      if (seen.has(route.id)) return false
      seen.add(route.id)
      return true
    })
  }

  private pickQuickCandidates(
    downloaded: PublicRoute[],
    selectedRouteId: string | null,
    lastSuccessfulRouteId: string | null,
    limit: number,
  ): PublicRoute[] {
    const pinned = this.uniqueRoutes([
      ...downloaded.filter((route) => route.id === selectedRouteId),
      ...downloaded.filter((route) => route.id === lastSuccessfulRouteId),
      ...downloaded.filter((route) => route.lastSuccessAt),
    ]).slice(0, Math.max(1, Math.min(limit, 3)))

    const pinnedIds = new Set(pinned.map((route) => route.id))
    const pool = downloaded.filter((route) => !pinnedIds.has(route.id))
    if (pool.length === 0) return pinned.slice(0, limit)

    const remaining = Math.max(0, limit - pinned.length)
    const start = this.autoSelectCursor % pool.length
    const rotated = [...pool.slice(start), ...pool.slice(0, start)].slice(0, remaining)
    this.autoSelectCursor += Math.max(1, remaining)

    return this.uniqueRoutes([...pinned, ...rotated]).slice(0, limit)
  }

  private async testRouteCandidate(route: PublicRoute): Promise<AutoRouteCandidateResult | null> {
    const def = PROXY_DEFINITIONS.find((item) => item.id === route.coreId)
    if (!def) return null

    try {
      this.setState(route.id, 'preparing', `正在测试 ${route.name}`, null, null)
      this.validateRouteConfig(route, def)

      const switched = switchSlot(this.baseDir, def.dir, def.configFile, route.slot)
      if (!switched.success) return null
      this.validateActiveConfig(def.id)

      const started = await this.proxyManager.start(def.id)
      if (!started.success) return null

      const ready = await waitForPort(def.port, 6_500)
      if (!ready) return null

      const test = await testRealLatencyDetailed(def.port, def.protocol, 3_500)
      return test.success ? { route, latency: test.latency } : null
    } catch {
      return null
    } finally {
      await this.proxyManager.stop(route.coreId).catch(() => undefined)
    }
  }

  private ensureConnectActive(runId: number): void {
    if (runId !== this.connectRunId) {
      throw new PublicRouteError('CANCELLED', '连接已取消')
    }
  }

  private validateActiveConfig(coreId: string): void {
    const def = PROXY_DEFINITIONS.find((item) => item.id === coreId)
    if (!def) throw new PublicRouteError('CORE_NOT_FOUND', '线路运行组件不存在')
    const path = join(this.baseDir, def.dir, def.configFile)
    if (!existsSync(path)) throw new PublicRouteError('CONFIG_INVALID', '线路配置文件不存在')
    const content = readFileSync(path, 'utf-8')
    try {
      if (def.configFormat === 'json') JSON.parse(content)
      else yaml.load(content)
    } catch {
      throw new PublicRouteError('CONFIG_INVALID', '线路配置文件格式无效')
    }
    if (!this.configService.readConfig(coreId, PROXY_DEFINITIONS)) {
      throw new PublicRouteError('CONFIG_INVALID', '线路配置无法读取')
    }
  }

  private validateRouteConfig(route: PublicRoute, def: typeof PROXY_DEFINITIONS[number]): void {
    const cachePath = join(this.baseDir, def.dir, 'ip_Update', `slot_${route.slot}_${def.configFile}`)
    const activePath = join(this.baseDir, def.dir, def.configFile)
    const path = existsSync(cachePath) ? cachePath : activePath
    if (!existsSync(path)) throw new PublicRouteError('CONFIG_INVALID', '线路配置文件不存在')
    const content = readFileSync(path, 'utf-8')
    try {
      if (def.configFormat === 'json') JSON.parse(content)
      else yaml.load(content)
    } catch {
      throw new PublicRouteError('CONFIG_INVALID', '线路配置文件格式无效')
    }
  }

  private async stopRunningCores(): Promise<void> {
    for (const status of this.proxyManager.getStatus().filter((item) => item.running)) {
      await this.proxyManager.stop(status.id).catch(() => undefined)
    }
  }

  private setState(
    routeId: string | null,
    state: PublicRouteConnectionState,
    stage: string,
    error: string | null,
    errorCode: PublicRouteErrorCode | null,
  ): void {
    this.state = { routeId, state, stage, error, errorCode }
    this.emit('state-changed', this.getState())
    this.emit('routes-changed', this.listRoutes())
  }

  private startHealthMonitor(routeId: string): void {
    this.stopHealthMonitor()
    const settings = getSettings()
    if (!settings.publicRouteAutoSwitch) return

    const intervalMs = Math.max(10, Math.min(300, settings.publicRouteHealthCheckInterval || 30)) * 1000
    this.healthCheckFailures = 0
    this.healthCheckTimer = setInterval(() => {
      void this.checkConnectedRouteHealth(routeId)
    }, intervalMs)
  }

  private stopHealthMonitor(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer)
    this.healthCheckTimer = null
    this.healthCheckFailures = 0
  }

  private async checkConnectedRouteHealth(routeId: string): Promise<void> {
    if (this.autoSwitching || this.intentionalStop) return
    if (this.state.state !== 'connected' || this.state.routeId !== routeId) return

    const settings = getSettings()
    if (!settings.publicRouteAutoSwitch) {
      this.stopHealthMonitor()
      return
    }

    const route = this.findRoute(routeId)
    const def = route ? PROXY_DEFINITIONS.find((item) => item.id === route.coreId) : undefined
    if (!route || !def) return

    const test = await testRealLatencyDetailed(def.port, def.protocol, 5_000)
    if (test.success) {
      this.healthCheckFailures = 0
      return
    }

    this.healthCheckFailures += 1
    const threshold = Math.max(1, Math.min(10, settings.publicRouteHealthCheckFailures || 3))
    if (this.healthCheckFailures < threshold) return

    await this.handleConnectedRouteLost(route, test.error || 'Proxy health check failed', 'UNKNOWN')
  }

  private async handleConnectedRouteLost(
    route: PublicRoute,
    reason: string,
    errorCode: PublicRouteErrorCode,
  ): Promise<void> {
    if (this.autoSwitching || this.intentionalStop) return
    this.stopHealthMonitor()
    this.recordFailure(route.id, reason)

    const settings = getSettings()
    if (!settings.publicRouteAutoSwitch) {
      setSettings({ systemProxy: false })
      this.setState(route.id, 'failed', '连接已中断', reason, errorCode)
      clearSystemProxy()
      return
    }

    this.autoSwitching = true
    this.excludedAutoRouteIds.add(route.id)
    this.setState(route.id, 'connecting', '当前线路不可用，正在自动切换', null, null)

    try {
      const result = await this.connect()
      if (!result.success) {
        setSettings({ systemProxy: false })
        this.setState(route.id, 'failed', '自动切换失败', result.error || reason, result.errorCode || errorCode)
      }
    } finally {
      this.excludedAutoRouteIds.delete(route.id)
      this.autoSwitching = false
    }
  }

  private recordSuccess(routeId: string): void {
    this.updateMeta(routeId, { lastSuccessAt: Date.now(), lastError: null })
  }

  private recordFailure(routeId: string, error: string): void {
    this.updateMeta(routeId, { lastError: error })
  }

  private updateMeta(routeId: string, fields: Partial<RouteMeta>): void {
    const routes = this.metaStore.get('routes')
    const index = routes.findIndex((item) => item.routeId === routeId)
    if (index >= 0) routes[index] = { ...routes[index], ...fields }
    else routes.push({ routeId, lastSuccessAt: null, lastError: null, ...fields })
    this.metaStore.set('routes', routes)
  }

  private buildDiagnosticReport(
    route: PublicRoute,
    checks: PublicRouteDiagnosticCheck[],
    latency: number | null,
  ): PublicRouteDiagnosticReport {
    const failed = checks.filter((check) => check.status === 'fail')
    const warned = checks.filter((check) => check.status === 'warn')
    const connected = this.state.state === 'connected' && this.state.routeId === route.id
    let summary = '诊断完成，当前线路看起来正常。'
    if (failed.length > 0) summary = `诊断发现 ${failed.length} 个需要处理的问题。`
    else if (warned.length > 0) summary = `诊断完成，有 ${warned.length} 个项目需要留意。`

    return {
      routeId: route.id,
      routeName: route.name,
      protocolLabel: route.protocolLabel,
      connected,
      latency,
      summary,
      checks
    }
  }
}

class PublicRouteError extends Error {
  constructor(public code: PublicRouteErrorCode, message: string) {
    super(message)
    this.name = 'PublicRouteError'
  }
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    let completed = false
    const finish = (result: boolean): void => {
      if (completed) return
      completed = true
      resolve(result)
    }
    const tryConnect = (): void => {
      if (completed) return
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.setTimeout(700)
      socket.once('connect', () => {
        socket.destroy()
        finish(true)
      })
      let retryScheduled = false
      const retry = (): void => {
        if (retryScheduled || completed) return
        retryScheduled = true
        socket.destroy()
        if (Date.now() >= deadline) finish(false)
        else setTimeout(tryConnect, 250)
      }
      socket.once('error', retry)
      socket.once('timeout', retry)
    }
    tryConnect()
  })
}
