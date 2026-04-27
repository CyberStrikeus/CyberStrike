// Hackbrowser launcher — single binding point between cyberstrike's tool
// system and the hackbrowser library API. Tool, Slash, and CLI subcommand
// (when added) all funnel through here.
//
// Responsibilities:
//   1. Resolve LLM model via cyberstrike Provider → opts.model injection
//   2. Discover server URL (in-process loopback for HTTP ingest)
//   3. Bridge hackbrowser log records into cyberstrike's Log namespace
//   4. Enforce per-session re-entrance (one active hackbrowser run per session)
//
// See INTEGRATION.md §6.1 for the design rationale (Karar 2: dependency
// inversion — hackbrowser stays decoupled, cyberstrike injects deps).

import { runCrawl, type CrawlOptions, type CrawlResult, type LogRecord } from "@cyberstrike-io/hackbrowser/api"
import { Provider } from "../provider/provider"
import { Server } from "../server/server"
import { Log } from "../util/log"

const log = Log.create({ service: "hackbrowser-launcher" })

// Karar 5 (INTEGRATION.md §2): re-entrance is an error, not a queue.
// One hackbrowser run per session; concurrent invocations get a clear error
// instead of being silently serialized into hours of waiting.
const activeRuns = new Set<string>()

export interface LauncherOptions {
  url: string
  sessionID: string
  scope?: string[]
  exclude?: string[]
  credentialID?: string
  steps?: number
  headless?: boolean
  // ctx.abort from the tool framework. Currently a soft signal — accepted
  // for API stability but runtime cancellation (browser.close on abort)
  // lands in a follow-up; see INTEGRATION.md §10.6.
  signal?: AbortSignal
}

/**
 * Launch a hackbrowser crawl for a target URL within an existing
 * cyberstrike session. Throws on validation/preflight errors;
 * runtime errors during the crawl are aggregated into CrawlResult.errors.
 */
export async function launchHackbrowser(opts: LauncherOptions): Promise<CrawlResult> {
  if (activeRuns.has(opts.sessionID)) {
    throw new Error(`hackbrowser already running for session ${opts.sessionID}`)
  }
  activeRuns.add(opts.sessionID)

  try {
    // 1. Resolve LLM via cyberstrike Provider — this is the inverted
    //    dependency that hackbrowser used to do directly (and shouldn't).
    const modelInfo = await Provider.defaultModel()
    const modelDetails = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
    const model = await Provider.getLanguage(modelDetails)
    log.info("resolved model for hackbrowser run", { provider: modelInfo.providerID, model: modelInfo.modelID })

    // 2. In-process loopback URL for the HTTP ingest path (Karar 6 — kept
    //    HTTP for v1 to leave the existing ingest pipeline untouched).
    const cyberstrikeUrl = Server.url().toString().replace(/\/$/, "")

    // 3. Forward hackbrowser log records into cyberstrike's logger so the
    //    crawl appears in the same log stream as the rest of the agent.
    //    Service name is preserved per record (hackbrowser:agent,
    //    hackbrowser:scanner, etc.) — cyberstrike Log caches loggers by
    //    service name so this is cheap.
    const logSink = (rec: LogRecord) => {
      const csLog = Log.create({ service: rec.service })
      const level = rec.level.toLowerCase() as "debug" | "info" | "warn" | "error"
      csLog[level](rec.message, rec.extra)
    }

    // 4. Soft abort propagation — log only for now. Wiring browser.close
    //    requires plumbing through agent.ts (next iteration).
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        log.warn("abort signal received — runtime cancellation not yet wired", {
          sessionID: opts.sessionID,
        })
      })
    }

    const crawlOpts: CrawlOptions = {
      url: opts.url,
      sessionID: opts.sessionID,
      credentialID: opts.credentialID,
      scope: opts.scope,
      exclude: opts.exclude,
      steps: opts.steps,
      // Tool default: headless. Manual login flows (multi-credential,
      // --authenticated) need headfull and are blocked by api.ts validation
      // when invoked through the tool. INTEGRATION.md §10.3.
      headless: opts.headless ?? true,
      // Panel is browser-side telemetry; in headless tool runs the user
      // never sees it. INTEGRATION.md §10.4 — TUI bridge is future work.
      panel: false,
      cyberstrikeUrl,
      model,
      logSink,
    }

    return await runCrawl(crawlOpts)
  } finally {
    activeRuns.delete(opts.sessionID)
  }
}
