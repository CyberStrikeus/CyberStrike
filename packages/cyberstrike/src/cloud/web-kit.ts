// Web building-block kit — the reusable web primitives core injects into a domain
// plugin via `input.core.web`, so a package (e.g. a future @cyberstrike-io/web-pro)
// can build NEW deterministic web tools without importing the compiled host.
//
// This is the "Lego" surface: the same governed-send path, request model, replay
// engine, captured-traffic store, webhook tool shells, and signal fabric that
// core's own web tools (tool/http-replay.ts, tool/webhook/*) compose. A plugin
// gets the VALUES through injection; it imports only the TYPES from
// `cyberstrike/public` (erased at build time, so no host module resolution).
//
// Adding to this kit is a MINOR core-API bump (older packages still load);
// removing/changing a member is MAJOR. Keep it curated and coherent — it is the
// versioned web contract, not a dumping ground for internals.
import { governedSend } from "../replay/govern"
import { HttpMessage } from "../replay/message"
import { Mutate } from "../replay/mutate"
import { Apply } from "../replay/apply"
import { Observe } from "../replay/observe"
import { Encode } from "../replay/encode"
import { Send } from "../replay/send"
import { ReplayResponse } from "../replay/response"
import { Batch } from "../replay/batch"
import { Governor } from "../replay/governor"
import { ReplaySender } from "../tool/webhook/transport"
import { defineWebhookTool, webhookContext, toolResult, toolError } from "../tool/webhook/define"
import { Request } from "../session/request"
import {
  SignalStore,
  SignalRouter,
  CanaryRegistry,
  runDetectors,
  DETECTORS,
  scanCapturedResponse,
  scanProbeResponse,
  scanElicitedResponse,
} from "../session/web/signal"
import {
  vortexRegisterCanary,
  vortexRecordSignal,
  vortexScanProbeResponse,
  vortexSignals,
} from "../session/web/vortex-bridge"

/** Signal-fabric subsystem: detect → route → persist → verify web findings. */
export interface WebSignalKit {
  /** @deprecated Use the vortex.* equivalents — CS signal fabric retires once Vortex proves out (#15). */
  SignalStore: typeof SignalStore
  SignalRouter: typeof SignalRouter
  CanaryRegistry: typeof CanaryRegistry
  runDetectors: typeof runDetectors
  DETECTORS: typeof DETECTORS
  scanCapturedResponse: typeof scanCapturedResponse
  scanProbeResponse: typeof scanProbeResponse
  scanElicitedResponse: typeof scanElicitedResponse
  vortex: {
    registerCanary(sessionID: string, input: { token: string; kind?: string; requestId: string; field?: string; vulnClass?: string; agent?: string }): void
    recordSignal(sessionID: string, input: { ruleId: string; transactionId: string; category: string; severity: string; title: string; evidence?: string }): void
    scanProbeResponse(sessionID: string, input: { requestId: string; method: string; url: string; status: number; headers: Record<string, string>; body: string }): number
    signals(sessionID: string): { signals: { ruleId: string; category: string; severity: string; title: string; evidence?: string; requestId: string; endpoint?: string; owner?: string; routed: boolean; status?: "pending" | "dispatched" | "examined" }[] }
  }
}

/** The web building blocks a domain plugin composes into its own web tools. */
export interface WebKit {
  // ── send seam — one governed HTTP send path (budget + circuit breaker per call) ──
  governedSend: typeof governedSend
  ReplaySender: typeof ReplaySender
  // ── request model & pure transforms (no I/O) ──
  HttpMessage: typeof HttpMessage
  Mutate: typeof Mutate
  Apply: typeof Apply
  Observe: typeof Observe
  Encode: typeof Encode
  // ── governed replay engine (retry / response parsing / batching / governors) ──
  Send: typeof Send
  ReplayResponse: typeof ReplayResponse
  Batch: typeof Batch
  Governor: typeof Governor
  // ── captured-traffic store (resolve request_id → raw request) ──
  Request: typeof Request
  // ── webhook tool shells (build a tool that resolves + sends + reports) ──
  defineWebhookTool: typeof defineWebhookTool
  webhookContext: typeof webhookContext
  toolResult: typeof toolResult
  toolError: typeof toolError
  // ── signal fabric ──
  signal: WebSignalKit
}

/** Assemble the web kit the host hangs off `input.core.web`. */
export function buildWebKit(): WebKit {
  return {
    governedSend,
    ReplaySender,
    HttpMessage,
    Mutate,
    Apply,
    Observe,
    Encode,
    Send,
    ReplayResponse,
    Batch,
    Governor,
    Request,
    defineWebhookTool,
    webhookContext,
    toolResult,
    toolError,
    signal: {
      SignalStore,
      SignalRouter,
      CanaryRegistry,
      runDetectors,
      DETECTORS,
      scanCapturedResponse,
      scanProbeResponse,
      scanElicitedResponse,
      vortex: {
        registerCanary: vortexRegisterCanary,
        recordSignal: vortexRecordSignal,
        scanProbeResponse: vortexScanProbeResponse,
        signals: vortexSignals,
      },
    },
  }
}
