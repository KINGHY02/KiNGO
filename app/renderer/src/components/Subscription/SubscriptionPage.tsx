import { useState, useEffect, useCallback } from 'react'
import { Card, Button, Typography, Space, Tag, message, Input, Modal, Switch, Table, Radio } from 'antd'
import { PlusOutlined, ReloadOutlined, DeleteOutlined, SyncOutlined, PlayCircleOutlined, ThunderboltOutlined, LinkOutlined, StopOutlined } from '@ant-design/icons'
import { testNodeLatency, getCompatibleCores, connectNode, disconnectNode } from '../../services/ipc-client'

// Note: Subscription UI uses the renderer's IPC client. Subscription CRUD goes through
// dedicated IPC handlers added below.

const api = window.electronAPI

interface SubInfo {
  id: string
  name: string
  url: string
  nodes: StoredNode[]
  lastUpdated: number | null
  autoUpdate: boolean
  updateInterval: number
}

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'Clash.Meta', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

const latencyColor = (ms: number): string => { if (ms < 0) return 'default'; if (ms < 100) return 'green'; if (ms < 300) return 'orange'; return 'red' }
const latencyText = (ms: number): string => ms < 0 ? '不可达' : `${ms}ms`

export default function SubscriptionPage(): JSX.Element {
  const [subs, setSubs] = useState<SubInfo[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [testingId, setTestingId] = useState<string | null>(null)
  const [connectingNode, setConnectingNode] = useState<string | null>(null)
  const [connectedCore, setConnectedCore] = useState<string | null>(null)
  // Core selector modal
  const [coreModal, setCoreModal] = useState<{ node: StoredNode; cores: CompatibleCore[] } | null>(null)
  const [selectedCore, setSelectedCore] = useState('')
  const [connecting, setConnecting] = useState(false)

  const loadSubs = useCallback(async () => {
    try { setSubs(await api.listSubscriptions()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSubs() }, [loadSubs])

  const handleAdd = async (): Promise<void> => {
    if (!addName.trim() || !addUrl.trim()) return
    setAdding(true)
    try {
      const result = await api.addSubscription(addName.trim(), addUrl.trim())
      if (result.error) { message.error(`解析节点失败: ${result.error}`); return }
      await loadSubs()
      setShowAdd(false)
      setAddName('')
      setAddUrl('')
      message.success(result.diff ? `订阅已添加, 共 ${result.sub.nodes.length} 个节点` : '订阅已添加(无节点)')
    } catch { message.error('添加失败') } finally { setAdding(false) }
  }

  const handleUpdate = async (id: string): Promise<void> => {
    setUpdating((prev) => new Set(prev).add(id))
    try {
      const diff = await api.updateSubscription(id)
      if (diff) {
        message.success(`更新完成: +${diff.added} 新增, -${diff.removed} 移除, ${diff.unchanged} 不变`)
      }
      await loadSubs()
    } catch { message.error('更新失败') } finally { setUpdating((prev) => { const s = new Set(prev); s.delete(id); return s }) }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try { await api.deleteSubscription(id); await loadSubs(); message.success('已删除') } catch { message.error('删除失败') }
  }

  const handleToggleAuto = async (id: string, enabled: boolean): Promise<void> => {
    try { await api.toggleAutoUpdate(id, enabled); await loadSubs() } catch { /* ignore */ }
  }

  const handleTestNode = async (node: StoredNode): Promise<void> => {
    setTestingId(node.id)
    try {
      const results = await testNodeLatency([node.id])
      setSubs((prev) =>
        prev.map((s) => ({
          ...s,
          nodes: s.nodes.map((n) => {
            const r = results.find((r) => r.id === n.id)
            return r ? { ...n, latency: r.latency >= 0 ? r.latency : null, lastTested: Date.now() } : n
          }),
        }))
      )
    } catch { /* ignore */ } finally { setTestingId(null) }
  }

  const handleOpenCoreModal = async (node: StoredNode): Promise<void> => {
    try {
      const cores = await getCompatibleCores(node.protocol)
      setCoreModal({ node, cores })
      setSelectedCore(cores[0]?.id || 'clash-meta')
    } catch { message.error('获取兼容核心失败') }
  }

  const handleConnect = async (): Promise<void> => {
    if (!coreModal) return
    setConnecting(true)
    try {
      const result = await connectNode(coreModal.node.id, selectedCore)
      if (result.success) {
        message.success(`已连接: ${CORE_LABELS[selectedCore] || selectedCore}`)
        setConnectedCore(selectedCore)
        setCoreModal(null)
      } else {
        message.error(`连接失败: ${result.error}`)
      }
    } catch { message.error('连接出错') }
    finally { setConnecting(false) }
  }

  const handleDisconnect = async (): Promise<void> => {
    if (!connectedCore) return
    try {
      const result = await disconnectNode(connectedCore)
      if (result.success) { message.success('已断开'); setConnectedCore(null) }
    } catch { message.error('断开失败') }
  }

  const protocolTag = (proto: string): JSX.Element => {
    const colors: Record<string, string> = { vmess: 'blue', vless: 'purple', trojan: 'orange', ss: 'green', ssr: 'cyan', hysteria: 'magenta', hysteria2: 'pink', tuic: 'gold', naive: 'volcano', juicity: 'geekblue', mieru: 'lime', shadowquic: 'red' }
    return <Tag color={colors[proto] || 'default'}>{proto}</Tag>
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowAdd(true)}>添加订阅</Button>
          {connectedCore && (
            <Button icon={<StopOutlined />} danger onClick={handleDisconnect}>
              断开 {CORE_LABELS[connectedCore]}
            </Button>
          )}
        </Space>
      </div>

      {subs.length === 0 && (
        <Card><Typography.Text type="secondary">暂无订阅，点击"添加订阅"开始</Typography.Text></Card>
      )}

      {subs.map((sub) => (
        <Card
          key={sub.id}
          title={sub.name}
          size="small"
          style={{ marginBottom: 12 }}
          extra={
            <Space size={4}>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => handleUpdate(sub.id)} loading={updating.has(sub.id)}>更新</Button>
              <Button size="small" icon={<DeleteOutlined />} danger onClick={() => handleDelete(sub.id)}>删除</Button>
            </Space>
          }
        >
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            订阅链接: {sub.url}
          </Typography.Text>
          <Space style={{ marginBottom: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {sub.lastUpdated ? `上次更新: ${new Date(sub.lastUpdated).toLocaleString('zh-CN')}` : '尚未更新'}
            </Typography.Text>
            <Tag>{sub.nodes.length} 个节点</Tag>
            <Space size={4}>
              <Typography.Text style={{ fontSize: 12 }}>自动更新:</Typography.Text>
              <Switch size="small" checked={sub.autoUpdate} onChange={(v) => handleToggleAuto(sub.id, v)} />
            </Space>
          </Space>

          {sub.nodes.length > 0 && (
            <Table
              columns={[
                { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: '协议', dataIndex: 'protocol', key: 'protocol', width: 80, render: (p: string) => <Tag>{p}</Tag> },
                { title: '地址', key: 'addr', width: 160, render: (_: unknown, r: StoredNode) => `${r.host}:${r.port}` },
                {
                  title: '延迟', dataIndex: 'latency', key: 'latency', width: 80,
                  render: (ms: number | null) => ms !== null ? <Tag color={latencyColor(ms)}>{latencyText(ms)}</Tag> : '-',
                },
                {
                  title: '操作', key: 'actions', width: 140,
                  render: (_: unknown, r: StoredNode) => (
                    <Space size={4}>
                      <Button size="small" icon={testingId === r.id ? <SyncOutlined spin /> : <ThunderboltOutlined />} onClick={() => handleTestNode(r)} />
                      <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleOpenCoreModal(r)}>连接</Button>
                    </Space>
                  )
                },
              ]}
              dataSource={sub.nodes.map((n, i) => ({ ...n, key: n.id || `s_${i}` }))}
              size="small"
              pagination={{ pageSize: 20, size: 'small' }}
              scroll={{ y: 300 }}
            />
          )}
        </Card>
      ))}

      <Modal
        open={showAdd}
        title="添加订阅"
        onCancel={() => setShowAdd(false)}
        onOk={handleAdd}
        confirmLoading={adding}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Typography.Text>订阅名称</Typography.Text>
            <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="例如: 香港高速" style={{ marginTop: 4 }} />
          </div>
          <div>
            <Typography.Text>订阅链接</Typography.Text>
            <Input.TextArea value={addUrl} onChange={(e) => setAddUrl(e.target.value)} rows={3} placeholder="https://..." style={{ marginTop: 4 }} />
          </div>
        </Space>
      </Modal>

      <Modal
        open={!!coreModal}
        title="选择连接核心"
        onCancel={() => setCoreModal(null)}
        footer={[
          <Button key="cancel" onClick={() => setCoreModal(null)}>取消</Button>,
          <Button key="connect" type="primary" icon={<LinkOutlined />} onClick={handleConnect} loading={connecting}>连接</Button>,
        ]}
      >
        {coreModal && (
          <div>
            <Typography.Text strong>节点: {coreModal.node.name}</Typography.Text>
            <br />
            <Typography.Text type="secondary">{coreModal.node.protocol} {coreModal.node.host}:{coreModal.node.port}</Typography.Text>
            <div style={{ marginTop: 16 }}>
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
          </div>
        )}
      </Modal>
    </div>
  )
}
