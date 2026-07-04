import { ipcMain, BrowserWindow, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { ConfigService } from './config-service'
import { LogService } from './log-service'
import { getSettings, setSettings, AppSettings } from './settings-store'
import { testLatency, testProxyNodes, testRealLatency } from './latency-tester'
import { launchChrome } from './chrome-launcher'
import { getSystemProxyStatus, syncSystemProxy, clearSystemProxy } from './system-proxy'
import { getAvailableSlots, updateConfig, getCurrentSlot, switchSlot } from './ip-updater'
import { checkForUpdates, downloadUpdate, installUpdate, getAppVersion, setUpdateFeedURL } from './updater'
import { checkAllVersions, clearCoreVersionCache } from './core-version'
import { getCoreUpdateInfo, restoreBundledCore, updateCore } from './core-updater'
import { parseNodeUrl, parseNodeUrls, StoredNode } from './protocol-parser'
import { generateConfig, compatibleCores } from './config-generator'
import { listNodes, addNode, addNodes, updateNode, deleteNodes, deleteSubscriptionNode, deleteSubscriptionNodes, updateNodeLatencies, findNodeById, getAllNodes, getActiveConnection, setActiveConnection, listSubscriptions, cloneNode, moveNodesToGroup, listNodeGroups, createNodeGroup, renameNodeGroup, deleteNodeGroup, moveNodeGroup } from './nodes-store'
import { saveSubscription, updateSubscriptionNodes, updateSubscription, deleteSubscription, getSubscription } from './subscription-service'
import { setDelay, setDelays, setSortOrder, deleteProfileEx, getProfileEx, listAll as listAllProfileEx } from './profile-ex-store'
import { PublicRouteService } from './public-route-service'
import { MihomoService } from './mihomo-service'
import { listCoreProfiles } from './core-profiles'
import { getAppConnectionState } from './app-connection-state'
import { disconnectAllConnections } from './app-connection-control'
import { getExitIpInfo } from './exit-ip-service'

export function registerIpcHandlers(
  proxyManager: ProxyManager,
  configService: ConfigService,
  logService: LogService,
  baseDir: string,
  userCoreRoot: string,
  publicRouteService: PublicRouteService,
  mihomoService: MihomoService,
  notifyAppConnectionState: () => void = () => undefined,
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
      const proxyResult = await syncSystemProxy(proxyManager, true)
      if (!proxyResult.success) {
        await proxyManager.stop(proxyId).catch(() => undefined)
        setSettings({ systemProxy: false })
        publishSettings()
        notifyAppConnectionState()
        return { success: false, error: proxyResult.error || 'Windows 系统代理设置失败' }
      }
    }
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('proxy:stop', async (_e, proxyId: string) => {
    const result = await proxyManager.stop(proxyId)
    if (!proxyManager.getStatus().some((status) => status.running)) {
      setSettings({ systemProxy: false })
      publishSettings()
    }
    await syncSystemProxy(proxyManager, true)
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('proxy:status', () => {
    return proxyManager.getStatus()
  })

  ipcMain.handle('app:connection-state', () => {
    return getAppConnectionState(proxyManager, publicRouteService)
  })

  ipcMain.handle('app:disconnect-all', async () => {
    const result = await disconnectAllConnections(proxyManager, publicRouteService)
    publishSettings()
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('app:exit-ip-info', async () => {
    return getExitIpInfo(proxyManager)
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
    const latency = await testRealLatency(def.port, def.protocol)
    // Also update the proxy status so dashboard picks it up
    proxyManager.updateStatus(proxyId, { latency: latency >= 0 ? latency : null })
    notifyAppConnectionState()
    return { latency }
  })

  // IP update
  ipcMain.handle('proxy:update-ip', async (_e, proxyId: string, slot: number) => {
    const def = PROXY_DEFINITIONS.find((d) => d.id === proxyId)
    if (!def) return { success: false, error: 'δ֪����' }
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
    if (!def) return { success: false, error: 'δ֪����' }
    return switchSlot(baseDir, def.dir, def.configFile, slot)
  })

  ipcMain.handle('public-route:list', () => publicRouteService.listRoutes())
  ipcMain.handle('public-route:state', () => publicRouteService.getState())
  ipcMain.handle('public-route:select', (_e, routeId: string) => {
    const result = publicRouteService.selectRoute(routeId)
    if (result.success) publishSettings()
    notifyAppConnectionState()
    return result
  })
  ipcMain.handle('public-route:connect', async (_e, routeId?: string) => {
    const result = await publicRouteService.connect(routeId)
    publishSettings()
    notifyAppConnectionState()
    return result
  })
  ipcMain.handle('public-route:disconnect', async () => {
    const result = await publicRouteService.disconnect()
    notifyAppConnectionState()
    return result
  })
  ipcMain.handle('public-route:repair', () => publicRouteService.repairNetwork())
  ipcMain.handle('public-route:diagnose', (_e, routeId?: string) => publicRouteService.diagnose(routeId))
  ipcMain.handle('public-route:update', (_e, routeId: string) => publicRouteService.updateRoute(routeId))
  ipcMain.handle('public-route:update-all', () => publicRouteService.updateAll())

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
    return checkAllVersions(baseDir, userCoreRoot)
  })

  ipcMain.handle('core:update', async (event, proxyId: string) => {
    const running = proxyManager.getStatus(proxyId)[0]?.running
    if (running) return { success: false, proxyId, error: '请先断开该核心连接，再更新核心文件' }
    const result = await updateCore(proxyId, userCoreRoot, (progress) => {
      event.sender.send('core:update-progress', progress)
    })
    clearCoreVersionCache()
    return result
  })

  ipcMain.handle('core:update-info', async (_e, proxyId: string) => {
    return getCoreUpdateInfo(proxyId)
  })

  ipcMain.handle('core:restore-bundled', async (_e, proxyId: string) => {
    const running = proxyManager.getStatus(proxyId)[0]?.running
    if (running) return { success: false, proxyId, error: '请先断开该核心连接，再恢复内置核心' }
    const result = restoreBundledCore(proxyId, userCoreRoot)
    clearCoreVersionCache()
    return result
  })

  ipcMain.handle('core:open-dir', async (_e, proxyId: string) => {
    const dir = join(userCoreRoot, proxyId)
    mkdirSync(dir, { recursive: true })
    const error = await shell.openPath(dir)
    return { success: !error, error: error || undefined }
  })

  ipcMain.handle('core:list-profiles', () => {
    return listCoreProfiles(baseDir, userCoreRoot)
  })

  ipcMain.handle('clash:start-profile', async (_e, profileId: string) => {
    try {
      if (publicRouteService.getState().state === 'connected') {
        await publicRouteService.disconnect()
      }
      const result = await mihomoService.startProfile(profileId)
      notifyAppConnectionState()
      return result
    } catch (err) {
      notifyAppConnectionState()
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clash:stop', async () => {
    try {
      const result = await mihomoService.stop()
      notifyAppConnectionState()
      return result
    } catch (err) {
      notifyAppConnectionState()
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clash:groups', async () => {
    try {
      return await mihomoService.getGroups()
    } catch {
      return []
    }
  })

  ipcMain.handle('clash:config', async () => {
    try {
      return await mihomoService.getConfig()
    } catch {
      return { mode: 'rule' }
    }
  })

  ipcMain.handle('clash:set-mode', async (_e, mode: 'rule' | 'global' | 'direct') => {
    try {
      return await mihomoService.setMode(mode)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clash:runtime-options', () => {
    return mihomoService.getRuntimeOptions()
  })

  ipcMain.handle('clash:update-runtime-options', (_e, options: { tunEnabled?: boolean }) => {
    return mihomoService.updateRuntimeOptions(options)
  })

  ipcMain.handle('clash:diagnose-tun', () => {
    return mihomoService.diagnoseTun()
  })

  ipcMain.handle('clash:list-profiles', () => {
    return mihomoService.listProfiles()
  })

  ipcMain.handle('clash:save-profile', (_e, input: { id?: string; name: string; content: string }) => {
    return mihomoService.saveProfile(input)
  })

  ipcMain.handle('clash:save-profile-url', async (_e, input: { id?: string; name: string; url: string; autoUpdate?: boolean; updateInterval?: number }) => {
    return mihomoService.saveProfileFromUrl(input)
  })

  ipcMain.handle('clash:update-profile', async (_e, profileId: string) => {
    return mihomoService.updateProfile(profileId)
  })

  ipcMain.handle('clash:update-profile-options', (_e, profileId: string, options: { autoUpdate?: boolean; updateInterval?: number }) => {
    return mihomoService.updateProfileOptions(profileId, options)
  })

  ipcMain.handle('clash:delete-profile', async (_e, profileId: string) => {
    const target = mihomoService.listProfiles().find((profile) => profile.id === profileId)
    if (target?.active) {
      await mihomoService.stop().catch(() => undefined)
    }
    const result = mihomoService.deleteProfile(profileId)
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('clash:select-proxy', async (_e, groupName: string, proxyName: string) => {
    try {
      return await mihomoService.selectGroupProxy(groupName, proxyName)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clash:test-delay', async (_e, proxyName: string) => {
    try {
      return await mihomoService.testProxyDelay(proxyName)
    } catch (err) {
      return { success: false, delay: -1, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clash:connections', async () => {
    try {
      return await mihomoService.getConnections()
    } catch {
      return []
    }
  })

  ipcMain.handle('clash:close-connection', async (_e, id: string) => {
    return mihomoService.closeConnection(id)
  })

  ipcMain.handle('clash:close-all-connections', async () => {
    return mihomoService.closeAllConnections()
  })

  ipcMain.handle('clash:traffic-overview', async () => {
    return mihomoService.getTrafficOverview()
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

  ipcMain.handle('node:get', (_e, id: string) => {
    const found = findNodeById(id)
    return found ? { ...found.node, groupId: found.groupId } : null
  })

  ipcMain.handle('node:update', (_e, id: string, fields: Partial<StoredNode>) => {
    return updateNode(id, fields)
  })

  ipcMain.handle('node:clone', (_e, id: string) => {
    return cloneNode(id)
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
    deleteProfileEx([nodeId])
  })

  ipcMain.handle('node:delete-many', (_e, nodeIds: string[], groupId: string) => {
    if (groupId === 'manual') {
      deleteNodes(nodeIds)
    } else {
      deleteSubscriptionNodes(groupId, nodeIds)
    }
    deleteProfileEx(nodeIds)
  })

  ipcMain.handle('node:test-latency', async (_e, nodeIds: string[]) => {
    const ids = Array.from(new Set(nodeIds)).filter(Boolean)
    const results: { id: string; latency: number }[] = []
    const nodeMap = new Map(getAllNodes().map((item) => [item.node.id, item.node]))
    const concurrency = Math.min(12, ids.length)
    let cursor = 0
    let done = 0
    let pendingProgress: { id: string; latency: number }[] = []

    const publishProgress = (force = false): void => {
      if (!force && pendingProgress.length < 12) return
      if (pendingProgress.length === 0) return
      const win = mainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('node:latency-progress', {
          done,
          total: ids.length,
          results: pendingProgress.splice(0)
        })
      } else {
        pendingProgress = []
      }
    }

    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        const n = nodeMap.get(id)
        if (!n) continue
        try {
          const latency = await testLatency(n.host, n.port, 1500, true)
          results.push({ id: n.id, latency })
          pendingProgress.push({ id: n.id, latency })
        } catch {
          results.push({ id: n.id, latency: -1 })
          pendingProgress.push({ id: n.id, latency: -1 })
        }
        done += 1
        publishProgress()
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()))
    publishProgress(true)
    updateNodeLatencies(results)
    setDelays(results)
    return results
  })

  ipcMain.handle('node:compatible-cores', (_e, protocol: string) => {
    return compatibleCores(protocol)
  })

  ipcMain.handle('node:export-client-config', (_e, nodeId: string, coreId: string) => {
    const found = findNodeById(nodeId)
    if (!found) return { success: false, error: '节点不存在' }
    try {
      const config = generateConfig(found.node, coreId)
      return { success: true, ...config }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, error }
    }
  })

  ipcMain.handle('node:connect', async (_e, nodeId: string, coreId: string) => {
    const found = findNodeById(nodeId)
    if (!found) return { success: false, error: '�ڵ㲻����' }

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
      // Set system proxy �� use syncSystemProxy for proper PAC/SOCKS5 bridging
      const proxyResult = await syncSystemProxy(proxyManager, true)
      if (!proxyResult.success) {
        setActiveConnection(null)
        setSettings({ systemProxy: false })
        publishSettings()
        await proxyManager.stop(coreId).catch(() => undefined)
        clearSystemProxy()
        notifyAppConnectionState()
        return { success: false, error: proxyResult.error || 'Windows 系统代理设置失败' }
      }
    }
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('node:disconnect', async (_e, coreId: string) => {
    setActiveConnection(null)
    setSettings({ systemProxy: false })
    publishSettings()
    clearSystemProxy()
    const result = await proxyManager.stop(coreId)
    notifyAppConnectionState()
    return result
  })

  ipcMain.handle('node:get-active-connection', () => {
    return getActiveConnection()
  })

  // ---- Subscription management ----

  ipcMain.handle('sub:list', () => {
    return listSubscriptions()
  })

  ipcMain.handle('group:list', () => {
    return listNodeGroups()
  })

  ipcMain.handle('sub:get', (_e, id: string) => {
    return getSubscription(id) ?? null
  })

  ipcMain.handle('sub:add', async (_e, name: string, url: string) => {
    const sub = await saveSubscription({ name, url, refresh: false })
    try {
      const diff = await updateSubscriptionNodes(sub.id)
      return { sub: getSubscription(sub.id) ?? sub, diff }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { sub, diff: null, error: msg }
    }
  })

  ipcMain.handle('sub:save', async (_e, input: {
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
  }) => {
    const sub = await saveSubscription({ ...input, refresh: false })
    try {
      if (input.refresh ?? true) {
        await updateSubscriptionNodes(sub.id)
      }
      return { sub: getSubscription(sub.id) ?? sub, error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { sub, error: msg }
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
  ipcMain.handle('sub:toggle-enabled', (_e, id: string, enabled: boolean) => {
    updateSubscription(id, { enabled })
  })

  ipcMain.handle('group:create-empty', async (_e, name: string) => {
    const safeName = String(name || '').trim()
    if (!safeName) return { success: false, error: '请输入分组名称' }
    const group = createNodeGroup(safeName)
    return { success: true, group }
  })

  ipcMain.handle('group:rename', (_e, id: string, name: string) => {
    const safeName = String(name || '').trim()
    if (!safeName) return { success: false, error: '请输入分组名称' }
    if (!renameNodeGroup(id, safeName)) {
      updateSubscription(id, { name: safeName })
    }
    return { success: true }
  })

  ipcMain.handle('group:delete-empty', (_e, id: string) => {
    const group = listNodeGroups().find((item) => item.id === id)
    if (group) {
      return { success: deleteNodeGroup(id, true) }
    }
    const sub = getSubscription(id)
    if (!sub) return { success: false, error: '分组不存在' }
    deleteSubscription(id)
    return { success: true }
  })

  ipcMain.handle('group:move', (_e, id: string, direction: 'up' | 'down') => {
    return { success: moveNodeGroup(id, direction) }
  })

  ipcMain.handle('group:move-nodes', (_e, nodeIds: string[], targetGroupId: string) => {
    try {
      const result = moveNodesToGroup(nodeIds, targetGroupId)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // ---- ProfileEx (V2rayN-style sort & metadata) ----

  ipcMain.handle('profile:sort', (_e, colName: string, asc: boolean, groupId: string) => {
    const allNodes = getAllNodes()
    const filtered = groupId ? allNodes.filter((n) => n.groupId === groupId) : allNodes
    const items = listAllProfileEx()
    const exMap = new Map(items.map((i: any) => [i.nodeId, i]))

    const sorted = [...filtered].sort((a, b) => {
      const exA = exMap.get(a.node.id) || { delay: 0, sort: 0 }
      const exB = exMap.get(b.node.id) || { delay: 0, sort: 0 }
      let cmp = 0
      switch (colName) {
        case 'configType':
          cmp = (a.node.protocol || '').localeCompare(b.node.protocol || '')
          break
        case 'remarks':
          cmp = (a.node.name || '').localeCompare(b.node.name || '', 'zh-CN')
          break
        case 'address':
          cmp = (a.node.host || '').localeCompare(b.node.host || '')
          break
        case 'delayVal': {
          const da = exA.delay ?? 0
          const db = exB.delay ?? 0
          // ���ɴ�(-1)�������
          if (da < 0 && db >= 0) { cmp = 1 }
          else if (db < 0 && da >= 0) { cmp = -1 }
          else { cmp = da - db }
          break
        }
        default:
          cmp = (a.node.name || '').localeCompare(b.node.name || '')
      }
      return asc ? cmp : -cmp
    })
    // Update sort order in ProfileEx
    setSortOrder(sorted.map((n) => n.node.id))
    return sorted
  })

  ipcMain.handle('profile:get-ex', (_e, nodeId: string) => {
    return getProfileEx(nodeId) || null
  })

  ipcMain.handle('profile:list-ex', () => {
    return listAllProfileEx()
  })

  ipcMain.handle('profile:set-delay', (_e, nodeId: string, delay: number) => {
    setDelay(nodeId, delay)
    return { success: true }
  })

  ipcMain.handle('profile:move', (_e, groupId: string, nodeIds: string[], direction: 'top' | 'up' | 'down' | 'bottom') => {
    const ordered = getAllNodes()
      .filter((item) => item.groupId === groupId)
      .sort((a, b) => {
        const sa = getProfileEx(a.node.id)?.sort ?? Number.MAX_SAFE_INTEGER
        const sb = getProfileEx(b.node.id)?.sort ?? Number.MAX_SAFE_INTEGER
        return sa - sb
      })

    if (ordered.length === 0 || nodeIds.length === 0) return ordered

    const selectedSet = new Set(nodeIds)
    const mutable = [...ordered]

    if (direction === 'top' || direction === 'bottom') {
      const selected = mutable.filter((item) => selectedSet.has(item.node.id))
      const rest = mutable.filter((item) => !selectedSet.has(item.node.id))
      const next = direction === 'top' ? [...selected, ...rest] : [...rest, ...selected]
      setSortOrder(next.map((item) => item.node.id))
      return next
    }

    if (direction === 'up') {
      for (let i = 1; i < mutable.length; i += 1) {
        if (selectedSet.has(mutable[i].node.id) && !selectedSet.has(mutable[i - 1].node.id)) {
          ;[mutable[i - 1], mutable[i]] = [mutable[i], mutable[i - 1]]
        }
      }
    } else {
      for (let i = mutable.length - 2; i >= 0; i -= 1) {
        if (selectedSet.has(mutable[i].node.id) && !selectedSet.has(mutable[i + 1].node.id)) {
          ;[mutable[i + 1], mutable[i]] = [mutable[i], mutable[i + 1]]
        }
      }
    }

    setSortOrder(mutable.map((item) => item.node.id))
    return mutable
  })
}
