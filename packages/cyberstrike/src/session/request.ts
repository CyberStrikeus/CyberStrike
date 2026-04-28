import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and, isNull } from "../storage/db"
import { RequestTable } from "./session.sql"
import { Identifier } from "../id/id"
import { createHash } from "crypto"
import { processResponse, type ResponseInput } from "./response-processor"

const Status = z.enum(["queued", "processing", "processed"])
const Method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
const NormSource = z.enum(["tier1", "tier2", "tier3", "failed"])

export namespace Request {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      credential_id: z.string().optional(),
      method: Method,
      normalized_path: z.string(),
      raw_request: z.string().optional(),
      body_hash: z.string().optional(),
      query_hash: z.string().optional(),
      status: Status,
      // Hackbrowser enrichment (optional — not sent by Firefox extension)
      trigger_element: z.string().optional(),
      element_roles: z.array(z.string()).optional(),
      ui_context: z.record(z.string(), z.unknown()).optional(),
      page_url: z.string().optional(),
      page_visited_by: z.array(z.string()).optional(),
      // normalize-proto enrichment (optional — legacy rows pre-date this).
      scheme: z.enum(["http", "https"]).optional(),
      host: z.string().optional(),
      port: z.number().optional(),
      origin: z.string().optional(),
      site: z.string().optional(),
      canonical_path: z.string().optional(),
      template_id: z.string().optional(),
      norm_source: NormSource.optional(),
      // Response fields
      response_status: z.number().optional(),
      response_headers: z.record(z.string(), z.string()).optional(),
      response_content_type: z.string().optional(),
      response_size: z.number().optional(),
      processed_response: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "Request" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "request.updated",
      z.object({
        sessionID: z.string(),
        requests: z.array(Info),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    method: z.infer<typeof Method>
    normalizedPath: string
    credentialID?: string
    rawRequest?: string
    bodyHash?: string
    queryHash?: string
    response?: ResponseInput
    // Hackbrowser enrichment (optional — not sent by Firefox extension)
    triggerElement?: string
    elementRoles?: string[]
    uiContext?: Record<string, unknown>
    pageUrl?: string
    pageVisitedBy?: string[]
    // normalize-proto enrichment (optional — supplied by Normalize.run when called from ingest)
    scheme?: "http" | "https"
    host?: string
    port?: number
    origin?: string
    site?: string
    canonicalPath?: string
    templateID?: string
    normSource?: z.infer<typeof NormSource>
  }) {
    const id = Identifier.ascending("request")
    const now = Date.now()

    // Process response if provided
    const processed = input.response ? processResponse(input.response) : undefined

    Database.use((db) => {
      db.insert(RequestTable)
        .values({
          id,
          session_id: input.sessionID,
          credential_id: input.credentialID ?? null,
          method: input.method,
          normalized_path: input.normalizedPath,
          raw_request: input.rawRequest ?? null,
          body_hash: input.bodyHash ?? null,
          query_hash: input.queryHash ?? null,
          status: "queued",
          trigger_element: input.triggerElement ?? null,
          element_roles: input.elementRoles ?? null,
          ui_context: input.uiContext ?? null,
          page_url: input.pageUrl ?? null,
          page_visited_by: input.pageVisitedBy ?? null,
          scheme: input.scheme ?? null,
          host: input.host ?? null,
          port: input.port ?? null,
          origin: input.origin ?? null,
          site: input.site ?? null,
          canonical_path: input.canonicalPath ?? null,
          template_id: input.templateID ?? null,
          norm_source: input.normSource ?? null,
          response_status: processed?.status ?? null,
          response_headers: processed?.headers ?? null,
          response_content_type: processed?.contentType ?? null,
          response_size: processed?.originalSize ?? null,
          processed_response: processed?.content ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, requests: list })
    return {
      id,
      session_id: input.sessionID,
      credential_id: input.credentialID,
      method: input.method,
      normalized_path: input.normalizedPath,
      raw_request: input.rawRequest,
      body_hash: input.bodyHash,
      query_hash: input.queryHash,
      status: "queued" as const,
      trigger_element: input.triggerElement,
      element_roles: input.elementRoles,
      ui_context: input.uiContext,
      page_url: input.pageUrl,
      page_visited_by: input.pageVisitedBy,
      scheme: input.scheme,
      host: input.host,
      port: input.port,
      origin: input.origin,
      site: input.site,
      canonical_path: input.canonicalPath,
      template_id: input.templateID,
      norm_source: input.normSource,
      response_status: processed?.status,
      response_headers: processed?.headers,
      response_content_type: processed?.contentType,
      response_size: processed?.originalSize,
      processed_response: processed?.content,
      time: { created: now, updated: now },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(RequestTable).where(eq(RequestTable.session_id, sessionID)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      credential_id: row.credential_id ?? undefined,
      method: row.method as Info["method"],
      normalized_path: row.normalized_path,
      raw_request: row.raw_request ?? undefined,
      body_hash: row.body_hash ?? undefined,
      query_hash: row.query_hash ?? undefined,
      status: row.status as Info["status"],
      trigger_element: row.trigger_element ?? undefined,
      element_roles: (row.element_roles as string[]) ?? undefined,
      ui_context: (row.ui_context as Record<string, unknown>) ?? undefined,
      page_url: row.page_url ?? undefined,
      page_visited_by: (row.page_visited_by as string[]) ?? undefined,
      scheme: (row.scheme as "http" | "https" | null) ?? undefined,
      host: row.host ?? undefined,
      port: row.port ?? undefined,
      origin: row.origin ?? undefined,
      site: row.site ?? undefined,
      canonical_path: row.canonical_path ?? undefined,
      template_id: row.template_id ?? undefined,
      norm_source: (row.norm_source as Info["norm_source"]) ?? undefined,
      response_status: row.response_status ?? undefined,
      response_headers: (row.response_headers as Record<string, string>) ?? undefined,
      response_content_type: row.response_content_type ?? undefined,
      response_size: row.response_size ?? undefined,
      processed_response: row.processed_response ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  /**
   * Two-stage dedup at the TEMPLATE level. Same endpoint shape (normalized
   * template) hit twice — even with different concrete paths like
   * `/users/1` vs `/users/2` — must collapse to one row so proxy-agent only
   * analyzes the template once. The credential who hit it first wins on
   * `request.credential_id`; subsequent hits with different credentials are
   * still recorded by `WebCredential` and matched against the function via
   * cross-cred replay tools.
   *
   * Body/query hashes still discriminate, so PUTs with different bodies
   * (mass-assignment evidence) stay distinct.
   *
   * Stage 1: new identity — (sessionID, method, origin, normalized_path)
   * Stage 2: legacy rows pre-date `origin` — fall back to (normalized_path)
   * limited to rows with origin IS NULL so we don't spuriously match new ones.
   */
  export function exists(input: {
    sessionID: string
    method: string
    normalizedPath: string
    origin?: string
    bodyHash?: string
    queryHash?: string
  }): boolean {
    const matches = (rows: { body_hash: string | null; query_hash: string | null }[]) =>
      rows.some(
        (r) =>
          (input.bodyHash ? r.body_hash === input.bodyHash : r.body_hash == null) &&
          (input.queryHash ? r.query_hash === input.queryHash : r.query_hash == null),
      )

    // Stage 1: new identity — origin scopes the template (api vs admin
    // subdomain stay separate; the template alone would collide them).
    const origin = input.origin
    if (origin) {
      const newKeyRows = Database.use((db) =>
        db
          .select({ body_hash: RequestTable.body_hash, query_hash: RequestTable.query_hash })
          .from(RequestTable)
          .where(
            and(
              eq(RequestTable.session_id, input.sessionID),
              eq(RequestTable.method, input.method),
              eq(RequestTable.origin, origin),
              eq(RequestTable.normalized_path, input.normalizedPath),
            ),
          )
          .all(),
      )
      if (matches(newKeyRows)) return true
    }

    // Stage 2: legacy fallback. Only matches rows that pre-date origin.
    const legacyRows = Database.use((db) =>
      db
        .select({ body_hash: RequestTable.body_hash, query_hash: RequestTable.query_hash })
        .from(RequestTable)
        .where(
          and(
            eq(RequestTable.session_id, input.sessionID),
            eq(RequestTable.method, input.method),
            eq(RequestTable.normalized_path, input.normalizedPath),
            isNull(RequestTable.origin),
          ),
        )
        .all(),
    )
    return matches(legacyRows)
  }

  export function updateStatus(input: { id: string; status: z.infer<typeof Status> }) {
    const now = Date.now()
    const row = Database.use((db) => {
      db.update(RequestTable)
        .set({ status: input.status, time_updated: now })
        .where(eq(RequestTable.id, input.id))
        .run()
      return db.select().from(RequestTable).where(eq(RequestTable.id, input.id)).get()
    })
    if (row) {
      const list = get(row.session_id)
      Bus.publish(Event.Updated, { sessionID: row.session_id, requests: list })
    }
  }

  export function hash(value: string | undefined): string | undefined {
    if (!value) return undefined
    return createHash("sha256").update(value).digest("hex").slice(0, 16)
  }

  export function hashQueryKeys(query: string | undefined): string | undefined {
    if (!query) return undefined
    const params = new URLSearchParams(query)
    const keys = Array.from(params.keys()).sort()
    if (keys.length === 0) return undefined
    return createHash("sha256").update(keys.join(",")).digest("hex").slice(0, 16)
  }

  // The legacy LLM-only `Request.normalize()` and `Request.parseRawRequest()`
  // were removed in PR-5. Path normalization now flows through
  // `session/normalize/index.ts → Normalize.run()`, which handles parsing,
  // tier-1 regex fast-path, tier-2 cache lookup, and tier-3 LLM fallback in
  // one place. The ingest route invokes it directly.
}
