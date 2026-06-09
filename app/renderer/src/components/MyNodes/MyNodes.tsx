import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, Button, Table, Typography, Space, Tag, message, Input, Modal, Select, Row, Col, Tooltip, Radio, Collapse } from 'antd'
import {
  ThunderboltOutlined, CloudDownloadOutlined, SwapOutlined, LoadingOutlined,
  DashboardOutlined, LinkOutlined, PlayCircleOutlined, StopOutlined,
  PlusOutlined, ReloadOutlined, DeleteOutlined, SearchOutlined,
} from '@ant-design/icons'
import {
  testLatency, updateIP, getSlots, switchSlot, testRealLatency,
  importNodeUrl, getCompatibleCores, connectNode, disconnectNode,
  getAllNodes, getActiveConnection, deleteMyNode, testNodeLatency,
} from '../../services/ipc-client'
import { useProxyStatus } from '../../hooks/useProxyStatus'
import { useTheme } from '../../hooks/useTheme'

const api = window.electronAPI

const PROXY_OPTIONS = [
  { value: 'clash-meta', label: 'Clash.Meta' }, { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria v1' }, { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' }, { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' }, { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' },
]

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'Clash.Meta', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

const UDP_PROXY_IDS = new Set(['clash-meta', 'hysteria', 'hysteria2', 'singbox', 'juicity', 'shadowquic'])
const latencyColor = (ms: number): string => { if (ms < 0) return 'default'; if (ms < 100) return 'green'; if (ms < 300) return 'orange'; return 'red' }
const latencyText = (ms: number): string => ms < 0 ? '不可达' : `${ms}ms`

interface FlatNode { node: StoredNode; groupId: string; groupName: string }

function genId(): string { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }

export default function MyNodes(): JSX.Element {
  const t = useTheme()

  // All nodes (unified)
  const [allNodes, setAllNodes] = useState<FlatNode[]>([])
  const [loadingNodes, setLoadingNodes] = useState(true)

  // Active connection (persisted)
  const [activeConn, setActiveConn] = useState<ActiveConnection | null>(null)

  // URL import
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)

  // Subscription add modal
  const [showSubAdd, setShowSubAdd] = useState(false)
  const [subName, setSubName] = useState('')
  const [subUrl, setSubUrl] = useState('')
  const [addingSub, setAddingSub] = useState(false)

  // Subscriptions list
  const [subs, setSubs] = useState<SubInfo[]>([])

  // Core selector modal (per node)
  const [coreModal, setCoreModal] = useState<{ nodeId: string; nodeName: string; protocol: string; cores: CompatibleCore[] } | null>(null)
  const [selectedCore, setSelectedCore] = useState('')
  const [connecting, setConnecting] = useState(false)

  // Testing
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())

  // IP update (existing)
  const [ipSelectedId, setIpSelectedId] = useState<string>('clash-meta')
  const [latencyNodes, setLatencyNodes] = useState<Array<{host:string;port:number;latency:number;source:string}>>([])
  const [testing, setTesting] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [updatingSlots, setUpdatingSlots] = useState<Set<number>>(new Set())
  const [switchingSlots, setSwitchingSlots] = useState<Set<number>>(new Set())
  const [realLatency, setRealLatency] = useState<number | null>(null)
  const [testingReal, setTestingReal] = useState(false)
  const [search, setSearch] = useState('')

  const { statuses } = useProxyStatus()
  const ipRunning = useMemo(() => statuses.some((s) => s.id === ipSelectedId && s.running), [statuses, ipSelectedId])
  const isUdp = UDP_PROXY_IDS.has(ipSelectedId)

  // Load everything
  const loadAll = useCallback(async () => {
    try {
      const [nodes, conn, subList] = await Promise.all([
        getAllNodes(),
        getActiveConnection(),
        api.listSubscriptions() as Promise<SubInfo[]>,
      ])
      setAllNodes(nodes)
      setActiveConn(conn)
      setSubs(subList || [])
    } catch { /* ignore */ }
    finally { setLoadingNodes(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadIpSlots(ipSelectedId) }, [ipSelectedId])

  const loadIpSlots = async (proxyId: string): Promise<void> => {
    try { setSlots(await getSlots(proxyId)); setLatencyNodes([]); setRealLatency(null) }
    catch { setSlots([]) }
  }

  // URL import
  const handleImportUrl = async (): Promise<void> => {
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      const node = await importNodeUrl(importUrl.trim())
      if (node) { message.success(`已导入: ${node.name}`); setImportUrl(''); await loadAll() }
      else message.error('无法解析该链接')
    } catch { message.error('导入失败') }
    finally { setImporting(false) }
  }

  // Subscription actions
  const handleAddSub = async (): Promise<void> => {
    if (!subName.trim() || !subUrl.trim()) return
    setAddingSub(true)
    try {
      await api.addSubscription(subName.trim(), subUrl.trim())
      setShowSubAdd(false); setSubName(''); setSubUrl('')
      message.success('订阅已添加')
      await loadAll()
    } catch { message.error('添加失败') }
    finally { setAddingSub(false) }
  }

  const handleUpdateSub = async (id: string): Promise<void> => {
    try {
      const diff = await api.updateSubscription(id)
      if (diff) message.success(`更新: +${diff.added} 新增, -${diff.removed} 移除`)
      await loadAll()
    } catch { message.error('更新失败') }
  }

  const handleDeleteSub = async (id: string): Promise<void> => {
    try { await api.deleteSubscription(id); await loadAll(); message.success('已删除') }
    catch { message.error('删除失败') }
  }

  // Core selection + connect
  const handleOpenCoreModal = async (node: FlatNode): Promise<void> => {
    try {
      const cores = await getCompatibleCores(node.node.protocol)
      setCoreModal({ nodeId: node.node.id, nodeName: node.node.name, protocol: node.node.protocol, cores })
      setSelectedCore(cores[0]?.id || 'clash-meta')
    } catch { message.error('获取核心失败') }
  }

  const handleConnect = async (): Promise<void> => {
    if (!coreModal) return
    setConnecting(true)
    try {
      const result = await connectNode(coreModal.nodeId, selectedCore)
      if (result.success) {
        message.success(`已连接: ${CORE_LABELS[selectedCore]}`)
        // Set active connection directly — avoids IPC round-trip race
        setActiveConn({
          nodeId: coreModal.nodeId,
          groupId: 'manual',
          nodeName: coreModal.nodeName,
          coreId: selectedCore,
          pid: result.pid ?? null,
          connectedAt: Date.now(),
        })
        setCoreModal(null)
        await loadAll()
      } else {
        message.error(`连接失败: ${result.error}`)
      }
    } catch { message.error('连接出错') }
    finally { setConnecting(false) }
  }

  const handleDisconnect = async (): Promise<void> => {
    if (!activeConn) return
    try {
      await disconnectNode(activeConn.coreId)
      setActiveConn(null)
      message.success('已断开')
      await loadAll()
    } catch { message.error('断开失败') }
  }

  // Latency test for user nodes
  const handleTestNodes = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    setTestingIds(new Set(ids))
    try {
      const results = await testNodeLatency(ids)
      setAllNodes((prev) =>
        prev.map((fn) => {
          const r = results.find((r) => r.id === fn.node.id)
          if (r) {
            return {
              ...fn,
              node: { ...fn.node, latency: r.latency >= 0 ? r.latency : null, lastTested: Date.now() },
            }
          }
          return fn
        })
      )
      message.success(`测速: ${results.filter((r) => r.latency >= 0).length}/${results.length} 可达`)
    } catch { message.error('测速失败') }
    finally { setTestingIds(new Set()) }
  }

  // Delete user node
  const handleDeleteNode = async (groupId: string, nodeId: string): Promise<void> => {
    try { await deleteMyNode(nodeId, groupId); await loadAll() }
    catch { message.error('删除失败') }
  }

  // IP update handlers
  const handleIpTest = async (): Promise<void> => {
    setTesting(true); setLatencyNodes([]); setRealLatency(null)
    try {
      const result = await testLatency(ipSelectedId)
      const all = [...result.current.map((n: any) => ({ ...n, source: '当前配置' })),
      ...result.slots.flatMap((s: any) => s.nodes.map((n: any) => ({ ...n, source: `${s.description} (IP${s.slot})` })))]
      setLatencyNodes(all)
      message.success(`测速完成: ${all.filter((n:any)=>n.latency>=0).length}/${all.length} 节点可达`)
    } catch { message.error('延迟测试失败') } finally { setTesting(false) }
  }

  const handleRealTest = async (): Promise<void> => {
    setTestingReal(true); setRealLatency(null)
    try {
      const result = await testRealLatency(ipSelectedId)
      setRealLatency(result.latency)
      if (result.latency >= 0) message.success(`真实测速: ${result.latency}ms`)
      else message.warning('测速失败')
    } catch { message.error('测速出错') } finally { setTestingReal(false) }
  }

  const handleUpdateIP = async (slot: number): Promise<void> => {
    setUpdatingSlots((prev) => new Set(prev).add(slot))
    try {
      const r = await updateIP(ipSelectedId, slot)
      if (r.success) { message.success(`槽位 ${slot} 更新成功`); await loadIpSlots(ipSelectedId) }
      else message.error(`更新失败: ${r.error}`)
    } catch { message.error('更新出错') }
    finally { setUpdatingSlots((prev) => { const next = new Set(prev); next.delete(slot); return next }) }
  }

  const handleSwitchSlot = async (slot: number): Promise<void> => {
    setSwitchingSlots((prev) => new Set(prev).add(slot))
    try {
      const r = await switchSlot(ipSelectedId, slot)
      if (r.success) { message.success(`已切换到槽位 ${slot}`); await loadIpSlots(ipSelectedId) }
      else message.error(`切换失败: ${r.error}`)
    } catch { message.error('切换出错') }
    finally { setSwitchingSlots((prev) => { const next = new Set(prev); next.delete(slot); return next }) }
  }

  const protocolTag = (proto: string): JSX.Element => {
    const colors: Record<string, string> = { vmess: 'blue', vless: 'purple', trojan: 'orange', ss: 'green', ssr: 'cyan', hysteria: 'magenta', hysteria2: 'pink', tuic: 'gold', naive: 'volcano', juicity: 'geekblue', mieru: 'lime', shadowquic: 'red' }
    return <Tag color={colors[proto] || 'default'}>{proto}</Tag>
  }

  // Build group views
  const manualNodes = allNodes.filter((n) => n.groupId === 'manual')
  const subGroups = new Map<string, { name: string; nodes: FlatNode[]; subInfo: SubInfo | undefined }>()
  for (const fn of allNodes) {
    if (fn.groupId === 'manual') continue
    if (!subGroups.has(fn.groupId)) {
      subGroups.set(fn.groupId, { name: fn.groupName, nodes: [], subInfo: subs.find((s) => s.id === fn.groupId) })
    }
    subGroups.get(fn.groupId)!.nodes.push(fn)
  }

  const filteredManual = manualNodes.filter((n) =>
    !search || n.node.name.toLowerCase().includes(search.toLowerCase()) || n.node.host.includes(search)
  )
  const filteredSubs = new Map<string, { name: string; nodes: FlatNode[]; subInfo: SubInfo | undefined }>()
  for (const [gid, g] of subGroups) {
    const filtered = g.nodes.filter((n) =>
      !search || n.node.name.toLowerCase().includes(search.toLowerCase()) || n.node.host.includes(search)
    )
    if (filtered.length > 0) filteredSubs.set(gid, { name: g.name, nodes: filtered, subInfo: g.subInfo })
  }

  const shortDesc = (desc: string): string => desc.length > 16 ? `${desc.slice(0, 16)}...` : desc

  return (
    <div>
      {/* Active connection banner */}
      {activeConn && (
        <Card size="small" style={{ marginBottom: 12, borderLeft: '4px solid #52c41a' }}>
          <Space>
            <Tag color="green" style={{ fontSize: 13, padding: '2px 12px' }}>
              ⚡ 已连接: {activeConn.nodeName}
            </Tag>
            <Tag>{CORE_LABELS[activeConn.coreId] || activeConn.coreId}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {new Date(activeConn.connectedAt).toLocaleTimeString('zh-CN')}
            </Typography.Text>
            <Button size="small" danger icon={<StopOutlined />} onClick={handleDisconnect}>断开</Button>
          </Space>
        </Card>
      )}

      {/* Action bar */}
      <Space style={{ marginBottom: 12 }} wrap>
        <Input
          placeholder="粘贴节点链接 (vmess:// ss:// ...)"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          onPressEnter={handleImportUrl}
          style={{ width: 320 }}
          size="small"
          allowClear
        />
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleImportUrl} loading={importing}>
          导入链接
        </Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setShowSubAdd(true)}>添加订阅</Button>
        <Input
          placeholder="搜索节点..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 160 }}
          size="small"
          allowClear
        />
        <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleTestNodes(allNodes.map((n) => n.node.id))} disabled={allNodes.length === 0}>
          全部测速
        </Button>
      </Space>

      {loadingNodes ? (
        <Typography.Text type="secondary">加载中...</Typography.Text>
      ) : (
        <>
          {/* Manual nodes group */}
          {filteredManual.length > 0 && (
            <Card size="small" title="📋 手动添加" style={{ marginBottom: 12 }}>
              <Table
                columns={[
                  { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true,
                    render: (_: unknown, r: FlatNode) => r.node.name },
                  { title: '协议', dataIndex: 'proto', key: 'proto', width: 80,
                    render: (_: unknown, r: FlatNode) => protocolTag(r.node.protocol) },
                  { title: '地址', key: 'addr', width: 160,
                    render: (_: unknown, r: FlatNode) => `${r.node.host}:${r.node.port}` },
                  { title: '延迟', dataIndex: 'lat', key: 'lat', width: 80,
                    render: (_: unknown, r: FlatNode) =>
                      r.node.latency !== null ? <Tag color={latencyColor(r.node.latency)}>{latencyText(r.node.latency)}</Tag> : '-' },
                  { title: '操作', key: 'act', width: 160,
                    render: (_: unknown, r: FlatNode) => (
                      <Space size={4}>
                        <Button size="small" icon={testingIds.has(r.node.id) ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
                          onClick={() => handleTestNodes([r.node.id])} />
                        <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                          onClick={() => handleOpenCoreModal(r)}>连接</Button>
                        <Button size="small" danger icon={<DeleteOutlined />}
                          onClick={() => handleDeleteNode('manual', r.node.id)} />
                      </Space>
                    )
                  },
                ]}
                dataSource={filteredManual.map((fn) => ({ ...fn, key: fn.node.id }))}
                size="small" pagination={false}
              />
            </Card>
          )}

          {/* Subscription groups */}
          {Array.from(filteredSubs.entries()).map(([gid, g]) => (
            <Card
              key={gid}
              size="small"
              title={`📦 ${g.name}`}
              style={{ marginBottom: 12 }}
              extra={
                <Space size={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {g.nodes.length} 个节点
                  </Typography.Text>
                  <Button size="small" icon={<ReloadOutlined />}
                    onClick={() => handleUpdateSub(gid)}>更新</Button>
                  <Button size="small" danger icon={<DeleteOutlined />}
                    onClick={() => handleDeleteSub(gid)}>删除</Button>
                </Space>
              }
            >
              {g.subInfo?.url && (
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                  {g.subInfo.url}
                  {g.subInfo.lastUpdated ? ` · 上次更新: ${new Date(g.subInfo.lastUpdated).toLocaleString('zh-CN')}` : ' · 尚未更新'}
                </Typography.Text>
              )}
              <Button size="small" icon={<ThunderboltOutlined />} style={{ marginBottom: 8 }}
                onClick={() => handleTestNodes(g.nodes.map((n) => n.node.id))}>
                测速此组
              </Button>
              <Table
                columns={[
                  { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true,
                    render: (_: unknown, r: FlatNode) => r.node.name },
                  { title: '协议', dataIndex: 'proto', key: 'proto', width: 80,
                    render: (_: unknown, r: FlatNode) => protocolTag(r.node.protocol) },
                  { title: '地址', key: 'addr', width: 160,
                    render: (_: unknown, r: FlatNode) => `${r.node.host}:${r.node.port}` },
                  { title: '延迟', dataIndex: 'lat', key: 'lat', width: 80,
                    render: (_: unknown, r: FlatNode) =>
                      r.node.latency !== null ? <Tag color={latencyColor(r.node.latency)}>{latencyText(r.node.latency)}</Tag> : '-' },
                  { title: '操作', key: 'act', width: 160,
                    render: (_: unknown, r: FlatNode) => (
                      <Space size={4}>
                        <Button size="small" icon={testingIds.has(r.node.id) ? <LoadingOutlined spin /> : <ThunderboltOutlined />}
                          onClick={() => handleTestNodes([r.node.id])} />
                        <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                          onClick={() => handleOpenCoreModal(r)} disabled={!!activeConn}>连接</Button>
                        <Button size="small" danger icon={<DeleteOutlined />}
                          onClick={() => handleDeleteNode(gid, r.node.id)} />
                      </Space>
                    )
                  },
                ]}
                dataSource={g.nodes.map((fn) => ({ ...fn, key: fn.node.id }))}
                size="small" pagination={false}
              />
            </Card>
          ))}

          {allNodes.length === 0 && (
            <Card><Typography.Text type="secondary">暂无节点。粘贴节点链接导入，或添加订阅链接自动同步。</Typography.Text></Card>
          )}
        </>
      )}

      {/* IP Update section */}
      <Card size="small" title="🏭 IP 更新池" style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text strong>选择代理：</Typography.Text>
          <Select value={ipSelectedId} onChange={setIpSelectedId} options={PROXY_OPTIONS} style={{ width: 180 }} size="small" />
          {ipRunning && <Tag color="green">运行中</Tag>}
        </Space>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Typography.Text strong>IP 槽位</Typography.Text>
            {slots.length === 0 ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>此代理没有可用的更新槽位</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
                {slots.map((s) => (
                  <div key={s.slot} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', background: s.active ? t.dashSlotActiveBg : t.dashSlotBg,
                    borderRadius: 6, border: s.active ? `1px solid ${t.dashSlotActiveBorder}` : `1px solid ${t.dashSlotBorder}`
                  }}>
                    <Tooltip title={s.description}>
                      <Typography.Text style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {s.active ? <Tag color="green" style={{ marginRight: 4 }}>当前</Tag> : null}{shortDesc(s.description)}
                      </Typography.Text>
                    </Tooltip>
                    <Space size={4}>
                      {s.downloaded && !s.active && (
                        <Button size="small" icon={<SwapOutlined />} onClick={() => handleSwitchSlot(s.slot)} loading={switchingSlots.has(s.slot)}>切换</Button>
                      )}
                      <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => handleUpdateIP(s.slot)} loading={updatingSlots.has(s.slot)}>更新</Button>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Col>
          <Col xs={24} lg={12}>
            <Space style={{ marginBottom: 8 }}>
              <Button type="primary" size="small" icon={<ThunderboltOutlined />} onClick={handleIpTest} loading={testing}>全部测试</Button>
              {ipRunning && <Button size="small" icon={<DashboardOutlined />} onClick={handleRealTest} loading={testingReal}>真实测速</Button>}
            </Space>
            {isUdp && <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8, fontSize: 11 }}>UDP协议 — TCP无效，连代理后测真实速度</Typography.Text>}
            {testing && <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}><LoadingOutlined spin /> 测速中...</Typography.Text>}
            {!testing && latencyNodes.length > 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>可达 {latencyNodes.filter((n:any)=>n.latency>=0).length}/{latencyNodes.length}</Typography.Text>}
            {realLatency !== null && <Tag color={latencyColor(realLatency)} style={{ fontSize: 12 }}>真实: {latencyText(realLatency)}</Tag>}
            <Table columns={[
              { title: '来源', dataIndex: 'source', width: 80, ellipsis: true },
              { title: '地址', dataIndex: 'host', width: 120, ellipsis: true },
              { title: '端口', dataIndex: 'port', width: 55 },
              { title: '延迟', dataIndex: 'latency', width: 70, render: (ms: number) => <Tag color={latencyColor(ms)}>{latencyText(ms)}</Tag> },
            ]} dataSource={latencyNodes.map((n, i) => ({ ...n, key: i }))} size="small" pagination={false}
              locale={{ emptyText: '点击"全部测试"' }} />
          </Col>
        </Row>
      </Card>

      {/* Core selector modal */}
      <Modal open={!!coreModal} title="选择连接核心" onCancel={() => setCoreModal(null)}
        footer={[
          <Button key="cancel" onClick={() => setCoreModal(null)}>取消</Button>,
          <Button key="connect" type="primary" icon={<LinkOutlined />} onClick={handleConnect} loading={connecting}>连接</Button>,
        ]}>
        {coreModal && (
          <div>
            <Typography.Text strong>{coreModal.nodeName}</Typography.Text>
            <br /><Typography.Text type="secondary">{coreModal.protocol}</Typography.Text>
            <div style={{ marginTop: 16 }}>
              <Radio.Group value={selectedCore} onChange={(e) => setSelectedCore(e.target.value)}>
                <Space direction="vertical">
                  {coreModal.cores.map((c) => (
                    <Radio key={c.id} value={c.id}>
                      {CORE_LABELS[c.id] || c.id} {c.recommended ? <Tag color="blue" style={{ fontSize: 10 }}>推荐</Tag> : null}
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </div>
          </div>
        )}
      </Modal>

      {/* Add subscription modal */}
      <Modal open={showSubAdd} title="添加订阅" onCancel={() => setShowSubAdd(false)} onOk={handleAddSub} confirmLoading={addingSub}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Typography.Text>订阅名称</Typography.Text>
            <Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="如: 香港高速" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Typography.Text>订阅链接</Typography.Text>
            <Input.TextArea value={subUrl} onChange={(e) => setSubUrl(e.target.value)} rows={3} placeholder="https://..." style={{ marginTop: 4 }} />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
