import { useState, useCallback, useEffect } from 'react'
import { Card, Button, List, Tag, Typography, Space, Tooltip, message, Modal, Progress } from 'antd'
import { FolderOpenOutlined, ReloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined, QuestionCircleOutlined, RollbackOutlined } from '@ant-design/icons'
import { checkCoreVersions, getCoreUpdateInfo, onCoreUpdateProgress, openCoreDir, restoreBundledCore, updateCore } from '../../services/ipc-client'

function sourceTag(source: CoreVersionInfo['source']): React.ReactNode {
  if (source === 'user') return <Tag color="blue">用户更新版</Tag>
  if (source === 'bundled') return <Tag color="default">内置版</Tag>
  return <Tag color="red">缺失</Tag>
}

function fileSizeText(size?: number): string {
  if (!size || size <= 0) return '-'
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function CoreVersion(): JSX.Element {
  const [versions, setVersions] = useState<CoreVersionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [progress, setProgress] = useState<CoreUpdateProgress | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    return onCoreUpdateProgress((next) => {
      setProgress(next)
      if (next.stage === 'completed' || next.stage === 'failed') {
        window.setTimeout(() => setProgress((current) => current?.proxyId === next.proxyId ? null : current), 2500)
      }
    })
  }, [])

  const refresh = useCallback(async () => {
    const result = await checkCoreVersions()
    setVersions(result)
    setChecked(true)
  }, [])

  const handleCheck = useCallback(async () => {
    setLoading(true)
    try {
      await refresh()
    } catch {
      message.error('检查核心版本失败')
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const handleUpdate = useCallback(async (item: CoreVersionInfo) => {
    setUpdating(item.proxyId)
    setProgress({ proxyId: item.proxyId, stage: 'checking', percent: 0, message: '准备更新核心' })
    try {
      const info = await getCoreUpdateInfo(item.proxyId)
      if (!info.success) {
        message.error(info.error || '没有找到可下载的核心资产')
        setUpdating(null)
        setProgress(null)
        return
      }

      Modal.confirm({
        title: `下载更新 ${item.name}`,
        content: (
          <div>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              KiNGO 会把新核心保存到用户数据目录，不会覆盖安装包内置核心。
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              版本：{info.version || '-'}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              文件：{info.assetName || '-'}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              大小：{fileSizeText(info.assetSize)}
            </Typography.Text>
            <Typography.Text type={info.checksumAvailable ? 'success' : 'warning'} style={{ display: 'block' }}>
              校验：{info.checksumAvailable ? `将使用 ${info.checksumAssetName || 'SHA256 校验文件'} 校验` : '未找到 SHA256 校验文件'}
            </Typography.Text>
          </div>
        ),
        okText: '下载更新',
        cancelText: '取消',
        onOk: async () => {
          const result = await updateCore(item.proxyId)
          if (!result.success) {
            message.error(result.error || '核心更新失败')
            throw new Error(result.error || '核心更新失败')
          }
          message.success(result.checksumVerified
            ? '核心已更新并通过 SHA256 校验'
            : `核心已更新到用户目录${result.checksumError ? `（${result.checksumError}）` : ''}`)
          await refresh()
        },
        afterClose: () => setUpdating(null),
      })
    } catch (err) {
      setUpdating(null)
      setProgress(null)
      message.error(err instanceof Error ? err.message : '核心更新失败')
    }
  }, [refresh])

  const handleRestoreBundled = useCallback((item: CoreVersionInfo) => {
    Modal.confirm({
      title: `恢复内置核心：${item.name}`,
      content: '这会删除该核心的用户更新版，下次启动将使用安装包内置核心。',
      okText: '恢复内置',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await restoreBundledCore(item.proxyId)
        if (!result.success) {
          message.error(result.error || '恢复内置核心失败')
          throw new Error(result.error || '恢复内置核心失败')
        }
        message.success('已恢复为内置核心')
        await refresh()
      },
    })
  }, [refresh])

  const handleOpenDir = useCallback(async (proxyId: string) => {
    const result = await openCoreDir(proxyId)
    if (!result.success) message.error(result.error || '打开核心目录失败')
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
          <Button size="small" icon={<ReloadOutlined />} onClick={handleCheck} loading={loading}>
            检查更新
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        KiNGO 优先使用用户数据目录中的更新版核心；如果不存在，则使用安装包内置核心。软件升级不会覆盖用户更新版核心。
      </Typography.Paragraph>

      {!checked ? (
        <Typography.Text type="secondary">点击“检查更新”查询各内核版本。</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={versions}
          renderItem={(item) => (
            <List.Item
              style={{
                background: item.isOutdated ? 'var(--ant-color-warning-bg, #fffbe6)' : undefined,
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 4,
              }}
            >
              <div style={{ width: '100%' }}>
                <Space style={{ width: '100%' }} align="center" wrap>
                  <Typography.Text style={{ width: 150 }}>{item.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ width: 96, textAlign: 'center' }}>
                    {item.currentVersion ? `v${item.currentVersion}` : '-'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ width: 96, textAlign: 'center' }}>
                    {item.latestVersion ? `v${item.latestVersion}` : '-'}
                  </Typography.Text>
                  <Tooltip title={item.executablePath}>
                    <span>{sourceTag(item.source)}</span>
                  </Tooltip>
                  {statusTag(item)}
                  <Button
                    size="small"
                    type={item.isOutdated ? 'primary' : 'default'}
                    disabled={!item.isOutdated || (updating !== null && updating !== item.proxyId)}
                    loading={updating === item.proxyId}
                    onClick={() => handleUpdate(item)}
                  >
                    下载更新
                  </Button>
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={() => handleOpenDir(item.proxyId)}>
                    打开目录
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<RollbackOutlined />}
                    disabled={item.source !== 'user'}
                    onClick={() => handleRestoreBundled(item)}
                  >
                    恢复内置
                  </Button>
                </Space>
                {progress?.proxyId === item.proxyId && (
                  <div style={{ marginTop: 8 }}>
                    <Progress
                      percent={Math.max(0, Math.min(100, Math.round(progress.percent)))}
                      size="small"
                      status={progress.stage === 'failed' ? 'exception' : progress.stage === 'completed' ? 'success' : 'active'}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {progress.message}
                      {progress.total ? ` · ${fileSizeText(progress.transferred)} / ${fileSizeText(progress.total)}` : ''}
                    </Typography.Text>
                  </div>
                )}
              </div>
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}
