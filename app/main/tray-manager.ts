import { Tray, Menu, nativeImage, BrowserWindow, app, NativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { ProxyManager } from './proxy-manager'
import { PublicRouteService } from './public-route-service'
import { launchChrome } from './chrome-launcher'
import { getAppConnectionState } from './app-connection-state'
import { disconnectAllConnections } from './app-connection-control'

function findTrayIcon(baseDir: string): NativeImage {
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
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createEmpty()
}

export class TrayManager {
  private tray: Tray | null = null

  constructor(
    private proxyManager: ProxyManager,
    private publicRouteService: PublicRouteService,
    private baseDir: string,
    private mainWindow: BrowserWindow,
  ) {}

  create(): void {
    this.tray = new Tray(findTrayIcon(this.baseDir).resize({ width: 16, height: 16 }))
    this.tray.setToolTip('KiNGO')
    this.tray.on('double-click', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
    })
    this.updateMenu()
  }

  updateMenu(): void {
    if (!this.tray) return
    const appState = getAppConnectionState(this.proxyManager, this.publicRouteService)
    const publicState = this.publicRouteService.getState()
    const selectedRoute = this.publicRouteService.getSelectedRoute()
    const hasRunningCore = this.proxyManager.getStatus().some((status) => status.running)
    const isBusy = appState.busy || ['preparing', 'connecting', 'disconnecting'].includes(publicState.state)
    const current = appState.connected ? appState.displayName : null

    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: this.mainWindow.isVisible() ? '隐藏主窗口' : '显示主窗口',
        click: () => {
          if (this.mainWindow.isVisible()) this.mainWindow.hide()
          else {
            this.mainWindow.show()
            this.mainWindow.focus()
          }
        },
      },
      {
        label: current ? `当前连接：${current}` : '当前未连接',
        enabled: false,
      },
      {
        label: appState.connected ? '断开当前连接' : '连接公共线路',
        enabled: appState.connected || (!!selectedRoute && !isBusy),
        click: () => {
          if (appState.connected) void this.stopAllConnections()
          else void this.publicRouteService.connect()
        },
      },
      {
        label: '启动浏览器',
        enabled: hasRunningCore,
        click: () => { launchChrome(this.baseDir, this.proxyManager) },
      },
      { type: 'separator' },
      {
        label: '打开 KiNGO',
        click: () => {
          this.mainWindow.show()
          this.mainWindow.focus()
        },
      },
      {
        label: '全部停止',
        enabled: hasRunningCore || appState.connected,
        click: () => { void this.stopAllConnections() },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          void this.proxyManager.stopAll()
          app.quit()
        },
      },
    ]))
  }

  private async stopAllConnections(): Promise<void> {
    try {
      await disconnectAllConnections(this.proxyManager, this.publicRouteService)
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('app:connection-state-changed', getAppConnectionState(this.proxyManager, this.publicRouteService))
      }
    } finally {
      this.updateMenu()
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
