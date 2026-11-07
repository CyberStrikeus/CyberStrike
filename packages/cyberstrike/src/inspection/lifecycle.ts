import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import type { ActivitySource, SessionPhase } from "@cyberstrike-io/plugin"
import { InspectionQueue } from "./queue"

const log = Log.create({ service: "session-lifecycle" })

const PhaseSchema = z.enum(["idle", "discovering", "inspecting", "draining", "complete"])

const PhaseChangedEvent = BusEvent.define(
  "session.phase",
  z.object({
    sessionID: z.string(),
    domain: z.string(),
    phase: PhaseSchema,
    previous: PhaseSchema,
  }),
)

export class SessionLifecycle {
  readonly sessionID: string
  readonly domain: string
  private readonly queue: InspectionQueue
  private readonly sources: ActivitySource[] = []
  private current: SessionPhase = "idle"
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private intervalMs = 2000

  static readonly Event = { PhaseChanged: PhaseChangedEvent }

  constructor(sessionID: string, domain: string, queue: InspectionQueue) {
    this.sessionID = sessionID
    this.domain = domain
    this.queue = queue
  }

  get phase(): SessionPhase {
    return this.current
  }

  addSource(source: ActivitySource): void {
    // Idempotent by name — the ingest bootstrap re-registers on every hit; keep one per name.
    if (this.sources.some((s) => s.name === source.name)) return
    this.sources.push(source)
  }

  removeSource(name: string): void {
    const idx = this.sources.findIndex((s) => s.name === name)
    if (idx >= 0) this.sources.splice(idx, 1)
  }

  start(intervalMs = 2000): void {
    if (this.pollTimer) return
    this.intervalMs = intervalMs
    this.pollTimer = setInterval(() => this.tick(), this.intervalMs)
    Bus.subscribe(InspectionQueue.Event.Updated, (e) => {
      if (e.properties.sessionID === this.sessionID && e.properties.domain === this.domain) {
        this.tick()
      }
    })
    this.tick()
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // Re-arm the heartbeat and re-derive the phase NOW. Called on fresh ingest/traffic. A source
  // (ingest/api-probe/js-miner) can flip BACK to active after the phase already settled to "complete" —
  // which stops the poll (line below) — and those silent sources emit NO queue event, so nothing would
  // ever re-derive. Without this the phase stays a stale "complete" while the browser is in fact still
  // crawling/probing a new target (the "phase lies" bug). poke() restarts the heartbeat so the eventual
  // settle is caught again; no-op cost when nothing changed (tick early-returns on an unchanged phase).
  poke(): void {
    this.ensurePoll()
    this.tick()
  }

  // Re-arm the heartbeat if it isn't running. The poll is what turns silent state changes — a source
  // (dispatcher/triage/miner/probe) flipping back to inactive with NO queue event — into a phase
  // transition. It is stopped on "complete" (idle sessions must not poll forever; destroy is not
  // reliably called), so any transition BACK into an active phase must restart it, or the lifecycle
  // could never re-derive "complete" and would stick at "inspecting" (#43). The subscription set up in
  // start() persists across stop(), so we only re-arm the timer here.
  private ensurePoll(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.tick(), this.intervalMs)
  }

  private tick(): void {
    const next = this.derive()
    if (next === this.current) return
    const previous = this.current
    this.current = next
    log.info("phase transition", { sessionID: this.sessionID, domain: this.domain, from: previous, to: next })
    Bus.publish(SessionLifecycle.Event.PhaseChanged, {
      sessionID: this.sessionID,
      domain: this.domain,
      phase: next,
      previous,
    })
    // "complete" is terminal for the poll (stop the heartbeat so an idle session costs nothing), but NOT
    // terminal for the session: late traffic can pull the phase back into activity. Any transition into a
    // non-complete phase re-arms the poll so the eventual silent settle back to "complete" is caught (#43).
    if (next === "complete") this.stop()
    else this.ensurePoll()
  }

  private derive(): SessionPhase {
    const anySourceActive = this.sources.some((s) => s.isActive())
    const counts = this.queue.count()

    if (counts.total === 0 && !anySourceActive) return "idle"
    if (counts.total === 0 && anySourceActive) return "discovering"
    if (counts.pending > 0 && anySourceActive) return "inspecting"
    if (counts.pending > 0 && !anySourceActive) return "draining"
    if (counts.pending === 0 && !anySourceActive) return "complete"

    return "inspecting"
  }

  snapshot(): { phase: SessionPhase; sources: { name: string; active: boolean }[]; counts: { pending: number; examined: number; total: number } } {
    return {
      phase: this.current,
      sources: this.sources.map((s) => ({ name: s.name, active: s.isActive() })),
      counts: this.queue.count(),
    }
  }
}
