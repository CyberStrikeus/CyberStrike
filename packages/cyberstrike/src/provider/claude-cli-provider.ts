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
      // Malformed — treat rest as text
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
      // Failed to parse JSON — treat block as text
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
 * Wraps the Claude Code CLI to provide AI SDK LanguageModelV2 compatibility.
 *
 * Tool calling works by:
 * 1. Injecting CyberStrike-specific tool definitions into the system prompt
 * 2. Parsing <tool_call> blocks from the model's response text
 * 3. Returning proper AI SDK tool-call content parts
 */
class ClaudeCliLanguageModel {
  readonly specificationVersion = "v2" as const
  readonly provider = "claude-cli"
  readonly modelId: string
  readonly defaultObjectGenerationMode = "json" as const
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private settings: ClaudeCliProviderSettings

  constructor(modelId: string, settings: ClaudeCliProviderSettings = {}) {
    this.modelId = modelId
    this.settings = settings
  }

  async doGenerate(options: any): Promise<any> {
    const prompt = this.buildPrompt(options)
    const systemPrompt = this.extractSystemPrompt(options)
    const tools = options.mode?.tools ?? options.tools ?? []
    const toolDefs = formatToolDefinitions(tools)

    const fullSystemPrompt = toolDefs ? `${systemPrompt ?? ""}\n${toolDefs}` : systemPrompt || undefined

    log.info("doGenerate", {
      modelId: this.modelId,
      promptLength: prompt.length,
      toolCount: tools.length,
      hasExternalTools: !!toolDefs,
    })

    try {
      const response = await runClaudeCli(prompt, {
        model: this.modelId,
        systemPrompt: fullSystemPrompt,
        timeoutMs: this.settings.timeout,
        workingDirectory: this.settings.workingDirectory,
      })

      const text = extractResponseText(response)
      const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 }
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0

      // Parse tool calls from response if tools are available
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
        providerMetadata: response.session_id
          ? { "claude-cli": { sessionId: String(response.session_id ?? response.sessionId) } }
          : undefined,
      }
    } catch (error) {
      log.error("doGenerate failed", { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async doStream(options: any): Promise<any> {
    // Claude CLI doesn't support true streaming — run doGenerate and convert to stream events
    const result = await this.doGenerate(options)
    const events: any[] = []

    for (const part of result.content) {
      if (part.type === "text") {
        const textId = `text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        events.push({ type: "text-start", id: textId, providerMetadata: result.providerMetadata })
        events.push({ type: "text-delta", id: textId, delta: part.text })
        events.push({ type: "text-end", id: textId, providerMetadata: result.providerMetadata })
      } else if (part.type === "tool-call") {
        // AI SDK expects: tool-input-start → tool-input-delta → tool-input-end → tool-call
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
   * Build prompt string from AI SDK message array.
   * Handles user, assistant (with tool-call parts), and tool-result messages.
   */
  private buildPrompt(options: any): string {
    const parts: string[] = []

    for (const message of options.prompt) {
      if (message.role === "system") {
        // System messages handled separately via extractSystemPrompt
        continue
      }

      if (message.role === "user") {
        const userParts: string[] = []
        for (const part of message.content) {
          if (part.type === "text") {
            userParts.push(part.text)
          }
        }
        if (userParts.length > 0) {
          parts.push(userParts.join("\n"))
        }
      } else if (message.role === "assistant") {
        const assistantParts: string[] = []
        for (const part of message.content) {
          if (part.type === "text") {
            assistantParts.push(part.text)
          } else if (part.type === "tool-call") {
            // Format previous tool calls so the model sees them in the same format
            const args = typeof part.args === "string" ? JSON.parse(part.args) : part.args
            assistantParts.push(
              `${TOOL_CALL_OPEN}\n${JSON.stringify({ name: part.toolName, arguments: args }, null, 2)}\n${TOOL_CALL_CLOSE}`,
            )
          }
        }
        if (assistantParts.length > 0) {
          parts.push(`Assistant: ${assistantParts.join("\n")}`)
        }
      } else if (message.role === "tool") {
        // Tool result messages — format them so the model can see previous tool execution results
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
