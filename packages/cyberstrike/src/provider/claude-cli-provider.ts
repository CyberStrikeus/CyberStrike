import type { LanguageModelV2 } from "@ai-sdk/provider"
import { runClaudeCli, extractResponseText, isClaudeCliBackendAvailable } from "./claude-cli-backend"
import { Log } from "@/util/log"

const log = Log.create({ service: "claude-cli-provider" })

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

/**
 * Claude CLI Language Model implementation
 * This wraps the Claude Code CLI to provide AI SDK compatibility
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

    log.info("doGenerate", { modelId: this.modelId, promptLength: prompt.length })

    try {
      const response = await runClaudeCli(prompt, {
        model: this.modelId,
        systemPrompt,
        timeoutMs: this.settings.timeout,
        workingDirectory: this.settings.workingDirectory,
      })

      const text = extractResponseText(response)
      const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 }
      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0

      return {
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        warnings: [],
        request: {
          body: { prompt, model: this.modelId },
        },
        providerMetadata: response.session_id
          ? {
              "claude-cli": {
                sessionId: String(response.session_id ?? response.sessionId),
              },
            }
          : undefined,
      }
    } catch (error) {
      log.error("doGenerate failed", { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  async doStream(options: any): Promise<any> {
    // Claude CLI doesn't support true streaming
    // We run doGenerate and convert the result to a stream format
    const result = await this.doGenerate(options)

    const textId = `claude-cli-text-${Date.now()}`

    // Create a simple stream that emits the full response
    const stream = new ReadableStream({
      start(controller) {
        // Emit text-start
        controller.enqueue({
          type: "text-start",
          id: textId,
          providerMetadata: result.providerMetadata,
        })

        // Emit text content as delta
        for (const content of result.content) {
          if (content.type === "text") {
            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: content.text,
            })
          }
        }

        // Emit text-end
        controller.enqueue({
          type: "text-end",
          id: textId,
          providerMetadata: result.providerMetadata,
        })

        // Emit finish
        controller.enqueue({
          type: "finish",
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        })

        controller.close()
      },
    })

    return {
      stream,
      warnings: [],
      request: result.request,
    }
  }

  private buildPrompt(options: any): string {
    const parts: string[] = []

    for (const message of options.prompt) {
      if (message.role === "user") {
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push(part.text)
          }
        }
      } else if (message.role === "assistant") {
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push(`Assistant: ${part.text}`)
          }
        }
      }
    }

    return parts.join("\n\n")
  }

  private extractSystemPrompt(options: any): string | undefined {
    for (const message of options.prompt) {
      if (message.role === "system") {
        return message.content
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
    // Stub methods to satisfy Provider interface
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
