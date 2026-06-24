import { EventEmitter } from 'events'
import { listSubscriptions, updateSubscription } from './nodes-store'
import { updateSubscriptionNodes } from './subscription-service'

export interface SubscriptionUpdateEvent {
  id: string
  name: string
  success: boolean
  diff?: { added: number; removed: number; unchanged: number } | null
  error?: string
}

export class SubscriptionScheduler extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null
  private updating = new Set<string>()

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.runDueUpdates(), 60_000)
    setTimeout(() => void this.runDueUpdates(), 10_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runDueUpdates(now = Date.now()): Promise<void> {
    const subscriptions = listSubscriptions()
    for (const sub of subscriptions) {
      if (!sub.enabled || !sub.autoUpdate || this.updating.has(sub.id)) continue
      const intervalMs = Math.max(1, sub.updateInterval || 12) * 60 * 60 * 1000
      const lastAttempt = sub.lastUpdateAttemptAt || sub.lastUpdated
      if (lastAttempt && now - lastAttempt < intervalMs) continue

      this.updating.add(sub.id)
      try {
        const diff = await updateSubscriptionNodes(sub.id)
        this.emit('updated', {
          id: sub.id,
          name: sub.name,
          success: true,
          diff,
        } satisfies SubscriptionUpdateEvent)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateSubscription(sub.id, { lastUpdateError: message })
        this.emit('updated', {
          id: sub.id,
          name: sub.name,
          success: false,
          error: message,
        } satisfies SubscriptionUpdateEvent)
      } finally {
        this.updating.delete(sub.id)
      }
    }
  }
}
