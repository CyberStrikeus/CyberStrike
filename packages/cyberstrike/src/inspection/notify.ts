// Assessment-complete PUSH (#19 follow-up). Subscribes to the SessionLifecycle "complete" phase and
// POSTs a summary to a configured webhook — the real outbound notification (Slack/CI/desktop relay)
// beyond the passive TUI sidebar row. No-op unless CYBERSTRIKE_ASSESSMENT_WEBHOOK is set.
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { Vulnerability } from "@/session/vulnerability"
import { normalizeStatus, VulnStatus } from "@/session/vulnerability-status"
import { SessionLifecycle } from "./lifecycle"
import { getWebInspection } from "./web-bridge"

// Findings still in `draft` at complete — auto-triage (#41) runs before "complete", so any left here are
// ones triage deliberately could not rule out. Surfaced so they never sit un-noticed awaiting review.
function awaitingTriage(sessionID: string): number {
  return Vulnerability.get(sessionID).filter((v) => normalizeStatus(v.status ?? VulnStatus.DRAFT) === VulnStatus.DRAFT).length
}

const log = Log.create({ service: "assessment-notify" })

export interface CompletePayload {
  event: "assessment.complete"
  sessionID: string
  domain: string
  at: string
  endpoints: { examined: number; total: number }
  findings: { total: number; bySeverity: Record<string, number>; awaitingTriage: number }
}

// Pure: shape the notification payload from the queue counts + confirmed findings.
export function buildCompletePayload(
  sessionID: string,
  domain: string,
  counts: { examined: number; total: number },
  findings: { severity: string }[],
  awaitingTriageCount = 0,
  now: number = Date.now(),
): CompletePayload {
  const bySeverity: Record<string, number> = {}
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
  return {
    event: "assessment.complete",
    sessionID,
    domain,
    at: new Date(now).toISOString(),
    endpoints: { examined: counts.examined, total: counts.total },
    findings: { total: findings.length, bySeverity, awaitingTriage: awaitingTriageCount },
  }
}

async function post(url: string, payload: CompletePayload): Promise<void> {
  try {
    await globalThis.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })
    log.info("assessment-complete webhook posted", { sessionID: payload.sessionID, findings: payload.findings.total })
  } catch (e) {
    // Best-effort — a failed notification must never affect the assessment.
    log.warn("assessment webhook POST failed", { err: String(e) })
  }
}

async function notifyComplete(sessionID: string, domain: string): Promise<void> {
  const url = process.env.CYBERSTRIKE_ASSESSMENT_WEBHOOK
  if (!url) return
  const root = Session.root(sessionID)
  const counts = getWebInspection(root).queue.count()
  const findings = Vulnerability.confirmed(root) // child specialists report to the root session
  await post(url, buildCompletePayload(root, domain, counts, findings, awaitingTriage(root)))
}

let subscribed = false
// Idempotent: subscribe ONE process-wide listener that fires the webhook when any session's lifecycle
// reaches "complete". Called from the ingest bootstrap alongside ensureWebInspection.
export function ensureAssessmentNotifier(): void {
  if (subscribed) return
  subscribed = true
  Bus.subscribe(SessionLifecycle.Event.PhaseChanged, (e) => {
    if (e.properties.phase !== "complete") return
    // Phase 1 (#41): never let findings sit in draft silently. Auto-triage has already run; anything
    // still draft is flagged for review so "complete" is never mistaken for "nothing left to do".
    const root = Session.root(e.properties.sessionID)
    const pending = awaitingTriage(root)
    if (pending > 0) log.warn("assessment complete — findings awaiting human triage", { sessionID: root, awaitingTriage: pending })
    void notifyComplete(e.properties.sessionID, e.properties.domain)
  })
}
