// Error-forcing active rules — deliberately trigger errors to extract intelligence (framework names,
// internal paths, version strings, stack traces) from error responses. Each rule bounds itself to
// one probe per endpoint and gracefully handles transport errors.
import type { Transaction } from "../transaction"
import { header } from "../transaction"
import type { Signal } from "../rule"
import type { ActiveRule, Sender } from "../active"
import { endpointKey } from "../endpoint"
import { isSuccess } from "../scope"
import type { Apply } from "../send"

const FRAMEWORK_PATTERNS = [
  /PHP\/[\d.]+/,
  /Python\/[\d.]+/,
  /Ruby\/[\d.]+/,
  /Node\/v[\d.]+/,
  /Express\/[\d.]+/,
  /ASP\.NET[^<]{0,20}[\d]+\.[\d]/,
  /Tomcat\/[\d.]+/,
  /Jetty\/[\d.]+/,
  /Django\/[\d.]+/,
  /Flask\/[\d.]+/,
  /Rails\/[\d.]+/,
  /Laravel/,
  /Spring(?:Boot)?/,
  /Werkzeug\/[\d.]+/,
  /CherryPy\/[\d.]+/,
  /Kestrel/,
  /Puma\/[\d.]+/,
  /Unicorn/,
  /Gunicorn\/[\d.]+/,
]

const PATH_PATTERNS = [
  /(?:\/(?:home|var|opt|usr|srv|app|www)\/[^\s<"']{5,})/g,
  /(?:[A-Z]:\\[^\s<"']{5,})/g,
]

function extract(body: string): string[] {
  const out: string[] = []
  for (const p of FRAMEWORK_PATTERNS) {
    const m = body.match(p)
    if (m) out.push(m[0])
  }
  for (const p of PATH_PATTERNS) {
    const matches = body.match(p)
    if (matches) out.push(...matches.slice(0, 3))
  }
  return out
}

// Send a request with a malformed Content-Type header to trigger a parsing error.
export const malformedContentType: ActiveRule = {
  id: "error-force-malformed-content-type",
  title: "Error forcing via malformed Content-Type",
  category: "recon",
  severity: "info",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (tx.request.method === "GET" || tx.request.method === "HEAD") continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const mutations: Apply.Mutation[] = [
        { op: "set-header", name: "content-type", value: "application/json; charset=\x00\x01\x02" },
      ]
      try {
        const res = await send(tx, { mutations })
        const resp = res.transaction.response
        if (!resp || resp.status < 400) continue
        const body = resp.body ?? ""
        const intel = extract(body)
        if (intel.length === 0) continue
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "info",
          category: "recon",
          title: "Malformed Content-Type forced error revealing server internals",
          evidence: `${key} → ${resp.status}: ${intel.join(", ")}`,
          dedupKey: `${this.id}:${key}`,
        })
      } catch {
        continue
      }
    }
    return out
  },
}

// Send a request with a syntactically broken JSON body to trigger a parse error.
export const malformedJson: ActiveRule = {
  id: "error-force-malformed-json",
  title: "Error forcing via malformed JSON body",
  category: "recon",
  severity: "info",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (tx.request.method === "GET" || tx.request.method === "HEAD") continue
      const ct = header(tx.request.headers, "content-type")
      if (!ct || !ct.includes("json")) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const mutations: Apply.Mutation[] = [
        { op: "set-body", value: '{"__broken": [,,,],"' },
      ]
      try {
        const res = await send(tx, { mutations })
        const resp = res.transaction.response
        if (!resp || resp.status < 400) continue
        const body = resp.body ?? ""
        const intel = extract(body)
        if (intel.length === 0) continue
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "info",
          category: "recon",
          title: "Malformed JSON body forced error revealing server internals",
          evidence: `${key} → ${resp.status}: ${intel.join(", ")}`,
          dedupKey: `${this.id}:${key}`,
        })
      } catch {
        continue
      }
    }
    return out
  },
}

// Send each of GET/POST/PUT/DELETE/PATCH/OPTIONS/TRACE to discover which methods are accepted
// and whether disallowed methods leak stack info.
export const methodEnum: ActiveRule = {
  id: "error-force-method-enum",
  title: "Method enumeration — accepted and error-leaking methods",
  category: "recon",
  severity: "info",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"]
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const accepted: string[] = []
      const leaky: string[] = []
      for (const method of METHODS) {
        if (method === tx.request.method) continue
        const mutations: Apply.Mutation[] = [{ op: "set-method", value: method }]
        try {
          const res = await send(tx, { mutations })
          const resp = res.transaction.response
          if (!resp) continue
          if (resp.status >= 200 && resp.status < 400) accepted.push(`${method}→${resp.status}`)
          if (resp.status >= 400) {
            const body = resp.body ?? ""
            const intel = extract(body)
            if (intel.length) leaky.push(`${method}→${resp.status}(${intel.join(",")})`)
          }
        } catch {
          continue
        }
      }
      if (accepted.length) {
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "info",
          category: "recon",
          title: "Additional HTTP methods accepted",
          evidence: `${key}: ${accepted.join(", ")}`,
          dedupKey: `${this.id}:${key}:accepted`,
        })
      }
      if (leaky.length) {
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "low",
          category: "recon",
          title: "Method error response leaks server internals",
          evidence: `${key}: ${leaky.join(", ")}`,
          dedupKey: `${this.id}:${key}:leaky`,
        })
      }
    }
    return out
  },
}

// Send an oversized body (1MB of repeated data) to trigger a size-limit error and harvest
// the framework/server name from the error page.
export const oversizedInput: ActiveRule = {
  id: "error-force-oversized-input",
  title: "Error forcing via oversized request body",
  category: "recon",
  severity: "info",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    const big = "A".repeat(1024 * 1024)
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (tx.request.method === "GET" || tx.request.method === "HEAD") continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const mutations: Apply.Mutation[] = [{ op: "set-body", value: big }]
      try {
        const res = await send(tx, { mutations })
        const resp = res.transaction.response
        if (!resp || resp.status < 400) continue
        const body = resp.body ?? ""
        const intel = extract(body)
        if (intel.length === 0) continue
        out.push({
          ruleId: this.id,
          transactionId: tx.id,
          severity: "info",
          category: "recon",
          title: "Oversized body forced error revealing server internals",
          evidence: `${key} → ${resp.status}: ${intel.join(", ")}`,
          dedupKey: `${this.id}:${key}`,
        })
      } catch {
        continue
      }
    }
    return out
  },
}

export const errorForcingRules: ActiveRule[] = [malformedContentType, malformedJson, methodEnum, oversizedInput]
