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
  // Public routes
  listPublicRoutes: () => ipcRenderer.invoke('public-route:list'),
  getPublicConnectionState: () => ipcRenderer.invoke('public-route:state'),
  selectPublicRoute: (routeId: string) => ipcRenderer.invoke('public-route:select', routeId),
  connectPublicRoute: (routeId?: string) => ipcRenderer.invoke('public-route:connect', routeId),
  disconnectPublicRoute: () => ipcRenderer.invoke('public-route:disconnect'),
  repairPublicNetwork: () => ipcRenderer.invoke('public-route:repair'),
  updatePublicRoute: (routeId: string) => ipcRenderer.invoke('public-route:update', routeId),
  updateAllPublicRoutes: () => ipcRenderer.invoke('public-route:update-all'),
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
  getNode: (id: string) => ipcRenderer.invoke('node:get', id),
  updateNode: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('node:update', id, fields),
  cloneNode: (id: string) => ipcRenderer.invoke('node:clone', id),
  deleteNodes: (ids: string[]) => ipcRenderer.invoke('node:delete', ids),
  testNodeLatency: (ids: string[]) => ipcRenderer.invoke('node:test-latency', ids),
  getCompatibleCores: (protocol: string) => ipcRenderer.invoke('node:compatible-cores', protocol),
  exportNodeClientConfig: (nodeId: string, coreId: string) => ipcRenderer.invoke('node:export-client-config', nodeId, coreId),
  connectNode: (nodeId: string, coreId: string) => ipcRenderer.invoke('node:connect', nodeId, coreId),
  disconnectNode: (coreId: string) => ipcRenderer.invoke('node:disconnect', coreId),
  getActiveConnection: () => ipcRenderer.invoke('node:get-active-connection'),
  listAllNodes: () => ipcRenderer.invoke('node:list-all'),
  deleteNodeOne: (nodeId: string, groupId: string) => ipcRenderer.invoke('node:delete-one', nodeId, groupId),
  deleteNodeMany: (nodeIds: string[], groupId: string) => ipcRenderer.invoke('node:delete-many', nodeIds, groupId),
  // Subscription management
  getSubscription: (id: string) => ipcRenderer.invoke('sub:get', id),
  listSubscriptions: () => ipcRenderer.invoke('sub:list'),
  addSubscription: (name: string, url: string) => ipcRenderer.invoke('sub:add', name, url),
  saveSubscription: (input: Record<string, unknown>) => ipcRenderer.invoke('sub:save', input),
  updateSubscription: (id: string) => ipcRenderer.invoke('sub:update', id),
  deleteSubscription: (id: string) => ipcRenderer.invoke('sub:delete', id),
  toggleAutoUpdate: (id: string, enabled: boolean) => ipcRenderer.invoke('sub:toggle-auto', id, enabled),
  toggleSubscriptionEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('sub:toggle-enabled', id, enabled),
  // Events �?each returns an unsubscribe function
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
  onPublicRouteStateChanged: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('public-route:state-changed', handler)
    return () => { ipcRenderer.removeListener('public-route:state-changed', handler) }
  },
  onPublicRoutesChanged: (callback: (routes: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, routes: unknown) => callback(routes)
    ipcRenderer.on('public-route:routes-changed', handler)
    return () => { ipcRenderer.removeListener('public-route:routes-changed', handler) }
  },
  onSubscriptionAutoUpdated: (callback: (result: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result)
    ipcRenderer.on('subscription:auto-updated', handler)
    return () => { ipcRenderer.removeListener('subscription:auto-updated', handler) }
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
  },
  // ProfileEx / Sort (V2rayN-style)
  profileSort: (colName: string, asc: boolean, groupId: string) => ipcRenderer.invoke('profile:sort', colName, asc, groupId),
  profileGetEx: (nodeId: string) => ipcRenderer.invoke('profile:get-ex', nodeId),
  profileListEx: () => ipcRenderer.invoke('profile:list-ex'),
  profileSetDelay: (nodeId: string, delay: number) => ipcRenderer.invoke('profile:set-delay', nodeId, delay),
  profileMove: (groupId: string, nodeIds: string[], direction: 'top' | 'up' | 'down' | 'bottom') => ipcRenderer.invoke('profile:move', groupId, nodeIds, direction),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
