// NodeContextMenu — right-click context menu aligned with v2rayN ProfilesView ContextMenu
import { Dropdown, Menu, MenuProps } from 'antd'
import {
  EditOutlined, CopyOutlined, DeleteOutlined, ThunderboltOutlined,
  GlobalOutlined, WifiOutlined, DashboardOutlined, RocketOutlined,
  SortAscendingOutlined, SwapOutlined, VerticalAlignTopOutlined,
  ArrowUpOutlined, ArrowDownOutlined, VerticalAlignBottomOutlined,
  SelectOutlined, ShareAltOutlined, ExportOutlined, SnippetsOutlined,
  CopyFilled, FileTextOutlined, ClusterOutlined, AimOutlined,
  ClearOutlined, PlayCircleOutlined, GroupOutlined, ApiOutlined,
} from '@ant-design/icons'
import type { MenuAction } from './types'

interface Props {
  children: React.ReactNode
  selectedCount: number
  hasActive: boolean
  onAction: (action: MenuAction, payload?: unknown) => void
  groupNames?: { id: string; name: string }[]
}

const MENU_ITEMS: { key: MenuAction; label: string; icon: React.ReactNode; shortcut?: string; danger?: boolean; dividerAfter?: boolean }[] = [
  { key: 'set-default', label: '设为默认服务器', icon: <PlayCircleOutlined />, shortcut: 'Enter' },
  { key: 'connect-with-core', label: '选择核心连接...', icon: <ApiOutlined /> },
  { key: 'edit-server', label: '编辑服务器', icon: <EditOutlined />, shortcut: 'Ctrl+D' },
  { key: 'copy-server', label: '复制服务器', icon: <CopyOutlined /> },
  { key: 'delete-server', label: '删除服务器', icon: <DeleteOutlined />, shortcut: 'Delete', danger: true },
  { key: 'dedup-servers', label: '删除重复服务器', icon: <ClearOutlined /> },
  { key: 'clear-invalid-results', label: '清除无效测速结果', icon: <StopOutlined />, dividerAfter: true },
  { key: 'tcping', label: 'TCPing 测试', icon: <ThunderboltOutlined />, shortcut: 'Ctrl+O' },
  { key: 'realping', label: '真实延迟测试', icon: <GlobalOutlined />, shortcut: 'Ctrl+R' },
  { key: 'udp-test', label: 'UDP 测试', icon: <WifiOutlined /> },
  { key: 'speed-test', label: '速度测试', icon: <DashboardOutlined />, shortcut: 'Ctrl+T' },
  { key: 'mixed-test', label: '混合测试', icon: <RocketOutlined />, shortcut: 'Ctrl+E' },
  { key: 'sort-by-result', label: '按测速结果排序', icon: <SortAscendingOutlined />, dividerAfter: true },
  { key: 'move-top', label: '移至顶部', icon: <VerticalAlignTopOutlined />, shortcut: 'T' },
  { key: 'move-up', label: '上移', icon: <ArrowUpOutlined />, shortcut: 'U' },
  { key: 'move-down', label: '下移', icon: <ArrowDownOutlined />, shortcut: 'D' },
  { key: 'move-bottom', label: '移至底部', icon: <VerticalAlignBottomOutlined />, shortcut: 'B' },
  { key: 'select-all', label: '全选', icon: <SelectOutlined />, shortcut: 'Ctrl+A', dividerAfter: true },
  { key: 'share-server', label: '分享服务器', icon: <ShareAltOutlined />, shortcut: 'Ctrl+F' },
  { key: 'export-config-file', label: '导出客户端配置到文件', icon: <ExportOutlined /> },
  { key: 'export-config-clipboard', label: '导出客户端配置到剪贴板', icon: <SnippetsOutlined /> },
  { key: 'copy-share-url', label: '复制分享链接', icon: <CopyFilled />, shortcut: 'Ctrl+C' },
  { key: 'copy-share-base64', label: 'Base64 分享链接', icon: <FileTextOutlined />, dividerAfter: true },
  { key: 'gen-group-all', label: '生成全部策略组', icon: <ClusterOutlined /> },
  { key: 'gen-group-region', label: '按地区生成策略组', icon: <AimOutlined /> },
]

import { StopOutlined } from '@ant-design/icons'

export default function NodeContextMenu({ children, selectedCount, hasActive, onAction, groupNames }: Props): JSX.Element {
  const handleClick: MenuProps['onClick'] = ({ key }) => {
    onAction(key as MenuAction)
  }

  const menuItems = MENU_ITEMS.map((item) => {
    const disabled =
      (['set-default', 'connect-with-core', 'edit-server', 'copy-server', 'share-server', 'copy-share-url', 'copy-share-base64'].includes(item.key) && selectedCount !== 1) ||
      (['move-top', 'move-up', 'move-down', 'move-bottom', 'move-to-group'].includes(item.key) && selectedCount === 0)
    return { ...item, disabled, danger: item.danger }
  })

  // Insert "move-to-group" submenu before the move items
  const moveIdx = menuItems.findIndex((m) => m.key === 'move-top')
  if (moveIdx >= 0 && groupNames && groupNames.length > 0) {
    menuItems.splice(moveIdx, 0, {
      key: 'move-to-group' as MenuAction,
      label: '移至分组',
      icon: <GroupOutlined />,
      disabled: selectedCount === 0,
      children: groupNames.map((g) => ({ key: `move-to-group:${g.id}`, label: g.name })),
    } as never)
  }

  return (
    <Dropdown menu={{ items: menuItems as MenuProps['items'], onClick: handleClick }} trigger={['contextMenu']}>
      {children}
    </Dropdown>
  )
}
