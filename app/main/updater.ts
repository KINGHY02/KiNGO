import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { BrowserWindow, app } from 'electron'

type UpdateCallback = (channel: string, data: unknown) => void

let sendToRenderer: UpdateCallback | null = null
let _checking = false

export function initUpdater(mainWindow: BrowserWindow): void {
  sendToRenderer = (channel, data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  // Configure autoUpdater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer?.('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    _checking = false
    sendToRenderer?.('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', () => {
    _checking = false
    sendToRenderer?.('updater:status', { status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    sendToRenderer?.('updater:progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    sendToRenderer?.('updater:downloaded', {
      version: info.version
    })
  })

  autoUpdater.on('error', (error: Error) => {
    _checking = false
    sendToRenderer?.('updater:error', { message: error.message })
  })
}

export async function checkForUpdates(): Promise<{ checking: boolean }> {
  if (_checking) return { checking: false }
  _checking = true
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    _checking = false
  }
  return { checking: true }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}

export function getAppVersion(): string {
  try {
    return autoUpdater.currentVersion.raw
  } catch {
    return app.getVersion()
  }
}

export function setUpdateFeedURL(url: string): void {
  if (url) {
    autoUpdater.setFeedURL(url)
  }
}
