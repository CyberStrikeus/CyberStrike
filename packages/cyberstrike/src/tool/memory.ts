import { z } from "zod"
import { Tool } from "./tool"
import { Memory } from "../memory"
import path from "path"

export const MemorySearchTool = Tool.define("memory_search", {
  description: `Search through persistent memory for relevant information.

Use this tool to:
- Find previously stored decisions, preferences, or facts
- Recall context from past sessions
- Search for specific topics or keywords in memory

Memory is stored in:
- MEMORY.md: Long-term decisions, preferences, important facts
- memory/YYYY-MM-DD.md: Daily notes and session context`,
  parameters: z.object({
    query: z.string().describe("Search query - keywords or phrases to find in memory"),
  }),
  execute: async (params, _ctx) => {
    const results = await Memory.search(params.query)

    if (results.length === 0) {
      return {
        title: `Memory search: "${params.query}"`,
        metadata: { query: params.query, matches: 0 },
        output: `No matches found for "${params.query}" in memory.`,
      }
    }

    const output = results.map((r) => {
      const relativePath = r.file.includes(".cyberstrike") ? r.file.split(".cyberstrike/")[1] : path.basename(r.file)
      return `### ${relativePath}:${r.line}\n\n${r.context}`
    })

    return {
      title: `Memory search: "${params.query}"`,
      metadata: { query: params.query, matches: results.length },
      output: `Found ${results.length} match(es) for "${params.query}":\n\n${output.join("\n\n---\n\n")}`,
    }
  },
})

export const MemoryWriteTool = Tool.define("memory_write", {
  description: `Write information to persistent memory for future recall.

Use this tool to store:
- **MEMORY.md** (type: "long_term"): Decisions, preferences, important facts that should persist across sessions
- **Daily notes** (type: "daily"): Session context, temporary notes, work in progress

Examples of what to store in long-term memory:
- User preferences ("User prefers Python over JavaScript")
- Project decisions ("Using PostgreSQL for the database")
- Important context ("Main API endpoint is api.example.com")
- Learned facts ("The codebase uses monorepo structure")

Examples of what to store in daily notes:
- Current task progress
- Temporary context
- Session-specific notes`,
  parameters: z.object({
    content: z.string().describe("The content to write to memory"),
    type: z
      .enum(["long_term", "daily"])
      .default("daily")
      .describe("Where to store: 'long_term' for MEMORY.md, 'daily' for today's notes"),
    title: z.string().optional().describe("Optional title/heading for the memory entry"),
  }),
  execute: async (params, _ctx) => {
    const content = params.title ? `**${params.title}**\n\n${params.content}` : params.content
    const memoryType = params.type || "daily"

    if (memoryType === "long_term") {
      await Memory.appendToLongTermMemory(content)
    } else {
      await Memory.appendToDailyMemory(content)
    }

    return {
      title: memoryType === "long_term" ? "Saved to long-term memory" : "Saved to daily notes",
      metadata: { type: memoryType },
      output:
        memoryType === "long_term"
          ? `Saved to long-term memory (MEMORY.md):\n\n${content}`
          : `Saved to daily notes:\n\n${content}`,
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
  description: `Get the full memory context including long-term memory and recent daily notes.

This is automatically called at session start, but you can use it to refresh your memory context.`,
  parameters: z.object({}),
  execute: async (_params, _ctx) => {
    const context = await Memory.getSessionContext()
    return {
      title: "Get memory context",
      metadata: {},
      output: context
        ? `# Memory Context\n\n${context}`
        : "No memory context available. Start building memory with memory_write!",
    }
  },
})
