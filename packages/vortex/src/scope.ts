// Response-type helpers so a rule fires only where it makes sense. A header-hygiene rule that
// fires on a 301 redirect or a .js bundle is noise; scoping keeps signals meaningful.
import type { Transaction } from "./transaction"
import { header } from "./transaction"

const STATIC_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|pdf|wasm)(?:$|\?)/i

export function contentType(tx: Transaction): string {
  if (!tx.response) return ""
  return (header(tx.response.headers, "content-type") ?? "").toLowerCase()
}

// A static asset — by URL extension or response content-type. No access-control / header-policy
// surface worth flagging per-asset.
export function isStaticAsset(tx: Transaction): boolean {
  if (STATIC_RE.test(tx.request.url)) return true
  const ct = contentType(tx)
  return /^(?:image|font|audio|video)\//.test(ct) || ct.includes("text/css") || ct.includes("javascript") || ct.includes("ecmascript")
}

export function isRedirect(tx: Transaction): boolean {
  const s = tx.response?.status ?? 0
  return s >= 300 && s < 400
}

export function isSuccess(tx: Transaction): boolean {
  const s = tx.response?.status ?? 0
  return s >= 200 && s < 300
}

// A "content" response worth security-header analysis: has a response, not a static asset, not a
// bare redirect. (Auth/error responses 4xx/5xx still count — they're documents/APIs too.)
export function isContentResponse(tx: Transaction): boolean {
  if (!tx.response) return false
  if (isRedirect(tx)) return false
  if (isStaticAsset(tx)) return false
  return true
}

// OBSERVED traffic — what the app actually served/received (browser, proxy, cloud, import), as
// opposed to `replay`: transactions the ENGINE/agent sent as probes (payloads, canaries). Passive
// detection MUST run over observed traffic only, or an agent's own injected payload/canary would be
// re-ingested and mis-flagged as the app's behavior (a self-inflicted false finding / feedback
// loop). Replay transactions are inputs to ACTIVE rules' diffs — the rule that sent the canary
// interprets it — never passive subjects. Fresh replay ids also can't overwrite observed rows.
export function isObserved(tx: Transaction): boolean {
  return tx.source !== "replay"
}

// The observed subset of a set — the safe corpus for passive rules/queries.
export function observed(txs: Transaction[]): Transaction[] {
  return txs.filter(isObserved)
}
