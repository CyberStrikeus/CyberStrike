// Hackbrowser launcher — single binding point between cyberstrike's tool
// system and the hackbrowser library API. Tool, Slash, and CLI subcommand
// (when added) all funnel through here.
//
// Responsibilities (SRP — three internal stages):
//   1. prepareCrawl()    sync prep — Provider, Server URL, log sink bridge,
//                         build CrawlOptions; throws on validation/preflight
//                         fail fast (Karar 5, INTEGRATION.md §13.1)
//   2. backgroundRun()   async fire-and-forget runner — owns crawl lifecycle,
//                         activeRuns slot release, error logging
//   3. launchHackbrowser() orchestration — re-entrance guard, prep, kick off,
//                         immediate return so the tool framework unblocks
//                         the chat session prompt loop (Faz B.0 / §13.6)
//
// Karar 2 (DI) korunur: hackbrowser stays decoupled, cyberstrike injects deps
// via opts.model, opts.logSink. eventSink (Faz B.1+) joins this list later.

import { runCrawl, type CrawlOptions, type LogRecord } from "@cyberstrike-io/hackbrowser/api"
import { Provider } from "../provider/provider"
import { Server } from "../server/server"
import { Log } from "../util/log"

const log = Log.create({ service: "hackbrowser-launcher" })

// Karar 5: re-entrance is an error, not a queue. One hackbrowser run per
// session; concurrent invocations get a clear error rather than silent
// serialization (INTEGRATION.md §2 Karar 5).
const activeRuns = new Set<string>()

export interface LauncherOptions {
  url: string
  sessionID: string
  scope?: string[]
  exclude?: string[]
  credentialID?: string
  steps?: number
  headless?: boolean
  // Soft signal — listener registered but runtime cancellation
  // (browser.close on abort) still not wired through agent.ts.
  // INTEGRATION.md §10.6.
  signal?: AbortSignal
}

/**
 * Result of `launchHackbrowser`. Tool returns immediately while the crawl
 * runs in background; callers don't see CrawlResult — that lands in
 * HackbrowserStatus (Faz B.2) and the per-session sidebar.
 */
export interface KickOffResult {
  sessionID: string
  started: boolean
  message: string
}

/**
 * Resolve external dependencies and build hackbrowser CrawlOptions.
 * Pure sync prep — anything that can fail synchronously (Provider error,
 * server URL discovery, validation) lives here so launchHackbrowser can
 * surface the error to the tool caller before the slot is claimed.
 */
async function prepareCrawl(opts: LauncherOptions): Promise<CrawlOptions> {
  // 1. Resolve LLM via cyberstrike Provider — the inverted dependency that
  //    hackbrowser used to do directly (Karar 2 / INTEGRATION.md §5).
  const modelInfo = await Provider.defaultModel()
  const modelDetails = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
  const model = await Provider.getLanguage(modelDetails)
  log.info("resolved model for hackbrowser run", {
    provider: modelInfo.providerID,
    model: modelInfo.modelID,
  })

  // 2. In-process loopback URL for the HTTP ingest path. Karar 6 — kept
  //    HTTP for v1 to leave the existing ingest pipeline untouched.
  const cyberstrikeUrl = Server.url().toString().replace(/\/$/, "")

  // 3. Forward hackbrowser log records into cyberstrike's logger.
  //    Service name is preserved per record (hackbrowser:agent,
  //    hackbrowser:scanner, etc.) so log flow is uniform.
  const logSink = (rec: LogRecord) => {
    const csLog = Log.create({ service: rec.service })
    const level = rec.level.toLowerCase() as "debug" | "info" | "warn" | "error"
    csLog[level](rec.message, rec.extra)
  }

  return {
    url: opts.url,
    sessionID: opts.sessionID,
    credentialID: opts.credentialID,
    scope: opts.scope,
    exclude: opts.exclude,
    steps: opts.steps,
    // Tool default: headless. Manual login flows (multi-credential,
    // --authenticated) need headfull and are blocked at api.ts validation.
    // INTEGRATION.md §10.3.
    headless: opts.headless ?? true,
    // Panel is browser-side telemetry; tool runs are headless so the user
    // never sees it. INTEGRATION.md §10.4 — TUI bridge separate (Faz B.2+).
    panel: false,
    cyberstrikeUrl,
    model,
    logSink,
  }
}

/**
 * Background fire-and-forget runner. Owns the full crawl lifecycle:
 * runs hackbrowser, logs the result, releases the activeRuns slot.
 *
 * Faz B.2 plumbs HackbrowserStatus.set() into completed/failed branches
 * and emits synthetic session messages on failure (asymmetric — success
 * stays sidebar-only to avoid LLM polling loops, Karar 2 in §13.1).
 */
async function backgroundRun(sessionID: string, crawlOpts: CrawlOptions): Promise<void> {
  try {
    const result = await runCrawl(crawlOpts)
    log.info("hackbrowser crawl complete", {
      sessionID,
      capturedEndpoints: result.capturedEndpoints,
      pagesExplored: result.pagesExplored,
      totalSteps: result.totalSteps,
      errors: result.errors.length,
    })
    // TODO Faz B.2: HackbrowserStatus.set(sessionID, { phase: "completed", ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("background hackbrowser run failed", { sessionID, error: message })
    // TODO Faz B.2: HackbrowserStatus.set(sessionID, { phase: "failed", errors: [message] })
    // TODO Faz B.2: Bus.publish synthetic message (kind="hackbrowser-error")
  } finally {
    activeRuns.delete(sessionID)
  }
}

/**
 * Launch a hackbrowser crawl for a target URL within an existing
 * cyberstrike session. Returns immediately after kicking off the
 * background runner — tool framework unblocks the chat prompt loop so
 * proxy-analyzer ingest tasks can run in parallel (INTEGRATION.md §10.9).
 *
 * Throws on:
 *   - Re-entrance for an already-active session
 *   - Provider failure (no model configured)
 *   - api.ts validation (multi-cred + headless mismatch)
 *   - api.ts preflight (chromium binary missing)
 *
 * Throws happen during sync prep before the slot is claimed, so failures
 * here don't poison subsequent invocations.
 */
export async function launchHackbrowser(opts: LauncherOptions): Promise<KickOffResult> {
  if (activeRuns.has(opts.sessionID)) {
    throw new Error(`hackbrowser already running for session ${opts.sessionID}`)
  }

  // Sync prep first — fail fast on validation/preflight before claiming
  // the slot. If prepareCrawl throws, activeRuns stays untouched.
  // Note: api.ts:validate() and api.ts:preflightCheck() actually run
  // inside runCrawl(), so chromium-missing surfaces only in backgroundRun
  // (logged + sidebar-failed). prepareCrawl here only catches Provider /
  // server URL issues. Decision: acceptable — validation already covered
  // by api.ts; tool authors get explicit errors at the chromium layer too.
  const crawlOpts = await prepareCrawl(opts)

  activeRuns.add(opts.sessionID)

  // Soft abort listener — registered after slot is claimed. The listener
  // closure captures opts.sessionID; it survives tool.execute returning
  // because AbortSignal holds its own listener registry. Runtime
  // cancellation (browser.close on abort) is still not wired (§10.6).
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      log.warn(
        "abort signal received during background hackbrowser run — runtime cancellation not yet wired",
        { sessionID: opts.sessionID },
      )
    })
  }

  // Fire and forget — runCrawl runs concurrently. The chat session prompt
  // loop returns on tool completion, freeing the session for ingest queue
  // tasks to dispatch their own SessionPrompt.prompt() calls in parallel
  // (Faz B.0 / INTEGRATION.md §10.9).
  void backgroundRun(opts.sessionID, crawlOpts)

  return {
    sessionID: opts.sessionID,
    started: true,
    message: `Hackbrowser crawl started for ${opts.url}. Captures will arrive in this session as the crawl progresses.`,
  }
}
