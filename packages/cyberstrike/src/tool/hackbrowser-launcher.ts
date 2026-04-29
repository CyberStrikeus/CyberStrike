// Hackbrowser launcher — single binding point between cyberstrike's tool
// system and the hackbrowser worker subprocess. Tool, Slash, and CLI
// subcommand all funnel through here.
//
// Responsibilities (SRP — three internal stages):
//   1. prepareCrawl()    sync prep — Provider model descriptor, Server URL,
//                         credential validation, WorkerOptions; throws on
//                         validation fail or missing worker/runtime (Karar 5,
//                         INTEGRATION.md §13.1)
//   2. backgroundRun()   async fire-and-forget runner — owns worker subprocess
//                         lifecycle, IPC reader loop, activeRuns slot release,
//                         error logging
//   3. launchHackbrowser() orchestration — re-entrance guard, prep, spawn
//                         worker, kick off background reader, immediate return
//                         so the tool framework unblocks the chat session
//                         prompt loop (Faz B.0 / §13.6)
//
// Subprocess approach (subprocess.md): the main binary has ZERO playwright
// references. Hackbrowser runs in a separate worker process
// (hackbrowser-worker.js) so playwright is only loaded in that process —
// never at cyberstrike startup. This fixes the Bun compiled binary startup
// crash for both npm install and install.sh users.
//
// Karar 2 (DI) preserved: model, logSink, eventSink injected by parent.
// With subprocess these become IPC relay — parent receives log/event
// messages from worker stdout and applies them locally.

import path from "path"
import { existsSync } from "fs"
import { Provider } from "../provider/provider"
import { Server } from "../server/server"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Session } from "../session"
import { HackbrowserStatus } from "../session/hackbrowser-status"
import { Global } from "../global"
import type {
  WorkerOptions,
  WorkerMessage,
  ParentMessage,
  CredentialDispatch,
} from "../hackbrowser-subprocess/worker-ipc"

const log = Log.create({ service: "hackbrowser-launcher" })

// Bun.spawn returns stdin as `number | FileSink | undefined` depending on
// how stdin is configured. When stdin: "pipe" is used it's always a FileSink,
// but TypeScript doesn't narrow it at use sites. This helper safely writes
// a JSON line to the worker's stdin.
function workerWrite(proc: ReturnType<typeof Bun.spawn>, line: string): void {
  const stdin = proc.stdin
  if (!stdin || typeof stdin === "number") return
  stdin.write(line)
}

// ============================================================
// activeRuns — per-session worker subprocess handle
// ============================================================
//
// Karar 5: re-entrance is an error, not a queue. One hackbrowser run per
// session; concurrent invocations get a clear error rather than silent
// serialization (INTEGRATION.md §2 Karar 5).
//
// WorkerHandle replaces the previous AbortController: the subprocess is the
// cancellation unit. stopHackbrowser() sends { type: "abort" } via stdin.

interface WorkerHandle {
  proc: ReturnType<typeof Bun.spawn>
  modelInfo: { providerID: string; modelID: string }
}

const activeRuns = new Map<string, WorkerHandle>()

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

/** Output of prepareCrawl. modelInfo is preserved separately so the
 * background runner can attribute synthetic session messages
 * (failure path) to the same provider/model that the crawl ran with. */
interface PreparedWorker {
  workerOptions: WorkerOptions
  modelInfo: { providerID: string; modelID: string }
  workerPath: string
  runtime: string
}

/**
 * Resolve external dependencies and build WorkerOptions.
 * Sync prep — anything that can fail before claiming the activeRuns slot:
 * worker binary existence, runtime discovery, Provider model resolution,
 * credential/headless validation. Throws on any failure so launchHackbrowser
 * can surface the error to the tool caller without poisoning the slot.
 */
async function prepareCrawl(opts: LauncherOptions): Promise<PreparedWorker> {
  // 1. Locate worker JS — placed by postinstall at Global.Path.bin.
  const workerPath = path.join(Global.Path.bin, "hackbrowser-worker.js")
  if (!existsSync(workerPath)) {
    throw new Error(
      `hackbrowser worker not found at ${workerPath}. ` +
        `Re-install cyberstrike (npm install -g @cyberstrike-io/cyberstrike) to set it up.`,
    )
  }

  // 2. Find a JS runtime to run the worker. Bun preferred; node as fallback.
  const runtime = Bun.which("bun") ?? Bun.which("node")
  if (!runtime) {
    throw new Error("hackbrowser requires bun or node to run the worker process. " + "Install bun: https://bun.sh")
  }

  // 3. Resolve LLM via cyberstrike Provider — extract serializable descriptor
  //    instead of a LanguageModel instance (subprocess.md: model resolution).
  const modelInfo = await Provider.defaultModel()
  const modelDetails = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
  const modelDescriptor = await Provider.getModelDescriptor(modelDetails)
  log.info("resolved model for hackbrowser run", {
    provider: modelInfo.providerID,
    model: modelInfo.modelID,
  })

  // 4. In-process loopback URL for the HTTP ingest path. Karar 6 — kept
  //    HTTP for v1 to leave the existing ingest pipeline untouched.
  const cyberstrikeUrl = Server.url().toString().replace(/\/$/, "")

  // 5. Credential dispatch — translate cyberstrike credential IDs into the
  //    serializable CredentialDispatch union the worker sends to runCrawl.
  const ids = opts.credentials ?? []
  if (ids.length >= 1 && opts.headless !== false) {
    throw new Error(
      `Crawling with credentials requires headless=false so the user can log in manually. ` +
        `Got ${ids.length} credential ID${ids.length === 1 ? "" : "s"} with headless=${opts.headless ?? "default(true)"}.`,
    )
  }
  const credentialDispatch: CredentialDispatch =
    ids.length >= 2
      ? { kind: "multi", multiCredentials: ids.map((id) => ({ id })) }
      : ids.length === 1
        ? { kind: "single", credentialID: ids[0] }
        : { kind: "none" }

  const workerOptions: WorkerOptions = {
    url: opts.target,
    sessionID: opts.sessionID,
    scope: opts.scope,
    exclude: opts.exclude,
    steps: opts.steps,
    headless: opts.headless ?? true,
    panel: opts.headless === false,
    cyberstrikeUrl,
    model: modelDescriptor,
    credentialDispatch,
  }

  return { workerOptions, modelInfo, workerPath, runtime }
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
 * Background fire-and-forget runner. Owns the full worker lifecycle:
 * reads IPC messages from worker stdout, relays log records and CSEvents,
 * transitions HackbrowserStatus on completion/failure, releases the
 * activeRuns slot, and surfaces failures via a synthetic session message.
 */
async function backgroundRun(
  sessionID: string,
  prepared: PreparedWorker,
  targetUrl: string,
  proc: WorkerHandle["proc"],
): Promise<void> {
  const { modelInfo } = prepared
  const decoder = new TextDecoder()
  let buffer = ""
  let receivedResult = false

  try {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()

    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break outer
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let msg: WorkerMessage
        try {
          msg = JSON.parse(trimmed) as WorkerMessage
        } catch {
          continue
        }

        switch (msg.type) {
          case "log": {
            const csLog = Log.create({ service: msg.service })
            csLog[msg.level](msg.message, msg.extra as Record<string, unknown> | undefined)
            break
          }
          case "event": {
            HackbrowserStatus.handle(sessionID, msg.event)
            break
          }
          case "result": {
            receivedResult = true
            if (msg.errors.length > 0) {
              const errMsg = msg.errors.join("; ")
              log.error("hackbrowser run finished with errors", { sessionID, message: errMsg })
              const prev = HackbrowserStatus.get(sessionID)
              HackbrowserStatus.set(sessionID, {
                sessionID,
                phase: "failed",
                targetUrl,
                pagesExplored: msg.pagesExplored,
                capturedEndpoints: msg.capturedEndpoints,
                currentPage: prev?.currentPage,
                errors: msg.errors,
                startedAt: prev?.startedAt ?? Date.now(),
                finishedAt: Date.now(),
              })
              await writeFailureMessage(sessionID, errMsg, modelInfo).catch((err) =>
                log.error("failed to write hackbrowser-error message", { sessionID, err: String(err) }),
              )
            } else {
              log.info("hackbrowser crawl complete", {
                sessionID,
                capturedEndpoints: msg.capturedEndpoints,
                pagesExplored: msg.pagesExplored,
              })
              const prev = HackbrowserStatus.get(sessionID)
              HackbrowserStatus.set(sessionID, {
                sessionID,
                phase: "completed",
                targetUrl,
                pagesExplored: msg.pagesExplored,
                capturedEndpoints: msg.capturedEndpoints,
                currentPage: prev?.currentPage,
                errors: [],
                startedAt: prev?.startedAt ?? Date.now(),
                finishedAt: Date.now(),
              })
              // Karar 2 in §13.1: success stays sidebar-only. No synthetic
              // message — LLM doesn't get nudged into polling loops.
            }
            break outer
          }
          case "error": {
            receivedResult = true
            log.error("hackbrowser worker reported error", { sessionID, message: msg.message })
            const prev = HackbrowserStatus.get(sessionID)
            HackbrowserStatus.set(sessionID, {
              sessionID,
              phase: "failed",
              targetUrl,
              pagesExplored: prev?.pagesExplored ?? 0,
              capturedEndpoints: prev?.capturedEndpoints ?? 0,
              currentPage: prev?.currentPage,
              errors: [msg.message],
              startedAt: prev?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
            })
            await writeFailureMessage(sessionID, msg.message, modelInfo).catch((err) =>
              log.error("failed to write hackbrowser-error message", { sessionID, err: String(err) }),
            )
            break outer
          }
        }
      }
    }

    // Worker exited without sending result/error — unexpected crash.
    if (!receivedResult) {
      const exitCode = await proc.exited.catch(() => -1)
      const stderr = await Bun.readableStreamToText(proc.stderr as ReadableStream).catch(() => "")
      const message =
        `hackbrowser worker exited unexpectedly (code ${exitCode})` + (stderr.trim() ? `: ${stderr.trim()}` : "")
      log.error("hackbrowser worker crashed", { sessionID, exitCode, stderr })
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
      await writeFailureMessage(sessionID, message, modelInfo).catch((err) =>
        log.error("failed to write hackbrowser-error message", { sessionID, err: String(err) }),
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("hackbrowser IPC reader threw", { sessionID, error: message })
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
    await writeFailureMessage(sessionID, message, modelInfo).catch((err2) =>
      log.error("failed to write hackbrowser-error message", { sessionID, err: String(err2) }),
    )
  } finally {
    activeRuns.delete(sessionID)
    proc.kill()
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
 *   - Worker JS not found (re-install required)
 *   - Runtime not found (bun/node not on PATH)
 *   - Provider failure (no model configured)
 *   - Credential/headless mismatch
 *
 * Throws happen during sync prep before the slot is claimed, so failures
 * here don't poison subsequent invocations.
 */
export async function launchHackbrowser(opts: LauncherOptions): Promise<KickOffResult> {
  if (activeRuns.has(opts.sessionID)) {
    throw new Error(`hackbrowser already running for session ${opts.sessionID}`)
  }

  // Sync prep first — fail fast on any issue before claiming the slot.
  const prepared = await prepareCrawl(opts)

  // Spawn worker subprocess. stdin/stdout are pipes for JSON IPC.
  // Inherits full parent env so AWS/GCP/other provider credentials
  // (AWS_ACCESS_KEY_ID, GOOGLE_APPLICATION_CREDENTIALS, etc.) are
  // available to the worker without explicit forwarding.
  const proc = Bun.spawn([prepared.runtime, prepared.workerPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  })

  activeRuns.set(opts.sessionID, { proc, modelInfo: prepared.modelInfo })

  // Initial sidebar entry — phase="starting" so users see the run
  // appear instantly. CSEvents from the worker relay to HackbrowserStatus.handle
  // as page-changes arrive via the IPC reader loop.
  HackbrowserStatus.set(opts.sessionID, {
    sessionID: opts.sessionID,
    phase: "starting",
    targetUrl: opts.target,
    pagesExplored: 0,
    capturedEndpoints: 0,
    errors: [],
    startedAt: Date.now(),
  })

  // Bridge the chat track's ctx.abort (Esc) into an IPC abort message so
  // pressing Esc on the currently running chat turn also stops the crawl.
  // The reliable cancellation path is /hackbrowser-stop → stopHackbrowser().
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      log.info("ctx.abort received — forwarding to worker", { sessionID: opts.sessionID })
      workerWrite(proc, JSON.stringify({ type: "abort" } satisfies ParentMessage) + "\n")
    })
  }

  // Send start message — worker begins crawl on receipt.
  workerWrite(proc, JSON.stringify({ type: "start", options: prepared.workerOptions } satisfies ParentMessage) + "\n")

  // Fire and forget — IPC reader runs concurrently. The chat session prompt
  // loop returns on tool completion, freeing the session for ingest queue
  // tasks to dispatch their own SessionPrompt.prompt() calls in parallel
  // (Faz B.0 / INTEGRATION.md §10.9).
  void backgroundRun(opts.sessionID, prepared, opts.target, proc)

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
 * Sends { type: "abort" } to the worker's stdin. The worker's AbortController
 * fires, the agent's BFS loop sees signal.aborted at the next iteration
 * boundary, finishes the current page's pending tasks, closes the browser,
 * and writes a final result message. HackbrowserStatus transitions to
 * completed (not failed) — cancellation is a normal lifecycle exit.
 */
export function stopHackbrowser(sessionID: string): boolean {
  const handle = activeRuns.get(sessionID)
  if (!handle) return false
  log.info("stopHackbrowser: sending abort to worker", { sessionID })
  workerWrite(handle.proc, JSON.stringify({ type: "abort" } satisfies ParentMessage) + "\n")
  return true
}

/** Whether a hackbrowser run is active for the given session. */
export function isHackbrowserRunning(sessionID: string): boolean {
  return activeRuns.has(sessionID)
}
