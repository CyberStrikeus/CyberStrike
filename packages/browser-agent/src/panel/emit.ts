import type { Page } from "playwright"
import type { CSEvent } from "../types.ts"

/**
 * Module-level on/off switch for panel emissions. When disabled, csEmit is a
 * cheap no-op (no page.evaluate round-trip). Set once at agent startup from
 * config.panel via setPanelEnabled().
 */
let enabled = true

export function setPanelEnabled(value: boolean): void {
  enabled = value
}

/**
 * Push an event to the injected panel. One-way (agent → panel).
 *
 * Errors are swallowed intentionally: panel is telemetry, never load-bearing.
 * Page may have navigated / closed mid-emit — agent must not crash.
 */
export async function csEmit(page: Page, event: CSEvent): Promise<void> {
  if (!enabled) return
  await page
    .evaluate((e) => {
      const w = window as unknown as { __csEvent?: (e: unknown) => void }
      w.__csEvent?.(e)
    }, event as unknown)
    .catch(() => {})
}
