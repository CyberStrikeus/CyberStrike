// LLMTR (https://llmtr.com) is a Türkiye-based, OpenAI-compatible AI gateway.
//
// It is not published in the models.dev catalog, so the provider entry is built
// here from the gateway's own `/v1/models` endpoint (public, no key required)
// and merged into the catalog by ModelsDev.get(). Everything downstream —
// `cyberstrike auth login`, the model picker, the app's provider settings —
// then sees LLMTR exactly like any models.dev provider.
//
// Two things make LLMTR worth a first-class entry instead of a config snippet:
// models hosted inside Türkiye (Trendyol Asure, Magibu, Muse Glimmer, local
// Qwen/Gemma builds) that no other provider carries, and per-model pricing that
// is often below the upstream list price. Both are catalog facts, so they only
// reach the user if the live catalog is what populates the model list.

import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"
import { lazy } from "@/util/lazy"
import type { ModelsDev } from "./models"

export namespace LLMTR {
  const log = Log.create({ service: "llmtr" })

  export const ID = "llmtr"
  export const NAME = "LLMTR"
  export const ENV = "LLMTR_API_KEY"
  export const NPM = "@ai-sdk/openai-compatible"

  const filepath = path.join(Global.Path.cache, "llmtr.json")

  export function url() {
    return Flag.CYBERSTRIKE_LLMTR_URL || "https://llmtr.com/v1"
  }

  // The gateway returns an OpenRouter-shaped catalog: pricing in dollars per
  // token, modalities under `architecture`, per-model `supported_parameters`.
  type Entry = {
    id: string
    name?: string
    created?: number
    context_length?: number
    supported_operations?: string[]
    architecture?: {
      input_modalities?: string[]
      output_modalities?: string[]
    }
    pricing?: Record<string, string | undefined>
    top_provider?: { context_length?: number; max_completion_tokens?: number }
    supported_parameters?: string[]
    reasoning?: { supported_efforts?: string[] }
  }

  // models.dev has no "file" modality; LLMTR uses it for document input.
  const MODALITY = {
    text: "text",
    image: "image",
    audio: "audio",
    video: "video",
    file: "pdf",
    pdf: "pdf",
  } as const

  function modalities(input: string[] | undefined) {
    return (input ?? []).flatMap((item) => MODALITY[item as keyof typeof MODALITY] ?? [])
  }

  // Catalog prices are per token; models.dev costs are per million tokens.
  function price(input: string | undefined) {
    const value = Number(input)
    return Number.isFinite(value) ? value * 1_000_000 : 0
  }

  function model(entry: Entry): ModelsDev.Model {
    const params = new Set(entry.supported_parameters ?? [])
    const input = modalities(entry.architecture?.input_modalities)
    const context = entry.context_length ?? entry.top_provider?.context_length ?? 0
    const efforts = entry.reasoning?.supported_efforts ?? []
    return {
      id: entry.id,
      name: entry.name ?? entry.id,
      family: entry.id.split("/")[0],
      release_date: new Date((entry.created ?? 0) * 1000).toISOString().slice(0, 10),
      attachment: input.some((item) => item !== "text"),
      reasoning: Boolean(entry.reasoning) || params.has("reasoning") || params.has("include_reasoning"),
      temperature: params.has("temperature"),
      tool_call: params.has("tools"),
      cost: {
        input: price(entry.pricing?.prompt),
        output: price(entry.pricing?.completion),
        cache_read: price(entry.pricing?.input_cache_read),
        cache_write: price(entry.pricing?.input_cache_write),
      },
      limit: {
        context,
        output: entry.top_provider?.max_completion_tokens ?? context,
      },
      modalities: {
        input,
        output: modalities(entry.architecture?.output_modalities),
      },
      options: {},
      reasoning_options: efforts.length ? [{ type: "effort", values: efforts }] : undefined,
    }
  }

  // The catalog also carries embedding and image models, which the chat
  // pipeline cannot drive — keep only what /v1/chat/completions can serve.
  function chat(entry: Entry) {
    return (
      (entry.supported_operations ?? ["CHAT_COMPLETIONS"]).includes("CHAT_COMPLETIONS") &&
      modalities(entry.architecture?.output_modalities).includes("text")
    )
  }

  export function convert(entries: Entry[]): ModelsDev.Provider {
    return {
      id: ID,
      name: NAME,
      api: url(),
      npm: NPM,
      env: [ENV],
      models: Object.fromEntries(entries.filter(chat).map((entry) => [entry.id, model(entry)])),
    }
  }

  // Enough of the catalog to pick a model before the first refresh lands (fresh
  // install, offline, or CYBERSTRIKE_DISABLE_MODELS_FETCH): every Türkiye-hosted
  // chat model, plus one flagship per major upstream vendor.
  const SEED: Entry[] = [
    {
      id: "llmtr/gemma-4",
      name: "Gemma 4",
      created: 1776880304,
      context_length: 131072,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.000002", completion: "0.000005", input_cache_read: "0.0000005" },
      top_provider: { context_length: 131072, max_completion_tokens: 131072 },
      supported_parameters: ["max_tokens", "parallel_tool_calls", "reasoning", "temperature", "tools", "top_p"],
    },
    {
      id: "llmtr/qwen3-6-35b",
      name: "Qwen 3.6 35B-A3B",
      created: 1776880304,
      context_length: 262144,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.000005", completion: "0.000005" },
      top_provider: { context_length: 262144, max_completion_tokens: 65536 },
      supported_parameters: ["max_tokens", "parallel_tool_calls", "reasoning", "temperature", "tools", "top_p"],
    },
    {
      id: "llmtr/qwen3-5-4b",
      name: "Qwen 3.5 4B",
      created: 1776880304,
      context_length: 131072,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.000001", completion: "0.000003" },
      top_provider: { context_length: 131072, max_completion_tokens: 32768 },
      supported_parameters: ["max_tokens", "temperature", "tools", "top_p"],
    },
    {
      id: "llmtr/muse-glimmer-30b-tr",
      name: "Muse Glimmer 30B (Türkiye)",
      created: 1776880304,
      context_length: 131072,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.000002", completion: "0.000005" },
      top_provider: { context_length: 131072, max_completion_tokens: 32768 },
      supported_parameters: ["max_tokens", "temperature", "tools", "top_p"],
    },
    {
      id: "llmtr/trendyol-asure-12b",
      name: "Trendyol Asure 12B",
      created: 1786690403,
      context_length: 40960,
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.000000025" },
      top_provider: { context_length: 40960, max_completion_tokens: 40960 },
      supported_parameters: ["max_tokens", "temperature", "top_p"],
    },
    {
      id: "llmtr/magibu-11b-v8",
      name: "Magibu 11B v8",
      created: 1780689763,
      context_length: 8192,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000001", completion: "0.0000005" },
      top_provider: { context_length: 8192, max_completion_tokens: 8192 },
      supported_parameters: ["max_tokens", "temperature", "top_p"],
    },
    {
      id: "anthropic/claude-opus-5",
      name: "Claude Opus 5",
      created: 1776880299,
      context_length: 200000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.000005", completion: "0.000025" },
      top_provider: { context_length: 200000, max_completion_tokens: 64000 },
      supported_parameters: ["max_tokens", "parallel_tool_calls", "temperature", "tool_choice", "tools", "top_p"],
    },
    {
      id: "anthropic/claude-sonnet-5",
      name: "Claude Sonnet 5",
      created: 1776880299,
      context_length: 200000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      top_provider: { context_length: 200000, max_completion_tokens: 64000 },
      supported_parameters: ["max_tokens", "parallel_tool_calls", "temperature", "tool_choice", "tools", "top_p"],
    },
    {
      id: "openai/gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      created: 1776880298,
      context_length: 400000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.00000125", completion: "0.00001" },
      top_provider: { context_length: 400000, max_completion_tokens: 128000 },
      supported_parameters: ["max_tokens", "parallel_tool_calls", "temperature", "tool_choice", "tools", "top_p"],
    },
    {
      id: "google/gemini-3.6-flash",
      name: "Gemini 3.6 Flash",
      created: 1784702661,
      context_length: 1048576,
      architecture: { input_modalities: ["text", "image", "file", "audio"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000015", completion: "0.0000075", input_cache_read: "0.00000015" },
      top_provider: { context_length: 1048576, max_completion_tokens: 65536 },
      supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "temperature", "tools", "top_p"],
      reasoning: { supported_efforts: ["minimal", "low", "medium", "high"] },
    },
  ]

  export const Data = lazy(async () => {
    const cached = await Bun.file(Flag.CYBERSTRIKE_LLMTR_PATH ?? filepath)
      .json()
      .catch(() => undefined)
    const entries = cached?.data as Entry[] | undefined
    return convert(entries?.length ? entries : SEED)
  })

  export async function get() {
    return Data()
  }

  export async function refresh() {
    const result = await fetch(`${url()}/models`, {
      headers: { "User-Agent": Installation.USER_AGENT },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch llmtr catalog", { error: e })
    })
    if (!result || !result.ok) return
    const body = (await result.json().catch(() => undefined)) as { data?: Entry[] } | undefined
    if (!body?.data?.length) return
    await Bun.write(filepath, JSON.stringify(body))
    Data.reset()
  }
}
