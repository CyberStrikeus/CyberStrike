import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { PluginRpc } from "../../src/plugin/rpc"
import { tmpdir } from "../fixture/fixture"

// Covers the v2 rpc group against the plugin RPC registry, which is keyed by location directory.
setDefaultTimeout(60_000)

const PASSWORD = "rpc-pw"
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

const call = (directory: string, rpcID: string, method: string, body: unknown) =>
  fetch(`${base}/api/rpc/${rpcID}/${method}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, {
    method: "POST",
    headers: { authorization: AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

test("a registered method receives its input and its output is returned", async () => {
  await using tmp = await tmpdir()
  PluginRpc.register(tmp.path, "demo", { echo: (input) => ({ received: input }) })
  const res = await call(tmp.path, "demo", "echo", { input: { count: 2 } })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ output: { received: { count: 2 } } })
  PluginRpc.unregister(tmp.path, "demo")
})

test("an unknown method, including an inherited property name, is a typed RpcError", async () => {
  await using tmp = await tmpdir()
  PluginRpc.register(tmp.path, "demo", { echo: () => "ok" })
  for (const method of ["missing", "toString"]) {
    const res = await call(tmp.path, "demo", method, {})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body._tag).toBe("RpcError")
    expect(body.type).toBe("rpc.method_not_found")
  }
  PluginRpc.unregister(tmp.path, "demo")
})

test("an unknown RPC id, and a method registered for another location, are not found", async () => {
  await using tmp = await tmpdir()
  await using other = await tmpdir()
  PluginRpc.register(other.path, "demo", { echo: () => "ok" })
  const unknownID = await call(tmp.path, "absent", "echo", {})
  expect(unknownID.status).toBe(400)
  expect((await unknownID.json())._tag).toBe("RpcError")
  const otherLocation = await call(tmp.path, "demo", "echo", {})
  expect(otherLocation.status).toBe(400)
  expect((await otherLocation.json())._tag).toBe("RpcError")
  PluginRpc.unregister(other.path, "demo")
})

test("a method that throws is a typed RpcInternalError, and an unregistered RPC is no longer callable", async () => {
  await using tmp = await tmpdir()
  PluginRpc.register(tmp.path, "demo", {
    fail: () => {
      throw new Error("plugin broke")
    },
  })
  const failed = await call(tmp.path, "demo", "fail", {})
  expect(failed.status).toBe(500)
  const body = await failed.json()
  expect(body._tag).toBe("RpcInternalError")
  expect(body.type).toBe("rpc.internal")
  expect(body.message).toBe("plugin broke")

  PluginRpc.unregister(tmp.path, "demo")
  const after = await call(tmp.path, "demo", "fail", {})
  expect(after.status).toBe(400)
})
