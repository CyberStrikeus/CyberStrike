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
import { extractInlineArgPaths } from "./graphql-inline"

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

// Relay global IDs are base64("Type:localId") (or "Type\nlocalId"). Decode and
// return the TYPE — the real endpoint discriminator that `node(id:)` hides in the
// value. undefined when not a decodable global id.
export function relayType(globalId: string): string | undefined {
  if (typeof globalId !== "string" || globalId.length < 6 || !/^[A-Za-z0-9+/=_-]+$/.test(globalId)) return undefined
  try {
    const decoded = Buffer.from(globalId.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    const m = decoded.match(/^([A-Za-z][A-Za-z0-9_]*)[:\n]/)
    return m ? m[1]! : undefined
  } catch {
    return undefined
  }
}

// Polymorphic GraphQL fields whose `id` value selects the object TYPE — Relay's
// node()/nodes() pattern. Without promoting the type, every node() call collapses
// to one endpoint (showstopper S2: cross-type BOLA becomes invisible).
const GQL_DISPATCH_FIELDS: ReadonlySet<string> = new Set(["node", "nodes"])

function graphqlDispatcher(rootFields: string[], query: string, vars: Record<string, unknown> | undefined): string {
  if (!rootFields.some((f) => GQL_DISPATCH_FIELDS.has(f))) return ""
  let idVal: string | undefined
  const cand = vars?.id ?? vars?.ids
  if (typeof cand === "string") idVal = cand
  else if (Array.isArray(cand) && typeof cand[0] === "string") idVal = cand[0]
  else {
    const m = query.match(/\bnodes?\s*\(\s*ids?\s*:\s*\[?\s*"([^"]+)"/)
    idVal = m?.[1]
  }
  const t = idVal ? relayType(idVal) : undefined
  return t ? "node-type:" + t : ""
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
  // Unify inline vs variable: an arg supplied inline (product(id:"88")) and via a
  // variable (product(id:$id)) must collapse to one operation. varKeys carries the
  // variable-supplied key-paths; extractInlineArgPaths carries the inline ones —
  // their union is the same regardless of how the value was supplied.
  const varKeys = [...new Set([...keyPaths(vars), ...extractInlineArgPaths(query)])].sort()
  const label = op.rootFields.length
    ? `${op.opType}:${op.rootFields.join("+")}`
    : op.operationName
      ? `${op.opType}:${op.operationName}`
      : op.opType
  // Drop __typename: clients add it inconsistently, so it must not fragment the key.
  const rootFields = op.rootFields.filter((f) => f !== "__typename")
  // Conditionally append the dispatcher discriminator so node()/nodes() splits by
  // Relay type (node(User:) ≠ node(Order:)); other operations keep the plain key.
  const keyParts = ["graphql", op.opType, rootFields.join(","), op.argNames.join(","), varKeys.join(",")]
  const dispatch = graphqlDispatcher(rootFields, query, vars as Record<string, unknown> | undefined)
  if (dispatch) keyParts.push(dispatch)
  const operation = dispatch ? `${label}(${dispatch})` : label
  return { protocol: "graphql", operation, opKeyHash: sha16(keyParts.join("<|>")) }
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
    return { protocol: "graphql", operation: "apq:" + apq.slice(0, 8), opKeyHash: sha16("graphql-apq<|>" + apq) }
  }

  // JSON-RPC: { jsonrpc?, method, params?, id? }
  if (typeof o.method === "string" && !("query" in o) && ("jsonrpc" in o || ("params" in o && "id" in o))) {
    const keyShape = keyPaths(o.params).sort()
    // Generic dispatch envelope: when method is invoke/dispatch/call/execute the
    // REAL operation is a value in params (fn/action/method/op). Promote it into the
    // key so `invoke(fn:deleteUser)` ≠ `invoke(fn:getProfile)` (showstopper S2).
    const disc = rpcDispatcher(o.method, o.params)
    const keyParts = ["jsonrpc", o.method, keyShape.join(",")]
    if (disc) keyParts.push(disc)
    return {
      protocol: "jsonrpc",
      operation: disc ? `${o.method}(${disc})` : o.method,
      opKeyHash: sha16(keyParts.join("<|>")),
    }
  }

  return undefined
}

const RPC_DISPATCH_METHODS: ReadonlySet<string> = new Set(["invoke", "dispatch", "call", "execute", "exec", "run"])
const RPC_DISPATCH_PARAMS = ["method", "fn", "function", "action", "op", "operation", "cmd", "command", "procedure"]

function rpcDispatcher(method: string, params: unknown): string {
  if (!RPC_DISPATCH_METHODS.has(method.toLowerCase())) return ""
  if (!params || typeof params !== "object" || Array.isArray(params)) return ""
  const p = params as Record<string, unknown>
  for (const k of RPC_DISPATCH_PARAMS) {
    const v = p[k]
    if (typeof v === "string" && v) return `${k}:${v}`
  }
  return ""
}

/**
 * Structural key-shape hash of a JSON request body (Faz 1) — sorted key PATHS,
 * VALUES STRIPPED. This is the REST counterpart of opKeyHash: it lets the dedup
 * gate collapse same-shape/different-values mutations (`POST /users {a:1}` vs
 * `{a:2}`) while keeping a different shape (an extra `role` field — the
 * mass-assignment signal) distinct. Returns undefined for non-JSON or empty
 * bodies, where the caller falls back to the value-bearing body_hash.
 */
export function bodyKeyShapeHash(body: string | undefined, contentType: string | undefined): string | undefined {
  if (!body || !(contentType ?? "").includes("json")) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const paths = keyPaths(parsed).sort()
  if (paths.length === 0) return undefined
  return sha16("rest-shape<|>" + paths.join(","))
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
        opKeyHash: sha16(proto + "<|>batch<|>" + members.map((m) => m.opKeyHash).sort().join(",")),
      }
    }
    return operationFromJson(parsed)
  }

  return undefined
}
