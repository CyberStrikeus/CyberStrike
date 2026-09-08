// Subjects — the deterministic "who / what / which" of a transaction, extracted from EVERYWHERE a
// value can live: the URI path, the query, id-ish headers, and the request body INCLUDING nested
// structures (via the flattened dotpath field map from params/body). This is the parser layer that
// lets a Signal be self-describing — function (the operation), objects (the resources it touches),
// role (the identity) — so an agent CONSUMES that context instead of authoring it. Pure + no I/O.
//
// It is heuristic on purpose (name- and shape-based), and errs toward recall: a candidate object ref
// is a lead for BOLA/IDOR reasoning, not a proof.
import type { Transaction } from "./transaction"
import { identifierShape, endpointKey, type IdShape } from "./endpoint"
import { params } from "./params"

export type Site = "path" | "query" | "header" | "body"
export type Crud = "create" | "read" | "update" | "delete"

// One resource identifier found in the request, with WHERE it came from (for the agent's follow-up).
export interface ObjectRef {
  ref: string // "users:42" — resource:value, the handle for cross-identity/IDOR reasoning
  value: string
  shape: IdShape | "opaque" // opaque = an id-ish NAMED param whose value isn't a standard id shape
  in: Site
  name?: string // param name / dotpath / header name
  resource?: string // best-effort resource noun
}

export interface Subjects {
  function: { method: string; endpoint: string; crud: Crud } // the operation (BFLA axis)
  role?: string // the identity this ran under (RBAC axis)
  objects: ObjectRef[] // the resources it touches (BOLA/IDOR axis)
}

const CRUD: Record<string, Crud> = { GET: "read", HEAD: "read", POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" }
const crudOf = (method: string): Crud => CRUD[method.toUpperCase()] ?? "read"

// A param/header name that denotes an identifier: a known id-word as the last dotpath/underscore
// segment, a camelCase `…Id`, or a `…_id` suffix. Word-boundary-ish so "valid"/"grid" don't match.
function idishKey(key: string): boolean {
  const last = key.split(/[._\-]/).pop() ?? key // header names hyphenate (x-tenant-id), params dot/underscore
  return /^(id|ids|uuid|guid|oid|sid|pid|gid|ref|slug|no|num|code)$/i.test(last) || /[a-z0-9]Id$/.test(key) || /[_\-]id$/i.test(key)
}
// Guess the resource noun. Strip an id suffix off the leaf ("user_id"→"user", "orderId"→"order");
// when the leaf is PURELY an id-word (a nested "order.id"), fall back to the parent dotpath segment
// ("order.id"→"order", "items.0.id"→"items", skipping array indices). The suffix must sit on a
// BOUNDARY — a separator (_id/-id/.id) or camelCase (…Id) — so short words (sid/pid) can't eat mid-
// word letters ("addressId" must stay "address", not become "addres").
const ID_WORD = /^(id|ids|uuid|guid|oid|sid|pid|gid|ref|no|num|code)$/i
// Strip an id suffix off a leaf name. Two passes so casing is handled without eating mid-word
// letters: (1) camelCase `…Id`/`…Uuid` — case-SENSITIVE, so "valid" is never trimmed to "val";
// (2) a separator + id-word (`_id`, `-Id`, `.uuid`) — case-insensitive, the separator preventing
// mid-word matches like "address"→"addres"; (3) drop any separator left dangling ("x-account-").
function stripLeaf(leaf: string): string {
  return leaf
    .replace(/(Id|Ids|Uuid|Guid)$/, "")
    .replace(/[._-](?:id|ids|uuid|guid|oid|sid|pid|gid|ref|no|num|code)$/i, "")
    .replace(/[._-]+$/, "")
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

export function subjects(tx: Transaction): Subjects {
  const objects: ObjectRef[] = []
  const seen = new Set<string>()
  const push = (o: ObjectRef) => {
    const k = `${o.in}:${o.name ?? ""}:${o.value}`
    if (!seen.has(k)) {
      seen.add(k)
      objects.push(o)
    }
  }

  // PATH — an id-shaped segment; name it by the preceding segment (the resource noun).
  const segs = pathname(tx.request.url).split("/").filter(Boolean)
  for (let i = 0; i < segs.length; i++) {
    const shape = identifierShape(segs[i]!)
    if (!shape) continue
    const resource = i > 0 ? segs[i - 1]!.toLowerCase() : undefined
    push({ ref: `${resource ?? "path"}:${segs[i]}`, value: segs[i]!, shape, in: "path", name: resource, resource })
  }

  // QUERY + BODY (nested, via the flattened dotpath map) — an id-ish NAME (any value), or a strong
  // value SHAPE (uuid/objectid) under any name.
  const p = params(tx)
  const scan = (map: Record<string, string>, where: Site) => {
    for (const [name, value] of Object.entries(map)) {
      if (!value) continue
      const shape = identifierShape(value)
      const idish = idishKey(name)
      if (!idish && shape !== "uuid" && shape !== "objectid") continue
      const resource = resourceOf(name) || undefined
      push({ ref: `${resource ?? name}:${value}`, value, shape: shape ?? "opaque", in: where, name, resource })
    }
  }
  scan(p.query, "query")
  scan(p.body, "body")

  // HEADERS — only explicitly id-ish header names (x-account-id, x-user-id, …).
  for (const h of tx.request.headers) {
    if (!idishKey(h.name)) continue
    const shape = identifierShape(h.value)
    if (!shape) continue
    const resource = resourceOf(h.name) || undefined
    push({ ref: `${resource ?? h.name}:${h.value}`, value: h.value, shape, in: "header", name: h.name, resource })
  }

  return {
    function: { method: tx.request.method.toUpperCase(), endpoint: endpointKey(tx), crud: crudOf(tx.request.method) },
    role: tx.identity,
    objects,
  }
}
