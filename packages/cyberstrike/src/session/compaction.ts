import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { ProviderTransform } from "@/provider/transform"
import { streamText, type ModelMessage } from "ai"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const COMPACTION_BUFFER = 20_000

  // Chunked compaction constants
  const SAFETY_MARGIN = 1.2
  const BASE_CHUNK_RATIO = 0.4
  const MIN_CHUNK_RATIO = 0.15
  const DEFAULT_PARTS = 2
  const DEFAULT_SUMMARY_FALLBACK = "No prior history."
  const MERGE_SUMMARIES_INSTRUCTIONS =
    "Merge these partial summaries into a single cohesive summary. Preserve decisions," +
    " TODOs, open questions, and any constraints."

  // --- Chunked compaction utility functions ---

  /** Estimate tokens for a single message (info + parts). For tool parts: only count input + title, skip verbose output. */
  export function estimateMessageTokens(msg: MessageV2.WithParts): number {
    let tokens = 0
    // Count role/metadata overhead
    tokens += Token.estimate(msg.info.role)
    for (const part of msg.parts) {
      switch (part.type) {
        case "text":
          tokens += Token.estimate(part.text)
          break
        case "reasoning":
          tokens += Token.estimate(part.text)
          break
        case "tool":
          // Only count input + title for security — skip verbose output
          tokens += Token.estimate(JSON.stringify(part.state.input))
          if ("title" in part.state && part.state.title) {
            tokens += Token.estimate(part.state.title)
          }
          break
        case "file":
          tokens += Token.estimate(part.filename ?? "")
          break
        case "compaction":
        case "step-start":
        case "step-finish":
        case "snapshot":
        case "patch":
        case "agent":
        case "retry":
        case "subtask":
          // minimal overhead
          tokens += 10
          break
      }
    }
    return tokens
  }

  /** Sum token estimates for an array of messages. */
  export function estimateMessagesTokens(msgs: MessageV2.WithParts[]): number {
    return msgs.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
  }

  /** Compute adaptive chunk ratio. Reduces ratio when average message is large relative to context window. */
  export function computeAdaptiveChunkRatio(msgs: MessageV2.WithParts[], contextWindow: number): number {
    if (msgs.length === 0) return BASE_CHUNK_RATIO
    const totalTokens = estimateMessagesTokens(msgs)
    const avgTokens = totalTokens / msgs.length
    const safeAvgTokens = avgTokens * SAFETY_MARGIN
    const avgRatio = safeAvgTokens / contextWindow
    if (avgRatio > 0.1) {
      const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO)
      return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction)
    }
    return BASE_CHUNK_RATIO
  }

  /** Split messages into N parts by token distribution. */
  export function splitMessagesByTokenShare(
    msgs: MessageV2.WithParts[],
    parts = DEFAULT_PARTS,
  ): MessageV2.WithParts[][] {
    if (msgs.length === 0) return []
    const normalizedParts = Math.min(Math.max(1, Math.floor(parts)), Math.max(1, msgs.length))
    if (normalizedParts <= 1) return [msgs]

    const totalTokens = estimateMessagesTokens(msgs)
    const targetTokens = totalTokens / normalizedParts
    const chunks: MessageV2.WithParts[][] = []
    let current: MessageV2.WithParts[] = []
    let currentTokens = 0

    for (const msg of msgs) {
      const msgTokens = estimateMessageTokens(msg)
      if (chunks.length < normalizedParts - 1 && current.length > 0 && currentTokens + msgTokens > targetTokens) {
        chunks.push(current)
        current = []
        currentTokens = 0
      }
      current.push(msg)
      currentTokens += msgTokens
    }
    if (current.length > 0) chunks.push(current)
    return chunks
  }

  /** Chunk messages with a hard token cap per chunk. Oversized messages get isolated. */
  export function chunkMessagesByMaxTokens(msgs: MessageV2.WithParts[], maxTokens: number): MessageV2.WithParts[][] {
    if (msgs.length === 0) return []
    const chunks: MessageV2.WithParts[][] = []
    let currentChunk: MessageV2.WithParts[] = []
    let currentTokens = 0

    for (const msg of msgs) {
      const msgTokens = estimateMessageTokens(msg)
      if (currentChunk.length > 0 && currentTokens + msgTokens > maxTokens) {
        chunks.push(currentChunk)
        currentChunk = []
        currentTokens = 0
      }
      currentChunk.push(msg)
      currentTokens += msgTokens
      // Isolate oversized messages
      if (msgTokens > maxTokens) {
        chunks.push(currentChunk)
        currentChunk = []
        currentTokens = 0
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk)
    return chunks
  }

  /** Check if a single message is too large to safely summarize (>50% of context). */
  export function isOversizedForSummary(msg: MessageV2.WithParts, contextWindow: number): boolean {
    return estimateMessageTokens(msg) * SAFETY_MARGIN > contextWindow * 0.5
  }

  // --- Core chunked compaction functions ---

  /** Lightweight LLM call for intermediate chunk summaries. Not persisted — returns raw text. */
  async function callCompactionLLM(input: {
    model: Provider.Model
    messages: ModelMessage[]
    abort: AbortSignal
    sessionID: string
  }): Promise<string> {
    const language = await Provider.getLanguage(input.model)
    const result = streamText({
      model: language,
      messages: input.messages,
      abortSignal: input.abort,
      maxRetries: 0,
    })
    let text = ""
    for await (const chunk of result.textStream) {
      text += chunk
    }
    return text
  }

  /** Iteratively summarize chunks, feeding previous summary as context into each subsequent chunk. */
  async function summarizeChunked(input: {
    chunks: MessageV2.WithParts[][]
    model: Provider.Model
    promptText: string
    abort: AbortSignal
    sessionID: string
    previousSummary?: string
  }): Promise<string> {
    if (input.chunks.length === 0) return input.previousSummary ?? DEFAULT_SUMMARY_FALLBACK
    let summary = input.previousSummary

    for (let i = 0; i < input.chunks.length; i++) {
      const chunk = input.chunks[i]
      log.info("summarizing chunk", { chunk: i + 1, total: input.chunks.length, messages: chunk.length })
      const messages: ModelMessage[] = []
      // Inject previous summary as context
      if (summary) {
        messages.push({
          role: "system",
          content: `Previous conversation summary:\n${summary}`,
        })
      }
      // Add chunk messages as a combined user message with conversation transcript
      const transcript = chunk
        .map((msg) => {
          const role = msg.info.role
          const textParts = msg.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          const toolParts = msg.parts
            .filter((p): p is MessageV2.ToolPart => p.type === "tool")
            .map((p) => `[Tool: ${p.tool}] ${p.state.status === "completed" ? p.state.title : p.state.status}`)
            .join("\n")
          return `[${role}]\n${textParts}${toolParts ? "\n" + toolParts : ""}`
        })
        .join("\n\n---\n\n")

      messages.push({
        role: "user",
        content: [
          { type: "text", text: `Conversation chunk ${i + 1}/${input.chunks.length}:\n\n${transcript}` },
          { type: "text", text: input.promptText },
        ],
      })

      summary = await callCompactionLLM({
        model: input.model,
        messages,
        abort: input.abort,
        sessionID: input.sessionID,
      })
    }
    return summary ?? DEFAULT_SUMMARY_FALLBACK
  }

  /** Progressive fallback: full → partial (excluding oversized) → metadata-only. */
  async function summarizeWithFallback(input: {
    messages: MessageV2.WithParts[]
    model: Provider.Model
    promptText: string
    abort: AbortSignal
    sessionID: string
    maxChunkTokens: number
    contextWindow: number
    previousSummary?: string
  }): Promise<string> {
    if (input.messages.length === 0) return input.previousSummary ?? DEFAULT_SUMMARY_FALLBACK

    // Try full summarization
    try {
      const chunks = chunkMessagesByMaxTokens(input.messages, input.maxChunkTokens)
      return await summarizeChunked({
        chunks,
        model: input.model,
        promptText: input.promptText,
        abort: input.abort,
        sessionID: input.sessionID,
        previousSummary: input.previousSummary,
      })
    } catch (fullError) {
      log.warn("full summarization failed, trying partial", {
        error: fullError instanceof Error ? fullError.message : String(fullError),
      })
    }

    // Fallback 1: exclude oversized messages, add notes
    const smallMessages: MessageV2.WithParts[] = []
    const oversizedNotes: string[] = []
    for (const msg of input.messages) {
      if (isOversizedForSummary(msg, input.contextWindow)) {
        const tokens = estimateMessageTokens(msg)
        oversizedNotes.push(`[Large ${msg.info.role} (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`)
      } else {
        smallMessages.push(msg)
      }
    }

    if (smallMessages.length > 0) {
      try {
        const chunks = chunkMessagesByMaxTokens(smallMessages, input.maxChunkTokens)
        const partialSummary = await summarizeChunked({
          chunks,
          model: input.model,
          promptText: input.promptText,
          abort: input.abort,
          sessionID: input.sessionID,
          previousSummary: input.previousSummary,
        })
        const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : ""
        return partialSummary + notes
      } catch (partialError) {
        log.warn("partial summarization also failed", {
          error: partialError instanceof Error ? partialError.message : String(partialError),
        })
      }
    }

    // Final fallback: metadata-only note
    return (
      `Context contained ${input.messages.length} messages (${oversizedNotes.length} oversized). ` +
      `Summary unavailable due to size limits.`
    )
  }

  /** 2-stage compaction: split by token share → summarize each partition → merge partial summaries. */
  async function summarizeInStages(input: {
    messages: MessageV2.WithParts[]
    model: Provider.Model
    promptText: string
    abort: AbortSignal
    sessionID: string
    maxChunkTokens: number
    contextWindow: number
    parts?: number
    previousSummary?: string
  }): Promise<string> {
    const { messages } = input
    if (messages.length === 0) return input.previousSummary ?? DEFAULT_SUMMARY_FALLBACK

    const parts = Math.min(Math.max(1, Math.floor(input.parts ?? DEFAULT_PARTS)), Math.max(1, messages.length))
    const totalTokens = estimateMessagesTokens(messages)
    const minMessagesForSplit = 4

    // If small enough, use direct fallback path
    if (parts <= 1 || messages.length < minMessagesForSplit || totalTokens <= input.maxChunkTokens) {
      return summarizeWithFallback(input)
    }

    // Stage 1: split by token share, summarize each partition independently
    const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0)
    if (splits.length <= 1) return summarizeWithFallback(input)

    log.info("stage 1: summarizing partitions", { partitions: splits.length })
    const partialSummaries: string[] = []
    for (const chunk of splits) {
      partialSummaries.push(
        await summarizeWithFallback({
          ...input,
          messages: chunk,
          previousSummary: undefined,
        }),
      )
    }

    if (partialSummaries.length === 1) return partialSummaries[0]

    // Stage 2: merge partial summaries via LLM
    log.info("stage 2: merging partial summaries", { count: partialSummaries.length })
    const mergeInstructions = input.promptText
      ? `${MERGE_SUMMARIES_INSTRUCTIONS}\n\nAdditional focus:\n${input.promptText}`
      : MERGE_SUMMARIES_INSTRUCTIONS

    const mergeMessages: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              mergeInstructions +
              "\n\n" +
              partialSummaries.map((s, i) => `### Partial Summary ${i + 1}\n\n${s}`).join("\n\n---\n\n"),
          },
        ],
      },
    ]

    try {
      return await callCompactionLLM({
        model: input.model,
        messages: mergeMessages,
        abort: input.abort,
        sessionID: input.sessionID,
      })
    } catch (mergeError) {
      log.warn("merge failed, concatenating summaries", {
        error: mergeError instanceof Error ? mergeError.message : String(mergeError),
      })
      return partialSummaries.join("\n\n---\n\n")
    }
  }

  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false

    const count =
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write

    const reserved =
      config.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
    const usable = input.model.limit.input
      ? input.model.limit.input - reserved
      : context - ProviderTransform.maxOutputTokens(input.model)
    return count >= usable
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: MessageV2.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!.info as MessageV2.User
    const agent = await Agent.get("compaction")
    const model = agent.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      variant: userMessage.variant,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")

    // Determine if we need chunked compaction
    const config = await Config.get()
    const contextWindow = model.limit.context || 128_000
    const chunkRatio = computeAdaptiveChunkRatio(input.messages, contextWindow)
    const maxChunkTokens = Math.floor(contextWindow * chunkRatio)
    const totalEstimatedTokens = estimateMessagesTokens(input.messages)
    const chunkParts = config.compaction?.chunkParts ?? DEFAULT_PARTS

    let summaryText: string | undefined
    if (totalEstimatedTokens > maxChunkTokens) {
      // Large session: use staged compaction
      log.info("using chunked compaction", {
        totalTokens: totalEstimatedTokens,
        maxChunkTokens,
        chunkRatio,
        messages: input.messages.length,
      })
      summaryText = await summarizeInStages({
        messages: input.messages,
        model,
        promptText,
        abort: input.abort,
        sessionID: input.sessionID,
        maxChunkTokens,
        contextWindow,
        parts: chunkParts,
      })
    }

    // Feed the result through processor for proper token/cost/step tracking.
    // If chunked compaction produced a summary, use it as pre-computed context.
    // Otherwise, use the original single-pass approach.
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: summaryText
        ? [`You have already summarized the conversation in stages. Here is the merged summary:\n\n${summaryText}\n\nRefine this summary if needed, or output it as-is if it is already comprehensive.`]
        : [],
      messages: summaryText
        ? [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: promptText,
                },
              ],
            },
          ]
        : [
            ...MessageV2.toModelMessages(input.messages, model),
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: promptText,
                },
              ],
            },
          ],
      model,
    })

    if (result === "continue" && input.auto) {
      const continueMsg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
        },
        agent: userMessage.agent,
        model: userMessage.model,
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: continueMsg.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      })
    }
    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
      })
    },
  )
}
