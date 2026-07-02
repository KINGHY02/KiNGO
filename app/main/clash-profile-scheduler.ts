import { EventEmitter } from 'events'
import { MihomoService } from './mihomo-service'

export interface ClashProfileUpdateEvent {
  id: string
  name: string
  success: boolean
  error?: string
}

export class ClashProfileScheduler extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null
  private updating = new Set<string>()

  constructor(private mihomoService: MihomoService) {
    super()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.runDueUpdates(), 60_000)
    setTimeout(() => void this.runDueUpdates(), 15_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runDueUpdates(now = Date.now()): Promise<void> {
    const profiles = this.mihomoService.listDueAutoUpdateProfiles(now)
    for (const profile of profiles) {
      if (this.updating.has(profile.id)) continue
      this.updating.add(profile.id)
      try {
        const result = await this.mihomoService.updateProfile(profile.id)
        this.emit('updated', {
          id: profile.id,
          name: profile.name,
          success: result.success,
          error: result.error,
        } satisfies ClashProfileUpdateEvent)
      } finally {
        this.updating.delete(profile.id)
      }
    }
  }
}
