// Auto-triage (issue #41, #72). When the inspection queue drains, findings recorded by the specialists
// sit in `draft` — specialists cannot triage. This runner dispatches a dedicated `triage` sub-agent to
// VERIFY each draft by replaying its HTTP evidence, then set it to its final status
// (triaged / rejected / duplicate).
//
// Evidence-based verification (#72): the triage agent receives the full HTTP request/response evidence
// attached to each finding and MUST replay requests via http_replay to independently verify whether the
// response actually demonstrates the claimed vulnerability. Text-only review is not enough — agents
// misinterpret responses (e.g. `deleted:0` read as "bypass worked" when it means "nothing to delete").
//
// Fail-safe by design: the triage agent leaves anything it cannot confidently verify as draft, and a
// draft it has already reviewed is never re-triaged (so a deliberately-left draft can't loop). Only a
// NEW draft from later traffic gets a fresh pass.
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Vulnerability } from "@/session/vulnerability"
import { Request } from "@/session/request"
import { normalizeStatus, VulnStatus, isExcluded } from "@/session/vulnerability-status"
import { withTimeout } from "@/util/timeout"
import { ImpactOracle } from "./impact-oracle"

// For the impact gate: only ever LOWER severity, never raise.
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

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
    void this.pass(drafts)
      .catch((e) => log.error("triage pass failed", { sessionID: this.sessionID, err: String(e) }))
      .finally(() => {
        this.running = false
        if (this.freshDrafts().length > 0) this.wake() // a NEW draft landed during triage → another pass
      })
  }

  // One pass: the LLM agent reviews the drafts, then a DETERMINISTIC finalize guarantees none is left in
  // draft — regardless of what the agent did (or if it failed). `finalize` runs in a `finally` so the
  // guarantee holds even when the dispatch throws or times out.
  private async pass(drafts: Vulnerability.Info[]): Promise<void> {
    try {
      await this.run(drafts)
    } finally {
      this.finalize(drafts)
    }
  }

  // (#72) Unverified drafts stay as draft for human review — auto-promote is gone. The triage agent
  // must explicitly triage or reject each finding based on evidence replay. Findings the agent could
  // not verify remain visible as drafts, which is safer than rubber-stamping them as triaged.
  private finalize(drafts: Vulnerability.Info[]): void {
    this.gateImpact(drafts)
    const byId = new Map(Vulnerability.get(this.sessionID).map((v) => [v.id, v]))
    // A draft the triage agent advanced to "triaged" passed the code-enforced draft→triaged gate (a real
    // http_replay verification token on its evidence) — which IS the "pending_fix" bar: verified as real
    // and reproducible. Nothing else drives triaged→pending_fix, so a verified finding would otherwise
    // sit stuck at "triaged" forever. Auto-promote them here (deterministic; rejected/duplicate/draft
    // are left as the agent set them).
    let promoted = 0
    for (const d of drafts) {
      if (!d.id) continue
      const cur = byId.get(d.id)
      if (cur?.id && normalizeStatus(cur.status ?? VulnStatus.DRAFT) === VulnStatus.TRIAGED) {
        Vulnerability.update({ sessionID: this.sessionID, id: cur.id, status: VulnStatus.PENDING_FIX })
        promoted++
      }
    }
    if (promoted > 0) log.info("promoted replay-verified findings to pending_fix", { sessionID: this.sessionID, count: promoted })
    let remaining = 0
    for (const d of drafts) {
      if (!d.id) continue
      const cur = byId.get(d.id)
      if (cur && normalizeStatus(cur.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT) {
        remaining++
      }
    }
    if (remaining > 0) {
      log.info("triage pass finished with drafts remaining for human review", { sessionID: this.sessionID, count: remaining })
    }
  }

  // Code-enforced impact gate (#90). The DETERMINISTIC half of triage: regardless of what the triage
  // AGENT did (it rubber-stamps under load), re-check every handed finding that currently claims
  // HIGH/CRITICAL against its impact oracle. A finding whose captured evidence does not actually prove
  // the claimed impact (open redirect that stays on-site/IdP, XSS that only reflects, auth with no
  // access differential) is LOWERED to what the evidence supports, with the reason recorded. Only ever
  // lowers severity; proven/unmodeled findings are untouched.
  private gateImpact(drafts: Vulnerability.Info[]): void {
    const byId = new Map(Vulnerability.get(this.sessionID).map((v) => [v.id, v]))
    for (const d of drafts) {
      if (!d.id) continue
      const cur = byId.get(d.id)
      if (!cur || !cur.id) continue
      if (isExcluded(normalizeStatus(cur.status ?? VulnStatus.DRAFT))) continue // rejected/duplicate — leave
      if ((SEV_RANK[cur.severity] ?? 0) < SEV_RANK.medium) continue // gate guards medium+ claims; low/info untouched
      if ((cur.description ?? "").includes("[IMPACT GATE")) continue // already gated this pass
      const v = ImpactOracle.proveImpact(this.sessionID, cur)
      if (v.verdict === "proven" || v.verdict === "unmodeled") continue
      const target = v.severity ?? "low"
      if ((SEV_RANK[target] ?? 0) >= (SEV_RANK[cur.severity] ?? 0)) continue // never raise
      Vulnerability.update({
        sessionID: this.sessionID,
        id: cur.id,
        severity: target,
        description: `${cur.description}\n\n[IMPACT GATE — ${v.verdict}] ${v.reason}`,
      })
      log.info("impact gate lowered finding", { sessionID: this.sessionID, id: cur.id, from: cur.severity, to: target, verdict: v.verdict })
    }
  }

  // protected so tests can substitute the actual agent dispatch (no live LLM).
  protected async run(drafts: Vulnerability.Info[]): Promise<void> {
    const model = await SessionPrompt.lastModel(this.sessionID)
    const child = await Session.create({
      parentID: this.sessionID,
      title: `Triage ${drafts.length} finding${drafts.length === 1 ? "" : "s"}`,
    })
    const parts = await SessionPrompt.resolvePromptParts(buildPrompt(this.sessionID, drafts))
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

function buildPrompt(sessionID: string, drafts: Vulnerability.Info[]): string {
  const lines = [
    `The scan is complete. Verify and triage these ${drafts.length} DRAFT finding(s).`,
    "",
    "VERIFICATION PROTOCOL — you MUST follow this for EVERY finding that has evidence_request_ids:",
    "1. Read the attached HTTP evidence (request + response) below.",
    "2. Use http_replay to REPLAY the request yourself. For authz/IDOR findings, use compare mode (baseline vs exploit).",
    "3. Examine the ACTUAL response — does it PROVE the claimed vulnerability?",
    "   - A 200 status alone is NOT proof. Check if the response body contains the TARGET data.",
    "   - `deleted:0`, empty arrays, generic success messages are NOT evidence of access.",
    "   - Compare against a legitimate request: does the attack response actually differ?",
    "4. Based on YOUR replay results (not the reporting agent's narrative):",
    '   - Verified: triage_vulnerability(id, status: "triaged")',
    '   - False positive: triage_vulnerability(id, status: "rejected", reason: "replay shows [specific observation]")',
    '   - Duplicate: triage_vulnerability(id, status: "duplicate", duplicate_of: "<id>")',
    "",
    "Findings WITHOUT evidence_request_ids: leave as draft — they lack verifiable evidence.",
    "When UNSURE after replay: leave as draft (never reject what you cannot confidently rule out).",
    "",
  ]
  for (const d of drafts) {
    lines.push(`## ${d.id} — [${d.severity}] ${d.title}`)
    if (d.endpoint) lines.push(`Endpoint: ${d.endpoint}`)
    if (d.cwe_id) lines.push(`CWE: ${d.cwe_id}`)
    if (d.description) lines.push(d.description.length > 800 ? d.description.slice(0, 800) + "…" : d.description)
    if (d.poc) {
      const pocPreview = d.poc.length > 1000 ? d.poc.slice(0, 1000) + "…" : d.poc
      lines.push("", "PoC (from reporting agent):", pocPreview)
    }
    const ids = d.evidence_request_ids
    if (ids && ids.length > 0) {
      const reqs = Request.getByIds(sessionID, ids)
      if (reqs.length > 0) {
        lines.push("", "Captured HTTP Evidence:")
        for (const r of reqs) {
          lines.push(Request.formatEvidence(r))
        }
        lines.push(`evidence_request_ids: ${ids.join(", ")}`)
      } else {
        lines.push("", `evidence_request_ids: ${ids.join(", ")} (requests not found in session)`)
      }
    } else {
      lines.push("", "NO evidence_request_ids — cannot replay, leave as draft.")
    }
    lines.push("")
  }
  return lines.join("\n")
}
