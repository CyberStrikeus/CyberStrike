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
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { runCrawl } from "@cyberstrike-io/hackbrowser/api"
import type { CrawlOptions, LogRecord, CSEvent } from "@cyberstrike-io/hackbrowser/api"
import type { ParentMessage, WorkerMessage, WorkerOptions, ModelDescriptor } from "./worker-ipc"
import readline from "readline"

// ============================================================
// IPC helpers
// ============================================================

function send(msg: WorkerMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n")
}

// ============================================================
// Model reconstruction from ModelDescriptor
// ============================================================

function createModelFromDescriptor(desc: ModelDescriptor): LanguageModel {
  if (desc.npm.includes("anthropic")) {
    const opts: Record<string, unknown> = {}
    if (desc.apiKey) opts.apiKey = desc.apiKey
    if (desc.baseURL) opts.baseURL = desc.baseURL
    if (desc.headers) opts.headers = desc.headers
    return createAnthropic(opts as Parameters<typeof createAnthropic>[0])(desc.modelApiId)
  }

  if (desc.npm === "@ai-sdk/openai") {
    const opts: Record<string, unknown> = {}
    if (desc.apiKey) opts.apiKey = desc.apiKey
    if (desc.baseURL) opts.baseURL = desc.baseURL
    if (desc.headers) opts.headers = desc.headers
    return createOpenAI(opts as Parameters<typeof createOpenAI>[0])(desc.modelApiId)
  }

  // openai-compatible, openrouter, azure, mistral, groq, deepinfra, cerebras,
  // cohere, togetherai, perplexity, vercel, gateway, gitlab, xai, etc. —
  // all expose OpenAI-compatible endpoints.
  return createOpenAICompatible({
    name: "hackbrowser-provider",
    apiKey: desc.apiKey ?? "",
    baseURL: desc.baseURL ?? "https://api.openai.com/v1",
    headers: desc.headers,
  }).languageModel(desc.modelApiId)
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
    logSink,
    eventSink,
    signal,
    ...credentialFields,
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
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

  // Wait until stdin closes (parent terminates or closes the pipe)
  await new Promise<void>((resolve) => rl.once("close", resolve))
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
