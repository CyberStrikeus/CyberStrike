#!/usr/bin/env bun
/**
 * CyberStrike HackR Browser — MCP Server
 *
 * Standalone MCP server that exposes the HackR browser tool via stdio transport.
 * Designed to be spawned by Claude CLI via --mcp-config so that Claude CLI
 * can use browser actions natively as tool calls.
 *
 * Usage:
 *   CYBERSTRIKE_WORK_DIR=/path/to/project bun run src/mcp/browser-server.ts
 *
 * Or via Claude CLI:
 *   claude -p --mcp-config '{"mcpServers":{"browser":{"command":"bun","args":["run","path/to/browser-server.ts"],"env":{"CYBERSTRIKE_WORK_DIR":"..."}}}}'
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { setWorkDir, BrowserTool } from "../tool/browser"
import { setAnalysisWorkDir } from "../tool/browser-analysis"

// Set work directory from env (required)
const workDir = process.env.CYBERSTRIKE_WORK_DIR || process.cwd()
setWorkDir(workDir)
setAnalysisWorkDir(workDir)

const sessionID = process.env.CYBERSTRIKE_SESSION_ID || `mcp-${Date.now()}`

// Initialize the browser tool
const browserToolDef = await BrowserTool.init()

// Create MCP server
const server = new McpServer(
  {
    name: "cyberstrike-browser",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

// Register the browser tool
server.tool(
  "browser",
  "HackR Browser — Multi-context Firefox browser for security testing. " +
    "Supports: launch, close, navigate, click, fill, wait, screenshot, execute, content, status, " +
    "network, console, har, analyze, replay, cookie_jar, compare, aggregate, create_context, " +
    "switch_context, list_contexts. Use launch first, then navigate/interact.",
  {
    action: z
      .enum([
        "launch",
        "close",
        "create_context",
        "switch_context",
        "list_contexts",
        "navigate",
        "click",
        "fill",
        "wait",
        "screenshot",
        "execute",
        "content",
        "status",
        "network",
        "console",
        "har",
        "analyze",
        "replay",
        "cookie_jar",
        "compare",
        "aggregate",
      ])
      .describe("The browser action to perform"),
    url: z.string().optional().describe("URL for navigate action"),
    selector: z.string().optional().describe("CSS selector for click, fill, screenshot, wait"),
    value: z.string().optional().describe("Value for fill action"),
    script: z.string().optional().describe("JavaScript for execute action"),
    fullPage: z.boolean().optional().describe("Full page screenshot (default: true)"),
    timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    context_id: z.string().optional().describe("Context ID for create/switch/cookie_jar"),
    context_label: z.string().optional().describe("Human-readable label for create_context"),
    context_color: z.string().optional().describe("Color for create_context (red, green, blue, etc.)"),
    context_role: z.string().optional().describe("Role for create_context (admin, user, unauth, etc.)"),
    target_domain: z.string().optional().describe("Target domain for scope filtering on launch"),
    filter: z
      .object({
        urlPattern: z.string().optional(),
        method: z.string().optional(),
        statusCode: z.number().optional(),
        resourceType: z.string().optional(),
        contextId: z.string().optional(),
      })
      .optional()
      .describe("Filter for network logs"),
    context_a: z.string().optional().describe("First context ID for compare"),
    context_b: z.string().optional().describe("Second context ID for compare"),
    endpoint: z.string().optional().describe("Endpoint URL for compare/replay"),
    replay_method: z.string().optional().describe("HTTP method for replay (GET, POST, etc.)"),
  },
  async (params) => {
    // Create minimal Tool.Context for the browser tool
    const ctx: any = {
      sessionID,
      messageID: `mcp-${Date.now()}`,
      agent: "web-application",
      abort: new AbortController().signal,
      messages: [],
      metadata: () => {},
      // Auto-approve all browser actions (Claude CLI already runs with --dangerously-skip-permissions)
      ask: async () => {},
    }

    try {
      const result = await browserToolDef.execute(
        {
          action: params.action,
          url: params.url,
          selector: params.selector,
          value: params.value,
          script: params.script,
          fullPage: params.fullPage ?? true,
          timeout: params.timeout ?? 30000,
          context_id: params.context_id,
          context_label: params.context_label,
          context_color: params.context_color,
          context_role: params.context_role,
          target_domain: params.target_domain,
          filter: params.filter,
          context_a: params.context_a,
          context_b: params.context_b,
          endpoint: params.endpoint,
          replay_method: params.replay_method,
        },
        ctx,
      )

      return {
        content: [
          {
            type: "text" as const,
            text: `[${result.title}]\n\n${result.output}`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      }
    }
  },
)

// Connect via stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
