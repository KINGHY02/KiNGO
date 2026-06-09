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
  autoUpdate: boolean
  updateInterval: number
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
  if (idx < 0) return null

  nodes[idx] = { ...nodes[idx], ...fields, id: nodes[idx].id }
  store.set('nodes', nodes)
  return nodes[idx]
}

export function clearManualNodes(): void {
  store.set('nodes', [])
}

export function deleteSubscriptionNode(subId: string, nodeId: string): void {
  const subs = store.get('subscriptions')
  const sub = subs.find((s) => s.id === subId)
  if (sub) {
    sub.nodes = sub.nodes.filter((n) => n.id !== nodeId)
    store.set('subscriptions', subs)
  }
}

export function deleteSubscriptionNodes(subId: string, nodeIds: string[]): void {
  const subs = store.get('subscriptions')
  const sub = subs.find((s) => s.id === subId)
  if (sub) {
    sub.nodes = sub.nodes.filter((n) => !nodeIds.includes(n.id))
    store.set('subscriptions', subs)
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
  const subs = store.get('subscriptions')
  for (const sub of subs) {
    const sn = sub.nodes.find((n) => n.id === id)
    if (sn) {
      sn.latency = latency
      sn.lastTested = Date.now()
      store.set('subscriptions', subs)
      return
    }
  }
}

export function findNodeById(id: string): { node: StoredNode; groupId: string } | undefined {
  const node = store.get('nodes').find((n) => n.id === id)
  if (node) return { node, groupId: 'manual' }
  for (const sub of store.get('subscriptions')) {
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
  for (const sub of store.get('subscriptions')) {
    for (const n of sub.nodes) {
      result.push({ node: n, groupId: sub.id, groupName: sub.name })
    }
  }
  return result
}

// ---- Subscriptions CRUD ----

export function listSubscriptions(): StoredSubscription[] {
  return store.get('subscriptions')
}

export function getSubscription(id: string): StoredSubscription | undefined {
  return store.get('subscriptions').find((s) => s.id === id)
}

export function addSubscription(sub: StoredSubscription): void {
  const subs = store.get('subscriptions')
  subs.push(sub)
  store.set('subscriptions', subs)
}

export function updateSubscription(id: string, fields: Partial<StoredSubscription>): void {
  const subs = store.get('subscriptions')
  const idx = subs.findIndex((s) => s.id === id)
  if (idx >= 0) {
    subs[idx] = { ...subs[idx], ...fields }
    store.set('subscriptions', subs)
  }
}

export function deleteSubscription(id: string): void {
  const subs = store.get('subscriptions').filter((s) => s.id !== id)
  store.set('subscriptions', subs)
}

// ---- Exported types ----
export type { StoredNode as SNode }
