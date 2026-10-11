// Root-assessment WAKE watchdog.
//
// The root agent/session can fall idle MID-assessment — most often not because the work is done, but on
// a transient provider warning or rate-limit: `processor.ts` (isProviderWarning) sets the session `idle`
// and returns "stop" with no retry left. When that happens nothing re-triggers the pipeline, so:
//   - the inspection phase stays "inspecting" forever (a source never settles / no new traffic),
//   - draft findings never get a final pass,
//   - a human-driven HackBrowser window sits motionless,
// yet the agent, asked later, says it "finished". The `session.idle` bus event already fires on every
// idle but had NO subscriber — the wake hook was sitting unused.
//
// This supervisor consumes that event and, when a ROOT assessment session goes idle with work still
// pending, re-drives it:
//   1. deterministically FIRST — re-wake the engine runners (dispatcher/triage/escalation). No LLM, no
//      tokens; this alone restarts a stalled drain/triage/hunt and lets the phase settle.
//   2. only if methodology coverage is genuinely incomplete (MethodologyContext.shouldForceContinue,
//      which was dead code until now), re-prompt the root model with its specific directive.
//
// Bounded + progress-gated so it can never tight-loop or burn the token budget: progress (more endpoints
// examined / more findings / drafts finalized) earns another wake; two consecutive wakes with NO
// measurable progress stop it, and it posts a VISIBLE notice into the root session (the phase was only
// ever shown at the bottom of the sidebar) explaining why it paused and how to resume.
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { SessionPrompt } from "@/session/prompt"
import { Vulnerability } from "@/session/vulnerability"
import { normalizeStatus, VulnStatus } from "@/session/vulnerability-status"
import { HackbrowserStatus } from "@/session/hackbrowser-status"
import { MethodologyContext } from "@/methodology/context"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import type { MessageV2 } from "@/session/message-v2"
import { SessionLifecycle } from "./lifecycle"
import { peekWebInspection, type WebInspection } from "./web-bridge"

const log = Log.create({ service: "assessment-watchdog" })

// Let a flapping status settle and the engine spin up before we judge "stalled".
const DEBOUNCE_MS = Math.max(0, Number(process.env.CYBERSTRIKE_WATCHDOG_DEBOUNCE_MS) || 4_000)
// When the engine is still working, re-check later instead of fighting it (no idle event fires while it
// runs in the background, so we poll).
const RECHECK_MS = Math.max(1_000, Number(process.env.CYBERSTRIKE_WATCHDOG_RECHECK_MS) || 15_000)
// Consecutive no-progress wakes before we give up and surface a paused notice.
const MAX_STALL = 2
// Absolute backstop against a fingerprint that oscillates but never completes.
const MAX_WAKES = 8

type Watch = {
  timer?: ReturnType<typeof setTimeout>
  wakes: number
  stall: number
  fingerprint: string
}
const watches = new Map<string, Watch>()
// Sessions that have completed at least once → the fingerprint of the last completion notice posted.
// Presence gates one-time orphan-browser cleanup (we never auto-close a browser the user relaunched to
// continue a finished scan); the value dedups the "Scan complete" banner so it is not re-posted
// unchanged on later idle turns or user-driven resume rounds (#104).
const completed = new Map<string, string>()

function drafts(sessionID: string): number {
  return Vulnerability.get(sessionID).filter(
    (v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT,
  ).length
}

// vortex-bridge is imported dynamically (web-bridge does the same) to keep the inspection → vortex-bridge
// → web-inspect → web-bridge dependency one-way and avoid an init-time cycle.
function vortex() {
  return import("@/session/web/vortex-bridge")
}

// Cheap signal of forward motion: endpoints examined + total findings + finalized (non-draft) findings
// + Vortex signals reviewed / still new. If none of these move between two wakes, nothing is progressing.
function fingerprint(sessionID: string, inst: WebInspection, sig: { new: number; reviewed: number }): string {
  const counts = inst.queue.count()
  const vulns = Vulnerability.get(sessionID)
  const finalized = vulns.length - drafts(sessionID)
  return `${counts.examined}/${counts.total}:${vulns.length}:${finalized}:${sig.new}:${sig.reviewed}`
}

// Post a VISIBLE message into the root transcript — no LLM. Mirrors InspectionTranscript's shape so the
// TUI/web render it as a normal assistant line. Returns whether the post succeeded: a terminal branch
// only retires the watch when this is true, so a failed post is retried on the next poll instead of
// silently swallowed (the completion message must NEVER go missing).
async function notice(sessionID: string, text: string): Promise<boolean> {
  try {
    const msgs = await Session.messages({ sessionID })
    const lastUser = [...msgs].reverse().find((m) => m.info.role === "user")?.info
    const agent = (await SessionPrompt.lastAgent(sessionID)) ?? "cyberstrike"
    // Use the session's real resolved model id/provider (like InspectionTranscript does) so the message
    // renders as a normal assistant line — a fake providerID can break a downstream provider lookup and
    // silently drop the message, which must never happen for the completion notice.
    const model = await SessionPrompt.lastModel(sessionID)
    const assistant = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: lastUser?.id ?? sessionID,
      sessionID,
      mode: agent,
      agent,
      path: { cwd: Instance.directory, root: Instance.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now(), completed: Date.now() },
    })) as MessageV2.Assistant
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistant.id,
      sessionID,
      type: "text",
      synthetic: true,
      text,
      time: { start: Date.now(), end: Date.now() },
    })
    return true
  } catch (e) {
    log.warn("watchdog notice failed — will retry on next poll", { sessionID, err: String(e) })
    return false
  }
}

async function reprompt(sessionID: string, directive: string): Promise<void> {
  const model = await SessionPrompt.lastModel(sessionID)
  const agent = await SessionPrompt.lastAgent(sessionID)
  await SessionPrompt.prompt({
    sessionID,
    model,
    agent,
    parts: [{ type: "text", text: `[auto-resume] The assessment is not complete.\n\n${directive}` }],
  })
}

function schedule(root: string, delay: number): void {
  const w = watches.get(root)
  if (!w) return
  if (w.timer) clearTimeout(w.timer)
  w.timer = setTimeout(() => {
    // A thrown evaluate must NEVER break the poll chain (that was a "goes dormant" failure mode): on any
    // error, reschedule so the watch keeps polling until it posts a terminal message.
    evaluate(root).catch((e) => {
      log.warn("watchdog evaluate threw — rescheduling", { sessionID: root, err: String(e) })
      schedule(root, RECHECK_MS)
    })
  }, delay)
}

async function evaluate(root: string): Promise<void> {
  const w = watches.get(root)
  if (!w) return
  w.timer = undefined

  const inst = peekWebInspection(root)
  if (!inst || !inst.started) {
    watches.delete(root)
    completed.delete(root)
    return
  }

  // Root still working (busy/retry) → poll again later. Never go dormant: a watch keeps polling until it
  // posts a terminal message, so we never silently "stay idle".
  if (SessionStatus.get(root).type !== "idle") {
    schedule(root, RECHECK_MS)
    return
  }

  // LIVE truth — the cached `lifecycle.phase` can be stale (it stops updating after a "complete"), so the
  // watchdog decides from the live source activity + queue counts instead. The phase string can never
  // fool it into declaring done.
  const snap = inst.lifecycle.snapshot()
  const active = (name: string) => snap.sources.some((s) => s.active && s.name === name)
  // ENGINE activity = the work-producing sources (specialist/triage/escalation/ingest/api-probe/js-miner),
  // NOT the completion gates (gate:*). While the engine runs it fires no idle, so just poll and wait.
  const engineActive = snap.sources.some((s) => s.active && !s.name.startsWith("gate:"))
  if (engineActive) {
    schedule(root, RECHECK_MS)
    return
  }

  const vb = await vortex()
  const sum = vb.vortexSignalSummary(root)
  const sig = sum.triage
  const signalsPending = sig.new > 0
  const draftsPending = active("gate:drafts")
  const llmTroubled = active("gate:llm")
  const fc = MethodologyContext.shouldForceContinue(root)

  // GENUINELY done — the user's four hard gates ALL clear: no agent/traffic active, queue drained, every
  // Vortex signal reviewed, NO draft findings, methodology satisfied, and the LLM reachable. This is the
  // ONLY path that declares "complete" and it mirrors the lifecycle's own gate sources, so "shows
  // complete but isn't" cannot happen.
  if (snap.counts.pending === 0 && !signalsPending && !draftsPending && !fc.force && !llmTroubled) {
    const vulns = Vulnerability.get(root)
    const by = (s: string) => vulns.filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === s).length
    const left = by(VulnStatus.DRAFT)

    // Orphan-browser cleanup is a ONE-TIME courtesy on the first completion: the AI crawl's window is
    // nobody's once the assessment ends, so close it. After that we NEVER auto-close again — a browser
    // the user relaunched to continue/extend a finished scan is user-driven, not an orphan (#104).
    const firstCompletion = !completed.has(root)
    if (firstCompletion) {
      try {
        const hb = HackbrowserStatus.get(root)
        if (hb && (hb.phase === "starting" || hb.phase === "crawling")) {
          const m = await import("@/tool/hackbrowser-launcher")
          if (!m.stopHackbrowser(root)) HackbrowserStatus.set(root, { ...hb, phase: "completed", finishedAt: Date.now() })
        }
      } catch (e) {
        log.debug("hackbrowser reconcile failed (ignored)", { sessionID: root, err: String(e) })
      }
    }

    // Dedup the banner: only (re)announce when the completion state actually changed since we last
    // posted it. An idle turn over an unchanged completed assessment — the user chatting while deciding
    // what to test next — stays quiet instead of re-spamming "Scan complete"; a resume round that finds
    // something new re-announces with the updated tally (#104).
    const doneFp = `${snap.counts.examined}/${snap.counts.total}:${sum.total}:${sig.reviewed}:${sig.confirmed}:${vulns.length}:${left}`
    if (completed.get(root) === doneFp) {
      watches.delete(root)
      return
    }

    const lines = [
      `✅ Scan complete — the assessment has finished. Sub-agents are done, no new traffic is being inspected, and all Vortex signals have been reviewed.`,
      ``,
      `• Endpoints examined: ${snap.counts.examined}/${snap.counts.total}`,
      `• Vortex signals: ${sig.reviewed} reviewed, ${sig.confirmed} confirmed (${sum.total} total)`,
      `• Findings: ${by(VulnStatus.PENDING_FIX)} pending fix, ${by(VulnStatus.TRIAGED)} triaged, ${left} draft, ${by(VulnStatus.REJECTED)} rejected, ${by(VulnStatus.DUPLICATE)} duplicate`,
    ]
    if (left > 0)
      lines.push(``, `⚠️ ${left} finding(s) remain as DRAFT — auto-triage could not confidently verify them and left them for your review.`)
    // "Complete" is a resting state, not a dead end: tell the user how to extend it. Logging in again or
    // reopening a browser feeds fresh traffic and testing resumes automatically — no restart needed (#104).
    lines.push(
      ``,
      `💡 Done for now, but you can keep testing: log in again or run /hackbrowser to open a browser — new traffic (and a refreshed token) resumes the assessment automatically.`,
    )
    if (!(await notice(root, lines.join("\n")))) {
      schedule(root, RECHECK_MS) // post failed → retry, never lose the completion message
      return
    }
    log.info("assessment complete notice posted to root session", { sessionID: root, examined: snap.counts.examined, drafts: left })
    completed.set(root, doneFp)
    watches.delete(root)
    return
  }

  // Not done + nothing active = wedged work the engine isn't moving (drained queue not dispatched,
  // unroutable signals, or methodology incomplete). Progress-gate before acting.
  const fp = fingerprint(root, inst, sig)
  if (fp === w.fingerprint) w.stall++
  else {
    w.fingerprint = fp
    w.stall = 0
    w.wakes = 0 // progress earns a fresh budget
  }

  if (w.stall >= MAX_STALL || w.wakes >= MAX_WAKES) {
    const left = drafts(root)
    const reasons: string[] = []
    if (llmTroubled) reasons.push(`the model is unreachable (provider/rate-limit)`)
    if (snap.counts.pending > 0) reasons.push(`${snap.counts.pending} endpoint(s) still queued`)
    if (signalsPending) reasons.push(`${sig.new} Vortex signal(s) could not be auto-reviewed`)
    if (left > 0) reasons.push(`${left} finding(s) in draft need your review`)
    if (fc.force) reasons.push(`methodology coverage incomplete`)
    const ok = await notice(
      root,
      `⏸️ Scan NOT complete — no further automated progress. Outstanding: ${reasons.join("; ") || "unknown"}. Resolve or send a message to resume.`,
    )
    if (!ok) {
      schedule(root, RECHECK_MS) // post failed → retry, never leave it silently paused
      return
    }
    watches.delete(root)
    return
  }

  w.wakes++
  log.info("waking stalled assessment", { sessionID: root, pending: snap.counts.pending, wakes: w.wakes, force: fc.force, signalsNew: sig.new, drafts: draftsPending, llm: llmTroubled })

  // The model is unreachable → do NOT drive LLM-dependent work (triage sub-agent / re-prompt / specialist
  // dispatch), which would just fail. Hold; the progress-gate above will pause with a clear "model
  // unreachable" reason if it stays down, so we never falsely complete nor hammer a dead provider.
  if (!llmTroubled) {
    // 1. Route unreviewed Vortex signals into the queue so a specialist examines them (→ "reviewed").
    if (signalsPending) {
      try {
        const routed = vb.routeAllSignals(root)
        log.info("routed unreviewed signals", { sessionID: root, flagged: routed.flagged, skipped: routed.skipped })
      } catch (e) {
        log.debug("routeAllSignals failed (ignored)", { sessionID: root, err: String(e) })
      }
    }
    // 2. Deterministic engine re-drive + re-triage any drafts.
    inst.dispatcher.wake()
    inst.triage.wake()
    inst.escalation.wake()
    // 3. LLM re-prompt only when methodology says there is actionable orchestration work.
    if (fc.force) {
      await reprompt(root, fc.directive).catch((e) => log.warn("watchdog reprompt failed", { sessionID: root, err: String(e) }))
    }
  }

  // ALWAYS keep polling until a terminal (complete/paused) message is posted — never rely solely on a
  // future idle event to re-arm us.
  schedule(root, RECHECK_MS)
}

// Arm (or re-arm) the watch for a root and schedule an evaluation. Idempotent per root. Once a watch
// exists, evaluate() reschedules itself (RECHECK) on every non-terminal path, so the assessment is
// polled relentlessly until it posts a terminal (complete/paused) message — it can never silently stop.
function arm(root: string): void {
  const inst = peekWebInspection(root)
  if (!inst || !inst.started) return // not an active assessment
  if (!watches.has(root)) watches.set(root, { wakes: 0, stall: 0, fingerprint: "" })
  schedule(root, DEBOUNCE_MS)
}

// The GUARANTEE entry point: called from the ingest bootstrap on every traffic ingest. Because an
// assessment cannot exist without ingesting traffic, this arms the watch independently of any event
// (root idle / phase change) ever firing — the trigger-gap that let an engine-driven assessment finish
// with nobody watching. Resolves the tree root first so a sub-agent ingest still arms the root's watch.
export function armWatchdog(sessionID: string): void {
  arm(Session.root(sessionID))
}

let subscribed = false
// Idempotent: subscribe the process-wide listeners. Called from the ingest bootstrap alongside
// ensureWebInspection / ensureAssessmentNotifier.
export function ensureWatchdog(): void {
  if (subscribed) return
  subscribed = true
  log.info("assessment watchdog subscribed")

  // Trigger 1 — root LLM fell idle (e.g. a provider warning / rate-limit stall mid-run). Covers the case
  // where the ROOT agent stops; may never fire if the assessment is driven purely by the background
  // engine (sub-agents) without a root turn — which is exactly why Trigger 2 exists.
  Bus.subscribe(SessionStatus.Event.Idle, (e) => {
    const root = Session.root(e.properties.sessionID)
    if (root !== e.properties.sessionID) return // child (triage/escalation/specialist) session → ignore
    arm(root)
  })

  // Trigger 2 — the inspection lifecycle settled to "complete". This is the authoritative "the engine
  // stopped" signal and fires independently of the root LLM, so late escalation findings / unreviewed
  // Vortex signals left behind when the engine settles get caught here. evaluate() then re-drives
  // (route signals, wake triage) or, when genuinely done, posts the completion notice.
  Bus.subscribe(SessionLifecycle.Event.PhaseChanged, (e) => {
    if (e.properties.phase !== "complete") return
    arm(Session.root(e.properties.sessionID))
  })
}
