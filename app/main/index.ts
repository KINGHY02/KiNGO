import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { ProxyManager } from './proxy-manager'
import { ConfigService } from './config-service'
import { LogService } from './log-service'
import { registerIpcHandlers } from './ipc-handlers'
import { TrayManager } from './tray-manager'
import { getSettings, setSettings } from './settings-store'
import { initUpdater, checkForUpdates, setUpdateFeedURL } from './updater'
import { syncSystemProxy, clearKingoSystemProxy } from './system-proxy'
import { stopPacServer } from './pac-server'
import { PublicRouteService } from './public-route-service'
import { getActiveConnection, setActiveConnection } from './nodes-store'
import { SubscriptionScheduler } from './subscription-scheduler'
import { MihomoService } from './mihomo-service'
import { ClashProfileScheduler } from './clash-profile-scheduler'
import { getAppConnectionState } from './app-connection-state'


// Catch unhandled errors so the user sees something instead of silent crash
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  try {
    dialog.showErrorBox('KiNGO 启动错误', `${err.message}\n\n${err.stack || ''}`)
  } catch { /* dialog might not be available */ }
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

let trayManager: TrayManager | null = null
let proxyManager: ProxyManager
let configService: ConfigService
let logService: LogService
let publicRouteService: PublicRouteService
let subscriptionScheduler: SubscriptionScheduler
let mihomoService: MihomoService
let clashProfileScheduler: ClashProfileScheduler
let BASE_DIR: string
let forceQuitting = false
let shutdownComplete = false
const coreRunningState = new Map<string, boolean>()

function createWindow(): void {
  // Find the app icon for the window (taskbar thumbnail)
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '..', '..', 'electron-resources', 'icon.ico')

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    title: 'KiNGO',
    backgroundColor: '#0d1124',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  logService.setPushHandler((entry) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proxy:log', entry)
    }
  })

  const publishAppConnectionState = (): void => {
    const state = getAppConnectionState(proxyManager, publicRouteService)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:connection-state-changed', state)
    }
    trayManager?.updateMenu()
  }

  proxyManager.on('status-changed', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proxy:status-changed', status)
    }
    publishAppConnectionState()
    const wasRunning = coreRunningState.get(status.id) ?? false
    coreRunningState.set(status.id, status.running)
    if (wasRunning && !status.running) {
      void syncSystemProxy(proxyManager)
      if (!proxyManager.getStatus().some((item) => item.running)) {
        setSettings({ systemProxy: false })
      }
      const activeConnection = getActiveConnection()
      if (activeConnection?.coreId === status.id) {
        setActiveConnection(null)
      }
    }
  })

  proxyManager.on('log', (proxyId: string, message: string, level: 'info' | 'warn' | 'error') => {
    logService.push(proxyId, message, level)
  })

  mainWindow.on('close', (event) => {
    if (forceQuitting) return // Let window close during quit (e.g. update install)
    const settings = getSettings()
    if (settings.minimizeToTray) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Forward maximize state changes to renderer
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximize-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximize-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  publicRouteService.on('state-changed', (state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('public-route:state-changed', state)
    publishAppConnectionState()
  })
  publicRouteService.on('routes-changed', (routes) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('public-route:routes-changed', routes)
    publishAppConnectionState()
  })
  subscriptionScheduler.on('updated', (result) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('subscription:auto-updated', result)
  })
  clashProfileScheduler.on('updated', (result) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('clash-profile:auto-updated', result)
  })

  trayManager = new TrayManager(proxyManager, publicRouteService, BASE_DIR, mainWindow)
  trayManager.create()

  // Initialize auto-updater
  initUpdater(mainWindow)

  const settings = getSettings()
  if (settings.autoStart && process.argv.includes('--minimized')) {
    mainWindow.hide()
  }

  // Auto-check for updates on startup if enabled
  if (settings.autoCheckUpdates) {
    if (settings.updateMirror) {
      setUpdateFeedURL(settings.updateMirror)
    }
    setTimeout(() => checkForUpdates(), 3000)
  }
}

app.whenReady().then(() => {
  try {
    BASE_DIR = app.isPackaged
      ? process.resourcesPath
      : join(__dirname, '..', '..', '..')

    logService = new LogService(10000)
    proxyManager = new ProxyManager(BASE_DIR)
    configService = new ConfigService(BASE_DIR)
    publicRouteService = new PublicRouteService(BASE_DIR, proxyManager, configService)
    mihomoService = new MihomoService(BASE_DIR, proxyManager)
    subscriptionScheduler = new SubscriptionScheduler()
    clashProfileScheduler = new ClashProfileScheduler(mihomoService)

    // A new app session never assumes an old local proxy process is still alive.
    // Only clear proxy values that point to KiNGO's own localhost ports/PAC.
    clearKingoSystemProxy()
    setSettings({ systemProxy: false })
    setActiveConnection(null)

    registerIpcHandlers(
      proxyManager,
      configService,
      logService,
      BASE_DIR,
      publicRouteService,
      mihomoService,
      () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          win.webContents.send('app:connection-state-changed', getAppConnectionState(proxyManager, publicRouteService))
        }
        trayManager?.updateMenu()
      },
    )
    createWindow()
    subscriptionScheduler.start()
    clashProfileScheduler.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error('Startup error:', msg, stack)
    dialog.showErrorBox('KiNGO 启动失败', `${msg}\n\n${stack}`)
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  forceQuitting = true
  void (async () => {
    await proxyManager?.stopAll()
    subscriptionScheduler?.stop()
    clashProfileScheduler?.stop()
    trayManager?.destroy()
    clearKingoSystemProxy()
    stopPacServer()
    setSettings({ systemProxy: false })
    setActiveConnection(null)
    shutdownComplete = true
    app.quit()
  })()
})
