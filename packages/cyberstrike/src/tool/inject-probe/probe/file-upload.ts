// File-upload probe (WSTG-INPV-09). Request-level (like mass_assign): on a captured multipart upload, it
// runs the full attack matrix (payloads/file-upload) against a known-good image baseline. A dangerous
// variant that is ACCEPTED like the baseline is a finding; when the response exposes the stored URL, a
// same-origin GET + canary classifies STORED (served verbatim) vs EXECUTED (RCE). Deterministic + budgeted.
import type { ResolvedRequest, SendBudget } from "../types"
import { send, nonce, type HttpSender } from "../send"
import { looksBlocked } from "../detect"
import { sleep, type BackoffState, recordBlock, recordSuccess } from "./base"
import { multipartBoundary, firstFileField, setMultipartFile } from "../multipart"
import { uploadVariants, uploadBaseline } from "../payloads/file-upload"

// A server-side "we rejected your file" response. Kept broad; combined with a 2xx gate below.
const VALIDATION_ERR = /invalid file|not allowed|disallowed|unsupported (?:file|type|format|extension)|only\b.{0,40}\b(?:allowed|permitted)|bad extension|file type not|must be an? (?:image|jpe?g|png|gif)|rejected|forbidden file|malicious/i

export interface UploadVariantResult {
  name: string
  category: string
  filename: string
  status: number | null
  accepted: boolean
  stored_url?: string
  retrieved?: "verbatim" | "executed" | "not-found"
  danger: string
}

export interface FileUploadObservation {
  point: string
  baseline_accepted: boolean
  accepted_dangerous: UploadVariantResult[]
  executed: UploadVariantResult[]
  tried: number
  blocked: boolean
  block_signal?: string
  note?: string
}

function is2xx(s: number): boolean {
  return s >= 200 && s < 300
}

// Accepted = a non-blocked 2xx (or a 3xx redirect after a successful create) with no validation-rejection
// marker. Judged the same way for baseline and variants so the differential is apples-to-apples.
function acceptedLike(status: number, text: string): boolean {
  if (looksBlocked(status)) return false
  if (!(is2xx(status) || status === 302 || status === 303)) return false
  return !VALIDATION_ERR.test(text.slice(0, 8000))
}

function sameOrigin(base: string, candidate: string): string | null {
  try {
    const b = new URL(base)
    const u = new URL(candidate, b) // resolves relative URLs against the upload origin
    return u.origin === b.origin ? u.toString() : null
  } catch {
    return null
  }
}

// Pull a same-origin URL/path that references our canary out of the response (the stored file location).
function storedUrl(baseUrl: string, text: string, canary: string): string | undefined {
  const m = text.match(new RegExp(`(?:https?://[^\\s"'<>]+|/[^\\s"'<>]*)cs_${canary}[^\\s"'<>]*`, "i"))
  if (!m) return undefined
  return sameOrigin(baseUrl, m[0]) ?? undefined
}

export async function probeFileUpload(
  sender: HttpSender,
  r: ResolvedRequest,
  abort: AbortSignal,
  delayMs: number,
  budget: SendBudget,
  backoff?: BackoffState,
): Promise<FileUploadObservation> {
  const obs: FileUploadObservation = { point: "file:none", baseline_accepted: false, accepted_dangerous: [], executed: [], tried: 0, blocked: false }
  const method = (r.method || "GET").toUpperCase()
  if (method === "GET" || method === "HEAD") {
    obs.note = "file upload needs a write request (POST/PUT) — this request has none"
    return obs
  }
  const boundary = multipartBoundary(r)
  if (!boundary) {
    obs.note = "not a multipart/form-data request — no file part to mutate"
    return obs
  }
  const field = firstFileField(r.body, boundary)
  if (!field) {
    obs.note = "multipart body has no file part (filename=) to mutate"
    return obs
  }
  obs.point = `file:${field}`
  const canary = "up" + nonce()

  const put = (v: { filename: string; contentType: string; content: string }) => setMultipartFile(r.body, boundary, field, v)

  // Baseline: the known-good image MUST be accepted, else the endpoint blocks everything (auth/CSRF/size)
  // and the differential is meaningless.
  const baseVar = uploadBaseline(canary)
  const baseBody = put(baseVar)
  if (!baseBody) {
    obs.note = "could not rewrite the multipart file part"
    return obs
  }
  const base = await send(sender, r, { url: r.url.toString(), body: baseBody, headers: r.headers }, abort, budget)
  if ("error" in base) {
    obs.note = `baseline upload failed: ${base.error}`
    return obs
  }
  if (looksBlocked(base.status)) {
    obs.blocked = true
    obs.block_signal = `baseline blocked (status ${base.status}) — NOT evidence of upload safety`
    return obs
  }
  obs.baseline_accepted = acceptedLike(base.status, base.text)
  if (!obs.baseline_accepted) {
    obs.note = `the known-good image was itself rejected (status ${base.status}) — cannot run the differential; the endpoint may need other fields or a fresh CSRF token`
    return obs
  }

  for (const v of uploadVariants(canary)) {
    if (abort.aborted || budget.sent >= budget.max) break
    const body = put(v)
    if (!body) continue
    const res = await send(sender, r, { url: r.url.toString(), body, headers: r.headers }, abort, budget)
    obs.tried++
    if ("error" in res) continue
    if (looksBlocked(res.status)) {
      obs.blocked = true
      if (backoff && recordBlock(backoff) === "skip-point") break
      continue
    }
    if (backoff) recordSuccess(backoff)
    if (acceptedLike(res.status, res.text)) {
      const result: UploadVariantResult = { name: v.name, category: v.category, filename: v.filename, status: res.status, accepted: true, danger: v.danger }
      // Impact confirmation: if the response reveals where it was stored, fetch it (same-origin) and see
      // whether our canary comes back EXECUTED (RCE) or served VERBATIM (stored XSS surface).
      const url = storedUrl(r.url.toString(), res.text, canary)
      if (url && budget.sent < budget.max) {
        result.stored_url = url
        const got = await send(sender, { ...r, method: "GET" }, { url, body: "", headers: r.headers }, abort, budget)
        if (!("error" in got)) {
          if (got.status === 404) result.retrieved = "not-found"
          else if (got.text.includes(canary) && !got.text.includes("<?php")) {
            result.retrieved = "executed"
            obs.executed.push(result)
          } else if (got.text.includes(canary)) result.retrieved = "verbatim"
        }
      }
      obs.accepted_dangerous.push(result)
    }
    await sleep(backoff?.delay ?? delayMs)
  }
  return obs
}
