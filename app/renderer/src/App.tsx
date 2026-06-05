import { useState, useEffect } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './components/Layout/AppLayout'
import UpdateNotification from './components/UpdateNotification/UpdateNotification'
import { ThemeContext, getThemeTokens, ThemeMode, ThemeContextValue } from './hooks/useTheme'

export default function App(): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  useEffect(() => {
    const api = window.electronAPI
    // Load initial theme from settings
    api.getSettings().then((s) => {
      if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'pink' || s.theme === 'blue') {
        setThemeMode(s.theme)
      }
    })
    // Listen for settings changes
    const unsub = api.onSettingsChanged((s) => {
      if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'pink' || s.theme === 'blue') {
        setThemeMode(s.theme)
      }
    })
    return () => { unsub() }
  }, [])

  const tokens = getThemeTokens(themeMode)

  const ctx: ThemeContextValue = {
    tokens,
    setMode: (mode: ThemeMode) => {
      setThemeMode(mode)
      window.electronAPI.setSettings({ theme: mode }).catch(() => {})
    }
  }

  return (
    <ThemeContext.Provider value={ctx}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: themeMode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: { colorPrimary: themeMode === 'pink' ? '#ff4088' : themeMode === 'blue' ? '#3b82f6' : '#4b6cf7' }
        }}
      >
        <AppLayout />
        <UpdateNotification />
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
