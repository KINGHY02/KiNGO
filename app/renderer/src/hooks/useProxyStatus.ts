import { useState, useEffect, useCallback } from 'react'
import { getProxyStatus, onStatusChanged, removeAllListeners } from '../services/ipc-client'

export function useProxyStatus(): {
  statuses: ProxyStatus[]
  loading: boolean
  refresh: () => void
} {
  const [statuses, setStatuses] = useState<ProxyStatus[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await getProxyStatus()
      setStatuses(data)
    } catch (err) {
      console.error('Failed to get proxy status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial load
    refresh()

    // Poll every 3 seconds
    const pollTimer = setInterval(refresh, 3000)

    // Listen for push updates from main process
    onStatusChanged((updated) => {
      setStatuses((prev) =>
        prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
      )
    })

    return () => {
      clearInterval(pollTimer)
      removeAllListeners('proxy:status-changed')
    }
  }, [refresh])

  return { statuses, loading, refresh }
}
