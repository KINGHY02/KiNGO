import { execSync } from 'child_process'
import { get as httpsGet } from 'https'
import { PROXY_DEFINITIONS, ProxyDefinition } from './proxy-manager'
import { resolveCoreRuntime, CoreRuntimeSource } from './core-runtime'

interface CoreRepoInfo {
  githubRepo: string
  versionFlag: string
  versionRegex: RegExp
  assetKeywords: string[]
}

export interface CoreVersionInfo {
  proxyId: string
  name: string
  currentVersion: string | null
  latestVersion: string | null
  isOutdated: boolean
  source: CoreRuntimeSource
  executablePath: string
  userExecutablePath: string
  bundledExecutablePath: string
  error?: string
}

const CORE_REPOS: Record<string, CoreRepoInfo | undefined> = {
  'clash-meta': {
    githubRepo: 'MetaCubeX/mihomo',
    versionFlag: '-v',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
    assetKeywords: ['windows', 'amd64'],
  },
  xray: {
    githubRepo: 'XTLS/Xray-core',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
    assetKeywords: ['windows', '64'],
  },
  hysteria: {
    githubRepo: 'apernet/hysteria',
    versionFlag: 'version',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
    assetKeywords: ['windows', 'amd64'],
  },
  hysteria2: {
    githubRepo: 'apernet/hysteria',
    versionFlag: 'version',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
    assetKeywords: ['windows', 'amd64'],
  },
  singbox: {
    githubRepo: 'SagerNet/sing-box',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
    assetKeywords: ['windows', 'amd64'],
  },
  naiveproxy: {
    githubRepo: 'klzgrad/naiveproxy',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
    assetKeywords: ['win', 'x64'],
  },
  juicity: {
    githubRepo: 'juicity/juicity',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
    assetKeywords: ['windows', 'x86_64'],
  },
  mieru: {
    githubRepo: 'enfein/mieru',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
    assetKeywords: ['windows', 'amd64'],
  },
}

export function getCoreRepoInfo(proxyId: string): CoreRepoInfo | undefined {
  return CORE_REPOS[proxyId]
}

const EXEC_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { result: CoreVersionInfo[]; timestamp: number } | null = null

export function clearCoreVersionCache(): void {
  cache = null
}

function getCurrentVersion(def: ProxyDefinition, baseDir: string, userCoreRoot: string): { version: string | null; source: CoreRuntimeSource; executablePath: string; userExecutablePath: string; bundledExecutablePath: string } {
  const repoInfo = CORE_REPOS[def.id]
  const runtime = resolveCoreRuntime(baseDir, userCoreRoot, def)
  if (!repoInfo || runtime.source === 'missing') {
    return {
      version: null,
      source: runtime.source,
      executablePath: runtime.executablePath,
      userExecutablePath: runtime.userExecutablePath,
      bundledExecutablePath: runtime.bundledExecutablePath,
    }
  }

  try {
    const stdout = execSync(`"${runtime.executablePath}" ${repoInfo.versionFlag}`, {
      cwd: runtime.executableDir,
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf-8',
      windowsHide: true,
    })
    const match = stdout.match(repoInfo.versionRegex)
    return {
      version: match ? match[1] : null,
      source: runtime.source,
      executablePath: runtime.executablePath,
      userExecutablePath: runtime.userExecutablePath,
      bundledExecutablePath: runtime.bundledExecutablePath,
    }
  } catch {
    return {
      version: null,
      source: runtime.source,
      executablePath: runtime.executablePath,
      userExecutablePath: runtime.userExecutablePath,
      bundledExecutablePath: runtime.bundledExecutablePath,
    }
  }
}

function fetchLatestVersion(repo: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`
    const req = httpsGet(
      url,
      {
        headers: { 'User-Agent': 'KiNGO', Accept: 'application/vnd.github+json' },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            const tag = json.tag_name || ''
            const match = tag.match(/v?(\d+\.\d+\.\d+)/)
            resolve(match ? match[1] : tag)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(10000, () => {
      req.destroy()
      resolve(null)
    })
  })
}

function compareVersions(a: string, b: string): boolean {
  // returns true if a < b (a is outdated)
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va !== vb) return va < vb
  }
  return false
}

export async function checkAllVersions(baseDir: string, userCoreRoot: string): Promise<CoreVersionInfo[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.result
  }

  const entries = await Promise.all(
    PROXY_DEFINITIONS.map(async (def): Promise<CoreVersionInfo> => {
      const current = getCurrentVersion(def, baseDir, userCoreRoot)
      const repoInfo = CORE_REPOS[def.id]
      const latest = repoInfo ? await fetchLatestVersion(repoInfo.githubRepo) : null

      const isOutdated = !!(current.version && latest && compareVersions(current.version, latest))

      return {
        proxyId: def.id,
        name: def.name,
        currentVersion: current.version,
        latestVersion: latest,
        isOutdated,
        source: current.source,
        executablePath: current.executablePath,
        userExecutablePath: current.userExecutablePath,
        bundledExecutablePath: current.bundledExecutablePath,
      }
    })
  )

  cache = { result: entries, timestamp: Date.now() }
  return entries
}
