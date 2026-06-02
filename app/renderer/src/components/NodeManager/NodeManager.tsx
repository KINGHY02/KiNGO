import { useState, useEffect } from 'react'
import { Card, Select, Button, Table, Typography, Space, Tag, message, Row, Col, Tooltip } from 'antd'
import { ThunderboltOutlined, CloudDownloadOutlined, SwapOutlined } from '@ant-design/icons'
import { testLatency, updateIP, getSlots, switchSlot } from '../../services/ipc-client'

const PROXY_OPTIONS = [
  { value: 'clash-meta', label: 'Clash.Meta' },
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria v1' },
  { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' },
  { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' },
  { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' }
]

interface LatencyNode {
  host: string
  port: number
  latency: number
}

export default function NodeManager(): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>('clash-meta')
  const [nodes, setNodes] = useState<LatencyNode[]>([])
  const [testing, setTesting] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [updatingSlots, setUpdatingSlots] = useState<Set<number>>(new Set())
  const [switchingSlots, setSwitchingSlots] = useState<Set<number>>(new Set())

  useEffect(() => {
    loadSlots(selectedId)
    setNodes([])
  }, [selectedId])

  const loadSlots = async (proxyId: string): Promise<void> => {
    try {
      const result = await getSlots(proxyId)
      setSlots(result)
    } catch {
      setSlots([])
    }
  }

  const handleTestLatency = async (): Promise<void> => {
    setTesting(true)
    try {
      const result = await testLatency(selectedId)
      setNodes(result.nodes || [])
      const available = result.nodes?.filter((n: LatencyNode) => n.latency >= 0).length ?? 0
      message.success(`测试完成: ${available}/${result.nodes?.length ?? 0} 个节点可达`)
    } catch {
      message.error('延迟测试失败')
    } finally {
      setTesting(false)
    }
  }

  const handleUpdateIP = async (slot: number): Promise<void> => {
    setUpdatingSlots((prev) => new Set(prev).add(slot))
    try {
      const result = await updateIP(selectedId, slot)
      if (result.success) {
        message.success(`槽位 ${slot} 更新成功，已自动切换`)
        await loadSlots(selectedId)
      } else {
        message.error(`更新失败: ${result.error}`)
      }
    } catch {
      message.error('更新出错')
    } finally {
      setUpdatingSlots((prev) => {
        const next = new Set(prev)
        next.delete(slot)
        return next
      })
    }
  }

  const handleSwitchSlot = async (slot: number): Promise<void> => {
    setSwitchingSlots((prev) => new Set(prev).add(slot))
    try {
      const result = await switchSlot(selectedId, slot)
      if (result.success) {
        message.success(`已切换到槽位 ${slot}`)
        await loadSlots(selectedId)
      } else {
        message.error(`切换失败: ${result.error}`)
      }
    } catch {
      message.error('切换出错')
    } finally {
      setSwitchingSlots((prev) => {
        const next = new Set(prev)
        next.delete(slot)
        return next
      })
    }
  }

  const latencyColor = (ms: number): string => {
    if (ms < 0) return 'default'
    if (ms < 100) return 'green'
    if (ms < 300) return 'orange'
    return 'red'
  }

  const latencyText = (ms: number): string => {
    if (ms < 0) return '不可达'
    return `${ms}ms`
  }

  const columns = [
    { title: '服务器地址', dataIndex: 'host', key: 'host' },
    { title: '端口', dataIndex: 'port', key: 'port', width: 100 },
    {
      title: '延迟', dataIndex: 'latency', key: 'latency', width: 150,
      render: (ms: number) => <Tag color={latencyColor(ms)}>{latencyText(ms)}</Tag>
    }
  ]

  const shortDesc = (desc: string): string =>
    desc.length > 16 ? `${desc.slice(0, 16)}...` : desc

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Typography.Text strong>选择代理：</Typography.Text>
          <Select
            value={selectedId}
            onChange={setSelectedId}
            options={PROXY_OPTIONS}
            style={{ width: 200 }}
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="IP 更新"
            extra={<CloudDownloadOutlined />}
          >
            <Typography.Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>
              下载配置后可手动切换使用哪个槽位
            </Typography.Text>
            {slots.length === 0 ? (
              <Typography.Text type="secondary">此代理没有可用的更新槽位</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {slots.map((s) => (
                  <div
                    key={s.slot}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: s.active ? '#f6ffed' : '#fafafa',
                      borderRadius: 6,
                      border: s.active ? '1px solid #b7eb8f' : '1px solid #d9d9d9'
                    }}
                  >
                    <Tooltip title={s.description}>
                      <Typography.Text
                        style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {s.active ? <Tag color="green" style={{ marginRight: 4 }}>当前</Tag> : null}
                        {shortDesc(s.description)}
                      </Typography.Text>
                    </Tooltip>
                    <Space size={4}>
                      {s.downloaded && !s.active && (
                        <Button
                          size="small"
                          icon={<SwapOutlined />}
                          onClick={() => handleSwitchSlot(s.slot)}
                          loading={switchingSlots.has(s.slot)}
                        >
                          切换
                        </Button>
                      )}
                      <Button
                        size="small"
                        icon={<CloudDownloadOutlined />}
                        onClick={() => handleUpdateIP(s.slot)}
                        loading={updatingSlots.has(s.slot)}
                      >
                        更新
                      </Button>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="延迟测试"
            extra={
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={handleTestLatency}
                loading={testing}
              >
                全部测试
              </Button>
            }
          >
            <Table
              columns={columns}
              dataSource={nodes.map((n, i) => ({ ...n, key: i }))}
              size="small"
              pagination={false}
              locale={{ emptyText: '点击"全部测试"开始延迟检测' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
