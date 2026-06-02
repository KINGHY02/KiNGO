import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { ProxyManager, PROXY_DEFINITIONS } from './proxy-manager'

export function launchChrome(
  baseDir: string,
  proxyManager: ProxyManager
): { success: boolean; error?: string } {
  // Find Chrome executable
  let chromePath = join(baseDir, 'Browser', 'chrome.exe')
  if (!existsSync(chromePath)) {
    // Fallback: try system Chrome via registry
    try {
      const regOutput = execSync(
        'reg query "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve 2>nul',
        { encoding: 'utf-8' }
      )
      const match = regOutput.match(/REG_SZ\s+(.+)/)
      if (match && match[1]) {
        chromePath = match[1].trim()
      }
    } catch {
      return { success: false, error: '未找到 Chrome 浏览器，请将 Chrome 放入 Browser 目录' }
    }
  }

  if (!existsSync(chromePath)) {
    return { success: false, error: '未找到 Chrome 浏览器' }
  }

  // Find the first running proxy to determine proxy settings
  const statuses = proxyManager.getStatus()
  const activeProxy = statuses.find((s) => s.running)
  if (!activeProxy) {
    return { success: false, error: '没有运行中的代理，请先启动一个代理' }
  }

  const proxyArg =
    activeProxy.protocol === 'http'
      ? `127.0.0.1:${activeProxy.port}`
      : `socks5://127.0.0.1:${activeProxy.port}`

  const userDataDir = join(baseDir, 'chrome-user-data')

  try {
    const proc = spawn(
      chromePath,
      [
        `--user-data-dir=${userDataDir}`,
        `--proxy-server=${proxyArg}`,
        'https://www.google.com'
      ],
      {
        detached: true,
        stdio: 'ignore'
      }
    )
    proc.unref()
    return { success: true }
  } catch (err) {
    return { success: false, error: `启动 Chrome 失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
