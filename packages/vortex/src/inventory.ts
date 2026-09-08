// Inventory — the corpus-wide object & function graph, so an agent can QUERY "which objects/
// functions exist and who touched them" instead of re-deriving per request. It aggregates
// subjects() across every transaction and canonicalizes by VALUE: the same object ref ("order:42")
// seen in many transactions is ONE record, carrying which roles accessed it, through which
// functions, in which transactions. That aggregation is where the deterministic IDOR/BFLA leads
// fall out for free: an object touched under >1 role, or a function called by >1 role.
import type { TrafficStore } from "./store"
import { subjects } from "./subjects"
import type { Crud } from "./subjects"

export interface ObjectRecord {
  ref: string // "order:42"
  resource: string
  value: string
  shapes: string[] // id shapes seen (uuid/int/…)
  roles: string[] // identities/JWT-subjects that accessed it — >1 ⇒ IDOR/BOLA candidate
  endpoints: string[] // functions it appeared in
  sites: string[] // where it lived (path/query/body/header)
  transactions: string[] // every tx touching it (→ send() to replay under another role)
}

export interface FunctionRecord {
  endpoint: string // "GET app.test/api/orders/{id}" (or "…/graphql#updateOrder")
  crud: Crud
  roles: string[] // identities that called it — >1 ⇒ BFLA surface to check
  objects: string[] // object refs it touched
  transactions: string[]
}

export interface Inventory {
  objects: ObjectRecord[]
  functions: FunctionRecord[]
}

function addUniq(arr: string[], v: string | undefined) {
  if (v && !arr.includes(v)) arr.push(v)
}

// Build the object + function inventory over the whole store (on demand — session scale is small).
export function inventory(store: TrafficStore): Inventory {
  const objs = new Map<string, ObjectRecord>()
  const fns = new Map<string, FunctionRecord>()
  for (const tx of store.all()) {
    const s = subjects(tx)
    const fr = fns.get(s.function.endpoint) ?? { endpoint: s.function.endpoint, crud: s.function.crud, roles: [], objects: [], transactions: [] }
    addUniq(fr.transactions, tx.id)
    addUniq(fr.roles, s.role)
    for (const o of s.objects) addUniq(fr.objects, o.ref)
    fns.set(s.function.endpoint, fr)

    for (const o of s.objects) {
      const or = objs.get(o.ref) ?? { ref: o.ref, resource: o.resource ?? "", value: o.value, shapes: [], roles: [], endpoints: [], sites: [], transactions: [] }
      addUniq(or.shapes, o.shape)
      addUniq(or.roles, s.role)
      addUniq(or.endpoints, s.function.endpoint)
      addUniq(or.sites, o.in)
      addUniq(or.transactions, tx.id)
      objs.set(o.ref, or)
    }
  }
  return { objects: [...objs.values()], functions: [...fns.values()] }
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
