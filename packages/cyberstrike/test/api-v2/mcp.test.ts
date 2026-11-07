import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Covers the v2 MCP group against the real v1 MCP domain. The configured server cannot start, so it reports failed.
setDefaultTimeout(60_000)

const PASSWORD = "mcp-pw"
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

const call = (directory: string, method: string, route: string, body?: unknown) =>
  fetch(`${base}${route}${route.includes("?") ? "&" : "?"}location%5Bdirectory%5D=${encodeURIComponent(directory)}`, {
    method,
    headers: { authorization: AUTH, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

test("a server added over v2 is listed with its status, then removed", async () => {
  await using tmp = await tmpdir({ git: true })
  const added = await call(tmp.path, "PUT", "/api/experimental/mcp/broken", {
    config: { type: "local", command: ["/nonexistent/cyberstrike-mcp-binary"] },
  })
  expect(added.status).toBe(204)

  // The add persists the config, which disposes instances in the background, so the server is polled for.
  const find = async (name: string) => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const body = await (await call(tmp.path, "GET", "/api/mcp")).json()
      expect(body.location.directory).toBe(tmp.path)
      const server = body.data.find((item: { name: string }) => item.name === name)
      if (server) return server
      await Bun.sleep(200)
    }
  }
  const server = await find("broken")
  expect(server.status.status).not.toBe("connected")

  expect((await call(tmp.path, "DELETE", "/api/experimental/mcp/broken")).status).toBe(204)
  const after = await (await call(tmp.path, "GET", "/api/mcp")).json()
  expect(after.data.find((item: { name: string }) => item.name === "broken")).toBeUndefined()
})

test("connect, disconnect, and remove answer McpServerNotFoundError for an unknown server", async () => {
  await using tmp = await tmpdir({ git: true })
  for (const action of [
    ["POST", "/api/experimental/mcp/missing/connect"],
    ["POST", "/api/experimental/mcp/missing/disconnect"],
    ["DELETE", "/api/experimental/mcp/missing"],
  ]) {
    const res = await call(tmp.path, action[0], action[1])
    expect(res.status).toBe(404)
    expect((await res.json())._tag).toBe("McpServerNotFoundError")
  }
})

test("a config field the v1 domain cannot express is refused, not dropped", async () => {
  await using tmp = await tmpdir({ git: true })
  const res = await call(tmp.path, "PUT", "/api/experimental/mcp/cwdcase", {
    config: { type: "local", command: ["/nonexistent/x"], cwd: "/tmp" },
  })
  expect(res.status).toBe(400)
  expect((await res.json())._tag).toBe("InvalidRequestError")
})

test("resource catalog answers with the connected resources and an empty template list", async () => {
  await using tmp = await tmpdir({ git: true })
  const res = await call(tmp.path, "GET", "/api/mcp/resource")
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.location.directory).toBe(tmp.path)
  expect(body.data.resources).toEqual([])
  expect(body.data.templates).toEqual([])
})
