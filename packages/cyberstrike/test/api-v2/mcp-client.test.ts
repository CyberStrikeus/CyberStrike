import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  CallToolRequestSchema,
  JSONRPCMessageSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { listen } from "../../src/api-v2/server"
import { clientTokens } from "../../src/api-v2/client-mcp"
import { inInstance } from "../../src/api-v2/instance"
import { MCP } from "../../src/mcp"
import { tmpdir } from "../fixture/fixture"

// Covers the client-hosted MCP socket over a real listener. The remote side is the SDK's own MCP server, speaking
// JSON-RPC over a real WebSocket, and the tools are read back through the v1 MCP domain the agent uses.
setDefaultTimeout(60_000)

const PASSWORD = "mcp-client-pw"
const AUTH = `Basic ${Buffer.from(`cyberstrike:${PASSWORD}`).toString("base64")}`

let base: string
let stop: () => Promise<void>

beforeAll(async () => {
  const server = await listen({ hostname: "127.0.0.1", port: 0, password: PASSWORD })
  base = server.url.toString().replace(/\/$/, "")
  stop = server.stop
})

afterAll(async () => {
  await stop()
})

const enc = encodeURIComponent

const issue = async (directory: string, name: string) => {
  const res = await fetch(
    `${base}/api/experimental/client-mcp/token?location%5Bdirectory%5D=${enc(directory)}&name=${name}`,
    { method: "POST", headers: { authorization: AUTH, "x-opencode-ticket": "1" } },
  )
  expect(res.status).toBe(200)
  return (await res.json()).data as { ticket: string; expires_in: number }
}

// Resolves to the open socket, or undefined when the server refused the upgrade.
const dial = (directory: string, name: string, ticket?: string) =>
  new Promise<WebSocket | undefined>((resolve) => {
    const query = `location%5Bdirectory%5D=${enc(directory)}&name=${name}${ticket === undefined ? "" : `&ticket=${enc(ticket)}`}`
    const ws = new WebSocket(`${base.replace("http", "ws")}/api/experimental/client-mcp?${query}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => resolve(undefined)
  })

// The remote end of the socket, as a plain MCP transport over the WebSocket.
const socketTransport = (ws: WebSocket): Transport => {
  const transport: Transport = {
    start: async () => {},
    send: async (message) => {
      ws.send(JSON.stringify(message))
    },
    close: async () => {
      ws.close()
    },
  }
  ws.onmessage = (event) => transport.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(String(event.data))))
  ws.onclose = () => transport.onclose?.()
  return transport
}

const serveRemote = async (ws: WebSocket) => {
  const server = new Server({ name: "remote", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo the text back",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: "text", text: String(request.params.arguments?.text) }],
  }))
  await server.connect(socketTransport(ws))
}

const toolNames = async (directory: string) =>
  Object.keys(await Effect.runPromise(inInstance(directory, () => MCP.tools())))

const waitFor = async (check: () => Promise<boolean>) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await check()) return true
    await Bun.sleep(100)
  }
  return false
}

test("a socket without a token is refused before the upgrade", async () => {
  await using tmp = await tmpdir({ git: true })
  expect(await dial(tmp.path, "remote")).toBeUndefined()
  expect(await dial(tmp.path, "remote", "not-a-real-token")).toBeUndefined()
})

test("a token issued for one directory or name is refused elsewhere", async () => {
  await using tmp = await tmpdir({ git: true })
  await using other = await tmpdir({ git: true })
  const { ticket } = await issue(tmp.path, "remote")
  expect(await dial(other.path, "remote", ticket)).toBeUndefined()
  expect(await dial(tmp.path, "elsewhere", ticket)).toBeUndefined()
})

test("an expired token is refused", async () => {
  await using tmp = await tmpdir({ git: true })
  // The live store uses a five-minute TTL, so expiry is exercised on a store with a short one.
  const store = clientTokens(50)
  const issued = store.issue(tmp.path, "remote")
  await Bun.sleep(80)
  expect(store.consume(issued!.ticket, tmp.path, "remote")).toBe(false)
})

test("a token is single-use: the second connect with it is refused", async () => {
  await using tmp = await tmpdir({ git: true })
  const { ticket, expires_in } = await issue(tmp.path, "remote")
  expect(expires_in).toBe(300)
  const first = await dial(tmp.path, "remote", ticket)
  expect(first).toBeDefined()
  expect(await dial(tmp.path, "remote", ticket)).toBeUndefined()
  first?.close()
})

test("tools appear while the socket is connected and disappear when it closes", async () => {
  await using tmp = await tmpdir({ git: true })
  const { ticket } = await issue(tmp.path, "remote")
  const ws = await dial(tmp.path, "remote", ticket)
  expect(ws).toBeDefined()
  await serveRemote(ws!)

  expect(await waitFor(async () => (await toolNames(tmp.path)).includes("remote_echo"))).toBe(true)

  const tools = await Effect.runPromise(inInstance(tmp.path, () => MCP.tools()))
  const result = await tools["remote_echo"].execute!({ text: "hi" }, { toolCallId: "call-1", messages: [] })
  expect(JSON.stringify(result)).toContain("hi")

  ws!.close()
  expect(await waitFor(async () => !(await toolNames(tmp.path)).includes("remote_echo"))).toBe(true)
})

test("one client-hosted server at a time per directory", async () => {
  await using tmp = await tmpdir({ git: true })
  const first = await issue(tmp.path, "remote")
  const second = await issue(tmp.path, "remote")
  const held = await dial(tmp.path, "remote", first.ticket)
  expect(held).toBeDefined()
  await serveRemote(held!)
  expect(await dial(tmp.path, "remote", second.ticket)).toBeUndefined()
  held!.close()
})
