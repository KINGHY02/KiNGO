// ConnectCoreModal — core selection modal (v2rayN equivalent: auto-selects core by protocol)
import { useState, useEffect } from 'react'
import { Modal, Button, Typography, Space, Radio, Tag } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { getCompatibleCores, connectNode } from '../../services/ipc-client'

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'mihomo / Clash', xray: 'Xray', hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2', singbox: 'Sing-Box', naiveproxy: 'NaiveProxy',
  juicity: 'Juicity', mieru: 'Mieru', shadowquic: 'ShadowQUIC',
}

interface Props {
  node: StoredNode | null
  open: boolean
  onClose: () => void
  onConnected: (activeConn: ActiveConnection) => void
}

export default function ConnectCoreModal({ node, open, onClose, onConnected }: Props): JSX.Element {
  const [cores, setCores] = useState<CompatibleCore[]>([])
  const [selected, setSelected] = useState('')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!node || !open) return
    getCompatibleCores(node.protocol).then((cs) => {
      setCores(cs)
      setSelected(cs[0]?.id || 'clash-meta')
    }).catch(() => {})
  }, [node, open])

  const handleConnect = async () => {
    if (!node) return
    setConnecting(true)
    try {
      const r = await connectNode(node.id, selected)
      if (r.success) {
        onConnected({ nodeId: node.id, groupId: node.groupId || 'manual', nodeName: node.name, coreId: selected, pid: r.pid ?? null, connectedAt: Date.now() })
        onClose()
      } else {
        Modal.error({ title: '连接失败', content: r.error || '未知错误' })
      }
    } catch {
      Modal.error({ title: '连接出错' })
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="选择连接核心"
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="connect" type="primary" icon={<LinkOutlined />} onClick={handleConnect} loading={connecting}>连接</Button>,
      ]}
    >
      {node && (
        <div>
          <Typography.Text strong>{node.name}</Typography.Text>
          <br />
          <Typography.Text type="secondary">{node.protocol} · {node.host}:{node.port}</Typography.Text>
          <div style={{ marginTop: 16 }}>
            <Typography.Text style={{ display: 'block', marginBottom: 8 }}>选择核心:</Typography.Text>
            <Radio.Group value={selected} onChange={(e) => setSelected(e.target.value)}>
              <Space direction="vertical">
                {cores.map((c) => (
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
  )
}
