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
  // Armed once, on the first spawn — so a run that never spawns a browser keeps the plain
  // default signal behaviour.
  //
  // The trap: process.on("exit") fires only when the event loop drains or process.exit() is
  // called — it does NOT fire when the process is killed by a signal. So "exit" alone missed the
  // most common way CyberStrike stops: Ctrl+C. In TUI mode the terminal is in raw mode (ISIG off),
  // so Ctrl+C arrives as a keypress and the TUI exits via process.exit() → "exit" runs; but in
  // `web` / `serve` mode (no TUI, cooked terminal) Ctrl+C is a real SIGINT that nothing handled,
  // so the process died WITHOUT cleanup and left the CfT windows orphaned. SIGHUP (terminal
  // closed) had the same gap.
  //
  // Fix: also handle the terminating signals. Each handler runs the (synchronous) browser kill,
  // then removes itself and RE-RAISES the same signal — so the normal outcome still happens
  // (default disposition terminates the process; any TUI handler that exists runs and shuts down
  // gracefully). Teardown is therefore ADDITIVE: it never changes how the process exits, so it
  // can't corrupt the TUI's raw-terminal restore or hang a headless server.
  //
  // LIMIT: SIGKILL / a hard crash still can't be caught — the browser-side watchdog (self-closes
  // when it can't reach CS, and now survives MV3 service-worker eviction via chrome.alarms) is the
  // stronger, independent guarantee for those.
  let armed = false
  function armExitCleanup(): void {
    if (armed) return
    armed = true
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      try {
        closeAllSessions()
      } catch {}
    }
    process.on("exit", cleanup)
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const handler = () => {
        cleanup()
        process.removeListener(sig, handler)
        process.kill(process.pid, sig) // re-raise: default terminates, or a TUI handler takes over
      }
      process.on(sig, handler)
    }
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
