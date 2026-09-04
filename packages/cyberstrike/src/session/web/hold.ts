// Transient co-driving PAUSE — distinct from the AI/Human driver toggle. The autonomous loop
// navigates full-page constantly, and each navigation destroys + re-injects the content-script
// panel, so a user reaching for the panel's controls can't click before the page changes under
// them. While the user is engaging the panel (hover / settings open), the extension sets this
// hold; the co-drive loop then WAITS (non-terminal — it does not act, does not navigate) so the
// page stays put and the panel is stable. Cleared on mouse-leave → the loop resumes on its own.
// The driver stays "ai" throughout (this is a pause, not a takeover).
export namespace WebHold {
  const bySession = new Map<string, boolean>()

  export function set(sessionID: string, held: boolean): void {
    if (held) bySession.set(sessionID, true)
    else bySession.delete(sessionID)
  }
  export function held(sessionID: string): boolean {
    return bySession.get(sessionID) === true
  }
  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
  }
}
