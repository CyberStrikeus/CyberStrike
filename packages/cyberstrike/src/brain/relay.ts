// Brain relay — client-side WebSocket agent that connects to the SaaS brain.
//
// When the user has a Pro/Enterprise license, the CLI connects to the brain
// service instead of running the LLM locally. The brain sends tool_call
// messages; this relay executes them against the local tool registry and
// returns results.
//
// Architecture: CLI (hands) ↔ WebSocket ↔ Brain (orchestration)
import { Log } from "../util/log"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import type { BrainMessage, ClientMessage } from "@cyberstrike-io/brain/protocol"

export namespace BrainRelay {
  const log = Log.create({ service: "brain.relay" })

  export type Config = {
    url: string
    license: string
    version: string
    capabilities: string[]
    modelKey?: string
    onToolCall: (tool: string, input: Record<string, unknown>) => Promise<unknown>
    onStreamDelta?: (requestId: string, delta: string) => void
    onResponse?: (requestId: string, content: string) => void
    onError?: (requestId: string | undefined, code: string, message: string) => void
    onConnected?: (sessionId: string, tier: "pro" | "enterprise") => void
    onDisconnect?: () => void
  }

  let ws: WebSocket | null = null
  let config: Config | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connected = false

  export function isConnected(): boolean {
    return connected
  }

  export async function connect(cfg: Config): Promise<void> {
    config = cfg
    return new Promise((resolve, reject) => {
      try {
        ws = new WebSocket(cfg.url)
      } catch (err) {
        reject(err)
        return
      }

      ws.onopen = () => {
        log.info("connected to brain", { url: cfg.url })
        const connectMsg: ClientMessage = {
          type: "connect",
          license: cfg.license,
          version: cfg.version,
          capabilities: cfg.capabilities,
          modelKey: cfg.modelKey,
        }
        ws!.send(JSON.stringify(connectMsg))
      }

      ws.onmessage = async (event) => {
        let msg: BrainMessage
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer))
        } catch {
          log.error("failed to parse brain message")
          return
        }

        switch (msg.type) {
          case "connected":
            connected = true
            log.info("brain session established", {
              sessionId: msg.sessionId,
              tier: msg.tier,
            })
            cfg.onConnected?.(msg.sessionId, msg.tier)
            resolve()
            break

          case "tool_call":
            await handleToolCall(msg)
            break

          case "stream_delta":
            cfg.onStreamDelta?.(msg.requestId, msg.delta)
            break

          case "response":
            cfg.onResponse?.(msg.requestId, msg.content)
            break

          case "error":
            log.error("brain error", {
              code: msg.code,
              message: msg.message,
              requestId: msg.requestId,
            })
            cfg.onError?.(msg.requestId, msg.code, msg.message)
            if (msg.code === "license_invalid") {
              disconnect()
              reject(new Error(msg.message))
            }
            break
        }
      }

      ws.onclose = () => {
        connected = false
        log.info("disconnected from brain")
        cfg.onDisconnect?.()
        scheduleReconnect()
      }

      ws.onerror = (err) => {
        log.error("brain websocket error", { error: String(err) })
        if (!connected) {
          reject(new Error("failed to connect to brain"))
        }
      }
    })
  }

  async function handleToolCall(msg: Extract<BrainMessage, { type: "tool_call" }>) {
    if (!config) return

    try {
      const result = await config.onToolCall(msg.tool, msg.input)
      send({
        type: "tool_result",
        callId: msg.callId,
        result,
      })
    } catch (err) {
      send({
        type: "tool_result",
        callId: msg.callId,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  export function request(id: string, domain: string, message: string, context?: Record<string, unknown>) {
    send({
      type: "request",
      id,
      domain,
      message,
      context,
    })
  }

  export function cancel(requestId: string) {
    send({ type: "cancel", requestId })
  }

  function send(msg: ClientMessage) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.error("cannot send, not connected")
      return
    }
    ws.send(JSON.stringify(msg))
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (config && !connected) {
        log.info("reconnecting to brain...")
        connect(config).catch((err) => {
          log.error("reconnect failed", { error: String(err) })
        })
      }
    }, 5000)
  }

  export function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected = false
    config = null
  }
}
