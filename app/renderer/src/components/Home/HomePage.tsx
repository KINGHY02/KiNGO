import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Descriptions, Drawer, Modal, Row, Space, Switch, Tag, Typography, message } from 'antd'
import {
  ApartmentOutlined,
  ApiOutlined,
  CloudServerOutlined,
  DisconnectOutlined,
  FieldTimeOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import {
  connectPublicRoute,
  diagnoseClashTun,
  disconnectAllConnections,
  getAppConnectionState,
  getClashTrafficOverview,
  getClashRuntimeOptions,
  getExitIpInfo,
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
const TRAFFIC_HISTORY_LIMIT = 36

export default function HomePage({ onNavigate }: Props): JSX.Element {
  const t = useTheme()
  const [routes, setRoutes] = useState<PublicRoute[]>([])
  const [publicState, setPublicState] = useState<PublicConnectionState | null>(null)
  const [appState, setAppState] = useState<AppConnectionState | null>(null)
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [tunEnabled, setTunEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastLatency, setLastLatency] = useState<number | null>(null)
  const [traffic, setTraffic] = useState<ClashTrafficOverview | null>(null)
  const [trafficHistory, setTrafficHistory] = useState<Array<{ up: number; down: number; timestamp: number }>>([])
  const [exitIp, setExitIp] = useState<ExitIpInfo | null>(null)
  const [exitIpLoading, setExitIpLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

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

  useEffect(() => {
    let cancelled = false
    const pollTraffic = async (): Promise<void> => {
      if (appState?.mode !== 'clash' || !appState.connected) {
        setTraffic(null)
        setTrafficHistory([])
        return
      }
      const next = await getClashTrafficOverview().catch(() => null)
      if (cancelled || !next) return
      setTraffic(next)
      if (next.available) {
        setTrafficHistory((prev) => [
          ...prev.slice(-(TRAFFIC_HISTORY_LIMIT - 1)),
          { up: next.up, down: next.down, timestamp: next.timestamp },
        ])
      }
    }
    void pollTraffic()
    const timer = window.setInterval(() => void pollTraffic(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [appState?.connected, appState?.mode])

  const refreshExitIp = useCallback(async (silent = false): Promise<void> => {
    if (!appState?.connected) {
      setExitIp(null)
      return
    }
    if (!silent) setExitIpLoading(true)
    try {
      const info = await getExitIpInfo().catch(() => null)
      setExitIp(info)
      if (!silent && info?.available) message.success('出口 IP 已刷新')
      if (!silent && info && !info.available) message.warning(info.error || '出口 IP 暂时无法检测')
    } finally {
      if (!silent) setExitIpLoading(false)
    }
  }, [appState?.connected])

  useEffect(() => {
    if (!appState?.connected) {
      setExitIp(null)
      return
    }
    void refreshExitIp(true)
    const timer = window.setInterval(() => void refreshExitIp(true), 60_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [appState?.connected, appState?.coreId, appState?.displayName, refreshExitIp])

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
      ? '取消连接'
      : '一键连接'

  const buttonColor = connection.connected
    ? 'linear-gradient(145deg, #20c879, #12a46a)'
    : publicState?.state === 'failed'
      ? 'linear-gradient(145deg, #ff6b6b, #e14c4c)'
      : 'linear-gradient(145deg, #617cff, #7357e8)'

  const handleMainToggle = async (): Promise<void> => {
    if (loading || connection.busy) {
      const result = await disconnectAllConnections()
      if (result.success) message.success('已取消连接')
      else message.error(result.error || '取消连接失败')
      setLoading(false)
      await load()
      return
    }
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
                  onClick={() => void handleMainToggle()}
                  style={{
                    width: 190,
                    height: 190,
                    borderRadius: '50%',
                    border: 'none',
                    cursor: 'pointer',
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
                  <ExitIpSummary info={exitIp} connected={connection.connected} />
                  <Space wrap size={10}>
                    <Tag icon={<FieldTimeOutlined />} color={connection.latency !== null && connection.latency >= 0 ? 'green' : 'default'}>
                      延迟：{connection.latency !== null && connection.latency >= 0 ? `${connection.latency}ms` : '未测速'}
                    </Tag>
                    <Tag icon={<CloudServerOutlined />} color="purple">
                      公共线路：{routes.length} 条
                    </Tag>
                  </Space>
                  <Space wrap size={8}>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={exitIpLoading}
                      disabled={!connection.connected}
                      onClick={() => void refreshExitIp(false)}
                    >
                      刷新出口 IP
                    </Button>
                    <Button size="small" icon={<InfoCircleOutlined />} onClick={() => setDetailOpen(true)}>
                      连接详情
                    </Button>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    公共线路由第三方公开项目提供，KiNGO 不运营线路。
                  </Typography.Text>
                </Space>
              </Col>
            </Row>
          </Card>

          <TrafficStatsCard
            connected={connection.connected}
            source={connection.source}
            traffic={traffic}
            history={trafficHistory}
          />

          <Row gutter={[14, 14]} align="stretch">
            <Col xs={24} md={8}>
              <Card style={{ height: '100%', minHeight: 174 }} styles={{ body: { height: '100%' } }}>
                <Space direction="vertical" size={10} style={{ width: '100%', height: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
                    <Space size={8} style={{ minWidth: 0 }}>
                      <ApiOutlined />
                      <Typography.Text strong ellipsis style={{ fontSize: 16 }}>虚拟网卡 / TUN</Typography.Text>
                    </Space>
                    <Switch size="small" checked={tunEnabled} onChange={(checked) => void handleTunToggle(checked)} />
                  </Space>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                    接管更多系统流量，重启 Clash 后生效。
                  </Typography.Paragraph>
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
      <ConnectionDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        connection={connection}
        appState={appState}
        publicState={publicState}
        proxyEnabled={proxyEnabled}
        tunEnabled={tunEnabled}
        routeCount={routes.length}
        exitIp={exitIp}
        traffic={traffic}
      />
    </div>
  )
}

function ConnectionDetailDrawer(props: {
  open: boolean
  onClose: () => void
  connection: HomeConnection
  appState: AppConnectionState | null
  publicState: PublicConnectionState | null
  proxyEnabled: boolean
  tunEnabled: boolean
  routeCount: number
  exitIp: ExitIpInfo | null
  traffic: ClashTrafficOverview | null
}): JSX.Element {
  const modeLabel = props.connection.source === 'public'
    ? '公共线路'
    : props.connection.source === 'clash'
      ? 'Clash 模式'
      : props.connection.source === 'v2rayn'
        ? 'V2rayN 模式'
        : '未连接'
  const exitIp = props.exitIp
  const exitPlace = exitIp?.available
    ? [exitIp.country, exitIp.city || exitIp.region].filter(Boolean).join(' · ') || '未知地区'
    : exitIp?.error || '未检测'

  return (
    <Drawer
      title="连接详情"
      width={420}
      open={props.open}
      onClose={props.onClose}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Tag color={props.connection.connected ? 'green' : props.connection.busy ? 'processing' : 'default'}>
              {props.connection.connected ? '已连接' : props.connection.busy ? '处理中' : '未连接'}
            </Tag>
            <Tag color="blue" bordered={false}>{modeLabel}</Tag>
          </Space>
          <Typography.Title level={4} style={{ margin: 0 }}>{props.connection.title}</Typography.Title>
          <Typography.Text type="secondary">{props.connection.subtitle}</Typography.Text>
        </Space>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="当前模式">{modeLabel}</Descriptions.Item>
          <Descriptions.Item label="节点 / 线路">{props.connection.title}</Descriptions.Item>
          <Descriptions.Item label="延迟">
            {props.connection.latency !== null && props.connection.latency >= 0 ? `${props.connection.latency}ms` : '未测速'}
          </Descriptions.Item>
          <Descriptions.Item label="系统代理">{props.proxyEnabled ? '已开启' : '未开启'}</Descriptions.Item>
          <Descriptions.Item label="TUN">{props.tunEnabled ? '已启用' : '未启用'}</Descriptions.Item>
          <Descriptions.Item label="核心">{props.appState?.coreId || props.connection.coreId || '-'}</Descriptions.Item>
          <Descriptions.Item label="阶段">{props.appState?.stage || props.publicState?.state || '-'}</Descriptions.Item>
          <Descriptions.Item label="公共线路数量">{props.routeCount}</Descriptions.Item>
          <Descriptions.Item label="出口 IP">{exitIp?.ip || '-'}</Descriptions.Item>
          <Descriptions.Item label="出口地区">{exitPlace}</Descriptions.Item>
          <Descriptions.Item label="运营商">{exitIp?.isp || '-'}</Descriptions.Item>
          <Descriptions.Item label="实时流量">
            下载 {formatBytes(props.traffic?.down || 0)}/s · 上传 {formatBytes(props.traffic?.up || 0)}/s
          </Descriptions.Item>
          <Descriptions.Item label="活跃连接">{props.traffic?.activeConnections || 0}</Descriptions.Item>
          <Descriptions.Item label="错误">
            {props.appState?.error || props.publicState?.error || '-'}
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type="info"
          showIcon
          message="这里用于排查连接状态；普通使用只需要首页一键连接。"
        />
      </Space>
    </Drawer>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function countryFlag(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2) return '🌐'
  const code = countryCode.toUpperCase()
  const first = code.charCodeAt(0)
  const second = code.charCodeAt(1)
  if (first < 65 || first > 90 || second < 65 || second > 90) return '🌐'
  return String.fromCodePoint(127397 + first, 127397 + second)
}

function ExitIpSummary(props: { info: ExitIpInfo | null; connected: boolean }): JSX.Element {
  const info = props.info
  if (!props.connected) {
    return <Typography.Text type="secondary">连接成功后显示出口 IP 和国家地区</Typography.Text>
  }
  if (!info) {
    return <Typography.Text type="secondary">正在检测出口 IP...</Typography.Text>
  }
  if (!info.available) {
    return <Typography.Text type="secondary">出口 IP 暂时无法检测：{info.error || '查询失败'}</Typography.Text>
  }
  const place = [info.country, info.city || info.region].filter(Boolean).join(' · ')
  return (
    <Space wrap size={8}>
      <Tag color="green" style={{ borderRadius: 999 }}>
        {countryFlag(info.countryCode)} {place || '未知地区'}
      </Tag>
      {info.ip && <Tag bordered={false}>出口 IP：{info.ip}</Tag>}
      {info.isp && <Tag bordered={false}>{info.isp}</Tag>}
    </Space>
  )
}

function TrafficStatsCard(props: {
  connected: boolean
  source: HomeSource
  traffic: ClashTrafficOverview | null
  history: Array<{ up: number; down: number; timestamp: number }>
}): JSX.Element {
  const supported = props.source === 'clash'
  const traffic = props.traffic
  const statusText = !props.connected
    ? '连接后显示实时流量'
    : supported
      ? traffic?.available === false
        ? '等待 mihomo 控制接口'
        : '实时流量统计'
      : '该模式的实时流量统计将在后续适配'

  return (
    <Card style={{ borderRadius: 18 }} styles={{ body: { padding: 16 } }}>
      <Row gutter={[14, 14]} align="middle">
        <Col xs={24} lg={7}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space size={8} wrap>
              <Typography.Text type="secondary">流量统计</Typography.Text>
              <Tag color={supported ? 'blue' : 'default'} bordered={false}>{supported ? 'Clash 实时' : '待适配'}</Tag>
            </Space>
            <Typography.Text strong ellipsis style={{ fontSize: 17 }}>{statusText}</Typography.Text>
            <Typography.Text type="secondary" ellipsis style={{ fontSize: 12 }}>
              {supported ? '下载 / 上传 / 活跃连接' : 'Clash 模式已支持，其他核心逐步接入'}
            </Typography.Text>
            <Space size={6} wrap style={{ marginTop: 2 }}>
              <Tag bordered={false}>连接 {traffic?.activeConnections || 0}</Tag>
              <Tag bordered={false}>总下载 {formatBytes(traffic?.downloadTotal || 0)}</Tag>
              <Tag bordered={false}>总上传 {formatBytes(traffic?.uploadTotal || 0)}</Tag>
            </Space>
          </Space>
        </Col>
        <Col xs={12} lg={4}>
          <TrafficMetric label="下载" value={`${formatBytes(traffic?.down || 0)}/s`} color="#18b566" />
        </Col>
        <Col xs={12} lg={4}>
          <TrafficMetric label="上传" value={`${formatBytes(traffic?.up || 0)}/s`} color="#4b6cf7" />
        </Col>
        <Col xs={24} lg={9}>
          <TrafficSparkline history={props.history} />
        </Col>
      </Row>
    </Card>
  )
}

function TrafficMetric(props: { label: string; value: string; color: string }): JSX.Element {
  return (
    <div style={{
      border: '1px solid var(--ant-color-border)',
      borderRadius: 14,
      padding: '10px 12px',
      background: 'var(--ant-color-fill-tertiary)',
      minHeight: 72,
      overflow: 'hidden',
    }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{props.label}</Typography.Text>
      <div style={{ color: props.color, fontSize: 20, fontWeight: 800, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.value}</div>
    </div>
  )
}

function TrafficSparkline(props: { history: Array<{ up: number; down: number; timestamp: number }> }): JSX.Element {
  const width = 260
  const height = 72
  const points = props.history.length > 1 ? props.history : [{ up: 0, down: 0, timestamp: Date.now() }, { up: 0, down: 0, timestamp: Date.now() + 1 }]
  const max = Math.max(1, ...points.flatMap((item) => [item.up, item.down]))
  const toPath = (field: 'up' | 'down'): string => points.map((item, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
    const y = height - (item[field] / max) * (height - 10) - 5
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block' }} role="img" aria-label="实时流量曲线">
      <rect x="0" y="0" width={width} height={height} rx="14" fill="var(--ant-color-fill-tertiary)" />
      <path d={toPath('down')} fill="none" stroke="#18b566" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={toPath('up')} fill="none" stroke="#4b6cf7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.86" />
    </svg>
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
      <Card style={{ height: '100%', minHeight: 174 }} styles={{ body: { height: '100%' } }}>
        <Space direction="vertical" size={12} style={{ width: '100%', height: '100%' }}>
          <Space style={{ width: '100%', minWidth: 0 }} align="center">
            <span style={{ fontSize: 22, flex: 'none' }}>{props.icon}</span>
            <Typography.Text strong ellipsis style={{ fontSize: 16, flex: 1, minWidth: 0 }}>{props.title}</Typography.Text>
            <Tag color="blue" bordered={false} style={{ marginInlineEnd: 0 }}>{props.tag}</Tag>
          </Space>
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {props.description}
          </Typography.Paragraph>
          <Button type="primary" block onClick={props.onClick} style={{ marginTop: 'auto' }}>{props.action}</Button>
        </Space>
      </Card>
    </Col>
  )
}
