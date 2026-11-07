// Effect-tracking (U2) — the co-driving loop's memory of what its clicks actually DID.
//
// The deterministic loop records every performed action as "done" (Crawl.acted) so it never
// re-picks it — which is right for a link (you navigated, move on) but wrong for a "Load
// more" / infinite-scroll / paginated control, which reveals NEW content each time and should
// be clicked again. This store closes that gap: after each click the loop reports whether it
// was PRODUCTIVE (revealed new content in place). A productive control is re-admitted as a
// candidate (even though it is "acted") until it stops producing or a hard repeat cap is hit;
// a non-productive ("dead") click is never retried. In-memory, mirrors crawl.ts.
export namespace Effect {
  // Hard ceiling on how many times one control may be re-clicked, so even an endlessly
  // "productive" paginator can't loop forever (budget is the other backstop).
  export const REPEAT_CAP = 8

  interface Entry {
    repeatable: boolean // has ever revealed new content in place
    dead: boolean // a click that changed nothing → stop repeating it
    repeats: number // times clicked (across the whole run)
  }
  const bySession = new Map<string, Map<string, Entry>>()
  function entries(sessionID: string): Map<string, Entry> {
    let m = bySession.get(sessionID)
    if (!m) {
      m = new Map()
      bySession.set(sessionID, m)
    }
    return m
  }

  // Report the outcome of clicking `key`. productive = it revealed new content on the same
  // page (Load-more / expander), so it is worth another try; not productive ends any repeat.
  export function onClick(sessionID: string, key: string, productive: boolean): void {
    const m = entries(sessionID)
    const e = m.get(key) ?? { repeatable: false, dead: false, repeats: 0 }
    e.repeats++
    if (productive) e.repeatable = true
    else e.dead = true
    m.set(key, e)
  }

  // Should an already-acted control be offered again? Only a still-productive one under the cap.
  export function eligible(sessionID: string, key: string): boolean {
    const e = bySession.get(sessionID)?.get(key)
    return !!e && e.repeatable && !e.dead && e.repeats < REPEAT_CAP
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
