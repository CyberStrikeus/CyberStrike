import { Log } from "../log.ts"
import { sendIngest } from "../ingest.ts"
import type { CapturedRequest } from "../types.ts"
import type { Endpoint } from "./detector.ts"

const log = Log.create({ service: "hackbrowser:discovery" })

// Cap so a huge spec (hundreds of paths) can't flood the ingest endpoint.
const MAX_EMIT = 500

/**
 * Build a synthetic CapturedRequest for a DISCOVERED endpoint. No real request
 * was made (Approach B), so `response` is null — the proxy-agents receive it as
 * a KNOWN endpoint and decide whether/how to test it via http_replay. The
 * crawler never blindly hits it, so a destructive endpoint isn't triggered by
 * discovery alone. The X-Discovered-By header records provenance.
 */
export function toCapturedRequest(endpoint: Endpoint): CapturedRequest {
  const url = new URL(endpoint.url)
  // new URL() percent-encodes template braces ({id}, {}); restore them so the
  // proxy-agent sees the endpoint shape rather than /users/%7Bid%7D.
  const target = ((url.pathname || "/") + url.search).replace(/%7B/gi, "{").replace(/%7D/gi, "}")
  const raw =
    `${endpoint.method} ${target} HTTP/1.1\r\n` +
    `Host: ${url.host}\r\n` +
    `X-Discovered-By: ${endpoint.source}\r\n\r\n`
  return {
    raw,
    scheme: url.protocol === "http:" ? "http" : "https",
    response: null,
    uiContext: null,
    triggerElement: null,
    elementRoles: null,
    pageUrl: null,
    pageVisitedBy: null,
    timestamp: Date.now(),
  }
}

/**
 * Ingest discovered endpoints as known (un-hit) endpoints. Best-effort: a failed
 * ingest is logged and skipped. Returns how many were accepted.
 */
export async function emitEndpoints(
  endpoints: readonly Endpoint[],
  serverUrl: string,
  sessionID: string,
  credentialId: string | undefined,
): Promise<number> {
  const batch = endpoints.slice(0, MAX_EMIT)
  if (endpoints.length > MAX_EMIT) {
    log.warn("discovered endpoints truncated for ingest", { total: endpoints.length, cap: MAX_EMIT })
  }
  let sent = 0
  for (const endpoint of batch) {
    try {
      const ok = await sendIngest(toCapturedRequest(endpoint), serverUrl, sessionID, credentialId)
      if (ok) sent++
    } catch (err) {
      log.warn("endpoint ingest failed", { endpoint: `${endpoint.method} ${endpoint.url}`, err: String(err) })
    }
  }
  return sent
}
