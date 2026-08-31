import type { AssessResult } from "./assess/types"

const TTL_MS = 2 * 60 * 60 * 1000
const MAX_ENTRIES = 20

interface CacheEntry {
  result: AssessResult
  storedAt: number
}

const cache = new Map<string, CacheEntry>()

export function storeAssessResult(sessionID: string, result: AssessResult) {
  evictStale()
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(sessionID, { result, storedAt: Date.now() })
}

export function getAssessResult(sessionID: string): AssessResult | undefined {
  const entry = cache.get(sessionID)
  if (!entry) return undefined
  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(sessionID)
    return undefined
  }
  return entry.result
}

export function clearAssessResult(sessionID: string) {
  cache.delete(sessionID)
}

function evictStale() {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.storedAt > TTL_MS) cache.delete(key)
  }
}
