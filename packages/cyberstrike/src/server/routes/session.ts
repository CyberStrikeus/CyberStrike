import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { SessionCompaction } from "../../session/compaction"
import { SessionRevert } from "../../session/revert"
import { SessionStatus } from "@/session/status"
import { SessionQueueStatus } from "@/session/queue-status"
import { HackbrowserStatus } from "@/session/hackbrowser-status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "../../session/todo"
import { Vulnerability } from "../../session/vulnerability"
import { Request } from "../../session/request"
import { Observation } from "../../session/observation"
import { CoverageNote } from "../../session/coverage-note"
import { Normalize } from "../../session/normalize"
import { IngestSummary } from "../../session/ingest-summary"
import { IngestQueue } from "../../session/ingest-queue"
import { WebCredential } from "../../session/web/web-credential"
import { WebRole } from "../../session/web/web-role"
import { WebJs } from "../../session/web/web-js"
import { WebStats } from "../../session/web/web-stats"
import { WebObject } from "../../session/web/web-object"
import { WebFunction } from "../../session/web/web-function"
import { WebRetest } from "../../session/web/web-retest"
import { RetestWorker } from "../../session/web/retest-worker"
import { ApiProbe } from "../../session/web/api-probe"
import { WebScope } from "../../session/web/scope"
import { UiObservation } from "../../session/web/ui-observation"
import { SpawnedProfiles } from "../../session/web/spawned-profiles"
import { RoleQueue } from "../../session/web/role-queue"
import { PageState } from "../../session/web/page-state"
import { WebControl } from "../../session/web/control"
import { WebDriver } from "../../session/web/driver"
import { WebHold } from "../../session/web/hold"
import { CoDrive } from "../../session/web/nav/co-drive-runner"
import { DataCollector } from "../../session/web/data-collector"
import { JsMiner } from "../../session/web/js-miner"
import { scanCapturedResponse } from "../../session/web/signal/ingest"
import { ingestBrowserTransaction, vortexReport, vortexProbe, vortexDiscoverJs, vortexCaptures, vortexSignals } from "../../session/web/vortex-bridge"
import { Identifier } from "../../id/id"
import { HBLog } from "../../session/web/hblog"
import { FrameworkFingerprinter } from "../../session/web/tech"
import { upgradeWebSocket } from "hono/bun"

const RoleInfoSchema = z.object({ label: z.string(), phase: z.enum(["pending", "spawning", "awaiting", "capturing"]) })
const QueueStatusSchema = z.object({ roles: z.array(RoleInfoSchema), setup: RoleInfoSchema.nullable() })
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Snapshot } from "@/snapshot"
import { Log } from "../../util/log"
import { PermissionNext } from "@/permission/next"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

const MAX_REQUEST_SIZE = 16 * 1024 // 16 KB
const MAX_REQUEST_HEADERS = 20 // First N headers
const MAX_REQUEST_BODY = 8 * 1024 // 8 KB

function truncateRawRequest(rawRequest: string): string {
  const originalSize = Buffer.byteLength(rawRequest, "utf-8")

  const lines = rawRequest.split("\n")
  if (lines.length === 0) return rawRequest

  // 1. Keep request line (GET /path HTTP/1.1)
  const requestLine = lines[0]
  const result: string[] = [requestLine]

  // 2. Find blank line separating headers and body
  let blankLineIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      blankLineIndex = i
      break
    }
  }

  // 3. Add headers (up to MAX_REQUEST_HEADERS)
  const headerLines = blankLineIndex === -1 ? lines.slice(1) : lines.slice(1, blankLineIndex)
  const truncatedHeaders = headerLines.slice(0, MAX_REQUEST_HEADERS)
  result.push(...truncatedHeaders)

  const removedHeaderCount = headerLines.length - truncatedHeaders.length
  if (removedHeaderCount > 0) {
    result.push(`[... ${removedHeaderCount} more headers truncated ...]`)
  }

  // 4. Add blank line if there was one
  if (blankLineIndex !== -1) {
    result.push("")

    // 5. Add body (up to MAX_REQUEST_BODY)
    const bodyLines = lines.slice(blankLineIndex + 1)
    const bodyText = bodyLines.join("\n")
    const bodySize = Buffer.byteLength(bodyText, "utf-8")

    if (bodySize > MAX_REQUEST_BODY) {
      const truncatedBody = bodyText.slice(0, MAX_REQUEST_BODY)
      result.push(truncatedBody)
      result.push(
        `\n[... body truncated: showing first ${formatSize(MAX_REQUEST_BODY)} of ${formatSize(bodySize)} ...]`,
      )
    } else {
      result.push(bodyText)
    }
  }

  const finalResult = result.join("\n")
  const finalSize = Buffer.byteLength(finalResult, "utf-8")

  // Log only if truncation occurred
  if (removedHeaderCount > 0 || originalSize !== finalSize) {
    log.debug("truncated raw request", {
      originalSize,
      finalSize,
      removedHeaders: removedHeaderCount,
    })
  }

  return finalResult
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface AccessContextInput {
  triggerElement?: string
  elementRoles?: string[]
  pageUrl?: string
  pageVisitedBy?: string[]
  uiContext?: Record<string, unknown>
}

// Renders the `## Access Context` block when hackbrowser enrichment is
// present. Returns an empty array for requests from sources without UI
// enrichment (e.g., Firefox extension manual browsing). Shared by the ingest
// prompt builder (below) and the subagent-dispatch prompt builder in task.ts,
// so the orchestrator and subagents see the same structured signals.
export function renderAccessContextLines(accessContext: AccessContextInput): string[] {
  const ac = accessContext
  const hasData = ac.triggerElement || ac.pageUrl || ac.uiContext
  if (!hasData) return []
  const lines: string[] = ["", "## Access Context"]
  if (ac.pageUrl) {
    const visitedBy = ac.pageVisitedBy?.length ? ` (visited by: ${ac.pageVisitedBy.join(", ")})` : ""
    lines.push(`Page: ${ac.pageUrl}${visitedBy}`)
  }
  if (ac.triggerElement) {
    const visibleTo = ac.elementRoles?.length ? ` (visible to: ${ac.elementRoles.join(", ")})` : ""
    lines.push(`Trigger: ${ac.triggerElement}${visibleTo}`)
  }
  if (ac.uiContext) {
    const ui = ac.uiContext as {
      formName?: string
      fields?: Array<{
        name: string
        type: string
        isReadOnly?: boolean
        isDisabled?: boolean
        isHidden?: boolean
        validation?: { required?: boolean }
      }>
      hiddenParams?: string[]
    }
    if (ui.formName) lines.push(`Form: ${ui.formName}`)
    if (ui.fields?.length) {
      const fieldsSummary = ui.fields
        .map((f) => {
          const flags: string[] = []
          if (f.validation?.required) flags.push("required")
          if (f.isReadOnly) flags.push("readonly")
          if (f.isDisabled) flags.push("disabled")
          if (f.isHidden) flags.push("hidden")
          return `${f.name}(${f.type}${flags.length ? "," + flags.join(",") : ""})`
        })
        .join(", ")
      lines.push(`Fields: ${fieldsSummary}`)
    }
    if (ui.hiddenParams?.length) {
      lines.push(`Hidden Params: ${ui.hiddenParams.join(", ")}`)
    }
  }
  return lines
}

// Renders the `## Observed Values` block: the concrete input values each credential was
// observed using on THIS endpoint shape (deterministic, redaction-aware). RAW FACTS ONLY —
// no interpretation. What the values mean (access-control/IDOR/etc.) is the orchestrator's
// and tester subagent's call, never pre-judged here. Empty when no params carry values.
function renderObservedValuesLines(tree: Observation.EndpointTree): string[] {
  if (tree.params.length === 0) return []
  const lines = [
    "",
    "## Observed Values",
    "Concrete input values captured on this endpoint, per credential (deterministic, redaction-aware).",
  ]
  for (const p of tree.params.slice(0, 12)) {
    const parts = p.byCredential.map((c) => {
      const label = c.credentialID
        ? (WebCredential.getById(c.credentialID)?.label ?? c.credentialID)
        : "unauthenticated"
      if (c.redacted && c.values.length === 0) return `${label}=[redacted]`
      const vals = c.values
        .slice(0, 6)
        .map((v) => JSON.stringify(v))
        .join(", ")
      return `${label}=[${vals}]${c.redacted ? " (+redacted)" : ""}`
    })
    lines.push(`- ${p.name} (${p.loc}): ${parts.join("; ")}`)
  }
  return lines
}

// "METHOD scheme://host/path" from a raw HTTP request's request-line + Host header.
// Returns just the request line if no Host is present, or undefined if unparseable.
export function parseRequestTarget(rawRequest: string): string | undefined {
  const head = rawRequest.split(/\r?\n/)
  const requestLine = head[0]?.trim()
  if (!requestLine) return undefined
  const m = /^([A-Z]+)\s+(\S+)/.exec(requestLine)
  if (!m) return undefined
  const [, method, path] = m
  const hostLine = head.find((l) => /^host:/i.test(l))
  const host = hostLine ? hostLine.slice(hostLine.indexOf(":") + 1).trim() : ""
  return host ? `${method} ${host}${path.startsWith("/") ? path : "/" + path}` : `${method} ${path}`
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/, 1)[0]?.trim() ?? ""
  return line.length > 120 ? line.slice(0, 120) + "…" : line
}

function buildPromptWithCredentialContext(
  rawRequest: string,
  credentialID?: string,
  processedResponse?: string,
  accessContext?: AccessContextInput,
  operationContext?: { protocol: string; operation: string },
  observedValues?: Observation.EndpointTree,
): string {
  const lines: string[] = []

  // Protocol/operation banner — this request is a body-dispatched operation
  // (GraphQL/JSON-RPC), not a plain REST endpoint. Route protocol-aware tests
  // (e.g. GraphQL introspection/batching/field-authz; JSON-RPC method enum).
  if (operationContext) {
    lines.push(`## Operation`)
    lines.push(`- protocol: ${operationContext.protocol}`)
    lines.push(`- operation: ${operationContext.operation}`)
    lines.push("")
  }

  // The root ingest prompt is a DISPATCH BRIEF, not a full dump: the orchestrator only
  // needs enough to route this endpoint to the right specialist(s). The full raw request/
  // response + credential tokens are prepended to each specialist it dispatches (task.ts,
  // a separate path), so they are intentionally omitted here to keep the root transcript
  // readable. Kept: target URL, identity (label + role, not the token), a one-line
  // response status (routing signal: 200 vs 401 vs 403), and observed values (IDOR leads).

  // ## Target — method + URL parsed from the raw request line + Host header.
  const target = parseRequestTarget(rawRequest)
  if (target) {
    lines.push("## Target")
    lines.push(`${target}${operationContext ? ` (${operationContext.protocol} ${operationContext.operation})` : ""}`)
    lines.push("")
  }

  // ## Identity — who this request was captured as: role label + auth state. NOT the token.
  lines.push("## Identity")
  if (!credentialID) {
    lines.push("- UNAUTHENTICATED (no credential)")
  } else {
    const cred = WebCredential.getById(credentialID)
    if (!cred) {
      lines.push(`- credential ${credentialID} (NOT FOUND)`)
    } else {
      const role = cred.role_id ? WebRole.getById(cred.role_id) : undefined
      const authed = Object.keys(cred.headers).length > 0
      lines.push(`- ${cred.label}${role ? ` (role: ${role.name})` : ""} — ${authed ? "authenticated" : "no captured auth"}`)
    }
  }

  if (accessContext) {
    lines.push(...renderAccessContextLines(accessContext))
  }

  if (observedValues) {
    lines.push(...renderObservedValuesLines(observedValues))
  }

  // ## Response — one line: status + content-type. The full body goes to the specialist.
  const statusLine = processedResponse ? firstLine(processedResponse) : undefined
  if (statusLine) {
    lines.push("")
    lines.push(`## Response: ${statusLine}`)
  }

  lines.push("")
  lines.push("## Your job")
  lines.push(
    "Route this endpoint to the right specialist(s) and dispatch them. The full raw request/response and credential tokens are attached to each specialist — you do not need them here.",
  )

  return lines.join("\n")
}

// Heuristic for ingest payloads that don't carry an explicit scheme. Browser-
// agent supplies it; the legacy Firefox extension does not. We look at the
// request line (absolute-URI form), then fall back to the host port hint, then
// "https" as the safest default — most modern targets are HTTPS and treating
// http traffic as https only inflates the dedup space, never causes data loss.
function inferScheme(rawText: string): "http" | "https" {
  const firstLine = rawText.split(/\r?\n/, 1)[0] ?? ""
  if (/^[A-Z]+\s+https:\/\//.test(firstLine)) return "https"
  if (/^[A-Z]+\s+http:\/\//.test(firstLine)) return "http"
  // Look for a Host header with explicit port 80 (suggests http).
  const hostMatch = rawText.match(/^[Hh]ost:\s*[^\r\n]*?:80\b/m)
  if (hostMatch) return "http"
  return "https"
}

// Case-insensitive lookup over a header map (capture sources vary in header casing).
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const want = name.toLowerCase()
  for (const k in headers) if (k.toLowerCase() === want) return headers[k]
  return undefined
}

// Bridge between the ingest payload and Normalize.run. Returns null when the
// raw text isn't a parseable HTTP request (the route then falls through to
// the chat-style ingest path that handles plain text).
async function runNormalize(
  body: {
    text: string
    scheme?: "http" | "https"
    model?: { providerID: string; modelID: string }
  },
  sessionID: string,
  dryRun: boolean,
): Promise<Normalize.RunResult | null> {
  const scheme = body.scheme ?? inferScheme(body.text)
  const model = body.model ?? (await SessionPrompt.lastModel(sessionID))

  // Dry-run uses a no-op classifier so Tier 3 never reaches the LLM. Tier 1
  // still resolves the common cases; ambiguous segments fall back to literal.
  const client = dryRun
    ? {
        async classify() {
          return { decisions: [], model: "dry-run" }
        },
      }
    : undefined

  try {
    return await Normalize.run({
      sessionID,
      raw: body.text,
      scheme,
      providerID: model.providerID,
      modelID: model.modelID,
      client,
    })
  } catch (err) {
    // Malformed request line (e.g. plain chat text) — let the caller fall
    // through to the non-HTTP ingest branch.
    log.debug("normalize parse failed", { error: (err as Error).message })
    return null
  }
}

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all CyberStrike sessions, sorted by most recently updated.",
        operationId: "session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = SessionStatus.list()
        return c.json(result)
      },
    )
    .get(
      "/queue/status",
      describeRoute({
        summary: "Get ingest queue status",
        description:
          "Retrieve the current ingest-queue state for all sessions (paused flag and pending count). Sessions with no active queue are omitted.",
        operationId: "session.queueStatus",
        responses: {
          200: {
            description: "Queue status map keyed by sessionID",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionQueueStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = SessionQueueStatus.list()
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/hackbrowser/launch",
      describeRoute({
        summary: "Launch a hackbrowser crawl",
        description:
          "Start a hackbrowser crawl for a session from an interactive entry point (TUI slash, CLI subcommand). Same backend as the LLM-callable hackbrowser tool — agent invocation, slash, and CLI all share this surface. Returns a KickOffResult; captures stream into the session asynchronously.",
        operationId: "session.hackbrowserLaunch",
        responses: {
          200: {
            description: "Crawl successfully kicked off; returns sessionID + started flag + status message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessionID: z.string(),
                    started: z.boolean(),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          target: z.string().url(),
          credentials: z.array(z.string()).optional(),
          scope: z.array(z.string()).optional(),
          exclude: z.array(z.string()).optional(),
          steps: z.number().int().min(1).max(200).optional(),
          headless: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { launchHackbrowser } = await import("@/tool/hackbrowser-launcher")
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await launchHackbrowser({
          sessionID,
          target: body.target,
          credentials: body.credentials,
          scope: body.scope,
          exclude: body.exclude,
          steps: body.steps,
          headless: body.headless,
        })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/hackbrowser/stop",
      describeRoute({
        summary: "Stop the active hackbrowser run for a session",
        description:
          "Cancels an in-flight hackbrowser crawl. The agent finishes the current page's pending tasks (graceful exit), closes the browser, and transitions HackbrowserStatus to completed with whatever was captured so far. Returns false when no hackbrowser run is active for this session.",
        operationId: "session.hackbrowserStop",
        responses: {
          200: {
            description: "true when a run was cancelled, false when no active run",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const { stopHackbrowser } = await import("@/tool/hackbrowser-launcher")
        const stopped = stopHackbrowser(c.req.valid("param").sessionID)
        return c.json(stopped)
      },
    )
    .get(
      "/hackbrowser/status",
      describeRoute({
        summary: "Get hackbrowser status",
        description:
          "Retrieve the current hackbrowser run state for all sessions (phase, page/endpoint counters, errors). Used by the TUI sidebar bootstrap. Sessions with no hackbrowser run are omitted.",
        operationId: "session.hackbrowserStatus",
        responses: {
          200: {
            description: "Hackbrowser status map keyed by sessionID",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), HackbrowserStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = HackbrowserStatus.list()
        return c.json(result)
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific CyberStrike session.",
        tags: ["Session"],
        operationId: "session.get",
        responses: {
          200: {
            description: "Get session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.get.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "session.children",
        responses: {
          200: {
            description: "List of children",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.children(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/usage",
      describeRoute({
        summary: "Get session usage",
        tags: ["Session"],
        description:
          "Aggregate token and cost usage across the session and all its descendant subagents. Resolves the tree root, so the result is the same whether a parent or child session ID is passed.",
        operationId: "session.usage",
        responses: {
          200: {
            description: "Aggregated usage",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    rootID: z.string(),
                    totalCost: z.number(),
                    totalTokens: z.number(),
                    sessionCount: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.usage.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        return c.json(await Session.usage(sessionID))
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: {
              "application/json": {
                schema: resolver(Todo.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await Todo.get(sessionID)
        return c.json(todos)
      },
    )
    .get(
      "/:sessionID/vulnerability",
      describeRoute({
        summary: "Get session vulnerabilities",
        description: "Retrieve the list of vulnerabilities reported for a specific session.",
        operationId: "session.vulnerability",
        responses: {
          200: {
            description: "Vulnerability list",
            content: {
              "application/json": {
                schema: resolver(Vulnerability.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const list = Vulnerability.get(sessionID)
        return c.json(list)
      },
    )
    .get(
      "/:sessionID/request",
      describeRoute({
        summary: "Get session requests",
        description: "Retrieve the list of normalized HTTP requests tracked for a specific session.",
        operationId: "session.request",
        responses: {
          200: {
            description: "Request list",
            content: {
              "application/json": {
                schema: resolver(Request.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const list = Request.get(sessionID)
        return c.json(list)
      },
    )
    .get(
      "/:sessionID/observations",
      describeRoute({
        summary: "Get observed values for an endpoint",
        description:
          "Per-endpoint observed values (raw facts): which credential used which concrete values for each parameter. " +
          "Pulled on-demand when the UI expands an endpoint. Pass the endpoint's key_hash.",
        operationId: "session.observations",
        responses: {
          200: { description: "Observed-value tree", content: { "application/json": { schema: resolver(z.any()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator(
        "query",
        z.object({
          keyHash: z.string().optional().meta({ description: "Endpoint key_hash" }),
          id: z.string().optional().meta({ description: "Request id (alternative to keyHash)" }),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { keyHash, id } = c.req.valid("query")
        // Resolve the key_hash from a request id when keyHash isn't supplied (the web
        // client's stale SDK schema can strip key_hash from the request list).
        const kh = keyHash ?? (id ? Request.get(sessionID).find((r) => r.id === id)?.key_hash : undefined)
        if (!kh) return c.json({ keyHash: "", credentials: [], params: [] })
        return c.json(Observation.endpointTree(sessionID, kh))
      },
    )
    // Web Proxy Agent Context Endpoints
    .get(
      "/:sessionID/web/credentials",
      describeRoute({
        summary: "Get web credentials",
        description: "Retrieve the list of credentials for web security testing in this session.",
        operationId: "session.webCredentials",
        responses: {
          200: {
            description: "Credential list",
            content: {
              "application/json": {
                schema: resolver(WebCredential.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const list = WebCredential.get(sessionID)
        return c.json(list)
      },
    )
    .post(
      "/:sessionID/web/credentials",
      describeRoute({
        summary: "Add web credential",
        description: "Add a new credential for web security testing.",
        operationId: "session.addWebCredential",
        responses: {
          200: {
            description: "Created credential",
            content: {
              "application/json": {
                schema: resolver(WebCredential.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          label: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
          container_id: z.string().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const existed = !!WebCredential.getByLabel(sessionID, body.label) // reused (any casing) vs new
        const cred = WebCredential.ensure({
          sessionID,
          label: body.label,
          headers: body.headers,
          containerID: body.container_id,
        })
        return c.json({ ...cred, reused: existed })
      },
    )
    .post(
      "/:sessionID/web/observations",
      describeRoute({
        summary: "Ingest UI observations",
        description:
          "Record which credential could see which clickable elements on a page — the Faz B UI-affordance substrate for access-control (BFLA) reasoning. Called by the browser extension per page, per credential.",
        operationId: "session.addWebObservations",
        responses: {
          200: {
            description: "Count of newly recorded observations",
            content: {
              "application/json": {
                schema: resolver(z.object({ observed: z.number() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          credential_id: z.string().optional(),
          page_url: z.string(),
          elements: z.array(z.object({ role: z.string(), label: z.string() })),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        let observed = 0
        for (const el of body.elements) {
          const isNew = UiObservation.observe(sessionID, {
            credentialID: body.credential_id ?? null,
            pageUrl: body.page_url,
            role: el.role,
            label: el.label,
          })
          if (isNew) observed++
        }
        return c.json({ observed })
      },
    )
    .post(
      "/:sessionID/web/spawn-profile",
      describeRoute({
        summary: "Spawn a role browser profile",
        description:
          "The panel 'Add role' action: open a new Chrome profile (its own cookie jar) with the hackbrowser extension, tagged with a role and attached to this session, so a second/third identity can log in and feed access-control comparison. Local only — CyberStrike spawns the browser on its own host.",
        operationId: "session.spawnWebProfile",
        responses: {
          200: {
            description: "Profile spawned",
            content: {
              "application/json": {
                schema: resolver(z.object({ profileDir: z.string(), pid: z.number() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          role: z.string().optional().meta({ description: "Role/credential label; omitted = anonymous" }),
          roleName: z.string().optional().meta({ description: "Declared role tier name (User/Admin/…); optional" }),
          roleLevel: z.number().optional().meta({ description: "Declared role privilege level (ordering) for the tier" }),
          url: z.string().meta({ description: "URL to open the new profile at (usually the app origin)" }),
          headless: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        // Declared role tier: seed a web_role and PRE-CREATE the credential linked to it, keyed by
        // label. When the spawned browser later registers this label, WebCredential.ensure dedups by
        // label and keeps role_id — so the authz agent has the privilege ordering without waiting on
        // AI inference. Only when a label + a role name are both given.
        const roleName = body.roleName && body.roleName.trim()
        if (body.role && roleName) {
          await Session.get(sessionID) // 404 on a stale/bogus session before writing role/credential rows (which FK to it)
          const role = WebRole.add({ sessionID, name: roleName, level: body.roleLevel, discoveredFrom: "user" })
          WebCredential.ensure({ sessionID, label: body.role, roleID: role.id })
        }
        // Dynamic import mirrors the hackbrowser launch route — keeps the spawn code
        // (and its Chrome-path logic) out of server startup.
        const spawn = await import("@cyberstrike-io/hackbrowser/v2-spawn")
        try {
          const result = spawn.spawnProfile({
            url: body.url,
            cred: body.role,
            session: sessionID,
            headless: body.headless,
          })
          // Track the child so it can be closed with the assessment (the proc handle is
          // not serializable — return only the plain fields).
          SpawnedProfiles.track(sessionID, result.proc)
          return c.json({ profileDir: result.profileDir, pid: result.pid })
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
        }
      },
    )
    .get(
      "/:sessionID/web/spawned-count",
      describeRoute({
        summary: "Count spawned role browsers",
        description: "How many spawned role browsers are still tracked for this session — the branded panel uses it to decide whether to confirm closing them on detach.",
        operationId: "session.spawnedProfileCount",
        responses: {
          200: {
            description: "Count",
            content: { "application/json": { schema: resolver(z.object({ count: z.number() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => c.json({ count: SpawnedProfiles.count(c.req.valid("param").sessionID) }),
    )
    .post(
      "/:sessionID/web/close-profiles",
      describeRoute({
        summary: "Close spawned role browsers",
        description:
          "Close every browser profile CyberStrike spawned for this session (the 'Add credential' role browsers). A short delay first lets their last captures flush. Returns how many were closed.",
        operationId: "session.closeWebProfiles",
        responses: {
          200: {
            description: "Count closed",
            content: { "application/json": { schema: resolver(z.object({ closed: z.number() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        // Flush window: let the spawned browsers' in-flight captures land before we kill.
        await new Promise((r) => setTimeout(r, 800))
        return c.json({ closed: SpawnedProfiles.closeAll(sessionID) })
      },
    )
    .post(
      "/:sessionID/web/role-queue",
      describeRoute({
        summary: "Enqueue setup roles",
        description:
          "Add roles to this session's sequential setup queue (dedup by label). Fed by the TUI menu (a list) and the panel 'Add credential' (one at a time). Roles spawn one at a time as each prior role's capture starts.",
        operationId: "session.enqueueRoles",
        responses: {
          200: { description: "Queue status", content: { "application/json": { schema: resolver(QueueStatusSchema) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("json", z.object({ roles: z.array(z.string()) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        RoleQueue.enqueue(sessionID, c.req.valid("json").roles)
        return c.json(RoleQueue.status(sessionID))
      },
    )
    .get(
      "/:sessionID/web/queue-status",
      describeRoute({
        summary: "Role setup queue status",
        description: "The sequential-setup queue for this session — the orchestrator (first) browser polls it to show 'spawning <role>…' / 'please sign in as <role>'.",
        operationId: "session.queueStatus",
        responses: {
          200: { description: "Queue status", content: { "application/json": { schema: resolver(QueueStatusSchema) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => c.json(RoleQueue.status(c.req.valid("param").sessionID)),
    )
    .post(
      "/:sessionID/web/capture-started",
      describeRoute({
        summary: "Signal a role's capture started",
        description:
          "A browser pressed Start capture for `role`. Advances the queue and, if a next role is pending, spawns its browser on the shared session at `url`. Returns the next role's label (now being set up) or null.",
        operationId: "session.captureStarted",
        responses: {
          200: {
            description: "Next role spawned (or none)",
            content: {
              "application/json": {
                schema: resolver(z.object({ next: z.string().nullable(), spawned: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("json", z.object({ role: z.string(), url: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const next = RoleQueue.captureStarted(sessionID, body.role)
        if (!next) return c.json({ next: null, spawned: false })
        // Spawn the next role's browser on the shared session at the same URL.
        try {
          const spawn = await import("@cyberstrike-io/hackbrowser/v2-spawn")
          const result = spawn.spawnProfile({ url: body.url, cred: next.label, session: sessionID })
          SpawnedProfiles.track(sessionID, result.proc)
          RoleQueue.spawned(sessionID, next.label)
          return c.json({ next: next.label, spawned: true })
        } catch (e) {
          // Queue already advanced (next is "spawning"); report the failure so the panel
          // can surface it rather than silently stalling.
          return c.json({ next: next.label, spawned: false, error: e instanceof Error ? e.message : String(e) }, 500)
        }
      },
    )
    .post(
      "/:sessionID/web/observe",
      describeRoute({
        summary: "Store a page observation",
        description:
          "The extension posts the current page's clickables/forms/links. Feeds the get_page_state store (annotated with semantic kind) and, when credential_id is present, the per-credential UI-affordance store (Faz B).",
        operationId: "session.webObserve",
        responses: {
          200: {
            description: "Kind counts",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean(), kinds: z.record(z.string(), z.number()) })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator(
        "json",
        z.object({
          url: z.string(),
          title: z.string().optional(),
          driver: z.enum(["ai", "human"]).optional(),
          credential_id: z.string().optional(),
          clickables: z.array(
            z.object({
              id: z.string(),
              tag: z.string(),
              role: z.string(),
              label: z.string(),
              href: z.string(),
              // rich observation (extension 2.0) — optional; zod strips unknown keys, so any
              // field the AI should keep MUST be declared here.
              why: z.string().optional(),
              aria: z.record(z.string(), z.string()).optional(),
              disabled: z.boolean().optional(),
              in_viewport: z.boolean().optional(),
              in_modal: z.boolean().optional(),
              section: z.string().optional(),
              testid: z.string().optional(),
              shadow: z.boolean().optional(),
              frame: z.string().optional(),
            }),
          ),
          forms: z
            .array(
              z.object({
                action: z.string(),
                method: z.string(),
                fields: z.array(z.object({ id: z.string().optional(), name: z.string(), type: z.string(), required: z.boolean() })),
                submit_id: z.string().optional(),
                in_modal: z.boolean().optional(),
              }),
            )
            .optional(),
          links: z.array(z.string()).optional(),
          // rich page context
          description: z.string().optional(),
          location: z.array(z.string()).optional(),
          landmarks: z.array(z.object({ role: z.string(), label: z.string() })).optional(),
          frames: z.array(z.object({ src: z.string(), same_origin: z.boolean(), title: z.string() })).optional(),
          canvas: z.number().optional(),
          dynamic: z.boolean().optional(),
          // Framework fingerprint signals (P2) — raw markers the extension gathered; the server
          // runs FrameworkFingerprinter.detect over them into a TechStack.
          tech: z
            .object({
              globals: z.array(z.string()).optional(),
              dom: z.array(z.string()).optional(),
              cookies: z.array(z.string()).optional(),
              meta: z.string().optional(),
              scripts: z.array(z.string()).optional(),
              headers: z.record(z.string(), z.string()).optional(),
            })
            .optional(),
          // Absolute <script src> bundle URLs (JS-first discovery) — the miner fetches + parses these.
          js_bundles: z.array(z.string()).optional(),
          // A modal dialog is trapping interaction — the navigator restricts itself to in_modal controls.
          modal_open: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const b = c.req.valid("json")
        const kinds = PageState.set(sessionID, {
          url: b.url,
          title: b.title ?? "",
          clickables: b.clickables,
          forms: b.forms ?? [],
          links: b.links ?? [],
          driver: b.driver,
          credential: b.credential_id,
          description: b.description,
          location: b.location,
          landmarks: b.landmarks,
          frames: b.frames,
          canvas: b.canvas,
          dynamic: b.dynamic,
          tech: b.tech ? FrameworkFingerprinter.detect(b.tech) : undefined,
          modal_open: b.modal_open,
          observed_at: Date.now(),
        })
        if (b.credential_id) {
          for (const el of b.clickables) {
            if (el.label)
              UiObservation.observe(sessionID, { credentialID: b.credential_id, pageUrl: b.url, role: el.role, label: el.label })
          }
        }
        // JS-first discovery: the extension enumerates every <script src> (absolute URL) on the page
        // — including app-shell bundles loaded BEFORE capture started, the biggest source of missed
        // endpoints. (NOTE: tech.scripts is a fingerprint-keyword list, NOT bundle URLs — js_bundles
        // is the real source.) Feed the in-scope ones to the miner and wake it: it fetches them
        // credentialed, follows chunk references recursively, extracts API endpoints, and those flow
        // to the API-direct fast lane. Deterministic — no longer gated on the LLM navigator.
        const bundles = (b.js_bundles ?? []).filter((u) => WebScope.allowed(sessionID, u))
        if (bundles.length > 0 && DataCollector.addJsUrls(sessionID, bundles) > 0) {
          // Persist to web_js for visibility (the sidebar + DB) — discovered from the DOM, not a
          // captured network request.
          for (const u of bundles) {
            try {
              WebJs.add({ sessionID, url: u, origin: new URL(u).origin, discoveredFrom: "script-src" })
              vortexDiscoverJs(sessionID, u) // mirror into Vortex — the single source the Captures view reads
            } catch {}
          }
          JsMiner.wake(sessionID)
        }
        HBLog.record(sessionID, "server", "observe", { url: b.url, clickables: b.clickables.length, forms: (b.forms ?? []).length })
        return c.json({ ok: true, kinds })
      },
    )
    .get(
      "/:sessionID/web/page-state",
      describeRoute({
        summary: "Get page state (get_page_state substrate)",
        description:
          "The current page's clickables (each annotated with semantic kind + action policy), forms and links — what the AI reads to pick its next action. Omit url to list observed urls; view filters clickables to one kind.",
        operationId: "session.webPageState",
        responses: {
          200: { description: "Page state", content: { "application/json": { schema: resolver(z.any()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator(
        "query",
        z.object({
          url: z.string().optional(),
          view: z.enum(["destructive", "logout", "auth", "mutating", "query", "nav", "other"]).optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const q = c.req.valid("query")
        if (!q.url) return c.json({ urls: PageState.urls(sessionID) })
        const st = PageState.get(sessionID, q.url, q.view)
        if (!st) return c.json({ error: "no page-state for this url" }, 404)
        return c.json(st)
      },
    )
    .post(
      "/:sessionID/web/action",
      describeRoute({
        summary: "Perform a guarded browser action",
        description:
          "click / type / navigate, relayed to the extension over the control WS. guard.ts is enforced HERE: a logout element is denied (403), a destructive one needs human confirmation (409). The AI's hands.",
        operationId: "session.webAction",
        responses: {
          200: {
            description: "Action ack",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), policy: z.string().optional(), error: z.string().optional() })),
              },
            },
          },
          ...errors(400, 403, 404, 409),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator(
        "json",
        z.object({
          op: z.enum(["click", "type", "navigate"]),
          url: z.string().optional(),
          element_id: z.string().optional(),
          text: z.string().optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const b = c.req.valid("json")
        const relay = (ack: { ok: boolean; error?: string }, policy?: string) => {
          if (ack.ok) return c.json({ ok: true, policy })
          const status = ack.error === "no-extension" ? 503 : ack.error === "timeout" ? 504 : 502
          return c.json({ ok: false, error: ack.error ?? "relay failed" }, status)
        }
        if (b.op === "navigate") {
          if (!b.url) return c.json({ ok: false, error: "url required" }, 400)
          return relay(await WebControl.send(sessionID, { op: "navigate", url: b.url }))
        }
        if (!b.url || !b.element_id) return c.json({ ok: false, error: "url and element_id required" }, 400)
        const pol = PageState.elementPolicy(sessionID, b.url, b.element_id)
        if (!pol) return c.json({ ok: false, error: "unknown element / no page-state for url" }, 404)
        if (pol.policy === "deny")
          return c.json({ ok: false, policy: "deny", kind: pol.kind, label: pol.label, error: "denied by guard (logout)" }, 403)
        if (pol.policy === "confirm")
          return c.json({ ok: false, policy: "confirm", kind: pol.kind, label: pol.label, error: "human confirmation required" }, 409)
        return relay(await WebControl.send(sessionID, { op: b.op, elementId: b.element_id, text: b.text }), pol.policy)
      },
    )
    .get(
      "/:sessionID/web/control",
      describeRoute({
        summary: "Browser control channel (WebSocket)",
        description:
          "The extension upgrades here to receive click/type/navigate commands from /web/action and ack them. One socket per session.",
        operationId: "session.webControl",
        responses: { ...errors(404) },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      upgradeWebSocket((c) => {
        const sessionID = c.req.param("sessionID")
        return {
          onOpen(_e, ws) {
            HBLog.record(sessionID, "server", "control-connected") // the extension's control WS is up
            WebControl.connect(sessionID, { send: (d) => ws.send(d) })
          },
          onMessage(event) {
            WebControl.onAck(String(event.data))
          },
          onClose() {
            HBLog.record(sessionID, "server", "control-closed")
            WebControl.disconnect(sessionID)
          },
        }
      }),
    )
    .post(
      "/:sessionID/web/driver",
      describeRoute({
        summary: "Set the browser driver (AI / Human)",
        description:
          "The panel's AI/Human toggle reports here so CyberStrike knows who is driving. Human mode blocks web_action (interlock); AI mode is what will start the co-driving loop. The extension POSTs on toggle and on control-WS connect.",
        operationId: "session.webSetDriver",
        responses: {
          200: {
            description: "Current driver",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean(), driver: z.enum(["ai", "human"]), model: z.string().optional() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("json", z.object({ driver: z.enum(["ai", "human"]) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const driver = c.req.valid("json").driver
        HBLog.record(sessionID, "server", "driver", { driver }) // extension reached the server + who drives
        WebDriver.set(sessionID, driver)
        // AI mode drives the browser; Human mode stops the loop (the interlock also blocks
        // any in-flight action). Idempotent — repeated "ai" posts don't stack loops.
        if (driver === "ai") CoDrive.start(sessionID)
        else CoDrive.stop(sessionID)
        // Report the MAIN model the co-driving loop will plan with, so the panel can confirm the
        // AI is actually wired up (and to which model) rather than leaving the user guessing.
        let model: string | undefined
        try {
          model = (await Provider.defaultModel()).modelID
        } catch {}
        return c.json({ ok: true, driver, model })
      },
    )
    .get(
      "/:sessionID/web/driver",
      describeRoute({
        summary: "Get the browser driver (AI / Human)",
        description: "The current driver for the session, or null if the panel has not reported one yet.",
        operationId: "session.webGetDriver",
        responses: {
          200: {
            description: "Current driver",
            content: { "application/json": { schema: resolver(z.object({ driver: z.enum(["ai", "human"]).nullable() })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        return c.json({ driver: WebDriver.get(sessionID) ?? null })
      },
    )
    .get(
      "/:sessionID/web/stats",
      describeRoute({
        summary: "Web capture stats for the panel HUD",
        description:
          "Live capture-coverage counts for the on-page panel/HUD, read from the durable store (request / endpoint_template tables + confirmed vulnerabilities) so they match the analysis + TUI and read 0 for a fresh session: captured requests, distinct endpoints, distinct pages, confirmed vulnerabilities.",
        operationId: "session.webStats",
        responses: {
          200: {
            description: "Capture counts",
            content: {
              "application/json": {
                schema: resolver(z.object({ captures: z.number(), endpoints: z.number(), pages: z.number(), vulns: z.number() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => {
        return c.json(WebStats.summary(c.req.valid("param").sessionID))
      },
    )
    .get(
      "/:sessionID/web/js",
      describeRoute({
        summary: "List captured JS files",
        description:
          "The JS files (script URLs) seen during capture for this session, persisted durably — the TUI 'Captures > JS Files' view lists them and a later agent pulls + reviews each body.",
        operationId: "session.webJs",
        responses: {
          200: {
            description: "JS files",
            content: { "application/json": { schema: resolver(WebJs.Info.array()) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      async (c) => {
        return c.json(WebJs.get(c.req.valid("param").sessionID))
      },
    )
    .post(
      "/:sessionID/web/hold",
      describeRoute({
        summary: "Pause / resume the AI navigator (transient)",
        description:
          "While the user engages the on-page panel, the extension holds the co-driving loop so a full-page navigation doesn't wipe the panel out from under them. Distinct from the AI/Human driver toggle — the driver stays 'ai'; this only pauses navigation until released.",
        operationId: "session.webSetHold",
        responses: {
          200: {
            description: "Hold state",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean(), held: z.boolean() })) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("json", z.object({ held: z.boolean() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const held = c.req.valid("json").held
        WebHold.set(sessionID, held)
        return c.json({ ok: true, held })
      },
    )
    .post(
      "/:sessionID/web/log",
      describeRoute({
        summary: "Record a HackBrowser diagnostic event",
        description:
          "The extension posts its own lifecycle events (content mounted, control WS open, perform relayed, attach) into the per-session diagnostic trail. Absence of extension events is itself diagnostic.",
        operationId: "session.webLog",
        responses: { 200: { description: "Recorded", content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("json", z.object({ source: z.string().optional(), event: z.string(), data: z.unknown().optional() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const b = c.req.valid("json")
        HBLog.record(sessionID, b.source ?? "extension", b.event, b.data)
        return c.json({ ok: true })
      },
    )
    .get(
      "/:sessionID/web/log",
      describeRoute({
        summary: "Read the HackBrowser diagnostic trail",
        description: "The per-session cross-layer event trail (server + extension) plus the on-disk JSONL file path.",
        operationId: "session.webLogRead",
        responses: { 200: { description: "Events", content: { "application/json": { schema: resolver(z.any()) } } }, ...errors(404) },
      }),
      validator("param", z.object({ sessionID: z.string().meta({ description: "Session ID" }) })),
      validator("query", z.object({ limit: z.coerce.number().optional() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        return c.json({ file: HBLog.file(sessionID), entries: HBLog.entries(sessionID, c.req.valid("query").limit ?? 1000) })
      },
    )
    .delete(
      "/:sessionID/web/credentials/:credentialID",
      describeRoute({
        summary: "Delete web credential",
        description: "Delete a credential from the session.",
        operationId: "session.deleteWebCredential",
        responses: {
          200: {
            description: "Successfully deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          credentialID: z.string().meta({ description: "Credential ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        WebCredential.remove(params.credentialID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/web/credentials/:credentialID",
      describeRoute({
        summary: "Update web credential",
        description: "Update a credential's value, label, or role. Used for token refresh.",
        operationId: "session.updateWebCredential",
        responses: {
          200: {
            description: "Updated credential",
            content: {
              "application/json": {
                schema: resolver(WebCredential.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          credentialID: z.string().meta({ description: "Credential ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          headers: z.record(z.string(), z.string()).optional().meta({ description: "Auth headers" }),
          label: z.string().optional().meta({ description: "New label" }),
          container_id: z.string().optional().meta({ description: "Container ID" }),
          role_id: z.string().optional().meta({ description: "Role ID to link" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const updated = WebCredential.update({
            id: params.credentialID,
            sessionID: params.sessionID,
            // Manual API update has no host context → wildcard "*" (applies on every host).
            headers: body.headers ? { "*": body.headers } : undefined,
            label: body.label,
            containerID: body.container_id,
            roleID: body.role_id,
          })
          if (!updated) {
            c.status(404)
            return c.json({ error: "Credential not found" })
          }
          return c.json(updated)
        } catch (err) {
          c.status(403)
          return c.json({ error: (err as Error).message })
        }
      },
    )
    .get(
      "/:sessionID/web/roles",
      describeRoute({
        summary: "Get web roles",
        description: "Retrieve discovered roles for web security testing.",
        operationId: "session.webRoles",
        responses: {
          200: {
            description: "Role list",
            content: {
              "application/json": {
                schema: resolver(WebRole.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const list = WebRole.get(c.req.valid("param").sessionID)
        return c.json(list)
      },
    )
    .get(
      "/:sessionID/web/objects",
      describeRoute({
        summary: "Get web objects",
        description: "Retrieve discovered data objects for web security testing.",
        operationId: "session.webObjects",
        responses: {
          200: {
            description: "Object list",
            content: {
              "application/json": {
                schema: resolver(WebObject.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const list = WebObject.get(c.req.valid("param").sessionID)
        return c.json(list)
      },
    )
    .get(
      "/:sessionID/web/functions",
      describeRoute({
        summary: "Get web functions",
        description: "Retrieve discovered endpoint functions for web security testing.",
        operationId: "session.webFunctions",
        responses: {
          200: {
            description: "Function list",
            content: {
              "application/json": {
                schema: resolver(WebFunction.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const list = WebFunction.get(c.req.valid("param").sessionID)
        return c.json(list)
      },
    )
    .get(
      "/:sessionID/vortex",
      describeRoute({
        summary: "Vortex report",
        description: "Run the Vortex engine over the session's live web corpus and return leads + counts.",
        operationId: "session.vortexReport",
        responses: { 200: { description: "Vortex report" } },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => c.json(vortexReport(c.req.valid("param").sessionID)),
    )
    .post(
      "/:sessionID/vortex/probe",
      describeRoute({
        summary: "Vortex active probe",
        description:
          "Actively probe the session's enumerated injection points (sends payloads to the target). No-op unless CYBERSTRIKE_VORTEX_ACTIVE_PROBE is set; governed + replay-safe. Returns probed/signal counts.",
        operationId: "session.vortexProbe",
        responses: { 200: { description: "Vortex active-probe result" } },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => c.json(await vortexProbe(c.req.valid("param").sessionID)),
    )
    .get(
      "/:sessionID/vortex/captures",
      describeRoute({
        summary: "Vortex captures",
        description:
          "The captured surface sourced from the session's Vortex store (the single source of truth the TUI Captures view reads): requests (transactions) + discovered JS files. Pages are derived from each request's pageUrl.",
        operationId: "session.vortexCaptures",
        responses: { 200: { description: "Vortex-sourced captures" } },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => c.json(vortexCaptures(c.req.valid("param").sessionID)),
    )
    .get(
      "/:sessionID/vortex/signals",
      describeRoute({
        summary: "Vortex signals",
        description:
          "Every deterministic signal Vortex produced for this session (passive rules + active probe), with its owning WSTG class, whether it auto-routed into the retest pipeline, and its endpoint's retest-queue status — the source for the TUI 'Vortex Signals' view (issue #14).",
        operationId: "session.vortexSignals",
        responses: { 200: { description: "Vortex-sourced signals + routing status" } },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => c.json(vortexSignals(c.req.valid("param").sessionID)),
    )
    .get(
      "/:sessionID/web/retest-queue",
      describeRoute({
        summary: "Get web retest queue",
        description: "Retrieve pending retests triggered by new discoveries.",
        operationId: "session.webRetestQueue",
        responses: {
          200: {
            description: "Retest queue",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    pending: z.array(WebRetest.Info),
                    counts: z.object({
                      pending: z.number(),
                      examined: z.number(),
                    }),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const pending = WebRetest.getPending(sessionID)
        const counts = WebRetest.count(sessionID)
        return c.json({ pending, counts })
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new CyberStrike session for interacting with AI assistants and managing conversations.",
        operationId: "session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const session = await Session.create(body)
        return c.json(session)
      },
    )
    .post(
      "/ingest",
      describeRoute({
        summary: "Ingest message",
        description:
          "Send a message as if from user input (e.g. from another port or service). Creates a new session if sessionID is missing or invalid. AI response streams into the same session and appears in TUI chat.",
        operationId: "session.ingest",
        responses: {
          202: {
            description: "Message accepted",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessionID: z
                      .string()
                      .meta({ description: "Session id (new or existing); use for follow-up ingest requests" }),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          text: z.string().min(1).meta({ description: "Message text (treated as user input)" }),
          sessionID: z
            .string()
            .optional()
            .meta({ description: "Existing session id; omit or leave invalid to create a new session" }),
          agent: z.string().optional().meta({ description: "Agent to use (default if omitted)" }),
          model: z
            .object({
              providerID: z.string(),
              modelID: z.string(),
            })
            .optional()
            .meta({ description: "Model to use (optional)" }),
          credential_id: z.string().optional().meta({ description: "Existing credential ID to use for this request" }),
          credential: z
            .object({
              label: z.string(),
              headers: z.record(z.string(), z.string()).optional(),
              container_id: z.string().optional(),
            })
            .optional()
            .meta({ description: "New credential to register with this request" }),
          response: z
            .object({
              status: z.number().meta({ description: "HTTP status code" }),
              headers: z.record(z.string(), z.string()).meta({ description: "Response headers" }),
              body: z.string().meta({ description: "Response body" }),
            })
            .optional()
            .meta({ description: "HTTP response data" }),
          // Hackbrowser enrichment fields (optional — not sent by Firefox extension)
          trigger_element: z
            .string()
            .optional()
            .meta({ description: "UI element that triggered this request (role:label)" }),
          element_roles: z.array(z.string()).optional().meta({ description: "Roles that can see the trigger element" }),
          ui_context: z
            .record(z.string(), z.unknown())
            .optional()
            .meta({ description: "UI form context at request time" }),
          page_url: z.string().optional().meta({ description: "Page being explored when request was captured" }),
          page_visited_by: z.array(z.string()).optional().meta({ description: "Roles that can visit this page" }),
          scheme: z
            .enum(["http", "https"])
            .optional()
            .meta({ description: "URL scheme of the captured request; inferred from Host header / port when omitted" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        let sessionID = body.sessionID
        if (sessionID) {
          try {
            await Session.get(sessionID)
          } catch {
            sessionID = undefined
          }
        }
        if (!sessionID) {
          const session = await Session.create({})
          sessionID = session.id
        }

        // Ensure the retest worker is subscribed for this instance — it drains the scenario
        // queue in parallel as flags accrue (idempotent; safe to call on every ingest).
        RetestWorker.start()
        // Wake the API-direct fast lane: it debounces a burst of ingests into one sweep that
        // deterministically probes newly-captured endpoints (safe methods only), so a signal
        // queues a specialist retest without an LLM sub-agent per endpoint. Idempotent.
        ApiProbe.wake(sessionID)

        // Handle credential registration
        let credentialID = body.credential_id
        if (body.credential && !credentialID) {
          const cred = WebCredential.ensure({
            sessionID,
            label: body.credential.label,
            headers: body.credential.headers,
            containerID: body.credential.container_id,
          })
          credentialID = cred.id
          log.info("credential registered", { sessionID, credentialID, label: body.credential.label })
        }

        const ingestDryRun = process.env.CYBERSTRIKE_INGEST_DRY_RUN === "true"
        const normalized = await runNormalize(body, sessionID, ingestDryRun)

        if (normalized) {
          // Deterministic scope gate — DROP out-of-scope third-party hosts (analytics,
          // CDNs, OAuth/SSO providers, map/telemetry and other SaaS APIs the app merely
          // calls) right here, so sub-agents never see them and never spend a
          // per-endpoint scope_check on traffic that isn't the target.
          // The target's registrable domain is a wildcard (*.target), established once
          // (first-write-wins) from the page the operator is actually on; an explicit
          // launch scope, if already set, wins. No-op until a target is known, so we
          // never drop when scope is unresolved.
          if (body.page_url) WebScope.ensure(sessionID, body.page_url)
          if (!WebScope.allowed(sessionID, normalized.origin)) {
            log.debug("ingest: dropped out-of-scope request", { origin: normalized.origin, sessionID })
            return c.json({ sessionID, skipped: true })
          }

          // Lift this request's own auth (Cookie/Authorization/…) onto the capturing
          // credential, so a spawn-profile / "Add role" credential (a label-only
          // placeholder) fills in the replayable auth its profile actually used —
          // otherwise cross-credential replay as org1/org2 (IDOR/BFLA) has nothing to
          // inject and the authz/idor agents correctly report they cannot test as that
          // identity. Runs on every ingest (dedup skips included) and keys off the live
          // ingest credential_id, not the template-deduped row. Never throws — a
          // credential-fill failure must not drop the capture.
          if (credentialID && body.text) {
            try {
              const firstAuth = WebCredential.captureAuthFromRaw({ sessionID, credentialID, rawRequest: body.text })
              if (firstAuth) {
                log.info("new authenticated identity — queuing cross-credential retests", { sessionID, credentialID })
                // A new authenticated identity just became replayable. Re-test the endpoints
                // already captured (by anonymous / other roles) AS this identity, so
                // cross-credential access-control testing (org1 vs org2 tenant isolation,
                // BFLA) is queued the moment the role authenticates. TARGETED: only real app
                // endpoints (skip static assets — a bundle/image has no access-control surface),
                // so a new credential no longer floods the queue with one retest per JS/CSS/image.
                WebRetest.flagMatching({
                  sessionID,
                  type: "credential",
                  value: credentialID,
                  priority: "high",
                  match: WebRetest.isAccessControlSurface,
                })
              }
            } catch (err) {
              log.warn("failed to capture credential auth from request", { error: (err as Error).message })
            }
          }

          // Collect EVERY captured request into the per-session data view (decoupled from what the
          // AI navigated) — the traffic substrate for the navigator's route context + the
          // server-side framework fingerprint (P4). Runs before the dedup check so duplicates and
          // race-losers still count. Never throws.
          const collectedKind = DataCollector.record(sessionID, {
            method: normalized.method,
            origin: normalized.origin,
            path: normalized.canonicalPath ?? normalized.normalizedPath,
            status: body.response?.status,
            contentType: headerValue(body.response?.headers, "content-type"),
            headers: body.response?.headers,
          })
          // JS never becomes a request row, so persist script URLs durably (dedup by url) for the
          // panel/TUI + a later body-analysis agent.
          if (collectedKind === "js") {
            const jsUrl = normalized.origin + (normalized.canonicalPath ?? normalized.normalizedPath)
            WebJs.add({ sessionID, url: jsUrl, origin: normalized.origin, discoveredFrom: "capture" })
            vortexDiscoverJs(sessionID, jsUrl) // mirror into Vortex — the single source the Captures view reads
            JsMiner.wake(sessionID) // a captured JS bundle → mine it (debounced, recursive)
          }

          const isDuplicate = Request.exists({
            sessionID,
            method: normalized.method,
            normalizedPath: normalized.normalizedPath,
            origin: normalized.origin,
            bodyHash: normalized.bodyHash,
            queryHash: normalized.queryKeyHash,
            opKeyHash: normalized.opKeyHash,
            keyHash: normalized.keyHash,
          })

          // Record per-credential observed values on EVERY ingest — including
          // dedup skips, because the whole point is capturing which values which
          // credential used on an already-known endpoint (IDOR/BFLA substrate).
          // Append-only + idempotent, so safe to call on every path.
          const recordObservation = (requestID?: string) =>
            Observation.observe({
              sessionID,
              keyHash: normalized.keyHash,
              opGroupHash: normalized.opGroupHash,
              requestID,
              credentialID,
              valueHash: normalized.valueHash,
              slots: normalized.observedParams,
            })

          // Deterministic signal fabric (plan §07). Scan the RAW response body — BEFORE
          // Request.add/processResponse stubs an HTML body (closes B1) — for cross-cutting
          // evidence (error/path disclosure, headers, banners) and stored-canary reflection,
          // persisting each as a routed signal. On a duplicate/race the shape's canonical
          // request id keeps per-shape dedup; a missing id (no row yet) simply skips. Never throws.
          const runFabric = (requestID: string | undefined) => {
            if (!requestID) return
            scanCapturedResponse({
              sessionID,
              requestId: requestID,
              method: normalized.method,
              url: normalized.origin + (normalized.canonicalPath ?? normalized.normalizedPath),
              response: body.response,
            })
          }

          // Slice 0 (three-surface plan, docs/three-surface-architecture.md): feed EVERY meaningful
          // hit to Vortex — not only the first of each endpoint shape — so Vortex holds the full
          // traffic. The same endpoint seen under different identities/values is the cross-identity /
          // IDOR substrate Vortex's rules need; before this it only ever saw the first hit per shape.
          // The duplicate branches call this ONLY when the observation was new (a fresh
          // key_hash × credential × value combo), so literal repeats add no ingest work.
          const feedVortex = (requestID: string) =>
            ingestBrowserTransaction({
              sessionID,
              requestID,
              method: normalized.method,
              url: normalized.origin + (normalized.canonicalPath ?? normalized.normalizedPath),
              host: normalized.host,
              identity: credentialID,
              pageUrl: body.page_url,
              normalizedPath: normalized.normalizedPath,
              keyHash: normalized.keyHash,
              rawRequest: truncateRawRequest(body.text),
              response: body.response,
            })

          if (isDuplicate) {
            const newObs = recordObservation()
            runFabric(Request.findId(sessionID, normalized.keyHash))
            // A repeat of a known endpoint SHAPE, but a new identity/value combo → still new
            // cross-identity substrate for Vortex; feed it (fresh tx id, no CS row needed). A truly
            // identical repeat (newObs === false) is skipped.
            if (newObs) feedVortex(Identifier.ascending("request"))
            log.info("duplicate request skipped", {
              sessionID,
              method: normalized.method,
              path: normalized.normalizedPath,
            })
            c.status(202)
            return c.json({ sessionID, skipped: true })
          }

          const truncatedRawRequest = truncateRawRequest(body.text)

          const req = Request.add({
            sessionID,
            method: normalized.method,
            normalizedPath: normalized.normalizedPath,
            credentialID,
            rawRequest: truncatedRawRequest,
            bodyHash: normalized.bodyHash,
            queryHash: normalized.queryKeyHash,
            response: body.response,
            triggerElement: body.trigger_element,
            elementRoles: body.element_roles,
            uiContext: body.ui_context as Record<string, unknown> | undefined,
            pageUrl: body.page_url,
            pageVisitedBy: body.page_visited_by,
            scheme: normalized.scheme,
            host: normalized.host,
            port: normalized.port,
            origin: normalized.origin,
            site: normalized.site,
            canonicalPath: normalized.canonicalPath,
            templateID: normalized.templateId,
            normSource: normalized.normSource,
            protocol: normalized.protocol,
            operation: normalized.operation,
            opKeyHash: normalized.opKeyHash,
            keyHash: normalized.keyHash,
          })

          // Race-duplicate: a concurrent ingest won the atomic key_hash upsert
          // between our exists() check and this insert. Treat exactly like a
          // duplicate — no row was created, so skip the LLM enqueue, but still
          // record the observation (the values are evidence regardless).
          if (!req) {
            const newObs = recordObservation()
            runFabric(Request.findId(sessionID, normalized.keyHash))
            if (newObs) feedVortex(Identifier.ascending("request"))
            c.status(202)
            return c.json({ sessionID, skipped: true })
          }

          // New endpoint shape: record the first observation, linked to the row.
          recordObservation(req.id)
          runFabric(req.id)

          // Vortex feed for a new endpoint shape (uses the real CS request id). Duplicate branches
          // feed too (slice 0) via feedVortex, so Vortex holds the full traffic. Never throws.
          feedVortex(req.id)

          // Build the prompt as a thunk so the `## Observed Values` block reflects the
          // observation state at SEND time, not at enqueue time. Prompts queue (LLM calls
          // are slow) and other per-credential requests to the SAME endpoint accrue
          // observations while a prompt waits — rendering at dequeue captures them (e.g. a
          // second credential's values land in the prompt instead of being missed).
          const buildPrompt = () => {
            // Prepend app-wide coverage already recorded for this origin so the
            // orchestrator skips re-dispatching deployment-wide testers (JWT/TLS/headers).
            // Rendered at dequeue, so it reflects coverage that accrued while queued.
            const coverage = CoverageNote.wideBlock(sessionID, normalized.origin)
            const base = buildPromptWithCredentialContext(
              truncatedRawRequest,
              credentialID,
              req.processed_response,
              {
                triggerElement: body.trigger_element,
                elementRoles: body.element_roles,
                pageUrl: body.page_url,
                pageVisitedBy: body.page_visited_by,
                uiContext: body.ui_context as Record<string, unknown> | undefined,
              },
              normalized.protocol && normalized.operation
                ? { protocol: normalized.protocol, operation: normalized.operation }
                : undefined,
              Observation.endpointTree(sessionID, normalized.keyHash),
            )
            return coverage ? `${coverage}\n\n${base}` : base
          }

          if (ingestDryRun) {
            // Log the prompt that would be sent to LLM — skip actual LLM call
            log.info("ingest dry-run", {
              sessionID,
              method: normalized.method,
              path: normalized.normalizedPath,
              requestId: req.id,
            })
            log.info("prompt preview:\n" + buildPrompt())
            Request.updateStatus({ id: req.id, status: "processed" })
          } else {
            const agentName = body.agent ?? "hunt-agent"
            const source = `${normalized.method} ${normalized.normalizedPath}`
            IngestQueue.enqueue(sessionID, async () => {
              Request.updateStatus({ id: req.id, status: "processing" })
              const before = IngestSummary.snapshot(sessionID)
              // Render at dequeue (send time) so `## Observed Values` includes observations
              // that accrued while this prompt waited in the queue — other credentials and
              // other values seen on the same endpoint shape in the meantime.
              const promptText = buildPrompt()
              try {
                await SessionPrompt.prompt({
                  sessionID,
                  agent: agentName,
                  model: body.model,
                  excludeHistory: true,
                  parts: [{ type: "text", text: promptText }],
                })
                const model = body.model ?? (await SessionPrompt.lastModel(sessionID))
                await IngestSummary.write({
                  sessionID,
                  agent: agentName,
                  model,
                  source,
                  before,
                  after: IngestSummary.snapshot(sessionID),
                })
              } finally {
                Request.updateStatus({ id: req.id, status: "processed" })
              }
            })
          }
        } else {
          // Non-HTTP request (plain text message)
          const promptText = buildPromptWithCredentialContext(body.text, credentialID)
          if (ingestDryRun) {
            log.info("ingest dry-run (text)", { sessionID })
            log.info("prompt preview:\n" + promptText)
          } else {
            const agentName = body.agent ?? "hunt-agent"
            IngestQueue.enqueue(sessionID, async () => {
              const before = IngestSummary.snapshot(sessionID)
              await SessionPrompt.prompt({
                sessionID,
                agent: agentName,
                model: body.model,
                excludeHistory: true,
                parts: [{ type: "text", text: promptText }],
              })
              const model = body.model ?? (await SessionPrompt.lastModel(sessionID))
              await IngestSummary.write({
                sessionID,
                agent: agentName,
                model,
                source: "text ingest",
                before,
                after: IngestSummary.snapshot(sessionID),
              })
            })
          }
        }
        c.status(202)
        return c.json({ sessionID })
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.remove.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.remove(sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        let session = await Session.get(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          session = await Session.setArchived({ sessionID, time: updates.time.archived })
        }

        return c.json(session)
      },
    )
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
        operationId: "session.init",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "session.fork",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        // Genuine user abort (Esc) — stop the background hackbrowser crawl too.
        SessionPrompt.cancel(c.req.valid("param").sessionID, { stopCrawl: true })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/queue/pause",
      describeRoute({
        summary: "Pause ingest queue",
        description:
          "Pause the ingest queue for a session. The current in-flight ingest finishes; the next one waits until queue/resume is called. Other flows (chat input, abort) are unaffected.",
        operationId: "session.queuePause",
        responses: {
          200: {
            description: "Paused",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        IngestQueue.pause(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/queue/resume",
      describeRoute({
        summary: "Resume ingest queue",
        description:
          "Resume the ingest queue for a session. Tasks queued while paused start processing in original order.",
        operationId: "session.queueResume",
        responses: {
          200: {
            description: "Resumed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        IngestQueue.resume(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
        operationId: "session.share",
        responses: {
          200: {
            description: "Successfully shared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.share(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.diff.schema.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.diff.schema.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
        operationId: "session.unshare",
        responses: {
          200: {
            description: "Successfully unshared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.unshare.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.unshare(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: z.string(),
          modelID: z.string(),
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID }).catch((e) => {
          if (e instanceof Error && e.message === "session prompt cancelled") return
          throw e
        })
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(MessageV2.WithParts.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const messages = await Session.messages({
          sessionID: c.req.valid("param").sessionID,
          limit: query.limit,
        })
        return c.json(messages)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Info,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const message = await MessageV2.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
          messageID: z.string().meta({ description: "Message ID" }),
          partID: z.string().meta({ description: "Part ID" }),
        }),
      ),
      validator("json", MessageV2.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
        operationId: "session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Assistant,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          const msg = await SessionPrompt.prompt({ ...body, sessionID }).catch((e) => {
            if (e instanceof Error && e.message === "session prompt cancelled") return
            throw e
          })
          if (msg) stream.write(JSON.stringify(msg))
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          SessionPrompt.prompt({ ...body, sessionID }).catch(() => {})
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: MessageV2.Assistant,
                    parts: MessageV2.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Assistant),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string().meta({ description: "Session ID" }),
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
        operationId: "session.revert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await SessionRevert.revert({
          sessionID,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
        operationId: "session.unrevert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await SessionRevert.unrevert({ sessionID })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/permissions/:permissionID",
      describeRoute({
        summary: "Respond to permission",
        deprecated: true,
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.respond",
        responses: {
          200: {
            description: "Permission processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
          permissionID: z.string(),
        }),
      ),
      validator("json", z.object({ response: PermissionNext.Reply })),
      async (c) => {
        const params = c.req.valid("param")
        PermissionNext.reply({
          requestID: params.permissionID,
          reply: c.req.valid("json").response,
        })
        return c.json(true)
      },
    ),
)
