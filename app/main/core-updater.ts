import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { get as httpsGet } from 'https'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
import extractZip from 'extract-zip'
import * as tar from 'tar'
import { PROXY_DEFINITIONS } from './proxy-manager'
import { getCoreRepoInfo } from './core-version'

interface GitHubAsset {
  name: string
  browser_download_url: string
  size?: number
}

interface GitHubRelease {
  tag_name?: string
  assets?: GitHubAsset[]
}

export interface CoreUpdateInfo {
  success: boolean
  proxyId: string
  version?: string
  assetName?: string
  assetSize?: number
  downloadUrl?: string
  checksumAvailable?: boolean
  checksumAssetName?: string
  error?: string
}

export interface CoreUpdateResult {
  success: boolean
  proxyId: string
  version?: string
  source?: string
  executablePath?: string
  checksumVerified?: boolean
  checksumAssetName?: string
  checksumError?: string
  error?: string
}

export type CoreUpdateStage = 'checking' | 'downloading' | 'verifying' | 'extracting' | 'installing' | 'completed' | 'failed'

export interface CoreUpdateProgress {
  proxyId: string
  stage: CoreUpdateStage
  percent: number
  transferred?: number
  total?: number
  message: string
}

type ProgressCallback = (progress: CoreUpdateProgress) => void

function requestJson(url: string): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { 'User-Agent': 'KiNGO', Accept: 'application/vnd.github+json' } }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk.toString() })
      res.on('end', () => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`GitHub request failed: HTTP ${res.statusCode}`))
          return
        }
        try { resolve(JSON.parse(body) as GitHubRelease) } catch (err) { reject(err) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => {
      req.destroy(new Error('GitHub request timeout'))
    })
  })
}

function downloadFile(url: string, target: string, redirects = 0, onProgress?: (transferred: number, total?: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { 'User-Agent': 'KiNGO' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.resume()
        if (redirects > 5) {
          reject(new Error('Too many redirects'))
          return
        }
        downloadFile(res.headers.location, target, redirects + 1, onProgress).then(resolve, reject)
        return
      }
      if ((res.statusCode || 0) >= 400) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        return
      }
      const file = createWriteStream(target)
      const total = Number(res.headers['content-length'] || 0) || undefined
      let transferred = 0
      res.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        onProgress?.(transferred, total)
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, () => {
      req.destroy(new Error('Download timeout'))
    })
  })
}

function scoreAsset(asset: GitHubAsset, keywords: string[]): number {
  const name = asset.name.toLowerCase()
  if (name.includes('checksums') || name.endsWith('.sig') || name.endsWith('.sha256')) return -100
  if (!name.includes('windows') && !name.includes('win')) return -50
  if (!/(\.zip|\.gz|\.exe)$/i.test(name)) return -20
  return keywords.reduce((score, key) => score + (name.includes(key.toLowerCase()) ? 10 : -3), 0)
}

function pickAsset(assets: GitHubAsset[], keywords: string[]): GitHubAsset | null {
  return assets
    .map((asset) => ({ asset, score: scoreAsset(asset, keywords) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.asset || null
}

function pickChecksumAsset(assets: GitHubAsset[], targetAssetName: string): GitHubAsset | null {
  const lowerTarget = targetAssetName.toLowerCase()
  return assets.find((asset) => {
    const name = asset.name.toLowerCase()
    if (name.endsWith('.sig') || name.endsWith('.asc')) return false
    if (name.includes('sha256') || name.includes('checksum')) return true
    return name === `${lowerTarget}.sha256` || name === `${lowerTarget}.sha256sum`
  }) || null
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readExpectedSha256(checksumPath: string, assetName: string): string | null {
  const text = readFileSync(checksumPath, 'utf-8')
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lowerAssetName = assetName.toLowerCase()

  const exactLine = lines.find((line) => line.toLowerCase().includes(lowerAssetName))
  const line = exactLine || (lines.length === 1 ? lines[0] : '')
  const match = line.match(/\b[a-fA-F0-9]{64}\b/)
  return match ? match[0].toLowerCase() : null
}

async function verifySha256(downloadPath: string, asset: GitHubAsset, checksumAsset: GitHubAsset | null, tempDir: string): Promise<{ verified: boolean; checksumAssetName?: string; error?: string }> {
  if (!checksumAsset) {
    return { verified: false, error: '未找到 SHA256 校验文件' }
  }

  const checksumPath = join(tempDir, checksumAsset.name)
  await downloadFile(checksumAsset.browser_download_url, checksumPath)
  const expected = readExpectedSha256(checksumPath, asset.name)
  if (!expected) {
    return { verified: false, checksumAssetName: checksumAsset.name, error: '校验文件中没有找到该资产的 SHA256' }
  }

  const actual = sha256File(downloadPath)
  if (actual !== expected) {
    throw new Error(`SHA256 校验失败：期望 ${expected}，实际 ${actual}`)
  }

  return { verified: true, checksumAssetName: checksumAsset.name }
}

export async function getCoreUpdateInfo(proxyId: string): Promise<CoreUpdateInfo> {
  const def = PROXY_DEFINITIONS.find((item) => item.id === proxyId)
  if (!def) return { success: false, proxyId, error: '未知核心' }

  const repo = getCoreRepoInfo(proxyId)
  if (!repo) return { success: false, proxyId, error: '该核心暂不支持自动更新' }

  try {
    const release = await requestJson(`https://api.github.com/repos/${repo.githubRepo}/releases/latest`)
    const asset = pickAsset(release.assets || [], repo.assetKeywords)
    if (!asset) return { success: false, proxyId, error: '没有找到适合 Windows 的下载资产' }
    const checksumAsset = pickChecksumAsset(release.assets || [], asset.name)
    return {
      success: true,
      proxyId,
      version: release.tag_name,
      assetName: asset.name,
      assetSize: asset.size,
      downloadUrl: asset.browser_download_url,
      checksumAvailable: !!checksumAsset,
      checksumAssetName: checksumAsset?.name,
    }
  } catch (err) {
    return { success: false, proxyId, error: err instanceof Error ? err.message : String(err) }
  }
}

function findExecutable(dir: string): string | null {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = findExecutable(path)
      if (nested) return nested
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
      return path
    }
  }
  return null
}

async function unpack(downloadPath: string, extractDir: string): Promise<string> {
  const lower = downloadPath.toLowerCase()
  if (lower.endsWith('.zip')) {
    await extractZip(downloadPath, { dir: extractDir })
  } else if (lower.endsWith('.exe')) {
    return downloadPath
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await tar.x({ file: downloadPath, cwd: extractDir })
  } else if (lower.endsWith('.gz')) {
    const outputName = basename(downloadPath).replace(/\.gz$/i, '')
    const outputPath = join(extractDir, outputName)
    writeFileSync(outputPath, gunzipSync(readFileSync(downloadPath)))
    return outputPath
  } else {
    throw new Error(`不支持的下载文件格式: ${extname(downloadPath) || basename(downloadPath)}`)
  }

  const exe = findExecutable(extractDir)
  if (!exe) throw new Error('下载包中没有找到 Windows 可执行文件')
  return exe
}

export async function updateCore(proxyId: string, userCoreRoot: string, onProgress?: ProgressCallback): Promise<CoreUpdateResult> {
  const def = PROXY_DEFINITIONS.find((item) => item.id === proxyId)
  if (!def) return { success: false, proxyId, error: '未知核心' }

  const repo = getCoreRepoInfo(proxyId)
  if (!repo) return { success: false, proxyId, error: '该核心暂不支持自动更新' }

  onProgress?.({ proxyId, stage: 'checking', percent: 3, message: '正在查询最新版本' })
  const release = await requestJson(`https://api.github.com/repos/${repo.githubRepo}/releases/latest`)
  const asset = pickAsset(release.assets || [], repo.assetKeywords)
  if (!asset) return { success: false, proxyId, error: '没有找到适合 Windows 的下载资产' }
  const checksumAsset = pickChecksumAsset(release.assets || [], asset.name)

  const tempDir = await mkdtemp(join(tmpdir(), 'kingo-core-'))
  const extractDir = join(tempDir, 'extract')
  mkdirSync(extractDir, { recursive: true })

  try {
    const downloadPath = join(tempDir, asset.name)
    onProgress?.({ proxyId, stage: 'downloading', percent: 5, message: `正在下载 ${asset.name}` })
    await downloadFile(asset.browser_download_url, downloadPath, 0, (transferred, total) => {
      const percent = total ? Math.min(80, Math.max(5, Math.round((transferred / total) * 75) + 5)) : 20
      onProgress?.({ proxyId, stage: 'downloading', percent, transferred, total, message: `正在下载 ${asset.name}` })
    })
    onProgress?.({ proxyId, stage: 'verifying', percent: 82, message: checksumAsset ? '正在校验 SHA256' : '未找到校验文件，跳过 SHA256 校验' })
    const checksum = await verifySha256(downloadPath, asset, checksumAsset, tempDir)
    onProgress?.({ proxyId, stage: 'extracting', percent: 88, message: '正在解压核心文件' })
    const exe = await unpack(downloadPath, extractDir)

    onProgress?.({ proxyId, stage: 'installing', percent: 94, message: '正在安装到用户核心目录' })
    const targetDir = join(userCoreRoot, def.id)
    mkdirSync(targetDir, { recursive: true })
    const targetExe = join(targetDir, def.executable)
    const backupExe = `${targetExe}.bak`

    if (existsSync(targetExe)) {
      copyFileSync(targetExe, backupExe)
    }

    try {
      copyFileSync(exe, targetExe)
      onProgress?.({ proxyId, stage: 'completed', percent: 100, message: '核心更新完成' })
      return {
        success: true,
        proxyId,
        version: release.tag_name,
        source: asset.name,
        executablePath: targetExe,
        checksumVerified: checksum.verified,
        checksumAssetName: checksum.checksumAssetName,
        checksumError: checksum.error,
      }
    } catch (err) {
      if (existsSync(backupExe)) renameSync(backupExe, targetExe)
      throw err
    } finally {
      if (existsSync(backupExe)) rmSync(backupExe, { force: true })
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    onProgress?.({ proxyId, stage: 'failed', percent: 100, message: error })
    return { success: false, proxyId, error }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function restoreBundledCore(proxyId: string, userCoreRoot: string): CoreUpdateResult {
  const def = PROXY_DEFINITIONS.find((item) => item.id === proxyId)
  if (!def) return { success: false, proxyId, error: '未知核心' }

  const targetDir = join(userCoreRoot, def.id)
  try {
    rmSync(targetDir, { recursive: true, force: true })
    return { success: true, proxyId }
  } catch (err) {
    return { success: false, proxyId, error: err instanceof Error ? err.message : String(err) }
  }
}
