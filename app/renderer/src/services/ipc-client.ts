// Type-safe IPC client for the renderer process
// All calls go through window.electronAPI (exposed via contextBridge)

const api = window.electronAPI

export async function startProxy(proxyId: string): Promise<{ success: boolean; pid?: number; error?: string }> {
  return api.startProxy(proxyId)
}

export async function stopProxy(proxyId: string): Promise<{ success: boolean; error?: string }> {
  return api.stopProxy(proxyId)
}

export async function getProxyStatus(): Promise<ProxyStatus[]> {
  return api.getProxyStatus()
}

export async function getConfig(proxyId: string): Promise<{ content: string; format: string; backupExists: boolean }> {
  return api.getConfig(proxyId)
}

export async function saveConfig(proxyId: string, content: string): Promise<{ success: boolean; error?: string }> {
  return api.saveConfig(proxyId, content)
}

export async function restoreBackup(proxyId: string): Promise<{ success: boolean }> {
  return api.restoreBackup(proxyId)
}

export async function testLatency(proxyId: string): Promise<{
  current: { host: string; port: number; latency: number }[]
  slots: { slot: number; description: string; nodes: { host: string; port: number; latency: number }[] }[]
}> {
  return api.testLatency(proxyId)
}

export async function testRealLatency(proxyId: string): Promise<{ latency: number }> {
  return api.testRealLatency(proxyId)
}

export async function updateIP(proxyId: string, slot: number): Promise<{ success: boolean; error?: string }> {
  return api.updateIP(proxyId, slot)
}

export async function getSlots(proxyId: string): Promise<SlotInfo[]> {
  return api.getSlots(proxyId)
}

export async function getCurrentSlot(proxyId: string): Promise<{ slot: number; description: string; updatedAt: string } | null> {
  return api.getCurrentSlot(proxyId)
}

export async function switchSlot(proxyId: string, slot: number): Promise<{ success: boolean; error?: string }> {
  return api.switchSlot(proxyId, slot)
}

export async function launchChrome(): Promise<{ success: boolean; error?: string }> {
  return api.launchChrome()
}

export async function getSettings(): Promise<AppSettings> {
  return api.getSettings()
}

export async function setSettings(settings: Partial<AppSettings>): Promise<{ success: boolean }> {
  return api.setSettings(settings)
}

export async function getSystemProxyStatus(): Promise<{ enabled: boolean; server: string | null; pacUrl: string | null }> {
  return api.getSystemProxyStatus()
}

export async function getLogs(proxyId?: string, limit?: number): Promise<LogEntry[]> {
  return api.getLogs(proxyId, limit)
}

export async function clearLogs(): Promise<{ success: boolean }> {
  return api.clearLogs()
}

export async function minimizeWindow(): Promise<void> {
  return api.minimizeWindow()
}

export async function maximizeWindow(): Promise<void> {
  return api.maximizeWindow()
}

export async function closeWindow(): Promise<void> {
  return api.closeWindow()
}

export async function isMaximized(): Promise<boolean> {
  return api.isMaximized()
}

export async function checkForUpdates(): Promise<{ checking: boolean }> {
  return api.checkForUpdates()
}

export async function downloadUpdate(): Promise<void> {
  return api.downloadUpdate()
}

export function installUpdate(): void {
  api.installUpdate()
}

export async function getAppVersion(): Promise<string> {
  return api.getAppVersion()
}

export async function setUpdateFeedURL(url: string): Promise<void> {
  return api.setUpdateFeedURL(url)
}

export function onStatusChanged(callback: (status: ProxyStatus) => void): () => void {
  return api.onStatusChanged(callback)
}

export function onLog(callback: (entry: LogEntry) => void): () => void {
  return api.onLog(callback)
}

export function onProxyUpdateProgress(callback: (progress: { proxyId: string; slot: number; percent: number }) => void): () => void {
  return api.onProxyUpdateProgress(callback)
}
