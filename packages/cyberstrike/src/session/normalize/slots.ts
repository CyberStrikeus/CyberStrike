// Faz 2 — unified value-slot extraction.
//
// Every request, regardless of protocol, reduces to a flat list of concrete
// input values (ParamSlot[]): the path placeholders' values, the query params,
// and the body leaves. This is the substrate for observed-value accumulation —
// the redactor (redact.ts) then decides which concrete values may be retained,
// and later phases tag them idLike / reference / self-vs-foreign.
//
// Protocol shapes the BODY walk only:
//   REST     → every JSON body leaf
//   JSON-RPC → leaves under `params` (the dispatch envelope is not data)
//   GraphQL  → leaves of `variables` (inline arg values are deferred to Faz 7)
// Path and query extraction are protocol-independent.

import type { ParamSlot } from "./types"
import { extractInlineArgs } from "./graphql-inline"

const MAX_DEPTH = 6
const MAX_SLOTS = 64 // hard cap before redactor's tighter MAX_PARAMS; guards pathological bodies

// Concrete leaf values of a JSON value, keyed by sorted dot/`[]` path — the same
// vocabulary keyPaths() uses for the key-shape, but carrying the value too.
function jsonLeaves(value: unknown, prefix: string, out: ParamSlot[], depth: number): void {
  if (out.length >= MAX_SLOTS) return
  if (value === null || typeof value !== "object") {
    if (prefix) out.push({ loc: "body", name: prefix, value: scalarToString(value) })
    return
  }
  if (depth >= MAX_DEPTH) return
  if (Array.isArray(value)) {
    // Sample the first element's shape (matches keyPaths()); index is collapsed to [].
    if (value.length > 0) jsonLeaves(value[0], prefix + "[]", out, depth + 1)
    return
  }
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    jsonLeaves((value as Record<string, unknown>)[k], prefix ? prefix + "." + k : k, out, depth + 1)
  }
}

function scalarToString(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "boolean" || typeof v === "number") return String(v)
  return ""
}

// Path placeholder values: zip the template (/user/{id}) against the canonical
// path (/user/42) so {id} → "42". Only placeholder segments become slots.
function pathSlots(normalizedPath: string, canonicalPath: string): ParamSlot[] {
  const t = normalizedPath.split("/")
  const c = canonicalPath.split("/")
  const out: ParamSlot[] = []
  for (let i = 0; i < t.length; i++) {
    const seg = t[i]!
    if (seg.length > 2 && seg[0] === "{" && seg[seg.length - 1] === "}" && c[i] != null && c[i] !== "") {
      out.push({ loc: "path", name: seg.slice(1, -1), value: c[i]! })
    }
  }
  return out
}

function querySlots(query: string | undefined): ParamSlot[] {
  if (!query) return []
  const out: ParamSlot[] = []
  for (const [name, value] of new URLSearchParams(query)) out.push({ loc: "query", name, value })
  return out
}

// tRPC wraps inputs in a `{ json: ... }` envelope, batched under numeric keys
// (`{"0":{"json":{id:1}}}`). The method lives in the URL, so for value extraction
// we descend the envelope to the real input — otherwise ids hide under
// `0.json.id`. Returns the unwrapped value, or the input unchanged.
function unwrapTRPC(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed
  const o = parsed as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
    const merged: Record<string, unknown> = {}
    for (const k of keys) {
      const j = (o[k] as Record<string, unknown> | undefined)?.json
      if (j && typeof j === "object") Object.assign(merged, j)
    }
    if (Object.keys(merged).length > 0) return merged
  }
  if (o.json && typeof o.json === "object") return o.json
  return parsed
}

function bodySlots(
  body: string | undefined,
  contentType: string | undefined,
  protocol: string | undefined,
): ParamSlot[] {
  if (!body || !(contentType ?? "").includes("json")) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  const out: ParamSlot[] = []
  if (protocol === "jsonrpc") {
    const params = (parsed as Record<string, unknown>)?.params
    jsonLeaves(params, "", out, 0)
  } else if (protocol === "graphql") {
    const vars = (parsed as Record<string, unknown>)?.variables
    jsonLeaves(vars, "", out, 0)
    // Inline literal arg values (getUser(id:"3")) — merged with variable values so
    // both forms feed one IDOR pool. Fail-safe: [] on any parse error. Dedup by name
    // so a variable-provided arg isn't double-counted by a same-named inline.
    const query = (parsed as Record<string, unknown>)?.query
    if (typeof query === "string") {
      const seen = new Set(out.map((s) => s.name))
      for (const slot of extractInlineArgs(query)) {
        if (!seen.has(slot.name)) {
          out.push(slot)
          seen.add(slot.name)
        }
      }
    }
  } else {
    // REST (incl. tRPC, whose method is in the URL) — unwrap the tRPC envelope first.
    jsonLeaves(unwrapTRPC(parsed), "", out, 0)
  }
  return out
}

export interface SlotInput {
  normalizedPath: string
  canonicalPath: string
  query: string | undefined
  body: string | undefined
  contentType: string | undefined
  protocol: string | undefined
}

/** Deterministic, pure. Order: path, query, body. Bounded by MAX_SLOTS. */
export function extractSlots(input: SlotInput): ParamSlot[] {
  const slots = [
    ...pathSlots(input.normalizedPath, input.canonicalPath),
    ...querySlots(input.query),
    ...bodySlots(input.body, input.contentType, input.protocol),
  ]
  return slots.slice(0, MAX_SLOTS)
}
