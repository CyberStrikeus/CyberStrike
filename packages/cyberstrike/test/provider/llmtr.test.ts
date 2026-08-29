import { test, expect, describe } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { ModelsDev } from "../../src/provider/models"
import { LLMTR } from "../../src/provider/llmtr"
import { Env } from "../../src/env"

// A trimmed slice of the shape https://llmtr.com/v1/models returns.
const catalog = [
  {
    id: "llmtr/trendyol-asure-12b",
    name: "Trendyol Asure 12B",
    created: 1786690403,
    context_length: 40960,
    supported_operations: ["CHAT_COMPLETIONS"],
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.000000025" },
    top_provider: { context_length: 40960, max_completion_tokens: 8192 },
    supported_parameters: ["max_tokens", "temperature", "tools", "top_p"],
  },
  {
    id: "google/gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    created: 1784702661,
    context_length: 1048576,
    supported_operations: ["CHAT_COMPLETIONS", "RESPONSES"],
    architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
    pricing: { prompt: "0.0000015", completion: "0.0000075" },
    top_provider: { context_length: 1048576, max_completion_tokens: 65536 },
    supported_parameters: ["reasoning", "reasoning_effort", "temperature", "tools"],
    reasoning: { supported_efforts: ["minimal", "low", "high"] },
  },
  {
    id: "openai/text-embedding-3-large",
    name: "Text Embedding 3 Large",
    created: 1776880298,
    context_length: 8191,
    supported_operations: ["EMBEDDINGS"],
    architecture: { input_modalities: ["text"], output_modalities: ["embedding"] },
    pricing: { prompt: "0.00000013" },
    top_provider: { context_length: 8191 },
    supported_parameters: [],
  },
]

describe("LLMTR catalog", () => {
  const provider = LLMTR.convert(catalog)

  test("only exposes models the chat endpoint can serve", () => {
    expect(Object.keys(provider.models)).toEqual(["llmtr/trendyol-asure-12b", "google/gemini-3.6-flash"])
  })

  test("routes through the gateway with an openai-compatible sdk", () => {
    expect(provider.id).toBe("llmtr")
    expect(provider.api).toBe("https://llmtr.com/v1")
    expect(provider.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider.env).toEqual(["LLMTR_API_KEY"])
  })

  test("converts per-token pricing to per-million-token cost", () => {
    const model = provider.models["llmtr/trendyol-asure-12b"]
    // Exact, not close-to: scaling per-token prices by a million must not leave
    // float noise behind, since these values are rendered as session cost.
    expect(model.cost?.input).toBe(0.1)
    expect(model.cost?.output).toBe(0.5)
    expect(model.cost?.cache_read).toBe(0.025)
  })

  test("carries limits, modalities and capabilities across", () => {
    const model = provider.models["llmtr/trendyol-asure-12b"]
    expect(model.limit).toEqual({ context: 40960, output: 8192 })
    expect(model.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
    expect(model.attachment).toBe(true)
    expect(model.tool_call).toBe(true)
    expect(model.temperature).toBe(true)
    expect(model.reasoning).toBe(false)
  })

  test("maps the file modality onto pdf", () => {
    expect(provider.models["google/gemini-3.6-flash"].modalities?.input).toEqual(["text", "image", "pdf"])
  })

  test("keeps the advertised reasoning efforts", () => {
    const model = provider.models["google/gemini-3.6-flash"]
    expect(model.reasoning).toBe(true)
    expect(model.reasoning_options).toEqual([{ type: "effort", values: ["minimal", "low", "high"] }])
  })
})

describe("LLMTR reasoning variants", () => {
  const model = {
    id: "google/gemini-3.6-flash",
    providerID: "llmtr",
    api: { id: "google/gemini-3.6-flash", url: "https://llmtr.com/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning: true },
    reasoning_options: [{ type: "effort", values: ["minimal", "low", "high"] }],
  } as any

  test("uses the efforts the gateway advertises, not the openai-compatible default", () => {
    expect(ProviderTransform.variants(model)).toEqual({
      minimal: { reasoningEffort: "minimal" },
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })

  test("background calls fall back to the cheapest supported effort", () => {
    expect(ProviderTransform.smallOptions(model)).toEqual({ reasoningEffort: "minimal" })
  })

  test("non-reasoning models get no variants", () => {
    expect(ProviderTransform.variants({ ...model, capabilities: { reasoning: false } })).toEqual({})
  })
})

test("llmtr is published in the model catalog", async () => {
  const database = await ModelsDev.get()
  expect(database["llmtr"]).toBeDefined()
  expect(database["llmtr"].env).toEqual(["LLMTR_API_KEY"])
  // The seeded catalog always carries the Türkiye-hosted models, which is the
  // reason the provider is bundled rather than left to a config snippet.
  expect(Object.keys(database["llmtr"].models).some((id) => id.startsWith("llmtr/"))).toBe(true)
})

test("provider loaded from LLMTR_API_KEY", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({ $schema: "https://cyberstrike.io/config.json" }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("LLMTR_API_KEY", "llmtr-test-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["llmtr"]).toBeDefined()
      expect(providers["llmtr"].source).toBe("env")
      expect(providers["llmtr"].key).toBe("llmtr-test-key")
      // The custom loader still attaches attribution headers on top.
      expect(providers["llmtr"].options.headers["X-Title"]).toBe("cyberstrike")
    },
  })
})

test("llmtr stays out of the provider list without a key", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "cyberstrike.json"),
        JSON.stringify({ $schema: "https://cyberstrike.io/config.json" }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Provider.list().then((x) => x["llmtr"])).toBeUndefined()
    },
  })
})
