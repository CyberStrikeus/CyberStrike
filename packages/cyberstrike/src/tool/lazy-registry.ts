import { Log } from "../util/log"
import { MCP } from "../mcp"
import { Bus } from "../bus"
import type { Tool as AITool } from "ai"

const log = Log.create({ service: "tool.lazy-registry" })

/**
 * Lazy Tool Registry
 *
 * Dynamic tool loading to prevent context overflow.
 *
 * Problem:
 * - Each tool definition consumes ~500 tokens (description + parameters)
 * - 100 MCP tools = 50,000 tokens just for tool definitions
 *
 * Solution:
 * - Store only tool metadata (name, summary, keywords) - ~50 tokens each
 * - Full tool definitions loaded on-demand via ToolSearch
 * - Keep only actively-used tools in context
 */
export namespace LazyToolRegistry {
  export interface LazyTool {
    id: string
    name: string
    summary: string
    keywords: string[]
    category: string
    source: "mcp" | "plugin" | "builtin"
    mcpServer?: string
  }

  export interface LoadedTool {
    id: string
    tool: AITool
  }

  // State
  const lazyTools = new Map<string, LazyTool>()
  const loadedTools = new Map<string, LoadedTool>()
  const loadedToolIds = new Set<string>()

  const TOOL_CONTEXT_BUDGET = 30000
  const AVG_TOKENS_PER_TOOL = 500

  export async function init(): Promise<void> {
    log.info("initializing lazy tool registry")

    const mcpStatus = await MCP.status()
    const boltStatusMap = await MCP.boltStatus()
    const allStatus = { ...mcpStatus, ...boltStatusMap }
    const clients = await MCP.clients()

    for (const [serverName, status] of Object.entries(allStatus)) {
      if (status.status !== "connected") continue

      const client = clients[serverName]
      if (!client) continue

      try {
        const toolsResult = await client.listTools()

        for (const mcpTool of toolsResult.tools) {
          const sanitizedServerName = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
          const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
          const id = `${sanitizedServerName}_${sanitizedToolName}`

          const keywords = extractKeywords(mcpTool.name, mcpTool.description || "")
          const summary = (mcpTool.description || mcpTool.name).slice(0, 100)
          const category = categorize(keywords)

          lazyTools.set(id, {
            id,
            name: mcpTool.name,
            summary,
            keywords,
            category,
            source: "mcp",
            mcpServer: serverName,
          })
        }

        log.info("collected tool metadata", {
          server: serverName,
          count: toolsResult.tools.length,
        })
      } catch (err) {
        log.error("failed to collect tool metadata", { server: serverName, error: err })
      }
    }

    log.info("lazy tool registry initialized", {
      totalTools: lazyTools.size,
      loadedTools: loadedTools.size,
    })
  }

  /**
   * Refresh tools from a specific server (called when ToolListChanged notification fires)
   */
  export async function refresh(serverName: string): Promise<void> {
    const clients = await MCP.clients()
    const client = clients[serverName]
    if (!client) return

    try {
      const toolsResult = await client.listTools()
      const sanitizedServerName = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")

      for (const mcpTool of toolsResult.tools) {
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        const id = `${sanitizedServerName}_${sanitizedToolName}`

        if (lazyTools.has(id)) continue

        const keywords = extractKeywords(mcpTool.name, mcpTool.description || "")
        const summary = (mcpTool.description || mcpTool.name).slice(0, 100)
        const category = categorize(keywords)

        lazyTools.set(id, {
          id,
          name: mcpTool.name,
          summary,
          keywords,
          category,
          source: "mcp",
          mcpServer: serverName,
        })
      }

      log.info("refreshed tools from server", {
        server: serverName,
        totalTools: lazyTools.size,
      })
    } catch (err) {
      log.error("failed to refresh tools", { server: serverName, error: err })
    }
  }

  // Subscribe to MCP tool list changes (e.g., after kali_load on bolt)
  Bus.subscribe(MCP.ToolsChanged, async (payload) => {
    log.info("tools changed notification, refreshing", { server: payload.properties.server })
    await refresh(payload.properties.server)
  })

  export function search(query: string, limit = 10): LazyTool[] {
    const queryLower = query.toLowerCase()
    const queryWords = queryLower.split(/\s+/)

    const scored: Array<{ tool: LazyTool; score: number }> = []

    for (const tool of lazyTools.values()) {
      let score = 0

      if (tool.name.toLowerCase() === queryLower) {
        score += 100
      }

      if (tool.name.toLowerCase().includes(queryLower)) {
        score += 50
      }

      if (tool.summary.toLowerCase().includes(queryLower)) {
        score += 30
      }

      for (const word of queryWords) {
        for (const keyword of tool.keywords) {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 20
          }
        }
      }

      if (tool.category.toLowerCase().includes(queryLower)) {
        score += 25
      }

      if (score > 0) {
        scored.push({ tool, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, limit).map((s) => s.tool)
  }

  export async function load(toolIds: string[]): Promise<LoadedTool[]> {
    const newlyLoaded: LoadedTool[] = []

    const currentCount = loadedTools.size
    const newCount = toolIds.filter((id) => !loadedToolIds.has(id)).length
    const estimatedTokens = (currentCount + newCount) * AVG_TOKENS_PER_TOOL

    if (estimatedTokens > TOOL_CONTEXT_BUDGET) {
      log.warn("tool context budget exceeded, unloading least used tools", {
        current: currentCount,
        new: newCount,
        estimated: estimatedTokens,
        budget: TOOL_CONTEXT_BUDGET,
      })
    }

    const mcpTools = await MCP.tools()

    for (const id of toolIds) {
      if (loadedToolIds.has(id)) {
        const existing = loadedTools.get(id)
        if (existing) newlyLoaded.push(existing)
        continue
      }

      const lazyTool = lazyTools.get(id)
      if (!lazyTool) {
        log.warn("tool not found in lazy registry", { id })
        continue
      }

      const fullTool = mcpTools[id]
      if (!fullTool) {
        log.warn("tool not found in MCP", { id })
        continue
      }

      const loaded: LoadedTool = {
        id,
        tool: fullTool,
      }

      loadedTools.set(id, loaded)
      loadedToolIds.add(id)
      newlyLoaded.push(loaded)

      log.info("loaded tool", { id, source: lazyTool.source })
    }

    return newlyLoaded
  }

  export function unload(toolIds: string[]): void {
    for (const id of toolIds) {
      loadedTools.delete(id)
      loadedToolIds.delete(id)
      log.info("unloaded tool", { id })
    }
  }

  export function getLoaded(): LoadedTool[] {
    return Array.from(loadedTools.values())
  }

  export function getAll(): LazyTool[] {
    return Array.from(lazyTools.values())
  }

  export function isLoaded(id: string): boolean {
    return loadedToolIds.has(id)
  }

  export function stats(): {
    available: number
    loaded: number
    estimatedTokens: number
    budgetRemaining: number
  } {
    const loaded = loadedTools.size
    const estimatedTokens = loaded * AVG_TOKENS_PER_TOOL
    return {
      available: lazyTools.size,
      loaded,
      estimatedTokens,
      budgetRemaining: TOOL_CONTEXT_BUDGET - estimatedTokens,
    }
  }

  export function formatSearchResults(tools: LazyTool[]): string {
    if (tools.length === 0) {
      return "No matching tools found."
    }

    const lines = [
      `Found ${tools.length} matching tool(s):`,
      "",
      ...tools.map((t, i) => {
        const loaded = isLoaded(t.id) ? " [LOADED]" : ""
        return `${i + 1}. **${t.name}**${loaded}\n   ID: \`${t.id}\`\n   ${t.summary}\n   Category: ${t.category}`
      }),
      "",
      "Use `load_tools` with the tool IDs to make them available for use.",
    ]

    return lines.join("\n")
  }

  function extractKeywords(name: string, description: string): string[] {
    const text = `${name} ${description}`.toLowerCase()

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "must", "shall", "can", "need", "dare",
      "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
      "from", "as", "into", "through", "during", "before", "after", "above",
      "below", "between", "under", "again", "further", "then", "once",
      "and", "but", "or", "nor", "so", "yet", "this", "that", "these", "those",
    ])

    const words = text
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))

    return [...new Set(words)]
  }

  function categorize(keywords: string[]): string {
    const categories: Record<string, string[]> = {
      web: ["http", "web", "url", "api", "request", "response", "html", "css", "javascript", "browser"],
      network: ["network", "port", "scan", "nmap", "tcp", "udp", "ip", "dns", "socket"],
      file: ["file", "read", "write", "directory", "path", "folder"],
      security: ["security", "vulnerability", "exploit", "attack", "inject", "xss", "sql", "csrf"],
      cloud: ["aws", "azure", "gcp", "cloud", "s3", "ec2", "lambda", "bucket"],
      database: ["database", "sql", "query", "mysql", "postgres", "mongo", "redis"],
      git: ["git", "commit", "branch", "merge", "repository", "clone"],
      shell: ["shell", "bash", "command", "terminal", "exec", "process"],
    }

    for (const [category, categoryKeywords] of Object.entries(categories)) {
      for (const keyword of keywords) {
        if (categoryKeywords.some((ck) => keyword.includes(ck) || ck.includes(keyword))) {
          return category
        }
      }
    }

    return "general"
  }

  export function clear(): void {
    lazyTools.clear()
    loadedTools.clear()
    loadedToolIds.clear()
  }
}
