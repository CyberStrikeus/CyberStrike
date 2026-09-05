// Passive detectors (plan §06). Each is a PURE Detector: one response in, zero or
// more Signals out — no network, no DB, no shared state. Runs identically on
// captured and replay-elicited responses, so a cross-cutting finding surfaces no
// matter which agent elicited it or when (ordering independence). Presence is a
// LEAD routed to the owning specialist for confirmation, never a verdict.
//
// Cross-response correlation (stored_reflection) lives in ./canary.ts because it
// needs the canary registry; everything single-response lives here.

import { Observe } from "@/replay/observe"
import type { Detector, ObservedResponse, Signal } from "./types"
import { headerValue, headerValues } from "./types"

function snippet(text: string, at: number, span = 80): string {
  const start = Math.max(0, at - 20)
  return text.slice(start, start + span).replace(/\s+/g, " ").trim()
}

function isHtml(res: ObservedResponse): boolean {
  const ct = headerValue(res.headers, "content-type") ?? ""
  return ct.toLowerCase().includes("text/html")
}

function isJson(res: ObservedResponse): boolean {
  const ct = headerValue(res.headers, "content-type") ?? ""
  const low = ct.toLowerCase()
  return low.includes("json") || low.includes("graphql")
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

// ── Body-signature detectors ─────────────────────────────────────────────────

// Filesystem paths leaking in a body (error pages, debug output). Depth-gated to
// avoid matching ordinary URL paths.
const UNIX_PATH = /(?:\/(?:var|etc|home|usr|opt|srv|tmp|www|app|root)\/[\w.\-]+){1,}\/[\w.\-]+/
const WIN_PATH = /[A-Za-z]:\\(?:[\w.\-]+\\)+[\w.\-]+/

export class FullPathDisclosureDetector implements Detector {
  readonly signalType = "full_path_disclosure" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    const m = res.body.match(UNIX_PATH) ?? res.body.match(WIN_PATH)
    if (!m) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: m[0].slice(0, 120) }]
  }
}

export class StackTraceDetector implements Detector {
  readonly signalType = "stack_trace" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    if (!Observe.errorSignatures(res.body).includes("stacktrace")) return []
    const at = res.body.search(/Traceback|Exception in thread|at [\w.$]+\(/)
    return [
      {
        type: this.signalType,
        owner: this.owner,
        requestId: res.requestId,
        evidence: at >= 0 ? snippet(res.body, at) : "stack trace signature",
      },
    ]
  }
}

export class SqlErrorDetector implements Detector {
  readonly signalType = "sql_error" as const
  readonly owner = "injection" as const
  detect(res: ObservedResponse): Signal[] {
    const classes = Observe.errorSignatures(res.body)
    if (!classes.includes("sqli")) return []
    return [
      { type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: "DBMS error signature in response body" },
    ]
  }
}

export class DirectoryListingDetector implements Detector {
  readonly signalType = "directory_listing" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    if (!/<title>\s*Index of \//i.test(res.body) && !(/Index of \//.test(res.body) && /Parent Directory/i.test(res.body)))
      return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: "autoindex 'Index of /' listing" }]
  }
}

// Private keys, cloud access-key IDs. Kept precise to avoid false positives —
// high-entropy heuristics are deliberately excluded (too noisy for a routed lead).
const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { kind: "aws_access_key_id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { kind: "slack_token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
]

export class SensitiveDataExposureDetector implements Detector {
  readonly signalType = "sensitive_data_exposure" as const
  readonly owner = "recon" as const
  detect(res: ObservedResponse): Signal[] {
    const hits: string[] = []
    for (const p of SECRET_PATTERNS) if (p.re.test(res.body)) hits.push(p.kind)
    if (hits.length === 0) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: hits.join(", "), meta: { kinds: hits } }]
  }
}

export class GraphqlIntrospectionDetector implements Detector {
  readonly signalType = "graphql_introspection" as const
  readonly owner = "access-control" as const
  detect(res: ObservedResponse): Signal[] {
    if (!isJson(res)) return []
    if (!res.body.includes("__schema")) return []
    if (!/"queryType"|"types"\s*:/.test(res.body)) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: "introspection __schema response returned" }]
  }
}

// header.payload.signature where both first segments are base64url of a JSON `{`.
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/

export class JwtLeakDetector implements Detector {
  readonly signalType = "jwt_leak" as const
  readonly owner = "auth-session" as const
  detect(res: ObservedResponse): Signal[] {
    if (!JWT_RE.test(res.body)) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: "JWT structure present in response body" }]
  }
}

// ── Header detectors ─────────────────────────────────────────────────────────

const BANNER_HEADERS = ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator"]

export class ServerBannerDetector implements Detector {
  readonly signalType = "server_banner" as const
  readonly owner = "recon" as const
  detect(res: ObservedResponse): Signal[] {
    const found: string[] = []
    for (const name of BANNER_HEADERS) {
      const v = headerValue(res.headers, name)
      if (v && v.trim()) found.push(`${name}: ${v}`)
    }
    if (found.length === 0) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: found.join(" | "), meta: { headers: found } }]
  }
}

const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options"]

export class MissingSecurityHeadersDetector implements Detector {
  readonly signalType = "missing_security_headers" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    // Only meaningful for a rendered document that succeeded.
    if (!isHtml(res) || res.status >= 400) return []
    const missing = SECURITY_HEADERS.filter((h) => headerValue(res.headers, h) === undefined)
    if (missing.length === 0) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: `missing: ${missing.join(", ")}`, meta: { missing } }]
  }
}

export class CorsMisconfigDetector implements Detector {
  readonly signalType = "cors_misconfig" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    const acao = headerValue(res.headers, "access-control-allow-origin")
    if (!acao) return []
    const creds = (headerValue(res.headers, "access-control-allow-credentials") ?? "").toLowerCase() === "true"
    // Wildcard origin, or a specific reflected origin returned alongside credentials.
    if (acao !== "*" && !creds) return []
    const evidence = `ACAO: ${acao}${creds ? " + ACA-Credentials: true" : ""}`
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence, meta: { acao, credentials: creds } }]
  }
}

export class WeakCookieFlagsDetector implements Detector {
  readonly signalType = "weak_cookie_flags" as const
  readonly owner = "auth-session" as const
  detect(res: ObservedResponse): Signal[] {
    const cookies = headerValues(res.headers, "set-cookie")
    if (cookies.length === 0) return []
    const weak: string[] = []
    for (const c of cookies) {
      const name = c.split("=")[0]?.trim() ?? "?"
      const low = c.toLowerCase()
      const miss: string[] = []
      if (!low.includes("httponly")) miss.push("HttpOnly")
      if (!low.includes("secure")) miss.push("Secure")
      if (!low.includes("samesite")) miss.push("SameSite")
      if (miss.length > 0) weak.push(`${name} (missing ${miss.join("/")})`)
    }
    if (weak.length === 0) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: weak.join("; "), meta: { cookies: weak } }]
  }
}

// ── Request-vs-response detectors ────────────────────────────────────────────

export class OpenRedirectDetector implements Detector {
  readonly signalType = "open_redirect" as const
  readonly owner = "access-control" as const
  detect(res: ObservedResponse): Signal[] {
    if (res.status < 300 || res.status >= 400) return []
    const loc = headerValue(res.headers, "location")
    if (!loc) return []
    // Absolute or protocol-relative off-origin target.
    const abs = /^https?:\/\//i.test(loc) || loc.startsWith("//")
    if (!abs) return []
    const reqHost = hostOf(res.url)
    const locHost = hostOf(loc.startsWith("//") ? `http:${loc}` : loc)
    if (!locHost || locHost === reqHost) return []
    // Only a LEAD when the off-origin target traces to attacker-controllable
    // input: the location (or its host) appears in the request URL/query.
    let query = ""
    try {
      query = new URL(res.url).search
    } catch {
      query = res.url
    }
    if (!query.includes(locHost) && !query.includes(encodeURIComponent(loc)) && !query.includes(loc)) return []
    return [
      {
        type: this.signalType,
        owner: this.owner,
        requestId: res.requestId,
        evidence: `3xx Location → ${locHost} (reflected from request)`,
        meta: { location: loc, requestHost: reqHost },
      },
    ]
  }
}

// ── URL/status detector ──────────────────────────────────────────────────────

const ARTIFACT_RE = /(?:\/\.git(?:\/|$)|\/\.svn\/|\/\.env$|\/\.htaccess$|\/web\.config$|\/\.DS_Store$|\.(?:bak|old|swp|orig|sql|tar|tgz|zip)(?:$|\?))/i

export class ExposedArtifactDetector implements Detector {
  readonly signalType = "exposed_artifact" as const
  readonly owner = "misconfiguration" as const
  detect(res: ObservedResponse): Signal[] {
    if (res.status !== 200 || res.body.length === 0) return []
    let path = res.url
    try {
      path = new URL(res.url).pathname
    } catch {
      // fall back to the raw url string
    }
    const m = path.match(ARTIFACT_RE)
    if (!m) return []
    return [{ type: this.signalType, owner: this.owner, requestId: res.requestId, evidence: `exposed artifact: ${m[0]}` }]
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

// The default battery, in a stable order. Cross-response stored_reflection is
// added by the canary layer at wiring time; reflected_input needs a per-injection
// marker and is emitted by the smart tools, not a passive detector here.
export const DETECTORS: Detector[] = [
  new FullPathDisclosureDetector(),
  new StackTraceDetector(),
  new SqlErrorDetector(),
  new DirectoryListingDetector(),
  new SensitiveDataExposureDetector(),
  new GraphqlIntrospectionDetector(),
  new JwtLeakDetector(),
  new ServerBannerDetector(),
  new MissingSecurityHeadersDetector(),
  new CorsMisconfigDetector(),
  new WeakCookieFlagsDetector(),
  new OpenRedirectDetector(),
  new ExposedArtifactDetector(),
]

/** Run a detector battery over one response, flattening all emitted signals. */
export function runDetectors(res: ObservedResponse, detectors: Detector[] = DETECTORS): Signal[] {
  const out: Signal[] = []
  for (const d of detectors) {
    for (const s of d.detect(res)) out.push(s)
  }
  return out
}
