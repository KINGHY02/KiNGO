import { execSync } from 'child_process'
import { startPacServer, stopPacServer } from './pac-server'
import type { ProxyManager } from './proxy-manager'
import { getSettings } from './settings-store'

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

export function setSystemProxy(enable: boolean, proxyAddress?: string): boolean {
  try {
    if (enable && proxyAddress) {
      // Clear PAC URL first (mutual exclusion)
      execSync(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "" /f`, { encoding: 'utf-8' })
      execSync(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 1 /f`, { encoding: 'utf-8' })
      execSync(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`, { encoding: 'utf-8' })
    } else {
      execSync(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { encoding: 'utf-8' })
    }
    notifySystem()
    return true
  } catch {
    return false
  }
}

export function setSystemProxyWithPAC(pacUrl: string): boolean {
  try {
    // Clear direct proxy server (mutual exclusion)
    execSync(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "" /f`, { encoding: 'utf-8' })
    execSync(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { encoding: 'utf-8' })
    execSync(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "${pacUrl}" /f`, { encoding: 'utf-8' })
    notifySystem()
    return true
  } catch {
    return false
  }
}

export function clearSystemProxy(): boolean {
  try {
    execSync(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { encoding: 'utf-8' })
    execSync(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "" /f`, { encoding: 'utf-8' })
    execSync(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "" /f`, { encoding: 'utf-8' })
    notifySystem()
    return true
  } catch {
    return false
  }
}

export function getSystemProxyStatus(): { enabled: boolean; server: string | null; pacUrl: string | null } {
  try {
    const proxyEnable = execSync(`reg query "${REG_PATH}" /v ProxyEnable`, { encoding: 'utf-8' })
    const enabled = proxyEnable.includes('0x1')

    let server: string | null = null
    let pacUrl: string | null = null

    try {
      const serverOut = execSync(`reg query "${REG_PATH}" /v ProxyServer`, { encoding: 'utf-8' })
      const serverMatch = serverOut.match(/ProxyServer\s+REG_SZ\s+(.+)/)
      if (serverMatch && serverMatch[1].trim()) server = serverMatch[1].trim()
    } catch { /* not set */ }

    try {
      const pacOut = execSync(`reg query "${REG_PATH}" /v AutoConfigURL`, { encoding: 'utf-8' })
      const pacMatch = pacOut.match(/AutoConfigURL\s+REG_SZ\s+(.+)/)
      if (pacMatch && pacMatch[1].trim()) pacUrl = pacMatch[1].trim()
    } catch { /* not set */ }

    return { enabled, server, pacUrl }
  } catch {
    return { enabled: false, server: null, pacUrl: null }
  }
}

function notifySystem(): void {
  try {
    execSync('RUNDLL32.EXE USER32.DLL,UpdatePerUserSystemParameters 1, True', { encoding: 'utf-8' })
  } catch { /* ignore */ }
}

export async function syncSystemProxy(proxyManager: ProxyManager): Promise<void> {
  const settings = getSettings()
  if (!settings.systemProxy) {
    clearSystemProxy()
    stopPacServer()
    return
  }

  const allStatus = proxyManager.getStatus()
  const runningProxies = allStatus.filter((s) => s.running)

  if (runningProxies.length === 0) {
    clearSystemProxy()
    stopPacServer()
    return
  }

  // Clash.Meta is the only HTTP proxy — use it directly when running
  const clashStatus = runningProxies.find((s) => s.id === 'clash-meta')
  if (clashStatus) {
    stopPacServer()
    setSystemProxy(true, '127.0.0.1:7890')
    return
  }

  // For SOCKS5 proxies, use PAC server to bridge to system proxy
  const socksProxy = runningProxies[0]
  const def = proxyManager.getDef(socksProxy.id)
  if (def) {
    try {
      const port = await startPacServer('127.0.0.1', def.port, def.protocol, settings.proxyMode)
      setSystemProxyWithPAC(`http://127.0.0.1:${port}/proxy.pac`)
    } catch (err) {
      console.error('Failed to start PAC server:', err)
    }
  }
}
