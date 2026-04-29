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
import { Normalize } from "../../session/normalize"
import { IngestSummary } from "../../session/ingest-summary"
import { IngestQueue } from "../../session/ingest-queue"
import { WebCredential } from "../../session/web/web-credential"
import { WebRole } from "../../session/web/web-role"
import { WebObject } from "../../session/web/web-object"
import { WebFunction } from "../../session/web/web-function"
import { WebRetest } from "../../session/web/web-retest"
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
      const fieldsSummary = ui.fields.map(f => {
        const flags: string[] = []
        if (f.validation?.required) flags.push("required")
        if (f.isReadOnly) flags.push("readonly")
        if (f.isDisabled) flags.push("disabled")
        if (f.isHidden) flags.push("hidden")
        return `${f.name}(${f.type}${flags.length ? "," + flags.join(",") : ""})`
      }).join(", ")
      lines.push(`Fields: ${fieldsSummary}`)
    }
    if (ui.hiddenParams?.length) {
      lines.push(`Hidden Params: ${ui.hiddenParams.join(", ")}`)
    }
  }
  return lines
}

function buildPromptWithCredentialContext(
  rawRequest: string,
  credentialID?: string,
  processedResponse?: string,
  accessContext?: AccessContextInput,
): string {
  const lines: string[] = []

  lines.push("## Credential Context")

  if (!credentialID) {
    lines.push("UNAUTHENTICATED (no credential provided by browser extension)")
  } else {
    const cred = WebCredential.getById(credentialID)
    if (!cred) {
      lines.push(`- credential_id: ${credentialID} (NOT FOUND in database)`)
    } else {
      lines.push(`- credential_id: ${cred.id}`)
      lines.push(`- label: ${cred.label}`)
      if (cred.container_id) {
        lines.push(`- container_id: ${cred.container_id}`)
      }
      if (Object.keys(cred.headers).length > 0) {
        lines.push("- headers:")
        for (const [key, value] of Object.entries(cred.headers)) {
          const displayValue = value.length > 80 ? value.slice(0, 80) + "..." : value
          lines.push(`  - ${key}: ${displayValue}`)
        }
      }
      if (cred.role_id) {
        lines.push(`- role_id: ${cred.role_id}`)
      }
    }
  }

  if (accessContext) {
    lines.push(...renderAccessContextLines(accessContext))
  }

  lines.push("")
  lines.push("## Raw HTTP Request")
  lines.push("```")
  lines.push(rawRequest)
  lines.push("```")

  if (processedResponse) {
    lines.push("")
    lines.push("## Response")
    lines.push("```")
    lines.push(processedResponse)
    lines.push("```")
  }

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
    ? { async classify() { return { decisions: [], model: "dry-run" } } }
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
        description: "Retrieve the current ingest-queue state for all sessions (paused flag and pending count). Sessions with no active queue are omitted.",
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
        description: "Cancels an in-flight hackbrowser crawl. The agent finishes the current page's pending tasks (graceful exit), closes the browser, and transitions HackbrowserStatus to completed with whatever was captured so far. Returns false when no hackbrowser run is active for this session.",
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
        description: "Retrieve the current hackbrowser run state for all sessions (phase, page/endpoint counters, errors). Used by the TUI sidebar bootstrap. Sessions with no hackbrowser run are omitted.",
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
        const cred = WebCredential.add({
          sessionID,
          label: body.label,
          headers: body.headers,
          containerID: body.container_id,
        })
        return c.json(cred)
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
            headers: body.headers,
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
                      processing: z.number(),
                      completed: z.number(),
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
          trigger_element: z.string().optional().meta({ description: "UI element that triggered this request (role:label)" }),
          element_roles: z.array(z.string()).optional().meta({ description: "Roles that can see the trigger element" }),
          ui_context: z.record(z.string(), z.unknown()).optional().meta({ description: "UI form context at request time" }),
          page_url: z.string().optional().meta({ description: "Page being explored when request was captured" }),
          page_visited_by: z.array(z.string()).optional().meta({ description: "Roles that can visit this page" }),
          scheme: z.enum(["http", "https"]).optional().meta({ description: "URL scheme of the captured request; inferred from Host header / port when omitted" }),
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

        // Handle credential registration
        let credentialID = body.credential_id
        if (body.credential && !credentialID) {
          const cred = WebCredential.add({
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
          const isDuplicate = Request.exists({
            sessionID,
            method: normalized.method,
            normalizedPath: normalized.normalizedPath,
            origin: normalized.origin,
            bodyHash: normalized.bodyHash,
            queryHash: normalized.queryKeyHash,
          })

          if (isDuplicate) {
            log.info("duplicate request skipped", { sessionID, method: normalized.method, path: normalized.normalizedPath })
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
          })

          // Build prompt with credential context, response, and access context
          const promptText = buildPromptWithCredentialContext(truncatedRawRequest, credentialID, req.processed_response, {
            triggerElement: body.trigger_element,
            elementRoles: body.element_roles,
            pageUrl: body.page_url,
            pageVisitedBy: body.page_visited_by,
            uiContext: body.ui_context as Record<string, unknown> | undefined,
          })

          if (ingestDryRun) {
            // Log the prompt that would be sent to LLM — skip actual LLM call
            log.info("ingest dry-run", { sessionID, method: normalized.method, path: normalized.normalizedPath, requestId: req.id })
            log.info("prompt preview:\n" + promptText)
            Request.updateStatus({ id: req.id, status: "processed" })
          } else {
            const agentName = body.agent ?? "proxy-agent"
            const source = `${normalized.method} ${normalized.normalizedPath}`
            IngestQueue.enqueue(sessionID, async () => {
              Request.updateStatus({ id: req.id, status: "processing" })
              const before = IngestSummary.snapshot(sessionID)
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
            const agentName = body.agent ?? "proxy-agent"
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
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/queue/pause",
      describeRoute({
        summary: "Pause ingest queue",
        description: "Pause the ingest queue for a session. The current in-flight ingest finishes; the next one waits until queue/resume is called. Other flows (chat input, abort) are unaffected.",
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
        description: "Resume the ingest queue for a session. Tasks queued while paused start processing in original order.",
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
        await SessionPrompt.loop({ sessionID })
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
          const msg = await SessionPrompt.prompt({ ...body, sessionID })
          stream.write(JSON.stringify(msg))
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
          SessionPrompt.prompt({ ...body, sessionID })
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
