import { useEffect, useState } from 'react'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import { DisconnectOutlined } from '@ant-design/icons'
import MyNodes from '../MyNodes/MyNodes'
import { disconnectAllConnections, getAppConnectionState, onAppConnectionStateChanged } from '../../services/ipc-client'

export default function V2rayNMode(): JSX.Element {
  const [appState, setAppState] = useState<AppConnectionState | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    void getAppConnectionState().then(setAppState).catch(() => undefined)
    return onAppConnectionStateChanged(setAppState)
  }, [])

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true)
    try {
      const result = await disconnectAllConnections()
      if (result.success) message.success('连接已断开')
      else message.error(result.error || '断开连接失败')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>V2rayN 模式</Typography.Title>
        <Typography.Text type="secondary">
          管理节点、分组、订阅和连接。
        </Typography.Text>
      </div>

      <ConnectionStatusCard
        state={appState}
        onDisconnect={() => void handleDisconnect()}
        loading={disconnecting}
      />

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: 16 }}><MyNodes /></div>
      </Card>
    </Space>
  )
}

function ConnectionStatusCard(props: {
  state: AppConnectionState | null
  onDisconnect: () => void
  loading: boolean
}): JSX.Element {
  const { state } = props
  const connectedHere = state?.connected && state.mode === 'v2rayn'
  const connectedElsewhere = state?.connected && state.mode !== 'v2rayn'

  return (
    <Card size="small">
      <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Tag color={connectedHere ? 'green' : connectedElsewhere ? 'blue' : 'default'}>
            {connectedHere ? '当前模式已连接' : connectedElsewhere ? '其他模式已连接' : '未连接'}
          </Tag>
          <Typography.Text strong>{state?.displayName || '暂无连接'}</Typography.Text>
          {state?.detail && <Tag bordered={false}>{state.detail}</Tag>}
          {state?.latency !== null && state?.latency !== undefined && state.latency >= 0 && <Tag color="green">{state.latency}ms</Tag>}
        </Space>
        {state?.connected && (
          <Button size="small" danger icon={<DisconnectOutlined />} loading={props.loading} onClick={props.onDisconnect}>
            断开当前连接
          </Button>
        )}
      </Space>
    </Card>
  )
}
