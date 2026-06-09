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
}

interface SlotInfo {
  slot: number
  description: string
  downloaded: boolean
  active: boolean
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

interface SubInfo {
  id: string
  name: string
  url: string
  nodes: StoredNode[]
  lastUpdated: number | null
  autoUpdate: boolean
  updateInterval: number
}

interface ElectronAPI {
  startProxy: (proxyId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  stopProxy: (proxyId: string) => Promise<{ success: boolean; error?: string }>
  getProxyStatus: () => Promise<ProxyStatus[]>
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
  importNodeUrl: (url: string) => Promise<StoredNode | null>
  importNodeBatch: (urls: string[]) => Promise<StoredNode[]>
  listAllNodes: () => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
  deleteNodeOne: (nodeId: string, groupId: string) => Promise<void>
  deleteNodeMany: (nodeIds: string[], groupId: string) => Promise<void>
  listNodes: () => Promise<StoredNode[]>
  updateNode: (id: string, fields: Record<string, unknown>) => Promise<StoredNode | null>
  deleteNodes: (ids: string[]) => Promise<void>
  testNodeLatency: (ids: string[]) => Promise<{ id: string; latency: number }[]>
  getCompatibleCores: (protocol: string) => Promise<CompatibleCore[]>
  connectNode: (nodeId: string, coreId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  disconnectNode: (coreId: string) => Promise<{ success: boolean; error?: string }>
  getActiveConnection: () => Promise<ActiveConnection | null>
  listAllNodes: () => Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>>
  listSubscriptions: () => Promise<SubInfo[]>
  addSubscription: (name: string, url: string) => Promise<{ sub: SubInfo; diff: { added: number; removed: number; unchanged: number } | null; error?: string }>
  updateSubscription: (id: string) => Promise<{ added: number; removed: number; unchanged: number } | null>
  deleteSubscription: (id: string) => Promise<void>
  toggleAutoUpdate: (id: string, enabled: boolean) => Promise<void>
  onStatusChanged: (callback: (status: ProxyStatus) => void) => () => void
  onLog: (callback: (entry: LogEntry) => void) => () => void
  onProxyUpdateProgress: (callback: (progress: { proxyId: string; slot: number; percent: number }) => void) => () => void
  onMaximizeChanged: (callback: (maximized: boolean) => void) => () => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
  onUpdateStatus: (callback: (data: { status: string }) => void) => () => void
  onUpdateAvailable: (callback: (data: { version: string; releaseDate?: string }) => void) => () => void
  onUpdateProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => () => void
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => () => void
  onUpdateError: (callback: (data: { message: string }) => void) => () => void
}

interface Window {
  electronAPI: ElectronAPI
}
