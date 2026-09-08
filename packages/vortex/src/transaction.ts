// The unified traffic unit. EVERYTHING the platform sees or sends becomes a Transaction — a
// browser-captured request (hackbrowser ingest), a replayed request (the http engine), a cloud
// API call (azure/aws/gcp modules). One shape, one store, one rule layer over all of it. This is
// what lets deterministic rules cover the whole corpus instead of leaving detection to whichever
// endpoint an agent happens to poke.

// Where a transaction came from — which ingestion adapter produced it — so rules/queries can scope
// (e.g. "cloud responses only") and the UI can show provenance. HTTP(S) only for now.
//   browser = hackbrowser extension · proxy = MITM/forward proxy (mobile/non-browser clients) ·
//   cloud = an sdk-ingest report from our own code · replay = made by Vortex's own send engine ·
//   import = loaded from a HAR/offline capture.
export type Source = "browser" | "proxy" | "cloud" | "replay" | "import"

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
  // The assessment/session this traffic belongs to. A store may be scoped to one session; keeping
  // it on the transaction lets a shared store separate them and lets persistence index by it.
  session?: string
  source: Source
  host: string
  // The identity (credential/role label) this transaction was made under, when known — the axis
  // cross-identity access-control analysis compares along. Undefined = anonymous / unknown.
  identity?: string
  // Replay lineage: the id of the transaction this one was DERIVED from (a replay/mutation of a
  // captured request). Undefined for originally-observed traffic. Lets the engine tie a probe back
  // to the request it came from and compare the two.
  derivedFrom?: string
  request: Request
  response?: Response
  // Wire/transport metadata — populated by the adapter that has it (proxy, send engine); absent for
  // adapters that don't (a HAR import may lack TLS/timing). All optional so any adapter can omit.
  httpVersion?: string // "1.1" | "2" | "3"
  tls?: { version?: string; cipher?: string; sni?: string }
  redirectChain?: string[] // the URL hops that led here (or that this request kicked off)
  timing?: { startedAt?: number; ms?: number; ttfbMs?: number }
  // Technology markers attached by an extractor (e.g. JS mining → ["next", "spring"]). Lets tech-
  // specific rules match via HTTPQL `tech:~spring`. Written by ingestExtract, not by the wire.
  tech?: string[]
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
