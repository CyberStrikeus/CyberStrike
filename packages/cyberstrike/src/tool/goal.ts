import z from "zod"
import { Tool } from "./tool"
import { SessionGoal } from "@/session/goal"
import { Agent } from "@/agent/agent"

export const GoalTool = Tool.define("goal", {
  description:
    "Read the active objective and remaining budget, or request an evidence audit and final report before completion. A final text response does not complete a goal. User controls own pause, resume, drop, creation and budgets.",
  parameters: z.object({ op: z.enum(["get", "complete"]) }),
  async execute(args, ctx) {
    const goal = SessionGoal.get(ctx.sessionID)
    if (!goal || goal.status !== "active" || (await Agent.get(ctx.agent))?.mode === "subagent")
      throw new SessionGoal.Conflict("The goal tool requires an active primary goal session")
    ctx.abort.throwIfAborted()
    const result = args.op === "complete" ? await SessionGoal.complete(ctx) : goal
    return {
      title: `Goal ${result.status}`,
      output: JSON.stringify({
        ...result,
        remainingBudget: result.tokenBudget === undefined ? null : Math.max(0, result.tokenBudget - result.tokensUsed),
      }),
      metadata: { status: result.status, truncated: false },
    }
  },
})
