import React, { useState, useEffect } from 'react'
import { Layout, Menu, Typography, Button } from 'antd'
import {
  DashboardOutlined,
  SettingOutlined,
  NodeIndexOutlined,
  ApartmentOutlined,
  FileTextOutlined,
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  BlockOutlined,
  LeftOutlined,
  RightOutlined
} from '@ant-design/icons'
import Dashboard from '../Dashboard/Dashboard'
import ProxyDetail from '../ProxyDetail/ProxyDetail'
import NodeManager from '../NodeManager/NodeManager'
import Settings from '../Settings/Settings'
import LogViewer from '../LogViewer/LogViewer'
import logo from '../../assets/KiNGO.png'
import { minimizeWindow, maximizeWindow, closeWindow, isMaximized as getIsMaximized, getAppVersion } from '../../services/ipc-client'
import { useTheme } from '../../hooks/useTheme'

const { Sider, Content } = Layout

type PageKey = 'dashboard' | 'config' | 'nodes' | 'settings' | 'logs'

interface MenuItem {
  key: PageKey
  icon: React.ReactNode
  label: string
}

const menuItems: MenuItem[] = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: 'config', icon: <ApartmentOutlined />, label: '节点配置' },
  { key: 'nodes', icon: <NodeIndexOutlined />, label: '节点管理' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  { key: 'logs', icon: <FileTextOutlined />, label: '连接日志' }
]

const pageComponents: Record<PageKey, React.ReactNode> = {
  dashboard: <Dashboard />,
  config: <ProxyDetail />,
  nodes: <NodeManager />,
  settings: <Settings />,
  logs: <LogViewer />
}

export default function AppLayout(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<PageKey>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [version, setVersion] = useState('')
  const t = useTheme()

  useEffect(() => {
    getIsMaximized().then(setMaximized)
    getAppVersion().then(setVersion).catch(() => setVersion('1.0.0'))
    const api = window.electronAPI
    if (api.onMaximizeChanged) {
      api.onMaximizeChanged((val: boolean) => setMaximized(val))
    }
  }, [])

  const titleBarBtn: React.CSSProperties = {
    width: 42, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', color: t.controlBtnColor,
    cursor: 'pointer', transition: 'all 0.15s', borderRadius: 0, padding: 0,
    WebkitAppRegion: 'no-drag'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: t.bg }}>
      {/* ====== Custom Title Bar ====== */}
      <div style={{
        height: 36, background: t.titleBar,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        WebkitAppRegion: 'drag',
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
        userSelect: 'none'
      }}>
        {/* Left: logo + app name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12 }}>
          <img src={logo} alt="KiNGO" style={{ width: 18, height: 18, flexShrink: 0, opacity: t.logoOpacity }} />
          <Typography.Text style={{ fontSize: 13, color: t.textSecondary, fontWeight: 500, letterSpacing: 0.5 }}>
            KiNGO
          </Typography.Text>
        </div>

        {/* Right: window controls */}
        <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' }}>
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
            {maximized
              ? <BlockOutlined style={{ fontSize: 11 }} />
              : <BorderOutlined style={{ fontSize: 11 }} />
            }
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

      {/* ====== Body: Sidebar + Content ====== */}
      <Layout style={{ flex: 1, background: t.bg, overflow: 'hidden' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={200}
          trigger={null}
          style={{
            background: t.sidebar,
            borderRight: `1px solid ${t.border}`
          }}
        >
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <Menu
              mode="inline"
              selectedKeys={[currentPage]}
              items={menuItems}
              onClick={({ key }) => setCurrentPage(key as PageKey)}
              style={{
                background: 'transparent',
                borderRight: 0,
                color: t.textSecondary,
                paddingTop: 4,
                flex: 1
              }}
              theme={t.mode === 'dark' ? 'dark' : 'light'}
            />
            {/* Version at sidebar bottom */}
            {!collapsed && (
              <div style={{
                padding: '6px 16px',
                textAlign: 'center',
                userSelect: 'none',
                borderTop: `1px solid ${t.border}`
              }}>
                <Typography.Text style={{ fontSize: 11, color: t.textSecondary, opacity: 0.5 }}>
                  v{version || '1.0.0'}
                </Typography.Text>
              </div>
            )}
            {/* Custom collapse trigger */}
            <div
              onClick={() => setCollapsed(!collapsed)}
              style={{
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderTop: `1px solid ${t.border}`,
                cursor: 'pointer',
                color: t.textSecondary,
                background: t.sidebar,
                transition: 'all 0.2s',
                userSelect: 'none'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = t.text }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t.textSecondary }}
            >
              {collapsed ? <RightOutlined /> : <LeftOutlined />}
            </div>
          </div>
        </Sider>
        <Content
          style={{
            background: t.bg,
            overflow: 'auto',
            padding: currentPage === 'dashboard' ? 0 : 24
          }}
        >
          {pageComponents[currentPage]}
        </Content>
      </Layout>
    </div>
  )
}
