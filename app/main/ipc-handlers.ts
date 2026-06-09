import { ipcMain, BrowserWindow } from 'electron'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { ConfigService } from './config-service'
import { LogService } from './log-service'
import { getSettings, setSettings, AppSettings } from './settings-store'
import { testProxyNodes, testRealLatency } from './latency-tester'
import { launchChrome } from './chrome-launcher'
import { getSystemProxyStatus, syncSystemProxy, clearSystemProxy } from './system-proxy'
import { getAvailableSlots, updateConfig, getCurrentSlot, switchSlot } from './ip-updater'
import { checkForUpdates, downloadUpdate, installUpdate, getAppVersion, setUpdateFeedURL } from './updater'
import { checkAllVersions } from './core-version'
import { parseNodeUrl, parseNodeUrls, StoredNode } from './protocol-parser'
import { generateConfig, compatibleCores } from './config-generator'
import { listNodes, addNode, addNodes, updateNode, deleteNodes, deleteSubscriptionNode, deleteSubscriptionNodes, updateNodeLatency, findNodeById, getAllNodes, getActiveConnection, setActiveConnection, listSubscriptions } from './nodes-store'
import { createSubscription, updateSubscriptionNodes, updateSubscription, deleteSubscription } from './subscription-service'

export function registerIpcHandlers(
  proxyManager: ProxyManager,
  configService: ConfigService,
  logService: LogService,
  baseDir: string
): void {
  const mainWindow = (): BrowserWindow => BrowserWindow.getAllWindows()[0]
  const publishSettings = (): void => {
    const win = mainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', getSettings())
    }
  }

  const enableSystemProxySetting = (): void => {
    if (!getSettings().systemProxy) {
      setSettings({ systemProxy: true })
      publishSettings()
    }
  }

  // Proxy start/stop/status
  ipcMain.handle('proxy:start', async (_e, proxyId: string) => {
    const result = await proxyManager.start(proxyId)
    if (result.success) {
      enableSystemProxySetting()
      syncSystemProxy(proxyManager, true)
    }
    return result
  })

  ipcMain.handle('proxy:stop', async (_e, proxyId: string) => {
    const result = await proxyManager.stop(proxyId)
    syncSystemProxy(proxyManager, true)
    return result
  })

  ipcMain.handle('proxy:status', () => {
    return proxyManager.getStatus()
  })

  // Config
  ipcMain.handle('proxy:get-config', (_e, proxyId: string) => {
    return configService.readConfig(proxyId, PROXY_DEFINITIONS)
  })

  ipcMain.handle('proxy:save-config', (_e, proxyId: string, content: string) => {
    return configService.writeConfig(proxyId, content, PROXY_DEFINITIONS)
  })

  ipcMain.handle('proxy:restore-backup', (_e, proxyId: string) => {
    return configService.restoreBackup(proxyId, PROXY_DEFINITIONS)
  })

  // Latency test
  ipcMain.handle('proxy:test-latency', async (_e, proxyId: string) => {
    // Test current active config
    const currentServers = configService.extractServerInfo(proxyId, PROXY_DEFINITIONS)
    const currentNodes = await testProxyNodes(currentServers, true)

    // Test all downloaded slot configs
    const slotServers = configService.extractAllSlotServers(proxyId, PROXY_DEFINITIONS)
    const slotResults = await Promise.all(
      slotServers.map(async (s) => ({
        slot: s.slot,
        description: s.description,
        nodes: await testProxyNodes(s.servers, true)
      }))
    )

    return { current: currentNodes, slots: slotResults }
  })

  // Real latency test through running local proxy
  ipcMain.handle('proxy:test-real-latency', async (_e, proxyId: string) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return { latency: -1 }
    const latency = await testRealLatency(def.port)
    // Also update the proxy status so dashboard picks it up
    proxyManager.updateStatus(proxyId, { latency: latency >= 0 ? latency : null })
    return { latency }
  })

  // IP update
  ipcMain.handle('proxy:update-ip', async (_e, proxyId: string, slot: number) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return { success: false, error: '未知代理' }
    return updateConfig(baseDir, def.dir, def.configFile, slot)
  })

  ipcMain.handle('proxy:get-slots', (_e, proxyId: string) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return []
    return getAvailableSlots(baseDir, def.dir)
  })

  ipcMain.handle('proxy:get-current-slot', (_e, proxyId: string) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return null
    return getCurrentSlot(baseDir, def.dir)
  })

  ipcMain.handle('proxy:switch-slot', async (_e, proxyId: string, slot: number) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return { success: false, error: '未知代理' }
    return switchSlot(baseDir, def.dir, def.configFile, slot)
  })

  // Chrome launch
  ipcMain.handle('chrome:launch', async () => {
    return launchChrome(baseDir, proxyManager)
  })

  // Settings
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', (_e, settings: Partial<AppSettings>) => {
    setSettings(settings)
    const updated = getSettings()
    mainWindow().webContents.send('settings:changed', updated)
    if (settings.updateMirror !== undefined) {
      setUpdateFeedURL(settings.updateMirror)
    }
    // Re-apply system proxy if relevant settings changed
    if ('systemProxy' in settings || 'proxyMode' in settings) {
      syncSystemProxy(proxyManager)
    }
    return { success: true }
  })

  // System proxy
  ipcMain.handle('system-proxy:status', () => {
    return getSystemProxyStatus()
  })

  // Logs
  ipcMain.handle('logs:get', (_e, proxyId?: string, limit?: number) => {
    return logService.getLogs(proxyId, limit)
  })

  ipcMain.handle('logs:clear', () => {
    logService.clear()
    return { success: true }
  })

  // Window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow().minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const win = mainWindow()
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    mainWindow().close()
  })

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow().isMaximized()
  })

  // Updater
  ipcMain.handle('updater:check', async () => {
    return checkForUpdates()
  })

  ipcMain.handle('updater:download', async () => {
    await downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    installUpdate()
  })

  ipcMain.handle('updater:get-version', () => {
    return getAppVersion()
  })

  ipcMain.handle('updater:set-feed-url', (_e, url: string) => {
    setUpdateFeedURL(url)
  })

  // Core version check
  ipcMain.handle('core:check-versions', async () => {
    return checkAllVersions(baseDir)
  })

  // ---- Node management (unified) ----

  ipcMain.handle('node:import-url', (_e, url: string) => {
    const node = parseNodeUrl(url)
    if (!node) return null
    // Set groupId for manual nodes
    node.groupId = 'manual'
    addNode(node)
    return node
  })

  ipcMain.handle('node:import-batch', (_e, urls: string[]) => {
    const nodes = parseNodeUrls(urls).map((node) => ({ ...node, groupId: 'manual' }))
    addNodes(nodes)
    return nodes
  })

  ipcMain.handle('node:list', () => {
    return listNodes()
  })

  ipcMain.handle('node:update', (_e, id: string, fields: Partial<StoredNode>) => {
    return updateNode(id, fields)
  })

  ipcMain.handle('node:delete', (_e, ids: string[]) => {
    deleteNodes(ids)
  })

  ipcMain.handle('node:list-all', () => {
    return getAllNodes()
  })

  ipcMain.handle('node:delete-one', (_e, nodeId: string, groupId: string) => {
    if (groupId === 'manual') {
      deleteNodes([nodeId])
    } else {
      deleteSubscriptionNode(groupId, nodeId)
    }
  })

  ipcMain.handle('node:delete-many', (_e, nodeIds: string[], groupId: string) => {
    if (groupId === 'manual') {
      deleteNodes(nodeIds)
    } else {
      deleteSubscriptionNodes(groupId, nodeIds)
    }
  })

  ipcMain.handle('node:test-latency', async (_e, nodeIds: string[]) => {
    const nodes: StoredNode[] = []
    for (const id of nodeIds) {
      const result = findNodeById(id)
      if (result) nodes.push(result.node)
    }
    const results = await Promise.all(
      nodes.map(async (n) => {
        try {
          const result = await testProxyNodes([{ host: n.host, port: n.port }], false)
          const latency = result[0]?.latency ?? -1
          updateNodeLatency(n.id, latency)
          return { id: n.id, latency }
        } catch {
          return { id: n.id, latency: -1 }
        }
      })
    )
    return results
  })

  ipcMain.handle('node:compatible-cores', (_e, protocol: string) => {
    return compatibleCores(protocol)
  })

  ipcMain.handle('node:connect', async (_e, nodeId: string, coreId: string) => {
    const found = findNodeById(nodeId)
    if (!found) return { success: false, error: '节点不存在' }

    const { node, groupId } = found

    const config = generateConfig(node, coreId)

    const result = await proxyManager.startWithConfig(coreId, config.content)
    if (result.success) {
      setActiveConnection({
        nodeId: node.id,
        groupId,
        nodeName: node.name,
        coreId,
        pid: result.pid ?? null,
        connectedAt: Date.now(),
      })
      enableSystemProxySetting()
      // Set system proxy — use syncSystemProxy for proper PAC/SOCKS5 bridging
      syncSystemProxy(proxyManager, true)
    }
    return result
  })

  ipcMain.handle('node:disconnect', async (_e, coreId: string) => {
    setActiveConnection(null)
    clearSystemProxy()
    return proxyManager.stop(coreId)
  })

  ipcMain.handle('node:get-active-connection', () => {
    return getActiveConnection()
  })

  // ---- Subscription management ----

  ipcMain.handle('sub:list', () => {
    return listSubscriptions()
  })

  ipcMain.handle('sub:add', async (_e, name: string, url: string) => {
    const sub = createSubscription(name, url)
    try {
      const diff = await updateSubscriptionNodes(sub.id)
      return { sub, diff }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { sub, diff: null, error: msg }
    }
  })

  ipcMain.handle('sub:update', async (_e, id: string) => {
    return updateSubscriptionNodes(id)
  })

  ipcMain.handle('sub:delete', (_e, id: string) => {
    deleteSubscription(id)
  })

  ipcMain.handle('sub:toggle-auto', (_e, id: string, enabled: boolean) => {
    updateSubscription(id, { autoUpdate: enabled })
  })
}
