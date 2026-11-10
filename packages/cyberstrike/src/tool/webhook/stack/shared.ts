// Shared helpers for the per-stack technique tools (ported from infra-security-mcp).
// Every ported check sends through the webhook `HttpSender` (ReplaySender →
// governedSend), so probes inherit the engine's captured-host scope guard instead
// of the source's bare fetch. These helpers are the small surface the source's
// `probe()` / `extractHeader()` / `normalizeUrl()` map onto.
import type { HttpSender, ProbeResponse } from "../transport"

export type Probe = ProbeResponse | { error: string }
export type Severity = "info" | "low" | "medium" | "high" | "critical"

// One ported sub-check's verdict. `hit` = the condition was confirmed present.
export interface Check {
  check: string
  hit: boolean
  severity: Severity
  detail: string
  evidence?: string
}

export function failed(res: Probe): res is { error: string } {
  return "error" in res
}

export function ok(res: Probe): res is ProbeResponse {
  return !("error" in res)
}

// Case-insensitive response-header lookup (the source's extractHeader).
export function header(res: ProbeResponse, name: string): string {
  const want = name.toLowerCase()
  for (const k in res.headers) if (k.toLowerCase() === want) return res.headers[k]
  return ""
}

export function get(sender: HttpSender, url: string, headers: Record<string, string> = {}) {
  return sender.send({ method: "GET", url, headers })
}

// Target → scheme-qualified origin with any trailing slash stripped, so
// `${base}${path}` never doubles the separator (the source's normalizeUrl).
export function base(target: string): string {
  const t = target.trim()
  return (/^https?:\/\//.test(t) ? t : `https://${t}`).replace(/\/+$/, "")
}

// Same origin on a different port (admin consoles, AJP, inspector ports, …).
export function withPort(origin: string, p: number): string {
  const u = new URL(origin)
  u.port = String(p)
  return `${u.protocol}//${u.host}`
}

// Bare hostname (no scheme, no port) — for building http+https variants of an alt port.
export function host(origin: string): string {
  return new URL(origin).hostname
}

// One branch outcome inside a multi-branch sub-check. The source providers
// accumulate an array of findings per tool; `verdict` folds them into one Check.
export interface Finding {
  severity: Severity
  detail: string
  evidence?: string
}

const ORDER: Severity[] = ["info", "low", "medium", "high", "critical"]

// Fold a sub-check's branch findings into one Check verdict: hit if any branch
// matched, severity = the worst matched branch, detail = every branch joined.
export function verdict(check: string, findings: Finding[], miss: string): Check {
  if (findings.length === 0) return { check, hit: false, severity: "info", detail: miss }
  const severity = findings.reduce<Severity>((s, f) => (ORDER.indexOf(f.severity) > ORDER.indexOf(s) ? f.severity : s), "info")
  return { check, hit: true, severity, detail: findings.map((f) => f.detail).join("; "), evidence: findings.find((f) => f.evidence)?.evidence }
}

// Compact one-line summary shared by every stack tool's `format`.
export function summarize(name: string, target: string, results: Check[]): string {
  const hits = results.filter((r) => r.hit)
  if (hits.length === 0) return `${name}: nothing confirmed on ${target} (${results.length} checks)`
  return `${name}: ${hits.length}/${results.length} confirmed on ${target} — ${hits.map((h) => `${h.check}[${h.severity}]`).join(", ")}`
}
