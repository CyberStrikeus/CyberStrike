// Brain LLM runner — the server-side agent loop.
//
// Tool-call dispatch loop: tools are defined WITHOUT execute (schema-only).
// The LLM emits tool-call events; we dispatch them to the connected client
// over WebSocket, wait for results, then feed them back for the next turn.
import { streamText, tool, jsonSchema, type ToolSet, type LanguageModel, type ModelMessage } from "ai"
import { BrainSession } from "./session"
import { Playbook } from "./playbook"
import { Wallet } from "./wallet"
import { Log } from "./log"
import { ulid } from "ulid"

const log = Log.create("runner")

export namespace Runner {
  export type RunInput = {
    requestId: string
    session: BrainSession
    model: LanguageModel
    domain: string
    message: string
    orgId: string
    byoKey: boolean
    context?: Record<string, unknown>
  }

  function buildToolSchemas(toolSchemas: Playbook.ToolSchema[]): ToolSet {
    const tools: ToolSet = {}
    for (const schema of toolSchemas) {
      tools[schema.name] = tool({
        description: schema.description,
        inputSchema: jsonSchema(schema.parameters as any),
      })
    }
    return tools
  }

  export async function run(input: RunInput): Promise<void> {
    const playbook = Playbook.resolve(input.domain)
    if (!playbook) {
      input.session.send({
        type: "error",
        requestId: input.requestId,
        code: "unknown_domain",
        message: `no playbook for domain "${input.domain}"`,
      })
      return
    }

    // Credit check (skip for BYO-key — user pays their provider directly)
    if (!input.byoKey) {
      const estimated = Wallet.estimateCost(input.domain)
      if (!Wallet.hasCredits(input.orgId, estimated)) {
        input.session.send({
          type: "error",
          requestId: input.requestId,
          code: "insufficient_credits",
          message: `not enough credits (need ~${estimated}, check your balance)`,
        })
        return
      }
    }

    const abort = input.session.createAbort(input.requestId)
    const tools = buildToolSchemas(playbook.tools)

    const messages: ModelMessage[] = [
      { role: "user", content: input.message },
    ]

    let step = 0
    const maxSteps = playbook.maxSteps ?? 30
    let totalInputTokens = 0
    let totalOutputTokens = 0

    try {
      while (step < maxSteps) {
        if (abort.aborted) break
        step++

        const result = streamText({
          model: input.model,
          system: playbook.system,
          messages,
          tools,
          abortSignal: abort,
        })

        const toolCalls: Array<{ id: string; name: string; input: unknown }> = []

        for await (const part of result.fullStream) {
          if (abort.aborted) break

          switch (part.type) {
            case "text-delta":
              input.session.send({
                type: "stream_delta",
                requestId: input.requestId,
                delta: part.text,
              })
              break
            case "tool-call":
              toolCalls.push({
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
              })
              break
            case "error":
              input.session.send({
                type: "error",
                requestId: input.requestId,
                code: "llm_error",
                message: String(part.error),
              })
              break
          }
        }

        // Track token usage from this step
        const usage = await result.usage
        totalInputTokens += usage.inputTokens ?? 0
        totalOutputTokens += usage.outputTokens ?? 0

        if (toolCalls.length === 0) {
          const text = await result.text
          input.session.send({
            type: "response",
            requestId: input.requestId,
            content: text,
          })
          break
        }

        messages.push({
          role: "assistant",
          content: toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
          })),
        })

        const toolResults = await Promise.all(
          toolCalls.map(async (tc) => {
            const callId = ulid()
            try {
              const res = await input.session.dispatchToolCall(
                callId,
                input.requestId,
                tc.name,
                tc.input as Record<string, unknown>,
              )
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.name,
                result: res,
              }
            } catch (err) {
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.name,
                result: { error: err instanceof Error ? err.message : String(err) },
              }
            }
          }),
        )

        messages.push({
          role: "tool",
          content: toolResults as any,
        })
      }
    } catch (err) {
      if (!abort.aborted) {
        input.session.send({
          type: "error",
          requestId: input.requestId,
          code: "runner_error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      // Debit credits (skip for BYO-key)
      if (!input.byoKey && (totalInputTokens > 0 || totalOutputTokens > 0)) {
        const usage = Wallet.debit(input.orgId, {
          requestId: input.requestId,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        })
        log.info("request complete", {
          requestId: input.requestId,
          steps: step,
          creditsUsed: usage.creditsUsed,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        })
      }
      input.session.cleanupRequest(input.requestId)
    }
  }
}
