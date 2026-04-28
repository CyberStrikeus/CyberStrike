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
import { WebCredential } from "../session/web/web-credential"
import { renderAccessContextLines } from "../server/routes/session"

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
  request_id: z.string().describe("Request ID to use as current request context (parent session).").optional(),
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

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

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
        const current =
          (params.request_id ? requests.find((r) => r.id === params.request_id) : null) ??
          requests.find((r) => r.status === "processing") ??
          requests.sort((a, b) => b.time.updated - a.time.updated)[0]
        const lines: string[] = []
        if (params.request_context?.trim()) lines.push(params.request_context.trim())
        if (current) {
          lines.push(
            "## Current request",
            `- request_id: ${current.id}`,
            `- session_id: ${current.session_id}`,
            `- method: ${current.method}`,
            `- normalized_path: ${current.normalized_path}`,
            `- status: ${current.status}`,
          )

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

          // Access Context — present only when source is hackbrowser with
          // UI crawling enrichment. Firefox extension data has all these
          // fields null, so renderAccessContextLines returns [].
          lines.push(...renderAccessContextLines({
            triggerElement: current.trigger_element,
            elementRoles: current.element_roles,
            pageUrl: current.page_url,
            pageVisitedBy: current.page_visited_by,
            uiContext: current.ui_context,
          }))

          if (current.raw_request) {
            lines.push("", "## Raw HTTP Request", "```", current.raw_request, "```")
          }

          // Response
          if (current.processed_response) {
            lines.push("", "## Response", "```", current.processed_response, "```")
          }
        }
        if (lines.length > 0) prompt = lines.join("\n") + "\n\n" + prompt
      }
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

      const output = [
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
        },
        output,
      }
    },
  }
})
