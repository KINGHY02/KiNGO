export interface LogEntry {
  timestamp: number
  proxyId: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export class LogService {
  private buffer: LogEntry[] = []
  private maxSize: number
  private onPush?: (entry: LogEntry) => void

  constructor(maxSize = 10000) {
    this.maxSize = maxSize
  }

  setPushHandler(handler: (entry: LogEntry) => void): void {
    this.onPush = handler
  }

  push(proxyId: string, line: string, level?: 'info' | 'warn' | 'error'): void {
    const trimmed = line.trim()
    if (!trimmed) return

    const detectedLevel = level ?? detectLevel(trimmed)
    const entry: LogEntry = {
      timestamp: Date.now(),
      proxyId,
      level: detectedLevel,
      message: trimmed
    }

    this.buffer.push(entry)
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift()
    }

    this.onPush?.(entry)
  }

  getLogs(proxyId?: string, limit = 100): LogEntry[] {
    let logs = proxyId
      ? this.buffer.filter((e) => e.proxyId === proxyId)
      : [...this.buffer]
    return logs.slice(-limit).reverse()
  }

  clear(): void {
    this.buffer = []
  }
}

function detectLevel(line: string): 'info' | 'warn' | 'error' {
  const lower = line.toLowerCase()
  if (/error|fail|timeout|refused|invalid|unreachable/i.test(lower)) return 'error'
  if (/warn/i.test(lower)) return 'warn'
  return 'info'
}
