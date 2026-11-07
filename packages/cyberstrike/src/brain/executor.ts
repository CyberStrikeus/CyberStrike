// Brain tool executor — resolves brain tool calls to local tool execution.
//
// The brain sends tool_call messages with a tool name (e.g. "awshook") and
// input params. This executor finds the tool in ToolRegistry's plugin/custom
// tools and executes it locally.
import { Log } from "../util/log"
import { ToolRegistry } from "../tool/registry"
import { Identifier } from "../id/id"
import type { Tool } from "../tool/tool"

export namespace BrainExecutor {
  const log = Log.create({ service: "brain.executor" })

  export async function execute(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    log.info("executing tool call from brain", { tool: toolName })

    const { custom } = await ToolRegistry.state()
    const match = custom.find((t) => t.id === toolName)
    if (!match) {
      throw new Error(`unknown tool: ${toolName}`)
    }

    const initialized = await match.init()
    const ctx: Tool.Context = {
      sessionID: `brain-${Identifier.ascending("session")}`,
      messageID: Identifier.ascending("message"),
      agent: "brain",
      abort: AbortSignal.timeout(300_000),
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }

    const result = await initialized.execute(input, ctx)
    return result.output
  }
}
