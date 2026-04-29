import type { Page } from "playwright"
import type { CSEvent } from "../types.ts"

/**
 * Module-level on/off switch for panel emissions. When disabled, csEmit
 * skips the page.evaluate round-trip. Set once at agent startup from
 * config.panel via setPanelEnabled().
 *
 * Note: this only gates the BROWSER panel sink (page.evaluate). The
 * eventSink callback (cyberstrike-side telemetry) runs independently
 * and is unaffected by this flag — when set, it always receives events
 * regardless of the panel switch. This separation lets headless tool
 * runs feed status updates to the TUI sidebar without injecting any
 * browser-side panel.
 */
let enabled = true

export function setPanelEnabled(value: boolean): void {
  enabled = value
}

/**
 * Module-level event sink. Cyberstrike's hackbrowser-launcher registers
 * a callback here so every CSEvent is forwarded into HackbrowserStatus
 * (Faz B.1+ — INTEGRATION.md §13.2).
 *
 * Why module-level state (vs prop-drilling through every emit site):
 *   - Same pattern as `enabled` above and the LogSink in `log.ts`
 *   - Single-instance assumption: one runCrawl per process at a time
 *     (multi-tenant concurrency is YAGNI; LogSink agreed the same)
 *   - Avoids changing csEmit's signature, which is called from ~7 sites
 *     across agent.ts/scanner/executor — keeps the touch surface tight
 *
 * Multi-instance/concurrent-runCrawl story would need an instance-bound
 * sink. Documented as a known constraint, deferred until measured.
 */
let eventSink: ((event: CSEvent) => void) | null = null

export function setEventSink(sink: (event: CSEvent) => void): void {
  eventSink = sink
}

export function clearEventSink(): void {
  eventSink = null
}

/**
 * Push an event to BOTH the injected browser panel AND the cyberstrike
 * event sink (when registered). Two independent channels:
 *
 *   browser panel  → window.__csEvent (Shadow DOM live telemetry)
 *   eventSink      → cyberstrike HackbrowserStatus (TUI sidebar)
 *
 * Errors are swallowed in both channels: telemetry must never be load-
 * bearing. The browser page may have navigated/closed mid-emit; the
 * cyberstrike sink might throw on Bus.publish. Neither should crash the
 * agent. Sink throws are logged so debug is possible without coupling.
 */
export async function csEmit(page: Page, event: CSEvent): Promise<void> {
  // Cyberstrike sink — synchronous, runs first so the TUI sidebar gets
  // the update even if the browser-side emit is slow. Always evaluated
  // when registered (independent of the `enabled` panel switch).
  if (eventSink) {
    try {
      eventSink(event)
    } catch (err) {
      // Don't import Log here — would create a circular dep with log.ts
      // for telemetry that isn't load-bearing. console.error is enough
      // for the rare case a sink throws.
      console.error("[hackbrowser:emit] eventSink threw, swallowing:", err)
    }
  }

  // Browser panel — async via page.evaluate, gated by setPanelEnabled().
  if (!enabled) return
  await page
    .evaluate((e) => {
      const w = window as unknown as { __csEvent?: (e: unknown) => void }
      w.__csEvent?.(e)
    }, event as unknown)
    .catch(() => {})
}
