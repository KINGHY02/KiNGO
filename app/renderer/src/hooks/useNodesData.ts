// useNodesData — shared hook for node list data (v2rayN ViewModel equivalent)
// Module-level cache ensures data survives component remounts.
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getAllNodes, getActiveConnection, getSettings, listNodeGroups,
} from '../services/ipc-client'

const api = window.electronAPI

// ---- Module-level cache (v2rayN ViewModel state lives here) ----
let _ready = false
let _allCache: FlatNode[] = []
let _subsCache: SubInfo[] = []
let _groupsCache: NodeGroupInfo[] = []
let _connCache: ActiveConnection | null = null
let _settingsCache: AppSettings | null = null

async function fetchAll(): Promise<void> {
  const [nodes, conn, nodeGroups, subList, stg] = await Promise.all([
    getAllNodes(),
    getActiveConnection(),
    listNodeGroups(),
    api.listSubscriptions() as Promise<SubInfo[]>,
    getSettings().catch(() => null) as Promise<AppSettings | null>,
  ])
  _connCache = conn
  _groupsCache = (nodeGroups || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
  _subsCache = (subList || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
  _settingsCache = stg

  const rawEx = await api.profileListEx() as unknown as { nodeId: string; delay: number; speed: number; sort: number; ipInfo: string }[]
  const exMap = new Map(rawEx.map((e) => [e.nodeId, e]))
  const groupOrder = new Map<string, number>([
    ['manual', 0] as [string, number],
    ..._groupsCache.map((group, index): [string, number] => [group.id, index + 1]),
    ..._subsCache.map((sub, index): [string, number] => [sub.id, index + _groupsCache.length + 1]),
  ])
  const subscriptionIds = new Set(_subsCache.map((sub) => sub.id))

  _allCache = nodes.map((n: { node: StoredNode; groupId: string; groupName: string }, sourceIndex: number) => {
    const ex = exMap.get(n.node.id)
    return {
      node: n.node, groupId: n.groupId, groupName: n.groupName,
      delay: ex?.delay ?? 0, speed: ex?.speed ?? 0, sort: ex?.sort ?? 0,
      sourceIndex,
      ipInfo: ex?.ipInfo ?? '', isActive: conn?.nodeId === n.node.id,
      todayUp: '', todayDown: '', totalUp: '', totalDown: '',
    } satisfies FlatNode
  }).sort((a, b) => {
    const groupCmp = (groupOrder.get(a.groupId) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(b.groupId) ?? Number.MAX_SAFE_INTEGER)
    if (groupCmp !== 0) return groupCmp
    if (!subscriptionIds.has(a.groupId) && !subscriptionIds.has(b.groupId)) {
      const sortA = a.sort > 0 ? a.sort : Number.MAX_SAFE_INTEGER
      const sortB = b.sort > 0 ? b.sort : Number.MAX_SAFE_INTEGER
      if (sortA !== sortB) return sortA - sortB
    }
    return a.sourceIndex - b.sourceIndex
  })
  _ready = true
}

export interface FlatNode {
  node: StoredNode
  groupId: string
  groupName: string
  delay: number
  speed: number
  sort: number
  sourceIndex: number
  ipInfo: string
  isActive: boolean
  todayUp: string
  todayDown: string
  totalUp: string
  totalDown: string
}

export function useNodesData() {
  const [all, setAll] = useState<FlatNode[]>(_allCache)
  const [subs, setSubs] = useState<SubInfo[]>(_subsCache)
  const [nodeGroups, setNodeGroups] = useState<NodeGroupInfo[]>(_groupsCache)
  const [loading, setLoading] = useState(!_ready)
  const [conn, setConn] = useState<ActiveConnection | null>(_connCache)
  const [settings, setSettings] = useState<AppSettings | null>(_settingsCache)

  const fetching = useRef(false)

  const load = useCallback(async () => {
    if (_ready) {
      setAll(_allCache); setSubs(_subsCache); setNodeGroups(_groupsCache); setConn(_connCache); setSettings(_settingsCache)
      setLoading(false)
      return
    }
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
      await fetchAll()
      setAll(_allCache); setSubs(_subsCache); setNodeGroups(_groupsCache); setConn(_connCache); setSettings(_settingsCache)
    } finally {
      setLoading(false); fetching.current = false
    }
  }, [])

  useEffect(() => { load() }, [load])

  const reload = useCallback(async () => {
    _ready = false
    setLoading(true)
    await fetchAll()
    setAll(_allCache); setSubs(_subsCache); setNodeGroups(_groupsCache); setConn(_connCache); setSettings(_settingsCache)
    setLoading(false)
  }, [])

  return { all, subs, nodeGroups, loading, conn, settings, reload }
}
