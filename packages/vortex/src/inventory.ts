// Inventory — the corpus-wide object & function graph, so an agent can QUERY "which objects/
// functions exist and who touched them" instead of re-deriving per request. It aggregates
// subjects() across every transaction and canonicalizes by VALUE: the same object ref ("order:42")
// seen in many transactions is ONE record, carrying which roles accessed it, through which
// functions, in which transactions. That aggregation is where the deterministic IDOR/BFLA leads
// fall out for free: an object touched under >1 role, or a function called by >1 role.
import type { TrafficStore } from "./store"
import type { Source } from "./transaction"
import { subjects } from "./subjects"
import type { Crud } from "./subjects"
import { params, responseFields as txResponseFields } from "./params"

// How a role reached a function or object: "crawl" = organically via browser navigation (the
// link was in the UI), "forced" = only via replay/probe/import (not seen during crawl), "both" =
// seen during crawl AND later replayed. When EVERY role's provenance is "crawl" on a cross-role
// candidate, the endpoint is likely shared by design (both roles navigate to it in the UI) and a
// 2xx under either identity is expected — not a BFLA finding. When one role is "crawl" and
// another is "forced" (or absent from crawl), that's the real authorization lead.
export type RoleProvenance = "crawl" | "forced" | "both"

// Transaction sources that count as organic navigation (the user/crawler discovered this endpoint
// through normal browsing). "proxy" counts because it's the user's own browser via MITM — just as
// organic as the extension.
const CRAWL_SOURCES: ReadonlySet<Source> = new Set(["browser", "proxy"])

export interface ObjectRecord {
  ref: string // "order:42"
  resource: string
  value: string
  shapes: string[] // id shapes seen (uuid/int/…)
  roles: string[] // identities/JWT-subjects that accessed it — >1 ⇒ IDOR/BOLA candidate
  roleProvenance: Record<string, RoleProvenance>
  endpoints: string[] // functions it appeared in
  sites: string[] // where it lived (path/query/body/header)
  transactions: string[] // every tx touching it (→ send() to replay under another role)
  fields: string[] // all field names from request + response body across transactions
  sensitiveFields: string[] // subset matching SENSITIVE_RE
  idFields: string[] // subset matching ID_RE
}

export interface FunctionRecord {
  endpoint: string // "GET app.test/api/orders/{id}" (or "…/graphql#updateOrder")
  crud: Crud
  roles: string[] // identities that called it — >1 ⇒ BFLA surface to check
  roleProvenance: Record<string, RoleProvenance>
  objects: string[] // object refs it touched
  transactions: string[]
  requestFields: string[] // all request body/query param names
  responseFields: string[] // all response body field names
  hiddenInputs: string[] // hidden input names from HTML response
}

export interface Inventory {
  objects: ObjectRecord[]
  functions: FunctionRecord[]
}

const SENSITIVE_RE = /^(password|passwd|pwd|secret|token|api_?key|private_?key|access_?key|ssn|social_?security|credit_?card|card_?number|cvv|cvc|pin|auth|authorization|session|cookie|bearer)/i
const ID_RE = /(_id|Id|_uuid|_ref|_key)$|^id$/i
const HIDDEN_PREFIX = "hidden."

function isSensitive(name: string): boolean {
  const leaf = name.split(".").pop() ?? name
  return SENSITIVE_RE.test(leaf)
}
function isIdField(name: string): boolean {
  const leaf = name.split(".").pop() ?? name
  return ID_RE.test(leaf)
}

const CRUD_VERB: Record<string, string> = { GET: "Get", HEAD: "Get", POST: "Create", PUT: "Update", PATCH: "Update", DELETE: "Delete" }
export function humanName(method: string, endpoint: string): string {
  const verb = CRUD_VERB[method.toUpperCase()] ?? "Call"
  const path = endpoint.includes("/") ? endpoint.replace(/^[A-Z]+\s+/, "").replace(/^[^/]*/, "") : endpoint
  const segs = path.split("/").filter(Boolean)
  let noun = ""
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!/^\{.*\}$/.test(segs[i]!) && !/^\d+$/.test(segs[i]!)) {
      noun = segs[i]!
      break
    }
  }
  if (!noun) noun = "Resource"
  const singular = noun.endsWith("s") && noun.length > 3 ? noun.slice(0, -1) : noun
  return `${verb}_${singular.charAt(0).toUpperCase()}${singular.slice(1)}`
}

function addUniq(arr: string[], v: string | undefined) {
  if (v && !arr.includes(v)) arr.push(v)
}

function mergeProvenance(record: Record<string, RoleProvenance>, role: string | undefined, isCrawl: boolean) {
  if (!role) return
  const prev = record[role]
  if (!prev) { record[role] = isCrawl ? "crawl" : "forced"; return }
  if (prev === "both") return
  if (prev === "crawl" && !isCrawl) { record[role] = "both"; return }
  if (prev === "forced" && isCrawl) { record[role] = "both"; return }
}

// Build the object + function inventory over the whole store (on demand — session scale is small).
export function inventory(store: TrafficStore): Inventory {
  const objs = new Map<string, ObjectRecord>()
  const fns = new Map<string, FunctionRecord>()
  for (const tx of store.all()) {
    const s = subjects(tx)
    const p = params(tx)
    const respFields = txResponseFields(tx)
    const allReqFields = Object.keys({ ...p.query, ...p.body })
    const allRespFields = Object.keys(respFields)
    const hiddens = allRespFields.filter((k) => k.startsWith(HIDDEN_PREFIX)).map((k) => k.slice(HIDDEN_PREFIX.length))
    const isCrawl = CRAWL_SOURCES.has(tx.source)

    const fr = fns.get(s.function.endpoint) ?? { endpoint: s.function.endpoint, crud: s.function.crud, roles: [], roleProvenance: {}, objects: [], transactions: [], requestFields: [], responseFields: [], hiddenInputs: [] }
    addUniq(fr.transactions, tx.id)
    addUniq(fr.roles, s.role)
    mergeProvenance(fr.roleProvenance, s.role, isCrawl)
    for (const o of s.objects) addUniq(fr.objects, o.ref)
    for (const f of allReqFields) addUniq(fr.requestFields, f)
    for (const f of allRespFields) addUniq(fr.responseFields, f)
    for (const h of hiddens) addUniq(fr.hiddenInputs, h)
    fns.set(s.function.endpoint, fr)

    const txFields = [...allReqFields, ...allRespFields]
    for (const o of s.objects) {
      const or = objs.get(o.ref) ?? { ref: o.ref, resource: o.resource ?? "", value: o.value, shapes: [], roles: [], roleProvenance: {}, endpoints: [], sites: [], transactions: [], fields: [], sensitiveFields: [], idFields: [] }
      addUniq(or.shapes, o.shape)
      addUniq(or.roles, s.role)
      mergeProvenance(or.roleProvenance, s.role, isCrawl)
      addUniq(or.endpoints, s.function.endpoint)
      addUniq(or.sites, o.in)
      addUniq(or.transactions, tx.id)
      for (const f of txFields) {
        addUniq(or.fields, f)
        if (isSensitive(f)) addUniq(or.sensitiveFields, f)
        if (isIdField(f)) addUniq(or.idFields, f)
      }
      objs.set(o.ref, or)
    }
  }
  return { objects: [...objs.values()], functions: [...fns.values()] }
}

// True when EVERY role that touched this record discovered it via organic crawl (browser/proxy),
// meaning the endpoint is reachable from the UI for all of them — likely shared by design.
export function allRolesCrawled(rp: Record<string, RoleProvenance>): boolean {
  const vals = Object.values(rp)
  return vals.length > 0 && vals.every((v) => v === "crawl" || v === "both")
}

// The deterministic access-control leads that the graph surfaces directly:
// an object reached under MORE THAN ONE role → IDOR/BOLA candidate.
export function crossRoleObjects(inv: Inventory): ObjectRecord[] {
  return inv.objects.filter((o) => o.roles.length > 1)
}
// a function called under MORE THAN ONE role → broken function-level authorization surface.
export function crossRoleFunctions(inv: Inventory): FunctionRecord[] {
  return inv.functions.filter((f) => f.roles.length > 1)
}

// Agent-facing lookups over the inventory.
export function objectsByResource(inv: Inventory, resource: string): ObjectRecord[] {
  return inv.objects.filter((o) => o.resource === resource)
}
export function objectsForRole(inv: Inventory, role: string): ObjectRecord[] {
  return inv.objects.filter((o) => o.roles.includes(role))
}
// The transactions that touch a given object — the agent replays these (under another role) to confirm.
export function transactionsForObject(inv: Inventory, ref: string): string[] {
  return inv.objects.find((o) => o.ref === ref)?.transactions ?? []
}
