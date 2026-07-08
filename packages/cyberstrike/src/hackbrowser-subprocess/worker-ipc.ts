// IPC message types shared between hackbrowser-launcher (parent) and
// hackbrowser-worker (child). Transport: UTF-8 JSON lines over stdin/stdout.
// One JSON object per line. No framing needed — each line is a complete message.

import type { CSEvent } from "@cyberstrike-io/hackbrowser/api"

// ============================================================
// Serializable model descriptor — parent extracts this from
// Provider state so the worker can reconstruct a LanguageModel
// without importing cyberstrike's Provider system.
// ============================================================

export interface ModelDescriptor {
  npm: string
  apiKey?: string
  // OAuth/subscription Bearer token (Claude Pro/Max, or an sk-ant-oat key).
  // When set, the worker authenticates via Authorization: Bearer instead of
  // x-api-key. anthropicBeta carries the beta header that Bearer auth requires.
  authToken?: string
  anthropicBeta?: string
  // Anthropic subscription (Pro/Max) request parity. The OAuth endpoint rejects
  // requests that lack these with a 429 rate_limit_error (message: "Error"), so
  // plain @ai-sdk/anthropic is not enough. Computed once in the main process
  // (single source of truth — subscriptionUserId + AGENT_SDK_PREFIX) and applied
  // to the request body in the worker's Bearer fetch.
  anthropicUserId?: string // JSON-stringified metadata.user_id
  anthropicSystemPrefix?: string // prepended as system[0]
  baseURL?: string
  modelApiId: string
  headers?: Record<string, string>
  // From the model catalog's `capabilities.temperature`. When false (recent
  // Claude 4.7+/fable and the GPT-5 family reject sampling params), the worker
  // strips temperature/top_p/top_k before sending. Mirrors what the main
  // process does in-process (anthropic-subscription-model omits them;
  // ProviderTransform.temperature returns undefined for such models).
  supportsTemperature?: boolean
  // GitHub Copilot OAuth bearer token. When set, the worker authenticates
  // via Authorization: Bearer instead of apiKey, and adds Copilot-specific
  // headers (Openai-Intent, x-initiator, User-Agent).
  copilotToken?: string
}

// ============================================================
// Serializable credential dispatch — mirrors CrawlOptions auth
// fields but without method calls.
// ============================================================

export type CredentialDispatch =
  | { kind: "none" }
  | { kind: "single"; credentialID: string }
  | { kind: "multi"; multiCredentials: { id: string }[] }

// ============================================================
// WorkerOptions — everything the worker needs to call runCrawl.
// All fields are JSON-serializable primitives or plain objects.
// ============================================================

export interface WorkerOptions {
  url: string
  sessionID?: string
  scope?: string[]
  exclude?: string[]
  steps?: number
  headless: boolean
  panel: boolean
  cyberstrikeUrl: string
  model: ModelDescriptor
  credentialDispatch: CredentialDispatch
}

// ============================================================
// Parent → Worker (stdin)
// ============================================================

export type ParentMessage = { type: "start"; options: WorkerOptions } | { type: "abort" }

// ============================================================
// Worker → Parent (stdout)
// ============================================================

export interface WorkerUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type WorkerMessage =
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; service: string; message: string; extra?: unknown }
  | { type: "event"; event: CSEvent }
  | { type: "result"; pagesExplored: number; capturedEndpoints: number; errors: string[]; usage: WorkerUsage }
  | { type: "error"; message: string }
