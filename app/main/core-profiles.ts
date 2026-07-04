import { existsSync } from 'fs'
import { join } from 'path'
import { resolveCoreRuntime, CoreRuntimeSource } from './core-runtime'
import { PROXY_DEFINITIONS } from './proxy-manager'

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

export function listCoreProfiles(baseDir: string, userCoreRoot: string): Array<CoreProfile & { installed: boolean; source: CoreRuntimeSource; executablePath: string | null; userExecutablePath: string | null; bundledExecutablePath: string | null }> {
  return CORE_PROFILES.map((profile) => ({
    ...profile,
    ...(() => {
      if (!profile.executable) {
        return {
          installed: true,
          source: 'bundled' as CoreRuntimeSource,
          executablePath: null,
          userExecutablePath: null,
          bundledExecutablePath: null,
        }
      }
      const runtimeDef = PROXY_DEFINITIONS.find((def) => def.id === profile.runtimeProxyId)
      if (!runtimeDef) {
        const bundledExecutablePath = join(baseDir, profile.dir, profile.executable)
        return {
          installed: existsSync(bundledExecutablePath),
          source: existsSync(bundledExecutablePath) ? 'bundled' as CoreRuntimeSource : 'missing' as CoreRuntimeSource,
          executablePath: bundledExecutablePath,
          userExecutablePath: null,
          bundledExecutablePath,
        }
      }
      const runtime = resolveCoreRuntime(baseDir, userCoreRoot, runtimeDef)
      return {
        installed: runtime.source !== 'missing',
        source: runtime.source,
        executablePath: runtime.executablePath,
        userExecutablePath: runtime.userExecutablePath,
        bundledExecutablePath: runtime.bundledExecutablePath,
      }
    })(),
  }))
}

export function getCoreProfile(id: string): CoreProfile | undefined {
  return CORE_PROFILES.find((profile) => profile.id === id)
}
