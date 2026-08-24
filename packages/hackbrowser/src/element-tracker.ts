import type { RawElement } from "./types.ts"
import { Log } from "./log.ts"

const log = Log.create({ service: "hackbrowser:element-tracker" })

// ============================================================
// Element State Tracker
//
// Maintains snapshots of page elements and computes diffs between
// states. Replaces the boolean-only discoverNewElements() with
// rich delta information: what appeared, what disappeared, what
// changed state — giving the LLM planner targeted context instead
// of forcing a full page re-analysis.
// ============================================================

export interface ElementDiff {
  added: RawElement[]
  removed: RawElement[]
  stateChanged: Array<{
    element: RawElement
    changes: string[]
  }>
  hasChanges: boolean
}

export interface ElementTracker {
  snapshot(elements: RawElement[]): void
  diff(newElements: RawElement[]): ElementDiff
  seenKeys(): Set<string>
  addSeenKey(key: string): void
}

function elementKey(el: RawElement): string {
  return `${el.role}::${el.label}`
}

export function createElementTracker(): ElementTracker {
  const seen = new Set<string>()
  let current = new Map<string, RawElement>()

  return {
    snapshot(elements: RawElement[]): void {
      current = new Map<string, RawElement>()
      for (const el of elements) {
        const k = elementKey(el)
        seen.add(k)
        current.set(k, el)
      }
      log.debug("snapshot taken", { elements: elements.length, totalSeen: seen.size })
    },

    diff(newElements: RawElement[]): ElementDiff {
      const added: RawElement[] = []
      const stateChanged: ElementDiff["stateChanged"] = []
      const newMap = new Map<string, RawElement>()

      for (const el of newElements) {
        const k = elementKey(el)
        newMap.set(k, el)

        if (!el.label || !el.selector) continue

        if (!seen.has(k)) {
          if (el.role !== "link") {
            added.push(el)
          }
          seen.add(k)
          continue
        }

        const prev = current.get(k)
        if (prev) {
          const changes: string[] = []
          if (prev.enabled !== el.enabled) {
            changes.push(el.enabled ? "disabled→enabled" : "enabled→disabled")
          }
          if (prev.value !== el.value && el.value) {
            changes.push(`value changed`)
          }
          if (changes.length > 0) {
            stateChanged.push({ element: el, changes })
          }
        }
      }

      const removed: RawElement[] = []
      for (const [k, el] of current) {
        if (!newMap.has(k) && el.label && el.role !== "link") {
          removed.push(el)
        }
      }

      const hasChanges = added.length > 0 || removed.length > 0 || stateChanged.length > 0

      if (hasChanges) {
        log.debug("element diff", {
          added: added.length,
          removed: removed.length,
          stateChanged: stateChanged.length,
        })
      }

      return { added, removed, stateChanged, hasChanges }
    },

    seenKeys(): Set<string> {
      return seen
    },

    addSeenKey(key: string): void {
      seen.add(key)
    },
  }
}

export function formatDeltaForPlanner(diff: ElementDiff): string {
  const parts: string[] = []

  if (diff.added.length > 0) {
    parts.push("NEW elements appeared:")
    for (const el of diff.added.slice(0, 10)) {
      parts.push(`  + [${el.role}] ${el.label}`)
    }
    if (diff.added.length > 10) {
      parts.push(`  ... and ${diff.added.length - 10} more`)
    }
  }

  if (diff.removed.length > 0) {
    parts.push("Elements DISAPPEARED:")
    for (const el of diff.removed.slice(0, 10)) {
      parts.push(`  - [${el.role}] ${el.label}`)
    }
    if (diff.removed.length > 10) {
      parts.push(`  ... and ${diff.removed.length - 10} more`)
    }
  }

  if (diff.stateChanged.length > 0) {
    parts.push("Elements CHANGED state:")
    for (const item of diff.stateChanged.slice(0, 5)) {
      parts.push(`  ~ [${item.element.role}] ${item.element.label}: ${item.changes.join(", ")}`)
    }
  }

  return parts.join("\n")
}
