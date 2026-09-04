// Durable capture-coverage counts for the on-page panel / HUD, read from the SAME persistent store
// the analysis + TUI use (the request / endpoint_template tables + confirmed vulnerabilities) — NOT
// the in-memory DataCollector context. This keeps the panel honest: it reflects what is actually
// captured for the session, matches the rest of the product, survives a server restart, and reads 0
// for a fresh session instead of leaking a prior/synthetic in-memory tally.
import { Database, sql, eq } from "../../storage/db"
import { RequestTable, EndpointTemplateTable } from "../session.sql"
import { Vulnerability } from "../vulnerability"

export namespace WebStats {
  export interface Summary {
    captures: number // captured (analysis-relevant) requests
    endpoints: number // distinct endpoint templates
    pages: number // distinct pages (page_url) the requests came from
    vulns: number // confirmed vulnerabilities so far
  }

  export function summary(sessionID: string): Summary {
    const captures =
      Database.use((db) =>
        db.select({ n: sql<number>`count(*)` }).from(RequestTable).where(eq(RequestTable.session_id, sessionID)).get(),
      )?.n ?? 0
    const endpoints =
      Database.use((db) =>
        db
          .select({ n: sql<number>`count(*)` })
          .from(EndpointTemplateTable)
          .where(eq(EndpointTemplateTable.session_id, sessionID))
          .get(),
      )?.n ?? 0
    const pages =
      Database.use((db) =>
        db
          .select({ n: sql<number>`count(distinct ${RequestTable.page_url})` })
          .from(RequestTable)
          .where(sql`${RequestTable.session_id} = ${sessionID} and ${RequestTable.page_url} is not null and ${RequestTable.page_url} != ''`)
          .get(),
      )?.n ?? 0
    const vulns = Vulnerability.confirmed(sessionID).length
    return { captures, endpoints, pages, vulns }
  }
}
