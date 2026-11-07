// Injection-point inventory — Phase 1 of the injection probe pipeline (issue #141). Enumerate EVERY
// attacker-controllable input on a transaction so the engine can probe each one deterministically,
// instead of handing the agent a flat request. One row per point: a query param, a body field by
// dotpath (nested objects AND array elements, via the flattened body model), an id-shaped path
// segment, or an injectable header. These get PERSISTED (store `addInjectPoints`) so coverage is
// auditable ("which parameter was tested") and so probing can run off the inventory, not ad-hoc.
//
// This module only ENUMERATES + types the points. Active probing (send payloads per point) and
// probe→signal are later phases; a point carries enough (location + dotpath + sample + type) to
// build the mutation there.
import type { Transaction } from "./transaction"
import { params } from "./params"

export type InjectLocation = "query" | "body" | "path" | "header"
export type ValueType = "string" | "number" | "uuid" | "objectid" | "bool" | "json" | "empty"

export interface InjectPoint {
  // Stable identity: (transaction, location, dotpath). Session scoping is the store's job.
  id: string
  session?: string
  transactionId: string
  location: InjectLocation
  // Addresses the exact input: query key · body dotpath (`params.filters.0.value`) · path segment
  // index (as a string) · header name (lowercased).
  dotpath: string
  // Human label: the query/body key's leaf, the path resource, or the header name.
  name?: string
  // Observed value, for baseline diffing + type inference. Undefined only when genuinely absent.
  valueSample?: string
  valueType: ValueType
  // Coverage flag (set by later phases once the point has been probed). Absent = not yet probed.
  probed?: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OBJECTID = /^[0-9a-f]{24}$/i
const NUMERIC = /^-?\d+(?:\.\d+)?$/
const LONGHEX = /^[0-9a-f]{16,}$/i

export function valueType(v: string): ValueType {
  if (v === "") return "empty"
  if (UUID.test(v)) return "uuid"
  if (OBJECTID.test(v)) return "objectid"
  if (NUMERIC.test(v)) return "number"
  if (v === "true" || v === "false") return "bool"
  const t = v.trim()
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) return "json"
  return "string"
}

// A path segment worth probing = one that looks like a VALUE (an id/variable), not a static route
// word. Static words ("review", "api", "dashboard") are the route, not input; id-shaped segments
// ({uuid}, a numeric id, an objectid, a long hex token) are the attacker-controllable path input.
function isVariableSegment(seg: string): boolean {
  return UUID.test(seg) || OBJECTID.test(seg) || NUMERIC.test(seg) || LONGHEX.test(seg)
}

// Headers an interpreter/back end commonly consumes from client-controlled values — the injectable
// header surface (host-routing, forwarding, redirect, referer). Conservative on purpose: probing
// every header would be noise. Only those actually present on the request become points.
const INJECTABLE_HEADERS = new Set([
  "referer",
  "user-agent",
  "origin",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "forwarded",
  "x-original-url",
  "x-rewrite-url",
])

// Cap per transaction so a pathological deeply-nested body can't explode the inventory.
const MAX_POINTS = 500

function pathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    const noQuery = q === -1 ? url : url.slice(0, q)
    return noQuery.startsWith("http") ? noQuery.replace(/^[a-z]+:\/\/[^/]+/i, "") : noQuery
  }
}

function key(transactionId: string, location: InjectLocation, dotpath: string): string {
  return `${transactionId}:${location}:${dotpath}`
}

// Enumerate every injection point on a transaction. Pure — derives from the request only; the store
// persists the result. Deterministic order: query, body, path, header.
export function injectPoints(tx: Transaction): InjectPoint[] {
  const out: InjectPoint[] = []
  const push = (location: InjectLocation, dotpath: string, value: string | undefined, name?: string) => {
    if (out.length >= MAX_POINTS) return
    out.push({
      id: key(tx.id, location, dotpath),
      session: tx.session,
      transactionId: tx.id,
      location,
      dotpath,
      name,
      valueSample: value,
      valueType: valueType(value ?? ""),
    })
  }

  const p = params(tx)
  for (const k in p.query) push("query", k, p.query[k], k)
  for (const k in p.body) push("body", k, p.body[k], k.split(".").pop())

  // Path segment index MUST match Mutate.setPathParam's convention: it splits on "/" WITHOUT
  // dropping the empty leading segment, so `/a/b` → ["", "a", "b"] and `b` is index 2. Keep the
  // leading "" here so a point's dotpath is directly usable as the set-path-param index in probing.
  const segs = pathname(tx.request.url).split("/")
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    if (seg && isVariableSegment(seg)) push("path", String(i), seg, segs[i - 1] || undefined)
  }

  for (const h of tx.request.headers) {
    const lower = h.name.toLowerCase()
    if (INJECTABLE_HEADERS.has(lower)) push("header", lower, h.value, lower)
  }

  return out
}

// Dedup identity, exported so a store keys rows the same way the enumerator does.
export function injectPointKey(pt: InjectPoint): string {
  return key(pt.transactionId, pt.location, pt.dotpath)
}

// Per-(param, payload-class) probe outcome — the auditable "which parameter was tested, with what,
// and what happened" record (issue #9 phase 4). One row per class attempted against a point.
export interface Coverage {
  paramId: string // InjectPoint.id
  transactionId: string
  payloadClass: string // e.g. "sqli-error"
  result: "hit" | "clean"
  // Which probe strategy determined the outcome: "full" = all sibling params kept (realistic
  // context); "isolated" = other value params blanked to reach a sink a sibling was masking. On a
  // hit, the confirming strategy; on clean, "isolated" (both were tried).
  strategy?: "full" | "isolated"
  signalId?: string // the produced signal's dedupKey, when result === "hit"
  at: number // epoch ms
}

export function coverageKey(c: Coverage): string {
  return `${c.paramId}:${c.payloadClass}`
}
