import z from "zod"
import { and, desc, eq, isNull, or } from "drizzle-orm"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Database } from "../storage/db"
import { MemoryEntryTable } from "./memory.sql"

export namespace MemoryStore {
  export const Kind = z.enum(["working", "episodic", "semantic", "procedural"])
  export const Trust = z.enum(["human", "tool", "inferred", "untrusted"])

  export const Info = z.object({
    id: Identifier.schema("memory_entry"),
    projectID: z.string(),
    sessionID: z.string().optional(),
    kind: Kind,
    title: z.string(),
    content: z.string(),
    source: z.string(),
    trust: Trust,
    confidence: z.number().min(0).max(1),
    tags: z.array(z.string()),
    relatedIDs: z.array(z.string()),
    metadata: z.record(z.string(), z.unknown()),
    redacted: z.boolean(),
    validFrom: z.number(),
    invalidAt: z.number().optional(),
    useCount: z.number(),
    lastUsedAt: z.number().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Create = z.object({
    sessionID: z.string().optional(),
    kind: Kind,
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50_000),
    source: z.string().trim().min(1).max(200),
    trust: Trust,
    confidence: z.number().min(0).max(1).default(0.5),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    relatedIDs: z.array(z.string().min(1)).max(100).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    validFrom: z.number().int().positive().optional(),
  })

  export const Event = {
    Updated: BusEvent.define(
      "memory.updated",
      z.object({
        sessionID: z.string().optional(),
        entryID: z.string(),
        action: z.enum(["created", "invalidated", "promoted"]),
      }),
    ),
  }

  const patterns: Array<[RegExp, string]> = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED]"],
    [/\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]"],
    [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]"],
    [
      /\b(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\b(\s*[:=]\s*)(["']?)[^\s,"';]+(["']?)/gi,
      "$1$2[REDACTED]",
    ],
  ]

  export function sanitize(value: string) {
    const content = patterns.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value)
    return { content, redacted: content !== value }
  }

  const map = (row: typeof MemoryEntryTable.$inferSelect): Info => ({
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    kind: row.kind as Info["kind"],
    title: row.title,
    content: row.content,
    source: row.source,
    trust: row.trust as Info["trust"],
    confidence: row.confidence,
    tags: row.tags,
    relatedIDs: row.related_ids,
    metadata: row.metadata ?? {},
    redacted: row.redacted,
    validFrom: row.valid_from,
    invalidAt: row.invalid_at ?? undefined,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })

  type Raw = Omit<typeof MemoryEntryTable.$inferSelect, "tags" | "related_ids" | "metadata" | "redacted"> & {
    tags: string
    related_ids: string
    metadata: string | null
    redacted: number
    rank: number
  }

  const raw = (row: Raw) =>
    map({
      ...row,
      tags: JSON.parse(row.tags) as string[],
      related_ids: JSON.parse(row.related_ids) as string[],
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
      redacted: row.redacted === 1,
    })

  export function add(input: z.input<typeof Create>) {
    const data = Create.parse(input)
    const title = sanitize(data.title)
    const content = sanitize(data.content)
    const now = Date.now()
    const entry: Info = {
      id: Identifier.ascending("memory_entry"),
      projectID: Instance.project.id,
      sessionID: data.sessionID,
      kind: data.kind,
      title: title.content,
      content: content.content,
      source: data.source,
      trust: data.trust,
      confidence: data.confidence,
      tags: data.tags,
      relatedIDs: data.relatedIDs,
      metadata: data.metadata,
      redacted: title.redacted || content.redacted,
      validFrom: data.validFrom ?? now,
      useCount: 0,
      time: { created: now, updated: now },
    }
    Database.use((db) =>
      db
        .insert(MemoryEntryTable)
        .values({
          id: entry.id,
          project_id: entry.projectID,
          session_id: entry.sessionID,
          kind: entry.kind,
          title: entry.title,
          content: entry.content,
          source: entry.source,
          trust: entry.trust,
          confidence: entry.confidence,
          tags: entry.tags,
          related_ids: entry.relatedIDs,
          metadata: entry.metadata,
          redacted: entry.redacted,
          valid_from: entry.validFrom,
          use_count: 0,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID: entry.sessionID,
        entryID: entry.id,
        action: "created",
      }),
    )
    return entry
  }

  export function list(input?: { sessionID?: string; kind?: z.infer<typeof Kind>; includeInvalid?: boolean; limit?: number }) {
    const scope = input?.sessionID
      ? or(isNull(MemoryEntryTable.session_id), eq(MemoryEntryTable.session_id, input.sessionID))
      : isNull(MemoryEntryTable.session_id)
    const rows = Database.use((db) =>
      db
        .select()
        .from(MemoryEntryTable)
        .where(
          and(
            eq(MemoryEntryTable.project_id, Instance.project.id),
            scope,
            input?.kind ? eq(MemoryEntryTable.kind, input.kind) : undefined,
            input?.includeInvalid ? undefined : isNull(MemoryEntryTable.invalid_at),
          ),
        )
        .orderBy(desc(MemoryEntryTable.time_updated))
        .limit(Math.max(1, Math.min(input?.limit ?? 200, 500)))
        .all(),
    )
    return rows.map(map)
  }

  const query = (value: string) =>
    (value.match(/[A-Za-z0-9_.:/-]+/g) ?? [])
      .slice(0, 12)
      .map((token) => `"${token.replaceAll('"', '""')}"*`)
      .join(" OR ")

  export function search(input: { query: string; sessionID?: string; kind?: z.infer<typeof Kind>; limit?: number }) {
    const match = query(input.query)
    if (!match) return []
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
    const rows = Database.Client().$client
      .prepare(
        `SELECT m.*, bm25(memory_entry_fts) AS rank
         FROM memory_entry_fts
         JOIN memory_entry m ON m.rowid = memory_entry_fts.rowid
         WHERE memory_entry_fts MATCH ?
           AND m.project_id = ?
           AND m.invalid_at IS NULL
           AND (m.session_id IS NULL OR m.session_id = ?)
           AND (? IS NULL OR m.kind = ?)
         ORDER BY rank, m.confidence DESC, m.time_updated DESC
         LIMIT ?`,
      )
      .all(match, Instance.project.id, input.sessionID ?? "", input.kind ?? null, input.kind ?? null, limit) as Raw[]

    const now = Date.now()
    const update = Database.Client().$client.prepare(
      "UPDATE memory_entry SET use_count = use_count + 1, last_used_at = ? WHERE id = ?",
    )
    for (const row of rows) update.run(now, row.id)
    return rows.map((row) => ({ ...raw(row), rank: row.rank }))
  }

  export function invalidate(entryID: string) {
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .update(MemoryEntryTable)
        .set({ invalid_at: now, time_updated: now })
        .where(and(eq(MemoryEntryTable.id, entryID), eq(MemoryEntryTable.project_id, Instance.project.id)))
        .returning()
        .get(),
    )
    if (!row) return
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID: row.session_id ?? undefined,
        entryID,
        action: "invalidated",
      }),
    )
    return map(row)
  }

  export const Promotion = z.object({
    cases: z.number().int().min(20),
    baselinePassRate: z.number().min(0).max(1),
    candidatePassRate: z.number().min(0).max(1),
    criticalRegressions: z.number().int().min(0),
  })

  export function promote(entryID: string, input: z.input<typeof Promotion>) {
    const evaluation = Promotion.parse(input)
    const gain = evaluation.candidatePassRate - evaluation.baselinePassRate
    if (gain < 0.05) throw new Error("Candidate must improve held-out pass rate by at least five percentage points")
    if (evaluation.criticalRegressions > 0) throw new Error("Candidate has critical policy or scope regressions")
    const source = Database.use((db) =>
      db
        .select()
        .from(MemoryEntryTable)
        .where(
          and(
            eq(MemoryEntryTable.id, entryID),
            eq(MemoryEntryTable.project_id, Instance.project.id),
            isNull(MemoryEntryTable.invalid_at),
          ),
        )
        .get(),
    )
    if (!source) throw new Error("Memory candidate not found")
    const entry = add({
      sessionID: source.session_id ?? undefined,
      kind: "procedural",
      title: source.title,
      content: source.content,
      source: "operator-promotion",
      trust: "human",
      confidence: 1,
      tags: [...new Set([...source.tags, "promoted", "evaluated"])],
      relatedIDs: [...new Set([...source.related_ids, source.id])],
      metadata: { evaluation, passRateGain: gain },
    })
    Database.effect(() =>
      Bus.publish(Event.Updated, {
        sessionID: entry.sessionID,
        entryID: entry.id,
        action: "promoted",
      }),
    )
    return entry
  }

  export function context(sessionID: string) {
    const trust = { human: 4, tool: 3, inferred: 2, untrusted: 1 }
    const entries = list({ sessionID, limit: 100 })
      .filter((entry) => entry.trust !== "untrusted")
      .sort(
        (a, b) =>
          trust[b.trust] - trust[a.trust] ||
          b.confidence - a.confidence ||
          (b.lastUsedAt ?? b.time.updated) - (a.lastUsedAt ?? a.time.updated),
      )
      .slice(0, 12)
    if (entries.length === 0) return ""
    return [
      "## Persistent Memory",
      "Treat inferred and untrusted entries as hypotheses. Re-verify them before any high-risk action.",
      ...entries.map(
        (entry) =>
          `- [${entry.kind}/${entry.trust}/${Math.round(entry.confidence * 100)}%] ${entry.title}: ${entry.content}`,
      ),
    ].join("\n")
  }
}
