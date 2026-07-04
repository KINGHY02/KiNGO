import Store from 'electron-store'

export interface AppSettings {
  systemProxy: boolean
  proxyMode: 'global' | 'rule'
  autoStart: boolean
  browserPath: string
  minimizeToTray: boolean
  theme: 'light' | 'dark' | 'pink' | 'blue'
  autoCheckUpdates: boolean
  updateMirror: string
  publicRouteAutoSelectMode: 'quick' | 'full'
  publicRouteAutoSelectLimit: number
  publicRouteAutoSwitch: boolean
  publicRouteHealthCheckInterval: number
  publicRouteHealthCheckFailures: number
  defaultCoreByProtocol: Record<string, string>
  lastSuccessfulRouteId: string | null
  selectedPublicRouteId: string | null
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
  publicRouteAutoSelectMode: 'quick',
  publicRouteAutoSelectLimit: 8,
  publicRouteAutoSwitch: true,
  publicRouteHealthCheckInterval: 30,
  publicRouteHealthCheckFailures: 3,
  lastSuccessfulRouteId: null,
  selectedPublicRouteId: null,
  defaultCoreByProtocol: {
    vmess: 'xray',
    vless: 'xray',
    trojan: 'xray',
    ss: 'xray',
    ss2022: 'singbox',
    ssr: 'singbox',
    hysteria: 'hysteria',
    hysteria2: 'singbox',
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
    publicRouteAutoSelectMode: { type: 'string', enum: ['quick', 'full'] },
    publicRouteAutoSelectLimit: { type: 'number', minimum: 1, maximum: 50 },
    publicRouteAutoSwitch: { type: 'boolean' },
    publicRouteHealthCheckInterval: { type: 'number', minimum: 10, maximum: 300 },
    publicRouteHealthCheckFailures: { type: 'number', minimum: 1, maximum: 10 },
    lastSuccessfulRouteId: { type: ['string', 'null'] },
    selectedPublicRouteId: { type: ['string', 'null'] },
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
