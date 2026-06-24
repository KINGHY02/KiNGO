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
  subscriptions: StoredSubscription[]
  activeConnection: ActiveConnection | null
}

const store = new Store<NodesData>({
  name: 'nodes-store',
  defaults: {
    nodes: [],
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

function normalizeSubscription(sub: StoredSubscription, index: number): StoredSubscription {
  return {
    ...DEFAULT_SUBSCRIPTION_FIELDS,
    ...sub,
    sort: sub.sort && sub.sort > 0 ? sub.sort : index + 1,
  }
}

function getSubscriptions(): StoredSubscription[] {
  return store.get('subscriptions')
    .map((sub, index) => normalizeSubscription(sub, index))
    .sort((a, b) => a.sort - b.sort)
}

function setSubscriptions(subscriptions: StoredSubscription[]): void {
  store.set('subscriptions', subscriptions.map((sub, index) => normalizeSubscription(sub, index)))
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
  const subs = getSubscriptions()
  const sub = subs.find((s) => s.id === subId)
  if (sub) {
    sub.nodes = sub.nodes.filter((n) => n.id !== nodeId)
    setSubscriptions(subs)
  }
}

export function deleteSubscriptionNodes(subId: string, nodeIds: string[]): void {
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

export function findNodeById(id: string): { node: StoredNode; groupId: string } | undefined {
  const node = store.get('nodes').find((n) => n.id === id)
  if (node) return { node, groupId: 'manual' }
  for (const sub of getSubscriptions()) {
    const found = sub.nodes.find((n) => n.id === id)
    if (found) return { node: found, groupId: sub.id }
  }
  return undefined
}

export function getAllNodes(): Array<{ node: StoredNode; groupId: string; groupName: string }> {
  const result: Array<{ node: StoredNode; groupId: string; groupName: string }> = []
  for (const n of store.get('nodes')) {
    result.push({ node: n, groupId: 'manual', groupName: '手动添加' })
  }
  for (const sub of getSubscriptions()) {
    for (const n of sub.nodes) {
      result.push({ node: n, groupId: sub.id, groupName: sub.name })
    }
  }
  return result
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
