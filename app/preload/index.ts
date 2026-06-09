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
  // Core version check
  checkCoreVersions: () => ipcRenderer.invoke('core:check-versions'),
  // Node management
  importNodeUrl: (url: string) => ipcRenderer.invoke('node:import-url', url),
  importNodeBatch: (urls: string[]) => ipcRenderer.invoke('node:import-batch', urls),
  listNodes: () => ipcRenderer.invoke('node:list'),
  updateNode: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('node:update', id, fields),
  deleteNodes: (ids: string[]) => ipcRenderer.invoke('node:delete', ids),
  testNodeLatency: (ids: string[]) => ipcRenderer.invoke('node:test-latency', ids),
  getCompatibleCores: (protocol: string) => ipcRenderer.invoke('node:compatible-cores', protocol),
  connectNode: (nodeId: string, coreId: string) => ipcRenderer.invoke('node:connect', nodeId, coreId),
  disconnectNode: (coreId: string) => ipcRenderer.invoke('node:disconnect', coreId),
  getActiveConnection: () => ipcRenderer.invoke('node:get-active-connection'),
  listAllNodes: () => ipcRenderer.invoke('node:list-all'),
  deleteNodeOne: (nodeId: string, groupId: string) => ipcRenderer.invoke('node:delete-one', nodeId, groupId),
  deleteNodeMany: (nodeIds: string[], groupId: string) => ipcRenderer.invoke('node:delete-many', nodeIds, groupId),
  // Subscription management
  listSubscriptions: () => ipcRenderer.invoke('sub:list'),
  addSubscription: (name: string, url: string) => ipcRenderer.invoke('sub:add', name, url),
  updateSubscription: (id: string) => ipcRenderer.invoke('sub:update', id),
  deleteSubscription: (id: string) => ipcRenderer.invoke('sub:delete', id),
  toggleAutoUpdate: (id: string, enabled: boolean) => ipcRenderer.invoke('sub:toggle-auto', id, enabled),
  // Events — each returns an unsubscribe function
  onStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on('proxy:status-changed', handler)
    return () => { ipcRenderer.removeListener('proxy:status-changed', handler) }
  },
  onLog: (callback: (entry: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => callback(entry)
    ipcRenderer.on('proxy:log', handler)
    return () => { ipcRenderer.removeListener('proxy:log', handler) }
  },
  onProxyUpdateProgress: (callback: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress)
    ipcRenderer.on('proxy:update-progress', handler)
    return () => { ipcRenderer.removeListener('proxy:update-progress', handler) }
  },
  onMaximizeChanged: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window:maximize-changed', handler)
    return () => { ipcRenderer.removeListener('window:maximize-changed', handler) }
  },
  onSettingsChanged: (callback: (settings: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown) => callback(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => { ipcRenderer.removeListener('settings:changed', handler) }
  },
  onUpdateStatus: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('updater:status', handler)
    return () => { ipcRenderer.removeListener('updater:status', handler) }
  },
  onUpdateAvailable: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('updater:available', handler)
    return () => { ipcRenderer.removeListener('updater:available', handler) }
  },
  onUpdateProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('updater:progress', handler)
    return () => { ipcRenderer.removeListener('updater:progress', handler) }
  },
  onUpdateDownloaded: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('updater:downloaded', handler)
    return () => { ipcRenderer.removeListener('updater:downloaded', handler) }
  },
  onUpdateError: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('updater:error', handler)
    return () => { ipcRenderer.removeListener('updater:error', handler) }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
