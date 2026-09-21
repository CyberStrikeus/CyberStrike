// Brain service — the SaaS-side Hono server.
//
// Accepts WebSocket connections from CyberStrike CLI clients.
// Validates license, creates a BrainSession, and runs the LLM loop
// with domain playbooks. Tool calls are dispatched to the client.
import { Hono } from "hono"
import { cors } from "hono/cors"
import { BrainSession } from "./session"
import { License } from "./license"
import { Runner } from "./runner"
import { Playbook } from "./playbook"
import { Wallet } from "./wallet"
import { ClientMessage } from "./protocol"
import { createAnthropic } from "@ai-sdk/anthropic"

import "./playbooks/aws"

const app = new Hono()
const sessions = new Map<string, BrainSession>()

app.use("*", cors({
  origin: ["https://cyberstrike.io", "https://*.cyberstrike.io"],
  allowMethods: ["GET", "POST"],
}))

app.get("/health", (c) => c.json({ status: "ok", domains: Playbook.domains() }))

app.get("/v1/domains", (c) => {
  return c.json({
    domains: Playbook.domains().map((d) => ({
      key: d,
      playbook: true,
    })),
  })
})

app.get("/v1/wallet/:orgId", (c) => {
  const orgId = c.req.param("orgId")
  const balance = Wallet.getBalance(orgId)
  return c.json(balance)
})

app.get("/v1/wallet/:orgId/usage", (c) => {
  const orgId = c.req.param("orgId")
  const since = c.req.query("since") ? Number(c.req.query("since")) : undefined
  return c.json({ usage: Wallet.getUsage(orgId, since) })
})

type WSData = { sessionId?: string }

function handleMessage(session: BrainSession, raw: string) {
  let msg: ClientMessage
  try {
    msg = ClientMessage.parse(JSON.parse(raw))
  } catch {
    session.send({
      type: "error",
      code: "invalid_message",
      message: "failed to parse message",
    })
    return
  }

  switch (msg.type) {
    case "tool_result":
      session.handleToolResult(msg.callId, msg.result, msg.error)
      break

    case "request": {
      // BYO-key: use client's key (ephemeral, cleared on disconnect).
      // Managed: use our key, debit credits.
      const apiKey = session.getModelKey() ?? process.env["ANTHROPIC_API_KEY"]
      if (!apiKey) {
        session.send({
          type: "error",
          requestId: msg.id,
          code: "no_api_key",
          message: "no API key configured",
        })
        break
      }
      const anthropic = createAnthropic({ apiKey })
      const model = anthropic("claude-sonnet-4-20250514")
      Runner.run({
        requestId: msg.id,
        session,
        model,
        domain: msg.domain,
        message: msg.message,
        orgId: session.orgId,
        byoKey: session.byoKey,
        context: msg.context,
      })
      break
    }

    case "cancel":
      session.cancelRequest(msg.requestId)
      break
  }
}

const server = Bun.serve({
  port: Number(process.env["BRAIN_PORT"] ?? 4097),
  fetch(req, server) {
    if (server.upgrade(req, { data: {} as any })) return
    return app.fetch(req)
  },
  websocket: {
    open(_ws: any) {},
    async message(ws: any, raw: string | Buffer) {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(data) as Record<string, unknown>
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "parse_error", message: "invalid JSON" }))
        return
      }

      if (parsed.type === "connect") {
        const connectMsg = ClientMessage.parse(parsed)
        if (connectMsg.type !== "connect") return

        const result = await License.validate(connectMsg.license)
        if (!result.valid) {
          ws.send(JSON.stringify({
            type: "error",
            code: "license_invalid",
            message: result.reason,
          }))
          ws.close(4001, "invalid license")
          return
        }

        const sessionId = crypto.randomUUID()
        const orgId = result.org ?? sessionId
        const session = new BrainSession(sessionId, result.tier, orgId, connectMsg.modelKey)
        session.attach(ws as any)
        sessions.set(sessionId, session)
        ws.data.sessionId = sessionId

        session.send({
          type: "connected",
          sessionId,
          tier: result.tier,
        })
        return
      }

      const sessionId = ws.data.sessionId
      if (!sessionId) {
        ws.send(JSON.stringify({ type: "error", code: "not_connected", message: "send connect first" }))
        return
      }

      const session = sessions.get(sessionId)
      if (!session) {
        ws.send(JSON.stringify({ type: "error", code: "session_lost", message: "session not found" }))
        return
      }

      handleMessage(session, data)
    },
    close(ws: any) {
      const sessionId = ws.data.sessionId
      if (sessionId) {
        const session = sessions.get(sessionId)
        if (session) {
          session.clearModelKey()
          session.detach()
          sessions.delete(sessionId)
        }
      }
    },
  },
})

console.log(`CyberStrike Brain listening on :${server.port}`)
console.log(`Domains: ${Playbook.domains().join(", ")}`)
