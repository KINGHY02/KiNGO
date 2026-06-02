import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { ProxyManager } from './proxy-manager'
import { launchChrome } from './chrome-launcher'

function findTrayIcon(baseDir: string): nativeImage {
  // Prefer dedicated tray .ico, then main icon, then PNG fallbacks
  const candidates = [
    join(baseDir, 'icons', 'tray.ico'),
    join(baseDir, 'icons', 'tray-32.ico'),
    join(baseDir, 'app', 'electron-resources', 'tray.ico'),
    join(baseDir, 'app', 'electron-resources', 'tray-32.ico'),
    join(baseDir, 'icon.ico'),
    join(baseDir, 'app', 'electron-resources', 'icon.ico'),
    join(baseDir, 'icons', 'tray-32.png'),
    join(baseDir, 'icons', 'tray-16.png'),
  ]

  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }

  return nativeImage.createEmpty()
}

export class TrayManager {
  private tray: Tray | null = null
  private proxyManager: ProxyManager
  private baseDir: string
  private mainWindow: BrowserWindow

  constructor(proxyManager: ProxyManager, baseDir: string, mainWindow: BrowserWindow) {
    this.proxyManager = proxyManager
    this.baseDir = baseDir
    this.mainWindow = mainWindow
  }

  create(): void {
    const trayIcon = findTrayIcon(this.baseDir)

    this.tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    this.tray.setToolTip('KiNGO')

    this.tray.on('double-click', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
    })

    this.updateMenu()
  }

  updateMenu(): void {
    if (!this.tray) return

    const statuses = this.proxyManager.getStatus()
    const runningProxies = statuses.filter((s) => s.running)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: this.mainWindow.isVisible() ? '隐藏主窗口' : '显示主窗口',
        click: () => {
          if (this.mainWindow.isVisible()) {
            this.mainWindow.hide()
          } else {
            this.mainWindow.show()
            this.mainWindow.focus()
          }
        }
      },
      {
        label: '启动浏览器',
        click: () => {
          launchChrome(this.baseDir, this.proxyManager)
        }
      },
      { type: 'separator' },
      ...(runningProxies.length > 0
        ? [
            ...runningProxies.map((p) => ({
              label: `停止 ${p.name}`,
              click: () => this.proxyManager.stop(p.id)
            })),
            { type: 'separator' as const }
          ]
        : []),
      {
        label: '全部停止',
        enabled: runningProxies.length > 0,
        click: () => this.proxyManager.stopAll()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.proxyManager.stopAll()
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
