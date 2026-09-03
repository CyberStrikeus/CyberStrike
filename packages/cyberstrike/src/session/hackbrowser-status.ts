// Live hackbrowser status — drives the TUI sidebar's "Hackbrowser" section
// (Faz B.2 / INTEGRATION.md §13). Mirrors the SessionQueueStatus pattern:
// per-session state map, Bus event for SSE streaming, and a Zod-typed
// shape so the SDK regenerator can turn it into a TypeScript interface
// for the TUI sync store automatically.
//
// Decision recap (INTEGRATION.md §13.1):
//   1. Failure -> synthetic session message (LLM sees error in next turn)
//   2. Success -> sidebar only (no synthetic message; avoids LLM polling)
//   4. State cleanup: a new run overwrites; no manual clear required
//
// State storage: in-memory via Instance.state. Persistence is intentional
// "snapshot of right now" — captures, web functions, vulnerabilities all
// already live in the DB; this surface is purely UI-state. Restart resets,
// which is the correct behavior because dangling crawl runs are gone too.

import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "hackbrowser-status" })

export namespace HackbrowserStatus {
  export const Phase = z.enum(["starting", "crawling", "completed", "failed"]).meta({
    ref: "HackbrowserPhase",
  })
  export type Phase = z.infer<typeof Phase>

  export const Info = z
    .object({
      sessionID: z.string(),
      phase: Phase,
      targetUrl: z.string(),
      pagesExplored: z.number().int().min(0),
      capturedEndpoints: z.number().int().min(0),
      currentPage: z.string().optional(),
      errors: z.array(z.string()),
      startedAt: z.number().int(),
      finishedAt: z.number().int().optional(),
      cost: z.number().optional(),
    })
    .meta({
      ref: "HackbrowserStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.hackbrowser.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
  }

  // Per-session map. Reset on cyberstrike restart by virtue of Instance.state
  // — dangling background runners are also gone, so clean slate is correct.
  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  /**
   * Return the current status for a session, or undefined if no run has
   * been started for it. (Differs from SessionQueueStatus.get which
   * synthesizes a default — for hackbrowser we want the sidebar to know
   * "no run yet" vs "run in progress".)
   */
  export function get(sessionID: string): Info | undefined {
    return state()[sessionID]
  }

  /** All entries, keyed by sessionID. Used by the bootstrap GET route. */
  export function list(): Record<string, Info> {
    return state()
  }

  /**
   * Atomic write + publish. Callers compose new state from a previous
   * Info via `get()` then call `set()` with the merged object — e.g. the
   * launcher's crawling/completed branches.
   */
  export function set(sessionID: string, status: Info) {
    state()[sessionID] = status
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
  }

}
