import { useMemo, useState } from 'react'
import { Button, Drawer, Empty, Select, Space, Tag, Typography, message } from 'antd'
import {
  CheckCircleFilled,
  CloudDownloadOutlined,
  ReloadOutlined,
  RightOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { useTheme } from '../../hooks/useTheme'
import { updateAllPublicRoutes, updatePublicRoute } from '../../services/ipc-client'

interface Props {
  open: boolean
  routes: PublicRoute[]
  selectedRouteId: string | null
  connectionState: PublicConnectionState
  onClose: () => void
  onSelect: (route: PublicRoute) => Promise<void>
  onReload: () => Promise<void>
}

function routeStatus(route: PublicRoute, state: PublicConnectionState): { text: string; color: string } {
  if (state.routeId === route.id) {
    if (state.state === 'connected') return { text: '已连接', color: 'success' }
    if (state.state === 'preparing') return { text: '准备中', color: 'processing' }
    if (state.state === 'connecting') return { text: '连接中', color: 'processing' }
    if (state.state === 'failed') return { text: '连接失败', color: 'error' }
  }
  if (!route.downloaded) return { text: '未下载', color: 'default' }
  if (route.lastError) return { text: '上次失败', color: 'warning' }
  if (route.lastSuccessAt) return { text: '上次成功', color: 'success' }
  return { text: '未检测', color: 'default' }
}

export default function PublicRouteDrawer(props: Props): JSX.Element {
  const { open, routes, selectedRouteId, connectionState, onClose, onSelect, onReload } = props
  const t = useTheme()
  const [filter, setFilter] = useState('全部')
  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [updatingAll, setUpdatingAll] = useState(false)

  const labels = useMemo(() => ['全部', ...Array.from(new Set(routes.map((route) => route.protocolLabel)))], [routes])
  const visibleRoutes = filter === '全部' ? routes : routes.filter((route) => route.protocolLabel === filter)

  const handleUpdate = async (route: PublicRoute): Promise<void> => {
    setUpdating((current) => new Set(current).add(route.id))
    try {
      const result = await updatePublicRoute(route.id)
      if (result.success) message.success(`${route.name} 配置已更新`)
      else message.error(result.error || '线路配置更新失败')
      await onReload()
    } finally {
      setUpdating((current) => {
        const next = new Set(current)
        next.delete(route.id)
        return next
      })
    }
  }

  const handleUpdateAll = async (): Promise<void> => {
    setUpdatingAll(true)
    try {
      const result = await updateAllPublicRoutes()
      if (result.failed === 0) message.success(`已更新 ${result.updated} 条公共线路`)
      else message.warning(`更新完成：成功 ${result.updated} 条，失败 ${result.failed} 条`)
      await onReload()
    } finally {
      setUpdatingAll(false)
    }
  }

  return (
    <Drawer
      title={
        <div>
          <Typography.Text strong style={{ fontSize: 17 }}>选择公共线路</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
            线路来自第三方公开项目，可用性可能随时变化
          </Typography.Text>
        </div>
      }
      open={open}
      width={420}
      onClose={onClose}
      styles={{
        body: { padding: 18, background: t.bg },
        header: { background: t.sidebar, borderBottom: `1px solid ${t.border}` },
      }}
      extra={<Button type="text" icon={<ReloadOutlined />} onClick={() => void onReload()} />}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Select
          value={filter}
          options={labels.map((label) => ({ label, value: label }))}
          onChange={setFilter}
          style={{ width: '100%' }}
          size="large"
          aria-label="按协议筛选公共线路"
        />

        <Button
          block
          icon={<CloudDownloadOutlined />}
          loading={updatingAll}
          onClick={() => void handleUpdateAll()}
          style={{ height: 40, borderRadius: 10 }}
        >
          更新全部公共线路配置
        </Button>

        {visibleRoutes.length === 0 ? <Empty description="暂无公共线路" /> : visibleRoutes.map((route) => {
          const selected = route.id === selectedRouteId
          const status = routeStatus(route, connectionState)
          return (
            <div
              key={route.id}
              role="button"
              tabIndex={0}
              onClick={() => void onSelect(route)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') void onSelect(route)
              }}
              style={{
                padding: 15,
                borderRadius: 14,
                background: selected ? t.activeBg : t.sidebar,
                border: `1px solid ${selected ? t.accent : t.border}`,
                boxShadow: selected ? '0 8px 24px rgba(75,108,247,.12)' : '0 4px 18px rgba(31,45,75,.05)',
                cursor: 'pointer',
                transition: 'transform .2s ease, border-color .2s ease, box-shadow .2s ease',
                outline: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <Space size={8}>
                    <Typography.Text strong style={{ color: t.text }}>{route.name}</Typography.Text>
                    {selected && <CheckCircleFilled style={{ color: t.accent }} />}
                  </Space>
                  <Space size={7} style={{ display: 'flex', marginTop: 8 }}>
                    <Tag color="blue" bordered={false}>{route.protocolLabel}</Tag>
                    <Tag color={status.color} bordered={false}>{status.text}</Tag>
                  </Space>
                </div>
                <Space>
                  <Button
                    type="text"
                    aria-label={`更新${route.name}`}
                    icon={updating.has(route.id) ? <SyncOutlined spin /> : <CloudDownloadOutlined />}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleUpdate(route)
                    }}
                  />
                  <RightOutlined style={{ color: t.textSecondary, fontSize: 12 }} />
                </Space>
              </div>
            </div>
          )
        })}
      </Space>
    </Drawer>
  )
}
