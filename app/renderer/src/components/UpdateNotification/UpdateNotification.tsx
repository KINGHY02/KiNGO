import { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Progress, Typography, Space, Tag } from 'antd'
import { CloudDownloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { downloadUpdate, installUpdate } from '../../services/ipc-client'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'

interface UpdateInfo {
  version: string
  releaseDate?: string
}

export default function UpdateNotification(): JSX.Element {
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [visible, setVisible] = useState(false)

  const resetState = useCallback(() => {
    setPhase('idle')
    setUpdateInfo(null)
    setProgress(0)
    setErrorMsg('')
  }, [])

  useEffect(() => {
    const api = window.electronAPI

    if (api.onUpdateStatus) {
      api.onUpdateStatus((data: { status: string }) => {
        if (data.status === 'checking') {
          setPhase('checking')
        } else if (data.status === 'not-available') {
          setPhase('not-available')
          setTimeout(resetState, 3000)
        }
      })
    }

    if (api.onUpdateAvailable) {
      api.onUpdateAvailable((data: { version: string; releaseDate?: string }) => {
        setUpdateInfo(data)
        setPhase('available')
        setVisible(true)
      })
    }

    if (api.onUpdateProgress) {
      api.onUpdateProgress((data: { percent: number }) => {
        setPhase('downloading')
        setProgress(Math.round(data.percent))
      })
    }

    if (api.onUpdateDownloaded) {
      api.onUpdateDownloaded(() => {
        setPhase('downloaded')
        setProgress(100)
      })
    }

    if (api.onUpdateError) {
      api.onUpdateError((data: { message: string }) => {
        setPhase('error')
        setErrorMsg(data.message || '更新过程出错')
      })
    }

    return () => {
      if (api.removeAllListeners) {
        api.removeAllListeners('updater:status')
        api.removeAllListeners('updater:available')
        api.removeAllListeners('updater:progress')
        api.removeAllListeners('updater:downloaded')
        api.removeAllListeners('updater:error')
      }
    }
  }, [resetState])

  const handleStartDownload = async (): Promise<void> => {
    try {
      setPhase('downloading')
      await downloadUpdate()
    } catch {
      setPhase('error')
      setErrorMsg('开始下载失败')
    }
  }

  const handleInstall = (): void => {
    installUpdate()
  }

  const handleClose = (): void => {
    setVisible(false)
    if (phase === 'available') {
      resetState()
    }
  }

  const renderContent = (): React.ReactNode => {
    switch (phase) {
      case 'checking':
        return (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <CloudDownloadOutlined style={{ fontSize: 36, color: '#4b6cf7' }} spin />
            <p style={{ marginTop: 12, color: '#888' }}>正在检查更新...</p>
          </div>
        )
      case 'available':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <Tag color="blue" style={{ fontSize: 14, padding: '4px 16px', borderRadius: 12 }}>
                新版本 v{updateInfo?.version}
              </Tag>
            </div>
            <Typography.Text type="secondary">
              检测到新版本可用，建议立即更新以获取最新功能和安全修复。
            </Typography.Text>
            {updateInfo?.releaseDate && (
              <br />
            )}
            {updateInfo?.releaseDate && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                发布日期: {updateInfo.releaseDate}
              </Typography.Text>
            )}
          </div>
        )
      case 'downloading':
        return (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Progress
              type="circle"
              percent={progress}
              size={100}
              strokeColor="#4b6cf7"
            />
            <p style={{ marginTop: 16, color: '#888' }}>正在下载更新...</p>
          </div>
        )
      case 'downloaded':
        return (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
            <p style={{ marginTop: 12, fontSize: 16, fontWeight: 500 }}>更新已下载完成</p>
            <Typography.Text type="secondary">
              点击下方按钮安装更新并重启应用
            </Typography.Text>
          </div>
        )
      case 'error':
        return (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <ExclamationCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
            <p style={{ marginTop: 12, color: '#ff4d4f' }}>{errorMsg}</p>
          </div>
        )
      case 'not-available':
        return (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
            <p style={{ marginTop: 12, color: '#888' }}>当前已是最新版本</p>
          </div>
        )
      default:
        return null
    }
  }

  const renderFooter = (): React.ReactNode => {
    switch (phase) {
      case 'available':
        return [
          <Button key="later" onClick={handleClose}>
            稍后提醒
          </Button>,
          <Button key="update" type="primary" icon={<CloudDownloadOutlined />} onClick={handleStartDownload}>
            立即更新
          </Button>
        ]
      case 'downloading':
        return [
          <Button key="bg" onClick={handleClose}>
            后台下载
          </Button>
        ]
      case 'downloaded':
        return [
          <Button key="install" type="primary" icon={<CheckCircleOutlined />} onClick={handleInstall}>
            安装并重启
          </Button>
        ]
      case 'error':
        return [
          <Button key="retry" type="primary" icon={<ReloadOutlined />} onClick={handleStartDownload}>
            重试
          </Button>,
          <Button key="close" onClick={handleClose}>
            关闭
          </Button>
        ]
      case 'not-available':
        return [
          <Button key="ok" type="primary" onClick={handleClose}>
            知道了
          </Button>
        ]
      default:
        return null
    }
  }

  return (
    <Modal
      open={visible}
      title={phase === 'checking' ? '检查更新' : phase === 'not-available' ? '已是最新' : '软件更新'}
      onCancel={handleClose}
      footer={renderFooter()}
      closable={phase !== 'downloading'}
      maskClosable={phase !== 'downloading'}
      centered
      width={400}
    >
      {renderContent()}
    </Modal>
  )
}
