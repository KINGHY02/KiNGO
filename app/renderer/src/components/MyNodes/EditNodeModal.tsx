import { useEffect, useState } from 'react'
import { Form, Input, InputNumber, Modal, Typography, message } from 'antd'
import type { FlatNode } from '../../hooks/useNodesData'
import { updateNode } from '../../services/ipc-client'

interface Props {
  open: boolean
  node: FlatNode | null
  onClose: () => void
  onSaved: () => void
}

export default function EditNodeModal({ open, node, onClose, onSaved }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState<number>(443)
  const [detailsText, setDetailsText] = useState('{}')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !node) return
    setName(node.node.name)
    setHost(node.node.host)
    setPort(node.node.port)
    setDetailsText(JSON.stringify(node.node.details || {}, null, 2))
  }, [open, node])

  const handleOk = async (): Promise<void> => {
    if (!node) return
    setSaving(true)
    try {
      const details = JSON.parse(detailsText) as Record<string, unknown>
      await updateNode(node.node.id, {
        name: name.trim(),
        host: host.trim(),
        port,
        details,
      })
      message.success('节点已保存')
      onSaved()
      onClose()
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (error.includes('JSON')) {
        message.error('详情 JSON 格式无效')
      } else {
        message.error('保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="编辑节点"
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      width={720}
    >
      {!node ? null : (
        <Form layout="vertical">
          <Form.Item label="协议">
            <Input value={node.node.protocol} disabled />
          </Form.Item>
          <Form.Item label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Form.Item>
          <Form.Item label="地址">
            <Input value={host} onChange={(e) => setHost(e.target.value)} />
          </Form.Item>
          <Form.Item label="端口">
            <InputNumber min={1} max={65535} value={port} onChange={(value) => setPort(value || 443)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="详情 JSON">
            <Input.TextArea value={detailsText} rows={12} onChange={(e) => setDetailsText(e.target.value)} />
          </Form.Item>
          <Typography.Text type="secondary">
            订阅节点也支持本地编辑，但订阅再次更新时可能会被远端内容覆盖。
          </Typography.Text>
        </Form>
      )}
    </Modal>
  )
}
