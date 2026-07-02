import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Table, Button, Space, Tag, Select, Input, Typography, message } from 'antd'
import { ClearOutlined, DownloadOutlined } from '@ant-design/icons'
import { getLogs, clearLogs, onLog } from '../../services/ipc-client'

const PROXY_OPTIONS = [
  { value: 'all', label: '全部代理' },
  { value: 'clash-meta', label: 'mihomo / Clash' },
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria v1' },
  { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' },
  { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' },
  { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' }
]

export default function LogViewer(): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filterProxy, setFilterProxy] = useState<string>('all')
  const [searchText, setSearchText] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const tableRef = useRef<HTMLDivElement>(null)

  const loadLogs = useCallback(async () => {
    const proxyId = filterProxy === 'all' ? undefined : filterProxy
    const data = await getLogs(proxyId, 200)
    setLogs(data)
  }, [filterProxy])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    const unsub = onLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry]
        if (next.length > 200) next.shift()
        return next
      })
    })

    return () => {
      unsub()
    }
  }, [])

  const handleClear = async (): Promise<void> => {
    await clearLogs()
    setLogs([])
    message.success('日志已清空')
  }

  const handleExport = (): void => {
    const text = logs
      .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.proxyId}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kingo-logs-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
    message.success('日志已导出')
  }

  const filteredLogs = logs.filter((l) => {
    if (filterProxy !== 'all' && l.proxyId !== filterProxy) return false
    if (searchText && !l.message.toLowerCase().includes(searchText.toLowerCase())) return false
    return true
  }).reverse()

  const columns = [
    {
      title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180,
      render: (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
    },
    { title: '代理', dataIndex: 'proxyId', key: 'proxyId', width: 120 },
    {
      title: '等级', dataIndex: 'level', key: 'level', width: 80,
      render: (level: string) => (
        <Tag color={level === 'error' ? 'red' : level === 'warn' ? 'orange' : 'default'}>
          {level.toUpperCase()}
        </Tag>
      )
    },
    { title: '消息', dataIndex: 'message', key: 'message', ellipsis: true }
  ]

  return (
    <Card
      title="连接日志"
      extra={
        <Space wrap>
          <Select
            value={filterProxy}
            onChange={setFilterProxy}
            options={PROXY_OPTIONS}
            style={{ width: 140 }}
            size="small"
          />
          <Input.Search
            placeholder="搜索日志"
            style={{ width: 180 }}
            size="small"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Button size="small" onClick={() => setAutoScroll(!autoScroll)} type={autoScroll ? 'primary' : 'default'}>
            {autoScroll ? '自动滚动: 开' : '自动滚动: 关'}
          </Button>
          <Button size="small" icon={<ClearOutlined />} onClick={handleClear}>
            清空
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
            导出
          </Button>
        </Space>
      }
    >
      <div ref={tableRef}>
        <Table
          columns={columns}
          dataSource={filteredLogs.map((l, i) => ({ ...l, key: i }))}
          pagination={{ pageSize: 30, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          size="small"
          locale={{ emptyText: '暂无日志 — 启动代理后将显示实时输出' }}
          scroll={{ y: 400 }}
        />
      </div>
    </Card>
  )
}
