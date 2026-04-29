// Hackbrowser library API — single entry point for both standalone CLI
// (`bun src/index.ts`) and cyberstrike-internal callers (Tool / Slash / CLI
// subcommand). See INTEGRATION.md §4 for the contract.
//
// Three responsibilities:
//   1. Validate options (multi-credential headless mismatch, etc.)
//   2. Preflight check (chromium browser binary exists)
//   3. Map flat CrawlOptions → nested AgentConfig and run, aggregating
//      exceptions into CrawlResult.errors instead of letting them propagate.
//
// Exceptions only escape for truly fatal cases (preflight, validation).
// Runtime errors during the crawl land in errors[] so callers (CLI shell or
// cyberstrike launcher) can decide their own surface.

import path from "path"
import { existsSync } from "fs"
import { chromium } from "playwright"
import type { LanguageModel } from "ai"

import { run } from "./agent.ts"
import { Log, type LogSink, type LogRecord, type LogLevel } from "./log.ts"
import { setEventSink, clearEventSink } from "./panel/emit.ts"
import type { AgentConfig, CredentialConfig, CrawlResult, CSEvent } from "./types.ts"

// ============================================================
// Public types
// ============================================================

/**
 * Library API options. Flat shape (vs. AgentConfig's nested cyberstrike/auth
 * blocks) — easier for cyberstrike launcher and external callers.
 */
export interface CrawlOptions {
  // Target (required)
  url: string

  // CyberStrike integration — populated by launcher when invoked in-process
  sessionID?: string
  credentialID?: string

  // LLM provider — when set, navigator skips env resolution
  model?: LanguageModel

  // Log sink — when set, hackbrowser log records flow here instead of stderr.
  // Cyberstrike launcher uses this to forward into its own Log namespace.
  logSink?: LogSink

  // Log level (DEBUG | INFO | WARN | ERROR). Default: INFO
  logLevel?: LogLevel

  // Event sink — when set, every CSEvent emitted by the crawler (page-change,
  // capture, crawl-done, intelligence, etc.) is also forwarded to this
  // callback synchronously. Cyberstrike launcher routes these into
  // HackbrowserStatus to drive the live TUI sidebar (Faz B.1+ /
  // INTEGRATION.md §13.2). Independent of `panel: boolean` — sink fires
  // even in headless mode where no browser-side panel exists.
  eventSink?: (event: CSEvent) => void

  // Network scope (ARCHITECTURE.md §1.4)
  scope?: string[]
  exclude?: string[]

  // Crawl behavior
  steps?: number
  headless?: boolean

  // Auth
  sessionFile?: string                 // resolved against process.cwd()
  credentials?: { username: string; password: string; usernameSelector?: string; passwordSelector?: string }
  authenticated?: boolean
  multiCredentials?: CredentialConfig[]

  // CyberStrike ingest target (HTTP loopback — Karar 6, INTEGRATION.md §10.5)
  cyberstrikeUrl?: string
  cyberstrikeUsername?: string
  cyberstrikePassword?: string

  // UI / panel
  panel?: boolean
  dryRun?: boolean

  // Cancellation — when fired, the agent finishes the current step and
  // gracefully exits the BFS loop. The browser closes via the existing
  // finally block. LLM calls in progress are NOT cancelled at the SDK
  // layer (next iteration check is the granularity). Faz B.5 /
  // INTEGRATION.md §13.7.
  signal?: AbortSignal
}

// Re-export so callers don't need to import from log.ts and types.ts separately
export type { LogRecord, LogSink, LogLevel } from "./log.ts"
export type { CrawlResult, CSEvent } from "./types.ts"

// ============================================================
// Internal helpers
// ============================================================

const log = Log.create({ service: "hackbrowser:api" })

/**
 * Verify the chromium browser binary is installed. INTEGRATION.md §10.7
 * (Seçenek A — manual install) — clear error message pointing the user
 * at Playwright's own install CLI. We deliberately don't ship an
 * in-binary installer because Playwright's registry imports a top-level
 * `require("../../../package.json")` that breaks under Bun --compile.
 * Users (typically developers/pentesters) run the install command once.
 */
function preflightCheck(): void {
  const chromiumPath = chromium.executablePath()
  if (!existsSync(chromiumPath)) {
    throw new Error(
      `Chromium browser is not installed at ${chromiumPath}.\n` +
        `Run: bunx playwright install chromium\n` +
        `(or: npx playwright install chromium — both download to the same cache)`,
    )
  }
}

/**
 * Validate option combinations that are mutually exclusive at the API
 * boundary. Catches misuse early (before browser launch) rather than mid-crawl.
 */
function validate(opts: CrawlOptions): void {
  if (!opts.url) {
    throw new Error("opts.url is required")
  }
  // Multi-credential needs manual login; headless makes that impossible.
  // (INTEGRATION.md §10.3)
  const headlessRequested = opts.headless !== false
  if (opts.multiCredentials && opts.multiCredentials.length >= 2 && headlessRequested) {
    throw new Error(
      "multi-credential mode requires headless: false (manual login is currently the only supported flow)",
    )
  }
}

/**
 * Map the flat CrawlOptions to AgentConfig's nested shape that the existing
 * agent.ts engine expects. Path resolution happens here (sessionFile relative
 * to caller's cwd, not hackbrowser's).
 */
function toAgentConfig(opts: CrawlOptions): AgentConfig {
  return {
    targetUrl: opts.url,
    cyberstrike: {
      serverUrl: opts.cyberstrikeUrl ?? "http://127.0.0.1:4096",
      sessionID: opts.sessionID,
      credentialId: opts.credentialID,
      username: opts.cyberstrikeUsername,
      password: opts.cyberstrikePassword,
    },
    auth: {
      sessionFile: opts.sessionFile ? path.resolve(process.cwd(), opts.sessionFile) : undefined,
      credentials: opts.credentials,
      authenticated: opts.authenticated,
    },
    multiCredentials: opts.multiCredentials,
    outOfScope: opts.exclude,
    scope: opts.scope,
    maxSteps: opts.steps,
    headless: opts.headless,
    dryRun: opts.dryRun,
    panel: opts.panel,
    model: opts.model,
    signal: opts.signal,
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Run a crawl. Single entry point for both standalone CLI and cyberstrike-
 * internal callers.
 *
 * Validation/preflight throw immediately. Runtime errors during the crawl
 * land in CrawlResult.errors[] — they don't propagate, so cyberstrike's
 * tool framework gets a structured result instead of a thrown exception
 * that would crash the agent's tool dispatch.
 */
export async function runCrawl(opts: CrawlOptions): Promise<CrawlResult> {
  validate(opts)
  preflightCheck()

  // Logger and event sink setup — install caller's sinks if provided,
  // restore defaults in finally so subsequent calls in the same process
  // don't leak module-level state. Both sinks share the same lifecycle
  // contract: registered before run(), cleared after run() regardless
  // of success/failure.
  if (opts.logLevel) Log.init({ level: opts.logLevel })
  if (opts.logSink) Log.setSink(opts.logSink)
  if (opts.eventSink) setEventSink(opts.eventSink)

  const config = toAgentConfig(opts)

  try {
    log.info("runCrawl starting", {
      url: opts.url,
      multiCred: !!opts.multiCredentials?.length,
      headless: opts.headless,
      dryRun: opts.dryRun,
      eventSink: !!opts.eventSink,
    })
    const result = await run(config)
    log.info("runCrawl done", {
      sessionID: result.sessionID,
      capturedEndpoints: result.capturedEndpoints,
      pagesExplored: result.pagesExplored,
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("runCrawl failed", { err: message })
    return {
      sessionID: opts.sessionID ?? "",
      capturedEndpoints: 0,
      pagesExplored: 0,
      totalSteps: 0,
      errors: [message],
    }
  } finally {
    if (opts.logSink) Log.resetSink()
    if (opts.eventSink) clearEventSink()
  }
}

// ============================================================
// CLI argv parser — moved from index.ts so the shell stays minimal
// ============================================================

/**
 * Parse CLI argv into CrawlOptions. Used by the standalone shell
 * (`bun src/index.ts`); cyberstrike-internal callers construct opts directly.
 *
 * Mirrors the flag set from the original index.ts (no new flags added here);
 * extending the CLI surface should be done in step with INTEGRATION.md.
 */
export function parseArgsToOptions(argv: string[]): CrawlOptions {
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx !== -1 ? argv[idx + 1] : undefined
  }
  const hasFlag = (flag: string): boolean => argv.includes(flag)

  // Repeatable flags
  const collectRepeated = (flag: string): string[] => {
    const out: string[] = []
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
        out.push(argv[i + 1]!)
      }
    }
    return out
  }

  const credentials = collectRepeated("--credential").map((id) => ({ id }))
  const exclude = collectRepeated("--exclude")
  const scope = collectRepeated("--scope")

  // First positional argument is the target URL.
  const url = argv.find((a) => !a.startsWith("--") && !a.startsWith("-")) ?? ""

  const userArg = getArg("--user")
  const passArg = getArg("--pass")

  return {
    url,
    sessionID: getArg("--session-id"),
    credentialID: getArg("--credential-id"),
    sessionFile: getArg("--session"),
    credentials: userArg && passArg ? { username: userArg, password: passArg } : undefined,
    authenticated: hasFlag("--authenticated"),
    multiCredentials: credentials.length >= 2 ? credentials : undefined,
    exclude: exclude.length > 0 ? exclude : undefined,
    scope: scope.length > 0 ? scope : undefined,
    cyberstrikeUrl: getArg("--cyberstrike"),
    cyberstrikeUsername: getArg("--cyberstrike-username"),
    cyberstrikePassword: getArg("--cyberstrike-password") ?? process.env.CYBERSTRIKE_SERVER_PASSWORD,
    steps: getArg("--steps") ? parseInt(getArg("--steps")!, 10) : undefined,
    headless: hasFlag("--headless") ? true : undefined,
    dryRun: hasFlag("--dry-run"),
    panel: hasFlag("--no-panel") ? false : undefined,
    logLevel: hasFlag("--debug") ? "DEBUG" : undefined,
  }
}
