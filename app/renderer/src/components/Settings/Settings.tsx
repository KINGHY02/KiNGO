import { useState, useEffect } from 'react'
import { Card, Form, Switch, Input, Button, Typography, Divider, message, Select, Space } from 'antd'
import { CloudDownloadOutlined, GithubOutlined, LinkOutlined, CopyrightCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { getSettings, setSettings, getAppVersion, checkForUpdates } from '../../services/ipc-client'

const { Link, Text, Title } = Typography

export default function Settings(): JSX.Element {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [lastCheck, setLastCheck] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
    getAppVersion().then(setVersion).catch(() => setVersion('1.0.0'))
  }, [])

  const loadSettings = async (): Promise<void> => {
    try {
      const settings = await getSettings()
      form.setFieldsValue(settings)
      setLoaded(true)
    } catch {
      message.error('加载设置失败')
    }
  }

  const handleSave = async (): Promise<void> => {
    setLoading(true)
    try {
      const values = form.getFieldsValue()
      await setSettings(values)
      message.success('设置已保存')
    } catch {
      message.error('保存设置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCheckUpdate = async (): Promise<void> => {
    setChecking(true)
    try {
      const result = await checkForUpdates()
      if (result.checking) {
        setLastCheck(new Date().toLocaleString('zh-CN'))
        message.info('正在检查更新...')
      }
    } catch {
      message.error('检查更新失败')
    } finally {
      setChecking(false)
    }
  }

  if (!loaded) return <Typography.Text>加载中...</Typography.Text>

  return (
    <div style={{ maxWidth: 600 }}>
      <Card title="基本设置">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            systemProxy: false,
            autoStart: false,
            browserPath: 'Browser\\chrome.exe',
            minimizeToTray: true,
            theme: 'light',
            autoCheckUpdates: true,
            updateMirror: ''
          }}
        >
          <Form.Item
            label="连接时自动设置系统代理"
            name="systemProxy"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="开机自动启动"
            name="autoStart"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="关闭窗口行为"
            name="minimizeToTray"
            valuePropName="checked"
          >
            <Switch checkedChildren="最小化到托盘" unCheckedChildren="直接退出" />
          </Form.Item>

          <Divider />

          <Form.Item label="浏览器路径" name="browserPath">
            <Input style={{ width: 320 }} />
          </Form.Item>

          <Form.Item label="界面主题" name="theme">
            <Select
              options={[
                { label: '亮色', value: 'light' },
                { label: '暗色', value: 'dark' }
              ]}
              style={{ width: 120 }}
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" onClick={handleSave} loading={loading}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="更新" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical">
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text>当前版本:</Text>
            <Text strong style={{ fontSize: 15 }}>v{version || '1.0.0'}</Text>
            {checking ? (
              <Text type="secondary" style={{ fontSize: 12 }}>检查中...</Text>
            ) : lastCheck ? (
              <Text type="secondary" style={{ fontSize: 12 }}>上次检查: {lastCheck}</Text>
            ) : null}
          </div>

          <Space style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              onClick={handleCheckUpdate}
              loading={checking}
            >
              检查更新
            </Button>
          </Space>

          <Form.Item
            label="启动时自动检查更新"
            name="autoCheckUpdates"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="更新镜像地址（可选，用于加速下载）"
            name="updateMirror"
            extra="留空则使用 GitHub Releases 直连"
          >
            <Input placeholder="https://example.com/updates" style={{ width: 320 }} />
          </Form.Item>
        </Form>
      </Card>

      <Card title="关于" style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ marginBottom: 2 }}>KiNGO</Title>
          <Text type="secondary">网络代理管理桌面客户端 v{version || '1.0.0'}</Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <Text strong>
            <CopyrightCircleOutlined style={{ marginRight: 6 }} />
            版权所有
          </Text>
          <br />
          <Text>Copyright &copy; {new Date().getFullYear()} KINGHY02. All rights reserved.</Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={6}>
            <Link href="https://github.com/KINGHY02/KiNGO" target="_blank">
              <GithubOutlined style={{ marginRight: 6 }} />
              GitHub 项目主页
            </Link>
            <Link href="https://github.com/KINGHY02/KiNGO/releases" target="_blank">
              <CloudDownloadOutlined style={{ marginRight: 6 }} />
              最新版本下载
            </Link>
            <Link href="https://github.com/KINGHY02/KiNGO/releases/latest" target="_blank">
              <LinkOutlined style={{ marginRight: 6 }} />
              更新日志 (Releases)
            </Link>
          </Space>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{
          background: 'var(--ant-color-warning-bg, #fffbe6)',
          border: '1px solid var(--ant-color-warning-border, #ffe58f)',
          borderRadius: 8,
          padding: 12,
          marginTop: 12
        }}>
          <Text strong style={{ color: 'var(--ant-color-warning-text, #ad6800)', fontSize: 13 }}>
            <WarningOutlined style={{ marginRight: 6 }} />
            免责声明
          </Text>
          <br />
          <Text style={{ fontSize: 12, color: 'var(--ant-color-warning-text, #ad6800)', lineHeight: 1.8 }}>
            1. 本软件仅供学习、研究及个人合法使用，严禁用于任何违法违规活动。
            <br />
            2. 使用者应遵守所在国家/地区的法律法规，因违规使用产生的任何法律责任由使用者自行承担。
            <br />
            3. 本软件不提供任何代理服务，所有代理节点均需用户自行配置。
            <br />
            4. 作者不对因使用本软件造成的任何直接或间接损失承担责任。
            <br />
            5. 本软件为开源项目，采用 MIT 协议发布，欢迎社区贡献。
          </Text>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        <Text type="secondary" style={{ fontSize: 12 }}>
          作者: KINGHY02 &nbsp;|&nbsp; 标识: KiNGO &nbsp;|&nbsp; 协议: MIT License
        </Text>
      </Card>
    </div>
  )
}
