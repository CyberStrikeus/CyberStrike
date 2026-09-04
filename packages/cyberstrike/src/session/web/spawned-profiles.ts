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
    armExitCleanup() // the first spawn arms the process-teardown safety net
    const arr = bySession.get(sessionID)
    if (arr) arr.push(proc)
    else bySession.set(sessionID, [proc])
  }

  // Safety net so spawned browsers NEVER outlive the server, independent of the graceful
  // per-session path (session close / TUI onExit / /hackbrowser-stop all still call closeAll).
  // Covers: normal exit + process.exit() + a caught crash (via "exit", synchronous), and an
  // external `kill` / system shutdown (via SIGTERM). SIGINT is left to the TUI, whose graceful
  // quit reaches "exit" anyway — we don't hijack Ctrl+C. Armed once, on the first spawn.
  // LIMIT: SIGKILL / a hard crash can't be caught — those can still orphan a window (a browser-
  // side watchdog that self-closes when it can't reach CS is the stronger, separate guarantee).
  let armed = false
  function armExitCleanup(): void {
    if (armed) return
    armed = true
    const cleanup = () => {
      try {
        closeAllSessions()
      } catch {}
    }
    process.on("exit", cleanup)
    process.on("SIGTERM", () => {
      cleanup()
      process.exit(143)
    })
  }

  // Kill every spawned browser across ALL sessions (server teardown). Returns how many.
  export function closeAllSessions(): number {
    let n = 0
    for (const sid of [...bySession.keys()]) n += closeAll(sid)
    return n
  }

  export function count(sessionID: string): number {
    return (bySession.get(sessionID) ?? []).length
  }

  // Kill every spawned profile for a session; returns how many were signalled. The session's entry
  // is cleared afterward so a second call is a no-op (idempotent). Uses SIGKILL (9), not the default
  // SIGTERM: Chrome-for-Testing does NOT reliably die on SIGTERM (see the same note in index.ts about
  // subprocesses ignoring SIGTERM), which left orphaned browser windows after CS exited. These are
  // throwaway testing browsers — a hard kill is correct, no graceful shutdown to preserve.
  export function closeAll(sessionID: string): number {
    const arr = bySession.get(sessionID)
    if (!arr) return 0
    let n = 0
    for (const p of arr) {
      try {
        p.kill(9) // SIGKILL — uncatchable, guarantees the window closes
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
