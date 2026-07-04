// Shared types for MyNodes component family
// Aligns with v2rayN ProfileItemModel + ProfileExItem concepts

/** Flattened node for unified table display (v2rayN ProfileItemModel equivalent) */
export interface FlatNode {
  node: StoredNode
  groupId: string            // "manual" | subscription.id
  groupName: string          // "手动添加" | subscription.name
  delay: number              // ms, 0=untested, -1=unreachable
  speed: number              // bytes/sec, 0=untested
  sort: number               // persistent sort order
  sourceIndex: number         // original loaded/imported order
  ipInfo: string             // IP geolocation info
  isActive: boolean          // currently connected?
  todayUp: string            // formatted
  todayDown: string
  totalUp: string
  totalDown: string
}

/** Menu action type for NodeContextMenu */
export type MenuAction =
  | 'set-default'
  | 'edit-server'
  | 'copy-server'
  | 'delete-server'
  | 'connect-with-core'
  | 'dedup-servers'
  | 'clear-invalid-results'
  | 'tcping'
  | 'realping'
  | 'udp-test'
  | 'speed-test'
  | 'mixed-test'
  | 'fast-realping'
  | 'sort-by-result'
  | 'move-to-group'
  | 'move-top'
  | 'move-up'
  | 'move-down'
  | 'move-bottom'
  | 'select-all'
  | 'share-server'
  | 'export-config-file'
  | 'export-config-clipboard'
  | 'copy-share-url'
  | 'copy-share-base64'
  | 'gen-group-all'
  | 'gen-group-region'

/** v2rayN-style sort column names */
export type SortColName =
  | 'configType' | 'remarks' | 'address' | 'port'
  | 'network' | 'streamSecurity' | 'subRemarks'
  | 'delayVal' | 'speedVal' | 'ipInfo'
  | 'todayDown' | 'todayUp' | 'totalDown' | 'totalUp'

/** Extended subscription info (v2rayN SubItem aligned) */
export interface SubInfoExt {
  id: string
  name: string
  url: string
  nodes: StoredNode[]
  rawConfig: string | null
  lastUpdated: number | null
  autoUpdate: boolean
  updateInterval: number
  enabled: boolean
  moreUrl: string
  userAgent: string
  filter: string
  convertTarget: string
  memo: string
}
