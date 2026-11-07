// Shared execute shell for webhook smart tools. Extracts the boilerplate every
// tool repeats: Session.root, ReplaySender creation, request resolution,
// error/result formatting. Tools that resolve a single request_id up-front use
// defineWebhookTool; tools with multi-mode dispatch that conditionally resolve
// use webhookContext + toolError/toolResult directly.
import z from "zod"
import { Tool } from "../tool"
import { Session } from "../../session"
import { ReplaySender, type HttpSender } from "./transport"
import { resolveCapturedRequest } from "./resolve"
import { toolResult, toolError, type ToolOutput } from "./result"
import type { ProbeRequest } from "./transport"

export interface WebhookContext {
  sessionID: string
  sender: HttpSender
  resolve(requestId: string): ProbeRequest | { error: string }
}

export function webhookContext(ctx: { sessionID: string; abort: AbortSignal }): WebhookContext {
  const sessionID = Session.root(ctx.sessionID)
  return {
    sessionID,
    sender: new ReplaySender({ signal: ctx.abort }),
    resolve: (id: string) => resolveCapturedRequest(sessionID, id),
  }
}

export interface WebhookToolDef<P, R> {
  name: string
  description: string
  parameters: z.ZodType<P>
  run(params: P, ctx: WebhookContext): Promise<R | { error: string }>
  format(result: R): string
}

export function defineWebhookTool<P, R>(def: WebhookToolDef<P, R>) {
  return Tool.define(def.name, {
    description: def.description,
    parameters: def.parameters,
    async execute(params: P, ctx): Promise<ToolOutput> {
      const wctx = webhookContext(ctx)
      const result = await def.run(params, wctx)
      if (result && typeof result === "object" && "error" in result)
        return toolError(def.name, (result as { error: string }).error)
      return toolResult(def.name, def.format(result), result)
    },
  })
}

export { toolResult, toolError, type ToolOutput } from "./result"
