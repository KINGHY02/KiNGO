// AddSubscriptionModal — add/edit subscription (v2rayN SubEditWindow aligned)
import { useState, useEffect } from 'react'
import { Modal, Input, Space, Typography, Switch, InputNumber, message } from 'antd'
import { getSubscription, saveSubscription } from '../../services/ipc-client'

interface Props {
  open: boolean
  editId?: string      // if set, editing existing subscription
  initialName?: string
  initialUrl?: string
  onClose: () => void
  onDone: () => void
}

export default function AddSubscriptionModal({ open, editId, initialName, initialUrl, onClose, onDone }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [moreUrl, setMoreUrl] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [userAgent, setUserAgent] = useState('')
  const [filter, setFilter] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [updateInterval, setUpdateInterval] = useState(12)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName || '')
      setUrl(initialUrl || '')
      setMoreUrl('')
      setEnabled(true)
      setUserAgent('')
      setFilter('')
      setAutoUpdate(false)
      setUpdateInterval(12)
      // Load existing sub data for editing
      if (editId) {
        getSubscription(editId).then((s) => {
          if (s) {
            setName(s.name)
            setUrl(s.url)
            setMoreUrl(s.moreUrl || '')
            setEnabled(s.enabled ?? true)
            setUserAgent(s.userAgent || '')
            setFilter(s.filter || '')
            setAutoUpdate(s.autoUpdate || false)
            setUpdateInterval(s.updateInterval || 12)
          } else {
            message.error('订阅不存在')
          }
        }).catch(() => {})
      }
    }
  }, [open, editId, initialName, initialUrl])

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return
    setAdding(true)
    try {
      const result = await saveSubscription({
        id: editId,
        name: name.trim(),
        url: url.trim(),
        moreUrl: moreUrl.trim(),
        enabled,
        userAgent: userAgent.trim(),
        filter: filter.trim(),
        autoUpdate,
        updateInterval,
        refresh: true,
      })
      if (result.error) {
        message.warning(`${editId ? '订阅已保存' : '订阅已添加'}，但解析失败: ${result.error}`)
      } else {
        message.success(editId
          ? `订阅已保存，共 ${result.sub?.nodes?.length || 0} 个节点`
          : `订阅已添加，共 ${result.sub?.nodes?.length || 0} 个节点`)
      }
      onDone()
      onClose()
    } catch { message.error('添加失败') }
    finally { setAdding(false) }
  }

  return (
    <Modal
      open={open}
      title={editId ? '编辑订阅' : '添加订阅'}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={adding}
      width={520}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Typography.Text>订阅名称</Typography.Text>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如: 香港高速" style={{ marginTop: 4 }} />
        </div>
        <div>
          <Typography.Text>订阅链接</Typography.Text>
          <Input.TextArea value={url} onChange={(e) => setUrl(e.target.value)} rows={3} placeholder="https://..." style={{ marginTop: 4 }} />
        </div>
        <div>
          <Typography.Text>额外链接 (MoreUrl，逗号分隔)</Typography.Text>
          <Input value={moreUrl} onChange={(e) => setMoreUrl(e.target.value)} placeholder="https://..." style={{ marginTop: 4 }} />
        </div>
        <div>
          <Typography.Text>节点过滤 (正则表达式，匹配 remarks)</Typography.Text>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="例如: 香港|日本|美国" style={{ marginTop: 4 }} />
        </div>
        <Space>
          <Space size={4}>
            <Typography.Text style={{ fontSize: 13 }}>启用:</Typography.Text>
            <Switch size="small" checked={enabled} onChange={setEnabled} />
          </Space>
          <Space size={4}>
            <Typography.Text style={{ fontSize: 13 }}>自动更新:</Typography.Text>
            <Switch size="small" checked={autoUpdate} onChange={setAutoUpdate} />
          </Space>
          {autoUpdate && (
            <Space size={4}>
              <Typography.Text style={{ fontSize: 13 }}>间隔(小时):</Typography.Text>
              <InputNumber size="small" min={1} max={720} value={updateInterval} onChange={(v) => setUpdateInterval(v || 12)} style={{ width: 70 }} />
            </Space>
          )}
        </Space>
        <div>
          <Typography.Text>自定义 User-Agent</Typography.Text>
          <Input value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="留空使用默认" style={{ marginTop: 4 }} />
        </div>
      </Space>
    </Modal>
  )
}
