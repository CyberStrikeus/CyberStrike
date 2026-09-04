// Durable store of JS files seen during capture. JS never becomes a `request` row (the request
// table is analysis-relevant endpoints only), so script URLs live here — one row per (session, url)
// — for the panel/TUI to list and a later agent to pull + review each body (`analyzed` marks done).
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq } from "../../storage/db"
import { WebJsTable } from "../session.sql"
import { Identifier } from "../../id/id"
import { Log } from "../../util/log"

const log = Log.create({ service: "web-js" })

export namespace WebJs {
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      url: z.string(),
      origin: z.string().optional(),
      analyzed: z.boolean().optional(),
      discovered_from: z.string().optional(),
      time: z.object({ created: z.number(), updated: z.number() }),
    })
    .meta({ ref: "WebJs" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("web_js.updated", z.object({ sessionID: z.string(), js: z.array(Info) })),
  }

  // Record a JS file URL. Deduped by (session, url) via ON CONFLICT DO NOTHING. Best-effort — a
  // failure (e.g. no DB in a unit test) is swallowed so it never breaks the ingest path.
  export function add(input: { sessionID: string; url: string; origin?: string; discoveredFrom?: string }): void {
    const url = String(input.url || "").trim()
    if (!url) return
    try {
      const now = Date.now()
      const inserted = Database.use((db) =>
        db
          .insert(WebJsTable)
          .values({
            id: Identifier.ascending("web_js"),
            session_id: input.sessionID,
            url,
            origin: input.origin ?? null,
            analyzed: null,
            discovered_from: input.discoveredFrom ?? null,
            time_created: now,
            time_updated: now,
          })
          .onConflictDoNothing({ target: [WebJsTable.session_id, WebJsTable.url] })
          .returning()
          .all(),
      )
      if (inserted.length === 0) return // already known — don't churn the bus
      Bus.publish(Event.Updated, { sessionID: input.sessionID, js: get(input.sessionID) })
    } catch (e) {
      log.debug("WebJs.add failed (ignored)", { err: String(e) })
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) => db.select().from(WebJsTable).where(eq(WebJsTable.session_id, sessionID)).all())
    return rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      url: r.url,
      origin: r.origin ?? undefined,
      analyzed: r.analyzed ?? undefined,
      discovered_from: r.discovered_from ?? undefined,
      time: { created: r.time_created, updated: r.time_updated },
    }))
  }
}
