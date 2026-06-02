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
  autoStart: boolean
  browserPath: string
  minimizeToTray: boolean
  theme: 'light' | 'dark'
  autoCheckUpdates: boolean
  updateMirror: string
}

interface SlotInfo {
  slot: number
  description: string
  downloaded: boolean
  active: boolean
}

interface ElectronAPI {
  startProxy: (proxyId: string) => Promise<{ success: boolean; pid?: number; error?: string }>
  stopProxy: (proxyId: string) => Promise<{ success: boolean; error?: string }>
  getProxyStatus: () => Promise<ProxyStatus[]>
  getConfig: (proxyId: string) => Promise<{ content: string; format: string; backupExists: boolean }>
  saveConfig: (proxyId: string, content: string) => Promise<{ success: boolean; error?: string }>
  restoreBackup: (proxyId: string) => Promise<{ success: boolean }>
  testLatency: (proxyId: string) => Promise<{ nodes: { host: string; port: number; latency: number }[] }>
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
  onStatusChanged: (callback: (status: ProxyStatus) => void) => void
  onLog: (callback: (entry: LogEntry) => void) => void
  onProxyUpdateProgress: (callback: (progress: { proxyId: string; slot: number; percent: number }) => void) => void
  onMaximizeChanged: (callback: (maximized: boolean) => void) => void
  onSettingsChanged: (callback: (settings: AppSettings) => void) => void
  onUpdateStatus: (callback: (data: { status: string }) => void) => void
  onUpdateAvailable: (callback: (data: { version: string; releaseDate?: string }) => void) => void
  onUpdateProgress: (callback: (data: { percent: number; transferred: number; total: number }) => void) => void
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => void
  onUpdateError: (callback: (data: { message: string }) => void) => void
  removeAllListeners: (channel: string) => void
}

interface Window {
  electronAPI: ElectronAPI
}
