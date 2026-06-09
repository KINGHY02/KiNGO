import { execSync } from 'child_process'
import { join } from 'path'
import { get as httpsGet } from 'https'
import { PROXY_DEFINITIONS, ProxyDefinition } from './proxy-manager'

interface CoreRepoInfo {
  githubRepo: string
  versionFlag: string
  versionRegex: RegExp
}

export interface CoreVersionInfo {
  proxyId: string
  name: string
  currentVersion: string | null
  latestVersion: string | null
  isOutdated: boolean
  error?: string
}

const CORE_REPOS: Record<string, CoreRepoInfo | undefined> = {
  'clash-meta': {
    githubRepo: 'MetaCubeX/mihomo',
    versionFlag: '-v',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
  },
  xray: {
    githubRepo: 'XTLS/Xray-core',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  hysteria: {
    githubRepo: 'apernet/hysteria',
    versionFlag: 'version',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
  },
  hysteria2: {
    githubRepo: 'apernet/hysteria',
    versionFlag: 'version',
    versionRegex: /v?(\d+\.\d+\.\d+)/i,
  },
  singbox: {
    githubRepo: 'SagerNet/sing-box',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  naiveproxy: {
    githubRepo: 'klzgrad/naiveproxy',
    versionFlag: '--version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  juicity: {
    githubRepo: 'juicity/juicity',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
  mieru: {
    githubRepo: 'enfein/mieru',
    versionFlag: 'version',
    versionRegex: /(\d+\.\d+\.\d+)/,
  },
}

const EXEC_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { result: CoreVersionInfo[]; timestamp: number } | null = null

function getCurrentVersion(def: ProxyDefinition, baseDir: string): string | null {
  const repoInfo = CORE_REPOS[def.id]
  if (!repoInfo) return null

  const exePath = join(baseDir, def.dir, def.executable)
  try {
    const stdout = execSync(`"${exePath}" ${repoInfo.versionFlag}`, {
      cwd: join(baseDir, def.dir),
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf-8',
      windowsHide: true,
    })
    const match = stdout.match(repoInfo.versionRegex)
    return match ? match[1] : null
  } catch {
    return null
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

export async function checkAllVersions(baseDir: string): Promise<CoreVersionInfo[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.result
  }

  const entries = await Promise.all(
    PROXY_DEFINITIONS.map(async (def): Promise<CoreVersionInfo> => {
      const current = getCurrentVersion(def, baseDir)
      const repoInfo = CORE_REPOS[def.id]
      const latest = repoInfo ? await fetchLatestVersion(repoInfo.githubRepo) : null

      const isOutdated = !!(current && latest && compareVersions(current, latest))

      return {
        proxyId: def.id,
        name: def.name,
        currentVersion: current,
        latestVersion: latest,
        isOutdated,
      }
    })
  )

  cache = { result: entries, timestamp: Date.now() }
  return entries
}
