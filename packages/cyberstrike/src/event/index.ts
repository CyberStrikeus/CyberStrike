import z from "zod"
import { and, desc, eq, lt } from "drizzle-orm"
import { Bus } from "../bus"
import { Database } from "../storage/db"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { EngagementEventTable } from "./event.sql"
import { Log } from "../util/log"

export namespace EngagementEvent {
  const log = Log.create({ service: "engagement-event" })
  const MAX_SEEN = 2_000

  export const Info = z.object({
    id: Identifier.schema("engagement_event"),
    projectID: z.string(),
    sessionID: z.string().optional(),
    type: z.string(),
    source: z.enum(["agent", "tool", "mcp", "bolt", "browser", "pty", "finding", "system"]),
    correlationID: z.string().optional(),
    parentID: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
    time: z.number(),
  })
  export type Info = z.infer<typeof Info>

  type Event = {
    type: string
    properties?: unknown
  }

  function record(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    return value as Record<string, unknown>
  }

  function text(value: unknown) {
    return typeof value === "string" ? value : undefined
  }

  function number(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  function source(type: string, data: Record<string, unknown>) {
    if (type.startsWith("mcp.")) return "mcp" as const
    if (type.startsWith("bolt.")) return "bolt" as const
    if (type.startsWith("pty.")) return "pty" as const
    if (
      type.startsWith("request.") ||
      type.startsWith("web_") ||
      type.startsWith("hackbrowser.") ||
      type.startsWith("observation.")
    )
      return "browser" as const
    if (
      type.startsWith("vulnerability.") ||
      type.startsWith("methodology.") ||
      type.startsWith("intel.") ||
      type.startsWith("coverage.")
    )
      return "finding" as const
    if (type.startsWith("message.part.") && data.partType === "tool") return "tool" as const
    if (type.startsWith("message.part.") && data.partType === "agent") return "agent" as const
    if (type.startsWith("session.") || type.startsWith("message.")) return "agent" as const
    return "system" as const
  }

  export function normalize(event: Event) {
    if (!event?.type || event.type === "message.part.delta") return
    const props = record(event.properties) ?? {}
    const part = record(props.part)
    const info = record(props.info)
    const state = record(part?.state)
    const tool = record(props.tool)
    const time = record(state?.time)
    const list = Array.isArray(props.vulnerabilities)
      ? props.vulnerabilities
      : Array.isArray(props.requests)
        ? props.requests
        : undefined

    const sessionID =
      text(props.sessionID) ??
      text(part?.sessionID) ??
      text(info?.sessionID) ??
      (event.type.startsWith("session.") ? text(info?.id) : undefined) ??
      text(props.session_id)
    const correlationID =
      text(part?.callID) ??
      text(props.callID) ??
      text(props.permissionID) ??
      text(props.requestID) ??
      text(props.id) ??
      text(info?.id)
    const parentID = text(part?.messageID) ?? text(props.messageID) ?? text(info?.parentID)

    const data = (() => {
      if (part) {
        return {
          messageID: text(part.messageID),
          partID: text(part.id),
          partType: text(part.type),
          tool: text(part.tool),
          callID: text(part.callID),
          status: text(state?.status),
          title: text(state?.title),
          startedAt: number(time?.start),
          endedAt: number(time?.end),
        }
      }

      if (info) {
        const model = record(info.model)
        return {
          id: text(info.id),
          parentID: text(info.parentID),
          title: text(info.title),
          role: text(info.role),
          agent: text(info.agent),
          providerID: text(model?.providerID),
          modelID: text(model?.modelID),
          finish: text(info.finish),
          status: text(info.status),
          version: text(info.version),
        }
      }

      if (list) {
        return {
          count: list.length,
          ids: list.flatMap((item) => {
            const value = record(item)
            return text(value?.id) ? [text(value?.id)] : []
          }),
        }
      }

      return {
        id: text(props.id),
        name: text(props.name),
        status: text(props.status),
        exitCode: number(props.exitCode),
        directory: text(props.directory),
        permission: text(props.permission),
        tool: text(tool?.tool) ?? text(props.tool),
        patternCount: Array.isArray(props.patterns) ? props.patterns.length : undefined,
      }
    })()

    return {
      sessionID,
      type: event.type,
      source: source(event.type, data),
      correlationID,
      parentID,
      data: Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    }
  }

  const state = Instance.state(
    () => {
      const seen = new Map<string, string>()
      const listeners = new Set<(event: Info) => void>()
      const unsub = Bus.subscribeAll((event) => {
        const next = normalize(event)
        if (!next) return
        const key = `${next.type}:${next.correlationID ?? next.parentID ?? next.sessionID ?? "global"}`
        const signature = JSON.stringify(next.data)
        if (seen.get(key) === signature) return
        seen.delete(key)
        seen.set(key, signature)
        while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value!)

        try {
          const info: Info = {
            id: Identifier.ascending("engagement_event"),
            projectID: Instance.project.id,
            sessionID: next.sessionID,
            type: next.type,
            source: next.source,
            correlationID: next.correlationID,
            parentID: next.parentID,
            data: next.data,
            time: Date.now(),
          }
          Database.use((db) =>
            db
              .insert(EngagementEventTable)
              .values({
                id: info.id,
                project_id: info.projectID,
                session_id: info.sessionID,
                type: info.type,
                source: info.source,
                correlation_id: info.correlationID,
                parent_id: info.parentID,
                data: info.data,
                time_created: info.time,
              })
              .run(),
          )
          for (const listener of listeners) listener(info)
        } catch (error) {
          log.error("failed to persist event", { type: next.type, error })
        }
      })
      return { listeners, unsub }
    },
    async (entry) => entry.unsub(),
  )

  export function init() {
    state()
  }

  export function subscribe(listener: (event: Info) => void) {
    const current = state()
    current.listeners.add(listener)
    return () => current.listeners.delete(listener)
  }

  export function list(input: { sessionID: string; before?: number; limit?: number }) {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500))
    const rows = Database.use((db) =>
      db
        .select()
        .from(EngagementEventTable)
        .where(
          and(
            eq(EngagementEventTable.project_id, Instance.project.id),
            eq(EngagementEventTable.session_id, input.sessionID),
            input.before ? lt(EngagementEventTable.time_created, input.before) : undefined,
          ),
        )
        .orderBy(desc(EngagementEventTable.time_created))
        .limit(limit)
        .all(),
    )

    return rows.toReversed().map(
      (row): Info => ({
        id: row.id,
        projectID: row.project_id,
        sessionID: row.session_id ?? undefined,
        type: row.type,
        source: row.source as Info["source"],
        correlationID: row.correlation_id ?? undefined,
        parentID: row.parent_id ?? undefined,
        data: row.data,
        time: row.time_created,
      }),
    )
  }
}
