// ProfileEx store — stores per-node extended metadata (latency, speed, sort order, etc.)
// Conceptually equivalent to V2rayN's ProfileExItem: keeps display/status data separate from node config.
import Store from "electron-store"

export interface ProfileExItem {
  nodeId: string
  delay: number // -1 = unreachable, 0 = untested
  speed: number // bytes/sec, 0 = untested
  sort: number // sort order within group (persistent)
  ipInfo: string
  lastTested: number | null
}

interface ProfileExData {
  items: ProfileExItem[]
}

const store = new Store<ProfileExData>({
  name: "profile-ex",
  defaults: { items: [] }
})

function ensureItem(nodeId: string): ProfileExItem {
  let item = store.get("items").find((i) => i.nodeId === nodeId)
  if (!item) {
    item = { nodeId, delay: 0, speed: 0, sort: 0, ipInfo: "", lastTested: null }
    const items = store.get("items")
    items.push(item)
    store.set("items", items)
  }
  return item
}

export function getProfileEx(nodeId: string): ProfileExItem | undefined {
  return store.get("items").find((i) => i.nodeId === nodeId)
}

export function setDelay(nodeId: string, delay: number): void {
  const items = store.get("items")
  let item = items.find((i) => i.nodeId === nodeId)
  if (!item) {
    item = { nodeId, delay, speed: 0, sort: 0, ipInfo: "", lastTested: Date.now() }
    items.push(item)
  } else {
    item.delay = delay
    item.lastTested = Date.now()
  }
  store.set("items", items)
}

export function setDelays(results: Array<{ id: string; latency: number }>): void {
  if (results.length === 0) return
  const items = store.get("items")
  const index = new Map(items.map((item) => [item.nodeId, item]))
  const now = Date.now()

  for (const result of results) {
    let item = index.get(result.id)
    if (!item) {
      item = { nodeId: result.id, delay: result.latency, speed: 0, sort: 0, ipInfo: "", lastTested: now }
      items.push(item)
      index.set(result.id, item)
    } else {
      item.delay = result.latency
      item.lastTested = now
    }
  }

  store.set("items", items)
}

export function setSortOrder(nodeIds: string[]): void {
  const items = store.get("items")
  const updated = new Set<string>()
  nodeIds.forEach((id, idx) => {
    let item = items.find((i) => i.nodeId === id)
    if (!item) {
      item = { nodeId: id, delay: 0, speed: 0, sort: idx + 1, ipInfo: "", lastTested: null }
      items.push(item)
    } else {
      item.sort = idx + 1
    }
    updated.add(id)
  })
  store.set("items", items)
}

export function deleteProfileEx(nodeIds: string[]): void {
  const items = store.get("items").filter((i) => !nodeIds.includes(i.nodeId))
  store.set("items", items)
}

export function clearAll(): void {
  store.set("items", [])
}

export function listAll(): ProfileExItem[] {
  return store.get("items")
}
