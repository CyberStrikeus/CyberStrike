// Wiring for the signal fabric (plan §07, closes B1/B2/B3). Runs the pure detectors
// + canary correlation over a response and persists every signal. Two adapters share
// ONE core (scanObserved): `scanCapturedResponse` for ingest traffic (closes B1 — the
// raw body is scanned BEFORE processResponse stubs an HTML body) and
// `scanElicitedResponse` for http_replay results (closes B2 — evidence an agent
// elicits no longer dies in its context; and closes the replay half of B3 — a marked
// payload is registered as a canary so a later captured render correlates cross-page).
// NEVER throws: detection must not break the ingest or replay paths.
import { runDetectors } from "./detectors"
import { CanaryRegistry, type CanaryKind } from "./canary"
import { DbCanaryStore, SignalStore } from "./store"
import { SignalRouter } from "./router"
import { WebRetest } from "../web-retest"
import type { Header, ObservedResponse, Signal } from "./types"
import type { ReplayResponse } from "@/replay/response"
import { Log } from "@/util/log"

const log = Log.create({ service: "web-signal-ingest" })

export interface CapturedResponse {
  status?: number
  headers?: Record<string, string>
  body?: string
}

// The extension delivers headers as a plain object, so a repeated header (notably
// Set-Cookie) collapses to one entry upstream — a known limitation of the capture
// shape, not introduced here. (Replay results keep the full Header[], see below.)
function recordToHeaders(h?: Record<string, string>): Header[] {
  if (!h) return []
  const out: Header[] = []
  for (const name in h) out.push({ name, value: h[name] })
  return out
}

const router = new SignalRouter()

// Enqueue a re-test so the OWNING specialist confirms a freshly-recorded signal
// (plan §07, closes B4). Only for a signal tied to a REAL request row — a synthetic
// replay id has no row and would violate the retest FK, so those are skipped by the
// `realRequest` gate at the call site. Additionally guarded here so a retest failure
// (e.g. the row was deleted mid-flight) can NEVER undo the signal that was already
// persisted. Enqueue dedups by (session, request) while pending, so many signals on
// one request produce a single retest — the specialist re-reads all of them via context.
function enqueueRetest(sessionID: string, s: Signal): void {
  try {
    WebRetest.enqueue({
      sessionID,
      requestID: s.requestId,
      triggerType: "new_signal",
      triggerSource: `${s.type}:${router.ownerOf(s.type)}`,
      priority: router.priorityOf(s.type),
    })
  } catch (e) {
    log.debug("new_signal retest enqueue failed (ignored)", { err: String(e) })
  }
}

// ── Core: run detectors + canary scan over one response, persist deduped ────────
// Shared by both adapters. Throws propagate to the adapter, which swallows them.
// `realRequest` = the requestId is a persisted request row (safe to retest); false for
// a synthetic replay id (signal is still recorded + surfaced in context, just not queued).
function scanObserved(sessionID: string, res: ObservedResponse, realRequest: boolean): number {
  if (res.body.length === 0 && res.headers.length === 0) return 0
  const canary = new CanaryRegistry(new DbCanaryStore(sessionID))
  const signals = [...runDetectors(res), ...canary.scan({ requestId: res.requestId, url: res.url, body: res.body })]
  if (signals.length === 0) return 0
  const store = new SignalStore(sessionID)
  let recorded = 0
  for (const s of signals) {
    if (store.record(s).deduped) continue // already on record — don't re-route
    recorded++
    if (realRequest) enqueueRetest(sessionID, s)
  }
  return recorded
}

// ── Adapter: captured ingest traffic (B1) ───────────────────────────────────────
export function scanCapturedResponse(input: {
  sessionID: string
  requestId: string
  method: string
  url: string
  response: CapturedResponse | undefined
}): number {
  try {
    const r = input.response
    if (!r) return 0
    // A captured request is always a persisted row (the ingest handler passes req.id or
    // Request.findId, else skips), so its signals are safe to retest.
    return scanObserved(
      input.sessionID,
      {
        requestId: input.requestId,
        url: input.url,
        method: input.method,
        status: r.status ?? 0,
        headers: recordToHeaders(r.headers),
        body: r.body ?? "",
      },
      true,
    )
  } catch (e) {
    log.debug("scanCapturedResponse failed (ignored)", { err: String(e) })
    return 0
  }
}

// A payload marker to register as a canary at replay time, so a later captured page
// that renders it is caught as stored (cross-page) reflection by scanCapturedResponse.
export interface MarkerCanary {
  value: string
  kind?: CanaryKind
  endpoint: string
  field: string
  agent: string
  vulnClass: string
}

// ── Adapter: http_replay-elicited responses (B2 + replay half of B3) ────────────
export function scanElicitedResponse(input: {
  sessionID: string
  requestId: string
  method: string
  url: string
  result: ReplayResponse.Result
  marker?: MarkerCanary
  // True when requestId is a captured request row (params.request_id) — its signals may
  // be retested. False (default) for a constructed target's synthetic id (no row → no retest).
  sourceIsCaptured?: boolean
}): number {
  try {
    // Register the injected marker FIRST — even if this send errored, the payload may
    // have been stored server-side, so a later capture can still render it. Same-site
    // reflection (this very response) is excluded by CanaryRegistry.scan, so this does
    // not self-trigger a stored_reflection here.
    if (input.marker) {
      new CanaryRegistry(new DbCanaryStore(input.sessionID)).register({
        token: input.marker.value,
        kind: input.marker.kind ?? "reflect",
        originRequestId: input.requestId,
        endpoint: input.marker.endpoint,
        field: input.marker.field,
        agent: input.marker.agent,
        vulnClass: input.marker.vulnClass,
      })
    }
    const parsed = input.result.response
    if (!parsed) return 0
    const body = new TextDecoder("latin1").decode(parsed.body)
    return scanObserved(
      input.sessionID,
      {
        requestId: input.requestId,
        url: input.url,
        method: input.method,
        status: parsed.status,
        headers: parsed.headers.map((h) => ({ name: h.name, value: h.value })),
        body,
      },
      input.sourceIsCaptured ?? false,
    )
  } catch (e) {
    log.debug("scanElicitedResponse failed (ignored)", { err: String(e) })
    return 0
  }
}
