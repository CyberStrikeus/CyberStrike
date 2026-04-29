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
  baseURL?: string
  modelApiId: string
  headers?: Record<string, string>
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

export type WorkerMessage =
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; service: string; message: string; extra?: unknown }
  | { type: "event"; event: CSEvent }
  | { type: "result"; pagesExplored: number; capturedEndpoints: number; errors: string[] }
  | { type: "error"; message: string }
