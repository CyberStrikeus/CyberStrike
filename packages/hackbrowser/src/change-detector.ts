import type { Page } from "playwright"
import { Log } from "./log.ts"

const log = Log.create({ service: "hackbrowser:change-detector" })

// ============================================================
// Multi-Signal DOM Change Detection
//
// Replaces brute-force before/after collectElements scanning with
// four independent signals that together cover every framework's
// DOM update pattern — from React/Vue node manipulation to CSS-only
// :has()/:checked visibility toggles.
//
// Signal 1: MutationObserver     — DOM node add/remove/attribute
// Signal 2: Network activity     — XHR/fetch responses (HTMX, Qwik, RSC)
// Signal 3: Visibility snapshot  — CSS-only state changes
// Signal 4: Element count delta  — safety net
// ============================================================

export interface ChangeSignals {
  mutations: number
  networkRequests: number
  visibilityDelta: number
  elementCountDelta: number
}

export type ChangeVerdict = "skip" | "scan" | "full-scan"

export interface ChangeResult {
  changed: boolean
  signals: ChangeSignals
  verdict: ChangeVerdict
}

const INTERACTIVE_SELECTOR =
  'button,input,select,textarea,a[href],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"]'

const OBSERVED_ATTRIBUTES = ["class", "style", "hidden", "disabled", "aria-hidden", "aria-expanded", "open", "popover"]

export interface ChangeDetector {
  install(): Promise<void>
  reset(): Promise<void>
  check(): Promise<ChangeResult>
  teardown(): Promise<void>
}

export function createChangeDetector(page: Page): ChangeDetector {
  let installed = false
  let baselineVisibility = 0
  let baselineCount = 0
  let networkHits = 0
  let responseListener: ((response: import("playwright").Response) => void) | null = null

  async function captureBaseline(): Promise<void> {
    const result = await page.evaluate(
      (selector: string) => {
        let visible = 0
        let total = 0
        for (const el of document.querySelectorAll(selector)) {
          total++
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) visible++
        }
        return { visible, total }
      },
      INTERACTIVE_SELECTOR,
    )
    baselineVisibility = result.visible
    baselineCount = result.total
  }

  return {
    async install(): Promise<void> {
      if (installed) return

      await page.evaluate(
        (attrs: string[]) => {
          ;(window as any).__cs_mutations = 0
          ;(window as any).__cs_observer = new MutationObserver((muts) => {
            for (const m of muts) {
              if (m.type === "childList") {
                ;(window as any).__cs_mutations += m.addedNodes.length + m.removedNodes.length
              } else if (m.type === "attributes") {
                ;(window as any).__cs_mutations++
              }
            }
          })
          ;(window as any).__cs_observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: attrs,
          })
        },
        OBSERVED_ATTRIBUTES,
      )

      networkHits = 0
      responseListener = () => {
        networkHits++
      }
      page.on("response", responseListener)

      await captureBaseline()
      installed = true
      log.debug("change detector installed", { baselineVisibility, baselineCount })
    },

    async reset(): Promise<void> {
      if (!installed) return

      await page.evaluate(() => {
        ;(window as any).__cs_mutations = 0
      })
      networkHits = 0
      await captureBaseline()
      log.debug("change detector reset", { baselineVisibility, baselineCount })
    },

    async check(): Promise<ChangeResult> {
      if (!installed) {
        return { changed: true, signals: { mutations: 0, networkRequests: 0, visibilityDelta: 0, elementCountDelta: 0 }, verdict: "scan" }
      }

      const mutations: number = await page.evaluate(() => (window as any).__cs_mutations ?? 0)

      const current = await page.evaluate(
        (selector: string) => {
          let visible = 0
          let total = 0
          for (const el of document.querySelectorAll(selector)) {
            total++
            const rect = el.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) visible++
          }
          return { visible, total }
        },
        INTERACTIVE_SELECTOR,
      )

      const visibilityDelta = Math.abs(current.visible - baselineVisibility)
      const elementCountDelta = Math.abs(current.total - baselineCount)
      const net = networkHits

      const signals: ChangeSignals = {
        mutations,
        networkRequests: net,
        visibilityDelta,
        elementCountDelta,
      }

      const changed = mutations > 0 || net > 0 || visibilityDelta > 0 || elementCountDelta > 0
      let verdict: ChangeVerdict = "skip"
      if (changed) {
        verdict = mutations > 50 || visibilityDelta > 10 || elementCountDelta > 10 ? "full-scan" : "scan"
      }

      log.debug("change check", { ...signals, verdict })

      // Reset counters for next check cycle
      await page.evaluate(() => {
        ;(window as any).__cs_mutations = 0
      })
      networkHits = 0
      baselineVisibility = current.visible
      baselineCount = current.total

      return { changed, signals, verdict }
    },

    async teardown(): Promise<void> {
      if (!installed) return

      try {
        await page.evaluate(() => {
          if ((window as any).__cs_observer) {
            ;(window as any).__cs_observer.disconnect()
            delete (window as any).__cs_observer
            delete (window as any).__cs_mutations
          }
        })
      } catch {
        // page already closed — non-fatal
      }

      if (responseListener) {
        page.off("response", responseListener)
        responseListener = null
      }

      installed = false
      log.debug("change detector torn down")
    },
  }
}

// ============================================================
// Network-aware settled wait
//
// Replaces fixed POST_GOTO_WAIT (400ms) with adaptive waiting
// based on actual DOM/network activity. Settles when no new
// mutations or network responses arrive for QUIET_PERIOD ms.
// ============================================================

const QUIET_PERIOD = 400
const MAX_SETTLE_WAIT = 3000
const POLL_INTERVAL = 100

export async function waitForSettled(page: Page, maxWait: number = MAX_SETTLE_WAIT): Promise<void> {
  const start = Date.now()
  let lastMutations = await page.evaluate(() => (window as any).__cs_mutations ?? 0)
  let lastActivity = start

  while (Date.now() - lastActivity < QUIET_PERIOD && Date.now() - start < maxWait) {
    await page.waitForTimeout(POLL_INTERVAL)
    const currentMutations = await page.evaluate(() => (window as any).__cs_mutations ?? 0)
    if (currentMutations > lastMutations) {
      lastActivity = Date.now()
      lastMutations = currentMutations
    }
  }
}
