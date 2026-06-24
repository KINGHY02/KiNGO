import { join } from 'path'
import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import https from 'https'
import { EventEmitter } from 'events'
import * as yaml from 'js-yaml'

// URL path mapping from proxy directory -> GitLab directory name
const URL_DIR_MAP: Record<string, string> = {
  'clash.meta': 'clash.meta2',
  'Xray': 'xray',
  'hysteria': 'hysteria',
  'hysteria2': 'hysteria2',
  'singbox': 'singbox',
  'naiveproxy': 'naiveproxy',
  'juicity': 'juicity',
  'mieru': 'mieru',
  'shadowquic': 'shadowquic'
}

export interface SlotInfo {
  slot: number
  description: string
  downloaded: boolean
  active: boolean
}

interface SlotRecord {
  slot: number
  description: string
  updatedAt: string
}

export function getAvailableSlots(baseDir: string, proxyDirName: string): SlotInfo[] {
  const ipUpdateDir = join(baseDir, proxyDirName, 'ip_Update')
  if (!existsSync(ipUpdateDir)) return []

  const currentSlot = getCurrentSlot(baseDir, proxyDirName)
  const files = readdirSync(ipUpdateDir)
  const slots: SlotInfo[] = []

  for (const file of files) {
    const match = file.match(/^ip_(\d+)\.bat$/)
    if (match) {
      const slot = Number(match[1])
      const description = `IP${slot}`
      const downloaded = checkCachedSlot(ipUpdateDir, slot)
      const active = currentSlot?.slot === slot
      slots.push({ slot, description, downloaded, active })
    }
  }
  return slots.sort((a, b) => a.slot - b.slot)
}

function checkCachedSlot(ipUpdateDir: string, slot: number): boolean {
  try {
    const files = readdirSync(ipUpdateDir)
    const prefix = `slot_${slot}_`
    return files.some((f) => f.startsWith(prefix))
  } catch {
    return false
  }
}

function findCachedFile(ipUpdateDir: string, slot: number): string | null {
  try {
    const files = readdirSync(ipUpdateDir)
    const prefix = `slot_${slot}_`
    const match = files.find((f) => f.startsWith(prefix))
    return match ? join(ipUpdateDir, match) : null
  } catch {
    return null
  }
}

// Read which slot's config is currently active for a proxy
export function getCurrentSlot(baseDir: string, proxyDirName: string): SlotRecord | null {
  const recordPath = join(baseDir, proxyDirName, '.kingo-slot.json')
  try {
    if (existsSync(recordPath)) {
      return JSON.parse(readFileSync(recordPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  return null
}

// Apply a cached slot config to the active config location (internal)
function applySlot(
  baseDir: string,
  proxyDirName: string,
  configFileName: string,
  slot: number,
  description: string
): void {
  const ipUpdateDir = join(baseDir, proxyDirName, 'ip_Update')
  const cachePath = join(ipUpdateDir, `slot_${slot}_${configFileName}`)
  const configPath = join(baseDir, proxyDirName, configFileName)

  // Build backup path: config.yaml → config_backup.yaml, config.json → config_backup.json
  const backupPath = configPath.replace(/(\.(json|yaml))$/, '_backup$1')
    .replace('.yaml_backup', '_backup.yaml')

  if (existsSync(configPath)) {
    copyFileSync(configPath, backupPath)
  }
  copyFileSync(cachePath, configPath)

  const record: SlotRecord = {
    slot,
    description,
    updatedAt: new Date().toISOString()
  }
  writeFileSync(join(baseDir, proxyDirName, '.kingo-slot.json'), JSON.stringify(record, null, 2), 'utf-8')
}

// Switch to a previously downloaded slot WITHOUT re-downloading
export function switchSlot(
  baseDir: string,
  proxyDirName: string,
  configFileName: string,
  slot: number
): { success: boolean; error?: string } {
  const ipUpdateDir = join(baseDir, proxyDirName, 'ip_Update')
  const cachedFile = findCachedFile(ipUpdateDir, slot)

  if (!cachedFile) {
    return { success: false, error: `IP${slot} 尚未下载，请先点击"更新"下载配置` }
  }

  try {
    const slots = getAvailableSlots(baseDir, proxyDirName)
    const slotInfo = slots.find((s) => s.slot === slot)
    applySlot(baseDir, proxyDirName, configFileName, slot, slotInfo?.description || `IP${slot}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: `切换失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// Download config from GitLab, save to cache, then auto-apply
export async function updateConfig(
  baseDir: string,
  proxyDirName: string,
  configFileName: string,
  slot: number,
  emitter?: EventEmitter
): Promise<{ success: boolean; error?: string }> {
  const gitlabDir = URL_DIR_MAP[proxyDirName] || proxyDirName

  const primaryUrl = `https://www.gitlabip.xyz/Alvin9999/PAC/refs/heads/master/backup/img/1/2/ipp/${gitlabDir}/${slot}/${configFileName}`
  const fallbackUrl = `https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/${gitlabDir}/${slot}/${configFileName}`

  let content: string | null = null
  try {
    emitter?.emit('progress', { percent: 30 })
    content = await downloadFile(primaryUrl)
  } catch {
    try {
      emitter?.emit('progress', { percent: 30 })
      content = await downloadFile(fallbackUrl)
    } catch (err) {
      return { success: false, error: `下载失败: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  if (!content) {
    return { success: false, error: '下载内容为空' }
  }

  try {
    if (configFileName.endsWith('.json')) JSON.parse(content)
    else yaml.load(content)
  } catch (err) {
    return { success: false, error: `下载的线路配置格式无效: ${err instanceof Error ? err.message : String(err)}` }
  }

  emitter?.emit('progress', { percent: 70 })

  // Save to cache in ip_Update/
  const ipUpdateDir = join(baseDir, proxyDirName, 'ip_Update')
  const cachePath = join(ipUpdateDir, `slot_${slot}_${configFileName}`)

  try {
    writeFileSync(cachePath, content, 'utf-8')

    // Auto-apply: copy cached config to active location, record in .kingo-slot.json
    const slots = getAvailableSlots(baseDir, proxyDirName)
    const slotInfo = slots.find((s) => s.slot === slot)

    // Backup current active config
    const configPath = join(baseDir, proxyDirName, configFileName)
    const backupPath = configPath.replace(/(\.(json|yaml))$/, '_backup$1')
      .replace('.yaml_backup', '_backup.yaml')
    if (existsSync(configPath)) {
      copyFileSync(configPath, backupPath)
    }

    // Copy cached to active
    copyFileSync(cachePath, configPath)

    const record: SlotRecord = {
      slot,
      description: slotInfo?.description || `IP${slot}`,
      updatedAt: new Date().toISOString()
    }
    writeFileSync(join(baseDir, proxyDirName, '.kingo-slot.json'), JSON.stringify(record, null, 2), 'utf-8')

    emitter?.emit('progress', { percent: 100 })
    return { success: true }
  } catch (err) {
    return { success: false, error: `写入配置失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function downloadFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false })
    const req = https.get(url, { agent }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location
        if (redirect) {
          https.get(redirect, { agent }, (redirectRes) => {
            let data = ''
            redirectRes.on('data', (chunk: Buffer) => { data += chunk.toString() })
            redirectRes.on('end', () => resolve(data))
            redirectRes.on('error', reject)
          }).on('error', reject)
          return
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })

    req.on('error', reject)
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}
