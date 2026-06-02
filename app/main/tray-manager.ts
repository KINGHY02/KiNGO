import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { ProxyManager } from './proxy-manager'
import { launchChrome } from './chrome-launcher'

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
    // Use project icons - try multiple paths
    const iconPaths = [
      join(this.baseDir, 'icons', '32.png'),
      join(this.baseDir, 'icons', '16.png')
    ]

    let trayIcon: nativeImage | undefined
    for (const iconPath of iconPaths) {
      try {
        trayIcon = nativeImage.createFromPath(iconPath)
        if (!trayIcon.isEmpty()) break
      } catch { /* ignore */ }
    }

    // Fallback: create a simple icon if icons not found
    if (!trayIcon || trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty()
    }

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
