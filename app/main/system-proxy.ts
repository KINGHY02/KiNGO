import { execSync } from 'child_process'

export function setSystemProxy(enable: boolean, proxyAddress?: string): boolean {
  try {
    if (enable && proxyAddress) {
      // Enable proxy
      execSync(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`,
        { encoding: 'utf-8' }
      )
      execSync(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddress}" /f`,
        { encoding: 'utf-8' }
      )
    } else {
      // Disable proxy
      execSync(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`,
        { encoding: 'utf-8' }
      )
    }
    // Notify system of settings change
    execSync('RUNDLL32.EXE USER32.DLL,UpdatePerUserSystemParameters 1, True', { encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}
