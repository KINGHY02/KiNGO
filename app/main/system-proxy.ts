import { execSync } from 'child_process'
import { startPacServer, stopPacServer } from './pac-server'
import type { ProxyManager } from './proxy-manager'
import { getSettings } from './settings-store'

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

function execReg(cmd: string): void {
  execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function setSystemProxy(enable: boolean, proxyAddress?: string): boolean {
  try {
    if (enable && proxyAddress) {
      // Clear PAC URL first (mutual exclusion)
      execReg(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "" /f`)
      execReg(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 1 /f`)
      execReg(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`)
      console.log(`[system-proxy] Set system proxy: ${proxyAddress}`)
    } else {
      execReg(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`)
      execReg(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "" /f`)
      console.log('[system-proxy] Disabled system proxy')
    }
    notifySystem()
    return true
  } catch (err) {
    console.error('[system-proxy] Failed:', err instanceof Error ? err.message : String(err))
    return false
  }
}

export function setSystemProxyWithPAC(pacUrl: string): boolean {
  try {
    // Clear direct proxy server (mutual exclusion)
    execReg(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "" /f`)
    execReg(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`)
    execReg(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "${pacUrl}" /f`)
    notifySystem()
    return true
  } catch {
    return false
  }
}

export function clearSystemProxy(): boolean {
  try {
    execReg(`reg add "${REG_PATH}" /v ProxyEnable /t REG_DWORD /d 0 /f`)
    execReg(`reg add "${REG_PATH}" /v ProxyServer /t REG_SZ /d "" /f`)
    execReg(`reg add "${REG_PATH}" /v AutoConfigURL /t REG_SZ /d "" /f`)
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
    // Method 1: Classic rundll32 (works on most versions)
    execSync('RUNDLL32.EXE USER32.DLL,UpdatePerUserSystemParameters 1, True', { encoding: 'utf-8', stdio: 'ignore' })
  } catch { /* ignore */ }
  try {
    // Method 2: PowerShell InternetSetOption + refresh (reliable on Win10/11)
    execSync(
      'powershell -NoProfile -Command "Add-Type -Name WinInet -Namespace Win32 -MemberDefinition @\"[DllImport(\'wininet.dll\',SetLastError=true)]public static extern bool InternetSetOption(IntPtr h,int dwOption,IntPtr lpBuffer,int dwBuffLen);\"@; [Win32.WinInet]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0); [Win32.WinInet]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)"',
      { encoding: 'utf-8', stdio: 'ignore', timeout: 5000 }
    )
  } catch { /* ignore */ }
}

export async function syncSystemProxy(proxyManager: ProxyManager, force = false): Promise<void> {
  const settings = getSettings()
  if (!force && !settings.systemProxy) {
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
      console.log(`[system-proxy] Starting PAC server for ${def.id} on port ${def.port}`)
      const port = await startPacServer('127.0.0.1', def.port, def.protocol, settings.proxyMode)
      const pacUrl = `http://127.0.0.1:${port}/proxy.pac`
      console.log(`[system-proxy] PAC server started, setting AutoConfigURL: ${pacUrl}`)
      setSystemProxyWithPAC(pacUrl)
    } catch (err) {
      console.error('[system-proxy] Failed to start PAC server:', err)
    }
  }
}
