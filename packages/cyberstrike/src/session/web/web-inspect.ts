import z from "zod"
import { Database, eq, and } from "@/storage/db"
import { RequestTable } from "@/session/session.sql"
import { getWebInspection } from "@/inspection/web-bridge"
import type { Evidence, InspectionTarget } from "@cyberstrike-io/plugin"

// Drop-in facade over the domain-agnostic InspectionQueue (issue #19). Preserves the exact WebRetest
// API surface so every producer/consumer flips with a one-token swap (`WebRetest.` → `WebInspect.`),
// while the real queue + dispatch + lifecycle is the new OO stack — which is what drives the
// SessionLifecycle phase (…→ complete). Replaces the WebRetest namespace + RetestWorker.
//
// The queue is a SCENARIO queue keyed by endpoint (key_hash → InspectionTarget.key). Trigger families
// (signal/credential/role/object_value) accumulate as evidence on that target; an examined target
// re-opens only on genuinely new evidence — same semantics as the old WebRetest.
const FlagType = z.enum(["object_value", "role", "signal", "credential"])
export type FlagType = z.infer<typeof FlagType>
const Priority = z.enum(["high", "medium", "low"])
type Priority = z.infer<typeof Priority>

const Flags = z
  .object({
    object_value: z.array(z.string()).optional(),
    role: z.array(z.string()).optional(),
    signal: z.array(z.string()).optional(),
    credential: z.array(z.string()).optional(),
  })
  .default({})
type Flags = z.infer<typeof Flags>

export namespace WebInspect {
  // Same shape the TUI / session-context / retest-queue endpoint already consume.
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      key_hash: z.string(),
      status: z.enum(["pending", "dispatched", "examined"]),
      priority: Priority,
      flags: Flags,
      method: z.string().optional(),
      endpoint: z.string().optional(),
      time: z.object({ created: z.number(), updated: z.number() }),
    })
    .meta({ ref: "WebRetest" })
  export type Info = z.infer<typeof Info>

  export interface EndpointMeta {
    keyHash: string
    method: string
    path: string
    contentType: string
    hasQuery: boolean
    hasBody: boolean
    authenticated: boolean
    // Value-stripped operation-shape discriminator (GraphQL/JSON-RPC op; null for plain REST). Used by
    // the inspection queue to group same-endpoint-operation targets so a batch/RPC/telemetry endpoint
    // (one path, many value-varying bodies) can't fan out into a dispatch storm (#94).
    opKeyHash?: string
  }

  // ── relevance predicates (ported verbatim from WebRetest) ─────────
  const STATIC_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|pdf|wasm)(?:$|\?)/i
  function isStaticAsset(e: EndpointMeta): boolean {
    if (STATIC_RE.test(e.path)) return true
    const ct = e.contentType.toLowerCase()
    return /^(?:image|font|audio|video)\//.test(ct) || ct.includes("text/css") || ct.includes("javascript") || ct.includes("ecmascript")
  }
  export function isAccessControlSurface(e: EndpointMeta): boolean {
    return !isStaticAsset(e)
  }
  const UUID_OR_NUM_SEG = /\/(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|\/)/i
  export function isObjectReferencing(e: EndpointMeta): boolean {
    if (isStaticAsset(e)) return false
    return e.path.includes("{") || UUID_OR_NUM_SEG.test(e.path) || e.hasQuery || e.hasBody || /\/api(?:\/|$)/i.test(e.path)
  }

  // ── endpoint metadata lookup (one representative request row per key_hash) ─────────
  function metaFor(sessionID: string, keyHash: string): EndpointMeta {
    const r = Database.use((db) =>
      db
        .select({
          method: RequestTable.method,
          normalized_path: RequestTable.normalized_path,
          canonical_path: RequestTable.canonical_path,
          content_type: RequestTable.response_content_type,
          query_hash: RequestTable.query_hash,
          body_hash: RequestTable.body_hash,
          credential_id: RequestTable.credential_id,
          op_key_hash: RequestTable.op_key_hash,
        })
        .from(RequestTable)
        .where(and(eq(RequestTable.session_id, sessionID), eq(RequestTable.key_hash, keyHash)))
        .get(),
    )
    return {
      keyHash,
      method: r?.method ?? "GET",
      path: r?.normalized_path || r?.canonical_path || "/",
      contentType: r?.content_type ?? "",
      hasQuery: !!r?.query_hash,
      hasBody: !!r?.body_hash,
      authenticated: !!r?.credential_id,
      opKeyHash: r?.op_key_hash ?? undefined,
    }
  }
  function allEndpoints(sessionID: string): EndpointMeta[] {
    const byKey = new Map<string, EndpointMeta>()
    Database.use((db) => {
      for (const r of db
        .select({
          key_hash: RequestTable.key_hash,
          method: RequestTable.method,
          normalized_path: RequestTable.normalized_path,
          canonical_path: RequestTable.canonical_path,
          content_type: RequestTable.response_content_type,
          query_hash: RequestTable.query_hash,
          body_hash: RequestTable.body_hash,
          credential_id: RequestTable.credential_id,
          op_key_hash: RequestTable.op_key_hash,
        })
        .from(RequestTable)
        .where(eq(RequestTable.session_id, sessionID))
        .all()) {
        if (!r.key_hash || byKey.has(r.key_hash)) continue
        byKey.set(r.key_hash, {
          keyHash: r.key_hash,
          method: r.method ?? "GET",
          path: r.normalized_path || r.canonical_path || "/",
          contentType: r.content_type ?? "",
          hasQuery: !!r.query_hash,
          hasBody: !!r.body_hash,
          authenticated: !!r.credential_id,
          opKeyHash: r.op_key_hash ?? undefined,
        })
      }
    })
    return [...byKey.values()]
  }
  function targetOf(m: EndpointMeta): InspectionTarget {
    return { key: m.keyHash, label: m.path, meta: { method: m.method, path: m.path, contentType: m.contentType, hasQuery: m.hasQuery, hasBody: m.hasBody, authenticated: m.authenticated, keyHash: m.keyHash, opKeyHash: m.opKeyHash } }
  }
  function keyHashForRequest(sessionID: string, requestID: string): string | undefined {
    return Database.use((db) =>
      db.select({ key_hash: RequestTable.key_hash }).from(RequestTable).where(and(eq(RequestTable.session_id, sessionID), eq(RequestTable.id, requestID))).get(),
    )?.key_hash ?? undefined
  }

  // ── write ─────────────────────────────────────────────────────────
  export function flag(input: { sessionID: string; keyHash: string; type: FlagType; value: string; priority?: Priority }): boolean {
    const q = getWebInspection(input.sessionID).queue
    const evidence: Evidence = { type: input.type, value: input.value, priority: input.priority ?? "medium" }
    return q.flag(targetOf(metaFor(input.sessionID, input.keyHash)), evidence)
  }

  export function flagMatching(input: { sessionID: string; type: FlagType; value: string; priority?: Priority; match: (e: EndpointMeta) => boolean }): number {
    const q = getWebInspection(input.sessionID).queue
    const evidence: Evidence = { type: input.type, value: input.value, priority: input.priority ?? "medium" }
    let changed = 0
    for (const m of allEndpoints(input.sessionID)) {
      if (!input.match(m)) continue
      if (q.flag(targetOf(m), evidence)) changed++
    }
    return changed
  }

  export function markExamined(sessionID: string, keyHash: string): void {
    getWebInspection(sessionID).queue.markExamined(keyHash)
  }
  export function completeForRequest(sessionID: string, requestID: string): void {
    const kh = keyHashForRequest(sessionID, requestID)
    if (kh) getWebInspection(sessionID).queue.markExamined(kh)
  }

  // ── read ────────────────────────────────────────────────────────────
  function evidenceToFlags(evidence: Record<string, string[]>): Flags {
    const f: Flags = {}
    for (const t of ["object_value", "role", "signal", "credential"] as const) if (evidence[t]?.length) f[t] = evidence[t]
    return f
  }
  export function getPending(sessionID: string): Info[] {
    return getWebInspection(sessionID).queue.pending().map((item) => ({
      id: item.id,
      session_id: item.session_id,
      key_hash: item.target_key,
      status: item.status,
      priority: item.priority,
      flags: evidenceToFlags(item.evidence),
      method: (item.target_meta?.method as string) ?? undefined,
      endpoint: item.target_label,
      time: item.time,
    }))
  }
  export function count(sessionID: string): { pending: number; examined: number; total: number } {
    return getWebInspection(sessionID).queue.count()
  }
  export function statusByKeyHash(sessionID: string): Record<string, "pending" | "dispatched" | "examined"> {
    return getWebInspection(sessionID).queue.statusByTargetKey()
  }
  export function getFlags(sessionID: string, keyHash: string): Flags {
    const ev: Record<string, string[]> = {}
    for (const e of getWebInspection(sessionID).queue.evidenceFor(keyHash)) (ev[e.type] ??= []).push(e.value)
    return evidenceToFlags(ev)
  }
}
