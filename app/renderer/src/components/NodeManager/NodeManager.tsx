import { useState, useEffect, useMemo } from 'react'
import { Card, Select, Button, Table, Typography, Space, Tag, message, Row, Col, Tooltip, Input, Radio, Modal } from 'antd'
import {
  ThunderboltOutlined, CloudDownloadOutlined, SwapOutlined, LoadingOutlined,
  DashboardOutlined, LinkOutlined, PlayCircleOutlined, StopOutlined
} from '@ant-design/icons'
import {
  testLatency, updateIP, getSlots, switchSlot, testRealLatency,
  importNodeUrl, getCompatibleCores, connectNode, disconnectNode
} from '../../services/ipc-client'
import { useProxyStatus } from '../../hooks/useProxyStatus'
import { useTheme } from '../../hooks/useTheme'

const PROXY_OPTIONS = [
  { value: 'clash-meta', label: 'mihomo / Clash' }, { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria v1' }, { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' }, { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' }, { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' },
]

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'mihomo / Clash', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

const UDP_PROXY_IDS = new Set(['clash-meta', 'hysteria', 'hysteria2', 'singbox', 'juicity', 'shadowquic'])
const latencyColor = (ms: number): string => { if (ms < 0) return 'default'; if (ms < 100) return 'green'; if (ms < 300) return 'orange'; return 'red' }
const latencyText = (ms: number): string => ms < 0 ? '不可达' : `${ms}ms`

interface LatencyNode { host: string; port: number; latency: number; source: string }

export default function NodeManager(): JSX.Element {
  const t = useTheme()

  // Quick node import state
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [quickConnected, setQuickConnected] = useState(false)
  const [quickCore, setQuickCore] = useState<string | null>(null)
  const [coreModal, setCoreModal] = useState<{ cores: CompatibleCore[] } | null>(null)
  const [selectedCore, setSelectedCore] = useState('')
  const [connecting, setConnecting] = useState(false)

  // IP update state
  const [selectedId, setSelectedId] = useState<string>('clash-meta')
  const [nodes, setNodes] = useState<LatencyNode[]>([])
  const [testing, setTesting] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [updatingSlots, setUpdatingSlots] = useState<Set<number>>(new Set())
  const [switchingSlots, setSwitchingSlots] = useState<Set<number>>(new Set())
  const [realLatency, setRealLatency] = useState<number | null>(null)
  const [testingReal, setTestingReal] = useState(false)

  const { statuses } = useProxyStatus()
  const isProxyRunning = useMemo(() => statuses.some((s) => s.id === selectedId && s.running), [statuses, selectedId])
  const isUdpProxy = UDP_PROXY_IDS.has(selectedId)

  useEffect(() => { loadSlots(selectedId); setNodes([]); setRealLatency(null) }, [selectedId])

  const loadSlots = async (proxyId: string): Promise<void> => {
    try { setSlots(await getSlots(proxyId)) } catch { setSlots([]) }
  }

  // Quick node import + connect
  const handleQuickImport = async (): Promise<void> => {
    if (!importUrl.trim()) return
    setImporting(true)
    try {
      const node = await importNodeUrl(importUrl.trim())
      if (!node) { message.error('无法解析该节点链接'); return }
      const cores = await getCompatibleCores(node.protocol)
      setCoreModal({ cores })
      setSelectedCore(cores[0]?.id || 'clash-meta')
      // Store node id in importUrl for connect
      setImportUrl(`__node_${node.id}`)
    } catch { message.error('导入失败') }
    finally { setImporting(false) }
  }

  const handleCoreConnect = async (): Promise<void> => {
    if (!coreModal) return
    const nodeId = importUrl.replace('__node_', '')
    setConnecting(true)
    try {
      const result = await connectNode(nodeId, selectedCore)
      if (result.success) {
        message.success(`已连接: ${CORE_LABELS[selectedCore]}`)
        setQuickConnected(true)
        setQuickCore(selectedCore)
        setCoreModal(null)
      } else {
        message.error(`连接失败: ${result.error}`)
      }
    } catch { message.error('连接出错') }
    finally { setConnecting(false) }
  }

  const handleQuickDisconnect = async (): Promise<void> => {
    if (!quickCore) return
    try {
      const result = await disconnectNode(quickCore)
      if (result.success) { message.success('已断开'); setQuickConnected(false); setQuickCore(null); setImportUrl('') }
    } catch { message.error('断开失败') }
  }

  // IP update handlers
  const handleTestLatency = async (): Promise<void> => {
    setTesting(true); setNodes([]); setRealLatency(null)
    try {
      const result = await testLatency(selectedId)
      const allNodes: LatencyNode[] = [
        ...result.current.map((n) => ({ ...n, source: '当前配置' })),
        ...result.slots.flatMap((s) => s.nodes.map((n) => ({ ...n, source: `${s.description} (IP${s.slot})` })))
      ]
      setNodes(allNodes)
      message.success(`测速完成: ${allNodes.filter((n) => n.latency >= 0).length}/${allNodes.length} 个节点可达`)
    } catch { message.error('延迟测试失败') } finally { setTesting(false) }
  }

  const handleRealLatencyTest = async (): Promise<void> => {
    setTestingReal(true); setRealLatency(null)
    try {
      const result = await testRealLatency(selectedId)
      setRealLatency(result.latency)
      if (result.latency >= 0) message.success(`真实测速: ${result.latency}ms`)
      else message.warning('测速失败')
    } catch { message.error('测速出错') } finally { setTestingReal(false) }
  }

  const handleUpdateIP = async (slot: number): Promise<void> => {
    setUpdatingSlots((prev) => new Set(prev).add(slot))
    try {
      const result = await updateIP(selectedId, slot)
      if (result.success) { message.success(`槽位 ${slot} 更新成功`); await loadSlots(selectedId) }
      else message.error(`更新失败: ${result.error}`)
    } catch { message.error('更新出错') } finally { setUpdatingSlots((prev) => { const next = new Set(prev); next.delete(slot); return next }) }
  }

  const handleSwitchSlot = async (slot: number): Promise<void> => {
    setSwitchingSlots((prev) => new Set(prev).add(slot))
    try {
      const result = await switchSlot(selectedId, slot)
      if (result.success) { message.success(`已切换到槽位 ${slot}`); await loadSlots(selectedId) }
      else message.error(`切换失败: ${result.error}`)
    } catch { message.error('切换出错') } finally { setSwitchingSlots((prev) => { const next = new Set(prev); next.delete(slot); return next }) }
  }

  const latencyColumns = [
    { title: '来源', dataIndex: 'source', key: 'source', width: 90, ellipsis: true },
    { title: '地址', dataIndex: 'host', key: 'host', width: 140, ellipsis: true },
    { title: '端口', dataIndex: 'port', key: 'port', width: 60 },
    { title: '延迟', dataIndex: 'latency', key: 'latency', width: 90, render: (ms: number) => <Tag color={latencyColor(ms)}>{latencyText(ms)}</Tag> }
  ]

  const shortDesc = (desc: string): string => desc.length > 16 ? `${desc.slice(0, 16)}...` : desc

  return (
    <div>
      {/* Quick node import bar */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text strong>快速连接节点</Typography.Text>
          <Space>
            <Input
              placeholder="粘贴节点链接 (vmess:// ss:// trojan:// ...)"
              value={importUrl.startsWith('__node_') ? '已导入节点' : importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              style={{ width: 420 }}
              disabled={importUrl.startsWith('__node_')}
              size="small"
            />
            {!quickConnected ? (
              <Button size="small" type="primary" icon={<LinkOutlined />} onClick={handleQuickImport} loading={importing}>
                导入并选择核心
              </Button>
            ) : (
              <Button size="small" danger icon={<StopOutlined />} onClick={handleQuickDisconnect}>
                断开 {quickCore ? CORE_LABELS[quickCore] : ''}
              </Button>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            支持 vmess:// ss:// trojan:// vless:// hysteria:// hysteria2:// 等协议，导入后选择核心连接
          </Typography.Text>
        </Space>
      </Card>

      {/* IP Update + Latency Test */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Typography.Text strong>选择代理：</Typography.Text>
          <Select value={selectedId} onChange={setSelectedId} options={PROXY_OPTIONS} style={{ width: 200 }} size="small" />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="IP 更新" extra={<CloudDownloadOutlined />}>
            <Typography.Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>下载配置后可手动切换使用哪个槽位</Typography.Text>
            {slots.length === 0 ? (
              <Typography.Text type="secondary">此代理没有可用的更新槽位</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {slots.map((s) => (
                  <div key={s.slot} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: s.active ? t.dashSlotActiveBg : t.dashSlotBg,
                    borderRadius: 6, border: s.active ? `1px solid ${t.dashSlotActiveBorder}` : `1px solid ${t.dashSlotBorder}`
                  }}>
                    <Tooltip title={s.description}>
                      <Typography.Text style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="延迟测试" extra={
            <Space size={8}>
              {isProxyRunning && <Button type="default" icon={<DashboardOutlined />} onClick={handleRealLatencyTest} loading={testingReal}>真实测速</Button>}
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleTestLatency} loading={testing}>全部测试</Button>
            </Space>
          }>
            {isUdpProxy && <Typography.Text type="warning" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>UDP协议 — TCP检测无效，请先连接代理后使用"真实测速"</Typography.Text>}
            {testing && <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}><LoadingOutlined style={{ marginRight: 6 }} spin />正在测速...</Typography.Text>}
            {!testing && nodes.length > 0 && <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>测速完成: {nodes.filter((n) => n.latency >= 0).length}/{nodes.length} 个节点可达</Typography.Text>}
            {realLatency !== null && <div style={{ marginBottom: 8 }}><Tag color={latencyColor(realLatency)} style={{ fontSize: 13 }}>真实延迟: {latencyText(realLatency)}</Tag></div>}
            {testingReal && <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}><LoadingOutlined style={{ marginRight: 6 }} spin />正在通过代理测速...</Typography.Text>}
            <Table columns={latencyColumns} dataSource={nodes.map((n, i) => ({ ...n, key: i }))} size="small" pagination={false} locale={{ emptyText: '点击"全部测试"检测延迟' }} />
          </Card>
        </Col>
      </Row>

      {/* Core selector modal */}
      <Modal
        open={!!coreModal}
        title="选择连接核心"
        onCancel={() => setCoreModal(null)}
        footer={[
          <Button key="cancel" onClick={() => setCoreModal(null)}>取消</Button>,
          <Button key="connect" type="primary" icon={<LinkOutlined />} onClick={handleCoreConnect} loading={connecting}>连接</Button>,
        ]}
      >
        {coreModal && (
          <div>
            <Typography.Text style={{ display: 'block', marginBottom: 8 }}>选择核心:</Typography.Text>
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
        )}
      </Modal>
    </div>
  )
}
