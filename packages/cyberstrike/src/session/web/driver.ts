// Who is driving the attached browser — the panel's AI/Human toggle, made authoritative
// server-side (§ Phase E). The panel toggle is tab-local in the extension; it POSTs here so
// CyberStrike knows the current driver. Two consumers:
//   1. web_action interlock — while a HUMAN drives, the AI must not act (safety).
//   2. the co-driving loop trigger — AI mode starts the loop, Human mode stops it.
// In-memory, server-lifetime — mirrors page-state.ts / crawl.ts.
export namespace WebDriver {
  export type Driver = "ai" | "human"

  const bySession = new Map<string, Driver>()

  export function set(sessionID: string, driver: Driver): void {
    bySession.set(sessionID, driver === "human" ? "human" : "ai")
  }
  // undefined = the panel never reported a driver yet. Callers decide the default; the
  // interlock treats only an EXPLICIT "human" as "AI must not act", so an unset session
  // (manual tool use, tests) is not blocked.
  export function get(sessionID: string): Driver | undefined {
    return bySession.get(sessionID)
  }
  export function isHuman(sessionID: string): boolean {
    return bySession.get(sessionID) === "human"
  }
  export function isAI(sessionID: string): boolean {
    return bySession.get(sessionID) === "ai"
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
