import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { ProxyDefinition } from './proxy-manager'

export type CoreRuntimeSource = 'user' | 'bundled' | 'missing'

export interface CoreRuntimePath {
  source: CoreRuntimeSource
  executablePath: string
  executableDir: string
  bundledExecutablePath: string
  bundledDir: string
  userExecutablePath: string
  userDir: string
  configPath: string
  configDir: string
}

export function getUserCoreRoot(userDataDir: string): string {
  return join(userDataDir, 'cores')
}

export function ensureUserCoreRoot(userCoreRoot: string): void {
  mkdirSync(userCoreRoot, { recursive: true })
}

export function resolveCoreRuntime(baseDir: string, userCoreRoot: string, def: ProxyDefinition): CoreRuntimePath {
  const bundledDir = join(baseDir, def.dir)
  const bundledExecutablePath = join(bundledDir, def.executable)
  const userDir = join(userCoreRoot, def.id)
  const userExecutablePath = join(userDir, def.executable)
  const configDir = bundledDir
  const configPath = join(configDir, def.configFile)

  if (existsSync(userExecutablePath)) {
    return {
      source: 'user',
      executablePath: userExecutablePath,
      executableDir: userDir,
      bundledExecutablePath,
      bundledDir,
      userExecutablePath,
      userDir,
      configPath,
      configDir,
    }
  }

  if (existsSync(bundledExecutablePath)) {
    return {
      source: 'bundled',
      executablePath: bundledExecutablePath,
      executableDir: bundledDir,
      bundledExecutablePath,
      bundledDir,
      userExecutablePath,
      userDir,
      configPath,
      configDir,
    }
  }

  return {
    source: 'missing',
    executablePath: userExecutablePath,
    executableDir: userDir,
    bundledExecutablePath,
    bundledDir,
    userExecutablePath,
    userDir,
    configPath,
    configDir,
  }
}
