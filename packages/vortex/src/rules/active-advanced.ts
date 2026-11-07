// Advanced active rules — deterministic probes that send mutated requests to surface access-control
// bypasses, CSRF surface, and web cache deception. Each rule bounds itself to one probe per endpoint
// and handles transport errors gracefully (no signal on failure, never throws).
import type { Transaction } from "../transaction"
import { header } from "../transaction"
import type { Signal } from "../rule"
import type { ActiveRule, Sender } from "../active"
import { endpointKey } from "../endpoint"
import { isSuccess } from "../scope"
import type { Apply } from "../send"

// Re-send a 403/405 endpoint with method-override headers. If the server honours the override and
// returns 2xx, verb-based access control is bypassable — the original method was blocked at the
// routing layer but the override header reached the handler.
export const methodOverride: ActiveRule = {
  id: "method-override-bypass",
  title: "Method override bypasses access control",
  category: "access-control",
  severity: "high",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const tx of txs) {
      if (!tx.response) continue
      const status = tx.response.status
      if (status !== 403 && status !== 405) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const method = tx.request.method
      const names = ["x-http-method-override", "x-method-override", "x-http-method"]
      const mutations: Apply.Mutation[] = names.map((name) => ({ op: "set-header" as const, name, value: method }))
      // Also set method to GET — the override header carries the real verb.
      mutations.push({ op: "set-method", value: "GET" })
      try {
        const { result } = await send(tx, { mutations })
        const code = result.response?.status
        if (code === undefined) continue
        if (code >= 200 && code < 300) {
          out.push({
            ruleId: this.id,
            transactionId: tx.id,
            severity: "high",
            category: "access-control",
            title: "Method override header bypassed access control",
            evidence: `${key} returned ${status} normally but ${code} with X-HTTP-Method-Override: ${method}`,
            dedupKey: `${this.id}:${key}`,
          })
        }
      } catch {
        continue
      }
    }
    return out
  },
}

// For JSON POST endpoints that returned 2xx, re-send the same data as form-urlencoded. If the
// server still returns 2xx, it's Content-Type agnostic — which means a plain HTML form can trigger
// the same state-changing action (CSRF surface, since forms cannot send application/json).
export const contentTypeBypass: ActiveRule = {
  id: "content-type-csrf-surface",
  title: "JSON endpoint also accepts form-encoded (CSRF surface)",
  category: "misconfiguration",
  severity: "medium",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (tx.request.method === "GET" || tx.request.method === "HEAD") continue
      const ct = header(tx.request.headers, "content-type")
      if (!ct || !ct.includes("application/json")) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const mutations: Apply.Mutation[] = [
        { op: "set-header", name: "content-type", value: "application/x-www-form-urlencoded" },
      ]
      try {
        const { result } = await send(tx, { mutations })
        const code = result.response?.status
        if (code === undefined) continue
        if (code >= 200 && code < 300) {
          out.push({
            ruleId: this.id,
            transactionId: tx.id,
            severity: "medium",
            category: "misconfiguration",
            title: "JSON endpoint also accepts form-encoded — CSRF surface",
            evidence: `${key} returned ${code} with Content-Type: application/x-www-form-urlencoded (originally application/json)`,
            dedupKey: `${this.id}:${key}`,
          })
        }
      } catch {
        continue
      }
    }
    return out
  },
}

const STATIC_SUFFIXES = [".css", ".js", ".png", ".svg", ".ico"]

// Web cache deception: for authenticated endpoints returning user-specific 200 responses, append a
// static file extension to the path (.css, .js, .png). If the response still returns 200 with the
// same body, a CDN/proxy in front may cache the response under the static path — any visitor can
// then retrieve it. One probe per endpoint.
export const cacheDeception: ActiveRule = {
  id: "web-cache-deception",
  title: "Web cache deception — authenticated response cacheable under static path",
  category: "access-control",
  severity: "high",
  async probe(txs: Transaction[], send: Sender): Promise<Signal[]> {
    const out: Signal[] = []
    const seen = new Set<string>()
    for (const tx of txs) {
      if (!isSuccess(tx)) continue
      if (tx.request.method !== "GET") continue
      if (!tx.identity || tx.identity === "(anonymous)") continue
      if (!tx.response?.body || tx.response.body.length < 50) continue
      const key = endpointKey(tx)
      if (seen.has(key)) continue
      seen.add(key)
      const target = tx.request.url
      if (!target) continue
      for (const ext of STATIC_SUFFIXES) {
        const mutations: Apply.Mutation[] = [{ op: "set-target", value: target + ext }]
        try {
          const { result } = await send(tx, { mutations })
          const code = result.response?.status
          if (code === undefined) continue
          if (code < 200 || code >= 300) continue
          if (!result.response?.body || result.response.body.length < 50) continue
          // If the body length is within 10% of the original, the static-suffixed path returned
          // the same dynamic content — a cache deception vector.
          const ratio = result.response.body.length / tx.response!.body!.length
          if (ratio > 0.9 && ratio < 1.1) {
            out.push({
              ruleId: this.id,
              transactionId: tx.id,
              severity: "high",
              category: "access-control",
              title: "Web cache deception — authenticated response served under static path",
              evidence: `${key}${ext} returned ${code} with similar body (${result.response.body.length} vs ${tx.response!.body!.length} bytes) — a cache proxy may serve this to unauthenticated visitors`,
              dedupKey: `${this.id}:${key}`,
            })
            break
          }
        } catch {
          continue
        }
      }
    }
    return out
  },
}

export const advancedActiveRules: ActiveRule[] = [methodOverride, contentTypeBypass, cacheDeception]
