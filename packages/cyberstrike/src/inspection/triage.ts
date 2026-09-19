// Auto-triage (issue #41). When the inspection queue drains, findings recorded by the specialists sit
// in `draft` — specialists cannot triage. This runner dispatches a dedicated `triage` sub-agent to move
// each draft to its final status (triaged / rejected / duplicate). It is registered as a lifecycle
// activity source, so an assessment does not reach `complete` until triage has run — `complete` then
// means "scanned AND triaged", not just "scanned".
//
// Fail-safe by design: the triage agent leaves anything it cannot confidently rule out as draft, and a
// draft it has already reviewed is never re-triaged (so a deliberately-left draft can't loop). Only a
// NEW draft from later traffic gets a fresh pass.
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Vulnerability } from "@/session/vulnerability"
import { normalizeStatus, VulnStatus } from "@/session/vulnerability-status"
import { withTimeout } from "@/util/timeout"

const log = Log.create({ service: "triage-runner" })
// A single triage dispatch that hasn't finished in this long is treated as hung and cancelled, so it
// can never wedge the lifecycle at "not complete". Generous — triage is a review, not a crawl.
const TRIAGE_TIMEOUT_MS = Math.max(0, Number(process.env.CYBERSTRIKE_TRIAGE_TIMEOUT_MS) || 900_000)

export class TriageRunner {
  private running = false
  private readonly attempted = new Set<string>() // draft ids already handed to a triage pass
  private readonly sessionID: string

  constructor(sessionID: string) {
    this.sessionID = sessionID
  }

  // Fed to the SessionLifecycle: while a triage pass is in flight, the assessment must not settle to
  // "complete". Mirrors the dispatcher's `active` source.
  get active(): boolean {
    return this.running
  }

  // Draft findings not yet handed to a triage pass. (Findings are reported to the root session.)
  private freshDrafts(): Vulnerability.Info[] {
    return Vulnerability.get(this.sessionID).filter(
      (v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT && v.id != null && !this.attempted.has(v.id),
    )
  }

  // Called when the inspection queue has drained. If un-triaged drafts remain, dispatch a triage pass.
  // Idempotent (won't overlap), never throws, and re-arms only for drafts it has NOT already reviewed
  // (so a deliberately-left-draft finding never re-triggers).
  wake(): void {
    if (process.env.CYBERSTRIKE_INGEST_DRY_RUN === "true") return
    if (this.running) return
    const drafts = this.freshDrafts()
    if (drafts.length === 0) return
    this.running = true
    for (const d of drafts) if (d.id) this.attempted.add(d.id)
    void this.run(drafts)
      .catch((e) => log.error("triage pass failed", { sessionID: this.sessionID, err: String(e) }))
      .finally(() => {
        this.running = false
        if (this.freshDrafts().length > 0) this.wake() // a NEW draft landed during triage → another pass
      })
  }

  // protected so tests can substitute the actual agent dispatch (no live LLM).
  protected async run(drafts: Vulnerability.Info[]): Promise<void> {
    const model = await SessionPrompt.lastModel(this.sessionID)
    const child = await Session.create({
      parentID: this.sessionID,
      title: `Triage ${drafts.length} finding${drafts.length === 1 ? "" : "s"}`,
    })
    const parts = await SessionPrompt.resolvePromptParts(buildPrompt(drafts))
    const run = SessionPrompt.prompt({ sessionID: child.id, agent: "triage", model, parts })
    if (TRIAGE_TIMEOUT_MS <= 0) {
      await run
      return
    }
    run.catch(() => {}) // swallow a post-cancel rejection on the orphaned run
    await withTimeout(run, TRIAGE_TIMEOUT_MS, () => {
      log.warn("triage dispatch timed out — cancelling", { child: child.id, sessionID: this.sessionID })
      SessionPrompt.cancel(child.id)
    })
  }
}

function buildPrompt(drafts: Vulnerability.Info[]): string {
  const lines = [
    `The scan is complete. Triage these ${drafts.length} DRAFT finding(s) — set each to its final status with triage_vulnerability. When unsure, leave it as draft (never reject what you cannot confidently rule out).`,
    "",
  ]
  for (const d of drafts) {
    lines.push(`## ${d.id} — [${d.severity}] ${d.title}`)
    if (d.endpoint) lines.push(`Endpoint: ${d.endpoint}`)
    if (d.description) lines.push(d.description.length > 600 ? d.description.slice(0, 600) + "…" : d.description)
    lines.push("")
  }
  return lines.join("\n")
}
