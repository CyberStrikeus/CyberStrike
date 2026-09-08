// Subjects — the deterministic "who / what / which" of a transaction, extracted from EVERYWHERE a
// value can live: the URI path, the query, id-ish headers, and the request body INCLUDING nested
// structures (via the flattened dotpath field map from params/body). Plus two protocol-aware paths:
// GraphQL (all operations ride one POST /graphql — the real function is the operation's root field,
// the objects are its id-shaped variables) and JWT (the Authorization bearer carries the acting
// principal + roles + scopes, the RBAC truth). This is the parser layer that lets a Signal be
// self-describing — function (operation), objects (resources), role/roles/scopes (identity) — so an
// agent CONSUMES that context instead of authoring it. Pure + no I/O; heuristic, erring toward recall.
import type { Transaction } from "./transaction"
import { header } from "./transaction"
import { identifierShape, endpointKey, type IdShape } from "./endpoint"
import { params } from "./params"
import { graphql, type GraphQL } from "./graphql"

export type Site = "path" | "query" | "header" | "body"
export type Crud = "create" | "read" | "update" | "delete"

export interface ObjectRef {
  ref: string // "users:42" — resource:value, the handle for cross-identity / IDOR reasoning
  value: string
  shape: IdShape | "opaque" // opaque = an id-ish NAMED field whose value isn't a standard id shape
  in: Site
  name?: string // param name / dotpath / header name / graphql variable
  resource?: string // best-effort resource noun
}

export interface Subjects {
  function: { method: string; endpoint: string; crud: Crud } // the operation (BFLA axis)
  role?: string // the principal it ran under — tx.identity, else the JWT subject (RBAC axis)
  roles?: string[] // JWT roles/authorities, when present (privilege reasoning)
  scopes?: string[] // JWT/OAuth scopes, when present
  objects: ObjectRef[] // the resources it touches (BOLA/IDOR axis)
}

const CRUD: Record<string, Crud> = { GET: "read", HEAD: "read", POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" }
const crudOf = (method: string): Crud => CRUD[method.toUpperCase()] ?? "read"

// ── id-name / resource-noun heuristics ─────────────────────────────────────
function idishKey(key: string): boolean {
  const last = key.split(/[._\-]/).pop() ?? key // header names hyphenate (x-tenant-id), params dot/underscore
  return /^(id|ids|uuid|guid|oid|sid|pid|gid|ref|slug|no|num|code)$/i.test(last) || /[a-z0-9]Id$/.test(key) || /[_\-]id$/i.test(key)
}
const ID_WORD = /^(id|ids|uuid|guid|oid|sid|pid|gid|ref|no|num|code)$/i
function stripLeaf(leaf: string): string {
  return leaf
    .replace(/(Id|Ids|Uuid|Guid)$/, "") // camelCase (case-sensitive: "valid" not trimmed to "val")
    .replace(/[._-](?:id|ids|uuid|guid|oid|sid|pid|gid|ref|no|num|code)$/i, "") // separator + id-word (won't eat mid-word)
    .replace(/[._-]+$/, "") // drop any dangling separator ("x-account-")
}
function resourceOf(key: string): string {
  const parts = key.split(".")
  const leaf = parts[parts.length - 1] ?? key
  let r = ID_WORD.test(leaf) ? "" : stripLeaf(leaf)
  if (!r) {
    for (let i = parts.length - 2; i >= 0; i--) {
      if (!/^\d+$/.test(parts[i]!)) {
        r = parts[i]!
        break
      }
    }
  }
  return (r || leaf).toLowerCase()
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const q = url.indexOf("?")
    return q === -1 ? url : url.slice(0, q)
  }
}

// ── object collectors (each returns ObjectRefs; the caller dedups) ─────────
function pathObjects(tx: Transaction): ObjectRef[] {
  const out: ObjectRef[] = []
  const segs = pathname(tx.request.url).split("/").filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const shape = identifierShape(segs[i]!)
    if (!shape) continue
    const resource = i > 0 ? segs[i - 1]!.toLowerCase() : undefined
    out.push({ ref: `${resource ?? "path"}:${segs[i]}`, value: segs[i]!, shape, in: "path", name: resource, resource })
  }
  return out
}

function mapObjects(map: Record<string, string>, where: Site): ObjectRef[] {
  const out: ObjectRef[] = []
  for (const [name, value] of Object.entries(map)) {
    if (!value) continue
    const shape = identifierShape(value)
    if (!idishKey(name) && shape !== "uuid" && shape !== "objectid") continue
    const resource = resourceOf(name) || undefined
    out.push({ ref: `${resource ?? name}:${value}`, value, shape: shape ?? "opaque", in: where, name, resource })
  }
  return out
}

function headerObjects(tx: Transaction): ObjectRef[] {
  const out: ObjectRef[] = []
  for (const h of tx.request.headers) {
    if (!idishKey(h.name)) continue
    const shape = identifierShape(h.value)
    if (!shape) continue
    const resource = resourceOf(h.name) || undefined
    out.push({ ref: `${resource ?? h.name}:${h.value}`, value: h.value, shape, in: "header", name: h.name, resource })
  }
  return out
}

// ── GraphQL awareness ──────────────────────────────────────────────────────
const GQL_VERB = /^(create|add|new|insert|register|signup|update|edit|set|change|modify|patch|upsert|delete|remove|destroy|drop|get|list|fetch|read|find|search|all)/i
function graphqlOp(gql: GraphQL): { type: "query" | "mutation" | "subscription"; rootField?: string } {
  const m = gql.query.match(/\b(query|mutation|subscription)\b/i)
  const type = (m ? m[1]!.toLowerCase() : "query") as "query" | "mutation" | "subscription"
  const brace = gql.query.indexOf("{") // the operation's selection set opener (after any $var defs)
  const rootField = brace >= 0 ? (gql.query.slice(brace + 1).match(/[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? undefined) : undefined
  return { type, rootField }
}
function graphqlCrud(op: { type: string; rootField?: string }): Crud {
  const v = (op.rootField ?? "").toLowerCase()
  if (/^(create|add|new|insert|register|signup)/.test(v)) return "create"
  if (/^(update|edit|set|change|modify|patch|upsert)/.test(v)) return "update"
  if (/^(delete|remove|destroy|drop)/.test(v)) return "delete"
  if (/^(get|list|fetch|read|find|search|all)/.test(v)) return "read"
  return op.type === "mutation" ? "update" : "read" // subscription/query → read; unknown mutation → update
}
function graphqlResource(rootField?: string): string | undefined {
  if (!rootField) return undefined
  const r = rootField.replace(GQL_VERB, "")
  return (r || rootField).toLowerCase()
}
function graphqlObjects(tx: Transaction, op: { rootField?: string }): ObjectRef[] {
  const out: ObjectRef[] = []
  const opResource = graphqlResource(op.rootField)
  for (const [name, value] of Object.entries(params(tx).body)) {
    if (!name.startsWith("variables.") || !value) continue
    const varPath = name.slice("variables.".length)
    const shape = identifierShape(value)
    if (!idishKey(varPath) && shape !== "uuid" && shape !== "objectid") continue
    // a bare "id" variable takes the operation's resource ("updateOrder" → order); a named one keeps its own
    const resource = (ID_WORD.test(varPath.split(".").pop() ?? varPath) ? opResource : resourceOf(varPath)) ?? opResource ?? varPath
    out.push({ ref: `${resource}:${value}`, value, shape: shape ?? "opaque", in: "body", name, resource })
  }
  return out
}

// ── JWT claims (RBAC truth) ─────────────────────────────────────────────────
function bearerClaims(tx: Transaction): Record<string, unknown> | undefined {
  const auth = header(tx.request.headers, "authorization")
  if (!auth) return undefined
  const seg = auth.replace(/^Bearer\s+/i, "").trim().split(".")[1]
  if (!seg) return undefined
  try {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(seg.length / 4) * 4, "=")
    const obj = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
function pickStr(c: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!c) return undefined
  for (const k of keys) if (typeof c[k] === "string" && c[k]) return c[k] as string
  return undefined
}
function claimRoles(c: Record<string, unknown> | undefined): string[] | undefined {
  if (!c) return undefined
  const realm = c.realm_access as { roles?: unknown } | undefined
  const raw = c.roles ?? c.authorities ?? realm?.roles
  const arr = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : typeof raw === "string" ? [raw] : []
  return arr.length ? arr : undefined
}
function claimScopes(c: Record<string, unknown> | undefined): string[] | undefined {
  if (!c) return undefined
  const raw = c.scope ?? c.scp
  const arr = typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []
  return arr.length ? arr : undefined
}

// ── the extractor ───────────────────────────────────────────────────────────
export function subjects(tx: Transaction): Subjects {
  const claims = bearerClaims(tx)
  const identity = { role: tx.identity ?? pickStr(claims, "sub", "preferred_username", "email", "upn"), roles: claimRoles(claims), scopes: claimScopes(claims) }

  const gql = graphql(tx)
  if (gql) {
    const op = graphqlOp(gql)
    return {
      function: { method: tx.request.method.toUpperCase(), endpoint: endpointKey(tx) + (op.rootField ? `#${op.rootField}` : ""), crud: graphqlCrud(op) },
      objects: dedup([...graphqlObjects(tx, op), ...headerObjects(tx)]),
      ...identity,
    }
  }

  const p = params(tx)
  return {
    function: { method: tx.request.method.toUpperCase(), endpoint: endpointKey(tx), crud: crudOf(tx.request.method) },
    objects: dedup([...pathObjects(tx), ...mapObjects(p.query, "query"), ...mapObjects(p.body, "body"), ...headerObjects(tx)]),
    ...identity,
  }
}

function dedup(refs: ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>()
  const out: ObjectRef[] = []
  for (const o of refs) {
    const k = `${o.in}:${o.name ?? ""}:${o.value}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(o)
  }
  return out
}
