// CoDrive — the session-lifecycle runner the /web/driver route drives (design §2.3). It owns the
// start/stop machinery that the route needs but the CoDriveSession orchestrator deliberately does
// not: a per-session generation guard so a fast Human→AI→Human re-toggle can never double-run a
// loop, and a cancel signal wired to `stop()`. The loop's actual behavior lives in CoDriveSession;
// this only manages its lifetime. Replaces WebCoDrive.start/stop (retired in P3).
import { CoDriveSession } from "./co-drive-session"
import { HBLog } from "../hblog"
import { Log } from "../../../util/log"

const log = Log.create({ service: "co-drive-runner" })

export namespace CoDrive {
  // sid → running generation. Presence = running; a loop runs only while its captured generation
  // is still the current one, so a re-toggle that stops then starts can never leave two loops live.
  const active = new Map<string, number>()
  let seq = 0

  // Production builds the LLM-brained session per start; tests swap in a deterministic one so the
  // route→runner→session chain is exercised end-to-end without a live model. `start(sid, session)`
  // still takes precedence for direct-injection unit tests.
  const DEFAULT_FACTORY = () => CoDriveSession.withLlm()
  let factory: () => CoDriveSession = DEFAULT_FACTORY
  export function _setFactory(f: (() => CoDriveSession) | null): void {
    factory = f ?? DEFAULT_FACTORY
  }

  export function isRunning(sessionID: string): boolean {
    return active.has(sessionID)
  }

  // Flip to human / stop: drop the generation so the running loop's `alive()` goes false and it
  // ends at the next step boundary. Idempotent.
  export function stop(sessionID: string): void {
    active.delete(sessionID)
  }

  // Flip to AI / start. Idempotent (a second start while running is a no-op). `session` is
  // injectable so tests exercise the lifecycle with a stubbed navigator instead of a live model.
  export function start(sessionID: string, session?: CoDriveSession): void {
    if (active.has(sessionID)) return
    const gen = ++seq
    active.set(sessionID, gen)
    HBLog.record(sessionID, "codrive", "start")
    const s = session ?? factory()
    void s
      .run(sessionID, () => active.get(sessionID) === gen)
      .catch((e) => log.error("co-drive loop crashed", { err: String(e) }))
      .finally(() => {
        // Only clear if we're still the current generation — a newer start must not be wiped.
        if (active.get(sessionID) === gen) active.delete(sessionID)
      })
  }

  export function _reset(): void {
    active.clear()
    factory = DEFAULT_FACTORY
  }
}
