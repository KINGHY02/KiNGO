import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Tag, Typography, Select, message, Spin } from 'antd'
import { ChromeOutlined, StopOutlined, LoadingOutlined, ThunderboltOutlined, PauseCircleOutlined } from '@ant-design/icons'
import { useProxyStatus } from '../../hooks/useProxyStatus'
import { useTheme } from '../../hooks/useTheme'
import { startProxy, stopProxy, launchChrome, getCurrentSlot, getSlots, switchSlot, updateIP } from '../../services/ipc-client'

const PROXY_OPTIONS = [
  { value: 'clash-meta', label: 'Clash.Meta' },
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria v1' },
  { value: 'hysteria2', label: 'Hysteria v2' },
  { value: 'singbox', label: 'Sing-Box' },
  { value: 'naiveproxy', label: 'NaiveProxy' },
  { value: 'juicity', label: 'Juicity' },
  { value: 'mieru', label: 'Mieru' },
  { value: 'shadowquic', label: 'ShadowQUIC' }
]

const ANIM_STYLES = `
@keyframes kngo-pulse {
  0% { box-shadow: 0 0 0 0 rgba(99, 130, 255, 0.5); }
  70% { box-shadow: 0 0 0 28px rgba(99, 130, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 130, 255, 0); }
}
@keyframes kngo-spin-ring {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes kngo-fadein {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
`

export default function Dashboard(): JSX.Element {
  const t = useTheme()
  const { statuses, refresh } = useProxyStatus()
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  const [selectedId, setSelectedId] = useState<string>('clash-meta')
  const [loading, setLoading] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [activeSlot, setActiveSlot] = useState<number | null>(null)
  const [switchingSlot, setSwitchingSlot] = useState(false)
  const [autoUpdating, setAutoUpdating] = useState(false)

  const selectedProxy = statuses.find((s) => s.id === selectedId)
  const running = selectedProxy?.running ?? false

  const loadSlots = useCallback(async (proxyId: string) => {
    setSlotsLoading(true)
    try {
      const [slotList, current] = await Promise.all([
        getSlots(proxyId),
        getCurrentSlot(proxyId)
      ])
      setSlots(slotList)
      setActiveSlot(current?.slot ?? null)
      return slotList
    } catch {
      setSlots([])
      return []
    } finally {
      setSlotsLoading(false)
    }
  }, [])

  const autoDownloadSlots = useCallback(async (proxyId: string, slotList: SlotInfo[]) => {
    const undownloaded = slotList.filter((s) => !s.downloaded)
    if (undownloaded.length === 0) return
    setAutoUpdating(true)
    for (const s of undownloaded) {
      try { await updateIP(proxyId, s.slot) } catch { /* continue */ }
    }
    await loadSlots(proxyId)
    setAutoUpdating(false)
  }, [loadSlots])

  useEffect(() => {
    loadSlots(selectedId).then((list) => {
      if (list.length > 0) autoDownloadSlots(selectedId, list)
    })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => { loadSlots(selectedId) }, 30_000)
    return () => clearInterval(timer)
  }, [selectedId, loadSlots])

  const handleToggle = async () => {
    setLoading(true)
    try {
      if (running) {
        const result = await stopProxy(selectedId)
        if (result.success) { message.success('代理已停止'); refresh() }
        else { message.error(`停止失败: ${result.error}`) }
      } else {
        const result = await startProxy(selectedId)
        if (result.success) { message.success(`代理启动成功，PID: ${result.pid}`); refresh() }
        else { message.error(`启动失败: ${result.error}`) }
      }
    } catch (err) {
      message.error(`操作出错: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleStopAll = async () => {
    for (const s of statuses.filter((x) => x.running)) {
      await stopProxy(s.id)
    }
    message.success('已停止所有代理')
    refresh()
  }

  const handleLaunchChrome = async () => {
    const result = await launchChrome()
    if (result.success) { message.success('浏览器已启动') }
    else { message.warning(result.error || '浏览器启动失败') }
  }

  const handleSlotClick = async (slot: number) => {
    if (slot === activeSlot || switchingSlot) return
    setSwitchingSlot(true)
    try {
      const result = await switchSlot(selectedId, slot)
      if (result.success) { setActiveSlot(slot); message.success(`已切换到槽位 ${slot}`) }
      else { message.error(`切换失败: ${result.error}`) }
    } catch { message.error('切换出错') }
    finally { setSwitchingSlot(false) }
  }

  const shortDesc = (desc: string): string => {
    const cleaned = desc.replace(/^ip\d+/i, '').replace(/更新|配置文件|clash|meta/gi, '').trim()
    return cleaned || desc
  }

  const isUpdating = loading || autoUpdating || switchingSlot

  // Dynamic color values based on theme
  const bgOrb1 = t.mode === 'dark' ? 'rgba(99,130,255,0.07)' : 'rgba(99,130,255,0.05)'
  const bgOrb2 = t.mode === 'dark' ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.04)'
  const ringBorder = t.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'
  const btnStartShadow = '0 8px 50px rgba(75, 108, 247, 0.45)'
  const btnStopShadow = '0 0 50px rgba(75, 108, 247, 0.2)'
  const statusDimColor = t.mode === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
  const connectTextColor = t.mode === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'
  const labelColor = t.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)'
  const noSlotColor = t.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.25)'

  return (
    <>
      <style>{ANIM_STYLES}</style>
      <div style={{
        height: '100%',
        background: t.dashGradient,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '24px 24px 20px',
        position: 'relative', overflow: 'hidden', userSelect: 'none'
      }}>
        {/* Background orbs */}
        <div style={{
          position: 'absolute', top: '10%', left: '-80px',
          width: 200, height: 200, borderRadius: '50%',
          background: `radial-gradient(circle, ${bgOrb1} 0%, transparent 70%)`,
          pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute', bottom: '20%', right: '-60px',
          width: 220, height: 220, borderRadius: '50%',
          background: `radial-gradient(circle, ${bgOrb2} 0%, transparent 70%)`,
          pointerEvents: 'none'
        }} />

        {/* Proxy selector */}
        <div style={{ width: '100%', maxWidth: 360, marginBottom: 8, marginTop: 4 }}>
          <Typography.Text style={{ fontSize: 11, color: labelColor, marginBottom: 4, display: 'block' }}>
            选择核心
          </Typography.Text>
          <Select
            value={selectedId}
            onChange={setSelectedId}
            options={PROXY_OPTIONS}
            size="large"
            popupMatchSelectWidth={false}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 16 }} />

        {/* Big connect button */}
        <div style={{ position: 'relative' }}>
          <div style={{
            width: 210, height: 210, borderRadius: '50%',
            border: `2px solid ${ringBorder}`,
            position: 'absolute', top: -15, left: -15,
            animation: isUpdating && !running ? 'kngo-spin-ring 3s linear infinite' : 'none',
            pointerEvents: 'none'
          }} />
          {running && (
            <div style={{
              width: 210, height: 210, borderRadius: '50%',
              position: 'absolute', top: -15, left: -15,
              animation: 'kngo-pulse 2.5s infinite', pointerEvents: 'none'
            }} />
          )}
          <div
            onClick={loading ? undefined : handleToggle}
            style={{
              width: 180, height: 180, borderRadius: '50%',
              background: running ? t.dashBtnStopBg : t.dashBtnStartBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: running ? btnStopShadow : btnStartShadow,
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease',
              opacity: loading ? 0.7 : 1,
              position: 'relative', zIndex: 1,
              transform: 'scale(1)', border: 'none'
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.transform = 'scale(1.05)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <div style={{
              position: 'absolute', width: 158, height: 158, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.05)', pointerEvents: 'none'
            }} />
            {loading ? (
              <LoadingOutlined style={{ fontSize: 56, color: '#fff' }} spin />
            ) : running ? (
              <PauseCircleOutlined style={{ fontSize: 60, color: 'rgba(255,255,255,0.8)' }} />
            ) : (
              <ThunderboltOutlined style={{ fontSize: 54, color: t.dashBtnText }} />
            )}
          </div>
        </div>

        {/* Status */}
        <Typography.Text style={{
          fontSize: 22, fontWeight: 700, marginTop: 24,
          color: running ? t.dashStatusColor : connectTextColor,
          letterSpacing: 3, transition: 'color 0.4s'
        }}>
          {running ? '已连接' : '点击连接'}
        </Typography.Text>
        {running && selectedProxy && (
          <Typography.Text style={{ fontSize: 13, color: statusDimColor, marginTop: 4 }}>
            {selectedProxy.localAddress} · PID {selectedProxy.pid}
          </Typography.Text>
        )}
        {autoUpdating && (
          <Typography.Text style={{ fontSize: 12, color: statusDimColor, marginTop: 4 }}>
            <LoadingOutlined style={{ marginRight: 4 }} spin />
            正在更新线路配置...
          </Typography.Text>
        )}

        <div style={{ flex: 1, minHeight: 12 }} />

        {/* Slot cards */}
        <div style={{ width: '100%', maxWidth: 380 }}>
          <Typography.Text style={{
            fontSize: 12, color: labelColor, marginBottom: 8, display: 'block', paddingLeft: 4
          }}>
            选择线路
          </Typography.Text>
          {slotsLoading && slots.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
          ) : slots.length === 0 ? (
            <Typography.Text style={{ fontSize: 13, color: noSlotColor }}>暂无可用线路</Typography.Text>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, animation: 'kngo-fadein 0.5s ease' }}>
              {slots.map((s, i) => {
                const isActive = s.slot === activeSlot
                return (
                  <div
                    key={s.slot}
                    onClick={() => { if (!isActive && !switchingSlot) handleSlotClick(s.slot) }}
                    style={{
                      flex: '1 1 calc(33.33% - 8px)', minWidth: 100, maxWidth: 'calc(50% - 4px)',
                      padding: '10px 10px', borderRadius: 10,
                      background: isActive ? t.dashSlotActiveBg : t.dashSlotBg,
                      border: isActive ? `1px solid ${t.dashSlotActiveBorder}` : `1px solid ${t.dashSlotBorder}`,
                      cursor: !isActive && !switchingSlot ? 'pointer' : 'default',
                      transition: 'all 0.25s ease, transform 0.15s ease',
                      textAlign: 'center',
                      opacity: isActive ? 1 : 0.6,
                      animation: `kngo-fadein 0.4s ease ${i * 0.05}s both`
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive && !switchingSlot) {
                        e.currentTarget.style.background = t.hover
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.opacity = '0.85'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = t.dashSlotBg
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.opacity = '0.6'
                      }
                    }}
                  >
                    <div style={{
                      display: 'flex', gap: 2, marginBottom: 6,
                      alignItems: 'flex-end', height: 14, justifyContent: 'center'
                    }}>
                      {[0, 1, 2, 3].map((j) => (
                        <div key={j} style={{
                          width: 3, height: 3 + j * 3.5, borderRadius: 1,
                          background: isActive ? 'rgba(100, 255, 150, 0.85)' : t.textSecondary,
                          transition: 'all 0.3s'
                        }} />
                      ))}
                    </div>
                    <Typography.Text style={{
                      fontSize: 12, lineHeight: 1.3, display: 'block',
                      color: isActive ? t.text : t.dashSlotText,
                      fontWeight: isActive ? 500 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {shortDesc(s.description)}
                    </Typography.Text>
                    {isActive && (
                      <Tag color="blue" style={{
                        margin: '4px 0 0', fontSize: 10, lineHeight: '14px',
                        padding: '0 4px', border: 'none'
                      }}>当前</Tag>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 380, marginTop: 14 }}>
          <Button
            type="primary"
            icon={<ChromeOutlined />}
            onClick={handleLaunchChrome}
            size="large"
            style={{
              flex: 1, height: 44, borderRadius: 10,
              background: t.dashActionBtnBg, border: `1px solid ${t.dashActionBtnBorder}`,
              color: t.dashActionBtnColor, fontWeight: 500, transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.mode === 'dark' ? 'rgba(255,255,255,0.14)' : '#f0f0f0'; e.currentTarget.style.color = t.text }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.dashActionBtnBg; e.currentTarget.style.color = t.dashActionBtnColor }}
          >
            启动浏览器
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleStopAll}
            size="large"
            style={{
              height: 44, borderRadius: 10,
              background: t.dashStopBtnBg, border: `1px solid ${t.dashStopBtnBorder}`,
              color: t.dashStopBtnColor, fontWeight: 500, transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,77,79,0.2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.dashStopBtnBg }}
          >
            全部停止
          </Button>
        </div>
      </div>
    </>
  )
}
