// CRLF / HTTP response-splitting probe (part of WSTG-INPV-15 / header injection). Injects a CR-LF
// followed by an arbitrary header into a parameter that may be reflected into a RESPONSE header
// (redirect Location, Set-Cookie, custom headers), then checks whether that header actually appears in
// the response — the deterministic proof of header injection. Only value-carrying locations that get
// re-encoded on the wire and decoded server-side (query/form/json/path); header/cookie points are
// skipped because our own mutate layer strips CR-LF from those before sending (so they'd never test
// the server). Deterministic LEAD: the agent escalates (Set-Cookie fixation, cache poisoning, XSS via
// injected Content-Type) and confirms.
import type { ResolvedRequest, InjPoint, SendBudget } from "../types"
import { applyPayload } from "../mutate"
import { send, nonce, type HttpSender } from "../send"
import { looksBlocked } from "../detect"
import { type BackoffState, recordBlock, recordSuccess } from "./base"

export interface CrlfObservation {
  point: string
  injected_header: boolean // our header (or its marker) appeared in the response headers = CRLF injection
  header_name?: string
  set_cookie_injected?: boolean // marker landed in Set-Cookie — session-fixation surface
  evidence?: string
  blocked: boolean
  block_signal?: string
  note?: string
}

export const CRLF_NOT_TESTED: string[] = [
  "crlf: multi-line / double-encoded splitting variants",
  "crlf: response-BODY splitting (injection past the header block)",
  "crlf: header/cookie source points (self-sanitized before send)",
]

const APPLICABLE = new Set(["query", "form_field", "json_body", "path"])

export async function probeCrlfPoint(
  sender: HttpSender,
  r: ResolvedRequest,
  point: InjPoint,
  abort: AbortSignal,
  _delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<CrlfObservation> {
  const obs: CrlfObservation = { point: `${point.location}:${point.name}`, injected_header: false, blocked: false }
  if (!APPLICABLE.has(point.location)) {
    obs.note = `${point.location} values are CR-LF-sanitized before send — CRLF is tested on query/form/json/path`
    return obs
  }
  if (abort.aborted || budget.sent >= budget.max) return obs

  const marker = "crlf" + nonce()
  // Inject a Set-Cookie line: it's the highest-impact CR-LF sink AND survives the response-header
  // allowlist (an arbitrary custom header would be filtered out before we could observe it). A leading
  // value keeps the original param shape valid, then CR-LF starts a new header line.
  const payload = `1\r\nSet-Cookie: ${marker}=1`
  const res = await send(sender, r, applyPayload(r, point, payload), abort, budget)
  if ("error" in res) {
    obs.note = res.error
    return obs
  }
  if (looksBlocked(res.status)) {
    obs.blocked = true
    obs.block_signal = `blocked (status ${res.status})`
    if (backoff) recordBlock(backoff)
    return obs
  }
  if (backoff) recordSuccess(backoff)
  // Our unique marker surfacing in ANY response header = the CR-LF split took and the app emitted the
  // header we injected. Header names are the kept allowlist (Set-Cookie / Location / Content-Type / …).
  for (const [k, v] of Object.entries(res.headers)) {
    if (v.includes(marker)) {
      obs.injected_header = true
      obs.header_name = k
      obs.evidence = `${k}: ${v}`.slice(0, 200)
      if (k.toLowerCase() === "set-cookie") obs.set_cookie_injected = true
      break
    }
  }
  return obs
}
