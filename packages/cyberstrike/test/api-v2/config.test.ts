import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

// Covers the v2 config.update route: a patch is persisted to the global config and reloaded.
setDefaultTimeout(60_000)

const PASSWORD = "config-pw"
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

const patch = (directory: string, body: unknown) =>
  fetch(`${base}/api/experimental/config?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, {
    method: "PATCH",
    headers: { authorization: AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

test("a shell patch is persisted and reloaded, and a null shell removes it", async () => {
  await using tmp = await tmpdir()

  const set = await patch(tmp.path, { shell: "/bin/bash" })
  expect(set.status).toBe(204)
  expect((await Config.getGlobal()).shell).toBe("/bin/bash")

  const cleared = await patch(tmp.path, { shell: null })
  expect(cleared.status).toBe(204)
  expect((await Config.getGlobal()).shell).toBeUndefined()
})

test("a patch that is refused by the config schema is a server error, not a silent write", async () => {
  await using tmp = await tmpdir()
  const res = await patch(tmp.path, { shell: 42 })
  expect(res.status).toBeGreaterThanOrEqual(400)
  expect((await Config.getGlobal()).shell).toBeUndefined()
})
