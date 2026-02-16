import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"

const log = Log.create({ service: "memory" })

export namespace Memory {
  /**
   * Get the memory directory path
   * Uses .cyberstrike/memory/ in project root or global config
   */
  export function getMemoryDir(): string {
    const projectMemory = path.join(Instance.worktree, ".cyberstrike", "memory")
    if (existsSync(path.dirname(projectMemory))) {
      return projectMemory
    }
    return path.join(Global.Path.config, "memory")
  }

  /**
   * Get the path to MEMORY.md (long-term memory)
   */
  export function getMemoryFile(): string {
    return path.join(Instance.worktree, ".cyberstrike", "MEMORY.md")
  }

  /**
   * Get today's daily memory file path
   */
  export function getDailyMemoryFile(date?: Date): string {
    const d = date ?? new Date()
    const dateStr = d.toISOString().split("T")[0] // YYYY-MM-DD
    return path.join(getMemoryDir(), `${dateStr}.md`)
  }

  /**
   * Ensure memory directory exists
   */
  export async function ensureMemoryDir(): Promise<void> {
    const dir = getMemoryDir()
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Read long-term memory (MEMORY.md)
   */
  export async function readLongTermMemory(): Promise<string | null> {
    const file = getMemoryFile()
    try {
      return await fs.readFile(file, "utf-8")
    } catch (err: any) {
      if (err.code === "ENOENT") return null
      throw err
    }
  }

  /**
   * Read daily memory for a specific date
   */
  export async function readDailyMemory(date?: Date): Promise<string | null> {
    const file = getDailyMemoryFile(date)
    try {
      return await fs.readFile(file, "utf-8")
    } catch (err: any) {
      if (err.code === "ENOENT") return null
      throw err
    }
  }

  /**
   * Append to long-term memory
   */
  export async function appendToLongTermMemory(content: string): Promise<void> {
    const file = getMemoryFile()
    await fs.mkdir(path.dirname(file), { recursive: true })

    const existing = (await readLongTermMemory()) ?? ""
    const timestamp = new Date().toISOString()
    const entry = `\n\n## ${timestamp}\n\n${content}`

    await fs.writeFile(file, existing + entry, "utf-8")
    log.info("appended to long-term memory", { file })
  }

  /**
   * Append to daily memory
   */
  export async function appendToDailyMemory(content: string): Promise<void> {
    await ensureMemoryDir()
    const file = getDailyMemoryFile()

    const existing = (await readDailyMemory()) ?? `# Daily Notes - ${new Date().toISOString().split("T")[0]}\n`
    const timestamp = new Date().toLocaleTimeString()
    const entry = `\n\n### ${timestamp}\n\n${content}`

    await fs.writeFile(file, existing + entry, "utf-8")
    log.info("appended to daily memory", { file })
  }

  /**
   * Search memory files for a query (simple text search)
   */
  export async function search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const queryLower = query.toLowerCase()

    // Search MEMORY.md
    const longTerm = await readLongTermMemory()
    if (longTerm) {
      const matches = searchInContent(longTerm, queryLower, getMemoryFile())
      results.push(...matches)
    }

    // Search daily memory files
    const memoryDir = getMemoryDir()
    if (existsSync(memoryDir)) {
      const files = await fs.readdir(memoryDir)
      for (const file of files) {
        if (!file.endsWith(".md")) continue
        const filePath = path.join(memoryDir, file)
        const content = await fs.readFile(filePath, "utf-8")
        const matches = searchInContent(content, queryLower, filePath)
        results.push(...matches)
      }
    }

    return results.slice(0, 20) // Limit results
  }

  export interface SearchResult {
    file: string
    line: number
    content: string
    context: string
  }

  function searchInContent(content: string, query: string, file: string): SearchResult[] {
    const results: SearchResult[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query)) {
        const contextStart = Math.max(0, i - 2)
        const contextEnd = Math.min(lines.length, i + 3)
        const context = lines.slice(contextStart, contextEnd).join("\n")

        results.push({
          file,
          line: i + 1,
          content: lines[i],
          context,
        })
      }
    }

    return results
  }

  /**
   * List all memory files
   */
  export async function listMemoryFiles(): Promise<string[]> {
    const files: string[] = []

    const memoryFile = getMemoryFile()
    if (existsSync(memoryFile)) {
      files.push(memoryFile)
    }

    const memoryDir = getMemoryDir()
    if (existsSync(memoryDir)) {
      const dailyFiles = await fs.readdir(memoryDir)
      for (const file of dailyFiles) {
        if (file.endsWith(".md")) {
          files.push(path.join(memoryDir, file))
        }
      }
    }

    return files.sort().reverse() // Most recent first
  }

  /**
   * Get memory context for session start
   * Returns a summary of long-term memory and recent daily notes
   */
  export async function getSessionContext(): Promise<string | null> {
    const parts: string[] = []

    // Add long-term memory
    const longTerm = await readLongTermMemory()
    if (longTerm) {
      parts.push("## Long-term Memory (MEMORY.md)\n\n" + longTerm)
    }

    // Add today's notes
    const today = await readDailyMemory()
    if (today) {
      parts.push("## Today's Notes\n\n" + today)
    }

    // Add yesterday's notes if exists
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayNotes = await readDailyMemory(yesterday)
    if (yesterdayNotes) {
      parts.push("## Yesterday's Notes\n\n" + yesterdayNotes)
    }

    if (parts.length === 0) return null
    return parts.join("\n\n---\n\n")
  }
}
