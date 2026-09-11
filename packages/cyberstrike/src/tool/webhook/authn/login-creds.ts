// login_probe building blocks (WSTG 4.4.2 default credentials / 4.4.3 weak lockout).
// Pure, socket-free helpers: the embedded default-credential battery, login-form
// field detection (username / password / CSRF), and credential-body rendering that
// preserves every OTHER field of the captured request (so a stale-but-present CSRF
// token, tenant id, redirect target, etc. ride along untouched). All HTTP is done by
// login-oracle.ts through an injected sender — nothing here opens a socket, so it is
// fully unit-testable and composes into @cyberstrike/web.
import type { ProbeRequest } from "../transport"

export interface CredPair {
  username: string
  password: string
  note?: string
}

// A curated, high-signal battery — short on purpose (a default-cred CHECK, not a
// brute-force). Ordered most-common first so a hit surfaces before the send budget
// or a lockout does. `""` is a real candidate (blank password is a classic default).
export const DEFAULT_CREDS: CredPair[] = [
  { username: "admin", password: "admin" },
  { username: "admin", password: "password" },
  { username: "admin", password: "admin123" },
  { username: "admin", password: "123456" },
  { username: "admin", password: "changeme" },
  { username: "admin", password: "letmein" },
  { username: "admin", password: "welcome" },
  { username: "admin", password: "Password1" },
  { username: "admin", password: "admin@123" },
  { username: "admin", password: "" },
  { username: "administrator", password: "administrator" },
  { username: "administrator", password: "password" },
  { username: "root", password: "root" },
  { username: "root", password: "toor" },
  { username: "root", password: "password" },
  { username: "test", password: "test" },
  { username: "guest", password: "guest" },
  { username: "user", password: "user" },
  { username: "demo", password: "demo" },
  { username: "tomcat", password: "tomcat" },
  { username: "sa", password: "" },
  { username: "oracle", password: "oracle" },
  { username: "postgres", password: "postgres" },
  { username: "superadmin", password: "superadmin" },
]

// Given the username the captured request actually used, add same-account guesses
// (username==password, +123, seasonal). These are the highest-probability hits for a
// REAL account and cost only a few sends.
export function deriveFromUsername(username: string): CredPair[] {
  const u = username.trim()
  if (!u || u.length > 64) return []
  const base = `derived from captured username "${u}"`
  const out: CredPair[] = [
    { username: u, password: u, note: base },
    { username: u, password: `${u}123`, note: base },
    { username: u, password: "Password1", note: base },
    { username: u, password: "123456", note: base },
    { username: u, password: "", note: `${base} (blank password)` },
  ]
  return out
}

const USERNAME_RE = /^(user(name)?|email|e[-_]?mail|login|uid|userid|user[-_]?id|account|acct|mail|usr|j_username|identifier)$/i
const PASSWORD_RE = /^(pass(word)?|passwd|pwd|pass1|j_password|secret|credential|passphrase)$/i
const CSRF_RE = /(csrf|xsrf|authenticity[_-]?token|_token\b|__requestverificationtoken|nonce|antiforgery)/i

export type BodyKind = "form" | "json" | "query" | "none"

export interface ParsedRequest {
  kind: BodyKind
  fields: Record<string, string> // flattened top-level string values (for detection)
  json?: unknown // the original parsed JSON (preserved so nested/other fields survive)
  parseError?: string
}

// Parse the captured request into a field map we can detect over and later rewrite.
// GET / bodiless → query params. JSON content-type → top-level object. Everything
// else → form-urlencoded. Unparseable JSON is reported, not thrown.
export function parseRequest(req: ProbeRequest): ParsedRequest {
  const ct = contentTypeOf(req.headers)
  const isGet = req.method.toUpperCase() === "GET" || req.method.toUpperCase() === "HEAD"
  if (isGet || !req.body) {
    const fields: Record<string, string> = {}
    try {
      new URL(req.url).searchParams.forEach((v, k) => (fields[k] = v))
    } catch {}
    return { kind: "query", fields }
  }
  if (/\bjson\b/i.test(ct)) {
    try {
      const obj = JSON.parse(req.body)
      const fields: Record<string, string> = {}
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const k in obj as Record<string, unknown>) {
          const v = (obj as Record<string, unknown>)[k]
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") fields[k] = String(v)
        }
      }
      return { kind: "json", fields, json: obj }
    } catch (e) {
      return { kind: "json", fields: {}, parseError: `JSON body did not parse: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const fields: Record<string, string> = {}
  try {
    new URLSearchParams(req.body).forEach((v, k) => (fields[k] = v))
  } catch {}
  return { kind: "form", fields }
}

export interface DetectedFields {
  usernameField?: string
  passwordField?: string
  csrfFields: string[]
  capturedUsername?: string
}

// Best-effort auto-detection over the parsed field names. Password is the anchor —
// no password field means this is not a credential-submit and the caller must be told.
export function detectFields(parsed: ParsedRequest): DetectedFields {
  const names = Object.keys(parsed.fields)
  const usernameField = names.find((n) => USERNAME_RE.test(n))
  const passwordField = names.find((n) => PASSWORD_RE.test(n))
  const csrfFields = names.filter((n) => CSRF_RE.test(n))
  const out: DetectedFields = { usernameField, passwordField, csrfFields }
  if (usernameField) out.capturedUsername = parsed.fields[usernameField]
  return out
}

// Rebuild a ProbeRequest carrying `pair` in the username/password fields, keeping the
// method, URL query, headers and EVERY other field of the original intact (CSRF token
// included — noted as possibly-stale by the caller). Content-length is recomputed by
// the transport, so it is not set here.
export function renderCredentialRequest(
  req: ProbeRequest,
  parsed: ParsedRequest,
  usernameField: string,
  passwordField: string,
  pair: CredPair,
): ProbeRequest {
  if (parsed.kind === "json") {
    const src = parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json) ? (parsed.json as Record<string, unknown>) : {}
    const obj: Record<string, unknown> = { ...src }
    obj[usernameField] = pair.username
    obj[passwordField] = pair.password
    return { ...req, headers: { ...req.headers }, body: JSON.stringify(obj) }
  }
  if (parsed.kind === "query") {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return { ...req }
    }
    url.searchParams.set(usernameField, pair.username)
    url.searchParams.set(passwordField, pair.password)
    return { ...req, headers: { ...req.headers }, url: url.toString() }
  }
  // form-urlencoded (the default)
  const params = new URLSearchParams(req.body ?? "")
  params.set(usernameField, pair.username)
  params.set(passwordField, pair.password)
  return { ...req, headers: { ...req.headers }, body: params.toString() }
}

export function contentTypeOf(headers: Record<string, string>): string {
  for (const k in headers) if (k.toLowerCase() === "content-type") return headers[k]
  return ""
}
