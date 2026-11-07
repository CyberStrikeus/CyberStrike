import { afterAll, beforeAll, expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"

let url: URL
let stop: () => Promise<void>

beforeAll(async () => {
  const server = await listen({ hostname: "127.0.0.1", port: 0, password: undefined })
  url = server.url
  stop = server.stop
})

afterAll(async () => {
  await stop()
})

test("serves only v2 routes", async () => {
  expect((await fetch(`${url}api/info`)).status).toBe(200)
  expect((await fetch(`${url}global/health`)).status).toBe(404)
  expect((await fetch(`${url}session/status`)).status).toBe(404)
  expect((await fetch(`${url}project/current`)).status).toBe(404)
})

test("global health is not a 200 json document", async () => {
  const res = await fetch(`${url}global/health`)
  expect(res.status).not.toBe(200)
})
