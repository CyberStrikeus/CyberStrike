// jsmine — the JS-body miner (Enterprise-only discovery producer; core anticipates it as
// `@cyberstrike-io/jsmine`, built separately, in discovery.ts). A PURE, deterministic
// `text -> Extract`: given a JavaScript / HTML / JSON body, pull out endpoints, further JS bundles,
// and secret-looking strings. No I/O — the caller (crawl / the extension firehose) fetches and feeds
// the result to Vortex's `ingestExtract` (see ingest.ts `mineInto`).
//
// Depends on the Vortex core ONLY for the `Extract` contract (type-only). Core never imports jsmine —
// this package is a detachable Enterprise add-on that ships in the Enterprise repo, not the AGPL core.
//
// v2 design (JS is a first-class attack surface, so recall matters — not just low FP):
// - Scans double/single-quote AND backtick template literals. In templates, `${…}` interpolation is
//   collapsed to `*` so `/api/${id}/x` still surfaces as the route `/api/*/x`.
// - LinkFinder-grade endpoint classification: absolute/scheme-relative URLs, `/` `./` `../` relative
//   paths, slash-less REST paths (`api/v1/users`), and bare server-side files (`.php/.aspx/.jsp/…`).
// - Secrets: curated vendor token shapes (superset of the core `secret-in-response` rule) PLUS
//   Shannon-entropy detection over literals for UNKNOWN secrets — in minified bundles the variable
//   name (`apiKey`) is gone, so name-based detection dies and entropy is what survives. Entropy is
//   heavily gated (data: URIs, SRI hashes, JWTs, prose) to keep precision.
// - ReDoS-safe: length-bounded, linear quantifiers; literals scanned with simple class regexes.
// - `tech` is intentionally empty: technology fingerprinting is the rule engine's job (tech-* packs).
//
// Not yet handled (deliberately, to avoid fragile FP-prone code): runtime webpack chunk-manifest
// resolution (chunk-id -> hashed filename computed at runtime). Tracked in issue #7.
import type { Extract } from "@cyberstrike-io/vortex"

export interface MineOptions {
  baseUrl?: string // resolve relative refs to absolute against this URL
  sameHostOnly?: boolean // with baseUrl, drop off-host endpoints/jsUrls (default false)
  max?: number // cap per category to bound output on huge bundles (default 1000)
  entropy?: boolean // enable entropy-based unknown-secret detection (default true)
}

// --- Secrets: curated vendor patterns (superset of core signatures.ts secret-in-response) ---------
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g, // AWS access key id
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /xox[baprs]-[0-9A-Za-z-]{10,48}/g, // Slack token
  /(?:sk|pk|rk)_live_[0-9A-Za-z]{20,40}/g, // Stripe live keys
  /gh[pousr]_[0-9A-Za-z]{36}/g, // GitHub tokens
  /glpat-[0-9A-Za-z_-]{20}/g, // GitLab PAT
  /[0-9]{10,13}-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g, // Google OAuth client id
  /shpat_[0-9a-fA-F]{32}/g, // Shopify token
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
]
const ASSIGN_RE = /["']?(?:api[_-]?key|apikey|secret[_-]?key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{8,80})["']/gi
const PLACEHOLDER_RE = /^(?:x{3,}|your[_-]|example|changeme|placeholder|test|dummy|sample|null|undefined|true|false|\$\{|<[^>]+>|\{\{)/i

// --- Endpoint / asset classification -------------------------------------------------------------
const ASSET_EXT = /\.(?:css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|zip)(?:$|[?#])/i
const JS_EXT = /\.(?:m?js|cjs)(?:$|[?#])/i
const MAP_EXT = /\.(?:m?js)\.map(?:$|[?#])/i
const SERVER_EXT = /\.(?:php|phtml|asp|aspx|ashx|asmx|jsp|jspx|do|action|cgi|pl|py|rb|json|xml|txt|wsdl|svc)(?:$|[?#])/i
const ROUTEY = /^\/?(?:api|v[0-9]+|graphql|gql|rest|rpc|wp-json|oauth|auth|admin|internal|_next\/data|services?|users?|account|session|login|logout|token|upload|download|search|query|export)\b/i
const NOISE = /^(?:https?:$|[a-z]+\/[a-z0-9.+-]+$|[0-9.]+$|#|\s|@)/i

function looksMime(s: string): boolean {
  return /^(?:text|application|image|audio|video|font|multipart)\/[a-z0-9.+-]+$/i.test(s)
}

// --- helpers -------------------------------------------------------------------------------------
function uniqCap(items: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const v = raw.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

function resolve(ref: string, baseUrl?: string): string {
  if (!baseUrl) return ref
  try {
    return new URL(ref, baseUrl).toString()
  } catch {
    return ref
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

// Pull short quoted string literals AND backtick templates. Templates have `${…}` collapsed to `*`.
function literals(text: string): string[] {
  const out: string[] = []
  const dq = /"([^"\n]{1,400})"/g
  const sq = /'([^'\n]{1,400})'/g
  const bt = /`([^`]{1,400})`/g
  for (let m = dq.exec(text); m; m = dq.exec(text)) out.push(m[1]!)
  for (let m = sq.exec(text); m; m = sq.exec(text)) out.push(m[1]!)
  for (let m = bt.exec(text); m; m = bt.exec(text)) out.push(m[1]!.replace(/\$\{[^}]{0,80}\}/g, "*"))
  return out
}

type Kind = "endpoint" | "js" | null

function classify(lit: string): Kind {
  const s = lit.trim()
  if (!s || s.length > 400) return null
  if (looksMime(s) || NOISE.test(s)) return null

  if (/^(?:https?:\/\/|wss?:\/\/|\/\/)[^\s"'<>]{2,}/i.test(s)) {
    if (MAP_EXT.test(s) || JS_EXT.test(s)) return "js"
    if (ASSET_EXT.test(s)) return null
    return "endpoint"
  }

  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) {
    if (MAP_EXT.test(s) || JS_EXT.test(s)) return "js"
    if (ASSET_EXT.test(s)) return null
    if (ROUTEY.test(s)) return "endpoint"
    const body = s.replace(/^(?:\.\.?\/)+/, "/")
    if (body.length >= 4 && body.indexOf("/", 1) > 0) return "endpoint"
    if (SERVER_EXT.test(s)) return "endpoint"
    return null
  }

  if (JS_EXT.test(s) || MAP_EXT.test(s)) return "js"
  if (ASSET_EXT.test(s)) return null
  if (SERVER_EXT.test(s) && !/\s/.test(s)) return "endpoint"
  if (/^[a-zA-Z0-9_.\-]+(?:\/[a-zA-Z0-9_.\-]+){2,}$/.test(s)) return "endpoint"
  if (ROUTEY.test(s) && /\//.test(s)) return "endpoint"
  return null
}

// --- Secrets -------------------------------------------------------------------------------------
function shannon(s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let e = 0
  for (const n of freq.values()) {
    const p = n / s.length
    e -= p * Math.log2(p)
  }
  return e
}

const B64ISH = /^[A-Za-z0-9+/_-]{20,100}={0,2}$/
const HEX = /^[0-9a-f]{20,100}$/i
const SRI = /^sha(?:256|384|512)-/i

function isEntropySecret(lit: string): boolean {
  const s = lit.trim()
  if (SRI.test(s)) return false
  if (s.includes("/") || s.includes(" ") || s.includes(".")) return false
  if (!/[0-9]/.test(s) || !/[A-Za-z]/.test(s)) return false
  if (!B64ISH.test(s)) return false
  return shannon(s) >= 4.5
}
function isHexSecret(lit: string): boolean {
  const s = lit.trim()
  if (!HEX.test(s)) return false
  if (s.length === 32 || s.length === 40 || s.length === 64) return shannon(s) >= 3.9
  return shannon(s) >= 3.6
}

function secretsIn(text: string, lits: string[], entropy: boolean): string[] {
  const out: string[] = []
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[0])
  }
  ASSIGN_RE.lastIndex = 0
  for (let m = ASSIGN_RE.exec(text); m; m = ASSIGN_RE.exec(text)) {
    if (!PLACEHOLDER_RE.test(m[1]!)) out.push(m[0])
  }
  if (entropy) {
    for (const lit of lits) {
      const s = lit.trim()
      if (s.startsWith("data:") || s.includes("base64,")) continue
      if (/^eyJ/.test(s)) continue
      if (isEntropySecret(s) || isHexSecret(s)) out.push(s)
    }
  }
  return out
}

function sourceMaps(text: string): string[] {
  const out: string[] = []
  const re = /sourceMappingURL=([^\s"'*]{1,200})/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[1]!.startsWith("data:")) out.push(m[1]!)
  }
  return out
}

export function mine(text: string, opts: MineOptions = {}): Extract {
  const max = opts.max ?? 1000
  const base = opts.baseUrl
  const entropy = opts.entropy ?? true
  const lits = literals(text)

  const rawEndpoints: string[] = []
  const rawJs: string[] = []
  for (const lit of lits) {
    const k = classify(lit)
    if (k === "js") rawJs.push(resolve(lit, base))
    else if (k === "endpoint") rawEndpoints.push(resolve(lit, base))
  }
  for (const sm of sourceMaps(text)) rawJs.push(resolve(sm, base))

  let endpoints = rawEndpoints
  let jsUrls = rawJs
  if (base && opts.sameHostOnly) {
    const seedHost = hostOf(base)
    const sameHost = (u: string) => {
      if (u.startsWith("/") || u.startsWith("./") || u.startsWith("../")) return true
      const h = hostOf(u)
      return !h || h === seedHost
    }
    endpoints = endpoints.filter(sameHost)
    jsUrls = jsUrls.filter(sameHost)
  }

  return {
    endpoints: uniqCap(endpoints, max),
    jsUrls: uniqCap(jsUrls, max),
    tech: [],
    secrets: uniqCap(secretsIn(text, lits, entropy), max),
  }
}
