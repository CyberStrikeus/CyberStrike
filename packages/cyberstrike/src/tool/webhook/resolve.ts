// Shared request resolution for the webhook smart tools. Turns a captured request
// id into the ProbeRequest the tools + shared transport speak — the SAME logic
// authn_test and ssrf_test (and future tools) need, kept in one place. Because it
// resolves a CAPTURED request (no arbitrary target), scope is inherently the
// session's already-seen host — no SSRF-shaped hole to open.
import { Request } from "../../session/request"
import { HttpMessage } from "@/replay/message"
import type { ProbeRequest } from "./transport"

export function resolveCapturedRequest(sessionID: string, requestId: string): ProbeRequest | { error: string } {
  const request = Request.get(sessionID).find((r) => r.id === requestId)
  if (!request?.raw_request) return { error: `Request "${requestId}" not found or has no raw request.` }

  let msg: HttpMessage.Request
  try {
    msg = HttpMessage.parse(request.raw_request)
  } catch (e) {
    return { error: `Could not parse request: ${e instanceof Error ? e.message : String(e)}` }
  }

  const origin = (request.origin ?? `${request.scheme ?? "http"}://${request.host ?? ""}`).replace(/\/+$/, "")
  if (!origin.includes("://") || origin.endsWith("//")) return { error: "Could not resolve the request origin." }

  const headers: Record<string, string> = {}
  for (const h of msg.headers) headers[h.name] = h.value

  return {
    method: msg.method,
    url: origin + msg.target,
    headers,
    body: msg.body.length > 0 ? new TextDecoder("latin1").decode(msg.body) : undefined,
  }
}
