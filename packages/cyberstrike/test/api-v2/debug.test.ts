import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(60_000)

const PASSWORD = "debug-pw"
const DIRECTORY = path.resolve(import.meta.dir, "../../../api-v2")
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

test("a heap snapshot is written into the requested directory and its path is returned", async () => {
  await using tmp = await tmpdir()
  const target = path.join(tmp.path, "snapshots")
  const res = await fetch(`${base}/api/debug/heap-dump?directory=${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { authorization: AUTH },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.path.startsWith(target)).toBe(true)
  expect(body.path.endsWith(".heapsnapshot")).toBe(true)
  expect(existsSync(body.path)).toBe(true)
  expect(readFileSync(body.path).byteLength).toBeGreaterThan(0)
  expect(body.pid).toBe(process.pid)
  expect(body.memory.heapUsed).toBeGreaterThan(0)
})

test("a relative heap snapshot directory is refused", async () => {
  const res = await fetch(`${base}/api/debug/heap-dump?directory=relative%2Fdir`, {
    method: "POST",
    headers: { authorization: AUTH },
  })
  expect(res.status).toBe(400)
  expect((await res.json())._tag).toBe("InvalidRequestError")
})

test("evicting a loaded location answers 204, and so does a location that does not exist", async () => {
  const loaded = await fetch(`${base}/api/debug/location?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`, {
    method: "DELETE",
    headers: { authorization: AUTH },
  })
  expect(loaded.status).toBe(204)
  const missing = await fetch(
    `${base}/api/debug/location?location%5Bdirectory%5D=${encodeURIComponent("/nonexistent/cyberstrike-location")}`,
    { method: "DELETE", headers: { authorization: AUTH } },
  )
  expect(missing.status).toBe(204)
})

test("a location is listed while its instance is cached, and disappears once evicted", async () => {
  await using tmp = await tmpdir()
  // Any location-scoped read boots the instance and caches it under its directory.
  await fetch(`${base}/api/mcp?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`, {
    headers: { authorization: AUTH },
  })
  const loaded = await (await fetch(`${base}/api/debug/location`, { headers: { authorization: AUTH } })).json()
  expect(loaded.map((item: { directory: string }) => item.directory)).toContain(tmp.path)

  const evicted = await fetch(`${base}/api/debug/location?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`, {
    method: "DELETE",
    headers: { authorization: AUTH },
  })
  expect(evicted.status).toBe(204)
  const after = await (await fetch(`${base}/api/debug/location`, { headers: { authorization: AUTH } })).json()
  expect(after.map((item: { directory: string }) => item.directory)).not.toContain(tmp.path)
})
