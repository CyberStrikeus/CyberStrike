import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { NmapScan } from "./nmap"

export const NmapScanTable = sqliteTable(
  "nmap_scan",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    profile: text(),
    command: text(),
    source: text().notNull(),
    xml_hash: text().notNull(),
    raw_xml: text().notNull(),
    data: text({ mode: "json" }).notNull().$type<NmapScan.Data>(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("nmap_scan_session_idx").on(table.session_id, table.time_created),
    index("nmap_scan_hash_idx").on(table.session_id, table.xml_hash),
  ],
)
