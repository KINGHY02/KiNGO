import { useState, useCallback } from 'react'
import { Card, Button, List, Tag, Typography, Space } from 'antd'
import { ReloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { checkCoreVersions } from '../../services/ipc-client'

export default function CoreVersion(): JSX.Element {
  const [versions, setVersions] = useState<CoreVersionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState(false)

  const handleCheck = useCallback(async () => {
    setLoading(true)
    try {
      const result = await checkCoreVersions()
      setVersions(result)
      setChecked(true)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const statusTag = (info: CoreVersionInfo): React.ReactNode => {
    if (!info.currentVersion) {
      return <Tag color="default" icon={<QuestionCircleOutlined />}>无法检测</Tag>
    }
    if (!info.latestVersion) {
      return <Tag color="warning" icon={<ExclamationCircleOutlined />}>网络错误</Tag>
    }
    if (info.isOutdated) {
      return <Tag color="orange" icon={<ExclamationCircleOutlined />}>可更新</Tag>
    }
    return <Tag color="green" icon={<CheckCircleOutlined />}>最新</Tag>
  }

  const outdatedCount = versions.filter((v) => v.isOutdated).length

  return (
    <Card
      title="内核版本"
      extra={
        <Space>
          {checked && !loading && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {outdatedCount > 0 ? `${outdatedCount} 个可更新` : '全部最新'}
            </Typography.Text>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleCheck}
            loading={loading}
          >
            检查更新
          </Button>
        </Space>
      }
    >
      {!checked ? (
        <Typography.Text type="secondary">点击"检查更新"查询各内核版本</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={versions}
          renderItem={(item) => (
            <List.Item
              style={{
                background: item.isOutdated ? 'var(--ant-color-warning-bg, #fffbe6)' : undefined,
                borderRadius: 6,
                padding: '6px 12px',
                marginBottom: 4,
              }}
            >
              <Typography.Text style={{ width: 140 }}>{item.name}</Typography.Text>
              <Typography.Text type="secondary" style={{ width: 100, textAlign: 'center' }}>
                {item.currentVersion ? `v${item.currentVersion}` : '-'}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ width: 100, textAlign: 'center' }}>
                {item.latestVersion ? `v${item.latestVersion}` : '-'}
              </Typography.Text>
              {statusTag(item)}
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}
