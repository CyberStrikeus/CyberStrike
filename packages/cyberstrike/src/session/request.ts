import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../storage/db"
import { RequestTable } from "./session.sql"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { LLM } from "./llm"
import { Log } from "../util/log"
import { createHash } from "crypto"
import { processResponse, type ResponseInput } from "./response-processor"

const log = Log.create({ service: "request" })
const Status = z.enum(["queued", "processing", "processed"])
const Method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

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
      // Browser-agent enrichment (optional — not sent by Firefox extension)
      trigger_element: z.string().optional(),
      element_roles: z.array(z.string()).optional(),
      ui_context: z.record(z.string(), z.unknown()).optional(),
      page_url: z.string().optional(),
      page_visited_by: z.array(z.string()).optional(),
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
    // Browser-agent enrichment (optional — not sent by Firefox extension)
    triggerElement?: string
    elementRoles?: string[]
    uiContext?: Record<string, unknown>
    pageUrl?: string
    pageVisitedBy?: string[]
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
      response_status: row.response_status ?? undefined,
      response_headers: (row.response_headers as Record<string, string>) ?? undefined,
      response_content_type: row.response_content_type ?? undefined,
      response_size: row.response_size ?? undefined,
      processed_response: row.processed_response ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }))
  }

  export function exists(input: {
    sessionID: string
    method: string
    normalizedPath: string
    bodyHash?: string
    queryHash?: string
  }): boolean {
    const rows = Database.use((db) =>
      db
        .select({ id: RequestTable.id })
        .from(RequestTable)
        .where(
          and(
            eq(RequestTable.session_id, input.sessionID),
            eq(RequestTable.method, input.method),
            eq(RequestTable.normalized_path, input.normalizedPath),
          ),
        )
        .all(),
    )
    if (rows.length === 0) return false
    const full = Database.use((db) =>
      db
        .select()
        .from(RequestTable)
        .where(
          and(
            eq(RequestTable.session_id, input.sessionID),
            eq(RequestTable.method, input.method),
            eq(RequestTable.normalized_path, input.normalizedPath),
          ),
        )
        .all(),
    )
    return full.some(
      (r) =>
        (input.bodyHash ? r.body_hash === input.bodyHash : r.body_hash == null) &&
        (input.queryHash ? r.query_hash === input.queryHash : r.query_hash == null),
    )
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

  export async function normalize(input: { path: string; providerID: string; modelID: string }): Promise<string> {
    const agent = await Agent.get("normalize-request")
    if (!agent) return input.path

    const model = await (async () => {
      if (agent.model) return Provider.getModel(agent.model.providerID, agent.model.modelID)
      const small = await Provider.getSmallModel(input.providerID)
      if (small) return small
      return Provider.getModel(input.providerID, input.modelID)
    })()

    const result = await LLM.stream({
      agent,
      user: {
        id: "normalize",
        sessionID: "normalize",
        role: "user",
        time: { created: Date.now() },
        agent: "normalize-request",
        model: { providerID: model.providerID, modelID: model.id },
      },
      system: [],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: "normalize",
      retries: 2,
      messages: [
        {
          role: "user",
          content: `Normalize this URL path:\n${input.path}`,
        },
      ],
    })

    const text = await result.text.catch((err) => {
      log.error("failed to normalize request path", { error: err })
      return null
    })

    if (!text) return input.path

    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && line.startsWith("/"))

    return cleaned ?? input.path
  }

  export function parseRawRequest(rawText: string): {
    method: string
    path: string
    query?: string
    body?: string
  } | null {
    const lines = rawText.split("\n")
    const firstLine = lines[0]?.trim()
    if (!firstLine) return null

    const match = firstLine.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/)
    if (!match) return null

    const method = match[1]
    const fullPath = match[2]
    const [path, query] = fullPath.split("?")

    const bodyStart = rawText.indexOf("\r\n\r\n")
    const body = bodyStart !== -1 ? rawText.slice(bodyStart + 4).trim() : undefined

    return { method, path, query, body: body || undefined }
  }
}
