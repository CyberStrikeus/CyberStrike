import { z } from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory"
import { MemoryStore } from "../memory/store"
import path from "path"
import { Session } from "../session"

export const MemorySearchTool = Tool.define("memory_search", {
  description: `Search through persistent memory for relevant information.

Use this tool to:
- Find previously stored decisions, preferences, or facts
- Recall context from past sessions
- Search for specific topics or keywords in memory

Structured memory is engagement-scoped, provenance-aware, secret-redacted, and ranked with FTS.
Legacy MEMORY.md and daily notes are searched as a fallback.`,
  parameters: z.object({
    query: z.string().describe("Search query - keywords or phrases to find in memory"),
  }),
  execute: async (params, ctx) => {
    const structured = MemoryStore.search({
      query: params.query,
      sessionID: Session.root(ctx.sessionID),
    })
    const results = await Memory.search(params.query)

    if (structured.length === 0 && results.length === 0) {
      return {
        title: `Memory search: "${params.query}"`,
        metadata: { query: params.query, matches: 0 },
        output: `No matches found for "${params.query}" in memory.`,
      }
    }

    const entries = structured.map(
      (entry) =>
        `### ${entry.title}\n\n${entry.content}\n\n_${entry.kind} · ${entry.trust} · ${Math.round(entry.confidence * 100)}% confidence · ${entry.source}_`,
    )
    const legacy = results.map((r) => {
      const relativePath = r.file.includes(".cyberstrike") ? r.file.split(".cyberstrike/")[1] : path.basename(r.file)
      return `### ${relativePath}:${r.line}\n\n${r.context}`
    })

    return {
      title: `Memory search: "${params.query}"`,
      metadata: { query: params.query, matches: structured.length + results.length },
      output: `Found ${structured.length + results.length} match(es) for "${params.query}":\n\n${[...entries, ...legacy].join("\n\n---\n\n")}`,
    }
  },
})

export const MemoryWriteTool = Tool.define("memory_write", {
  description: `Write an inferred fact or experience to structured persistent memory for future recall.

Use this tool to store:
- **Long-term semantic memory**: reusable project facts and decisions
- **Engagement episodic memory**: session-specific outcomes, failures, and context

Never write plaintext secrets. Content is redacted again at the storage boundary.
Model-authored entries are stored as inferred and must be re-verified before high-risk actions.`,
  parameters: z.object({
    content: z.string().describe("The content to write to memory"),
    type: z
      .enum(["long_term", "daily"])
      .default("daily")
      .describe("Where to store: 'long_term' for MEMORY.md, 'daily' for today's notes"),
    title: z.string().optional().describe("Optional title/heading for the memory entry"),
    tags: z.array(z.string()).optional().describe("Search and methodology tags"),
    related_ids: z.array(z.string()).optional().describe("Related topology or memory IDs"),
    confidence: z.number().min(0).max(1).optional().describe("Confidence from 0 to 1"),
  }),
  execute: async (params, ctx) => {
    const memoryType = params.type || "daily"
    const entry = MemoryStore.add({
      sessionID: memoryType === "daily" ? Session.root(ctx.sessionID) : undefined,
      kind: memoryType === "long_term" ? "semantic" : "episodic",
      title: params.title ?? (memoryType === "long_term" ? "Project memory" : "Engagement memory"),
      content: params.content,
      source: ctx.agent,
      trust: "inferred",
      confidence: params.confidence ?? 0.5,
      tags: params.tags,
      relatedIDs: params.related_ids,
    })

    return {
      title: memoryType === "long_term" ? "Saved semantic memory" : "Saved episodic memory",
      metadata: { type: memoryType, entryID: entry.id, redacted: entry.redacted },
      output: `Saved ${entry.kind} memory ${entry.id}${entry.redacted ? " with sensitive values redacted" : ""}.`,
    }
  },
})

export const MemoryReadTool = Tool.define("memory_read", {
  description: `Read contents of a specific memory file.

Available memory files:
- "MEMORY.md" or "long_term": Long-term memory with decisions and preferences
- "today" or "daily": Today's daily notes
- "yesterday": Yesterday's daily notes
- "YYYY-MM-DD": Specific date's daily notes (e.g., "2026-01-28")
- "list": List all available memory files`,
  parameters: z.object({
    file: z
      .string()
      .describe(
        'Which memory to read: "long_term", "today", "yesterday", "YYYY-MM-DD" date, or "list" to see all files',
      ),
  }),
  execute: async (params, _ctx) => {
    const file = params.file.toLowerCase()

    if (file === "list") {
      const files = await Memory.listMemoryFiles()
      return {
        title: "List memory files",
        metadata: { file: "list" },
        output:
          files.length === 0
            ? "No memory files found yet. Use memory_write to create some!"
            : `Available memory files:\n\n${files.map((f) => `- ${f}`).join("\n")}`,
      }
    }

    if (file === "long_term" || file === "memory.md") {
      const content = await Memory.readLongTermMemory()
      return {
        title: "Read long-term memory",
        metadata: { file: "MEMORY.md" },
        output: content
          ? `# Long-term Memory (MEMORY.md)\n\n${content}`
          : "Long-term memory (MEMORY.md) is empty. Use memory_write with type='long_term' to add entries.",
      }
    }

    if (file === "today" || file === "daily") {
      const content = await Memory.readDailyMemory()
      return {
        title: "Read daily notes",
        metadata: { file: "today" },
        output: content || "Today's daily notes are empty. Use memory_write with type='daily' to add entries.",
      }
    }

    if (file === "yesterday") {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const content = await Memory.readDailyMemory(yesterday)
      return {
        title: "Read yesterday's notes",
        metadata: { file: "yesterday" },
        output: content || "Yesterday's daily notes not found.",
      }
    }

    // Try to parse as date (YYYY-MM-DD)
    const dateMatch = file.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateMatch) {
      const date = new Date(file)
      const content = await Memory.readDailyMemory(date)
      return {
        title: `Read notes for ${file}`,
        metadata: { file },
        output: content || `No daily notes found for ${file}.`,
      }
    }

    return {
      title: "Read memory",
      metadata: { file: params.file },
      output: `Unknown memory file: "${params.file}". Use "list" to see available files.`,
    }
  },
})

export const MemoryContextTool = Tool.define("memory_context", {
  description: `Get trust-ranked structured memory plus legacy long-term and recent daily notes.

Structured memory is automatically injected when relevant, but this tool can refresh the full context.`,
  parameters: z.object({}),
  execute: async (_params, ctx) => {
    const structured = MemoryStore.context(Session.root(ctx.sessionID))
    const legacy = await Memory.getSessionContext()
    const context = [structured, legacy].filter(Boolean).join("\n\n---\n\n")
    return {
      title: "Get memory context",
      metadata: {},
      output: context
        ? `# Memory Context\n\n${context}`
        : "No memory context available. Start building memory with memory_write!",
    }
  },
})
