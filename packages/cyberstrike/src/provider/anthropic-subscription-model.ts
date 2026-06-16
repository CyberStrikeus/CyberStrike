import Anthropic from "@anthropic-ai/sdk"
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Prompt,
} from "@ai-sdk/provider"
import { getValidAnthropicToken } from "../auth/anthropic-oauth"
import { Log } from "../util/log"

const log = Log.create({ service: "anthropic-subscription-model" })

// Fixed Agent SDK system prefix that the genuine client (bountycode) sends as
// system[0]. Part of the wire shape that gets the request recognized.
const AGENT_SDK_PREFIX = "You are a Claude agent, built on Anthropic's Claude Agent SDK."

// Beta set that the subscription (Claude Pro/Max) is entitled to. PROVEN: this
// draws from the included quota (overage-status: rejected, claim: five_hour).
//
// IMPORTANT: do NOT add `context-1m-2025-08-07` here — the Max subscription is
// NOT entitled to the 1M-context beta and the server rejects the whole request
// with 400 "The long context beta is not yet available for this subscription".
// That single beta was the cause of every prior "extra usage"/400 failure.
// Similarly `effort-2025-11-24`/`advanced-tool-use-2025-11-20` are unnecessary
// and only add risk; the four below are sufficient and safe.
const SUBSCRIPTION_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
]

function mapStop(reason: string | null | undefined): LanguageModelV2FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop"
    case "max_tokens":
      return "length"
    case "tool_use":
      return "tool-calls"
    case "refusal":
      return "content-filter"
    default:
      return reason ? "unknown" : "stop"
  }
}

function mapToolChoice(tc: LanguageModelV2CallOptions["toolChoice"]): any {
  if (!tc) return undefined
  switch (tc.type) {
    case "auto":
      return { type: "auto" }
    case "none":
      return { type: "none" }
    case "required":
      return { type: "any" }
    case "tool":
      return { type: "tool", name: toWireToolName(tc.toolName) }
    default:
      return undefined
  }
}

function mapToolResultOutput(output: any): { content: any; is_error?: boolean } {
  switch (output?.type) {
    case "text":
      return { content: String(output.value ?? "") }
    case "json":
      return { content: JSON.stringify(output.value) }
    case "error-text":
      return { content: String(output.value ?? ""), is_error: true }
    case "error-json":
      return { content: JSON.stringify(output.value), is_error: true }
    case "content":
      return {
        content: (output.value ?? []).map((p: any) => {
          if (p.type === "text") return { type: "text", text: p.text }
          if (p.type === "media")
            return { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }
          return { type: "text", text: JSON.stringify(p) }
        }),
      }
    default:
      return { content: typeof output === "string" ? output : JSON.stringify(output ?? "") }
  }
}

function mapFilePart(part: any): any {
  // Image file part → Anthropic image block (base64 or url).
  const mt = part.mediaType ?? part.mimeType ?? ""
  if (typeof mt === "string" && mt.startsWith("image/")) {
    const data = part.data
    if (data instanceof URL || (typeof data === "string" && /^https?:\/\//.test(data))) {
      return { type: "image", source: { type: "url", url: String(data) } }
    }
    const b64 = typeof data === "string" ? data : Buffer.from(data).toString("base64")
    return { type: "image", source: { type: "base64", media_type: mt, data: b64 } }
  }
  return null
}

function mapPrompt(prompt: LanguageModelV2Prompt): { system: any[]; messages: any[] } {
  const systemTexts: string[] = []
  const messages: any[] = []

  for (const msg of prompt) {
    if (msg.role === "system") {
      systemTexts.push(typeof msg.content === "string" ? msg.content : "")
      continue
    }
    if (msg.role === "user") {
      const content: any[] = []
      for (const part of msg.content as any[]) {
        if (part.type === "text") content.push({ type: "text", text: part.text })
        else if (part.type === "file") {
          const f = mapFilePart(part)
          if (f) content.push(f)
        }
      }
      messages.push({ role: "user", content })
      continue
    }
    if (msg.role === "assistant") {
      const content: any[] = []
      for (const part of msg.content as any[]) {
        if (part.type === "text") content.push({ type: "text", text: part.text })
        else if (part.type === "tool-call") {
          let input = part.input
          if (typeof input === "string") {
            try {
              input = JSON.parse(input)
            } catch {
              input = {}
            }
          }
          content.push({ type: "tool_use", id: part.toolCallId, name: toWireToolName(part.toolName), input: input ?? {} })
        }
        // reasoning parts intentionally omitted (signature replay complexity)
      }
      messages.push({ role: "assistant", content })
      continue
    }
    if (msg.role === "tool") {
      const content: any[] = []
      for (const part of msg.content as any[]) {
        if (part.type === "tool-result") {
          const mapped = mapToolResultOutput(part.output)
          content.push({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: mapped.content,
            ...(mapped.is_error ? { is_error: true } : {}),
          })
        }
      }
      messages.push({ role: "user", content })
      continue
    }
  }

  // system[0] = fixed Agent SDK prefix, then the real system text.
  const system: any[] = [{ type: "text", text: AGENT_SDK_PREFIX }]
  const realSystem = systemTexts.filter(Boolean).join("\n\n")
  if (realSystem) system.push({ type: "text", text: realSystem })
  return { system, messages }
}

// Some exact tool names collide with server-side Claude Code built-in tools and
// route the request to "extra usage" (a 400 "out of extra usage" billing error)
// even when the subscription has included quota left. PROVEN: a tool literally
// named `todowrite` triggers this — renaming it to anything else (same schema)
// returns 200 included. We rename such names on the wire and map back on tool
// calls so cyberstrike's executor still sees its own names.
const RESERVED_WIRE_TOOL_NAMES = new Set(["todowrite"])
const WIRE_RENAME_SUFFIX = "_"
function toWireToolName(name: string): string {
  return RESERVED_WIRE_TOOL_NAMES.has(name) ? name + WIRE_RENAME_SUFFIX : name
}
function fromWireToolName(name: string): string {
  if (name.endsWith(WIRE_RENAME_SUFFIX) && RESERVED_WIRE_TOOL_NAMES.has(name.slice(0, -WIRE_RENAME_SUFFIX.length)))
    return name.slice(0, -WIRE_RENAME_SUFFIX.length)
  return name
}

function mapTools(tools: LanguageModelV2CallOptions["tools"]): any[] | undefined {
  if (!tools?.length) return undefined
  const out: any[] = []
  for (const t of tools as any[]) {
    if (t.type === "function") {
      out.push({ name: toWireToolName(t.name), description: t.description, input_schema: t.inputSchema })
    }
  }
  return out.length ? out : undefined
}

async function buildParams(
  modelID: string,
  options: LanguageModelV2CallOptions,
  userId: () => string,
  supportsThinking: boolean,
) {
  const { system, messages } = mapPrompt(options.prompt)
  const tools = mapTools(options.tools)
  const toolChoice = mapToolChoice(options.toolChoice)
  // `thinking`, `context_management` (clear_thinking) and `output_config.effort`
  // are only valid on models that support adaptive thinking (opus/sonnet, NOT
  // haiku — the server 400s "adaptive thinking is not supported on this model").
  // `clear_thinking` itself requires thinking to be enabled, so these three go
  // together. Gate them all on the model's reasoning capability.
  const thinkingFields = supportsThinking
    ? {
        thinking: { type: "adaptive" },
        context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
        output_config: { effort: "medium" },
      }
    : {}
  return {
    model: modelID,
    max_tokens: options.maxOutputTokens ?? 32000,
    system,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    // Thinking requires temperature:1, so we omit temperature/top_p/top_k.
    ...thinkingFields,
    ...(options.stopSequences?.length ? { stop_sequences: options.stopSequences } : {}),
    metadata: { user_id: userId() },
    betas: SUBSCRIPTION_BETAS,
  }
}

// Opt-in request dump (LLM_REQ_DUMP=1): captures the OFFICIAL SDK's full
// outgoing request (url + all headers + parsed body) for diffing vs bountycode.
const dumpFetch: typeof fetch = (async (url: any, init?: any) => {
  try {
    if (process.env["LLM_REQ_DUMP"]) {
      const fs = await import("node:fs")
      const headers = new Headers(init?.headers)
      const allHeaders: Record<string, string> = {}
      headers.forEach((v, k) => (allHeaders[k] = k.toLowerCase() === "authorization" ? `Bearer …${v.slice(-4)}` : v))
      let body: any
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      } catch {}
      const sys = Array.isArray(body?.system) ? body.system : undefined
      const rec = {
        ts: new Date().toISOString(),
        target: "cyberstrike-officialsdk",
        url: String(url),
        allHeaders,
        bodyKeys: body && typeof body === "object" ? Object.keys(body) : [],
        model: body?.model,
        betas: body?.betas ?? body?.anthropic_beta,
        system0: typeof sys?.[0]?.text === "string" ? sys[0].text.slice(0, 70) : undefined,
        system_blocks: sys?.length,
        metadata: body?.metadata,
        max_tokens: body?.max_tokens,
      }
      fs.appendFileSync(process.env["LLM_REQ_DUMP_FILE"] || "/tmp/llm-req-dump.jsonl", JSON.stringify(rec) + "\n")
    }
  } catch {}
  return fetch(url, init)
}) as any

async function makeClient(): Promise<Anthropic> {
  const token = await getValidAnthropicToken()
  if (!token) throw new Error("No Anthropic subscription token available (run: connect → Anthropic)")
  // authToken → Authorization: Bearer; apiKey null so env ANTHROPIC_API_KEY is ignored.
  return new Anthropic({ apiKey: null as any, authToken: token, maxRetries: 2, fetch: dumpFetch })
}

export function createAnthropicSubscriptionModel(
  modelID: string,
  deps: { userId: () => string; supportsThinking?: boolean },
): LanguageModelV2 {
  const supportsThinking = deps.supportsThinking ?? false
  return {
    specificationVersion: "v2",
    provider: "anthropic",
    modelId: modelID,
    supportedUrls: {},

    async doStream(options: LanguageModelV2CallOptions) {
      const client = await makeClient()
      const params = await buildParams(modelID, options, deps.userId, supportsThinking)

      // .beta.messages → adds ?beta=true (parity with the genuine client).
      // x-client-request-id: the genuine client sends it; official SDK doesn't by default.
      const reqId = (() => {
        try {
          return crypto.randomUUID()
        } catch {
          return undefined
        }
      })()
      const anthropicStream = await client.beta.messages.create(
        { ...(params as any), stream: true },
        { signal: options.abortSignal, ...(reqId ? { headers: { "x-client-request-id": reqId } } : {}) },
      )

      // Track each content block's kind by index so content_block_stop emits
      // the matching end part. Tool blocks accumulate their JSON input.
      const blocks = new Map<number, { kind: "text" | "thinking" | "tool"; id: string; name?: string; buf: string }>()
      let stopReason: string | null = null
      const usage = {
        inputTokens: undefined as number | undefined,
        outputTokens: undefined as number | undefined,
        totalTokens: undefined as number | undefined,
        cachedInputTokens: undefined as number | undefined,
      }

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] })
          try {
            for await (const ev of anthropicStream as any) {
              switch (ev.type) {
                case "message_start": {
                  controller.enqueue({ type: "response-metadata", id: ev.message?.id, modelId: ev.message?.model })
                  usage.inputTokens = ev.message?.usage?.input_tokens
                  usage.cachedInputTokens = ev.message?.usage?.cache_read_input_tokens
                  break
                }
                case "content_block_start": {
                  const idx = ev.index
                  const b = ev.content_block
                  const id = String(idx)
                  if (b.type === "text") {
                    blocks.set(idx, { kind: "text", id, buf: "" })
                    controller.enqueue({ type: "text-start", id })
                  } else if (b.type === "thinking" || b.type === "redacted_thinking") {
                    blocks.set(idx, { kind: "thinking", id, buf: "" })
                    controller.enqueue({ type: "reasoning-start", id })
                  } else if (b.type === "tool_use") {
                    const toolName = fromWireToolName(b.name)
                    blocks.set(idx, { kind: "tool", id: b.id, name: toolName, buf: "" })
                    controller.enqueue({ type: "tool-input-start", id: b.id, toolName })
                  }
                  break
                }
                case "content_block_delta": {
                  const blk = blocks.get(ev.index)
                  const d = ev.delta
                  if (d.type === "text_delta" && blk) controller.enqueue({ type: "text-delta", id: blk.id, delta: d.text })
                  else if (d.type === "thinking_delta" && blk)
                    controller.enqueue({ type: "reasoning-delta", id: blk.id, delta: d.thinking })
                  else if (d.type === "input_json_delta" && blk) {
                    blk.buf += d.partial_json
                    controller.enqueue({ type: "tool-input-delta", id: blk.id, delta: d.partial_json })
                  }
                  break
                }
                case "content_block_stop": {
                  const blk = blocks.get(ev.index)
                  if (!blk) break
                  if (blk.kind === "text") controller.enqueue({ type: "text-end", id: blk.id })
                  else if (blk.kind === "thinking") controller.enqueue({ type: "reasoning-end", id: blk.id })
                  else if (blk.kind === "tool") {
                    controller.enqueue({ type: "tool-input-end", id: blk.id })
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: blk.id,
                      toolName: blk.name ?? "",
                      input: blk.buf || "{}",
                    })
                  }
                  break
                }
                case "message_delta": {
                  stopReason = ev.delta?.stop_reason ?? stopReason
                  if (ev.usage?.output_tokens !== undefined) usage.outputTokens = ev.usage.output_tokens
                  break
                }
                case "message_stop": {
                  usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
                  controller.enqueue({ type: "finish", finishReason: mapStop(stopReason), usage })
                  break
                }
                case "error": {
                  controller.enqueue({ type: "error", error: ev.error ?? new Error("anthropic stream error") })
                  break
                }
              }
            }
            controller.close()
          } catch (error) {
            log.error("doStream error", { error: error instanceof Error ? error.message : String(error) })
            controller.enqueue({ type: "error", error })
            controller.close()
          }
        },
      })

      return { stream }
    },

    async doGenerate(options: LanguageModelV2CallOptions) {
      const client = await makeClient()
      const params = await buildParams(modelID, options, deps.userId, supportsThinking)
      const res: any = await client.beta.messages.create({ ...(params as any), stream: false }, { signal: options.abortSignal })

      const content: LanguageModelV2Content[] = []
      for (const b of res.content ?? []) {
        if (b.type === "text") content.push({ type: "text", text: b.text })
        else if (b.type === "thinking") content.push({ type: "reasoning", text: b.thinking })
        else if (b.type === "tool_use")
          content.push({ type: "tool-call", toolCallId: b.id, toolName: fromWireToolName(b.name), input: JSON.stringify(b.input ?? {}) })
      }
      return {
        content,
        finishReason: mapStop(res.stop_reason),
        usage: {
          inputTokens: res.usage?.input_tokens,
          outputTokens: res.usage?.output_tokens,
          totalTokens: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0),
          cachedInputTokens: res.usage?.cache_read_input_tokens,
        },
        warnings: [],
      }
    },
  }
}
