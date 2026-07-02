import { existsSync } from 'fs'
import { join } from 'path'

export type CoreFamily = 'mihomo' | 'xray' | 'sing-box' | 'legacy'

export interface CoreProfile {
  id: string
  name: string
  family: CoreFamily
  executable: string
  dir: string
  configFile: string
  configFormat: 'yaml' | 'json'
  defaultHttpPort?: number
  defaultSocksPort?: number
  controllerPort?: number
  supportsTun: boolean
  supportsSubscriptions: boolean
  supportsExternalController: boolean
  runtimeProxyId: string
}

export const CORE_PROFILES: CoreProfile[] = [
  {
    id: 'mihomo',
    name: 'mihomo',
    family: 'mihomo',
    dir: 'clash.meta',
    executable: 'clash.meta-windows-386.exe',
    configFile: 'config.yaml',
    configFormat: 'yaml',
    defaultHttpPort: 7890,
    defaultSocksPort: 7890,
    controllerPort: 9090,
    supportsTun: true,
    supportsSubscriptions: true,
    supportsExternalController: true,
    runtimeProxyId: 'clash-meta',
  },
  {
    id: 'xray',
    name: 'Xray',
    family: 'xray',
    dir: 'Xray',
    executable: 'xray.exe',
    configFile: 'config.json',
    configFormat: 'json',
    defaultSocksPort: 1080,
    supportsTun: false,
    supportsSubscriptions: true,
    supportsExternalController: false,
    runtimeProxyId: 'xray',
  },
  {
    id: 'singbox',
    name: 'sing-box',
    family: 'sing-box',
    dir: 'singbox',
    executable: 'sing-box.exe',
    configFile: 'config.json',
    configFormat: 'json',
    defaultSocksPort: 1080,
    supportsTun: true,
    supportsSubscriptions: true,
    supportsExternalController: false,
    runtimeProxyId: 'singbox',
  },
  {
    id: 'public-legacy',
    name: 'ChromeGO legacy cores',
    family: 'legacy',
    dir: '',
    executable: '',
    configFile: '',
    configFormat: 'json',
    supportsTun: false,
    supportsSubscriptions: false,
    supportsExternalController: false,
    runtimeProxyId: 'clash-meta',
  },
]

export function listCoreProfiles(baseDir: string): Array<CoreProfile & { installed: boolean }> {
  return CORE_PROFILES.map((profile) => ({
    ...profile,
    installed: profile.executable ? existsSync(join(baseDir, profile.dir, profile.executable)) : true,
  }))
}

export function getCoreProfile(id: string): CoreProfile | undefined {
  return CORE_PROFILES.find((profile) => profile.id === id)
}
