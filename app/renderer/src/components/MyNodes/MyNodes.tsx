// MyNodes — unified node management page (v2rayN ProfilesView aligned)
// Data comes from useNodesData hook (module-level cache = instant tab switch).

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Card, Button, Input, Space, Tag, message, Dropdown, Modal, Typography,
} from 'antd'
import {
  PlusOutlined, ThunderboltOutlined, ImportOutlined,
  SearchOutlined, ColumnWidthOutlined, SettingOutlined, GlobalOutlined, EditOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, SyncOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

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
  cloneNode, deleteMyNode, exportNodeClientConfig, profileMove, testNodeLatency,
  createEmptyGroup, renameGroup, deleteEmptyGroup, moveNodeGroup, moveNodesToGroup, updateSubscription,
  onNodeLatencyProgress,
} from '../../services/ipc-client'

const api = window.electronAPI

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'mihomo / Clash', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

const DEFAULT_CORE_BY_PROTOCOL: Record<string, string> = {
  vmess: 'xray', vless: 'xray', trojan: 'xray', ss: 'xray',
  ss2022: 'singbox', ssr: 'singbox', hysteria: 'hysteria',
  hysteria2: 'singbox', tuic: 'singbox', naive: 'naiveproxy',
  juicity: 'juicity', mieru: 'mieru', shadowquic: 'shadowquic',
}

interface GroupInfo { id: string; name: string; count: number; kind: 'all' | 'manual' | 'local' | 'subscription' }
const SORT_STATE_KEY = 'kingo:v2rayn:sort-state'

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
  const { all: allNodes, subs, nodeGroups, loading, conn: activeConn, settings, reload } = useNodesData()

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [bulkTesting, setBulkTesting] = useState(false)
  const [updatingGroup, setUpdatingGroup] = useState(false)
  const [liveDelays, setLiveDelays] = useState<Record<string, number>>({})
  const [sortCol, setSortCol] = useState<SortColName | ''>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STATE_KEY) || '{}') as { col?: SortColName | '' }
      return saved.col || ''
    } catch { return '' }
  })
  const [sortAsc, setSortAsc] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STATE_KEY) || '{}') as { asc?: boolean }
      return typeof saved.asc === 'boolean' ? saved.asc : true
    } catch { return true }
  })
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const [coreModalNode, setCoreModalNode] = useState<StoredNode | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showAddSub, setShowAddSub] = useState(false)
  const [editingNode, setEditingNode] = useState<FlatNode | null>(null)
  const [groupModal, setGroupModal] = useState<{ mode: 'create' | 'rename'; id?: string; name: string } | null>(null)

  useEffect(() => {
    localStorage.setItem(SORT_STATE_KEY, JSON.stringify({ col: sortCol, asc: sortAsc }))
  }, [sortCol, sortAsc])

  useEffect(() => {
    return onNodeLatencyProgress((progress) => {
      setLiveDelays((prev) => {
        const next = { ...prev }
        for (const item of progress.results) next[item.id] = item.latency
        return next
      })
    })
  }, [])

  // ---- Filtered + sorted list ----
  const nodesWithLiveDelay = useMemo(() => {
    if (Object.keys(liveDelays).length === 0) return allNodes
    return allNodes.map((fn) => {
      const delay = liveDelays[fn.node.id]
      return delay === undefined ? fn : { ...fn, delay }
    })
  }, [allNodes, liveDelays])

  const filtered = useMemo(() => {
    let list = nodesWithLiveDelay
    if (groupFilter) list = list.filter((fn) => fn.groupId === groupFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((fn) => fn.node.name.toLowerCase().includes(q) || fn.node.host.toLowerCase().includes(q))
    }
    return sortFlatNodes(list, sortCol, sortAsc)
  }, [nodesWithLiveDelay, groupFilter, search, sortCol, sortAsc])

  const groups: GroupInfo[] = [
    { id: 'manual', name: '手动节点', count: allNodes.filter((n) => n.groupId === 'manual').length, kind: 'manual' },
    ...nodeGroups.map((group) => ({ id: group.id, name: group.name, count: allNodes.filter((n) => n.groupId === group.id).length, kind: 'local' as const })),
    ...subs.map((s) => ({ id: s.id, name: s.name, count: allNodes.filter((n) => n.groupId === s.id).length, kind: 'subscription' as const })),
  ]
  const groupItems: GroupInfo[] = [
    { id: '', name: '全部节点', count: allNodes.length, kind: 'all' },
    ...groups,
  ]
  const selectedGroupName = groupItems.find((item) => item.id === groupFilter)?.name || '全部节点'
  const selectedGroup = groupItems.find((item) => item.id === groupFilter) || null
  const selectedSub = subs.find((item) => item.id === groupFilter) || null
  const selectedLocalGroup = nodeGroups.find((item) => item.id === groupFilter) || null

  const resolveCore = useCallback((node: StoredNode): string => {
    const map = settings?.defaultCoreByProtocol || DEFAULT_CORE_BY_PROTOCOL
    return map[node.protocol] || 'xray'
  }, [settings])

  // ---- Node actions ----
  const handleTestNodes = async (ids: string[]) => {
    if (ids.length === 0) return
    const uniqueIds = Array.from(new Set(ids))
    const isBulk = uniqueIds.length > 1
    setBulkTesting(isBulk)
    setTestingIds(isBulk ? new Set() : new Set(uniqueIds))
    const key = `node-latency-${Date.now()}`
    message.loading({ content: `正在并发测速 ${uniqueIds.length} 个节点...`, key, duration: 0 })
    try {
      const results = await testNodeLatency(uniqueIds)
      const reachable = results.filter((item) => item.latency >= 0).length
      await reload()
      message.success({ content: `测速完成：${reachable}/${uniqueIds.length} 可达`, key, duration: 2 })
    } catch {
      message.error({ content: '测速失败', key, duration: 2 })
    } finally {
      setTestingIds(new Set())
      setBulkTesting(false)
    }
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

  const groupNamesForMenu = [
    { id: 'manual', name: '手动节点' },
    ...nodeGroups.map((group) => ({ id: group.id, name: group.name })),
    ...subs.map((s) => ({ id: s.id, name: s.name })),
  ]

  const handleSaveGroup = async (): Promise<void> => {
    if (!groupModal?.name.trim()) return
    const result = groupModal.mode === 'create'
      ? await createEmptyGroup(groupModal.name.trim())
      : await renameGroup(groupModal.id || '', groupModal.name.trim())
    if (!result.success) {
      message.error(result.error || '分组保存失败')
      return
    }
    message.success(groupModal.mode === 'create' ? '分组已创建' : '分组已重命名')
    setGroupModal(null)
    await reload()
  }

  const handleDeleteSelectedGroup = async (): Promise<void> => {
    const target = selectedLocalGroup || selectedSub
    if (!target) return
    const isSubscription = selectedGroup?.kind === 'subscription'
    const nodeCount = allNodes.filter((node) => node.groupId === target.id).length
    Modal.confirm({
      title: isSubscription ? '删除订阅分组' : '删除空分组',
      content: nodeCount > 0
        ? `删除“${target.name}”并移除其中 ${nodeCount} 个节点？`
        : `删除“${target.name}”？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await deleteEmptyGroup(target.id)
        if (!result.success) message.error(result.error || '删除失败')
        else {
          setGroupFilter('')
          message.success('分组已删除')
          await reload()
        }
      },
    })
  }

  const handleMoveSelectedToGroup = async (targetGroupId: string): Promise<void> => {
    const ids = selectedKeys.map(String)
    if (ids.length === 0) return
    const result = await moveNodesToGroup(ids, targetGroupId)
    if (!result.success) {
      message.error(result.error || '移动失败')
      return
    }
    setSelectedKeys([])
    if (result.copied && result.copied > 0) {
      message.success(`已添加 ${result.copied} 个本地副本${result.moved ? `，移动 ${result.moved} 个节点` : ''}`)
    } else {
      message.success(`已移动 ${result.moved ?? ids.length} 个节点`)
    }
    await reload()
  }

  const handleMoveLocalGroup = async (direction: 'up' | 'down'): Promise<void> => {
    if (!selectedLocalGroup) return
    const result = await moveNodeGroup(selectedLocalGroup.id, direction)
    if (!result.success) return
    await reload()
  }

  const handleUpdateSelectedSubscription = async (): Promise<void> => {
    if (!selectedSub) {
      message.warning('当前分组不是订阅组，无法在线更新')
      return
    }
    setUpdatingGroup(true)
    try {
      const diff = await updateSubscription(selectedSub.id)
      setSortCol('')
      setSortAsc(true)
      message.success(diff ? `订阅已更新：新增 ${diff.added}，移除 ${diff.removed}` : '订阅已更新')
      await reload()
      setUpdatingGroup(false)
    } catch {
      setUpdatingGroup(false)
      message.error('订阅更新失败')
    }
  }

  const handleNodesImported = async (): Promise<void> => {
    setSortCol('')
    setSortAsc(true)
    await reload()
  }

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
      default: if (typeof action === 'string' && action.startsWith('move-to-group:')) await handleMoveSelectedToGroup(action.slice('move-to-group:'.length))
        else message.info('当前版本暂不支持')
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
    { key: 'create-group', label: '新建空组', icon: <PlusOutlined /> },
    { type: 'divider' },
    { key: 'autofit', label: '自动列宽', icon: <ColumnWidthOutlined /> },
  ]
  const handleToolbarMenu: MenuProps['onClick'] = ({ key }) => {
    switch (key) {
      case 'tcping-all': handleTestNodes(filtered.map((n) => n.node.id)); break
      case 'realping-all': message.info('当前版本暂不支持真实延迟批量测试'); break
      case 'batch-import': setShowImport(true); break
      case 'add-sub': setShowAddSub(true); break
      case 'create-group': setGroupModal({ mode: 'create', name: '' }); break
      case 'autofit': message.info('自动列宽已应用'); break
    }
  }

  return (
    <div className="kingo-v2rayn-page" style={{ userSelect: 'none', color: 'var(--ant-color-text)' }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {groupItems.map((group) => {
            const active = groupFilter === group.id
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => setGroupFilter(group.id)}
                style={{
                  border: active ? '1px solid #1677ff' : '1px solid transparent',
                  background: active ? 'rgba(22,119,255,0.12)' : 'transparent',
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  minWidth: 52,
                }}
              >
                <Space size={5}>
                  <span>{group.name}</span>
                  {group.kind === 'local' && <Tag bordered={false} color="blue" style={{ marginInlineEnd: 0 }}>本地</Tag>}
                  {group.kind === 'subscription' && <Tag bordered={false} color="purple" style={{ marginInlineEnd: 0 }}>订阅</Tag>}
                </Space>
              </button>
            )
          })}
        </div>

        <div style={{ minWidth: 0 }}>
          <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Space wrap>
              <Typography.Text strong>{selectedGroupName}</Typography.Text>
              <Tag bordered={false}>{filtered.length} 个节点</Tag>
              <Button size="small" icon={<EditOutlined />} disabled={!selectedLocalGroup && !selectedSub} onClick={() => setGroupModal({ mode: 'rename', id: (selectedLocalGroup || selectedSub)?.id, name: (selectedLocalGroup || selectedSub)?.name || '' })}>重命名</Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedLocalGroup && !selectedSub} onClick={() => void handleDeleteSelectedGroup()}>删除组及节点</Button>
              {selectedLocalGroup && (
                <Space.Compact>
                  <Button size="small" icon={<ArrowUpOutlined />} onClick={() => void handleMoveLocalGroup('up')}>上移</Button>
                  <Button size="small" icon={<ArrowDownOutlined />} onClick={() => void handleMoveLocalGroup('down')}>下移</Button>
                </Space.Compact>
              )}
            </Space>
            <Space wrap>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setGroupModal({ mode: 'create', name: '' })}>空组</Button>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setShowAddSub(true)}>订阅</Button>
              <Button
                size="small"
                icon={<SyncOutlined spin={updatingGroup} />}
                loading={updatingGroup}
                disabled={!selectedSub || updatingGroup}
                title={selectedSub ? `更新 ${selectedSub.name}` : '只有订阅组可以在线更新'}
                onClick={() => void handleUpdateSelectedSubscription()}
              >
                更新当前组
              </Button>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={!selectedLocalGroup && !selectedSub} onClick={() => void handleDeleteSelectedGroup()}>删除</Button>
              <Input placeholder="搜索名称或地址" prefix={<SearchOutlined />} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 210 }} size="small" allowClear />
              <Button size="small" icon={<ThunderboltOutlined />} loading={bulkTesting} onClick={() => handleTestNodes(filtered.map((n) => n.node.id))} disabled={filtered.length === 0 || bulkTesting}>一键测速</Button>
              <Button size="small" icon={<ImportOutlined />} onClick={() => setShowImport(true)}>粘贴导入</Button>
              <Dropdown menu={{ items: toolbarMenu, onClick: handleToolbarMenu }}><Button size="small" icon={<SettingOutlined />}>更多</Button></Dropdown>
            </Space>
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
        </div>
      </Space>
      <ConnectCoreModal node={coreModalNode} open={!!coreModalNode} onClose={() => setCoreModalNode(null)} onConnected={handleConnected} />
      <ImportBatchModal open={showImport} onClose={() => setShowImport(false)} onImported={handleNodesImported} />
      <AddSubscriptionModal open={showAddSub} onClose={() => setShowAddSub(false)} onDone={handleNodesImported} />
      <EditNodeModal open={!!editingNode} node={editingNode} onClose={() => setEditingNode(null)} onSaved={reload} />
      <Modal
        title={groupModal?.mode === 'rename' ? '重命名分组' : '新建空组'}
        open={!!groupModal}
        onCancel={() => setGroupModal(null)}
        onOk={() => void handleSaveGroup()}
        okText="保存"
        cancelText="取消"
      >
        <Input
          autoFocus
          placeholder="分组名称"
          value={groupModal?.name || ''}
          onChange={(event) => setGroupModal((prev) => prev ? { ...prev, name: event.target.value } : prev)}
          onPressEnter={() => void handleSaveGroup()}
        />
      </Modal>
    </div>
  )
}
