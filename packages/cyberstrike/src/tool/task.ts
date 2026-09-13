import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Request } from "../session/request"
import { CoverageNote } from "../session/coverage-note"
import { WebCredential } from "../session/web/web-credential"
import { WebRetest } from "../session/web/web-retest"
import { renderAccessContextLines } from "../server/routes/session"
import { Truncate } from "./truncation"
import { dispatchScopeViolation, dispatchOffLaneMessage } from "./vuln-scope"

// Per-field byte cap for raw request/response prepended into a subagent prompt.
// Raised 16KB→48KB: validation showed weak models (o4-mini) do NOT follow the
// "call web_get_request_detail" hint when content is truncated — they proceed on
// the head and MISS anything past the cap (e.g. a secret leaked at byte 30k). The
// cap is now large enough that most responses fit in-context (structural fix:
// don't depend on the model following a hint), affordable since prompt caching
// makes the extra tokens cheap. The full content stays retrievable via
// web_get_request_detail for the rare response that still exceeds this.
const MAX_PREPEND_BYTES = 48 * 1024

// Cap how many object-value ids we inline — the analytics/IDOR extractor can gather dozens; the
// specialist needs the shape and a representative set, not an unbounded dump into every prompt.
const MAX_OBJECT_VALUES = 20

// Render the endpoint's accumulated retest-queue flags as a "Discovered Context" block: WHAT was
// found plus WHAT the specialist should DO with it. Empty (no lines) when the endpoint has no
// flags — so a plain request with nothing discovered adds nothing to the brief.
function renderDiscoveredContextLines(sessionID: string, keyHash: string | undefined): string[] {
  if (!keyHash) return []
  const flags = WebRetest.getFlags(sessionID, keyHash)
  if (!flags) return []
  const creds = flags.credential ?? []
  const roles = flags.role ?? []
  const objects = flags.object_value ?? []
  const signals = flags.signal ?? []
  if (creds.length === 0 && roles.length === 0 && objects.length === 0 && signals.length === 0) return []

  const lines = [
    "",
    "## Discovered Context (why this endpoint is queued — test with this)",
    "Found on this endpoint since it was first captured. Each item below implies a concrete test — do it:",
  ]
  if (creds.length) {
    lines.push(
      `- Credentials available to replay as: ${creds.join(", ")}`,
      "  → Replay this exact request under EACH credential (http_replay compare mode). The same object/data returned under a DIFFERENT identity = broken object-level access control (IDOR). Also try it with no credential (unauthenticated).",
    )
  }
  if (roles.length) {
    lines.push(
      `- Roles seen holding access: ${roles.join(", ")}`,
      "  → If a lower-privilege role can reach a higher-privilege action/function here, that is BFLA / privilege escalation.",
    )
  }
  if (objects.length) {
    const shown = objects.slice(0, MAX_OBJECT_VALUES)
    const more = objects.length - shown.length
    lines.push(
      `- Object identifiers observed (IDOR fuel): ${shown.join(", ")}${more > 0 ? ` … (+${more} more)` : ""}`,
      "  → Substitute these ids into this endpoint's id/path/param slots under one credential. A value you should NOT own that still resolves = IDOR.",
    )
  }
  if (signals.length) {
    // Flag values encode "signalType:ownerClass"; show the human half.
    const named = signals.map((s) => (s.includes(":") ? `${s.split(":")[0]} (${s.split(":")[1]})` : s))
    lines.push(
      `- Weaknesses already auto-detected here: ${named.join(", ")}`,
      "  → These were flagged by the signal fabric. Confirm and exploit them — don't spend effort re-discovering them.",
    )
  }
  return lines
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  request_id: z
    .string()
    .describe(
      "Request ID of the endpoint this task is about. ALWAYS pass it when the task concerns a specific " +
        "captured request — it resolves which endpoint's request/credential/discovered-context is prepended " +
        "to the subagent. Omitting it attaches nothing (or, if the target is ambiguous, could attach the wrong " +
        "endpoint). Copy it from the web_get_session_context item you are dispatching for.",
    )
    .optional(),
  request_context: z.string().describe("Optional text to prepend before the task (e.g. extra context).").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        // Dispatch lane guard (Phase 4): the orchestrator must route each test to
        // the specialist whose lane owns it. Bounce a confidently mis-routed
        // wstg-tester dispatch (e.g. a rate-limiting task sent to business-logic)
        // with a re-dispatch hint instead of spawning a wasted subagent. Domain
        // logic lives in vuln-scope; here we only enforce. Only autonomous dispatch
        // is constrained — explicit user @-invocation is bypassAgentCheck and skips.
        const violation = dispatchScopeViolation(params.subagent_type, `${params.description}\n${params.prompt}`)
        if (violation) {
          return {
            title: `Dispatch rejected — ${params.subagent_type} out of lane`,
            output: dispatchOffLaneMessage(violation.cls, violation.inferred),
            // Match the success return's metadata shape so the tool's inferred
            // Metadata type stays consistent (no subtask was created here).
            metadata: { sessionId: "", model: { providerID: "", modelID: "" }, outcome: "clean" as const },
          }
        }

        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      // Inherit the caller's INTENDED model — its user-message model, NOT the
      // assistant message's model. The assistant model reflects the model actually
      // run, which for a useSmallModel caller (orchestrator) is already
      // downgraded; inheriting it would force every dispatched tester onto the
      // small tier too. The user message keeps the original tier. The subagent's
      // own useSmallModel downgrade (if any) is applied at run time in the
      // SessionPrompt loop — never here.
      const model = agent.model ?? (await SessionPrompt.lastModel(ctx.sessionID))

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const messageID = Identifier.ascending("message")

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

      let prompt = params.prompt
      if (agent.prependRequestContext) {
        const requests = Request.get(ctx.sessionID)
        // Resolve the endpoint this task is about — CONFIDENTLY, or not at all. A blind fallback to
        // "any processing request" attached the WRONG endpoint's request/credential/flags whenever
        // several requests were in flight (routine now that the RetestWorker fans out in parallel).
        //   1. request_id passed        → use exactly that (the orchestrator is told to always pass it).
        //   2. no id, EXACTLY ONE proc. → unambiguous, use it.
        //   3. otherwise                → attach NO request block; tell the subagent to find its own target.
        const processing = requests.filter((r) => r.status === "processing")
        const current = params.request_id
          ? requests.find((r) => r.id === params.request_id)
          : processing.length === 1
            ? processing[0]
            : undefined
        const lines: string[] = []
        if (params.request_context?.trim()) lines.push(params.request_context.trim())
        if (current) {
          lines.push(
            "## Current request",
            `- request_id: ${current.id}`,
            `- session_id: ${current.session_id}`,
            `- method: ${current.method}`,
            `- normalized_path: ${current.normalized_path}`,
            `- origin: ${current.origin ?? "—"}`,
            `- status: ${current.status}`,
          )

          // App-wide coverage already recorded for this origin — reuse the verdict /
          // forged artifacts and do NOT re-test these deployment-wide classes here.
          const coverage = CoverageNote.wideBlock(Session.root(ctx.sessionID), current.origin ?? "")
          if (coverage) {
            lines.push("")
            lines.push(coverage)
          }

          // Credential context
          if (current.credential_id) {
            const cred = WebCredential.getById(current.credential_id)
            if (cred) {
              lines.push("")
              lines.push("## Credential Context")
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
          } else {
            lines.push("")
            lines.push("## Credential Context")
            lines.push("UNAUTHENTICATED (no credential associated with this request)")
          }

          // Discovered Context — the retest-queue flags accumulated on THIS endpoint (key_hash).
          // This is what makes the endpoint worth (re)testing: new identities/roles/object-ids/
          // signals found since it was first seen. The specialist would otherwise have to cross-
          // reference the session-wide queue itself, so inline it AND say what each flag means to
          // do — a bare value list is useless if the agent doesn't know the action it implies.
          lines.push(...renderDiscoveredContextLines(ctx.sessionID, current.key_hash))

          // Access Context — present only when source is hackbrowser with
          // UI crawling enrichment. Firefox extension data has all these
          // fields null, so renderAccessContextLines returns [].
          lines.push(
            ...renderAccessContextLines({
              triggerElement: current.trigger_element,
              elementRoles: current.element_roles,
              pageUrl: current.page_url,
              pageVisitedBy: current.page_visited_by,
              uiContext: current.ui_context,
            }),
          )

          // Cap raw request/response before prepending. These can be up to
          // ~100KB each (and this path bypasses the tool-output truncation that
          // web_get_request_detail goes through), so without a cap a single big
          // request fans out into every dispatched subagent's prompt. The full
          // request/response stays available on demand via web_get_request_detail.
          const reqHint = (shown: number, total: number) =>
            `\n\n⚠️ TRUNCATED: only the first ${shown} of ${total} bytes are shown above. ` +
            `The rest (including anything past this point — params, headers, leaked data, sinks) is NOT visible here. ` +
            `You MUST call web_get_request_detail with request_id "${current.id}" to read the FULL request/response ` +
            `before you conclude anything about this endpoint — do NOT decide based only on this truncated head.`
          if (current.raw_request) {
            lines.push(
              "",
              "## Raw HTTP Request",
              "```",
              Truncate.cap(current.raw_request, MAX_PREPEND_BYTES, reqHint),
              "```",
            )
          }

          // Response
          if (current.processed_response) {
            lines.push(
              "",
              "## Response",
              "```",
              Truncate.cap(current.processed_response, MAX_PREPEND_BYTES, reqHint),
              "```",
            )
          }
        } else if (params.request_id) {
          // An id was passed but nothing matches it — do NOT attach an arbitrary request (that is
          // the wrong-endpoint bug). Say so, so the subagent locates the target itself.
          lines.push(
            "## Current request",
            `⚠️ request_id "${params.request_id}" was passed but no captured request matches it, so no ` +
              "request / credential / discovered-context could be attached. Call web_get_session_context and " +
              "web_get_request_detail to locate the endpoint you were asked to test before concluding anything.",
          )
        } else {
          // No id and the target is ambiguous (zero or several requests in flight) — attaching one
          // would be a guess. Attach none and point the subagent at the tools to resolve it.
          lines.push(
            "## Current request",
            "⚠️ No request_id was provided and the target endpoint is ambiguous, so no request context is " +
              "attached. Call web_get_session_context to find the exact request_id you must test, then " +
              "web_get_request_detail for its full request/response.",
          )
        }
        if (lines.length > 0) prompt = lines.join("\n") + "\n\n" + prompt
      }

      // NOTE: methodology context is NOT injected here. The subagent's own run loop
      // (session/prompt.ts) pushes MethodologyContext.generate(root, testerClass(agent))
      // into the system prompt on EVERY turn (lane-scoped identically), and that prefix
      // is prompt-cached. Prepending it here too only duplicated it into turn-1's user
      // message. The system-prompt path covers all subagent sessions, so this is the
      // single source.
      const promptParts = await SessionPrompt.resolvePromptParts(prompt)

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      // Classify the subagent's ACTUAL outcome from its final assistant message so
      // the parent's recording gate (session/prompt.ts) doesn't count an aborted /
      // errored / step-capped run as a successful mission. The child loop swallows
      // aborts/errors into info.error and still returns a result, and a step-capped
      // run looks like a clean finish:"stop" — both previously recorded success:true.
      const childInfo = result.info
      const childError = childInfo.role === "assistant" ? childInfo.error : undefined
      const outcome: "clean" | "aborted" | "errored" | "capped" | "stuck" = childError
        ? MessageV2.AbortedError.isInstance(childError)
          ? "aborted"
          : "errored"
        : childInfo.role === "assistant" && childInfo.stuckAborted
          ? "stuck"
          : childInfo.role === "assistant" && childInfo.stepCapped
            ? "capped"
            : "clean"

      const statusBanner =
        outcome === "clean"
          ? null
          : outcome === "aborted"
            ? "INCOMPLETE: this subagent was ABORTED before finishing. Its results are partial and were NOT credited as tested."
            : outcome === "errored"
              ? `INCOMPLETE: this subagent ERRORED before finishing (${(childError as { name?: string })?.name ?? "error"}). Its results are partial and were NOT credited as tested.`
              : outcome === "stuck"
                ? "INCOMPLETE: this subagent was TERMINATED for making no progress (it repeated actions or status checks without real testing). Its results are partial and were NOT credited as tested."
                : "INCOMPLETE: this subagent hit its step limit and was forced to wrap up before finishing. Its results may be partial and were NOT credited as tested."

      const output = [
        ...(statusBanner ? [`<task_status>${statusBanner}</task_status>`, ""] : []),
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          outcome,
        },
        output,
      }
    },
  }
})
