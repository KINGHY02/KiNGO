import { ipcMain, BrowserWindow } from 'electron'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'
import { ConfigService } from './config-service'
import { LogService } from './log-service'
import { getSettings, setSettings, AppSettings } from './settings-store'
import { testProxyNodes, testRealLatency } from './latency-tester'
import { launchChrome } from './chrome-launcher'
import { getSystemProxyStatus, syncSystemProxy } from './system-proxy'
import { getAvailableSlots, updateConfig, getCurrentSlot, switchSlot } from './ip-updater'
import { checkForUpdates, downloadUpdate, installUpdate, getAppVersion, setUpdateFeedURL } from './updater'

export function registerIpcHandlers(
  proxyManager: ProxyManager,
  configService: ConfigService,
  logService: LogService,
  baseDir: string
): void {
  const mainWindow = (): BrowserWindow => BrowserWindow.getAllWindows()[0]

  // Proxy start/stop/status
  ipcMain.handle('proxy:start', async (_e, proxyId: string) => {
    return proxyManager.start(proxyId)
  })

  ipcMain.handle('proxy:stop', async (_e, proxyId: string) => {
    return proxyManager.stop(proxyId)
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
}
