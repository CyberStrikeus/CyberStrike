import type { LanguageModelV2 } from "@ai-sdk/provider"
import { runClaudeCli, extractResponseText, isClaudeCliBackendAvailable } from "./claude-cli-backend"
import { Log } from "@/util/log"

const log = Log.create({ service: "claude-cli-provider" })

// Tool call parsing
const TOOL_CALL_OPEN = "<tool_call>"
const TOOL_CALL_CLOSE = "</tool_call>"

// Tools that Claude CLI handles natively — don't inject into system prompt
const NATIVE_TOOL_IDS = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "invalid",
])

export interface ClaudeCliProviderSettings {
  /**
   * Working directory for the CLI
   */
  workingDirectory?: string
  /**
   * Timeout in milliseconds
   */
  timeout?: number
}

function generateToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Parse <tool_call> blocks from model response text.
 * Returns text parts (outside tool calls) and parsed tool calls.
 */
function parseToolCalls(text: string): {
  textParts: string[]
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>
} {
  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
  const textParts: string[] = []

  let remaining = text
  while (remaining.length > 0) {
    const openIdx = remaining.indexOf(TOOL_CALL_OPEN)
    if (openIdx === -1) {
      const trimmed = remaining.trim()
      if (trimmed) textParts.push(trimmed)
      break
    }

    const before = remaining.substring(0, openIdx).trim()
    if (before) textParts.push(before)

    const closeIdx = remaining.indexOf(TOOL_CALL_CLOSE, openIdx + TOOL_CALL_OPEN.length)
    if (closeIdx === -1) {
      textParts.push(remaining.substring(openIdx).trim())
      break
    }

    const jsonStr = remaining.substring(openIdx + TOOL_CALL_OPEN.length, closeIdx).trim()
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.name && typeof parsed.name === "string") {
        toolCalls.push({
          id: generateToolCallId(),
          name: parsed.name,
          args: parsed.arguments ?? {},
        })
      } else {
        textParts.push(remaining.substring(openIdx, closeIdx + TOOL_CALL_CLOSE.length))
      }
    } catch {
      textParts.push(remaining.substring(openIdx, closeIdx + TOOL_CALL_CLOSE.length))
    }

    remaining = remaining.substring(closeIdx + TOOL_CALL_CLOSE.length)
  }

  return { textParts, toolCalls }
}

/**
 * Format CyberStrike-specific tool definitions for injection into the system prompt.
 * Filters out tools that Claude CLI already handles natively.
 */
function formatToolDefinitions(tools: any[]): string {
  const externalTools = tools.filter((t: any) => !NATIVE_TOOL_IDS.has(t.name))
  if (externalTools.length === 0) return ""

  const lines: string[] = [
    "",
    "## External Tool System",
    "",
    "In addition to your built-in tools, you have access to these specialized tools.",
    "To invoke them, output your call in this EXACT format (including the XML tags):",
    "",
    "<tool_call>",
    '{"name": "tool_name", "arguments": {"param1": "value1"}}',
    "</tool_call>",
    "",
    "Rules:",
    "- Use <tool_call> XML tags for these tools — they are NOT available as built-in tools",
    "- Output ONE tool call per response, then STOP and wait for the result",
    "- Arguments must be valid JSON matching the parameter schema below",
    "- You may include brief text before the tool call to explain your reasoning",
    "- For built-in operations (bash, file read/write/edit, grep, glob), use your normal tools",
    "- For specialized operations (browser, memory, etc.), you MUST use <tool_call>",
    "- NEVER repeat a tool call that has already been executed — check the conversation history",
    "",
  ]

  for (const tool of externalTools) {
    lines.push(`### ${tool.name}`)
    if (tool.description) lines.push(tool.description)
    if (tool.parameters) {
      const { $schema, definitions, $defs, ...schema } = tool.parameters
      lines.push("")
      lines.push("Parameters:")
      lines.push("```json")
      lines.push(JSON.stringify(schema, null, 2))
      lines.push("```")
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Claude CLI Language Model implementation with tool calling support.
 *
 * Uses Claude CLI session-id for multi-turn conversation continuity.
 * On the first call, sends full prompt + system prompt with tool definitions.
 * On continuation calls (after tool execution), uses session-id to continue
 * the conversation, sending only tool results as the new prompt.
 */
class ClaudeCliLanguageModel {
  readonly specificationVersion = "v2" as const
  readonly provider = "claude-cli"
  readonly modelId: string
  readonly defaultObjectGenerationMode = "json" as const
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private settings: ClaudeCliProviderSettings

  /**
   * Map of CyberStrike session ID → Claude CLI session ID.
   * Allows multi-turn tool calling by continuing the same CLI conversation.
   */
  private cliSessions = new Map<string, string>()

  constructor(modelId: string, settings: ClaudeCliProviderSettings = {}) {
    this.modelId = modelId
    this.settings = settings
  }

  async doGenerate(options: any): Promise<any> {
    const tools = options.mode?.tools ?? options.tools ?? []
    const toolDefs = formatToolDefinitions(tools)
    const csSessionId = options.headers?.["x-cyberstrike-session"] ?? "default"
    const existingCliSession = this.cliSessions.get(csSessionId)
    const hasToolResults = (options.prompt ?? []).some((m: any) => m.role === "tool")
    const isContinuation = !!existingCliSession && hasToolResults

    let prompt: string
    let systemPrompt: string | undefined
    let sessionId: string | undefined

    if (isContinuation) {
      // Continuation: Claude CLI already has the conversation history via session-id.
      // Only send the tool results as the new user prompt.
      prompt = this.buildContinuationPrompt(options)
      systemPrompt = undefined // Already set in the session
      sessionId = existingCliSession
    } else {
      // First call: full prompt + system prompt with tool definitions
      prompt = this.buildInitialPrompt(options)
      const rawSystem = this.extractSystemPrompt(options)
      systemPrompt = toolDefs ? `${rawSystem ?? ""}\n${toolDefs}` : rawSystem || undefined
      sessionId = undefined
      this.cliSessions.delete(csSessionId) // Reset any stale session
    }

    log.info("doGenerate", {
      modelId: this.modelId,
      promptLength: prompt.length,
      toolCount: tools.length,
      hasExternalTools: !!toolDefs,
      isContinuation,
      hasCliSession: !!sessionId,
    })

    try {
      const response = await runClaudeCli(prompt, {
        model: this.modelId,
        systemPrompt,
        sessionId,
        resume: isContinuation,
        timeoutMs: this.settings.timeout,
        workingDirectory: this.settings.workingDirectory,
      })

      // Capture CLI session ID for subsequent continuation calls
      const respSessionId = response.session_id ?? response.sessionId
      if (respSessionId) {
        this.cliSessions.set(csSessionId, String(respSessionId))
      }

      const text = extractResponseText(response)
      const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 }
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0

      // Parse tool calls from response if external tools are available
      const content: any[] = []
      let finishReason = "stop"

      if (toolDefs) {
        const { textParts, toolCalls } = parseToolCalls(text)

        for (const tp of textParts) {
          content.push({ type: "text", text: tp })
        }
        for (const tc of toolCalls) {
          content.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            args: JSON.stringify(tc.args),
          })
        }

        if (toolCalls.length > 0) {
          finishReason = "tool-calls"
        }
        if (content.length === 0) {
          content.push({ type: "text", text: "" })
        }
      } else {
        content.push({ type: "text", text })
      }

      return {
        content,
        finishReason,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        warnings: [],
        request: { body: { prompt, model: this.modelId } },
        providerMetadata: respSessionId
          ? { "claude-cli": { sessionId: String(respSessionId) } }
          : undefined,
      }
    } catch (error) {
      // On error, clear the session so next call starts fresh
      this.cliSessions.delete(csSessionId)
      log.error("doGenerate failed", { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async doStream(options: any): Promise<any> {
    const result = await this.doGenerate(options)
    const events: any[] = []

    for (const part of result.content) {
      if (part.type === "text") {
        const textId = `text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        events.push({ type: "text-start", id: textId, providerMetadata: result.providerMetadata })
        events.push({ type: "text-delta", id: textId, delta: part.text })
        events.push({ type: "text-end", id: textId, providerMetadata: result.providerMetadata })
      } else if (part.type === "tool-call") {
        events.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args,
        })
      }
    }

    events.push({
      type: "finish",
      finishReason: result.finishReason,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
    })

    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(event)
        }
        controller.close()
      },
    })

    return { stream, warnings: [], request: result.request }
  }

  /**
   * Build prompt for the FIRST call (no session-id).
   * Includes full conversation history.
   */
  private buildInitialPrompt(options: any): string {
    const parts: string[] = []

    for (const message of options.prompt) {
      if (message.role === "system") continue

      if (message.role === "user") {
        const userParts: string[] = []
        for (const part of message.content) {
          if (part.type === "text") userParts.push(part.text)
        }
        if (userParts.length > 0) parts.push(userParts.join("\n"))
      } else if (message.role === "assistant") {
        const assistantParts: string[] = []
        for (const part of message.content) {
          if (part.type === "text") {
            assistantParts.push(part.text)
          } else if (part.type === "tool-call") {
            const args = typeof part.args === "string" ? JSON.parse(part.args) : part.args
            assistantParts.push(
              `${TOOL_CALL_OPEN}\n${JSON.stringify({ name: part.toolName, arguments: args }, null, 2)}\n${TOOL_CALL_CLOSE}`,
            )
          }
        }
        if (assistantParts.length > 0) parts.push(`Assistant: ${assistantParts.join("\n")}`)
      } else if (message.role === "tool") {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const resultText = typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)
            parts.push(`Tool "${part.toolName}" result:\n${part.isError ? "[ERROR] " : ""}${resultText}`)
          }
        }
      }
    }

    return parts.join("\n\n")
  }

  /**
   * Build prompt for CONTINUATION calls (with session-id).
   * Only sends tool results from the latest round — Claude CLI already
   * has the full conversation history via the session.
   */
  private buildContinuationPrompt(options: any): string {
    const parts: string[] = []
    const messages = options.prompt ?? []

    // Collect tool results (they come AFTER the last assistant message)
    for (const msg of messages) {
      if (msg.role === "tool") {
        for (const part of msg.content) {
          if (part.type === "tool-result") {
            const result = typeof part.result === "string" ? part.result : JSON.stringify(part.result, null, 2)
            parts.push(
              `Tool "${part.toolName}" returned:\n${part.isError ? "[ERROR] " : ""}${result}`,
            )
          }
        }
      }
    }

    if (parts.length === 0) return "Continue with the task."
    return parts.join("\n\n") + "\n\nProceed with the next step. Do NOT repeat previous tool calls."
  }

  /**
   * Extract system prompt from AI SDK message array.
   */
  private extractSystemPrompt(options: any): string | undefined {
    for (const message of options.prompt) {
      if (message.role === "system") {
        if (typeof message.content === "string") return message.content
        if (Array.isArray(message.content)) {
          return message.content
            .map((p: any) => (typeof p === "string" ? p : p.text ?? ""))
            .filter(Boolean)
            .join("\n")
        }
      }
    }
    return undefined
  }
}

/**
 * Create a Claude CLI provider
 */
export function createClaudeCliProvider(settings: ClaudeCliProviderSettings = {}) {
  return {
    languageModel(modelId: string): LanguageModelV2 {
      return new ClaudeCliLanguageModel(modelId, settings) as unknown as LanguageModelV2
    },
    textEmbeddingModel() {
      throw new Error("Claude CLI provider does not support text embedding")
    },
    imageModel() {
      throw new Error("Claude CLI provider does not support image generation")
    },
  }
}

/**
 * Check if Claude CLI provider is available
 */
export function isClaudeCliProviderAvailable(): boolean {
  return isClaudeCliBackendAvailable()
}
