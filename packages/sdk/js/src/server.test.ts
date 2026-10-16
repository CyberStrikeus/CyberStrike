import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { createCyberstrike } from "./index.js"
import { createCyberstrikeServer } from "./server.js"
import { createCyberstrike as createCyberstrikeV2 } from "./v2/index.js"
import { createCyberstrikeServer as createCyberstrikeServerV2 } from "./v2/server.js"

const KEY = "CYBERSTRIKE_SERVER_PASSWORD"
const saved = process.env[KEY]

// the spawned CLI resolves from node_modules/.bin regardless of the caller's PATH
const bin = path.join(import.meta.dir, "../../../node_modules/.bin")
process.env.PATH = `${bin}:${process.env.PATH}`

beforeEach(() => {
  delete process.env[KEY]
})

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

describe("createCyberstrikeServer", () => {
  test("starts without CYBERSTRIKE_SERVER_PASSWORD and authenticates non-loopback requests", async () => {
    const server = await createCyberstrikeServer({ port: 0, timeout: 30_000 })
    try {
      expect(server.password).toBeTypeOf("string")
      expect(server.password.length).toBeGreaterThan(0)

      // proxy headers mark the request as forwarded, so the loopback trust rule
      // does not apply and the password must protect the endpoint
      const forwarded = { "x-forwarded-for": "203.0.113.5" }
      const unauthorized = await fetch(`${server.url}/global/health`, { headers: forwarded })
      expect(unauthorized.status).toBe(401)

      const authorized = await fetch(`${server.url}/global/health`, {
        headers: {
          ...forwarded,
          Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`,
        },
      })
      expect(authorized.status).toBe(200)
      expect(await authorized.json()).toEqual({ healthy: true, version: expect.any(String) })
    } finally {
      server.close()
    }
  }, 60_000)

  test("respects an explicitly configured password", async () => {
    process.env[KEY] = "explicit-password"
    const server = await createCyberstrikeServer({ port: 0, timeout: 30_000 })
    try {
      expect(server.password).toBe("explicit-password")
    } finally {
      server.close()
    }
  }, 60_000)

  test("prefers the password option over the environment variable", async () => {
    process.env[KEY] = "environment-password"
    const server = await createCyberstrikeServer({ port: 0, timeout: 30_000, password: "option-password" })
    try {
      expect(server.password).toBe("option-password")
    } finally {
      server.close()
    }
  }, 60_000)
})

describe("createCyberstrike", () => {
  test("client reaches the api without any password configuration", async () => {
    const { client, server } = await createCyberstrike({ port: 0, timeout: 30_000 })
    try {
      const response = await client.project.list()
      expect(response.error).toBeUndefined()
      expect(response.response?.status).toBe(200)
    } finally {
      server.close()
    }
  }, 60_000)
})

describe("v2", () => {
  test("server starts without CYBERSTRIKE_SERVER_PASSWORD", async () => {
    const server = await createCyberstrikeServerV2({ port: 0, timeout: 30_000 })
    try {
      expect(server.password).toBeTypeOf("string")
      expect(server.password.length).toBeGreaterThan(0)
    } finally {
      server.close()
    }
  }, 60_000)

  test("client reaches the api without any password configuration", async () => {
    const { client, server } = await createCyberstrikeV2({ port: 0, timeout: 30_000 })
    try {
      const response = await client.project.list()
      expect(response.error).toBeUndefined()
      expect(response.response?.status).toBe(200)
    } finally {
      server.close()
    }
  }, 60_000)
})
