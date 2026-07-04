import { useState, useEffect } from 'react'
import { Card, Form, Switch, Input, InputNumber, Button, Typography, Divider, message, Select, Space, Row, Col } from 'antd'
import { CloudDownloadOutlined, GithubOutlined, LinkOutlined, CopyrightCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { getSettings, setSettings, getAppVersion, checkForUpdates, getCompatibleCores } from '../../services/ipc-client'
import CoreVersion from '../CoreVersion/CoreVersion'

const { Link, Text, Title } = Typography

const INITIAL_VALUES = {
  systemProxy: false,
  proxyMode: 'rule',
  autoStart: false,
  browserPath: 'Browser\\chrome.exe',
  minimizeToTray: true,
  theme: 'light',
  autoCheckUpdates: true,
  updateMirror: '',
  publicRouteAutoSelectMode: 'quick',
  publicRouteAutoSelectLimit: 8,
  publicRouteAutoSwitch: true,
  publicRouteHealthCheckInterval: 30,
  publicRouteHealthCheckFailures: 3,
  defaultCoreByProtocol: {}
}

const DEFAULT_CORE_BY_PROTOCOL: Record<string, string> = {
  vmess: 'xray',
  vless: 'xray',
  trojan: 'xray',
  ss: 'xray',
  ss2022: 'singbox',
  ssr: 'singbox',
  hysteria: 'hysteria',
  hysteria2: 'singbox',
  tuic: 'singbox',
  naive: 'naiveproxy',
  juicity: 'juicity',
  mieru: 'mieru',
  shadowquic: 'shadowquic'
}

const PROTOCOL_ITEMS: Array<{ protocol: string; label: string }> = [
  { protocol: 'vmess', label: 'VMess' },
  { protocol: 'vless', label: 'VLESS' },
  { protocol: 'trojan', label: 'Trojan' },
  { protocol: 'ss', label: 'Shadowsocks' },
  { protocol: 'ss2022', label: 'Shadowsocks 2022' },
  { protocol: 'ssr', label: 'ShadowsocksR' },
  { protocol: 'hysteria', label: 'Hysteria v1' },
  { protocol: 'hysteria2', label: 'Hysteria v2' },
  { protocol: 'tuic', label: 'TUIC' },
  { protocol: 'naive', label: 'NaiveProxy' },
  { protocol: 'juicity', label: 'Juicity' },
  { protocol: 'mieru', label: 'Mieru' },
  { protocol: 'shadowquic', label: 'ShadowQUIC' }
]

const CORE_LABELS: Record<string, string> = {
  'clash-meta': 'mihomo / Clash',
  xray: 'Xray',
  hysteria: 'Hysteria v1',
  hysteria2: 'Hysteria v2',
  singbox: 'Sing-Box',
  naiveproxy: 'NaiveProxy',
  juicity: 'Juicity',
  mieru: 'Mieru',
  shadowquic: 'ShadowQUIC'
}

function TelegramLogo(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 240 240" aria-hidden="true" style={{ marginRight: 6, verticalAlign: -3 }}>
      <circle cx="120" cy="120" r="120" fill="#229ED9" />
      <path
        fill="#fff"
        d="M51.9 117.1c35-15.2 58.3-25.2 70-30 33.3-13.8 40.2-16.2 44.7-16.3 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.4 1.7 3.4.2 1 .4 3.2.2 4.9-2 21.4-10.8 73.3-15.3 97.3-1.9 10.2-5.7 13.6-9.3 13.9-7.9.7-13.9-5.2-21.5-10.2-12-7.8-18.7-12.7-30.3-20.3-13.4-8.8-4.7-13.7 2.9-21.6 2-2.1 36.7-33.6 37.4-36.5.1-.4.2-1.7-.6-2.4-.8-.7-2-.5-2.8-.3-1.2.3-20.3 12.9-57.2 37.9-5.4 3.7-10.3 5.5-14.7 5.4-4.8-.1-14.1-2.7-21-4.9-8.5-2.8-15.2-4.2-14.6-8.9.3-2.4 3.9-4.9 10.9-7.8Z"
      />
    </svg>
  )
}

export default function Settings(): JSX.Element {
  const [form] = Form.useForm()
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [systemProxyEnabled, setSystemProxyEnabled] = useState(false)
  const [coreOptions, setCoreOptions] = useState<Record<string, Array<{ label: string; value: string }>>>({})

  useEffect(() => {
    loadSettings()
    getAppVersion().then(setVersion).catch(() => setVersion('1.0.0'))
    Promise.all(
      PROTOCOL_ITEMS.map(async ({ protocol }) => {
        const cores = await getCompatibleCores(protocol)
        return {
          protocol,
          options: cores.map((core) => ({ label: CORE_LABELS[core.id] || core.id, value: core.id }))
        }
      })
    ).then((items) => {
      setCoreOptions(Object.fromEntries(items.map((item) => [item.protocol, item.options])))
    }).catch(() => {})
  }, [])

  const loadSettings = async (): Promise<void> => {
    try {
      const settings = await getSettings()
      const mergedSettings = {
        ...settings,
        defaultCoreByProtocol: {
          ...DEFAULT_CORE_BY_PROTOCOL,
          ...(settings.defaultCoreByProtocol || {})
        }
      }
      setSystemProxyEnabled(settings.systemProxy)
      setLoaded(true)
      setTimeout(() => form.setFieldsValue(mergedSettings), 0)
    } catch {
      setLoaded(true)
      message.error('加载设置失败')
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

  const saveDefaultCoreByProtocol = async (protocol: string, core: string): Promise<void> => {
    const current = form.getFieldsValue()
    const merged = { ...DEFAULT_CORE_BY_PROTOCOL, ...(current.defaultCoreByProtocol || {}), [protocol]: core }
    await setSettings({ defaultCoreByProtocol: merged }).catch(() => {})
  }

  if (!loaded) return <Typography.Text>加载中...</Typography.Text>

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={INITIAL_VALUES}
      onValuesChange={(changed) => {
        if ('systemProxy' in changed) setSystemProxyEnabled(changed.systemProxy)
        if ('defaultCoreByProtocol' in changed) return // handled per-protocol onChange
        const [key] = Object.keys(changed)
        if (key !== 'browserPath' && key !== 'updateMirror') {
          setSettings({ [key]: changed[key] as never }).catch(() => {})
        }
      }}
    >
      <div style={{ width: '100%', maxWidth: '100%' }}>
        <Card title="基本设置">
          <Form.Item
            label="连接时自动设置系统代理"
            name="systemProxy"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          {systemProxyEnabled && (
            <Form.Item label="代理模式" name="proxyMode">
              <Select
                options={[
                  { label: '规则模式', value: 'rule' },
                  { label: '全局模式', value: 'global' }
                ]}
                style={{ width: 160 }}
              />
            </Form.Item>
          )}

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
            <Input style={{ width: 320 }} onBlur={(e) => setSettings({ browserPath: e.target.value }).catch(() => {})} />
          </Form.Item>

          <Form.Item label="界面主题" name="theme">
            <Select
              options={[
                { label: '亮色', value: 'light' },
                { label: '暗色', value: 'dark' },
                { label: '粉色', value: 'pink' },
                { label: '冰川蓝', value: 'blue' }
              ]}
              style={{ width: 120 }}
            />
          </Form.Item>

          <Form.Item
            label="公共线路自动选择"
            name="publicRouteAutoSelectMode"
            extra="快速模式按下方数量测试已下载线路；完整模式会测试全部已下载线路，选择更准但等待更久。"
          >
            <Select
              options={[
                { label: '快速模式', value: 'quick' },
                { label: '完整模式', value: 'full' }
              ]}
              style={{ width: 180 }}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.publicRouteAutoSelectMode !== next.publicRouteAutoSelectMode}
          >
            {({ getFieldValue }) => getFieldValue('publicRouteAutoSelectMode') === 'quick' ? (
              <Form.Item
                label="快速模式测速数量"
                name="publicRouteAutoSelectLimit"
                extra="数量越大，选择越准，但一键连接等待时间越长。建议 8–12。"
              >
                <InputNumber min={1} max={50} precision={0} style={{ width: 180 }} addonAfter="条线路" />
              </Form.Item>
            ) : null}
          </Form.Item>

          <Divider />

          <Form.Item
            label="公共线路断线自动切换"
            name="publicRouteAutoSwitch"
            valuePropName="checked"
            extra="连接成功后会定时检测当前公共线路，连续失败后自动切换到其他可用线路。"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.publicRouteAutoSwitch !== next.publicRouteAutoSwitch}
          >
            {({ getFieldValue }) => getFieldValue('publicRouteAutoSwitch') ? (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    label="健康检查间隔"
                    name="publicRouteHealthCheckInterval"
                    extra="建议 30 秒。太短可能增加切换误判。"
                  >
                    <InputNumber min={10} max={300} precision={0} style={{ width: '100%' }} addonAfter="秒" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="连续失败后切换"
                    name="publicRouteHealthCheckFailures"
                    extra="建议 3 次。"
                  >
                    <InputNumber min={1} max={10} precision={0} style={{ width: '100%' }} addonAfter="次" />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}
          </Form.Item>

        </Card>

      <Card title="按协议默认核心" style={{ marginTop: 16 }}>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          当连接节点时，根据协议自动选择默认使用的代理核心，可在设置中按需修改。
        </Typography.Text>
        <Row gutter={[8, 8]}>
          {PROTOCOL_ITEMS.map(({ protocol, label }) => (
            <Col xs={24} sm={12} md={8} key={protocol}>
              <Form.Item
                label={<Text style={{ fontSize: 12 }}>{label}</Text>}
                name={['defaultCoreByProtocol', protocol]}
              >
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  options={coreOptions[protocol] || []}
                  onChange={(val) => saveDefaultCoreByProtocol(protocol, val)}
                />
              </Form.Item>
            </Col>
          ))}
        </Row>
      </Card>

      <Card title="更新" style={{ marginTop: 16 }}>
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
            <Input placeholder="https://example.com/updates" style={{ width: 320 }} onBlur={(e) => setSettings({ updateMirror: e.target.value }).catch(() => {})} />
          </Form.Item>
      </Card>

      <CoreVersion />

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
            <Link href="https://t.me/kingovpn" target="_blank">
              <TelegramLogo />
              Telegram 用户群
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
    </Form>
  )
}
