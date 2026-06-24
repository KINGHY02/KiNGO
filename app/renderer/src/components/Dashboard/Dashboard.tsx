import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Modal, Space, Tag, Typography, message } from 'antd'
import {
  ChromeOutlined,
  CloudSyncOutlined,
  DisconnectOutlined,
  LoadingOutlined,
  PoweroffOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useTheme } from '../../hooks/useTheme'
import {
  connectPublicRoute,
  disconnectPublicRoute,
  getPublicConnectionState,
  getSettings,
  getSystemProxyStatus,
  launchChrome,
  listPublicRoutes,
  onPublicRoutesChanged,
  onPublicRouteStateChanged,
  repairPublicNetwork,
  selectPublicRoute,
  updatePublicRoute,
} from '../../services/ipc-client'
import PublicRouteDrawer from './PublicRouteDrawer'

const BUSY_STATES: PublicRouteConnectionState[] = ['preparing', 'connecting', 'disconnecting']

export default function Dashboard(): JSX.Element {
  const t = useTheme()
  const [routes, setRoutes] = useState<PublicRoute[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [connection, setConnection] = useState<PublicConnectionState>({
    routeId: null,
    state: 'idle',
    stage: '等待连接',
    error: null,
    errorCode: null,
  })
  const [systemProxyEnabled, setSystemProxyEnabled] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [routeList, state, settings, systemProxy] = await Promise.all([
      listPublicRoutes(),
      getPublicConnectionState(),
      getSettings(),
      getSystemProxyStatus(),
    ])
    setRoutes(routeList)
    setConnection(state)
    setSelectedRouteId(
      settings.selectedPublicRouteId
      || settings.lastSuccessfulRouteId
      || routeList[0]?.id
      || null,
    )
    setSystemProxyEnabled(state.state === 'connected' && (systemProxy.enabled || !!systemProxy.pacUrl))
  }, [])

  useEffect(() => {
    void load()
    const unsubscribeState = onPublicRouteStateChanged((state) => {
      setConnection(state)
      void getSystemProxyStatus().then((status) => {
        setSystemProxyEnabled(state.state === 'connected' && (status.enabled || !!status.pacUrl))
      })
    })
    const unsubscribeRoutes = onPublicRoutesChanged(setRoutes)
    const unsubscribeSettings = window.electronAPI.onSettingsChanged((settings) => {
      setSelectedRouteId(settings.selectedPublicRouteId || settings.lastSuccessfulRouteId)
    })
    return () => {
      unsubscribeState()
      unsubscribeRoutes()
      unsubscribeSettings()
    }
  }, [load])

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) || routes[0] || null,
    [routes, selectedRouteId],
  )
  const connected = connection.state === 'connected'
  const busy = BUSY_STATES.includes(connection.state)

  const statusCopy = useMemo(() => {
    if (connection.state === 'connected') return { title: '已连接', subtitle: '网络连接已建立', color: '#22b573' }
    if (connection.state === 'failed') {
      const friendlyErrors: Partial<Record<PublicRouteErrorCode, string>> = {
        DOWNLOAD_FAILED: '线路配置暂时无法下载',
        CONFIG_SWITCH_FAILED: '线路配置无法启用',
        CONFIG_INVALID: '线路配置已经失效',
        PORT_CONFLICT: '检测到其他代理软件正在占用端口',
        CORE_START_FAILED: '线路运行组件启动失败',
        PORT_NOT_READY: '线路启动超时',
        SYSTEM_PROXY_FAILED: 'Windows 系统代理设置失败',
        CORE_EXITED: '线路连接已中断',
      }
      return {
        title: '连接失败',
        subtitle: (connection.errorCode && friendlyErrors[connection.errorCode]) || '请重试或更换线路',
        color: '#ef5350',
      }
    }
    if (connection.state === 'disconnecting') return { title: '正在断开', subtitle: connection.stage, color: '#8a94a6' }
    if (connection.state === 'preparing' || connection.state === 'connecting') {
      return { title: connection.stage, subtitle: '请稍候，不要重复操作', color: t.accent }
    }
    return { title: '准备就绪', subtitle: '点击按钮开始连接', color: '#8a94a6' }
  }, [connection, t.accent])

  const handleToggle = async (): Promise<void> => {
    if (busy) return
    if (connected) {
      const result = await disconnectPublicRoute()
      if (result.success) message.success('连接已断开')
      return
    }
    if (!selectedRoute) {
      message.warning('暂无可用的公共线路')
      setDrawerOpen(true)
      return
    }
    const result = await connectPublicRoute(selectedRoute.id)
    if (result.success) message.success(`已连接 ${selectedRoute.name}`)
    else message.error(result.error || '公共线路连接失败')
  }

  const handleRouteSelect = async (route: PublicRoute): Promise<void> => {
    setSelectedRouteId(route.id)
    if (connected) {
      const result = await connectPublicRoute(route.id)
      if (result.success) {
        message.success(`已切换到 ${route.name}`)
        setDrawerOpen(false)
      } else message.error(result.error || '线路切换失败')
      return
    }
    const result = await selectPublicRoute(route.id)
    if (result.success) setDrawerOpen(false)
  }

  const handleRefreshSelected = async (): Promise<void> => {
    if (!selectedRoute) return
    setRefreshing(true)
    try {
      const result = await updatePublicRoute(selectedRoute.id)
      if (result.success) message.success(`${selectedRoute.name} 配置已更新`)
      else message.error(result.error || '线路配置更新失败')
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  const handleLaunchChrome = async (): Promise<void> => {
    const result = await launchChrome()
    if (!result.success) message.warning(result.error || '请先建立连接')
  }

  const handleRepairNetwork = (): void => {
    Modal.confirm({
      title: '恢复系统网络设置',
      content: '这会停止 KiNGO 的连接并清理其写入的本地系统代理，不会修改其他网络设置。',
      okText: '立即恢复',
      cancelText: '取消',
      onOk: async () => {
        const result = await repairPublicNetwork()
        if (result.success) {
          setSystemProxyEnabled(false)
          message.success('系统网络设置已恢复')
          await load()
        } else {
          message.error(result.error || '网络设置恢复失败')
        }
      },
    })
  }

  const buttonBackground = connected
    ? 'linear-gradient(145deg, #25c281, #17a86d)'
    : connection.state === 'failed'
      ? 'linear-gradient(145deg, #ff6b6b, #e94d4d)'
      : 'linear-gradient(145deg, #617cff, #7357e8)'

  return (
    <div className="public-home" style={{ background: t.dashGradient }}>
      <div className="public-home__orb public-home__orb--one" />
      <div className="public-home__orb public-home__orb--two" />

      <div className="public-home__header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, color: t.text }}>KiNGO 电脑加速器</Typography.Title>
          <Typography.Text style={{ color: t.textSecondary }}>简单连接，轻松使用</Typography.Text>
        </div>
        <Tag
          icon={<SafetyCertificateOutlined />}
          color={systemProxyEnabled ? 'success' : 'default'}
          style={{ borderRadius: 999, padding: '5px 11px', margin: 0 }}
        >
          系统代理：{systemProxyEnabled ? '已开启' : '未开启'}
        </Tag>
      </div>

      <div className="public-home__content">
        <section className="public-home__connect">
          <div className="public-home__status-dot" style={{ background: statusCopy.color }} />
          <Typography.Title level={2} style={{ margin: '10px 0 2px', color: t.text }}>
            {statusCopy.title}
          </Typography.Title>
          <Typography.Text style={{ color: t.textSecondary }}>{statusCopy.subtitle}</Typography.Text>

          <button
            className={`public-home__power ${busy ? 'is-busy' : ''}`}
            aria-label={connected ? '断开连接' : '开始连接'}
            disabled={busy}
            onClick={() => void handleToggle()}
            style={{
              background: buttonBackground,
              boxShadow: connected
                ? '0 20px 55px rgba(34,181,115,.28)'
                : '0 20px 55px rgba(88,101,242,.32)',
            }}
          >
            <span className="public-home__power-ring" />
            {busy
              ? <LoadingOutlined spin />
              : connected
                ? <DisconnectOutlined />
                : <PoweroffOutlined />}
          </button>
          <Typography.Text strong style={{ color: t.text, fontSize: 15 }}>
            {busy ? connection.stage : connected ? '点击断开' : '开始连接'}
          </Typography.Text>
        </section>

        <Card
          className="public-home__route-card"
          styles={{ body: { padding: 0 } }}
          style={{ background: t.sidebar, borderColor: t.border }}
          onClick={() => setDrawerOpen(true)}
        >
          <div className="public-home__route-row">
            <div>
              <Typography.Text style={{ color: t.textSecondary, fontSize: 12 }}>当前线路</Typography.Text>
              <Space size={8} style={{ display: 'flex', marginTop: 5 }}>
                <Typography.Text strong style={{ color: t.text, fontSize: 16 }}>
                  {selectedRoute?.name || '暂无公共线路'}
                </Typography.Text>
                {selectedRoute && <Tag color="blue" bordered={false}>{selectedRoute.protocolLabel}</Tag>}
              </Space>
            </div>
            <Space>
              <Typography.Text style={{ color: t.textSecondary }}>更换</Typography.Text>
              <RightOutlined style={{ color: t.textSecondary, fontSize: 12 }} />
            </Space>
          </div>
        </Card>

        <div className="public-home__actions">
          <Button icon={<ChromeOutlined />} onClick={() => void handleLaunchChrome()} disabled={!connected}>
            启动浏览器
          </Button>
          <Button icon={<CloudSyncOutlined />} loading={refreshing} onClick={() => void handleRefreshSelected()} disabled={!selectedRoute}>
            刷新线路配置
          </Button>
          <Button icon={<ToolOutlined />} onClick={handleRepairNetwork}>
            恢复网络
          </Button>
        </div>

        {connection.state === 'failed' && (
          <Alert
            type="error"
            showIcon
            message="这条线路暂时无法连接"
            description={
              <Collapse
                ghost
                size="small"
                items={[{ key: 'reason', label: '查看原因', children: connection.error }]}
              />
            }
            action={
              <Space direction="vertical" size={6}>
                <Button size="small" type="primary" onClick={() => void handleToggle()}>重新连接</Button>
                <Button size="small" onClick={() => setDrawerOpen(true)}>更换线路</Button>
              </Space>
            }
          />
        )}

        <Typography.Text className="public-home__notice" style={{ color: t.textSecondary }}>
          KiNGO 是网络连接客户端，不运营或提供代理线路。公共线路来自第三方公开项目，其可用性和稳定性不受 KiNGO 控制。
        </Typography.Text>
      </div>

      <PublicRouteDrawer
        open={drawerOpen}
        routes={routes}
        selectedRouteId={selectedRouteId}
        connectionState={connection}
        onClose={() => setDrawerOpen(false)}
        onSelect={handleRouteSelect}
        onReload={load}
      />
    </div>
  )
}
