// Tier 0 — deterministic protocol/operation extraction.
//
// For body/header-dispatched protocols (GraphQL, JSON-RPC) the real "endpoint"
// is the OPERATION carried in the body, not the URL (`POST /graphql` is shared
// by every query/mutation). This module derives, with NO LLM and NO network, a
// stable per-operation identity so the dedup gate (Request.exists) treats each
// operation as its own unit — collapsing same-operation/different-values calls
// while keeping distinct operations distinct.
//
// The identity is STRUCTURAL (names only, values stripped): an inline literal
// `getUser(id: 5)` vs `getUser(id: 6)` must collapse, so we key on field/arg
// NAMES + variable KEY SHAPE, never on values. Key-shape (not values) still
// preserves mass-assignment signal (an extra input field changes the shape).

import { createHash } from "crypto"

export interface OperationInfo {
  protocol: "graphql" | "jsonrpc"
  operation: string // human label, e.g. "mutation:deleteUser", "user.delete"
  opKeyHash: string // 16-char dedup discriminator (values stripped)
}

const MAX_QUERY = 64 * 1024

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16)
}

const isIdentChar = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"
const isIdentStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === ","

// Sorted key PATHS of an object/array — keys only, values dropped. Bounded depth.
function keyPaths(obj: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 6 || obj === null || typeof obj !== "object") {
    if (prefix) out.push(prefix)
    return out
  }
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === "object" && obj[0] !== null) keyPaths(obj[0], prefix + "[]", out, depth + 1)
    else out.push(prefix + "[]")
    return out
  }
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    const p = prefix ? prefix + "." + k : k
    keyPaths((obj as Record<string, unknown>)[k], p, out, depth + 1)
  }
  return out
}

// Replace string literals (incl. block strings) with "" and drop # comments, so
// brace/paren depth tracking can't be fooled by `name: "mutation { x }"`.
function sanitizeGraphQL(q: string): string {
  let out = ""
  let i = 0
  const n = q.length
  while (i < n) {
    const c = q[i]!
    if (c === "#") {
      while (i < n && q[i] !== "\n") i++
      continue
    }
    if (c === '"') {
      if (q[i + 1] === '"' && q[i + 2] === '"') {
        i += 3
        while (i < n && !(q[i] === '"' && q[i + 1] === '"' && q[i + 2] === '"')) i++
        i += 3
      } else {
        i++
        while (i < n && q[i] !== '"') {
          if (q[i] === "\\") i++
          i++
        }
        i++
      }
      out += '""'
      continue
    }
    out += c
    i++
  }
  return out
}

interface GqlOp {
  opType: "query" | "mutation" | "subscription"
  operationName?: string
  rootFields: string[]
  argNames: string[]
}

// Collect argument NAMES inside an argument list `( ... )`. `start` is just past
// the `(`. Returns index after the matching `)`.
function collectArgs(s: string, start: number, argNames: Set<string>): number {
  let i = start
  let depth = 0
  const n = s.length
  while (i < n) {
    const c = s[i]!
    if (c === ")") {
      if (depth === 0) return i + 1
      depth--
      i++
      continue
    }
    if (c === "(" || c === "{" || c === "[") {
      depth++
      i++
      continue
    }
    if (c === "}" || c === "]") {
      depth--
      i++
      continue
    }
    if (depth === 0 && isIdentStart(c)) {
      let j = i
      while (j < n && isIdentChar(s[j]!)) j++
      const name = s.slice(i, j)
      let k = j
      while (k < n && isWs(s[k]!)) k++
      if (s[k] === ":") argNames.add(name) // only arg names (followed by ':')
      i = j
      continue
    }
    i++
  }
  return i
}

// Collect depth-1 field names + their arg names from a selection set. `start` is
// just past the operation's opening `{`. Nested selection sets are skipped.
function collectSelectionSet(s: string, start: number, rootFields: string[], argNames: Set<string>): void {
  let i = start
  let depth = 0
  const n = s.length
  while (i < n) {
    const c = s[i]!
    if (c === "}") {
      if (depth === 0) return
      depth--
      i++
      continue
    }
    if (c === "{") {
      depth++
      i++
      continue
    }
    if (depth === 0 && c === "." && s[i + 1] === "." && s[i + 2] === ".") {
      // fragment spread / inline fragment — record the spread name as a pseudo-field
      i += 3
      while (i < n && isWs(s[i]!)) i++
      let k = i
      while (k < n && isIdentChar(s[k]!)) k++
      const frag = s.slice(i, k)
      if (frag && frag !== "on") rootFields.push("..." + frag)
      i = k
      continue
    }
    if (depth === 0 && isIdentStart(c)) {
      let j = i
      while (j < n && isIdentChar(s[j]!)) j++
      let name = s.slice(i, j)
      i = j
      while (i < n && isWs(s[i]!)) i++
      if (s[i] === ":") {
        // alias → real field name follows
        i++
        while (i < n && isWs(s[i]!)) i++
        let k = i
        while (k < n && isIdentChar(s[k]!)) k++
        name = s.slice(i, k)
        i = k
        while (i < n && isWs(s[i]!)) i++
      }
      if (name) rootFields.push(name)
      if (s[i] === "(") i = collectArgs(s, i + 1, argNames)
      continue
    }
    i++
  }
}

function parseGraphQL(queryRaw: string): GqlOp | undefined {
  if (!queryRaw) return undefined
  const q = queryRaw.length > MAX_QUERY ? queryRaw.slice(0, MAX_QUERY) : queryRaw
  const s = sanitizeGraphQL(q)
  const firstBrace = s.indexOf("{")
  if (firstBrace < 0) return undefined

  let opType: GqlOp["opType"] = "query"
  let operationName: string | undefined
  let selStart = firstBrace

  const kw = s.match(/(?:^|[}\s(])(query|mutation|subscription)\b[ \t]*([A-Za-z0-9_]*)/)
  if (kw && (kw.index ?? 0) < firstBrace) {
    opType = kw[1] as GqlOp["opType"]
    operationName = kw[2] || undefined
    const after = s.indexOf("{", (kw.index ?? 0) + kw[0].length)
    if (after < 0) return undefined
    selStart = after
  }

  const rootFields: string[] = []
  const argNames = new Set<string>()
  collectSelectionSet(s, selStart + 1, rootFields, argNames)
  if (rootFields.length === 0) return undefined

  return {
    opType,
    operationName,
    rootFields: [...new Set(rootFields)].sort(),
    argNames: [...argNames].sort(),
  }
}

function graphqlFrom(query: string, variables: unknown): OperationInfo | undefined {
  const op = parseGraphQL(query)
  if (!op) return undefined
  let vars = variables
  if (typeof vars === "string") {
    try {
      vars = JSON.parse(vars)
    } catch {
      vars = undefined
    }
  }
  const varKeys = keyPaths(vars).sort()
  const label = op.rootFields.length
    ? `${op.opType}:${op.rootFields.join("+")}`
    : op.operationName
      ? `${op.opType}:${op.operationName}`
      : op.opType
  const key = ["graphql", op.opType, op.rootFields.join(","), op.argNames.join(","), varKeys.join(",")].join("\u0000")
  return { protocol: "graphql", operation: label, opKeyHash: sha16(key) }
}

function operationFromJson(obj: unknown): OperationInfo | undefined {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined
  const o = obj as Record<string, unknown>

  // GraphQL POST: { query, variables?, operationName? }. The false-positive guard
  // is that `query` must contain `{` and parse to at least one root field —
  // `POST /search {"query":"shoes"}` therefore stays REST.
  if (typeof o.query === "string" && o.query.includes("{")) {
    return graphqlFrom(o.query, o.variables)
  }

  // Automatic persisted queries (APQ) — only the hash is sent.
  const ext = o.extensions as Record<string, unknown> | undefined
  const apq = (ext?.persistedQuery as Record<string, unknown> | undefined)?.sha256Hash
  if (typeof apq === "string" && apq) {
    return { protocol: "graphql", operation: "apq:" + apq.slice(0, 8), opKeyHash: sha16("graphql-apq\u0000" + apq) }
  }

  // JSON-RPC: { jsonrpc?, method, params?, id? }
  if (typeof o.method === "string" && !("query" in o) && ("jsonrpc" in o || ("params" in o && "id" in o))) {
    const keyShape = keyPaths(o.params).sort()
    return {
      protocol: "jsonrpc",
      operation: o.method,
      opKeyHash: sha16("jsonrpc\u0000" + o.method + "\u0000" + keyShape.join(",")),
    }
  }

  return undefined
}

/**
 * Derive a protocol operation identity from a parsed request, or undefined for
 * plain REST (the caller then falls back to body_hash/query_hash dedup).
 * Deterministic, pure — safe for the tier0 parser.
 */
export function extractOperation(input: {
  method: string
  bodyContentType?: string
  body?: string
  query?: string // raw URL query string (without leading '?')
}): OperationInfo | undefined {
  const ct = input.bodyContentType ?? ""

  // GraphQL-over-GET: the query lives in the URL, not the body. (queryKeyHash
  // keys on param names only, so without this `?query=A` and `?query=B` would
  // wrongly collapse — the opKeyHash override fixes that downstream.)
  if (input.method === "GET" && input.query) {
    const params = new URLSearchParams(input.query)
    const q = params.get("query")
    if (q && q.includes("{")) return graphqlFrom(q, params.get("variables"))
    return undefined
  }

  // application/graphql — the raw body IS the query string.
  if (ct === "application/graphql" && input.body) return graphqlFrom(input.body, undefined)

  // JSON body — GraphQL or JSON-RPC, single or batched.
  if (input.body && (ct.includes("json") || ct === "")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.body)
    } catch {
      return undefined
    }
    if (Array.isArray(parsed)) {
      const members = parsed.map(operationFromJson).filter((m): m is OperationInfo => m != null)
      if (members.length === 0) return undefined
      const proto = members[0]!.protocol
      const ops = members.map((m) => m.operation).sort()
      return {
        protocol: proto,
        operation: `batch[${ops.join(",")}]`,
        opKeyHash: sha16(proto + "\u0000batch\u0000" + members.map((m) => m.opKeyHash).sort().join(",")),
      }
    }
    return operationFromJson(parsed)
  }

  return undefined
}
