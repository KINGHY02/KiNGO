import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Proxy management
  startProxy: (proxyId: string) => ipcRenderer.invoke('proxy:start', proxyId),
  stopProxy: (proxyId: string) => ipcRenderer.invoke('proxy:stop', proxyId),
  getProxyStatus: () => ipcRenderer.invoke('proxy:status'),
  // Config
  getConfig: (proxyId: string) => ipcRenderer.invoke('proxy:get-config', proxyId),
  saveConfig: (proxyId: string, content: string) => ipcRenderer.invoke('proxy:save-config', proxyId, content),
  restoreBackup: (proxyId: string) => ipcRenderer.invoke('proxy:restore-backup', proxyId),
  // Latency & IP update
  testLatency: (proxyId: string) => ipcRenderer.invoke('proxy:test-latency', proxyId),
  testRealLatency: (proxyId: string) => ipcRenderer.invoke('proxy:test-real-latency', proxyId),
  updateIP: (proxyId: string, slot: number) => ipcRenderer.invoke('proxy:update-ip', proxyId, slot),
  getSlots: (proxyId: string) => ipcRenderer.invoke('proxy:get-slots', proxyId),
  getCurrentSlot: (proxyId: string) => ipcRenderer.invoke('proxy:get-current-slot', proxyId),
  switchSlot: (proxyId: string, slot: number) => ipcRenderer.invoke('proxy:switch-slot', proxyId, slot),
  // Chrome
  launchChrome: () => ipcRenderer.invoke('chrome:launch'),
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:set', settings),
  getSystemProxyStatus: () => ipcRenderer.invoke('system-proxy:status'),
  // Logs
  getLogs: (proxyId?: string, limit?: number) => ipcRenderer.invoke('logs:get', proxyId, limit),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppVersion: () => ipcRenderer.invoke('updater:get-version'),
  setUpdateFeedURL: (url: string) => ipcRenderer.invoke('updater:set-feed-url', url),
  // Events
  onStatusChanged: (callback: (status: unknown) => void) => {
    ipcRenderer.on('proxy:status-changed', (_event, status) => callback(status))
  },
  onLog: (callback: (entry: unknown) => void) => {
    ipcRenderer.on('proxy:log', (_event, entry) => callback(entry))
  },
  onProxyUpdateProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on('proxy:update-progress', (_event, progress) => callback(progress))
  },
  onMaximizeChanged: (callback: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximize-changed', (_event, maximized) => callback(maximized))
  },
  onSettingsChanged: (callback: (settings: unknown) => void) => {
    ipcRenderer.on('settings:changed', (_event, settings) => callback(settings))
  },
  onUpdateStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater:status', (_event, data) => callback(data))
  },
  onUpdateAvailable: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater:available', (_event, data) => callback(data))
  },
  onUpdateProgress: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater:progress', (_event, data) => callback(data))
  },
  onUpdateDownloaded: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater:downloaded', (_event, data) => callback(data))
  },
  onUpdateError: (callback: (data: unknown) => void) => {
    ipcRenderer.on('updater:error', (_event, data) => callback(data))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
