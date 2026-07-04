// NodeTable — unified node table (v2rayN ProfilesView DataGrid aligned)
// Uses antd Table's onRow for selection + native keydown for keyboard shortcuts
import { useRef, useEffect, useCallback, useMemo } from 'react'
import { Table, Tag, Button, Space } from 'antd'
import { ThunderboltOutlined, PlayCircleOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { FlatNode, SortColName } from './types'

const PROTOCOL_COLORS: Record<string, string> = {
  vmess: 'blue', vless: 'purple', trojan: 'orange', ss: 'green',
  ssr: 'cyan', hysteria: 'magenta', hysteria2: 'pink', tuic: 'gold',
  naive: 'volcano', juicity: 'geekblue', mieru: 'lime', shadowquic: 'red',
  socks: 'default', http: 'default', wireguard: 'blue', anytls: 'geekblue',
}

const latencyColor = (ms: number): string => {
  if (ms < 0) return 'default'; if (ms < 100) return 'green'; if (ms < 300) return 'orange'; return 'red'
}
const latencyText = (ms: number): string => {
  if (ms < 0) return '\u4e0d\u53ef\u8fbe'; if (ms === 0) return '-'; return `${ms}ms`
}
const speedText = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB/s`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`
}

interface Props {
  nodes: FlatNode[]
  loading: boolean
  selectedRowKeys: React.Key[]
  onSelectChange: (keys: React.Key[]) => void
  sortCol: string
  sortAsc: boolean
  onSort: (col: SortColName) => void
  onTestNode: (nodeId: string) => void
  onConnectNode: (node: FlatNode) => void
  onDeleteNode: (node: FlatNode) => void
  onContextMenu: (node: FlatNode | null) => void
  onDoubleClick: (node: FlatNode) => void
  testingIds: Set<string>
  connectingId: string | null
}

export default function NodeTable({
  nodes, loading, selectedRowKeys, onSelectChange,
  sortCol, sortAsc, onSort, onTestNode, onConnectNode, onDeleteNode,
  onContextMenu, onDoubleClick, testingIds, connectingId,
}: Props): JSX.Element {
  const sortArrow = (col: string) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''
  const containerRef = useRef<HTMLDivElement>(null)
  const lastClickedIdx = useRef<number>(-1)
  const dataSource = useMemo(() => nodes.map((fn) => ({ ...fn, key: fn.node.id })), [nodes])

  // Keep mutable refs so the stable native keydown handler reads latest state
  const selRef = useRef(selectedRowKeys); selRef.current = selectedRowKeys
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const onDelRef = useRef(onDeleteNode); onDelRef.current = onDeleteNode
  const onConnRef = useRef(onConnectNode); onConnRef.current = onConnectNode
  const onSelectRef = useRef(onSelectChange); onSelectRef.current = onSelectChange

  // ---- Helper: apply/remove selection class directly to DOM rows (instant) ----
  const setRowSelected = useCallback((rowKey: string, selected: boolean) => {
    const el = containerRef.current
    if (!el) return
    const row = el.querySelector(`[data-row-key="${CSS.escape(rowKey)}"]`)
    if (!row) return
    if (selected) row.classList.add('node-row-selected')
    else row.classList.remove('node-row-selected')
  }, [])

  const clearAllRowSelection = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.querySelectorAll('.node-row-selected').forEach((r) => r.classList.remove('node-row-selected'))
  }, [])

  // ---- Keyboard via native listener (fires regardless of focus quirks) ----
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const curSel = selRef.current
      const curNodes = nodesRef.current
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a') { e.preventDefault(); onSelectRef.current(curNodes.map((n) => n.node.id)) }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (curSel.length > 0) {
          e.preventDefault()
          for (const id of curSel) { const fn = curNodes.find((n) => n.node.id === id); if (fn) onDelRef.current(fn) }
          onSelectRef.current([])
        }
      } else if (e.key === 'Enter') {
        if (curSel.length === 1) {
          e.preventDefault()
          const fn = curNodes.find((n) => n.node.id === curSel[0])
          if (fn) onConnRef.current(fn)
        }
      }
    }
    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [])

  // ---- Row click: antd onRow — applies DOM-level highlight INSTANTLY then syncs React state ----
  const onRow = useCallback((record: FlatNode, idx?: number) => {
    const i = idx ?? 0
    return {
      onClick: (e: React.MouseEvent) => {
        // Skip if clicking on a button
        if ((e.target as HTMLElement).closest('button, a, .ant-btn')) return

        const nodeId = record.node.id
        if (e.ctrlKey || e.metaKey) {
          const sel = !selectedRowKeys.includes(nodeId)
          // Instant DOM highlight
          if (sel) {
            setRowSelected(nodeId, true)
            onSelectChange([...selectedRowKeys, nodeId])
          } else {
            setRowSelected(nodeId, false)
            onSelectChange(selectedRowKeys.filter((k) => k !== nodeId))
          }
          lastClickedIdx.current = i
        } else if (e.shiftKey && lastClickedIdx.current >= 0) {
          const allIds = nodes.map((n) => n.node.id)
          const start = Math.min(lastClickedIdx.current, i)
          const end = Math.max(lastClickedIdx.current, i)
          const rangeIds = allIds.slice(start, end + 1)
          const merged = new Set([...selectedRowKeys, ...rangeIds])
          // Instant DOM highlight for range
          for (const id of rangeIds) setRowSelected(id, true)
          onSelectChange(Array.from(merged))
        } else {
          // Plain click — clear all DOM highlights first, then select one
          clearAllRowSelection()
          setRowSelected(nodeId, true)
          onSelectChange([nodeId])
          lastClickedIdx.current = i
        }
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        if (!selectedRowKeys.includes(record.node.id)) {
          clearAllRowSelection()
          setRowSelected(record.node.id, true)
          onSelectChange([record.node.id])
        }
        onContextMenu(record)
      },
      onDoubleClick: () => onDoubleClick(record),
    }
  }, [nodes, selectedRowKeys, onSelectChange, onContextMenu, onDoubleClick, setRowSelected, clearAllRowSelection])

  const columns: ColumnsType<FlatNode> = [
    { title: '#', key: 'rowNum', width: 40, align: 'center', render: (_: unknown, __: FlatNode, idx: number) => idx + 1 },
    {
      title: <a onClick={() => onSort('configType')}>{'\u7c7b\u578b'}{sortArrow('configType')}</a>,
      dataIndex: ['node', 'protocol'], key: 'configType', width: 70, ellipsis: true,
      render: (p: string) => <Tag color={PROTOCOL_COLORS[p] || 'default'} style={{ margin: 0 }}>{p}</Tag>,
    },
    {
      title: <a onClick={() => onSort('remarks')}>{'\u5907\u6ce8'}{sortArrow('remarks')}</a>,
      key: 'remarks', width: 190, ellipsis: true,
      render: (_: unknown, r: FlatNode) => (
        <span className="node-cell-ellipsis">
          {r.isActive && <Tag color="green" style={{ marginRight: 4, fontSize: 10, padding: '0 4px' }}>{'\u6d3b'}</Tag>}
          {r.node.name}
        </span>
      ),
    },
    {
      title: <a onClick={() => onSort('address')}>{'\u5730\u5740'}{sortArrow('address')}</a>,
      key: 'address', width: 190, ellipsis: true,
      render: (_: unknown, r: FlatNode) => `${r.node.host}:${r.node.port}`,
    },
    {
      title: <a onClick={() => onSort('port')}>{'\u7aef\u53e3'}{sortArrow('port')}</a>,
      dataIndex: ['node', 'port'], key: 'port', width: 64, align: 'right',
    },
    {
      title: <a onClick={() => onSort('delayVal')}>{'\u5ef6\u8fdf'}{sortArrow('delayVal')}</a>,
      dataIndex: 'delay', key: 'delayVal', width: 82,
      render: (ms: number) => {
        if (ms === 0) return <span style={{ color: '#999' }}>-</span>
        return <Tag color={latencyColor(ms)}>{latencyText(ms)}</Tag>
      },
    },
    {
      title: <a onClick={() => onSort('network')}>{'\u4f20\u8f93'}{sortArrow('network')}</a>,
      key: 'network', width: 76, ellipsis: true,
      render: (_: unknown, r: FlatNode) => {
        const net = String(r.node.details.network || r.node.details.type || 'tcp')
        return <Tag style={{ margin: 0 }}>{net}</Tag>
      },
    },
    {
      title: <a onClick={() => onSort('streamSecurity')}>TLS{sortArrow('streamSecurity')}</a>,
      key: 'streamSecurity', width: 68,
      render: (_: unknown, r: FlatNode) => {
        const sec = String(r.node.details.security || r.node.details.tls || '')
        if (!sec || sec === 'none') return '-'
        return <Tag color={sec === 'reality' ? 'purple' : 'blue'} style={{ margin: 0 }}>{sec}</Tag>
      },
    },
    {
      title: <a onClick={() => onSort('subRemarks')}>{'\u8ba2\u9605'}{sortArrow('subRemarks')}</a>,
      dataIndex: 'groupName', key: 'subRemarks', width: 100, ellipsis: true,
    },
    {
      title: <a onClick={() => onSort('speedVal')}>{'\u901f\u5ea6'}{sortArrow('speedVal')}</a>,
      dataIndex: 'speed', key: 'speedVal', width: 80,
      render: (bytes: number) => speedText(bytes),
    },
    {
      title: '\u64cd\u4f5c', key: 'actions', width: 130, fixed: 'right',
      render: (_: unknown, r: FlatNode) => (
        <Space size={2}>
          <Button size="small" icon={testingIds.has(r.node.id) ? <ThunderboltOutlined spin /> : <ThunderboltOutlined />} onClick={(e) => { e.stopPropagation(); onTestNode(r.node.id) }} title="TCPing" />
          <Button size="small" type="primary" icon={connectingId === r.node.id ? <LoadingOutlined spin /> : <PlayCircleOutlined />} onClick={(e) => { e.stopPropagation(); onConnectNode(r) }} loading={connectingId === r.node.id} title={'\u8fde\u63a5'} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); onDeleteNode(r) }} title={'\u5220\u9664'} />
        </Space>
      ),
    },
  ]

  return (
    <div ref={containerRef} tabIndex={-1} className="kingo-node-table" style={{ outline: 'none' }}>
      <style>{`
        .node-row-selected td { background: var(--ant-primary-1, #e6f4ff) !important; }
        .node-row-active td { background: var(--ant-color-success-bg, #f6ffed) !important; }
        .node-row-selected.node-row-active td { background: var(--ant-color-success-bg, #f6ffed) !important; border-left: 3px solid var(--ant-color-success, #52c41a); }
        .ant-table-row { cursor: default; }
        /* Prevent text selection inside the table (v2rayN DataGrid behaviour) */
        .ant-table-wrapper { user-select: none; -webkit-user-select: none; }
        .kingo-node-table .ant-table-row,
        .kingo-node-table .ant-table-cell {
          height: 38px !important;
          max-height: 38px !important;
        }
        .kingo-node-table .ant-table-cell {
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          vertical-align: middle !important;
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }
        .kingo-node-table .ant-table-cell > *,
        .kingo-node-table .node-cell-ellipsis,
        .kingo-node-table .ant-typography,
        .kingo-node-table .ant-tag {
          white-space: nowrap !important;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
      <Table<FlatNode>
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        size="small"
        tableLayout="fixed"
        virtual
        onRow={onRow}
        rowClassName={(record) => {
          const sel = selectedRowKeys.includes(record.node.id)
          const cls = []
          if (sel) cls.push('node-row-selected')
          if (record.isActive) cls.push('node-row-active')
          return cls.join(' ')
        }}
        scroll={{ x: 1200, y: 520 }}
        pagination={false}
      />
    </div>
  )
}
