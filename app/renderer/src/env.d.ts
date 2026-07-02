/// <reference types="vite/client" />

interface ProxyStatus {
  id: string
  name: string
  running: boolean
  pid: number | null
  port: number
  protocol: string
  localAddress: string
  latency: number | null
}

interface LogEntry {
  timestamp: number
  proxyId: string
  level: 'info' | 'warn' | 'error'
  message: string
}

type AppConnectionMode = 'none' | 'public-route' | 'clash' | 'v2rayn'

interface AppConnectionState {
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

interface AppSettings {
  systemProxy: boolean
  proxyMode: 'global' | 'rule'
  autoStart: boolean
  browserPath: string
  minimizeToTray: boolean
  theme: 'light' | 'dark' | 'pink' | 'blue'
  autoCheckUpdates: boolean
  updateMirror: string
  defaultCoreByProtocol: Record<string, string>
  lastSuccessfulRouteId: string | null
  selectedPublicRouteId: string | null
}

interface SlotInfo {
  slot: number
  description: string
  downloaded: boolean
  active: boolean
}

type PublicRouteConnectionState = 'idle' | 'preparing' | 'connecting' | 'connected' | 'disconnecting' | 'failed'

interface PublicRoute {
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

interface PublicConnectionState {
  routeId: string | null
  state: PublicRouteConnectionState
  stage: string
  error: string | null
  errorCode: PublicRouteErrorCode | null
}

type PublicRouteErrorCode =
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

interface PublicRouteResult {
  success: boolean
  routeId?: string
  pid?: number
  error?: string
  errorCode?: PublicRouteErrorCode
}

type PublicRouteDiagnosticStatus = 'pass' | 'warn' | 'fail'

interface PublicRouteDiagnosticCheck {
  key: string
  label: string
  status: PublicRouteDiagnosticStatus
  message: string
  detail?: string
}

interface PublicRouteDiagnosticReport {
  routeId: string | null
  routeName: string | null
  protocolLabel: string | null
  connected: boolean
  latency: number | null
  summary: string
  checks: PublicRouteDiagnosticCheck[]
}

interface CoreVersionInfo {
  proxyId: string
  name: string
  currentVersion: string | null
  latestVersion: string | null
  isOutdated: boolean
  error?: string
}

interface StoredNode {
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

interface ActiveConnection {
  nodeId: string
  groupId: string
  nodeName: string
  coreId: string
  pid: number | null
  connectedAt: number
}

interface CompatibleCore {
  id: string
  recommended: boolean
}

type CoreFamily = 'mihomo' | 'xray' | 'sing-box' | 'legacy'

interface CoreProfile {
  id: string
  name: string
  family: CoreFamily
  executable: string
  dir: string
  configFile: string
  configFormat: 'yaml' | 'json'
  defaultHttpPort?: number
  defaultSocksPort?: number
  controllerPort?: number
  supportsTun: boolean
  supportsSubscriptions: boolean
  supportsExternalController: boolean
  runtimeProxyId: string
  installed: boolean
}

interface ClashGroup {
  name: string
  type: string
  now: string | null
  all: string[]
}

interface ClashProfile {
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

interface ClashConnection {
  id: string
  metadata?: Record<string, unknown>
  upload?: number
  download?: number
  chains?: string[]
  rule?: string
  rulePayload?: string
  start?: string
}

interface TunDiagnosticCheck {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  detail?: string
}

interface TunDiagnosticReport {
  ready: boolean
  summary: string
  checks: TunDiagnosticCheck[]
}

interface SubInfo {
  id: string
  name: string
  url: string
  nodes: StoredNode[]
  rawConfig?: string | null
  lastUpdated: number | null
  lastUpdateAttemptAt?: number | null
  lastUpdateError?: string | null
  autoUpdate: boolean
  updateInterval: number
  enabled?: boolean
  moreUrl?: string
  userAgent?: string
  filter?: string
  convertTarget?: string
  memo?: string
  sort?: number
}

interface NodeGroupInfo {
  id: string
  name: string
  nodes: StoredNode[]
  sort: number
  createdAt: number
  updatedAt: number
}

interface ElectronAPI {
  startProxy: (proxyId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  stopProxy: (proxyId: string) => Promise<{ success: boolean; error?: string }>
  getProxyStatus: () => Promise<ProxyStatus[]>
  getAppConnectionState: () => Promise<AppConnectionState>
  disconnectAllConnections: () => Promise<{ success: boolean; error?: string }>
  getConfig: (proxyId: string) => Promise<{ content: string; format: string; backupExists: boolean }>
  saveConfig: (proxyId: string, content: string) => Promise<{ success: boolean; error?: string }>
  restoreBackup: (proxyId: string) => Promise<{ success: boolean }>
  testLatency: (proxyId: string) => Promise<{
    current: { host: string; port: number; latency: number }[]
    slots: { slot: number; description: string; nodes: { host: string; port: number; latency: number }[] }[]
  }>
  testRealLatency: (proxyId: string) => Promise<{ latency: number }>
  getSystemProxyStatus: () => Promise<{ enabled: boolean; server: string | null; pacUrl: string | null }>
  updateIP: (proxyId: string, slot: number) => Promise<{ success: boolean; error?: string }>
  getSlots: (proxyId: string) => Promise<SlotInfo[]>
  getCurrentSlot: (proxyId: string) => Promise<{ slot: number; description: string; updatedAt: string } | null>
  switchSlot: (proxyId: string, slot: number) => Promise<{ success: boolean; error?: string }>
  listPublicRoutes: () => Promise<PublicRoute[]>
  getPublicConnectionState: () => Promise<PublicConnectionState>
  selectPublicRoute: (routeId: string) => Promise<PublicRouteResult>
  connectPublicRoute: (routeId?: string) => Promise<PublicRouteResult>
  disconnectPublicRoute: () => Promise<PublicRouteResult>
  repairPublicNetwork: () => Promise<PublicRouteResult>
  diagnosePublicRoute: (routeId?: string) => Promise<PublicRouteDiagnosticReport>
  updatePublicRoute: (routeId: string) => Promise<PublicRouteResult>
  updateAllPublicRoutes: () => Promise<{ success: boolean; updated: number; failed: number }>
  launchChrome: () => Promise<{ success: boolean; error?: string }>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
  getLogs: (proxyId?: string, limit?: number) => Promise<LogEntry[]>
  clearLogs: () => Promise<{ success: boolean }>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  checkForUpdates: () => Promise<{ checking: boolean }>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  getAppVersion: () => Promise<string>
  setUpdateFeedURL: (url: string) => Promise<void>
  checkCoreVersions: () => Promise<CoreVersionInfo[]>
  listCoreProfiles: () => Promise<CoreProfile[]>
  startClashProfile: (profileId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  stopClash: () => Promise<{ success: boolean; error?: string }>
  getClashGroups: () => Promise<ClashGroup[]>
  getClashConfig: () => Promise<{ mode: 'rule' | 'global' | 'direct' }>
  setClashMode: (mode: 'rule' | 'global' | 'direct') => Promise<{ success: boolean; error?: string }>
  getClashRuntimeOptions: () => Promise<{ tunEnabled: boolean }>
  updateClashRuntimeOptions: (options: { tunEnabled?: boolean }) => Promise<{ success: boolean; error?: string }>
  diagnoseClashTun: () => Promise<TunDiagnosticReport>
  listClashProfiles: () => Promise<ClashProfile[]>
  saveClashProfile: (input: { id?: string; name: string; content: string }) => Promise<{ success: boolean; error?: string; profile?: ClashProfile }>
  saveClashProfileFromUrl: (input: { id?: string; name: string; url: string; autoUpdate?: boolean; updateInterval?: number }) => Promise<{ success: boolean; error?: string; profile?: ClashProfile }>
  updateClashProfile: (profileId: string) => Promise<{ success: boolean; error?: string; profile?: ClashProfile }>
  updateClashProfileOptions: (profileId: string, options: { autoUpdate?: boolean; updateInterval?: number }) => Promise<{ success: boolean; error?: string }>
  deleteClashProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  selectClashGroupProxy: (groupName: string, proxyName: string) => Promise<{ success: boolean; error?: string }>
  testClashProxyDelay: (proxyName: string) => Promise<{ success: boolean; delay: number; error?: string }>
  getClashConnections: () => Promise<ClashConnection[]>
  importNodeUrl: (url: string) => Promise<StoredNode | null>
  importNodeBatch: (urls: string[]) => Promise<StoredNode[]>
  listAllNodes: () => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
  deleteNodeOne: (nodeId: string, groupId: string) => Promise<void>
  deleteNodeMany: (nodeIds: string[], groupId: string) => Promise<void>
  listNodes: () => Promise<StoredNode[]>
  getNode: (id: string) => Promise<(StoredNode & { groupId: string }) | null>
  updateNode: (id: string, fields: Record<string, unknown>) => Promise<StoredNode | null>
  cloneNode: (id: string) => Promise<{ node: StoredNode; groupId: string } | null>
  deleteNodes: (ids: string[]) => Promise<void>
  testNodeLatency: (ids: string[]) => Promise<{ id: string; latency: number }[]>
  getCompatibleCores: (protocol: string) => Promise<CompatibleCore[]>
  exportNodeClientConfig: (nodeId: string, coreId: string) => Promise<{ success: boolean; content?: string; format?: 'yaml' | 'json'; error?: string }>
  connectNode: (nodeId: string, coreId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  disconnectNode: (coreId: string) => Promise<{ success: boolean; error?: string }>
  getActiveConnection: () => Promise<ActiveConnection | null>
  listAllNodes: () => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
  getSubscription: (id: string) => Promise<SubInfo | null>
  listSubscriptions: () => Promise<SubInfo[]>
  addSubscription: (name: string, url: string) => Promise<{ sub: SubInfo; diff: { added: number; removed: number; unchanged: number } | null; error?: string }>
  saveSubscription: (input: {
    id?: string
    name: string
    url: string
    autoUpdate?: boolean
    updateInterval?: number
    enabled?: boolean
    moreUrl?: string
    userAgent?: string
    filter?: string
    convertTarget?: string
    memo?: string
    refresh?: boolean
  }) => Promise<{ sub: SubInfo; error: string | null }>
  updateSubscription: (id: string) => Promise<{ added: number; removed: number; unchanged: number } | null>
  deleteSubscription: (id: string) => Promise<void>
  toggleAutoUpdate: (id: string, enabled: boolean) => Promise<void>
  toggleSubscriptionEnabled: (id: string, enabled: boolean) => Promise<void>
  listNodeGroups: () => Promise<NodeGroupInfo[]>
  createEmptyGroup: (name: string) => Promise<{ success: boolean; error?: string; group?: NodeGroupInfo }>
  renameGroup: (id: string, name: string) => Promise<{ success: boolean; error?: string }>
  deleteEmptyGroup: (id: string) => Promise<{ success: boolean; error?: string }>
  moveNodeGroup: (id: string, direction: 'up' | 'down') => Promise<{ success: boolean; error?: string }>
  moveNodesToGroup: (nodeIds: string[], targetGroupId: string) => Promise<{ success: boolean; error?: string; moved?: number; copied?: number }>
  onStatusChanged: (callback: (status: ProxyStatus) => void) => () => void
  onAppConnectionStateChanged: (callback: (state: AppConnectionState) => void) => () => void
  onLog: (callback: (entry: LogEntry) => void) => () => void
  onProxyUpdateProgress: (callback: (progress: { proxyId: string; slot: number; percent: number }) => void) => () => void
  onPublicRouteStateChanged: (callback: (state: PublicConnectionState) => void) => () => void
  onPublicRoutesChanged: (callback: (routes: PublicRoute[]) => void) => () => void
  onSubscriptionAutoUpdated: (callback: (result: {
    id: string
    name: string
    success: boolean
    diff?: { added: number; removed: number; unchanged: number } | null
    error?: string
  }) => void) => () => void
  onClashProfileAutoUpdated: (callback: (result: {
    id: string
    name: string
    success: boolean
    error?: string
  }) => void) => () => void
  onMaximizeChanged: (callback: (maximized: boolean) => void) => () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
  onUpdateStatus: (callback: (data: { status: string }) => void) => () => void
  onUpdateAvailable: (callback: (data: { version: string; releaseDate?: string }) => void) => () => void
  onUpdateProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void
  onUpdateError: (callback: (data: { message: string }) => void) => () => void
  profileSort: (colName: string, asc: boolean, groupId: string) => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
  profileGetEx: (nodeId: string) => Promise<{ nodeId: string; delay: number; sort: number; lastTested: number | null } | null>
  profileListEx: () => Promise<Array<{ nodeId: string; delay: number; sort: number; lastTested: number | null }>>
  profileSetDelay: (nodeId: string, delay: number) => Promise<{ success: boolean }>
  profileMove: (groupId: string, nodeIds: string[], direction: 'top' | 'up' | 'down' | 'bottom') => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
}

interface Window {
  electronAPI: ElectronAPI
}
