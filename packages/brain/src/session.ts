// Brain session — manages one connected client's LLM loop.
//
// The brain runs streamText with the domain's system prompt + playbooks.
// When the LLM emits a tool call, instead of executing it locally, the brain
// sends it over WebSocket to the client. The client executes and returns the
// result. The brain feeds the result back into the LLM loop.
import type { ServerWebSocket } from "bun"
import type { BrainMessage, ClientMessage } from "./protocol"

export class BrainSession {
  readonly id: string
  readonly tier: "pro" | "enterprise"
  private ws: ServerWebSocket<{ sessionId: string }> | null = null
  private pending = new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }>()
  private abortControllers = new Map<string, AbortController>()

  constructor(id: string, tier: "pro" | "enterprise") {
    this.id = id
    this.tier = tier
  }

  attach(ws: ServerWebSocket<{ sessionId: string }>) {
    this.ws = ws
  }

  detach() {
    this.ws = null
    for (const [, p] of this.pending) {
      p.reject(new Error("client disconnected"))
    }
    this.pending.clear()
    for (const [, ac] of this.abortControllers) {
      ac.abort()
    }
    this.abortControllers.clear()
  }

  send(msg: BrainMessage) {
    if (!this.ws) throw new Error("no client connected")
    this.ws.send(JSON.stringify(msg))
  }

  // Dispatch a tool call to the connected client and wait for the result.
  // The brain's LLM loop calls this instead of executing tools locally.
  async dispatchToolCall(callId: string, requestId: string, tool: string, input: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(callId, { resolve, reject })
      this.send({
        type: "tool_call",
        callId,
        requestId,
        tool,
        input,
      })
    })
  }

  // Called when the client sends a tool_result message.
  handleToolResult(callId: string, result: unknown, error?: string) {
    const p = this.pending.get(callId)
    if (!p) return
    this.pending.delete(callId)
    if (error) {
      p.reject(new Error(error))
    } else {
      p.resolve(result)
    }
  }

  cancelRequest(requestId: string) {
    const ac = this.abortControllers.get(requestId)
    if (ac) {
      ac.abort()
      this.abortControllers.delete(requestId)
    }
  }

  createAbort(requestId: string): AbortSignal {
    const ac = new AbortController()
    this.abortControllers.set(requestId, ac)
    return ac.signal
  }

  cleanupRequest(requestId: string) {
    this.abortControllers.delete(requestId)
  }
}
