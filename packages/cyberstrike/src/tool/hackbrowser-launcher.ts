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

import { runCrawl, type CrawlOptions, type LogRecord, type CSEvent } from "@cyberstrike-io/hackbrowser/api"
import { Provider } from "../provider/provider"
import { Server } from "../server/server"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Session } from "../session"
import { HackbrowserStatus } from "../session/hackbrowser-status"

const log = Log.create({ service: "hackbrowser-launcher" })

// Karar 5: re-entrance is an error, not a queue. One hackbrowser run per
// session; concurrent invocations get a clear error rather than silent
// serialization (INTEGRATION.md §2 Karar 5).
//
// Faz B.5: activeRuns now holds a per-session AbortController so the
// `/hackbrowser-stop` slash command can cancel an in-flight crawl. The
// controller's signal is wired into runCrawl(opts.signal), which the
// agent's BFS loop checks at each iteration boundary.
const activeRuns = new Map<string, AbortController>()

export interface LauncherOptions {
  // Crawl URL. Named `target` here (and in all cyberstrike-facing surfaces:
  // tool, slash form, CLI subcommand) for clarity; mapped to the library's
  // `CrawlOptions.url` inside prepareCrawl.
  target: string
  sessionID: string
  scope?: string[]
  exclude?: string[]
  // Credential IDs to crawl as. Length determines crawl mode:
  //   undefined / [] → anonymous (no login, no tagging)
  //   [id]           → manual login + tag captures with this credential ID
  //   [id1, id2, …]  → multi-credential mode: per-credential manual login,
  //                    captures tagged per identity (role-based access tests)
  // ANY non-empty value forces headless: false because every credentialed
  // crawl uses manual login (auto-login is intentionally not exposed).
  // Library limit (INTEGRATION.md §10.10): manual-login wait does not
  // honor the abort signal yet, so Esc / /hackbrowser-stop cannot cancel
  // during the login wait phase.
  credentials?: string[]
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

/** Output of prepareCrawl. modelInfo is preserved separately so the
 * background runner can attribute synthetic session messages
 * (failure path) to the same provider/model that the crawl ran with. */
interface PreparedCrawl {
  crawlOpts: CrawlOptions
  modelInfo: { providerID: string; modelID: string }
}

/**
 * Resolve external dependencies and build hackbrowser CrawlOptions.
 * Sync prep — anything that can fail synchronously (Provider error,
 * server URL discovery) lives here so launchHackbrowser can surface
 * the error to the tool caller before the slot is claimed.
 *
 * api.ts:validate() and api.ts:preflightCheck() (chromium check) run
 * INSIDE runCrawl, not here. Their errors land in backgroundRun's
 * catch and become a "failed" status + synthetic failure message,
 * which is fine — those failures need a session-level audit trail
 * anyway (e.g. "you didn't install chromium").
 */
async function prepareCrawl(opts: LauncherOptions): Promise<PreparedCrawl> {
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

  // 4. Forward CSEvents into HackbrowserStatus so the TUI sidebar updates
  //    live as the crawl progresses. Sink throws are swallowed by csEmit
  //    so a Status bug can't crash the agent (INTEGRATION.md §13.5).
  const eventSink = (event: CSEvent) => {
    HackbrowserStatus.handle(opts.sessionID, event)
  }

  // Translate the cyberstrike-facing `credentials` array into the library's
  // dual auth surface (CrawlOptions.authenticated + credentialID for the
  // single-cred case, multiCredentials for the multi-cred case). Length
  // semantics from LauncherOptions are honored here — anything ≥1 forces
  // manual login, which requires headfull.
  const ids = opts.credentials ?? []
  if (ids.length >= 1 && opts.headless !== false) {
    throw new Error(
      `Crawling with credentials requires headless=false so the user can log in manually. ` +
        `Got ${ids.length} credential ID${ids.length === 1 ? "" : "s"} with headless=${opts.headless ?? "default(true)"}.`,
    )
  }
  const credentialDispatch =
    ids.length >= 2
      ? { multiCredentials: ids.map((id) => ({ id })) }
      : ids.length === 1
        ? { authenticated: true, credentialID: ids[0] }
        : {}

  const crawlOpts: CrawlOptions = {
    url: opts.target,
    sessionID: opts.sessionID,
    ...credentialDispatch,
    scope: opts.scope,
    exclude: opts.exclude,
    steps: opts.steps,
    // Anonymous: respect the caller's headless choice (default true).
    // With credentials, the validation above already rejected anything
    // other than headless=false, so it's safe to pass through here.
    headless: opts.headless ?? true,
    // Browser-side telemetry HUD: enabled whenever the browser is visible
    // (headless=false). When the browser is hidden the panel can't be
    // seen anyway — disable it. The TUI sidebar bridge via eventSink
    // (above) is independent of this and works in both modes.
    panel: opts.headless === false,
    cyberstrikeUrl,
    model,
    logSink,
    eventSink,
  }

  return { crawlOpts, modelInfo }
}

/**
 * Write a synthetic user-message into the session so the LLM can see a
 * failure on the next prompt. Asymmetric reporting per Karar 2 in §13.1:
 * failures are surfaced this way; successes stay sidebar-only to avoid
 * tempting the LLM into polling loops.
 *
 * Same pattern as IngestSummary.write — see session/ingest-summary.ts.
 */
async function writeFailureMessage(
  sessionID: string,
  errorMessage: string,
  modelInfo: { providerID: string; modelID: string },
): Promise<void> {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    role: "user",
    sessionID,
    time: { created: Date.now() },
    agent: "hackbrowser",
    model: modelInfo,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID,
    type: "text",
    text: `Hackbrowser crawl failed: ${errorMessage}`,
    time: { start: Date.now(), end: Date.now() },
    metadata: { kind: "hackbrowser-error" },
  })
}

/**
 * Background fire-and-forget runner. Owns the full crawl lifecycle:
 * runs hackbrowser, transitions HackbrowserStatus, releases the
 * activeRuns slot, surfaces failures via a synthetic session message.
 *
 * Two error classes the catch handles:
 *   - Validation/preflight throws from api.ts (e.g. chromium not
 *     installed) — runCrawl re-throws these before any crawl runs.
 *   - Runtime exceptions while crawling — runCrawl normally catches
 *     these into CrawlResult.errors, so the catch block here is rare;
 *     it only hits truly fatal cases (Promise rejection escape).
 *
 * In practice runCrawl ALWAYS resolves (validation errors throw;
 * runtime errors are aggregated into result.errors). The check on
 * result.errors below covers the second class. The catch covers the
 * first.
 */
async function backgroundRun(
  sessionID: string,
  prepared: PreparedCrawl,
  targetUrl: string,
): Promise<void> {
  try {
    const result = await runCrawl(prepared.crawlOpts)

    if (result.errors.length > 0) {
      // Validation/preflight failure — runCrawl bottled it into errors[]
      // (the standalone-CLI contract from Faz A.3), but for the tool path
      // we want the same surface as a thrown exception.
      const message = result.errors.join("; ")
      log.error("hackbrowser run finished with errors", { sessionID, message })
      const prev = HackbrowserStatus.get(sessionID)
      HackbrowserStatus.set(sessionID, {
        sessionID,
        phase: "failed",
        targetUrl,
        pagesExplored: result.pagesExplored,
        capturedEndpoints: result.capturedEndpoints,
        currentPage: prev?.currentPage,
        errors: result.errors,
        startedAt: prev?.startedAt ?? Date.now(),
        finishedAt: Date.now(),
      })
      await writeFailureMessage(sessionID, message, prepared.modelInfo).catch((err) =>
        log.error("failed to write hackbrowser-error message", { sessionID, err: String(err) }),
      )
      return
    }

    log.info("hackbrowser crawl complete", {
      sessionID,
      capturedEndpoints: result.capturedEndpoints,
      pagesExplored: result.pagesExplored,
      totalSteps: result.totalSteps,
    })
    const prev = HackbrowserStatus.get(sessionID)
    HackbrowserStatus.set(sessionID, {
      sessionID,
      phase: "completed",
      targetUrl,
      pagesExplored: result.pagesExplored,
      capturedEndpoints: result.capturedEndpoints,
      currentPage: prev?.currentPage,
      errors: [],
      startedAt: prev?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
    })
    // Karar 2 in §13.1: success stays sidebar-only. No synthetic message
    // here — LLM doesn't get nudged into "let me check the result" loops.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("background hackbrowser run threw", { sessionID, error: message })
    const prev = HackbrowserStatus.get(sessionID)
    HackbrowserStatus.set(sessionID, {
      sessionID,
      phase: "failed",
      targetUrl,
      pagesExplored: prev?.pagesExplored ?? 0,
      capturedEndpoints: prev?.capturedEndpoints ?? 0,
      currentPage: prev?.currentPage,
      errors: [message],
      startedAt: prev?.startedAt ?? Date.now(),
      finishedAt: Date.now(),
    })
    await writeFailureMessage(sessionID, message, prepared.modelInfo).catch((err2) =>
      log.error("failed to write hackbrowser-error message", { sessionID, err: String(err2) }),
    )
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

  // Sync prep first — fail fast on Provider / server URL issues before
  // claiming the slot. If prepareCrawl throws, activeRuns stays untouched
  // and HackbrowserStatus is never set, so the sidebar shows nothing.
  // Validation/preflight (chromium binary, multi-cred-headless mismatch)
  // run inside runCrawl and surface as failed-status + synthetic message
  // via backgroundRun's error path.
  const prepared = await prepareCrawl(opts)

  // Faz B.5: per-session AbortController. /hackbrowser-stop fires this
  // controller; agent.ts BFS loop sees aborted=true and breaks out
  // gracefully. ctx.abort (chat-Esc) is also bridged into this controller
  // so both code paths converge on a single cancellation signal.
  const controller = new AbortController()
  prepared.crawlOpts.signal = controller.signal
  activeRuns.set(opts.sessionID, controller)

  // Initial sidebar entry — phase="starting" so users see the run
  // appear instantly. CSEvents from the crawler will transition this
  // to "crawling" via HackbrowserStatus.handle as page-changes arrive.
  HackbrowserStatus.set(opts.sessionID, {
    sessionID: opts.sessionID,
    phase: "starting",
    targetUrl: opts.target,
    pagesExplored: 0,
    capturedEndpoints: 0,
    errors: [],
    startedAt: Date.now(),
  })

  // Bridge the chat track's ctx.abort (Esc) into the same controller so
  // pressing Esc on the *currently running* chat turn also stops the
  // crawl. Note this only fires while the chat track holds the prompt
  // loop — once tool.execute returns, ctx.abort no longer triggers from
  // user Esc on a new turn. The reliable cancellation path is the slash
  // command `/hackbrowser-stop` → stopHackbrowser() which fires this
  // controller directly (§13.7).
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      log.info("ctx.abort received — forwarding to crawl controller", { sessionID: opts.sessionID })
      controller.abort()
    })
  }

  // Fire and forget — runCrawl runs concurrently. The chat session prompt
  // loop returns on tool completion, freeing the session for ingest queue
  // tasks to dispatch their own SessionPrompt.prompt() calls in parallel
  // (Faz B.0 / INTEGRATION.md §10.9).
  void backgroundRun(opts.sessionID, prepared, opts.target)

  return {
    sessionID: opts.sessionID,
    started: true,
    message: `Hackbrowser crawl started for ${opts.target}. Captures will arrive in this session as the crawl progresses. Use /hackbrowser-stop to cancel before completion.`,
  }
}

/**
 * Cancel an in-flight hackbrowser run. Returns true if a run was active
 * (and therefore aborted), false if no run was found for this session.
 *
 * The agent's BFS loop checks signal.aborted at each iteration boundary,
 * so cancellation is graceful (not instant): the current page's LLM call
 * and pending tasks complete first, then the loop exits, browser closes
 * via the existing finally, and HackbrowserStatus transitions to
 * completed (with whatever was captured so far) — NOT failed, because
 * cancellation is a normal lifecycle exit, not an error.
 */
export function stopHackbrowser(sessionID: string): boolean {
  const controller = activeRuns.get(sessionID)
  if (!controller) return false
  log.info("stopHackbrowser: aborting run", { sessionID })
  controller.abort()
  return true
}

/** Whether a hackbrowser run is active for the given session. */
export function isHackbrowserRunning(sessionID: string): boolean {
  return activeRuns.has(sessionID)
}
