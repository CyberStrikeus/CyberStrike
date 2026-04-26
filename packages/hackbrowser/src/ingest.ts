import { Log } from "cyberstrike/util/log"
import type { IngestPayload, CapturedRequest, PageDiffContext, AccessContext } from "./types.ts"

const log = Log.create({ service: "hackbrowser:ingest" })

let authHeader = ""

export function initAuth(username?: string, password?: string): void {
  if (!password) { authHeader = ""; return }
  authHeader = btoa(`${username ?? "cyberstrike"}:${password}`)
  authHeader = `Basic ${authHeader}`
}

// ============================================================
// Create a session upfront so all requests share one session ID
// ============================================================

export async function initSession(
  serverUrl: string,
  targetUrl: string,
  credentialId: string | undefined,
): Promise<string | null> {
  const payload: IngestPayload = {
    text: `[hackbrowser] Session started for ${targetUrl}`,
    ...(credentialId ? { credential_id: credentialId } : {}),
  }

  try {
    const res = await fetch(`${serverUrl}/session/ingest`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      log.error("initSession failed", { status: res.status, body: await res.text().catch(() => "") })
      return null
    }

    const data = (await res.json()) as { sessionID?: string }
    if (!data.sessionID) {
      log.error("initSession: no sessionID in response")
      return null
    }

    log.info("session created", { sessionID: data.sessionID })
    return data.sessionID
  } catch (err) {
    log.error("initSession network error", { err: String(err) })
    return null
  }
}

// ============================================================
// Send captured request to CyberStrike /session/ingest
// ============================================================

export function buildIngestPayload(
  captured: CapturedRequest,
  sessionID: string | undefined,
  credentialId: string | undefined,
  accessContext?: AccessContext,
): IngestPayload {
  const payload: IngestPayload = { text: captured.raw, scheme: captured.scheme }
  if (sessionID) payload.sessionID = sessionID
  if (credentialId) payload.credential_id = credentialId
  if (captured.response) payload.response = captured.response
  if (captured.uiContext) payload.ui_context = captured.uiContext
  if (accessContext) payload.access_context = accessContext
  if (captured.triggerElement) payload.trigger_element = captured.triggerElement
  if (captured.elementRoles) payload.element_roles = captured.elementRoles
  if (captured.pageUrl) payload.page_url = captured.pageUrl
  if (captured.pageVisitedBy) payload.page_visited_by = captured.pageVisitedBy
  return payload
}

export async function sendIngest(
  captured: CapturedRequest,
  serverUrl: string,
  sessionID: string | undefined,
  credentialId: string | undefined
): Promise<{ sessionID: string } | null> {
  const payload = buildIngestPayload(captured, sessionID, credentialId)
  const body = JSON.stringify(payload)

  log.debug("sending ingest", {
    request: captured.raw.split("\r\n")[0],
    uiFields: captured.uiContext?.fields.length ?? 0,
    trigger: captured.triggerElement ?? undefined,
    roles: captured.elementRoles ?? undefined,
    page: captured.pageUrl ?? undefined,
    visitedBy: captured.pageVisitedBy ?? undefined,
    sizeKB: (body.length / 1024).toFixed(1),
  })

  try {
    const res = await fetch(`${serverUrl}/session/ingest`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body,
    })

    if (!res.ok) {
      log.error("ingest server error", { status: res.status, body: await res.text().catch(() => "") })
      return null
    }

    const data = (await res.json()) as { sessionID?: string }
    log.debug("ingest accepted", { sessionID: data.sessionID ?? sessionID })
    return data as { sessionID: string }
  } catch (err) {
    log.error("ingest network error", { err: String(err) })
    return null
  }
}

// ============================================================
// Credential management (same pattern as Firefox extension)
// ============================================================

const COMMON_AUTH_HEADERS = [
  "authorization",
  "cookie",
  "x-auth-token",
  "x-api-key",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
]

const CANONICAL_HEADER_NAMES: Record<string, string> = {
  "authorization": "Authorization",
  "cookie": "Cookie",
  "x-auth-token": "X-Auth-Token",
  "x-api-key": "X-API-Key",
  "x-access-token": "X-Access-Token",
  "x-session-token": "X-Session-Token",
  "x-csrf-token": "X-CSRF-Token",
}

/** Extract auth headers from raw HTTP request text. Same header list as Firefox extension. */
export function extractAuthHeaders(rawRequest: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const lines = rawRequest.split(/\r?\n/)
  for (const line of lines) {
    if (line === "" || line === "\r") break // end of headers
    const colonIdx = line.indexOf(":")
    if (colonIdx < 0) continue
    const name = line.slice(0, colonIdx).trim().toLowerCase()
    if (COMMON_AUTH_HEADERS.includes(name)) {
      const canonical = CANONICAL_HEADER_NAMES[name] ?? name
      headers[canonical] = line.slice(colonIdx + 1).trim()
    }
  }
  return headers
}

/** Check if auth headers changed since last sync. */
export function headersChanged(
  oldHeaders: Record<string, string>,
  newHeaders: Record<string, string>,
): boolean {
  const oldKeys = Object.keys(oldHeaders)
  const newKeys = Object.keys(newHeaders)
  if (oldKeys.length !== newKeys.length) return true
  for (const key of newKeys) {
    if (oldHeaders[key] !== newHeaders[key]) return true
  }
  return false
}

/** Register a credential with CyberStrike. Returns the credential ID. */
export async function registerCredential(
  serverUrl: string,
  sessionID: string,
  label: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/session/${sessionID}/web/credentials`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ label, headers: {} }),
    })
    if (!res.ok) {
      log.error("registerCredential failed", { status: res.status, label })
      return null
    }
    const data = (await res.json()) as { id?: string }
    log.info("credential registered", { sessionID, credentialID: data.id, label })
    return data.id ?? null
  } catch (err) {
    log.error("registerCredential network error", { err: String(err), label })
    return null
  }
}

/** Sync credential auth headers with CyberStrike (PATCH). */
export async function syncCredentialHeaders(
  serverUrl: string,
  sessionID: string,
  credentialID: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch(`${serverUrl}/session/${sessionID}/web/credentials/${credentialID}`, {
      method: "PATCH",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ headers }),
    })
    if (!res.ok) {
      log.error("syncCredentialHeaders failed", { status: res.status, credentialID })
    } else {
      log.debug("credential headers synced", { credentialID })
    }
  } catch (err) {
    log.error("syncCredentialHeaders network error", { err: String(err), credentialID })
  }
}

// ============================================================
// Page-diff: send element availability to CyberStrike (Aşama 12)
// ============================================================

export async function sendPageDiff(
  pageDiff: PageDiffContext,
  serverUrl: string,
  sessionID: string,
  credentialId: string,
): Promise<void> {
  const payload: IngestPayload = {
    text: `[page-diff] ${pageDiff.page_url}`,
    sessionID,
    credential_id: credentialId,
    access_context: pageDiff,
  }

  const body = JSON.stringify(payload)

  log.debug("sending page-diff", {
    url: pageDiff.page_url,
    visitedBy: pageDiff.visited_by.join(","),
    elementCount: Object.keys(pageDiff.elements).length,
    fingerprintMatch: pageDiff.fingerprint_match,
  })

  try {
    const res = await fetch(`${serverUrl}/session/ingest`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body,
    })

    if (!res.ok) {
      log.error("page-diff send failed", { status: res.status })
    }
  } catch (err) {
    log.error("page-diff network error", { err: String(err) })
  }
}
