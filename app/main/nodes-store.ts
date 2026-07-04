// Nodes store — persists user-imported nodes, subscriptions, and active connection state via electron-store
import Store from 'electron-store'
import { StoredNode } from './protocol-parser'

export interface StoredSubscription {
  id: string
  name: string
  url: string
  nodes: StoredNode[]
  rawConfig: string | null
  lastUpdated: number | null
  lastUpdateAttemptAt: number | null
  lastUpdateError: string | null
  autoUpdate: boolean
  updateInterval: number
  enabled: boolean
  moreUrl: string
  userAgent: string
  filter: string
  convertTarget: string
  memo: string
  sort: number
}

export interface StoredNodeGroup {
  id: string
  name: string
  nodes: StoredNode[]
  sort: number
  createdAt: number
  updatedAt: number
}

export interface ActiveConnection {
  nodeId: string
  groupId: string
  nodeName: string
  coreId: string
  pid: number | null
  connectedAt: number
}

interface NodesData {
  nodes: StoredNode[]
  nodeGroups: StoredNodeGroup[]
  subscriptions: StoredSubscription[]
  activeConnection: ActiveConnection | null
}

const store = new Store<NodesData>({
  name: 'nodes-store',
  defaults: {
    nodes: [],
    nodeGroups: [],
    subscriptions: [],
    activeConnection: null,
  },
})

const DEFAULT_SUBSCRIPTION_FIELDS = {
  rawConfig: null as string | null,
  lastUpdated: null as number | null,
  lastUpdateAttemptAt: null as number | null,
  lastUpdateError: null as string | null,
  autoUpdate: false,
  updateInterval: 12,
  enabled: true,
  moreUrl: '',
  userAgent: 'KiNGO/1.0',
  filter: '',
  convertTarget: '',
  memo: '',
  sort: 0,
}

function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeSubscription(sub: StoredSubscription, index: number): StoredSubscription {
  return {
    ...DEFAULT_SUBSCRIPTION_FIELDS,
    ...sub,
    sort: sub.sort && sub.sort > 0 ? sub.sort : index + 1,
  }
}

function getSubscriptions(): StoredSubscription[] {
  migrateLegacyEmptySubscriptions()
  return store.get('subscriptions')
    .map((sub, index) => normalizeSubscription(sub, index))
    .sort((a, b) => a.sort - b.sort)
}

function setSubscriptions(subscriptions: StoredSubscription[]): void {
  store.set('subscriptions', subscriptions.filter((sub) => sub.url.trim()).map((sub, index) => normalizeSubscription(sub, index)))
}

function normalizeNodeGroup(group: StoredNodeGroup, index: number): StoredNodeGroup {
  return {
    id: group.id,
    name: group.name || '未命名分组',
    nodes: Array.isArray(group.nodes) ? group.nodes : [],
    sort: group.sort && group.sort > 0 ? group.sort : index + 1,
    createdAt: group.createdAt || Date.now(),
    updatedAt: group.updatedAt || Date.now(),
  }
}

function getNodeGroups(): StoredNodeGroup[] {
  migrateLegacyEmptySubscriptions()
  return (store.get('nodeGroups') || [])
    .map((group, index) => normalizeNodeGroup(group, index))
    .sort((a, b) => a.sort - b.sort)
}

function setNodeGroups(groups: StoredNodeGroup[]): void {
  store.set('nodeGroups', groups.map((group, index) => normalizeNodeGroup(group, index)))
}

function migrateLegacyEmptySubscriptions(): void {
  const subs = store.get('subscriptions') || []
  const legacyGroups = subs.filter((sub) => !String(sub.url || '').trim())
  if (legacyGroups.length === 0) return

  const existingGroups = store.get('nodeGroups') || []
  const existingIds = new Set(existingGroups.map((group) => group.id))
  const migratedGroups = legacyGroups
    .filter((sub) => !existingIds.has(sub.id))
    .map((sub, index) => normalizeNodeGroup({
      id: sub.id || generateGroupId(),
      name: sub.name || '未命名分组',
      nodes: Array.isArray(sub.nodes) ? sub.nodes : [],
      sort: sub.sort || existingGroups.length + index + 1,
      createdAt: sub.lastUpdated || Date.now(),
      updatedAt: Date.now(),
    }, existingGroups.length + index))

  store.set('nodeGroups', [...existingGroups, ...migratedGroups])
  store.set('subscriptions', subs.filter((sub) => String(sub.url || '').trim()))
}

function cloneNodeData(node: StoredNode): StoredNode {
  return {
    ...node,
    id: generateNodeId(),
    name: `${node.name} - 副本`,
    details: JSON.parse(JSON.stringify(node.details)),
    createdAt: Date.now(),
    latency: null,
    lastTested: null,
  }
}

function copyNodeToLocalGroup(node: StoredNode): StoredNode {
  return {
    ...node,
    id: generateNodeId(),
    details: JSON.parse(JSON.stringify(node.details)),
    createdAt: Date.now(),
    groupId: undefined,
  }
}

// ---- Active connection (persisted across page switches) ----

export function getActiveConnection(): ActiveConnection | null {
  return store.get('activeConnection')
}

export function setActiveConnection(conn: ActiveConnection | null): void {
  store.set('activeConnection', conn)
}

// ---- Nodes CRUD ----

export function listNodes(): StoredNode[] {
  return store.get('nodes')
}

export function addNode(node: StoredNode): void {
  const nodes = store.get('nodes')
  if (nodes.some((n) => n.host === node.host && n.port === node.port && n.protocol === node.protocol)) return
  nodes.push(node)
  store.set('nodes', nodes)
}

export function addNodes(newNodes: StoredNode[]): void {
  const nodes = store.get('nodes')
  for (const node of newNodes) {
    if (!nodes.some((n) => n.host === node.host && n.port === node.port && n.protocol === node.protocol)) {
      nodes.push(node)
    }
  }
  store.set('nodes', nodes)
}

export function deleteNodes(ids: string[]): void {
  const nodes = store.get('nodes').filter((n) => !ids.includes(n.id))
  store.set('nodes', nodes)
}

export function updateNode(id: string, fields: Partial<StoredNode>): StoredNode | null {
  const nodes = store.get('nodes')
  const idx = nodes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx], ...fields, id: nodes[idx].id }
    store.set('nodes', nodes)
    return nodes[idx]
  }

  const groups = getNodeGroups()
  const group = groups.find((item) => item.nodes.some((n) => n.id === id))
  if (group) {
    const nodeIdx = group.nodes.findIndex((n) => n.id === id)
    group.nodes[nodeIdx] = { ...group.nodes[nodeIdx], ...fields, id: group.nodes[nodeIdx].id }
    group.updatedAt = Date.now()
    setNodeGroups(groups)
    return group.nodes[nodeIdx]
  }

  const subs = getSubscriptions()
  const sub = subs.find((item) => item.nodes.some((n) => n.id === id))
  if (!sub) return null
  const nodeIdx = sub.nodes.findIndex((n) => n.id === id)
  if (nodeIdx < 0) return null
  sub.nodes[nodeIdx] = { ...sub.nodes[nodeIdx], ...fields, id: sub.nodes[nodeIdx].id }
  setSubscriptions(subs)
  return sub.nodes[nodeIdx]
}

export function clearManualNodes(): void {
  store.set('nodes', [])
}

export function deleteSubscriptionNode(subId: string, nodeId: string): void {
  const groups = getNodeGroups()
  const group = groups.find((s) => s.id === subId)
  if (group) {
    group.nodes = group.nodes.filter((n) => n.id !== nodeId)
    group.updatedAt = Date.now()
    setNodeGroups(groups)
    return
  }

  const subs = getSubscriptions()
  const sub = subs.find((s) => s.id === subId)
  if (sub) {
    sub.nodes = sub.nodes.filter((n) => n.id !== nodeId)
    setSubscriptions(subs)
  }
}

export function deleteSubscriptionNodes(subId: string, nodeIds: string[]): void {
  const groups = getNodeGroups()
  const group = groups.find((s) => s.id === subId)
  if (group) {
    group.nodes = group.nodes.filter((n) => !nodeIds.includes(n.id))
    group.updatedAt = Date.now()
    setNodeGroups(groups)
    return
  }

  const subs = getSubscriptions()
  const sub = subs.find((s) => s.id === subId)
  if (sub) {
    sub.nodes = sub.nodes.filter((n) => !nodeIds.includes(n.id))
    setSubscriptions(subs)
  }
}

export function updateNodeLatency(id: string, latency: number): void {
  const nodes = store.get('nodes')
  const node = nodes.find((n) => n.id === id)
  if (node) {
    node.latency = latency
    node.lastTested = Date.now()
    store.set('nodes', nodes)
    return
  }
  const groups = getNodeGroups()
  for (const group of groups) {
    const gn = group.nodes.find((n) => n.id === id)
    if (gn) {
      gn.latency = latency
      gn.lastTested = Date.now()
      group.updatedAt = Date.now()
      setNodeGroups(groups)
      return
    }
  }
  const subs = getSubscriptions()
  for (const sub of subs) {
    const sn = sub.nodes.find((n) => n.id === id)
    if (sn) {
      sn.latency = latency
      sn.lastTested = Date.now()
      setSubscriptions(subs)
      return
    }
  }
}

export function updateNodeLatencies(results: Array<{ id: string; latency: number }>): void {
  if (results.length === 0) return
  const resultMap = new Map(results.map((item) => [item.id, item.latency]))
  const now = Date.now()

  const nodes = store.get('nodes')
  let manualChanged = false
  for (const node of nodes) {
    const latency = resultMap.get(node.id)
    if (latency === undefined) continue
    node.latency = latency
    node.lastTested = now
    manualChanged = true
  }
  if (manualChanged) store.set('nodes', nodes)

  const groups = getNodeGroups()
  let groupsChanged = false
  for (const group of groups) {
    for (const node of group.nodes) {
      const latency = resultMap.get(node.id)
      if (latency === undefined) continue
      node.latency = latency
      node.lastTested = now
      group.updatedAt = now
      groupsChanged = true
    }
  }
  if (groupsChanged) setNodeGroups(groups)

  const subs = getSubscriptions()
  let subsChanged = false
  for (const sub of subs) {
    for (const node of sub.nodes) {
      const latency = resultMap.get(node.id)
      if (latency === undefined) continue
      node.latency = latency
      node.lastTested = now
      subsChanged = true
    }
  }
  if (subsChanged) setSubscriptions(subs)
}

export function findNodeById(id: string): { node: StoredNode; groupId: string } | undefined {
  const node = store.get('nodes').find((n) => n.id === id)
  if (node) return { node, groupId: 'manual' }
  for (const group of getNodeGroups()) {
    const found = group.nodes.find((n) => n.id === id)
    if (found) return { node: found, groupId: group.id }
  }
  for (const sub of getSubscriptions()) {
    const found = sub.nodes.find((n) => n.id === id)
    if (found) return { node: found, groupId: sub.id }
  }
  return undefined
}

export function getAllNodes(): Array<{ node: StoredNode; groupId: string; groupName: string }> {
  const result: Array<{ node: StoredNode; groupId: string; groupName: string }> = []
  for (const n of store.get('nodes')) {
    result.push({ node: n, groupId: 'manual', groupName: '手动节点' })
  }
  for (const group of getNodeGroups()) {
    for (const n of group.nodes) {
      result.push({ node: n, groupId: group.id, groupName: group.name })
    }
  }
  for (const sub of getSubscriptions()) {
    for (const n of sub.nodes) {
      result.push({ node: n, groupId: sub.id, groupName: sub.name })
    }
  }
  return result
}

export function moveNodesToGroup(nodeIds: string[], targetGroupId: string): { moved: number; copied: number } {
  const moving: StoredNode[] = []
  const copiedFromSubscriptions: StoredNode[] = []
  const manualNodes = store.get('nodes')
  const groups = getNodeGroups()
  const targetIsLocalGroup = targetGroupId === 'manual' || groups.some((group) => group.id === targetGroupId)
  const nextManualNodes = manualNodes.filter((node) => {
    if (nodeIds.includes(node.id)) {
      moving.push(node)
      return false
    }
    return true
  })

  const subs = getSubscriptions()
  for (const group of groups) {
    const kept: StoredNode[] = []
    for (const node of group.nodes) {
      if (nodeIds.includes(node.id)) moving.push(node)
      else kept.push(node)
    }
    if (kept.length !== group.nodes.length) {
      group.nodes = kept
      group.updatedAt = Date.now()
    }
  }
  for (const sub of subs) {
    const kept: StoredNode[] = []
    for (const node of sub.nodes) {
      if (nodeIds.includes(node.id)) {
        if (targetIsLocalGroup) {
          copiedFromSubscriptions.push(copyNodeToLocalGroup(node))
          kept.push(node)
        } else {
          moving.push(node)
        }
      } else {
        kept.push(node)
      }
    }
    sub.nodes = kept
  }

  const uniqueMoving = [...moving, ...copiedFromSubscriptions]
    .filter((node, index, arr) => arr.findIndex((item) => item.id === node.id) === index)
  if (targetGroupId === 'manual') {
    nextManualNodes.push(...uniqueMoving)
  } else {
    const groupTarget = groups.find((group) => group.id === targetGroupId)
    if (groupTarget) {
      groupTarget.nodes.push(...uniqueMoving)
      groupTarget.updatedAt = Date.now()
      store.set('nodes', nextManualNodes)
      setNodeGroups(groups)
      setSubscriptions(subs)
      return { moved: moving.length, copied: copiedFromSubscriptions.length }
    }
    const target = subs.find((sub) => sub.id === targetGroupId)
    if (!target) throw new Error('目标分组不存在')
    target.nodes.push(...uniqueMoving)
  }

  store.set('nodes', nextManualNodes)
  setNodeGroups(groups)
  setSubscriptions(subs)
  return { moved: moving.length, copied: copiedFromSubscriptions.length }
}

export function cloneNode(nodeId: string): { node: StoredNode; groupId: string } | null {
  const manualNodes = store.get('nodes')
  const manualNode = manualNodes.find((node) => node.id === nodeId)
  if (manualNode) {
    const cloned = cloneNodeData({ ...manualNode, groupId: 'manual' })
    manualNodes.push(cloned)
    store.set('nodes', manualNodes)
    return { node: cloned, groupId: 'manual' }
  }

  const groups = getNodeGroups()
  const group = groups.find((item) => item.nodes.some((node) => node.id === nodeId))
  if (group) {
    const original = group.nodes.find((node) => node.id === nodeId)
    if (!original) return null
    const cloned = cloneNodeData({ ...original, groupId: group.id })
    group.nodes.push(cloned)
    group.updatedAt = Date.now()
    setNodeGroups(groups)
    return { node: cloned, groupId: group.id }
  }

  const subs = getSubscriptions()
  const sub = subs.find((item) => item.nodes.some((node) => node.id === nodeId))
  if (!sub) return null
  const original = sub.nodes.find((node) => node.id === nodeId)
  if (!original) return null
  const cloned = cloneNodeData({ ...original, groupId: sub.id })
  sub.nodes.push(cloned)
  setSubscriptions(subs)
  return { node: cloned, groupId: sub.id }
}

// ---- Subscriptions CRUD ----

export function listSubscriptions(): StoredSubscription[] {
  return getSubscriptions()
}

export function listNodeGroups(): StoredNodeGroup[] {
  return getNodeGroups()
}

export function getNodeGroup(id: string): StoredNodeGroup | undefined {
  return getNodeGroups().find((group) => group.id === id)
}

export function createNodeGroup(name: string): StoredNodeGroup {
  const groups = getNodeGroups()
  const now = Date.now()
  const group: StoredNodeGroup = {
    id: generateGroupId(),
    name: name.trim(),
    nodes: [],
    sort: groups.length + 1,
    createdAt: now,
    updatedAt: now,
  }
  setNodeGroups([...groups, group])
  return group
}

export function renameNodeGroup(id: string, name: string): boolean {
  const groups = getNodeGroups()
  const group = groups.find((item) => item.id === id)
  if (!group) return false
  group.name = name.trim()
  group.updatedAt = Date.now()
  setNodeGroups(groups)
  return true
}

export function deleteNodeGroup(id: string, force = false): boolean {
  const groups = getNodeGroups()
  const group = groups.find((item) => item.id === id)
  if (!group || (!force && group.nodes.length > 0)) return false
  setNodeGroups(groups.filter((item) => item.id !== id))
  return true
}

export function moveNodeGroup(id: string, direction: 'up' | 'down'): boolean {
  const groups = getNodeGroups()
  const index = groups.findIndex((item) => item.id === id)
  if (index < 0) return false
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= groups.length) return false
  ;[groups[index], groups[targetIndex]] = [groups[targetIndex], groups[index]]
  setNodeGroups(groups.map((group, itemIndex) => ({ ...group, sort: itemIndex + 1, updatedAt: Date.now() })))
  return true
}

export function getSubscription(id: string): StoredSubscription | undefined {
  return getSubscriptions().find((s) => s.id === id)
}

export function addSubscription(sub: StoredSubscription): void {
  const subs = getSubscriptions()
  subs.push(sub)
  setSubscriptions(subs)
}

export function updateSubscription(id: string, fields: Partial<StoredSubscription>): void {
  const subs = getSubscriptions()
  const idx = subs.findIndex((s) => s.id === id)
  if (idx >= 0) {
    subs[idx] = { ...subs[idx], ...fields }
    setSubscriptions(subs)
  }
}

export function deleteSubscription(id: string): void {
  const subs = getSubscriptions().filter((s) => s.id !== id)
  setSubscriptions(subs)
}

// ---- Exported types ----
export type { StoredNode as SNode }
