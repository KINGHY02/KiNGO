import { EventEmitter } from 'events'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import * as net from 'net'
import * as yaml from 'js-yaml'
import Store from 'electron-store'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { ConfigService } from './config-service'
import { getAvailableSlots, switchSlot, updateConfig } from './ip-updater'
import { clearKingoSystemProxy, clearSystemProxy, syncSystemProxy } from './system-proxy'
import { getSettings, setSettings } from './settings-store'

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

export class PublicRouteService extends EventEmitter {
  private state: PublicConnectionState = {
    routeId: null,
    state: 'idle',
    stage: '等待连接',
    error: null,
    errorCode: null,
  }
  private intentionalStop = false
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
      this.recordFailure(route.id, '线路连接已中断')
      setSettings({ systemProxy: false })
      this.setState(route.id, 'failed', '连接已中断', '线路连接已中断，请尝试重新连接或更换线路', 'CORE_EXITED')
      clearSystemProxy()
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
    const routes = this.listRoutes()
    const settings = getSettings()
    const targetId = routeId
      || settings.selectedPublicRouteId
      || settings.lastSuccessfulRouteId
      || routes[0]?.id
    const route = routes.find((item) => item.id === targetId)
    if (!route) return { success: false, error: '没有可用的公共线路', errorCode: 'NO_ROUTES' }
    const def = PROXY_DEFINITIONS.find((item) => item.id === route.coreId)
    if (!def) return { success: false, error: '线路对应的运行组件不存在', errorCode: 'CORE_NOT_FOUND' }

    this.intentionalStop = true
    try {
      this.setState(route.id, 'preparing', '正在准备线路', null, null)
      clearSystemProxy()
      await this.stopRunningCores()

      if (!route.downloaded) {
        this.setState(route.id, 'preparing', '正在下载线路配置', null, null)
        const updated = await updateConfig(this.baseDir, def.dir, def.configFile, route.slot)
        if (!updated.success) throw new PublicRouteError('DOWNLOAD_FAILED', `线路配置下载失败：${updated.error || '未知错误'}`)
      }

      const switched = switchSlot(this.baseDir, def.dir, def.configFile, route.slot)
      if (!switched.success) throw new PublicRouteError('CONFIG_SWITCH_FAILED', `线路配置切换失败：${switched.error || '未知错误'}`)
      this.validateActiveConfig(def.id)

      this.setState(route.id, 'connecting', '正在建立连接', null, null)
      const started = await this.proxyManager.start(def.id)
      if (!started.success) {
        const code = started.error?.includes('端口') ? 'PORT_CONFLICT' : 'CORE_START_FAILED'
        throw new PublicRouteError(code, `线路运行组件未能启动：${started.error || '未知错误'}`)
      }

      const ready = await waitForPort(def.port, 8_000)
      if (!ready) {
        await this.proxyManager.stop(def.id).catch(() => undefined)
        throw new PublicRouteError('PORT_NOT_READY', '线路运行组件已启动，但本地连接端口未就绪')
      }

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
      const proxyStatus = this.proxyManager.getStatus(def.id)[0]
      if (!proxyStatus?.running) throw new PublicRouteError('CORE_EXITED', '线路在系统代理设置完成前意外停止')

      this.recordSuccess(route.id)
      this.setState(route.id, 'connected', '连接已建立', null, null)
      return { success: true, routeId: route.id, pid: started.pid }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errorCode = error instanceof PublicRouteError ? error.code : 'UNKNOWN'
      clearSystemProxy()
      setSettings({ systemProxy: false })
      this.recordFailure(route.id, message)
      this.setState(route.id, 'failed', '连接失败', message, errorCode)
      return { success: false, routeId: route.id, error: message, errorCode }
    } finally {
      this.intentionalStop = false
    }
  }

  async disconnect(): Promise<PublicRouteResult> {
    const routeId = this.state.routeId || undefined
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
