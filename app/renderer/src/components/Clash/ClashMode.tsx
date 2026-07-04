import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import { ApiOutlined, CloudSyncOutlined, DeleteOutlined, DisconnectOutlined, FieldTimeOutlined, FileAddOutlined, LinkOutlined, PlayCircleOutlined } from '@ant-design/icons'
import {
  deleteClashProfile,
  disconnectAllConnections,
  diagnoseClashTun,
  getAppConnectionState,
  getClashConfig,
  getClashConnections,
  getClashGroups,
  getClashRuntimeOptions,
  getProxyStatus,
  listClashProfiles,
  onAppConnectionStateChanged,
  saveClashProfile,
  saveClashProfileFromUrl,
  selectClashGroupProxy,
  setClashMode,
  startClashProfile,
  testClashProxyDelay,
  updateClashProfile,
  updateClashProfileOptions,
  updateClashRuntimeOptions,
} from '../../services/ipc-client'

type ClashModeValue = 'rule' | 'global' | 'direct'
type ProxySortMode = 'default' | 'delay' | 'name'

function delayTagColor(delay: number): string {
  if (delay < 0) return 'red'
  if (delay < 300) return 'green'
  if (delay < 800) return 'orange'
  return 'red'
}

const RULE_TEMPLATES = [
  {
    key: 'loyalsoldier-allow',
    name: 'Loyalsoldier 白名单',
    source: 'Loyalsoldier/clash-rules',
    url: 'https://github.com/Loyalsoldier/clash-rules',
    description: '未命中规则的流量走代理，适合线路稳定的场景。',
    snippet: `rule-providers:
  reject:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    path: ./ruleset/reject.yaml
    interval: 86400
  private:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt"
    path: ./ruleset/private.yaml
    interval: 86400
  proxy:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt"
    path: ./ruleset/proxy.yaml
    interval: 86400
  direct:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./ruleset/direct.yaml
    interval: 86400
  cncidr:
    type: http
    behavior: ipcidr
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt"
    path: ./ruleset/cncidr.yaml
    interval: 86400

rules:
  - RULE-SET,private,DIRECT
  - RULE-SET,reject,REJECT
  - RULE-SET,proxy,PROXY
  - RULE-SET,direct,DIRECT
  - RULE-SET,cncidr,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,PROXY`,
  },
  {
    key: 'loyalsoldier-block',
    name: 'Loyalsoldier 黑名单',
    source: 'Loyalsoldier/clash-rules',
    url: 'https://github.com/Loyalsoldier/clash-rules',
    description: '只有命中规则的流量走代理，适合更保守的日常使用。',
    snippet: `rule-providers:
  reject:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    path: ./ruleset/reject.yaml
    interval: 86400
  private:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt"
    path: ./ruleset/private.yaml
    interval: 86400
  gfw:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt"
    path: ./ruleset/gfw.yaml
    interval: 86400
  tld-not-cn:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt"
    path: ./ruleset/tld-not-cn.yaml
    interval: 86400

rules:
  - RULE-SET,private,DIRECT
  - RULE-SET,reject,REJECT
  - RULE-SET,tld-not-cn,PROXY
  - RULE-SET,gfw,PROXY
  - GEOIP,CN,DIRECT
  - MATCH,DIRECT`,
  },
  {
    key: 'metacubex',
    name: 'MetaCubeX / mihomo',
    source: 'MetaCubeX/meta-rules-dat',
    url: 'https://github.com/MetaCubeX/meta-rules-dat',
    description: 'mihomo 生态规则数据入口，适合 geosite / geoip / mrs 规则数据。',
    snippet: `# MetaCubeX/meta-rules-dat 是 mihomo 规则数据源。
# 可用于 geosite / geoip / mrs 规则数据配置参考。`,
  },
  {
    key: 'acl4ssr',
    name: 'ACL4SSR',
    source: 'ACL4SSR/ACL4SSR',
    url: 'https://github.com/ACL4SSR/ACL4SSR',
    description: '老牌 Clash 规则模板，可作为手动配置参考。',
    snippet: `# ACL4SSR 提供 Clash 规则碎片和模板。
# 建议打开仓库选择与你订阅转换方式匹配的模板。`,
  },
]

export default function ClashMode(): JSX.Element {
  const [profiles, setProfiles] = useState<ClashProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('default')
  const [groups, setGroups] = useState<ClashGroup[]>([])
  const [connections, setConnections] = useState<ClashConnection[]>([])
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [delays, setDelays] = useState<Record<string, number>>({})
  const [testingDelayName, setTestingDelayName] = useState<string | null>(null)
  const [testingGroupName, setTestingGroupName] = useState<string | null>(null)
  const [proxyFilter, setProxyFilter] = useState('')
  const [proxySort, setProxySort] = useState<ProxySortMode>('default')
  const [drawerGroupName, setDrawerGroupName] = useState<string | null>(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [profileInputMode, setProfileInputMode] = useState<'url' | 'yaml'>('url')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaveStatus, setProfileSaveStatus] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null)
  const [updatingProfileId, setUpdatingProfileId] = useState<string | null>(null)
  const [tunEnabled, setTunEnabled] = useState(false)
  const [clashMode, setCurrentClashMode] = useState<ClashModeValue>('rule')
  const [appState, setAppState] = useState<AppConnectionState | null>(null)
  const [form] = Form.useForm<{ name: string; content?: string; url?: string; autoUpdate?: boolean; updateInterval?: number }>()

  const load = useCallback(async (): Promise<void> => {
    const [status, nextProfiles, runtimeOptions, nextAppState] = await Promise.all([
      getProxyStatus(),
      listClashProfiles(),
      getClashRuntimeOptions(),
      getAppConnectionState(),
    ])
    const clashRunning = status.some((item) => item.id === 'clash-meta' && item.running)
    setRunning(clashRunning)
    setProfiles(nextProfiles)
    setTunEnabled(runtimeOptions.tunEnabled)
    setAppState(nextAppState)
    setSelectedProfileId((current) => {
      if (nextProfiles.some((profile) => profile.id === current)) return current
      return nextProfiles.find((item) => item.active)?.id || nextProfiles[0]?.id || 'default'
    })
    if (!clashRunning) {
      setGroups([])
      setConnections([])
      return
    }
    try {
      const [nextGroups, nextConnections, nextConfig] = await Promise.all([
        getClashGroups(),
        getClashConnections().catch(() => []),
        getClashConfig().catch(() => ({ mode: 'rule' as ClashModeValue })),
      ])
      setGroups(nextGroups)
      setConnections(nextConnections)
      setCurrentClashMode(nextConfig.mode)
    } catch (error) {
      message.warning(error instanceof Error ? error.message : 'mihomo 控制接口暂时不可用')
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 3000)
    const unsubscribe = window.electronAPI.onClashProfileAutoUpdated((result) => {
      if (result.success) message.success(`Clash 订阅已自动更新：${result.name}`)
      else message.warning(`Clash 订阅自动更新失败：${result.name}`)
      void load()
    })
    const unsubscribeAppState = onAppConnectionStateChanged(setAppState)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
      unsubscribeAppState()
    }
  }, [load])

  const handleStart = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await startClashProfile(selectedProfileId)
      if (result.success) {
        message.success('Clash 模式已启动')
        await load()
      } else message.error(result.error || 'Clash 模式启动失败')
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await disconnectAllConnections()
      if (result.success) {
        message.success('连接已断开')
        await load()
      } else message.error(result.error || '停止失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProfile = async (): Promise<void> => {
    const values = await form.validateFields()
    setSavingProfile(true)
    setProfileSaveStatus({
      type: 'info',
      message: profileInputMode === 'url'
        ? '正在导入订阅：先直连获取，失败后会尝试本地代理端口。'
        : '正在保存 YAML 配置。',
    })
    try {
      const result = profileInputMode === 'url'
        ? await saveClashProfileFromUrl({
          name: values.name,
          url: values.url || '',
          autoUpdate: !!values.autoUpdate,
          updateInterval: values.updateInterval || 12,
        })
        : await saveClashProfile({ name: values.name, content: values.content || '' })
      if (!result.success) {
        const reason = result.error || '保存 Clash 配置失败'
        setProfileSaveStatus({ type: 'error', message: reason })
        message.error(reason)
        return
      }
      setProfileSaveStatus({ type: 'success', message: 'Clash 配置已保存，并已自动选中。' })
      message.success('Clash 配置已保存')
      setProfileModalOpen(false)
      form.resetFields()
      await load()
      if (result.profile?.id) setSelectedProfileId(result.profile.id)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setProfileSaveStatus({ type: 'error', message: reason })
      message.error(reason)
    } finally {
      setSavingProfile(false)
    }
  }

  const handleUpdateProfile = async (profileId: string): Promise<void> => {
    setUpdatingProfileId(profileId)
    try {
      const result = await updateClashProfile(profileId)
      if (!result.success) message.error(result.error || '订阅更新失败')
      else {
        message.success('订阅已更新')
        await load()
      }
    } finally {
      setUpdatingProfileId(null)
    }
  }

  const handleUpdateOptions = async (profile: ClashProfile, options: { autoUpdate?: boolean; updateInterval?: number }): Promise<void> => {
    const result = await updateClashProfileOptions(profile.id, options)
    if (!result.success) message.error(result.error || '保存自动更新设置失败')
    else await load()
  }

  const applyTunEnabled = async (enabled: boolean): Promise<void> => {
    const result = await updateClashRuntimeOptions({ tunEnabled: enabled })
    if (!result.success) {
      message.error(result.error || '保存 TUN 设置失败')
      return
    }
    setTunEnabled(enabled)
    message.success(enabled ? 'TUN 将在下次启动 Clash 时启用' : 'TUN 将在下次启动 Clash 时关闭')
  }

  const handleTunToggle = (enabled: boolean): void => {
    if (!enabled) {
      void applyTunEnabled(false)
      return
    }
    Modal.confirm({
      title: '启用 TUN',
      content: 'TUN 会接管更多系统流量，可能需要管理员权限。若网络异常，可关闭后重启 Clash。',
      okText: '启用',
      cancelText: '取消',
      onOk: () => applyTunEnabled(true),
    })
  }

  const handleDiagnoseTun = async (): Promise<void> => {
    const report = await diagnoseClashTun()
    Modal.info({
      title: 'TUN 诊断',
      width: 680,
      content: (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert type={report.ready ? 'success' : 'error'} showIcon message={report.summary} />
          {report.checks.map((check) => (
            <Card key={check.key} size="small">
              <Space direction="vertical" size={2}>
                <Space>
                  <Tag color={check.status === 'pass' ? 'green' : check.status === 'warn' ? 'gold' : 'red'}>
                    {check.status === 'pass' ? '通过' : check.status === 'warn' ? '注意' : '失败'}
                  </Tag>
                  <Typography.Text strong>{check.label}</Typography.Text>
                </Space>
                <Typography.Text>{check.message}</Typography.Text>
                {check.detail && <Typography.Text type="secondary" copyable>{check.detail}</Typography.Text>}
              </Space>
            </Card>
          ))}
        </Space>
      ),
    })
  }

  const handleDeleteProfile = async (profileId: string): Promise<void> => {
    const result = await deleteClashProfile(profileId)
    if (!result.success) message.error(result.error || '删除失败')
    else {
      message.success('配置已删除')
      await load()
    }
  }

  const handleSelect = async (group: ClashGroup, proxyName: string): Promise<void> => {
    const result = await selectClashGroupProxy(group.name, proxyName)
    if (result.success) {
      message.success(`已切换 ${group.name} → ${proxyName}`)
      await load()
    } else message.error(result.error || '切换失败')
  }

  const handleDelay = async (proxyName: string): Promise<void> => {
    if (testingDelayName || testingGroupName) return
    setTestingDelayName(proxyName)
    try {
      const result = await testClashProxyDelay(proxyName)
      if (result.success) {
        setDelays((prev) => ({ ...prev, [proxyName]: result.delay }))
        message.success(`${proxyName} 延迟 ${result.delay}ms`)
      } else message.warning(result.error || '延迟测试失败')
    } finally {
      setTestingDelayName(null)
    }
  }

  const handleDelayGroup = async (group: ClashGroup): Promise<void> => {
    if (testingGroupName || testingDelayName) return
    setTestingGroupName(group.name)
    let successCount = 0
    try {
      const names = group.all.filter((name) => !['DIRECT', 'REJECT'].includes(name.toUpperCase()))
      for (let index = 0; index < names.length; index += 4) {
        const batch = names.slice(index, index + 4)
        const results = await Promise.all(batch.map(async (name) => {
          const result = await testClashProxyDelay(name)
          return { name, result }
        }))
        setDelays((prev) => {
          const next = { ...prev }
          for (const item of results) {
            next[item.name] = item.result.success ? item.result.delay : -1
          }
          return next
        })
        successCount += results.filter((item) => item.result.success).length
      }
      message.success(`测速完成：${successCount}/${names.length} 个节点可用`)
    } finally {
      setTestingGroupName(null)
    }
  }

  const handleChangeClashMode = async (mode: ClashModeValue): Promise<void> => {
    setCurrentClashMode(mode)
    const result = await setClashMode(mode)
    if (!result.success) {
      message.error(result.error || '切换代理模式失败')
      await load()
      return
    }
    message.success(`已切换到${mode === 'rule' ? '规则' : mode === 'global' ? '全局' : '直连'}模式`)
    await load()
  }

  const handleCopyRuleTemplate = async (template: typeof RULE_TEMPLATES[number]): Promise<void> => {
    await navigator.clipboard.writeText(template.snippet)
    message.success('规则模板已复制')
  }

  const getVisibleProxies = (group: ClashGroup): string[] => {
    const keyword = proxyFilter.trim().toLowerCase()
    const filtered = keyword
      ? group.all.filter((name) => name.toLowerCase().includes(keyword))
      : group.all.slice()
    if (proxySort === 'name') return filtered.sort((a, b) => a.localeCompare(b))
    if (proxySort === 'delay') {
      return filtered.sort((a, b) => {
        const da = delays[a]
        const db = delays[b]
        const normalize = (value: number | undefined): number => {
          if (value === undefined) return Number.MAX_SAFE_INTEGER - 1
          if (value < 0) return Number.MAX_SAFE_INTEGER
          return value
        }
        return normalize(da) - normalize(db)
      })
    }
    return filtered
  }

  const drawerGroup = useMemo(
    () => groups.find((group) => group.name === drawerGroupName) || null,
    [groups, drawerGroupName],
  )

  const visibleGroups = useMemo(() => {
    const priority = (name: string): number => {
      const lower = name.toLowerCase()
      if (name.includes('节点选择') || lower === 'proxy' || lower === 'proxies' || lower === 'select') return 0
      if (name.includes('手动挑选') || lower.includes('manual')) return 1
      return 2
    }
    return groups
      .map((group, index) => ({ group, index }))
      .sort((a, b) => {
        const pa = priority(a.group.name)
        const pb = priority(b.group.name)
        if (pa !== pb) return pa - pb
        return a.index - b.index
      })
      .map((item) => item.group)
  }, [groups])

  const drawerProxyRows = useMemo(() => {
    if (!drawerGroup) return []
    return getVisibleProxies(drawerGroup).map((name, index) => ({
      key: `${drawerGroup.name}:${name}`,
      index: index + 1,
      name,
      delay: delays[name],
      active: drawerGroup.now === name,
    }))
  }, [drawerGroup, proxyFilter, proxySort, delays])

  return (
    <Space className="kingo-clash-page" direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Clash 模式</Typography.Title>
        <Typography.Text type="secondary">选择配置，启动 mihomo，切换代理组。</Typography.Text>
      </div>

      <ConnectionStatusCard
        state={appState}
        currentMode="clash"
        onDisconnect={() => void handleStop()}
        loading={loading}
      />

      <Card>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={10}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Typography.Text type="secondary">当前配置</Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={selectedProfileId}
                options={profiles.map((profile) => ({ label: `${profile.name}${profile.active ? ' · 当前' : ''}`, value: profile.id }))}
                onChange={setSelectedProfileId}
              />
            </Space>
          </Col>
          <Col xs={24} md={14}>
            <Space wrap>
              <Tag color={running ? 'green' : 'default'}>{running ? '运行中' : '未运行'}</Tag>
              <Tag bordered={false}>配置 {profiles.length}</Tag>
              <Tag bordered={false}>代理组 {groups.length}</Tag>
              <Radio.Group
                size="small"
                value={clashMode}
                disabled={!running}
                onChange={(event) => void handleChangeClashMode(event.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: '规则', value: 'rule' },
                  { label: '全局', value: 'global' },
                  { label: '直连', value: 'direct' },
                ]}
              />
              <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} disabled={running} onClick={() => void handleStart()}>启动</Button>
              <Button icon={<CloudSyncOutlined />} onClick={() => void load()}>刷新</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card>
      <Tabs
        defaultActiveKey="proxies"
        items={[
          {
            key: 'proxies',
            label: '代理组',
            children: (
              groups.length === 0 ? <Empty description={running ? '暂无代理组' : '启动后显示代理组'} /> : (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Space wrap>
                    <Input.Search
                      allowClear
                      size="small"
                      placeholder="筛选节点名称"
                      value={proxyFilter}
                      onChange={(event) => setProxyFilter(event.target.value)}
                      style={{ width: 220 }}
                    />
                    <Select
                      size="small"
                      value={proxySort}
                      style={{ width: 130 }}
                      onChange={setProxySort}
                      options={[
                        { label: '默认排序', value: 'default' },
                        { label: '按延迟', value: 'delay' },
                        { label: '按名称', value: 'name' },
                      ]}
                    />
                  </Space>
                  {visibleGroups.map((group) => (
                    <Card key={group.name} size="small">
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]} align="middle">
                          <Col xs={24} md={7}>
                            <Typography.Text strong>{group.name}</Typography.Text><br />
                            <Tag>{group.type}</Tag>{group.now && <Tag color="green">{group.now}</Tag>}
                          </Col>
                          <Col xs={24} md={12}>
                            <Select
                              showSearch
                              style={{ width: '100%' }}
                              value={group.now || undefined}
                              placeholder="Open node drawer"
                              open={false}
                              options={group.now ? [{ label: group.now, value: group.now }] : []}
                              onClick={() => setDrawerGroupName(group.name)}
                            />
                          </Col>
                          <Col xs={24} md={5}>
                            <Space.Compact>
                              <Button
                                size="small"
                                onClick={() => setDrawerGroupName(group.name)}
                              >
                                Select
                              </Button>
                              <Button
                                size="small"
                                icon={<FieldTimeOutlined />}
                                disabled={!!testingDelayName || !!testingGroupName}
                                loading={testingGroupName === group.name}
                                onClick={() => void handleDelayGroup(group)}
                              >
                                测速全部
                              </Button>
                            </Space.Compact>
                          </Col>
                        </Row>
                        <Space wrap size={[8, 8]}>
                          {([] as string[]).map((name) => {
                            const delay = delays[name]
                            const active = group.now === name
                            return (
                              <Button
                                key={`${group.name}:${name}`}
                                size="small"
                                type={active ? 'primary' : 'default'}
                                onClick={() => void handleSelect(group, name)}
                              >
                                <Space size={6}>
                                  <span>{name}</span>
                                  {delay !== undefined && (
                                    <Tag color={delay >= 0 ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>
                                      {delay >= 0 ? `${delay}ms` : '超时'}
                                    </Tag>
                                  )}
                                </Space>
                              </Button>
                            )
                          })}
                        </Space>
                        {group.now && (
                          <Button
                            size="small"
                            icon={<FieldTimeOutlined />}
                            disabled={!group.now || !!testingDelayName || !!testingGroupName}
                            loading={!!group.now && testingDelayName === group.now}
                            onClick={() => group.now && void handleDelay(group.now)}
                          >
                            当前节点测速：{delays[group.now] !== undefined ? (delays[group.now] >= 0 ? `${delays[group.now]}ms` : '超时') : '未测'}
                          </Button>
                        )}
                      </Space>
                    </Card>
                  ))}
                </Space>
              )
            ),
          },
          {
            key: 'profiles',
            label: '订阅配置',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Button icon={<LinkOutlined />} onClick={() => { setProfileInputMode('url'); setProfileSaveStatus(null); setProfileModalOpen(true) }}>导入订阅 URL</Button>
                  <Button icon={<FileAddOutlined />} onClick={() => { setProfileInputMode('yaml'); setProfileSaveStatus(null); setProfileModalOpen(true) }}>导入 YAML</Button>
                </Space>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  tableLayout="fixed"
                  scroll={{ x: 1040 }}
                  dataSource={profiles}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '来源', dataIndex: 'source', key: 'source', width: 90, render: (source: string) => <Tag>{source === 'default' ? '默认' : source === 'url' ? '订阅' : '导入'}</Tag> },
                    { title: '状态', dataIndex: 'active', key: 'active', width: 80, render: (active: boolean) => active ? <Tag color="green">当前</Tag> : '-' },
                    { title: '自动更新', key: 'autoUpdate', width: 110, render: (_: unknown, profile: ClashProfile) => profile.source === 'url' ? <Switch size="small" checked={!!profile.autoUpdate} onChange={(checked) => void handleUpdateOptions(profile, { autoUpdate: checked })} /> : '-' },
                    { title: '间隔', key: 'interval', width: 135, render: (_: unknown, profile: ClashProfile) => profile.source === 'url' ? <InputNumber size="small" min={1} max={168} value={profile.updateInterval || 12} addonAfter="小时" onChange={(value) => value && void handleUpdateOptions(profile, { updateInterval: Number(value) })} /> : '-' },
                    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 175, render: (time: number) => time ? new Date(time).toLocaleString('zh-CN') : '-' },
                    { title: '最近结果', key: 'lastResult', width: 180, render: (_: unknown, profile: ClashProfile) => profile.lastUpdateError ? <Typography.Text type="danger" ellipsis={{ tooltip: profile.lastUpdateError }}>{profile.lastUpdateError}</Typography.Text> : <Typography.Text type="secondary">正常</Typography.Text> },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 180,
                      render: (_: unknown, profile: ClashProfile) => profile.source === 'default' ? null : (
                        <Space>
                          {profile.source === 'url' && <Button size="small" icon={<CloudSyncOutlined />} loading={updatingProfileId === profile.id} onClick={() => void handleUpdateProfile(profile.id)}>更新</Button>}
                          <Popconfirm title="删除这个 Clash 配置？" onConfirm={() => void handleDeleteProfile(profile.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'tun',
            label: 'TUN',
            children: (
              <Space direction="vertical" size={8}>
                <Space>
                  <Switch checked={tunEnabled} onChange={handleTunToggle} />
                  <Typography.Text strong>{tunEnabled ? '已准备启用' : '未启用'}</Typography.Text>
                  <Button size="small" icon={<ApiOutlined />} onClick={() => void handleDiagnoseTun()}>诊断</Button>
                </Space>
                {running && <Alert type="warning" showIcon message="TUN 设置将在下次启动 Clash 时生效。" />}
              </Space>
            ),
          },
          {
            key: 'rules',
            label: '规则模板',
            children: (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Typography.Text type="secondary">选择常用规则源，复制示例后合并到 Clash YAML。</Typography.Text>
                <Space wrap>
                  {RULE_TEMPLATES.map((template) => (
                    <Card key={template.key} size="small" style={{ width: 260 }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space>
                          <Typography.Text strong>{template.name}</Typography.Text>
                          <Tag bordered={false}>{template.source}</Tag>
                        </Space>
                        <Typography.Text type="secondary">{template.description}</Typography.Text>
                        <Space>
                          <Button size="small" onClick={() => void handleCopyRuleTemplate(template)}>复制示例</Button>
                          <Button size="small" type="link" href={template.url} target="_blank">打开仓库</Button>
                        </Space>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </Space>
            ),
          },
          {
            key: 'connections',
            label: '连接列表',
            children: (
              <Table size="small" rowKey="id" pagination={{ pageSize: 6 }} dataSource={connections} columns={[
                { title: '规则', dataIndex: 'rule', key: 'rule', width: 120 },
                { title: '链路', dataIndex: 'chains', key: 'chains', render: (chains?: string[]) => chains?.join(' → ') || '-' },
                { title: '上传', dataIndex: 'upload', key: 'upload', width: 90 },
                { title: '下载', dataIndex: 'download', key: 'download', width: 90 },
              ]} />
            ),
          },
        ]}
      />
      </Card>

      <Drawer
        title={drawerGroup ? `Select node: ${drawerGroup.name}` : 'Select node'}
        open={!!drawerGroup}
        onClose={() => setDrawerGroupName(null)}
        width={560}
        rootClassName="kingo-clash-page"
        closable
        keyboard
        maskClosable
        destroyOnClose
      >
        {!drawerGroup ? <Empty /> : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="Filter nodes"
                value={proxyFilter}
                onChange={(event) => setProxyFilter(event.target.value)}
                style={{ width: 220 }}
              />
              <Select
                value={proxySort}
                style={{ width: 140 }}
                onChange={setProxySort}
                options={[
                  { label: 'Original', value: 'default' },
                  { label: 'Delay', value: 'delay' },
                  { label: 'Name', value: 'name' },
                ]}
              />
              <Button
                icon={<FieldTimeOutlined />}
                disabled={!!testingDelayName || !!testingGroupName}
                loading={testingGroupName === drawerGroup.name}
                onClick={() => void handleDelayGroup(drawerGroup)}
              >
                Test group
              </Button>
            </Space>
            <Table
              size="small"
              rowKey="key"
              virtual
              pagination={false}
              dataSource={drawerProxyRows}
              scroll={{ x: 480, y: 560 }}
              columns={[
                { title: '#', dataIndex: 'index', width: 52 },
                {
                  title: 'Node',
                  dataIndex: 'name',
                  ellipsis: true,
                  render: (name: string, row: { active: boolean }) => (
                    <Space>
                      {row.active && <Tag color="green">Current</Tag>}
                      <Typography.Text ellipsis style={{ maxWidth: 270 }}>{name}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: 'Delay',
                  dataIndex: 'delay',
                  width: 86,
                  render: (delay?: number) => delay === undefined
                    ? '-'
                    : <Tag color={delayTagColor(delay)}>{delay >= 0 ? `${delay}ms` : 'Timeout'}</Tag>,
                },
                {
                  title: 'Action',
                  key: 'action',
                  width: 84,
                  render: (_: unknown, row: { name?: string; active: boolean }) => (
                    <Button
                      size="small"
                      type={row.active ? 'primary' : 'default'}
                      onClick={() => row.name && void handleSelect(drawerGroup, row.name)}
                    >
                      {row.active ? 'Selected' : 'Select'}
                    </Button>
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Modal
        title={profileInputMode === 'url' ? '导入 Clash 订阅 URL' : '导入 Clash YAML'}
        open={profileModalOpen}
        onCancel={() => { if (!savingProfile) setProfileModalOpen(false) }}
        onOk={() => void handleSaveProfile()}
        okText={savingProfile ? '导入中...' : '保存'}
        cancelText="取消"
        confirmLoading={savingProfile}
        cancelButtonProps={{ disabled: savingProfile }}
        width={760}
      >
        <Form form={form} layout="vertical">
          {profileSaveStatus && (
            <Alert
              showIcon
              type={profileSaveStatus.type}
              message={profileSaveStatus.message}
              style={{ marginBottom: 12 }}
            />
          )}
          <Radio.Group value={profileInputMode} onChange={(event) => setProfileInputMode(event.target.value)} style={{ marginBottom: 12 }}>
            <Radio.Button value="url">订阅 URL</Radio.Button>
            <Radio.Button value="yaml">YAML 内容</Radio.Button>
          </Radio.Group>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]}><Input placeholder="例如：我的 Clash 订阅" /></Form.Item>
          {profileInputMode === 'url' ? (
            <>
              <Form.Item name="url" label="订阅链接" rules={[{ required: true, message: '请输入 Clash 订阅链接' }]}><Input placeholder="https://example.com/clash.yaml" /></Form.Item>
              <Space>
                <Form.Item name="autoUpdate" label="自动更新" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
                <Form.Item name="updateInterval" label="更新间隔" initialValue={12}><InputNumber min={1} max={168} addonAfter="小时" /></Form.Item>
              </Space>
            </>
          ) : (
            <Form.Item name="content" label="YAML 内容" rules={[{ required: true, message: '请粘贴 Clash YAML 内容' }]}><Input.TextArea rows={14} placeholder="粘贴包含 proxies 或 proxy-providers 的 Clash YAML 配置" /></Form.Item>
          )}
        </Form>
      </Modal>
    </Space>
  )
}

function ConnectionStatusCard(props: {
  state: AppConnectionState | null
  currentMode: 'clash'
  onDisconnect: () => void
  loading: boolean
}): JSX.Element {
  const { state } = props
  const connectedHere = state?.connected && state.mode === props.currentMode
  const connectedElsewhere = state?.connected && state.mode !== props.currentMode
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
