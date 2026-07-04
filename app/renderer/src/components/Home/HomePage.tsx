import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Modal, Row, Space, Switch, Tag, Typography, message } from 'antd'
import {
  ApartmentOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DisconnectOutlined,
  FieldTimeOutlined,
  NodeIndexOutlined,
  PoweroffOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import {
  connectPublicRoute,
  diagnoseClashTun,
  disconnectAllConnections,
  getAppConnectionState,
  getClashRuntimeOptions,
  getPublicConnectionState,
  getSystemProxyStatus,
  listPublicRoutes,
  onAppConnectionStateChanged,
  updateClashRuntimeOptions,
} from '../../services/ipc-client'
import { useTheme } from '../../hooks/useTheme'

interface Props {
  onNavigate: (page: 'clash' | 'v2rayn' | 'publicRoutes' | 'logs' | 'settings') => void
}

type HomeSource = 'none' | 'public' | 'clash' | 'v2rayn'

interface HomeConnection {
  source: HomeSource
  connected: boolean
  busy: boolean
  title: string
  subtitle: string
  routeId?: string | null
  coreId?: string
  latency: number | null
}

const PUBLIC_BUSY: PublicRouteConnectionState[] = ['preparing', 'connecting', 'disconnecting']

export default function HomePage({ onNavigate }: Props): JSX.Element {
  const t = useTheme()
  const [routes, setRoutes] = useState<PublicRoute[]>([])
  const [publicState, setPublicState] = useState<PublicConnectionState | null>(null)
  const [appState, setAppState] = useState<AppConnectionState | null>(null)
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [tunEnabled, setTunEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastLatency, setLastLatency] = useState<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [nextRoutes, appConnection, routeState, proxy, runtime] = await Promise.all([
      listPublicRoutes(),
      getAppConnectionState(),
      getPublicConnectionState(),
      getSystemProxyStatus(),
      getClashRuntimeOptions(),
    ])
    setRoutes(nextRoutes)
    setAppState(appConnection)
    setPublicState(routeState)
    setProxyEnabled(proxy.enabled || !!proxy.pacUrl)
    setTunEnabled(runtime.tunEnabled)
    if (appConnection.latency !== null) setLastLatency(appConnection.latency)
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = onAppConnectionStateChanged((state) => {
      setAppState(state)
      if (state.latency !== null) setLastLatency(state.latency)
      void getSystemProxyStatus().then((proxy) => {
        setProxyEnabled(proxy.enabled || !!proxy.pacUrl)
      }).catch(() => undefined)
    })
    const timer = window.setInterval(load, 5000)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [load])

  const connection = useMemo<HomeConnection>(() => {
    const publicBusy = publicState ? PUBLIC_BUSY.includes(publicState.state) : false
    if (appState?.connected) {
      const source: HomeSource = appState.mode === 'public-route' ? 'public' : appState.mode === 'clash' ? 'clash' : appState.mode === 'v2rayn' ? 'v2rayn' : 'none'
      return {
        source,
        connected: true,
        busy: appState.busy,
        title: appState.displayName || '已连接',
        subtitle: appState.mode === 'public-route'
          ? `公共线路${appState.detail ? ` · ${appState.detail}` : ''}`
          : appState.mode === 'clash'
            ? `Clash 模式${appState.detail ? ` · ${appState.detail}` : ''}`
            : `V2rayN 模式${appState.detail ? ` · ${appState.detail}` : ''}`,
        coreId: appState.coreId || undefined,
        latency: appState.latency ?? lastLatency,
      }
    }

    if (publicState?.state === 'failed') {
      return {
        source: 'none',
        connected: false,
        busy: false,
        title: '上次连接失败',
        subtitle: publicState.error || '可以重试，或进入公共线路更换线路',
        latency: null,
      }
    }

    return {
      source: 'none',
      connected: false,
      busy: appState?.busy ?? publicBusy,
      title: '未连接',
      subtitle: '点击按钮自动选择一条公共线路',
      latency: null,
    }
  }, [appState, lastLatency, publicState])

  const buttonCopy = connection.connected
    ? '断开连接'
    : connection.busy || loading
      ? '正在处理'
      : '一键连接'

  const buttonColor = connection.connected
    ? 'linear-gradient(145deg, #20c879, #12a46a)'
    : publicState?.state === 'failed'
      ? 'linear-gradient(145deg, #ff6b6b, #e14c4c)'
      : 'linear-gradient(145deg, #617cff, #7357e8)'

  const handleMainToggle = async (): Promise<void> => {
    if (loading || connection.busy) return
    setLoading(true)
    try {
      if (connection.connected) {
        const result = await disconnectAllConnections()
        if (result.success) message.success('连接已断开')
        else message.error(result.error || '断开连接失败')
        await load()
        return
      }

      const result = await connectPublicRoute()
      const route = routes.find((item) => item.id === result.routeId)
      if (!result.success && routes.length === 0) {
        message.warning('暂无公共线路，请先进入公共线路页面更新配置')
        onNavigate('publicRoutes')
        return
      }
      if (result.success) message.success(`已连接 ${route?.name || '公共线路'}`)
      else message.error(result.error || '公共线路连接失败')
      await load()
    } finally {
      setLoading(false)
    }
  }

  const handleTunToggle = async (checked: boolean): Promise<void> => {
    if (checked) {
      Modal.confirm({
        title: '启用 TUN 模式',
        content: 'TUN 会尝试接管更多系统流量，可能需要管理员权限或虚拟网卡能力。建议确认网络可恢复后再开启。',
        okText: '启用',
        cancelText: '取消',
        onOk: async () => {
          const result = await updateClashRuntimeOptions({ tunEnabled: true })
          if (!result.success) message.error(result.error || 'TUN 设置失败')
          else {
            setTunEnabled(true)
            message.success('TUN 将在下次启动 Clash 模式时生效')
          }
        },
      })
      return
    }
    const result = await updateClashRuntimeOptions({ tunEnabled: false })
    if (!result.success) message.error(result.error || 'TUN 设置失败')
    else {
      setTunEnabled(false)
      message.success('TUN 将在下次启动 Clash 模式时关闭')
    }
  }

  const handleTunDiagnose = async (): Promise<void> => {
    const report = await diagnoseClashTun()
    Modal.info({
      title: 'TUN 诊断',
      width: 640,
      content: (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert type={report.ready ? 'success' : 'error'} showIcon message={report.summary} />
          {report.checks.map((check) => (
            <div key={check.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Tag color={check.status === 'pass' ? 'green' : check.status === 'warn' ? 'gold' : 'red'}>
                {check.status === 'pass' ? '通过' : check.status === 'warn' ? '注意' : '失败'}
              </Tag>
              <div>
                <Typography.Text strong>{check.label}</Typography.Text>
                <div><Typography.Text type="secondary">{check.message}</Typography.Text></div>
              </div>
            </div>
          ))}
        </Space>
      ),
    })
  }

  return (
    <div style={{ minHeight: '100%', padding: 28, background: t.dashGradient }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start' }}>
            <div>
              <Typography.Title level={2} style={{ margin: 0, color: t.text }}>KiNGO</Typography.Title>
              <Typography.Text style={{ color: t.textSecondary }}>
                一键连接，清晰切换。
              </Typography.Text>
            </div>
            <Tag color={proxyEnabled ? 'success' : 'default'} icon={<SafetyCertificateOutlined />} style={{ borderRadius: 999, padding: '5px 12px' }}>
              系统代理：{proxyEnabled ? '已开启' : '未开启'}
            </Tag>
          </div>

          <Card style={{ borderRadius: 22, overflow: 'hidden' }}>
            <Row gutter={[22, 22]} align="middle">
              <Col xs={24} md={10} style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  disabled={loading || connection.busy}
                  onClick={() => void handleMainToggle()}
                  style={{
                    width: 190,
                    height: 190,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: loading || connection.busy ? 'wait' : 'pointer',
                    background: buttonColor,
                    color: '#fff',
                    boxShadow: connection.connected ? '0 20px 48px rgba(32, 200, 121, 0.32)' : '0 20px 48px rgba(97, 124, 255, 0.34)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Space direction="vertical" size={8} align="center">
                    {connection.connected ? <DisconnectOutlined style={{ fontSize: 44 }} /> : <PoweroffOutlined style={{ fontSize: 48 }} />}
                    <Typography.Text style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{buttonCopy}</Typography.Text>
                    {!connection.connected && <Typography.Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>自动选择公共线路</Typography.Text>}
                  </Space>
                </button>
              </Col>
              <Col xs={24} md={14}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={connection.connected ? 'green' : publicState?.state === 'failed' ? 'red' : 'default'} style={{ borderRadius: 999 }}>
                      {connection.connected ? '已连接' : publicState?.state === 'failed' ? '连接失败' : '待连接'}
                    </Tag>
                    <Tag color="blue" bordered={false}>
                      {connection.source === 'public' ? '公共线路' : connection.source === 'clash' ? 'Clash 模式' : connection.source === 'v2rayn' ? 'V2rayN 模式' : '首页一键'}
                    </Tag>
                  </Space>
                  <Typography.Title level={3} style={{ margin: 0 }}>{connection.title}</Typography.Title>
                  <Typography.Text type="secondary">{connection.subtitle}</Typography.Text>
                  <Space wrap size={10}>
                    <Tag icon={<FieldTimeOutlined />} color={connection.latency !== null && connection.latency >= 0 ? 'green' : 'default'}>
                      延迟：{connection.latency !== null && connection.latency >= 0 ? `${connection.latency}ms` : '未测速'}
                    </Tag>
                    <Tag icon={<CloudServerOutlined />} color="purple">
                      公共线路：{routes.length} 条
                    </Tag>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    公共线路由第三方公开项目提供，KiNGO 不运营线路。
                  </Typography.Text>
                </Space>
              </Col>
            </Row>
          </Card>

          <Row gutter={[14, 14]}>
            <Col xs={24} md={8}>
              <Card style={{ height: '100%', minHeight: 188 }}>
                <Space direction="vertical" size={10} style={{ width: '100%', height: '100%' }}>
                  <Space style={{ width: '100%' }}>
                    <ApiOutlined />
                    <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>虚拟网卡 / TUN</Typography.Text>
                    <Switch size="small" checked={tunEnabled} onChange={(checked) => void handleTunToggle(checked)} />
                  </Space>
                  <Typography.Text type="secondary">接管更多系统流量，重启 Clash 后生效。</Typography.Text>
                  <Button size="small" onClick={() => void handleTunDiagnose()} style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>诊断 TUN</Button>
                </Space>
              </Card>
            </Col>
            <ModeCard
              icon={<ApartmentOutlined />}
              title="Clash 模式"
              tag="mihomo"
              description="导入 Clash 订阅，选择代理组和规则。"
              action="进入 Clash"
              onClick={() => onNavigate('clash')}
            />
            <ModeCard
              icon={<NodeIndexOutlined />}
              title="V2rayN 模式"
              tag="Xray / sing-box"
              description="管理节点分组、订阅、测速和连接。"
              action="进入 V2rayN"
              onClick={() => onNavigate('v2rayn')}
            />
          </Row>

          <Card>
            <Space wrap>
              <Button icon={<CloudServerOutlined />} onClick={() => onNavigate('publicRoutes')}>管理公共线路</Button>
              <Button onClick={() => onNavigate('logs')}>查看日志</Button>
            </Space>
          </Card>
        </Space>
      </div>
    </div>
  )
}

function ModeCard(props: {
  icon: JSX.Element
  title: string
  tag: string
  description: string
  action: string
  onClick: () => void
}): JSX.Element {
  return (
    <Col xs={24} md={8}>
      <Card style={{ height: '100%', minHeight: 188 }}>
        <Space direction="vertical" size={12} style={{ width: '100%', height: '100%' }}>
          <Space style={{ width: '100%' }}>
            <span style={{ fontSize: 22 }}>{props.icon}</span>
            <Typography.Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>{props.title}</Typography.Text>
            <Tag color="blue" bordered={false}>{props.tag}</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ minHeight: 66, marginBottom: 0 }}>
            {props.description}
          </Typography.Paragraph>
          <Button type="primary" block onClick={props.onClick} style={{ marginTop: 'auto' }}>{props.action}</Button>
        </Space>
      </Card>
    </Col>
  )
}
