import { useState, useEffect } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './components/Layout/AppLayout'
import UpdateNotification from './components/UpdateNotification/UpdateNotification'
import { ThemeContext, getThemeTokens, ThemeMode } from './hooks/useTheme'

export default function App(): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  useEffect(() => {
    const api = window.electronAPI
    // Load initial theme from settings
    api.getSettings().then((s) => {
      if (s.theme === 'light' || s.theme === 'dark') {
        setThemeMode(s.theme)
      }
    })
    // Listen for settings changes
    if (api.onSettingsChanged) {
      api.onSettingsChanged((s) => {
        if (s.theme === 'light' || s.theme === 'dark') {
          setThemeMode(s.theme)
        }
      })
    }
    return () => {
      api.removeAllListeners('settings:changed')
    }
  }, [])

  const tokens = getThemeTokens(themeMode)

  return (
    <ThemeContext.Provider value={tokens}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: themeMode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: { colorPrimary: '#4b6cf7' }
        }}
      >
        <AppLayout />
        <UpdateNotification />
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}
