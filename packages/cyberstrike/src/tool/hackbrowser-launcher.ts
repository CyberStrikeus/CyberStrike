// Hackbrowser launcher (v2) — single binding point between cyberstrike's tool system and the
// HackBrowser 2.0 extension flow. Tool, Slash, and CLI subcommand all funnel through here.
//
// No crawl worker: launchHackbrowser enqueues the roles and opens the orchestrator
// browser (Chrome for Testing + our extension); the user drives capture and each Start
// capture spawns the next role's browser. stopHackbrowser closes them all.

import { Log } from "../util/log"
import { Server } from "../server/server"
import { HBLog } from "../session/web/hblog"
import { WebScope } from "../session/web/scope"
import { WellKnown } from "../session/web/well-known"
import { HackbrowserStatus } from "../session/hackbrowser-status"
import { RoleQueue } from "../session/web/role-queue"
import { SpawnedProfiles } from "../session/web/spawned-profiles"
const log = Log.create({ service: "hackbrowser-launcher" })

// v2 runs: no crawl worker — just the orchestrator browser + the role queue. Tracks the
// session's active v2 launch (target/startedAt for the sidebar status).
const v2Runs = new Map<string, { target: string; startedAt: number }>()

export interface LauncherOptions {
  // Crawl URL. Named `target` here (and in all cyberstrike-facing surfaces:
  // tool, slash form, CLI subcommand) for clarity; mapped to WorkerOptions.url.
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
  // Connect to user's real Chrome via CDP instead of Playwright's Chromium.
  // Bypasses WAF TLS fingerprinting (Cloudflare, etc.).
  cdp?: string
  // Soft signal — forwarded to worker as { type: "abort" } IPC message.
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

export async function launchHackbrowser(opts: LauncherOptions): Promise<KickOffResult> {
  if (v2Runs.has(opts.sessionID)) {
    throw new Error(`hackbrowser already running for session ${opts.sessionID}`)
  }

  // v2: NO crawl worker. Enqueue the roles for sequential setup, then open the
  // orchestrator browser with the first credential so the extension panel reflects
  // what the user typed. Remaining credentials spawn one at a time via Start capture.
  const creds = opts.credentials ?? []
  RoleQueue.enqueue(opts.sessionID, creds)
  // Bound the AI crawl to the target domain (+ any explicit scope) so it can't wander off-site.
  WebScope.ensure(opts.sessionID, opts.target, opts.scope)
  HBLog.record(opts.sessionID, "server", "launch", { target: opts.target, csUrl: Server.url().toString(), scope: WebScope.label(opts.sessionID) })
  // Deterministic well-known recon (Swagger/OpenAPI + robots + sitemap) — background, once. Catches
  // API docs the AI navigator deliberately does NOT tunnel to; feeds the collector + vuln pipeline.
  void WellKnown.probe(opts.sessionID, opts.target).catch(() => {})
  const spawn = await import("@cyberstrike-io/hackbrowser/v2-spawn")
  try {
    // Pass the ACTUAL server URL so the extension calls back to this instance even when the
    // server bound a non-default port (4096 taken → random). Without it the extension defaults
    // to :4096 and silently talks to a stale/other server → the AI loop never drives.
    const result = spawn.spawnProfile({
      url: opts.target,
      session: opts.sessionID,
      csUrl: Server.url().toString(),
      headless: opts.headless,
      cred: creds[0],
    })
    SpawnedProfiles.track(opts.sessionID, result.proc)
    HBLog.record(opts.sessionID, "server", "spawn", { pid: result.proc?.pid })
  } catch (e) {
    HBLog.record(opts.sessionID, "server", "spawn-failed", { error: e instanceof Error ? e.message : String(e) })
    throw new Error(`could not open browser: ${e instanceof Error ? e.message : String(e)}`)
  }

  v2Runs.set(opts.sessionID, { target: opts.target, startedAt: Date.now() })
  HackbrowserStatus.set(opts.sessionID, {
    sessionID: opts.sessionID,
    phase: "crawling",
    targetUrl: opts.target,
    pagesExplored: 0,
    capturedEndpoints: 0,
    errors: [],
    startedAt: Date.now(),
  })

  // Esc / abort closes the browsers (same path as /hackbrowser-stop).
  if (opts.signal) opts.signal.addEventListener("abort", () => void stopHackbrowser(opts.sessionID))

  const extra = (opts.credentials ?? []).length
  return {
    sessionID: opts.sessionID,
    started: true,
    message:
      `Hackbrowser opened for ${opts.target}. Log in (if needed) and press Start capture in the panel` +
      (extra ? `; ${extra} more role browser(s) open one at a time as you go.` : ".") +
      ` Use /hackbrowser-stop to close the browsers.`,
  }
}

/**
 * Stop a v2 hackbrowser run: close every browser CyberStrike spawned for the session
 * (orchestrator + role browsers) and mark the run completed. Returns true if a run was
 * active, false otherwise.
 */
export function stopHackbrowser(sessionID: string): boolean {
  const run = v2Runs.get(sessionID)
  if (!run) return false
  const closed = SpawnedProfiles.closeAll(sessionID)
  v2Runs.delete(sessionID)
  log.info("stopHackbrowser: closed spawned browsers", { sessionID, closed })
  HackbrowserStatus.set(sessionID, {
    sessionID,
    phase: "completed",
    targetUrl: run.target,
    pagesExplored: 0,
    capturedEndpoints: 0,
    errors: [],
    startedAt: run.startedAt,
  })
  return true
}

/** Whether a hackbrowser run is active for the given session. */
export function isHackbrowserRunning(sessionID: string): boolean {
  return v2Runs.has(sessionID)
}
