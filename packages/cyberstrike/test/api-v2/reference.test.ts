import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import path from "node:path"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Covers the v2 reference group against the references configured in the v1 config.
setDefaultTimeout(60_000)

const PASSWORD = "reference-pw"
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

const list = (directory: string) =>
  fetch(`${base}/api/reference?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, {
    headers: { authorization: AUTH },
  })

test("configured references are listed with resolved local paths, descriptions, and hidden flags", async () => {
  await using tmp = await tmpdir({
    config: {
      references: {
        docs: { path: "docs", description: "Project docs" },
        shared: { path: "/opt/shared-kit", hidden: true },
      },
    },
  })
  const res = await list(tmp.path)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.location).toEqual({ directory: tmp.path })
  expect(body.data).toEqual([
    {
      name: "docs",
      path: path.join(tmp.path, "docs"),
      description: "Project docs",
      source: { type: "local", path: path.join(tmp.path, "docs") },
    },
    {
      name: "shared",
      path: "/opt/shared-kit",
      hidden: true,
      source: { type: "local", path: "/opt/shared-kit" },
    },
  ])
})

test("a location with no references lists nothing", async () => {
  await using tmp = await tmpdir()
  const res = await list(tmp.path)
  expect(res.status).toBe(200)
  expect((await res.json()).data).toEqual([])
})
