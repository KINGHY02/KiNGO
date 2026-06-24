// ImportBatchModal — batch import from clipboard / text / base64 / Clash YAML
import { useState } from 'react'
import { Modal, Input, Button, Space, message, Radio, Typography } from 'antd'
import { ImportOutlined, CopyOutlined } from '@ant-design/icons'
import { importNodeUrl, importNodeBatch } from '../../services/ipc-client'

const api = window.electronAPI

interface Props {
  open: boolean
  onClose: () => void
  onImported: () => void
}

export default function ImportBatchModal({ open, onClose, onImported }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [mode, setMode] = useState<'text' | 'subscription'>('text')

  const handlePaste = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (clipText) { setText(clipText); message.info('已粘贴剪贴板内容') }
    } catch { message.error('无法读取剪贴板') }
  }

  const handleImport = async () => {
    if (!text.trim()) return
    setImporting(true)
    try {
      if (mode === 'subscription') {
        // Import as subscription
        const result = await api.addSubscription('临时订阅', text.trim())
        if (result.error) message.warning('解析警告: ' + result.error)
        else message.success(`导入完成: ${result.sub.nodes.length} 个节点`)
      } else {
        // Parse as batch of share URLs
        const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))
        if (lines.length === 1) {
          const node = await importNodeUrl(lines[0])
          if (node) message.success('已导入: ' + node.name)
          else message.error('无法解析该链接')
        } else {
          const nodes = await importNodeBatch(lines)
          if (nodes.length > 0) message.success(`导入完成: ${nodes.length} 个节点`)
          else message.error('没有可解析的链接')
        }
      }
      setText('')
      onImported()
      onClose()
    } catch { message.error('导入失败') }
    finally { setImporting(false) }
  }

  // Also try direct subscription-service parsing for raw content (base64 / Clash YAML)
  const handleImportRaw = async () => {
    if (!text.trim()) return
    setImporting(true)
    try {
      const result = await api.addSubscription('导入节点', text.trim())
      if (result.error) {
        // Try as batch share URLs
        const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0)
        const nodes = await importNodeBatch(lines)
        if (nodes.length > 0) message.success(`导入完成: ${nodes.length} 个节点 (按行解析)`)
        else message.error('无法解析: ' + (result.error || '未知格式'))
      } else {
        message.success(`导入完成: ${result.sub.nodes.length} 个节点`)
      }
      setText('')
      onImported()
      onClose()
    } catch { message.error('导入失败') }
    finally { setImporting(false) }
  }

  return (
    <Modal
      open={open}
      title="批量导入节点"
      onCancel={onClose}
      width={640}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="import" type="primary" icon={<ImportOutlined />} onClick={mode === 'text' ? handleImportRaw : handleImport} loading={importing}>导入</Button>,
      ]}
    >
      <Space style={{ marginBottom: 12 }}>
        <Button size="small" icon={<CopyOutlined />} onClick={handlePaste}>从剪贴板粘贴</Button>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} size="small">
          <Radio.Button value="text">批量链接</Radio.Button>
          <Radio.Button value="subscription">订阅内容</Radio.Button>
        </Radio.Group>
      </Space>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={mode === 'text'
          ? '粘贴分享链接，每行一个，支持 vmess:// vless:// ss:// trojan:// hysteria2:// tuic:// ...'
          : '粘贴订阅内容 (Base64编码 或 Clash YAML 或 多行分享链接)'}
      />
      <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
        支持: vmess:// vless:// ss:// ssr:// trojan:// hysteria:// hysteria2:// tuic:// naive:// socks:// wireguard://
      </Typography.Text>
    </Modal>
  )
}
