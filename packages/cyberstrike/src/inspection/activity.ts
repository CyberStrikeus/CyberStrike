import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Log } from "@/util/log"

const log = Log.create({ service: "inspection-activity" })

// Display-only observability feed for the deterministic inspection pipeline (#81). One event per step —
// a signal routing to its owner, a specialist being dispatched, an endpoint examined — keyed by the ROOT
// sessionID. Streamed to clients by the /event SSE (Bus.subscribeAll), rendered as a live feed in the
// root session so the user can SEE the pipeline working after #78 made the root transcript quiet. It is
// NEVER written to the message transcript, so the orchestrator's LLM context is untouched.
export namespace InspectionActivity {
  export const Event = BusEvent.define(
    "inspection.activity",
    z.object({
      sessionID: z.string(),
      domain: z.string(),
      kind: z.enum(["routed", "dispatched", "examined"]),
      target: z.string(), // the endpoint key (key_hash / target_key)
      label: z.string(), // human endpoint label (method + path)
      agent: z.string().optional(), // owning specialist class (routed) / dispatched agent
      childSessionID: z.string().optional(), // the spawned specialist session (dispatched)
      category: z.string().optional(), // Vortex signal category (routed)
      ruleId: z.string().optional(), // Vortex rule id (routed)
      outcome: z.string().optional(), // examined: "done" | "gave-up"
      at: z.number(),
    }),
  )

  export function emit(input: {
    sessionID: string
    domain: string
    kind: "routed" | "dispatched" | "examined"
    target: string
    label: string
    agent?: string
    childSessionID?: string
    category?: string
    ruleId?: string
    outcome?: string
  }): void {
    try {
      Bus.publish(Event, { ...input, at: Date.now() })
    } catch (e) {
      // Observability must never break the pipeline.
      log.debug("inspection activity emit failed (ignored)", { err: String(e) })
    }
  }
}
