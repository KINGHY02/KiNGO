// MyNodes — unified node management page (v2rayN ProfilesView aligned)
// Data comes from useNodesData hook (module-level cache = instant tab switch).

import { useState, useCallback, useMemo } from 'react'
import {
  Card, Button, Input, Space, Tag, message, Dropdown, Modal,
} from 'antd'
import {
  PlusOutlined, ThunderboltOutlined, StopOutlined, ImportOutlined,
  SearchOutlined, ColumnWidthOutlined, SettingOutlined, GlobalOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

import GroupFilter from './GroupFilter'
import type { GroupInfo } from './GroupFilter'
import NodeTable from './NodeTable'
import NodeContextMenu from './NodeContextMenu'
import ConnectCoreModal from './ConnectCoreModal'
import ImportBatchModal from './ImportBatchModal'
import AddSubscriptionModal from './AddSubscriptionModal'
import EditNodeModal from './EditNodeModal'
import type { MenuAction, SortColName } from './types'
import type { FlatNode } from '../../hooks/useNodesData'
import { useNodesData } from '../../hooks/useNodesData'

import {
  cloneNode, deleteMyNode, exportNodeClientConfig, profileMove, testNodeLatency, disconnectNode,
} from '../../services/ipc-client'

const api = window.electronAPI

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'Clash.Meta', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

const DEFAULT_CORE_BY_PROTOCOL: Record<string, string> = {
  vmess: 'xray', vless: 'xray', trojan: 'xray', ss: 'xray',
  ss2022: 'singbox', ssr: 'singbox', hysteria: 'hysteria',
  hysteria2: 'hysteria2', tuic: 'singbox', naive: 'naiveproxy',
  juicity: 'juicity', mieru: 'mieru', shadowquic: 'shadowquic',
}

function sortFlatNodes(list: FlatNode[], col: SortColName | '', asc: boolean): FlatNode[] {
  if (!col) return list
  const m = asc ? 1 : -1
  if (col === 'delayVal' || col === 'speedVal') {
    const numField: keyof FlatNode = col === 'delayVal' ? 'delay' : 'speed'
    return [...list].sort((a, b) => {
      const va = a[numField] as number; const vb = b[numField] as number
      const aValid = va > 0; const bValid = vb > 0
      if (aValid && !bValid) return -1
      if (!aValid && bValid) return 1
      if (!aValid && !bValid) return 0
      return (va - vb) * m
    })
  }
  return [...list].sort((a, b) => {
    let va: unknown, vb: unknown
    switch (col) {
      case 'configType': va = a.node.protocol; vb = b.node.protocol; break
      case 'remarks': va = a.node.name; vb = b.node.name; break
      case 'address': va = `${a.node.host}:${a.node.port}`; vb = `${b.node.host}:${b.node.port}`; break
      case 'port': va = a.node.port; vb = b.node.port; break
      case 'network': va = String(a.node.details.network || a.node.details.type || 'tcp'); vb = String(b.node.details.network || b.node.details.type || 'tcp'); break
      case 'streamSecurity': va = String(a.node.details.security || a.node.details.tls || ''); vb = String(b.node.details.security || b.node.details.tls || ''); break
      case 'subRemarks': va = a.groupName; vb = b.groupName; break
      default: return 0
    }
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m
    return String(va).localeCompare(String(vb)) * m
  })
}

export default function MyNodes(): JSX.Element {
  const { all: allNodes, subs, loading, conn: activeConn, settings, reload } = useNodesData()

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<SortColName | ''>('')
  const [sortAsc, setSortAsc] = useState(true)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const [coreModalNode, setCoreModalNode] = useState<StoredNode | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [editingNode, setEditingNode] = useState<FlatNode | null>(null)

  // ---- Filtered + sorted list ----
  const filtered = useMemo(() => {
    let list = allNodes
    if (groupFilter) list = list.filter((fn) => fn.groupId === groupFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((fn) => fn.node.name.toLowerCase().includes(q) || fn.node.host.toLowerCase().includes(q))
    }
    return sortFlatNodes(list, sortCol, sortAsc)
  }, [allNodes, groupFilter, search, sortCol, sortAsc])

  const groups: GroupInfo[] = [
    { id: 'manual', name: '手动添加', count: allNodes.filter((n) => n.groupId === 'manual').length },
    ...subs.map((s) => ({ id: s.id, name: s.name, count: allNodes.filter((n) => n.groupId === s.id).length })),
  ]

  const resolveCore = useCallback((node: StoredNode): string => {
    const map = settings?.defaultCoreByProtocol || DEFAULT_CORE_BY_PROTOCOL
    return map[node.protocol] || 'xray'
  }, [settings])

  // ---- Node actions ----
  const handleTestNodes = async (ids: string[]) => {
    if (ids.length === 0) return
    setTestingIds(new Set(ids))
    let reachable = 0
    for (const id of ids) {
      try {
        const r = (await testNodeLatency([id]))[0]
        if (r) { if (r.latency >= 0) reachable++; await reload() }
      } catch { /* skip */ }
    }
    setTestingIds(new Set())
    message.success(`测速: ${reachable}/${ids.length} 可达`)
  }

  const handleConnect = useCallback(async (fn: FlatNode) => {
    const coreId = resolveCore(fn.node)
    setConnectingId(fn.node.id)
    try {
      const r = await api.connectNode(fn.node.id, coreId)
      if (r.success) {
        message.success(`已连接: ${CORE_LABELS[coreId] || coreId}`)
        reload()
      } else Modal.error({ title: '连接失败', content: r.error || '未知错误' })
    } catch { Modal.error({ title: '连接出错' }) }
    finally { setConnectingId(null) }
  }, [resolveCore, reload])

  const handleConnectWithCore = (fn: FlatNode) => setCoreModalNode(fn.node)

  const handleConnected = () => { reload() }

  const handleDisconnect = async () => {
    if (!activeConn) return
    try { await disconnectNode(activeConn.coreId); reload() }
    catch { message.error('断开失败') }
  }

  const handleDeleteOne = async (fn: FlatNode) => {
    try { await deleteMyNode(fn.node.id, fn.groupId); reload() }
    catch { message.error('删除失败') }
  }

  const handleMove = async (direction: 'top' | 'up' | 'down' | 'bottom') => {
    const selected = allNodes.filter((fn) => selectedKeys.includes(fn.node.id))
    if (selected.length === 0) return
    const groupId = selected[0].groupId
    const ids = selected.filter((fn) => fn.groupId === groupId).map((fn) => fn.node.id)
    if (ids.length === 0) return
    await profileMove(groupId, ids, direction)
    reload()
  }

  const handleExportConfig = async (fn: FlatNode) => {
    const coreId = resolveCore(fn.node)
    const result = await exportNodeClientConfig(fn.node.id, coreId)
    if (!result.success || !result.content) {
      message.error(result.error || '导出失败')
      return
    }
    await navigator.clipboard.writeText(result.content)
    message.success(`已导出 ${CORE_LABELS[coreId] || coreId} 配置到剪贴板`)
  }

  const groupNamesForMenu = subs.map((s) => ({ id: s.id, name: s.name }))

  const handleMenuAction = async (action: MenuAction) => {
    const selected = allNodes.filter((fn) => selectedKeys.includes(fn.node.id))
    const first = selected[0]
    switch (action) {
      case 'set-default': if (first) handleConnect(first); break
      case 'connect-with-core': if (first) handleConnectWithCore(first); break
      case 'edit-server': if (first) setEditingNode(first); break
      case 'copy-server':
        if (first) {
          const cloned = await cloneNode(first.node.id)
          if (cloned) {
            message.success(`已复制: ${first.node.name}`)
            reload()
          } else {
            message.error('复制失败')
          }
        }
        break
      case 'delete-server': for (const fn of selected) { await deleteMyNode(fn.node.id, fn.groupId) } message.success(`已删除 ${selected.length} 个节点`); setSelectedKeys([]); reload(); break
      case 'dedup-servers': await handleDedup(); break
      case 'clear-invalid-results': await handleClearInvalid(); break
      case 'tcping': handleTestNodes(selected.map((n) => n.node.id)); break
      case 'sort-by-result': handleSort('delayVal'); break
      case 'move-top': await handleMove('top'); break
      case 'move-up': await handleMove('up'); break
      case 'move-down': await handleMove('down'); break
      case 'move-bottom': await handleMove('bottom'); break
      case 'select-all': setSelectedKeys(filtered.map((n) => n.node.id)); break
      case 'share-server':
      case 'copy-share-url': if (first?.node.rawUrl) { await navigator.clipboard.writeText(first.node.rawUrl); message.success('分享链接已复制') } else { message.warning('无分享链接') } break
      case 'copy-share-base64': if (first?.node.rawUrl) { await navigator.clipboard.writeText(btoa(first.node.rawUrl)); message.success('Base64 分享链接已复制') } else { message.warning('无分享链接') } break
      case 'export-config-clipboard': if (first) { await handleExportConfig(first) } break
      case 'export-config-file': if (first) { await handleExportConfig(first) } break
      default: if (typeof action === 'string' && action.startsWith('move-to-group:')) message.info('移至分组功能将在下一阶段补齐')
        else message.info('此功能即将推出')
    }
  }

  const handleDedup = async () => {
    const seen = new Map<string, FlatNode>(); const dups: FlatNode[] = []
    for (const fn of allNodes) {
      const key = `${fn.node.protocol}:${fn.node.host}:${fn.node.port}`
      const ex = seen.get(key)
      if (ex) { dups.push((fn.node.lastTested || 0) > (ex.node.lastTested || 0) ? ex : fn); if ((fn.node.lastTested || 0) > (ex.node.lastTested || 0)) seen.set(key, fn) }
      else seen.set(key, fn)
    }
    if (dups.length === 0) { message.success('没有重复节点'); return }
    for (const fn of dups) await deleteMyNode(fn.node.id, fn.groupId)
    message.success(`已删除 ${dups.length} 个重复节点`); reload()
  }

  const handleClearInvalid = async () => {
    const invalid = allNodes.filter((fn) => fn.delay < 0)
    if (invalid.length === 0) { message.success('没有无效测速结果'); return }
    for (const fn of invalid) await api.profileSetDelay(fn.node.id, 0)
    message.success(`已清除 ${invalid.length} 条无效结果`); reload()
  }

  const handleSort = (col: SortColName) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const toolbarMenu: MenuProps['items'] = [
    { key: 'tcping-all', label: '全部 TCPing', icon: <ThunderboltOutlined /> },
    { key: 'realping-all', label: '全部真实延迟', icon: <GlobalOutlined /> },
    { key: 'batch-import', label: '批量导入', icon: <ImportOutlined /> },
    { key: 'add-sub', label: '添加订阅', icon: <PlusOutlined /> },
    { type: 'divider' },
    { key: 'autofit', label: '自动列宽', icon: <ColumnWidthOutlined /> },
  ]
  const handleToolbarMenu: MenuProps['onClick'] = ({ key }) => {
    switch (key) {
      case 'tcping-all': handleTestNodes(filtered.map((n) => n.node.id)); break
      case 'realping-all': message.info('真实延迟测试即将推出'); break
      case 'batch-import': setShowImport(true); break
      case 'add-sub': setShowAddSub(true); break
      case 'autofit': message.info('自动列宽已应用'); break
    }
  }

  return (
    <div style={{ userSelect: 'none' }}>
      {activeConn && (
        <Card size="small" style={{ marginBottom: 12, borderLeft: '4px solid #52c41a' }}>
          <Space>
            <Tag color="green">⚡ 已连接: {activeConn.nodeName}</Tag>
            <Tag>{CORE_LABELS[activeConn.coreId] || activeConn.coreId}</Tag>
            <Button size="small" danger icon={<StopOutlined />} onClick={handleDisconnect}>断开</Button>
          </Space>
        </Card>
      )}
      <GroupFilter groups={groups} selected={groupFilter} onSelect={setGroupFilter} />
      <Space style={{ marginBottom: 12 }} wrap>
        <Input placeholder="搜索节点 (名称/地址)..." prefix={<SearchOutlined />} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} size="small" allowClear />
        <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleTestNodes(filtered.map((n) => n.node.id))} disabled={filtered.length === 0}>全部测速</Button>
        <Button size="small" icon={<ImportOutlined />} onClick={() => setShowImport(true)}>批量导入</Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setShowAddSub(true)}>添加订阅</Button>
        <Dropdown menu={{ items: toolbarMenu, onClick: handleToolbarMenu }}><Button size="small" icon={<SettingOutlined />}>更多</Button></Dropdown>
      </Space>
      <NodeContextMenu selectedCount={selectedKeys.length} hasActive={activeConn !== null} onAction={handleMenuAction} groupNames={groupNamesForMenu}>
        <NodeTable
          nodes={filtered} loading={loading}
          selectedRowKeys={selectedKeys} onSelectChange={setSelectedKeys}
          sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort}
          onTestNode={(id) => handleTestNodes([id])}
          onConnectNode={handleConnect} onDeleteNode={handleDeleteOne}
          onContextMenu={() => {}} onDoubleClick={handleConnect}
          testingIds={testingIds} connectingId={connectingId}
        />
      </NodeContextMenu>
      <ConnectCoreModal node={coreModalNode} open={!!coreModalNode} onClose={() => setCoreModalNode(null)} onConnected={handleConnected} />
      <ImportBatchModal open={showImport} onClose={() => setShowImport(false)} onImported={reload} />
      <AddSubscriptionModal open={showAddSub} onClose={() => setShowAddSub(false)} onDone={reload} />
      <EditNodeModal open={!!editingNode} node={editingNode} onClose={() => setEditingNode(null)} onSaved={reload} />
    </div>
  )
}
