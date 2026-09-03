// Registry of the browser child processes CyberStrike spawned per session (the "Add
// credential" role browsers). These are children of THIS server process, so we hold
// their handles and can close them together when the assessment ends — otherwise the
// spawned Chrome-for-Testing windows stay open forever. In-memory, server-lifetime.
export namespace SpawnedProfiles {
  export interface Killable {
    kill(signal?: number | NodeJS.Signals): void
  }

  const bySession = new Map<string, Killable[]>()

  export function track(sessionID: string, proc: Killable): void {
    const arr = bySession.get(sessionID)
    if (arr) arr.push(proc)
    else bySession.set(sessionID, [proc])
  }

  export function count(sessionID: string): number {
    return (bySession.get(sessionID) ?? []).length
  }

  // Kill every spawned profile for a session; returns how many were signalled. The
  // session's entry is cleared afterward so a second call is a no-op (idempotent).
  export function closeAll(sessionID: string): number {
    const arr = bySession.get(sessionID)
    if (!arr) return 0
    let n = 0
    for (const p of arr) {
      try {
        p.kill()
        n++
      } catch {}
    }
    bySession.delete(sessionID)
    return n
  }

  // test-only
  export function _reset(): void {
    bySession.clear()
  }
}
