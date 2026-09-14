// crypto_probe — deterministic cryptography probe (WSTG-CRYP), fully READ-ONLY over captured traffic:
// sends nothing, so zero flow risk. Detects sensitive data on an unencrypted channel (CRYP-03), missing/
// weak HSTS (CRYP-01 downgrade protection), credentials/PII in URLs, and mixed content. This is the
// channel-encryption lens; secret-leakage is Vortex's secret-in-response, and cookie flags are session_probe's.
import z from "zod"
import { Tool } from "../tool"
import { Session } from "../../session"
import { Request } from "../../session/request"
import { HttpMessage } from "../../replay/message"
import { findSensitive, classifyHsts, findMixedContent, type Sensitive } from "./signatures"

function headerValue(msg: HttpMessage.Request, name: string): string | undefined {
  return msg.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value
}

export const CryptoProbeTool = Tool.define("crypto_probe", {
  description:
    "Deterministic cryptography probe (WSTG-CRYP) — fully READ-ONLY over the captured request+response (sends nothing, zero risk). Detects: sensitive data (credentials/token/PII/Luhn-valid card) sent over an UNENCRYPTED channel (CRYP-03); missing or weak HSTS on HTTPS responses (CRYP-01 downgrade protection); credentials/PII carried in the URL query (logged/cached/Referer); and mixed content (an HTTPS response loading http:// subresources). Complements Vortex TLS rules; it does not do the live TLS-handshake cipher/protocol check.",
  parameters: z.object({
    request_id: z.string().describe("A captured request to analyze for transport-encryption weaknesses."),
  }),
  async execute(params, ctx) {
    const sessionID = Session.root(ctx.sessionID)
    const out = (output: string, metadata: Record<string, unknown> = {}) => ({ title: "crypto_probe", output, metadata })

    const request = Request.get(sessionID).find((r) => r.id === params.request_id)
    if (!request) return out(`Request "${params.request_id}" not found in this session.`)

    const scheme = request.scheme ?? (request.origin?.startsWith("https") ? "https" : request.origin?.startsWith("http:") ? "http" : undefined)
    let target = request.normalized_path ?? ""
    let bodyText = ""
    let authBasic = false
    if (request.raw_request) {
      try {
        const msg = HttpMessage.parse(request.raw_request)
        target = msg.target
        bodyText = new TextDecoder("latin1").decode(msg.body)
        authBasic = /^Basic\s+/i.test(headerValue(msg, "authorization") ?? "")
      } catch {
        /* fall back to request fields */
      }
    }
    const query = target.includes("?") ? target.slice(target.indexOf("?") + 1) : ""

    const findings: Record<string, unknown>[] = []

    // CRYP-03 — sensitive data on an unencrypted channel. Only a break when the channel is NOT https.
    if (scheme && scheme !== "https") {
      const items: Sensitive[] = [...findSensitive("query", query), ...findSensitive("body", bodyText)]
      if (authBasic) items.push({ kind: "credential-field", where: "header", detail: "Authorization: Basic (base64 credentials)" })
      if (items.length) findings.push({ kind: "cleartext-sensitive-transmission", severity: "high", channel: scheme, items, note: `sensitive data sent over an unencrypted ${scheme} channel — interceptable in transit (WSTG-CRYP-03)` })
    }

    // Credentials/PII in the URL query — logged, cached, and sent in Referer regardless of channel; worse over http.
    const inUrl = findSensitive("query", query)
    if (inUrl.length) findings.push({ kind: "sensitive-in-url", severity: scheme === "https" ? "medium" : "high", items: inUrl, note: `credentials/PII in the URL query — persisted in history/proxy/server logs and sent in the Referer header${scheme && scheme !== "https" ? ", AND over cleartext" : ""}` })

    // Response-side transport posture (HTTPS only).
    const respHeaders = request.response_headers ?? {}
    if (scheme === "https") {
      const hstsVal = Object.entries(respHeaders).find(([k]) => k.toLowerCase() === "strict-transport-security")?.[1]
      const h = classifyHsts(hstsVal)
      if (h.verdict !== "ok") findings.push({ kind: `hsts-${h.verdict}`, severity: "medium", note: h.note })
      if (request.processed_response) {
        const mixed = findMixedContent(request.processed_response)
        if (mixed.length) findings.push({ kind: "mixed-content", severity: "medium", refs: mixed.slice(0, 10), count: mixed.length, note: "an HTTPS response references http:// subresources — mixed content weakens the page's transport guarantees (WSTG-CRYP-03)" })
      }
    }

    const high = findings.filter((f) => f.severity === "high")
    const evidence = {
      note: "OBSERVATIONS ONLY (read-only, nothing sent) — confirm and report with the captured request/response as evidence. Channel-encryption lens; the live TLS cipher/protocol handshake is not covered here (see Vortex TLS rules / an external TLS scan).",
      request_id: params.request_id,
      scheme: scheme ?? "(unknown — no scheme/origin on this row)",
      findings: findings.length ? findings : ["no transport-encryption weakness detected on this request"],
    }
    const title = high.length
      ? `crypto_probe: ${high.length} HIGH transport finding(s) (cleartext sensitive data) — verify`
      : findings.length
        ? `crypto_probe: ${findings.length} transport weakness(es) to verify`
        : `crypto_probe: no transport-encryption weakness found`
    return { title, output: JSON.stringify(evidence, null, 2), metadata: {} }
  },
})
