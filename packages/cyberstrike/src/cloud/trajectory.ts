import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"

export interface AgentTrajectory {
  agent: string
  group: string
  sessionID: string
  steps: number
  toolCalls: Record<string, number>
  totalToolCalls: number
  compactions: number
  durationMs: number
  timedOut: boolean
  error: string | undefined
}

export interface OrchestrationTrajectory {
  totalDurationMs: number
  agents: AgentTrajectory[]
  totalSteps: number
  totalToolCalls: number
  toolCallBreakdown: Record<string, number>
}

export async function extractTrajectory(
  sessionID: string,
  agent: string,
  group: string,
  durationMs: number,
  timedOut: boolean,
  error: string | undefined,
): Promise<AgentTrajectory> {
  const toolCalls: Record<string, number> = {}
  let steps = 0
  let compactions = 0

  for await (const msg of MessageV2.stream(sessionID)) {
    if (msg.info.role === "assistant") steps++
    for (const part of msg.parts) {
      if (part.type === "tool") {
        const name = (part as MessageV2.ToolPart).tool
        toolCalls[name] = (toolCalls[name] ?? 0) + 1
      }
      if (part.type === "compaction") compactions++
    }
  }

  const totalToolCalls = Object.values(toolCalls).reduce((sum, n) => sum + n, 0)
  return { agent, group, sessionID, steps, toolCalls, totalToolCalls, compactions, durationMs, timedOut, error }
}

export function aggregateTrajectories(agents: AgentTrajectory[], totalDurationMs: number): OrchestrationTrajectory {
  const toolCallBreakdown: Record<string, number> = {}
  let totalSteps = 0
  let totalToolCalls = 0

  for (const a of agents) {
    totalSteps += a.steps
    totalToolCalls += a.totalToolCalls
    for (const [tool, count] of Object.entries(a.toolCalls)) {
      toolCallBreakdown[tool] = (toolCallBreakdown[tool] ?? 0) + count
    }
  }

  return { totalDurationMs, agents, totalSteps, totalToolCalls, toolCallBreakdown }
}

export function formatTrajectoryLog(t: OrchestrationTrajectory): string {
  const lines = [
    `[trajectory] Layer 2 complete in ${Math.round(t.totalDurationMs / 1000)}s`,
    `[trajectory] ${t.agents.length} agents, ${t.totalSteps} total steps, ${t.totalToolCalls} tool calls`,
    `[trajectory] Tool breakdown: ${Object.entries(t.toolCallBreakdown).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
  ]
  for (const a of t.agents) {
    const status = a.error ? `ERROR: ${a.error}` : a.timedOut ? "TIMED OUT" : "OK"
    lines.push(`[trajectory]   ${a.agent}/${a.group}: ${a.steps} steps, ${a.totalToolCalls} tool calls, ${Math.round(a.durationMs / 1000)}s [${status}]`)
    if (a.compactions > 0) lines.push(`[trajectory]     compactions: ${a.compactions}`)
  }
  return lines.join("\n")
}
