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

export async function getAppConnectionState(): Promise<AppConnectionState> {
  return api.getAppConnectionState()
}

export async function disconnectAllConnections(): Promise<{ success: boolean; error?: string }> {
  return api.disconnectAllConnections()
}

export async function getExitIpInfo(): Promise<ExitIpInfo> {
  return api.getExitIpInfo()
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

export async function listPublicRoutes(): Promise<PublicRoute[]> {
  return api.listPublicRoutes()
}

export async function getPublicConnectionState(): Promise<PublicConnectionState> {
  return api.getPublicConnectionState()
}

export async function selectPublicRoute(routeId: string): Promise<PublicRouteResult> {
  return api.selectPublicRoute(routeId)
}

export async function connectPublicRoute(routeId?: string): Promise<PublicRouteResult> {
  return api.connectPublicRoute(routeId)
}

export async function disconnectPublicRoute(): Promise<PublicRouteResult> {
  return api.disconnectPublicRoute()
}

export async function repairPublicNetwork(): Promise<PublicRouteResult> {
  return api.repairPublicNetwork()
}

export async function diagnosePublicRoute(routeId?: string): Promise<PublicRouteDiagnosticReport> {
  return api.diagnosePublicRoute(routeId)
}

export async function updatePublicRoute(routeId: string): Promise<PublicRouteResult> {
  return api.updatePublicRoute(routeId)
}

export async function updateAllPublicRoutes(): Promise<{ success: boolean; updated: number; failed: number }> {
  return api.updateAllPublicRoutes()
}

export function onPublicRouteStateChanged(callback: (state: PublicConnectionState) => void): () => void {
  return api.onPublicRouteStateChanged(callback)
}

export function onPublicRoutesChanged(callback: (routes: PublicRoute[]) => void): () => void {
  return api.onPublicRoutesChanged(callback)
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

export async function checkCoreVersions(): Promise<CoreVersionInfo[]> {
  return api.checkCoreVersions()
}

export async function getCoreUpdateInfo(proxyId: string): Promise<{ success: boolean; proxyId: string; version?: string; assetName?: string; assetSize?: number; downloadUrl?: string; checksumAvailable?: boolean; checksumAssetName?: string; error?: string }> {
  return api.getCoreUpdateInfo(proxyId)
}

export async function updateCore(proxyId: string): Promise<{ success: boolean; proxyId: string; version?: string; source?: string; executablePath?: string; checksumVerified?: boolean; checksumAssetName?: string; checksumError?: string; error?: string }> {
  return api.updateCore(proxyId)
}

export async function restoreBundledCore(proxyId: string): Promise<{ success: boolean; proxyId: string; error?: string }> {
  return api.restoreBundledCore(proxyId)
}

export async function openCoreDir(proxyId: string): Promise<{ success: boolean; error?: string }> {
  return api.openCoreDir(proxyId)
}

export function onCoreUpdateProgress(callback: (progress: CoreUpdateProgress) => void): () => void {
  return api.onCoreUpdateProgress(callback)
}

export async function listCoreProfiles(): Promise<CoreProfile[]> {
  return api.listCoreProfiles()
}

export async function startClashProfile(profileId = 'default'): Promise<{ success: boolean; pid?: number; error?: string }> {
  return api.startClashProfile(profileId)
}

export async function stopClash(): Promise<{ success: boolean; error?: string }> {
  return api.stopClash()
}

export async function getClashGroups(): Promise<ClashGroup[]> {
  return api.getClashGroups()
}

export async function getClashConfig(): Promise<{ mode: 'rule' | 'global' | 'direct' }> {
  return api.getClashConfig()
}

export async function setClashMode(mode: 'rule' | 'global' | 'direct'): Promise<{ success: boolean; error?: string }> {
  return api.setClashMode(mode)
}

export async function getClashRuntimeOptions(): Promise<{ tunEnabled: boolean }> {
  return api.getClashRuntimeOptions()
}

export async function updateClashRuntimeOptions(options: { tunEnabled?: boolean }): Promise<{ success: boolean; error?: string }> {
  return api.updateClashRuntimeOptions(options)
}

export async function diagnoseClashTun(): Promise<TunDiagnosticReport> {
  return api.diagnoseClashTun()
}

export async function listClashProfiles(): Promise<ClashProfile[]> {
  return api.listClashProfiles()
}

export async function saveClashProfile(input: { id?: string; name: string; content: string }): Promise<{ success: boolean; error?: string; profile?: ClashProfile }> {
  return api.saveClashProfile(input)
}

export async function saveClashProfileFromUrl(input: { id?: string; name: string; url: string; autoUpdate?: boolean; updateInterval?: number }): Promise<{ success: boolean; error?: string; profile?: ClashProfile }> {
  return api.saveClashProfileFromUrl(input)
}

export async function updateClashProfile(profileId: string): Promise<{ success: boolean; error?: string; profile?: ClashProfile }> {
  return api.updateClashProfile(profileId)
}

export async function updateClashProfileOptions(profileId: string, options: { autoUpdate?: boolean; updateInterval?: number }): Promise<{ success: boolean; error?: string }> {
  return api.updateClashProfileOptions(profileId, options)
}

export async function deleteClashProfile(profileId: string): Promise<{ success: boolean; error?: string }> {
  return api.deleteClashProfile(profileId)
}

export async function selectClashGroupProxy(groupName: string, proxyName: string): Promise<{ success: boolean; error?: string }> {
  return api.selectClashGroupProxy(groupName, proxyName)
}

export async function testClashProxyDelay(proxyName: string): Promise<{ success: boolean; delay: number; error?: string }> {
  return api.testClashProxyDelay(proxyName)
}

export async function getClashConnections(): Promise<ClashConnection[]> {
  return api.getClashConnections()
}

export async function closeClashConnection(id: string): Promise<{ success: boolean; error?: string }> {
  return api.closeClashConnection(id)
}

export async function closeAllClashConnections(): Promise<{ success: boolean; error?: string }> {
  return api.closeAllClashConnections()
}

export async function getClashTrafficOverview(): Promise<ClashTrafficOverview> {
  return api.getClashTrafficOverview()
}

// Node management (unified)
export async function importNodeUrl(url: string): Promise<StoredNode | null> {
  return api.importNodeUrl(url)
}

export async function importNodeBatch(urls: string[]): Promise<StoredNode[]> {
  return api.importNodeBatch(urls)
}

export async function listAllNodes(): Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>> {
  return api.listAllNodes()
}

export async function deleteNodeOne(nodeId: string, groupId: string): Promise<void> {
  return api.deleteNodeOne(nodeId, groupId)
}

export async function deleteNodeMany(nodeIds: string[], groupId: string): Promise<void> {
  return api.deleteNodeMany(nodeIds, groupId)
}

export async function listNodes(): Promise<StoredNode[]> {
  return api.listNodes()
}

export async function getNode(id: string): Promise<(StoredNode & { groupId: string }) | null> {
  return api.getNode(id)
}

export async function updateNode(id: string, fields: Partial<StoredNode>): Promise<StoredNode | null> {
  return api.updateNode(id, fields)
}

export async function cloneNode(id: string): Promise<{ node: StoredNode; groupId: string } | null> {
  return api.cloneNode(id)
}

export async function deleteNodes(ids: string[]): Promise<void> {
  return api.deleteNodes(ids)
}

export async function testNodeLatency(ids: string[]): Promise<{ id: string; latency: number }[]> {
  return api.testNodeLatency(ids)
}

export function onNodeLatencyProgress(
  callback: (progress: { done: number; total: number; results: { id: string; latency: number }[] }) => void
): () => void {
  return api.onNodeLatencyProgress(callback)
}

export async function getCompatibleCores(protocol: string): Promise<CompatibleCore[]> {
  return api.getCompatibleCores(protocol)
}

export async function exportNodeClientConfig(nodeId: string, coreId: string): Promise<{ success: boolean; content?: string; format?: 'yaml' | 'json'; error?: string }> {
  return api.exportNodeClientConfig(nodeId, coreId)
}

export async function connectNode(nodeId: string, coreId: string): Promise<{ success: boolean; pid?: number; error?: string }> {
  return api.connectNode(nodeId, coreId)
}

export async function disconnectNode(coreId: string): Promise<{ success: boolean; error?: string }> {
  return api.disconnectNode(coreId)
}

export async function getActiveConnection(): Promise<ActiveConnection | null> {
  return api.getActiveConnection()
}

export async function getAllNodes(): Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>> {
  return api.listAllNodes()
}

export async function deleteMyNode(nodeId: string, groupId: string): Promise<void> {
  return api.deleteNodeOne(nodeId, groupId)
}

// Subscription management
export async function listSubscriptions(): Promise<SubInfo[]> {
  return api.listSubscriptions()
}

export async function getSubscription(id: string): Promise<SubInfo | null> {
  return api.getSubscription(id)
}

export async function addSubscription(name: string, url: string): Promise<{ sub: SubInfo; diff: { added: number; removed: number; unchanged: number } | null; error?: string }> {
  return api.addSubscription(name, url)
}

export async function saveSubscription(input: {
  id?: string
  name: string
  url: string
  autoUpdate?: boolean
  updateInterval?: number
  enabled?: boolean
  moreUrl?: string
  userAgent?: string
  filter?: string
  convertTarget?: string
  memo?: string
  refresh?: boolean
}): Promise<{ sub: SubInfo; error: string | null }> {
  return api.saveSubscription(input)
}

export async function updateSubscription(id: string): Promise<{ added: number; removed: number; unchanged: number } | null> {
  return api.updateSubscription(id)
}

export async function deleteSubscription(id: string): Promise<void> {
  return api.deleteSubscription(id)
}

export async function toggleAutoUpdate(id: string, enabled: boolean): Promise<void> {
  return api.toggleAutoUpdate(id, enabled)
}

export async function toggleSubscriptionEnabled(id: string, enabled: boolean): Promise<void> {
  return api.toggleSubscriptionEnabled(id, enabled)
}

export async function listNodeGroups(): Promise<NodeGroupInfo[]> {
  return api.listNodeGroups()
}

export async function createEmptyGroup(name: string): Promise<{ success: boolean; error?: string; group?: NodeGroupInfo }> {
  return api.createEmptyGroup(name)
}

export async function renameGroup(id: string, name: string): Promise<{ success: boolean; error?: string }> {
  return api.renameGroup(id, name)
}

export async function deleteEmptyGroup(id: string): Promise<{ success: boolean; error?: string }> {
  return api.deleteEmptyGroup(id)
}

export async function moveNodeGroup(id: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> {
  return api.moveNodeGroup(id, direction)
}

export async function moveNodesToGroup(nodeIds: string[], targetGroupId: string): Promise<{ success: boolean; error?: string; moved?: number; copied?: number }> {
  return api.moveNodesToGroup(nodeIds, targetGroupId)
}

export function onStatusChanged(callback: (status: ProxyStatus) => void): () => void {
  return api.onStatusChanged(callback)
}

export function onAppConnectionStateChanged(callback: (state: AppConnectionState) => void): () => void {
  return api.onAppConnectionStateChanged(callback)
}

export function onLog(callback: (entry: LogEntry) => void): () => void {
  return api.onLog(callback)
}

export function onProxyUpdateProgress(callback: (progress: { proxyId: string; slot: number; percent: number }) => void): () => void {
  return api.onProxyUpdateProgress(callback)
}
// ProfileEx / Sort (V2rayN-style)
export async function profileSort(colName: string, asc: boolean, groupId: string): Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>> {
  return api.profileSort(colName, asc, groupId)
}

export async function profileGetEx(nodeId: string): Promise<{ nodeId: string; delay: number; sort: number; lastTested: number | null } | null> {
  return api.profileGetEx(nodeId)
}

export async function profileListEx(): Promise<Array<{ nodeId: string; delay: number; sort: number; lastTested: number | null }>> {
  return api.profileListEx()
}

export async function profileSetDelay(nodeId: string, delay: number): Promise<{ success: boolean }> {
  return api.profileSetDelay(nodeId, delay)
}

export async function profileMove(groupId: string, nodeIds: string[], direction: 'top' | 'up' | 'down' | 'bottom'): Promise<Array<{ node: StoredNode; groupId: string; groupName: string }>> {
  return api.profileMove(groupId, nodeIds, direction)
}
