import { ProxyManager } from './proxy-manager'
import { PublicRouteService } from './public-route-service'
import { setSettings } from './settings-store'
import { setActiveConnection } from './nodes-store'
import { clearKingoSystemProxy } from './system-proxy'

export interface AppActionResult {
  success: boolean
  error?: string
}

export async function disconnectAllConnections(
  proxyManager: ProxyManager,
  publicRouteService: PublicRouteService,
): Promise<AppActionResult> {
  let firstError: string | null = null

  try {
    const publicResult = await publicRouteService.disconnect()
    if (!publicResult.success && publicResult.error) firstError = publicResult.error
  } catch (err) {
    firstError = err instanceof Error ? err.message : String(err)
  }

  try {
    await proxyManager.stopAll()
  } catch (err) {
    firstError = firstError || (err instanceof Error ? err.message : String(err))
  }

  setActiveConnection(null)
  setSettings({ systemProxy: false })
  const proxyCleared = clearKingoSystemProxy()

  if (!proxyCleared) {
    return { success: false, error: '系统代理清理失败，请在 Windows 代理设置中手动确认' }
  }

  return firstError ? { success: false, error: firstError } : { success: true }
}
