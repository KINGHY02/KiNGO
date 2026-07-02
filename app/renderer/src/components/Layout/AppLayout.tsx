import React, { Suspense, lazy, useEffect, useState } from 'react'
import { Layout, Menu, Typography, Button, Tooltip, type MenuProps } from 'antd'
import {
  ApartmentOutlined,
  BlockOutlined,
  BorderOutlined,
  CloseOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HeartOutlined,
  LeftOutlined,
  MinusOutlined,
  MoonOutlined,
  NodeIndexOutlined,
  RightOutlined,
  SettingOutlined,
  StarOutlined,
  SunOutlined,
} from '@ant-design/icons'
import HomePage from '../Home/HomePage'
import logo from '../../assets/KiNGO.png'
import { minimizeWindow, maximizeWindow, closeWindow, isMaximized as getIsMaximized, getAppVersion } from '../../services/ipc-client'
import { useTheme, useSetTheme } from '../../hooks/useTheme'

const { Sider, Content } = Layout

const Dashboard = lazy(() => import('../Dashboard/Dashboard'))
const Settings = lazy(() => import('../Settings/Settings'))
const LogViewer = lazy(() => import('../LogViewer/LogViewer'))
const ClashMode = lazy(() => import('../Clash/ClashMode'))
const V2rayNMode = lazy(() => import('../V2rayN/V2rayNMode'))

type PageKey = 'dashboard' | 'clash' | 'v2rayn' | 'publicRoutes' | 'settings' | 'logs'
type DragStyle = React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const menuItems: MenuProps['items'] = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '首页' },
  { key: 'clash', icon: <ApartmentOutlined />, label: 'Clash 模式' },
  { key: 'v2rayn', icon: <NodeIndexOutlined />, label: 'V2rayN 模式' },
  { key: 'publicRoutes', icon: <CloudServerOutlined />, label: '公共线路' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  { key: 'logs', icon: <FileTextOutlined />, label: '连接日志' },
]

export default function AppLayout(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<PageKey>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [version, setVersion] = useState('')
  const t = useTheme()
  const setThemeMode = useSetTheme()

  useEffect(() => {
    getIsMaximized().then(setMaximized)
    getAppVersion().then(setVersion).catch(() => setVersion('1.0.0'))
    const api = window.electronAPI
    if (api.onMaximizeChanged) {
      api.onMaximizeChanged((val: boolean) => setMaximized(val))
    }
  }, [])

  const renderPage = (): React.ReactNode => {
    switch (currentPage) {
      case 'dashboard':
        return <HomePage onNavigate={(page) => setCurrentPage(page)} />
      case 'clash':
        return <ClashMode />
      case 'v2rayn':
        return <V2rayNMode />
      case 'publicRoutes':
        return <Dashboard />
      case 'settings':
        return <Settings />
      case 'logs':
        return <LogViewer />
      default:
        return null
    }
  }

  const titleBarBtn: DragStyle = {
    width: 42,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: t.controlBtnColor,
    cursor: 'pointer',
    transition: 'all 0.15s',
    borderRadius: 0,
    padding: 0,
    WebkitAppRegion: 'no-drag',
  }

  const titleBarStyle: DragStyle = {
    height: 36,
    background: t.titleBar,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    WebkitAppRegion: 'drag',
    borderBottom: `1px solid ${t.border}`,
    flexShrink: 0,
    userSelect: 'none',
  }

  const windowControlsStyle: DragStyle = {
    display: 'flex',
    height: '100%',
    WebkitAppRegion: 'no-drag',
  }

  const nextThemeTitle = t.mode === 'light'
    ? '切换暗色模式'
    : t.mode === 'dark'
      ? '切换粉色模式'
      : t.mode === 'pink'
        ? '切换冰川蓝模式'
        : '切换亮色模式'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg }}>
      <div style={titleBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12 }}>
          <img src={logo} alt="KiNGO" style={{ width: 18, height: 18, flexShrink: 0, opacity: t.logoOpacity }} />
          <Typography.Text style={{ fontSize: 13, color: t.textSecondary, fontWeight: 500, letterSpacing: 0.5 }}>
            KiNGO
          </Typography.Text>
        </div>

        <div style={windowControlsStyle}>
          <button
            style={titleBarBtn}
            onClick={() => minimizeWindow()}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.controlBtnHoverBg }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>
          <button
            style={titleBarBtn}
            onClick={() => maximizeWindow()}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.controlBtnHoverBg }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {maximized ? <BlockOutlined style={{ fontSize: 11 }} /> : <BorderOutlined style={{ fontSize: 11 }} />}
          </button>
          <button
            style={titleBarBtn}
            onClick={() => closeWindow()}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.closeHoverBg
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = t.controlBtnColor
            }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>

      <Layout style={{ flex: 1, background: t.bg, overflow: 'hidden' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={208}
          trigger={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: t.textSecondary, fontSize: 12 }}>
              {collapsed ? <RightOutlined /> : <LeftOutlined />}
            </div>
          }
          style={{ background: t.sidebar, borderRight: `1px solid ${t.border}` }}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Menu
              mode="inline"
              selectedKeys={[currentPage]}
              items={menuItems}
              onClick={({ key }) => setCurrentPage(key as PageKey)}
              style={{ background: 'transparent', borderRight: 0, color: t.textSecondary, paddingTop: 4, flex: 1 }}
              theme={t.mode === 'dark' ? 'dark' : 'light'}
            />

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: collapsed ? '8px 0' : '6px 0',
              borderTop: collapsed ? undefined : `1px solid ${t.border}`,
              userSelect: 'none',
            }}>
              <Tooltip title={nextThemeTitle} placement="right">
                <Button
                  type="text"
                  size="small"
                  icon={t.mode === 'light' ? <MoonOutlined /> : t.mode === 'dark' ? <HeartOutlined /> : t.mode === 'pink' ? <StarOutlined /> : <SunOutlined />}
                  onClick={() => setThemeMode(t.mode === 'light' ? 'dark' : t.mode === 'dark' ? 'pink' : t.mode === 'pink' ? 'blue' : 'light')}
                  style={{
                    color: t.mode === 'pink' ? '#ff4088' : t.mode === 'blue' ? '#3b82f6' : t.textSecondary,
                    fontSize: collapsed ? 16 : 14,
                    width: collapsed ? 32 : undefined,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Tooltip>
            </div>

            <div style={{ padding: collapsed ? '4px 0' : '6px 16px', textAlign: 'center', userSelect: 'none', borderTop: `1px solid ${t.border}` }}>
              <Typography.Text style={{ fontSize: collapsed ? 10 : 11, color: t.textSecondary, opacity: collapsed ? 0.4 : 0.5 }}>
                {collapsed ? (version || '1.0.0') : `v${version || '1.0.0'}`}
              </Typography.Text>
            </div>
          </div>
        </Sider>

        <Content style={{ background: t.bg, overflow: 'auto', padding: currentPage === 'dashboard' || currentPage === 'publicRoutes' ? 0 : 24 }}>
          <Suspense fallback={<div style={{ padding: 24 }}><Typography.Text type="secondary">加载中...</Typography.Text></div>}>
            {renderPage()}
          </Suspense>
        </Content>
      </Layout>
    </div>
  )
}
