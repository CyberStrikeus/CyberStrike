// Structured parameter extraction. Query params come from the URL; body params come from the
// unified body model (body.ts), so request AND response bodies are handled uniformly across media
// types (JSON/form/multipart/xml/graphql). This is what lets a rule/query target the exact input a
// vulnerability lives in (e.g. req.body.params.staff_name) — and now response fields too.
import type { Transaction } from "./transaction"
import type { BodyKind } from "./body"
import { messageBody } from "./body"

export interface Params {
  query: Record<string, string>
  body: Record<string, string>
}

function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const [k, v] of new URL(url).searchParams) out[k] = v
  } catch {
    const q = url.indexOf("?")
    if (q !== -1) {
      try {
        for (const [k, v] of new URLSearchParams(url.slice(q + 1))) out[k] = v
      } catch {}
    }
  }
  return out
}

// Request params: URL query + structured request-body fields.
export function params(tx: Transaction): Params {
  return { query: parseQuery(tx.request.url), body: messageBody(tx.request.headers, tx.request.body).fields }
}

// Structured RESPONSE-body fields — e.g. an object id in a JSON response, for cross-identity
// comparison, or a leaf value in an XML/HTML-adjacent response. Empty when there's no response.
export function responseFields(tx: Transaction): Record<string, string> {
  if (!tx.response) return {}
  return messageBody(tx.response.headers, tx.response.body).fields
}

export function requestBodyKind(tx: Transaction): BodyKind {
  return messageBody(tx.request.headers, tx.request.body).kind
}
export function responseBodyKind(tx: Transaction): BodyKind {
  if (!tx.response) return "empty"
  return messageBody(tx.response.headers, tx.response.body).kind
}
