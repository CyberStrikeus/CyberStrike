#!/usr/bin/env node
// Hackbrowser worker — runs as a subprocess of the main cyberstrike binary.
// Receives a WorkerOptions payload via stdin, calls runCrawl, and streams
// log records, CSEvents, and the final result back to the parent via stdout.
//
// Transport: UTF-8 JSON lines (one object per line) on stdin/stdout.
// The parent writes { type: "start", options } once, then optionally
// { type: "abort" }. This process writes log/event/result/error lines.
//
// Why a separate process: Bun compiled binaries resolve all external module
// references at startup. Playwright as an external dep → startup crash when
// playwright is not installed. Moving hackbrowser here removes playwright
// from the main binary's module graph entirely.

import { createAnthropic } from "@ai-sdk/anthropic"
import type { LanguageModel } from "ai"
import { BUNDLED_PROVIDERS } from "../provider/bundled-providers"
import { runCrawl } from "@cyberstrike-io/hackbrowser/api"
import type { CrawlOptions, LogRecord, CSEvent } from "@cyberstrike-io/hackbrowser/api"
import type { ParentMessage, WorkerMessage, WorkerOptions, ModelDescriptor } from "./worker-ipc"
import readline from "readline"
import tls from "node:tls"

// ============================================================
// IPC helpers
// ============================================================

function send(msg: WorkerMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n")
}

// ============================================================
// Model reconstruction from ModelDescriptor
// ============================================================

// Recent Claude (4.7+/fable) and the GPT-5 family reject temperature/top_p/top_k
// with a 400. The model catalog flags this via capabilities.temperature; when it
// is false the worker strips those params from the outgoing request body. This
// lives at the adapter (fetch) layer — the same place the main process drops
// them (anthropic-subscription-model omits them; ProviderTransform.temperature
// returns undefined for such models) — and is keyed on the capability, not on a
// provider name, so it generalizes to any model that advertises temperature:false.
function stripSamplingParams(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== "string") return body
  try {
    const json = JSON.parse(body)
    if (json && typeof json === "object") {
      delete (json as Record<string, unknown>)["temperature"]
      delete (json as Record<string, unknown>)["top_p"]
      delete (json as Record<string, unknown>)["top_k"]
      return JSON.stringify(json)
    }
  } catch {
    // body is not JSON — leave it untouched
  }
  return body
}

// Anthropic Bearer (subscription/OAT) request transform: optionally strip
// unsupported sampling params, and inject the subscription parity the OAuth
// endpoint requires — metadata.user_id and the Agent SDK system[0] prefix.
// Without parity the endpoint replies 429 rate_limit_error (message "Error").
function applyAnthropicBearerBody(
  body: BodyInit | null | undefined,
  opts: { stripSampling: boolean; userId?: string; systemPrefix?: string },
): BodyInit | null | undefined {
  if (typeof body !== "string") return body
  try {
    const j = JSON.parse(body) as Record<string, any>
    if (opts.stripSampling) {
      delete j["temperature"]
      delete j["top_p"]
      delete j["top_k"]
    }
    if (opts.userId) j["metadata"] = { ...(j["metadata"] ?? {}), user_id: opts.userId }
    if (opts.systemPrefix) {
      const prefix = { type: "text", text: opts.systemPrefix }
      if (Array.isArray(j["system"])) j["system"] = [prefix, ...j["system"]]
      else if (typeof j["system"] === "string") j["system"] = [prefix, { type: "text", text: j["system"] }]
      else if (j["system"] == null) j["system"] = [prefix]
    }
    return JSON.stringify(j)
  } catch {
    return body
  }
}

/**
 * Merge the parent-resolved outbound policy into a fetch init. Applied to EVERY
 * provider branch below, so the crawl planner's own model calls honour the same
 * proxy the rest of the tool uses — but only when the parent sent one, which it
 * does only under network.proxy.includeProviders. Exported so the wiring can be
 * exercised without spawning the whole subprocess.
 */
export function applyTransport(desc: ModelDescriptor, init?: any): any {
  const n = desc.network
  if (!n) return init
  const out = { ...(init ?? {}) }
  if (n.proxy) out.proxy = n.proxy
  const tls: Record<string, unknown> = {}
  if (n.rejectUnauthorized !== undefined) tls.rejectUnauthorized = n.rejectUnauthorized
  if (n.ca) tls.ca = n.ca
  if (n.cert) tls.cert = n.cert
  if (n.key) tls.key = n.key
  if (n.passphrase) tls.passphrase = n.passphrase
  if (Object.keys(tls).length > 0) out.tls = tls
  return out
}

// Mirror of provider.ts's shouldUseCopilotResponsesApi / isGpt5OrLater. Kept local rather than
// imported because this worker is a standalone bundle that must not pull in the heavy provider
// module. GPT-5+ Copilot models are served on the Responses API, not Chat Completions; gpt-5-mini
// stays on Chat Completions. modelApiId is hyphenated (e.g. "gpt-5-4"), which /^gpt-(\d+)/ still
// matches on the leading major version.
function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  return match !== null && Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

function createModelFromDescriptor(desc: ModelDescriptor): LanguageModel {
  const stripSampling = desc.supportsTemperature === false

  // Fetch wrapper for the branches that don't install their own. Needed when
  // sampling params must be stripped OR when an outbound policy has to be
  // applied — either reason alone is enough to wrap.
  const samplingFetch: typeof globalThis.fetch | undefined =
    stripSampling || desc.network
      ? (((input: any, init?: any) =>
          fetch(
            input,
            applyTransport(desc, init && stripSampling ? { ...init, body: stripSamplingParams(init.body) } : init),
          )) as typeof globalThis.fetch)
      : undefined

  if (desc.npm.includes("anthropic")) {
    // OAuth/subscription (or sk-ant-oat): authenticate via Authorization: Bearer.
    // @ai-sdk/anthropic has no authToken option and sends x-api-key by default,
    // so swap the header (and add the beta header) in a custom fetch.
    if (desc.authToken) {
      const token = desc.authToken
      const beta = desc.anthropicBeta
      const opts: Record<string, unknown> = {
        apiKey: "placeholder", // x-api-key is deleted in the fetch below
        fetch: (url: any, init?: any) => {
          const headers = new Headers(init?.headers)
          headers.delete("x-api-key")
          headers.set("authorization", `Bearer ${token}`)
          if (beta) headers.set("anthropic-beta", beta)
          const body = applyAnthropicBearerBody(init?.body, {
            stripSampling,
            userId: desc.anthropicUserId,
            systemPrefix: desc.anthropicSystemPrefix,
          })
          return fetch(url, applyTransport(desc, { ...init, headers, body }))
        },
      }
      if (desc.baseURL) opts.baseURL = desc.baseURL
      if (desc.headers) opts.headers = desc.headers
      return createAnthropic(opts as Parameters<typeof createAnthropic>[0])(desc.modelApiId)
    }
    const opts: Record<string, unknown> = {}
    if (desc.apiKey) opts.apiKey = desc.apiKey
    if (desc.baseURL) opts.baseURL = desc.baseURL
    if (desc.headers) opts.headers = desc.headers
    if (samplingFetch) opts.fetch = samplingFetch
    return createAnthropic(opts as Parameters<typeof createAnthropic>[0])(desc.modelApiId)
  }

  // GitHub Copilot OAuth: same pattern as Anthropic above.
  // Swap default auth for Bearer token and add Copilot-specific headers.
  if (desc.npm.includes("github-copilot") && desc.copilotToken) {
    const token = desc.copilotToken
    const factory = BUNDLED_PROVIDERS[desc.npm]
    if (!factory) throw new Error(`hackbrowser: missing bundled provider "${desc.npm}"`)
    const opts: Record<string, unknown> = {
      apiKey: "placeholder",
      fetch: (url: any, init?: any) => {
        const headers = new Headers(init?.headers)
        headers.delete("x-api-key")
        headers.delete("authorization")
        headers.set("Authorization", `Bearer ${token}`)
        headers.set("x-initiator", "user")
        // CYBERSTRIKE_VERSION is a build-time define that the standalone worker bundle does not
        // inject, so referencing it bare throws ReferenceError here (in the subprocess) and every
        // planner call fails → the crawl "completes" with no plan. Guard it exactly like
        // Installation.VERSION does (installation/index.ts) so it falls back to "local" instead.
        const version = typeof CYBERSTRIKE_VERSION === "string" ? CYBERSTRIKE_VERSION : "local"
        headers.set("User-Agent", `cyberstrike/${version}`)
        headers.set("Openai-Intent", "conversation-edits")
        return fetch(
          url,
          applyTransport(desc, {
            ...init,
            headers,
            body: stripSampling ? stripSamplingParams(init?.body) : init?.body,
          }),
        )
      },
    }
    if (desc.baseURL) opts.baseURL = desc.baseURL
    if (desc.headers) opts.headers = desc.headers
    const sdk = factory(opts) as any
    // GPT-5+ Copilot models are only served on the Responses API; the main process routes them
    // there (provider.ts shouldUseCopilotResponsesApi). The worker used sdk.languageModel — which
    // the Copilot SDK maps to the Chat Completions endpoint (copilot-provider.ts) — for every
    // model, so GPT-5 planner calls hit the wrong endpoint and every plan failed. Mirror the main
    // process. For non-GPT-5 models sdk.chat === the old sdk.languageModel, so they are unchanged.
    if (sdk.responses === undefined && sdk.chat === undefined) return sdk.languageModel(desc.modelApiId)
    return shouldUseCopilotResponsesApi(desc.modelApiId)
      ? sdk.responses(desc.modelApiId)
      : sdk.chat(desc.modelApiId)
  }

  // Every other provider: resolve the SDK factory from the SHARED provider map
  // (the same npm → create* table Provider.getSDK uses). This is the single
  // source of truth for provider routing — without it the worker used to fall
  // through to an OpenAI-compatible client and silently send e.g. a Gemini or
  // Bedrock key to https://api.openai.com. An unknown npm now throws loudly
  // instead of misrouting (the launcher already rejects OAuth-only providers,
  // so only serializable api-key providers reach here).
  const factory = BUNDLED_PROVIDERS[desc.npm]
  if (!factory) {
    throw new Error(
      `hackbrowser: unsupported model provider "${desc.npm}" (model "${desc.modelApiId}"). ` +
        `The crawler subprocess can only use providers in the bundled provider map. ` +
        `Set a bundled API-key provider (e.g. Anthropic, OpenAI, Google/Gemini) as your default model for hackbrowser runs.`,
    )
  }

  const opts: Record<string, unknown> = {
    name: desc.npm,
    apiKey: desc.apiKey ?? "",
  }
  if (desc.baseURL) opts.baseURL = desc.baseURL
  if (desc.headers) opts.headers = desc.headers
  if (samplingFetch) opts.fetch = samplingFetch

  // Construct the language model the same way the main process does: OpenAI uses
  // the Responses API (Provider's `openai` loader calls sdk.responses(...)), and
  // every other provider uses the default languageModel(...).
  const sdk = factory(opts) as any
  return desc.npm === "@ai-sdk/openai" ? sdk.responses(desc.modelApiId) : sdk.languageModel(desc.modelApiId)
}

// ============================================================
// CrawlOptions builder from WorkerOptions
// ============================================================

function buildCrawlOptions(opts: WorkerOptions, signal: AbortSignal): CrawlOptions {
  const logSink = (rec: LogRecord) => {
    send({
      type: "log",
      level: rec.level.toLowerCase() as "debug" | "info" | "warn" | "error",
      service: rec.service,
      message: rec.message,
      extra: rec.extra,
    })
  }
  const eventSink = (event: CSEvent) => {
    send({ type: "event", event })
  }

  const model = createModelFromDescriptor(opts.model)

  const credentialFields: Partial<CrawlOptions> = (() => {
    const d = opts.credentialDispatch
    if (d.kind === "single") return { authenticated: true, credentialID: d.credentialID }
    if (d.kind === "multi") return { multiCredentials: d.multiCredentials.map((c) => ({ id: c.id })) }
    return {}
  })()

  return {
    url: opts.url,
    sessionID: opts.sessionID,
    scope: opts.scope,
    exclude: opts.exclude,
    steps: opts.steps,
    headless: opts.headless,
    panel: opts.panel,
    cyberstrikeUrl: opts.cyberstrikeUrl,
    model,
    cdp: opts.cdp,
    network: opts.network,
    logSink,
    eventSink,
    signal,
    ...credentialFields,
  }
}

// ============================================================
// Main
// ============================================================

// The crawler worker runs as a separate Node (or bun) subprocess and makes its own TLS
// connection to the LLM API — unlike the main process, whose Bun runtime already trusts the OS
// certificate store. Node trusts only its bundled CA list, so when a corporate proxy / VPN /
// antivirus intercepts TLS (presenting a root CA the OS trusts but Node's bundle does not), the
// worker's LLM call fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY while the main-process chat with
// the same token works. Merge the OS trust store into the default CA set — the same thing that
// `node --use-system-ca` does, done here in-process. It only ADDS trust (the bundled defaults are
// kept), so it cannot break a connection that already verifies; on runtimes without these APIs
// (bun, Node < 22.15) it is a graceful no-op.
function trustSystemCertificates(): void {
  try {
    const t = tls as unknown as {
      getCACertificates?: (type: "default" | "system") => string[]
      setDefaultCACertificates?: (certs: readonly string[]) => void
    }
    if (typeof t.getCACertificates !== "function" || typeof t.setDefaultCACertificates !== "function") return
    const system = t.getCACertificates("system")
    if (system.length === 0) return
    t.setDefaultCACertificates([...t.getCACertificates("default"), ...system])
  } catch {
    // Best-effort: leave the default trust store unchanged if anything is unavailable.
  }
}

async function main(): Promise<void> {
  trustSystemCertificates()
  const controller = new AbortController()

  const rl = readline.createInterface({ input: process.stdin, terminal: false })

  let started = false

  rl.on("line", (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: ParentMessage
    try {
      msg = JSON.parse(trimmed) as ParentMessage
    } catch {
      return
    }

    if (msg.type === "abort") {
      controller.abort()
      return
    }

    if (msg.type === "start" && !started) {
      started = true
      runWorker(msg.options, controller.signal).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        send({ type: "error", message })
        process.exitCode = 1
      })
    }
  })

  // Wait until stdin closes (parent terminates or closes the pipe).
  // Abort the crawl so run()'s disconnect-wait breaks and the worker exits cleanly.
  await new Promise<void>((resolve) =>
    rl.once("close", () => {
      controller.abort()
      resolve()
    }),
  )
  // Backstop: if runWorker is still hanging 5s after stdin close, force exit
  setTimeout(() => process.exit(0), 5000).unref()
}

async function runWorker(opts: WorkerOptions, signal: AbortSignal): Promise<void> {
  const crawlOpts = buildCrawlOptions(opts, signal)

  try {
    const result = await runCrawl(crawlOpts)
    send({
      type: "result",
      pagesExplored: result.pagesExplored,
      capturedEndpoints: result.capturedEndpoints,
      errors: result.errors,
      usage: result.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    send({ type: "error", message })
    process.exitCode = 1
  }
}

main().catch((err) => {
  process.stderr.write(`hackbrowser-worker fatal: ${String(err)}\n`)
  process.exitCode = 1
})
