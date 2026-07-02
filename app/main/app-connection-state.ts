import { ProxyManager } from './proxy-manager'
import { PublicRouteService } from './public-route-service'
import { getActiveConnection } from './nodes-store'

export type AppConnectionMode = 'none' | 'public-route' | 'clash' | 'v2rayn'

export interface AppConnectionState {
  mode: AppConnectionMode
  connected: boolean
  busy: boolean
  coreId: string | null
  displayName: string | null
  detail: string | null
  latency: number | null
  stage: string
  error: string | null
}

const BUSY_PUBLIC_STATES = ['preparing', 'connecting', 'disconnecting']

export function getAppConnectionState(
  proxyManager: ProxyManager,
  publicRouteService: PublicRouteService,
): AppConnectionState {
  const publicState = publicRouteService.getState()
  const selectedRoute = publicRouteService.getSelectedRoute()
  const activeNode = getActiveConnection()
  const statuses = proxyManager.getStatus()
  const activeNodeStatus = activeNode ? statuses.find((item) => item.id === activeNode.coreId) : null
  const clashStatus = statuses.find((item) => item.id === 'clash-meta')
  const publicRouteStatus = selectedRoute ? statuses.find((item) => item.id === selectedRoute.coreId) : null

  if (publicState.state === 'connected') {
    return {
      mode: 'public-route',
      connected: true,
      busy: false,
      coreId: selectedRoute?.coreId || null,
      displayName: selectedRoute?.name || '公共线路',
      detail: selectedRoute?.protocolLabel || null,
      latency: publicRouteStatus?.latency ?? null,
      stage: publicState.stage,
      error: null,
    }
  }

  if (activeNode && activeNodeStatus?.running) {
    return {
      mode: 'v2rayn',
      connected: true,
      busy: false,
      coreId: activeNode.coreId,
      displayName: activeNode.nodeName,
      detail: activeNode.coreId,
      latency: activeNodeStatus.latency,
      stage: '已连接',
      error: null,
    }
  }

  if (clashStatus?.running) {
    return {
      mode: 'clash',
      connected: true,
      busy: false,
      coreId: 'clash-meta',
      displayName: 'Clash 模式',
      detail: 'mihomo',
      latency: clashStatus.latency,
      stage: '已连接',
      error: null,
    }
  }

  return {
    mode: 'none',
    connected: false,
    busy: BUSY_PUBLIC_STATES.includes(publicState.state),
    coreId: null,
    displayName: null,
    detail: null,
    latency: null,
    stage: publicState.state === 'failed' ? '连接失败' : '未连接',
    error: publicState.error,
  }
}
