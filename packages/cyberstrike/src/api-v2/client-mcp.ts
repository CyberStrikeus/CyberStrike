import { createHash, randomBytes } from "node:crypto"
import { Effect } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { MCP } from "../mcp"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { inInstance } from "./instance"

const log = Log.create({ service: "api-v2.client-mcp" })

export const MCP_CLIENT_PATH = "/api/experimental/client-mcp"

const TTL = 300_000
const CAP = 32

const digest = (token: string) => createHash("sha256").update(token).digest("hex")

// Only SHA-256 digests are stored, so the store never holds a usable token. A token is bound to one directory and one
// client name. The first consume removes it whether or not it matches, so a token is good for exactly one attempt.
export function clientTokens(ttl = TTL) {
  const entries = new Map<string, { directory: string; name: string; expires: number }>()
  const prune = () => {
    const now = Date.now()
    entries.forEach((entry, key) => {
      if (entry.expires <= now) entries.delete(key)
    })
  }
  return {
    issue(directory: string, name: string) {
      prune()
      if (entries.size >= CAP) return undefined
      const token = randomBytes(32).toString("base64url")
      entries.set(digest(token), { directory, name, expires: Date.now() + ttl })
      return { ticket: token, expires_in: ttl / 1000 }
    },
    consume(token: string, directory: string, name: string) {
      const key = digest(token)
      const entry = entries.get(key)
      if (!entry) return false
      entries.delete(key)
      return entry.expires > Date.now() && entry.directory === directory && entry.name === name
    },
  }
}

export const tokens = clientTokens()

// Directories that already have a client-hosted server attached. One at a time per directory.
const attached = new Set<string>()

export const busy = (directory: string) => attached.has(directory)

type Socket = { send(data: string): void; close(code?: number, reason?: string): void }

// Parsing is the only place a malformed frame can throw, so it is caught here and dropped as a protocol error.
const parse = (data: string) => {
  try {
    const result = JSONRPCMessageSchema.safeParse(JSON.parse(data))
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

// Serves one client-hosted MCP server over `socket`: the socket is the transport, and the client is attached to the
// v1 MCP domain under `name` for `directory` until the socket closes. Returns undefined if the directory is taken.
export function serve(directory: string, name: string, socket: Socket) {
  if (attached.has(directory)) return undefined
  attached.add(directory)

  let done = false
  let open = true
  const client = new Client({ name: "cyberstrike", version: Installation.VERSION })
  const transport: Transport = {
    start: async () => {},
    send: async (message: JSONRPCMessage) => {
      if (open) socket.send(JSON.stringify(message))
    },
    close: async () => {
      if (!open) return
      open = false
      socket.close(1000, "closed")
    },
  }

  const detach = () =>
    Effect.runPromise(inInstance(directory, () => MCP.detach(name, client))).catch((error) =>
      log.error("failed to detach client MCP server", { name, error }),
    )

  const teardown = () => {
    if (done) return
    done = true
    attached.delete(directory)
    detach()
    client.close().catch((error) => log.error("failed to close client MCP server", { name, error }))
  }

  client
    .connect(transport)
    .then(async () => {
      if (done) return
      await Effect.runPromise(inInstance(directory, () => MCP.attach(name, client)))
      if (done) await detach()
    })
    .catch((error) => {
      log.error("client MCP server failed to attach", { name, error })
      teardown()
    })

  return {
    onMessage(data: string) {
      const message = parse(data)
      if (message) transport.onmessage?.(message)
    },
    onClose() {
      open = false
      transport.onclose?.()
      teardown()
    },
  }
}
