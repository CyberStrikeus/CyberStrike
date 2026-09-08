// The unified traffic unit. EVERYTHING the platform sees or sends becomes a Transaction — a
// browser-captured request (hackbrowser ingest), a replayed request (the http engine), a cloud
// API call (azure/aws/gcp modules). One shape, one store, one rule layer over all of it. This is
// what lets deterministic rules cover the whole corpus instead of leaving detection to whichever
// endpoint an agent happens to poke.

// Where a transaction came from — so rules/queries can scope (e.g. "cloud responses only") and so
// the UI can show provenance. Not an exhaustive protocol list; HTTP(S) only for now.
export type Source = "browser" | "replay" | "cloud" | "import"

export type Severity = "info" | "low" | "medium" | "high" | "critical"

// A header as it appeared on the wire. Kept as an ordered list (not a map) because order and
// duplicates matter for some checks (e.g. multiple Set-Cookie). Lookups go through `header()`.
export interface Header {
  name: string
  value: string
}

export interface Request {
  method: string
  url: string
  headers: Header[]
  body?: string
}

export interface Response {
  status: number
  headers: Header[]
  body?: string
  // The real byte length, even when `body` is truncated for storage.
  bodyLength?: number
}

export interface Transaction {
  id: string
  source: Source
  host: string
  // The identity (credential/role label) this transaction was made under, when known — the axis
  // cross-identity access-control analysis compares along. Undefined = anonymous / unknown.
  identity?: string
  request: Request
  response?: Response
  timing?: { startedAt: number; ms?: number }
}

// Case-insensitive header lookup returning the FIRST match's value, or undefined. Header names are
// case-insensitive per RFC, and servers are inconsistent, so never compare names with ===.
export function header(headers: Header[], name: string): string | undefined {
  const want = name.toLowerCase()
  for (const h of headers) if (h.name.toLowerCase() === want) return h.value
  return undefined
}

// ALL values for a header name (Set-Cookie and other repeatable headers appear more than once).
export function headerAll(headers: Header[], name: string): string[] {
  const want = name.toLowerCase()
  const out: string[] = []
  for (const h of headers) if (h.name.toLowerCase() === want) out.push(h.value)
  return out
}

export function hasHeader(headers: Header[], name: string): boolean {
  return header(headers, name) !== undefined
}
