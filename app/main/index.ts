import electron from 'electron'
import { join } from 'path'
import { ProxyManager } from './proxy-manager'
import { ConfigService } from './config-service'
import { LogService } from './log-service'
import { registerIpcHandlers } from './ipc-handlers'
import { TrayManager } from './tray-manager'
import { getSettings } from './settings-store'
import { initUpdater, checkForUpdates, setUpdateFeedURL } from './updater'

const { app, BrowserWindow } = electron

let trayManager: TrayManager | null = null
let proxyManager: ProxyManager
let configService: ConfigService
let logService: LogService
let BASE_DIR: string

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    title: 'KiNGO',
    backgroundColor: '#0d1124',
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

  proxyManager.on('status-changed', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proxy:status-changed', status)
    }
    trayManager?.updateMenu()
  })

  proxyManager.on('log', (proxyId: string, message: string, level: 'info' | 'warn' | 'error') => {
    logService.push(proxyId, message, level)
  })

  mainWindow.on('close', (event) => {
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  trayManager = new TrayManager(proxyManager, BASE_DIR, mainWindow)
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
  BASE_DIR = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '..', '..', '..')

  logService = new LogService(10000)
  proxyManager = new ProxyManager(BASE_DIR)
  configService = new ConfigService(BASE_DIR)

  registerIpcHandlers(proxyManager, configService, logService, BASE_DIR)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  proxyManager?.stopAll()
  trayManager?.destroy()
})
