import { useState, useEffect } from 'react'
import { Card, Select, Tabs, Typography, Button, Space, Tag, Descriptions, message, Modal } from 'antd'
import { SaveOutlined, RollbackOutlined } from '@ant-design/icons'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { getConfig, saveConfig, restoreBackup } from '../../services/ipc-client'
import { useProxyStatus } from '../../hooks/useProxyStatus'

// Use bundled monaco-editor instead of CDN
loader.config({ monaco })

const PROXY_OPTIONS = [
  { value: 'clash-meta', label: 'mihomo / Clash' },
  { value: 'xray', label: 'Xray (VLESS+REALITY)' },
  { value: 'hysteria', label: 'Hysteria v1' },
  { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' },
  { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' },
  { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' }
]

export default function ProxyDetail(): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>('clash-meta')
  const [configContent, setConfigContent] = useState<string>('')
  const [configFormat, setConfigFormat] = useState<string>('json')
  const [backupExists, setBackupExists] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { statuses } = useProxyStatus()

  const currentProxy = statuses.find((s) => s.id === selectedId)

  useEffect(() => {
    loadConfig(selectedId)
  }, [selectedId])

  const loadConfig = async (proxyId: string): Promise<void> => {
    setLoading(true)
    try {
      const result = await getConfig(proxyId)
      if (result) {
        setConfigContent(result.content)
        setConfigFormat(result.format)
        setBackupExists(result.backupExists)
      }
    } catch (err) {
      message.error('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const result = await saveConfig(selectedId, configContent)
      if (result.success) {
        message.success('配置已保存')
        setBackupExists(true)
        if (currentProxy?.running) {
          Modal.info({
            title: '提示',
            content: '代理正在运行中，需要重启代理才能使新配置生效。'
          })
        }
      } else {
        message.error(`保存失败: ${result.error}`)
      }
    } catch (err) {
      message.error('保存出错')
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    Modal.confirm({
      title: '确认恢复备份',
      content: '将用备份配置覆盖当前配置，确认继续？',
      onOk: async () => {
        const result = await restoreBackup(selectedId)
        if (result.success) {
          message.success('配置已恢复')
          loadConfig(selectedId)
        } else {
          message.error('恢复失败，可能没有备份文件')
        }
      }
    })
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Typography.Text strong>选择代理：</Typography.Text>
          <Select
            value={selectedId}
            onChange={setSelectedId}
            options={PROXY_OPTIONS}
            style={{ width: 220 }}
          />
        </Space>
      </Card>

      <Card
        loading={loading}
        title={
          <Typography.Text strong>
            {PROXY_OPTIONS.find((o) => o.value === selectedId)?.label} — 配置编辑
          </Typography.Text>
        }
        extra={
          <Space>
            <Button icon={<RollbackOutlined />} onClick={handleRestore} disabled={!backupExists}>
              恢复备份
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              保存配置
            </Button>
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="代理协议">
                    <Tag color="blue">{currentProxy?.protocol?.toUpperCase()}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="本机监听地址">
                    {currentProxy?.localAddress}
                  </Descriptions.Item>
                  <Descriptions.Item label="配置文件格式">
                    <Tag>{configFormat.toUpperCase()}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="备份状态">
                    {backupExists ? <Tag color="green">有备份</Tag> : <Tag>无备份</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="运行状态">
                    {currentProxy?.running ? <Tag color="green">运行中</Tag> : <Tag>已停止</Tag>}
                  </Descriptions.Item>
                </Descriptions>
              )
            },
            {
              key: 'editor',
              label: '配置编辑',
              children: (
                <div style={{ height: 500, border: '1px solid #d9d9d9', borderRadius: 4 }}>
                  <Editor
                    height="100%"
                    language={configFormat === 'yaml' ? 'yaml' : 'json'}
                    value={configContent}
                    onChange={(val) => setConfigContent(val ?? '')}
                    theme="light"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      tabSize: 2
                    }}
                  />
                </div>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}
