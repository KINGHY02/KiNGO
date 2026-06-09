import Store from 'electron-store'

export interface AppSettings {
  systemProxy: boolean
  proxyMode: 'global' | 'rule'
  autoStart: boolean
  browserPath: string
  minimizeToTray: boolean
  theme: 'light' | 'dark'
  autoCheckUpdates: boolean
  updateMirror: string
  defaultCoreByProtocol: Record<string, string>
}

const defaults: AppSettings = {
  systemProxy: false,
  proxyMode: 'rule',
  autoStart: false,
  browserPath: 'Browser\\chrome.exe',
  minimizeToTray: true,
  theme: 'light',
  autoCheckUpdates: true,
  updateMirror: '',
  defaultCoreByProtocol: {
    vmess: 'xray',
    vless: 'xray',
    trojan: 'xray',
    ss: 'xray',
    ss2022: 'singbox',
    ssr: 'singbox',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    tuic: 'singbox',
    naive: 'naiveproxy',
    juicity: 'juicity',
    mieru: 'mieru',
    shadowquic: 'shadowquic'
  }
}

const store = new Store<AppSettings>({
  name: 'settings',
  defaults,
  schema: {
    systemProxy: { type: 'boolean' },
    proxyMode: { type: 'string', enum: ['global', 'rule'] },
    autoStart: { type: 'boolean' },
    browserPath: { type: 'string' },
    minimizeToTray: { type: 'boolean' },
    theme: { type: 'string', enum: ['light', 'dark', 'pink', 'blue'] },
    autoCheckUpdates: { type: 'boolean' },
    updateMirror: { type: 'string' },
    defaultCoreByProtocol: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  }
})

export function getSettings(): AppSettings {
  return store.store
}

export function setSettings(partial: Partial<AppSettings>): void {
  store.set(partial as Record<string, unknown>)
}
