import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import path from "node:path"
import { listen } from "../../src/api-v2/server"

// Covers the v2 PTY group and the native terminal upgrade in src/api-v2/server.ts. No existing test covers it.
setDefaultTimeout(60_000)

const PASSWORD = "pty-pw"
const DIRECTORY = path.resolve(import.meta.dir, "../../../api-v2")
const AUTH = `Basic ${Buffer.from(`cyberstrike:${PASSWORD}`).toString("base64")}`

let base: string
let wsBase: string
let stop: () => Promise<void>

beforeAll(async () => {
  const server = await listen({ hostname: "127.0.0.1", port: 0, password: PASSWORD })
  base = server.url.toString().replace(/\/$/, "")
  wsBase = base.replace(/^http/, "ws")
  stop = server.stop
})

afterAll(async () => {
  await stop()
})

test("a terminal created over HTTP streams its output to a WebSocket client", async () => {
  const created = await fetch(`${base}/api/pty?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`, {
    method: "POST",
    headers: { authorization: AUTH, "content-type": "application/json" },
    body: JSON.stringify({ command: "sh", args: ["-c", "printf v2-terminal-ready; sleep 5"] }),
  })
  expect(created.status).toBe(200)
  const id = (await created.json()).data.id as string
  expect(id.startsWith("pty")).toBe(true)

  const output = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(
      `${wsBase}/api/pty/${id}/connect?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`,
      { headers: { authorization: AUTH } } as unknown as string[],
    )
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error("no terminal output within the window"))
    }, 20_000)
    socket.onmessage = (event) => {
      const text = String(event.data)
      if (!text.includes("v2-terminal-ready")) return
      clearTimeout(timer)
      socket.close()
      resolve(text)
    }
    socket.onerror = () => reject(new Error("websocket error"))
  })
  expect(output).toContain("v2-terminal-ready")

  expect(
    (
      await fetch(`${base}/api/pty/${id}?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`, {
        headers: { authorization: AUTH },
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await fetch(`${base}/api/pty/${id}?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`, {
        method: "DELETE",
        headers: { authorization: AUTH },
      })
    ).status,
  ).toBe(204)
  expect(
    (
      await fetch(`${base}/api/pty/${id}?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`, {
        headers: { authorization: AUTH },
      })
    ).status,
  ).toBe(404)
})

test("the terminal socket refuses an unauthenticated upgrade", async () => {
  // A proxy header makes the request non-loopback, so the password is required.
  const res = await fetch(`${base}/api/pty/pty_missing/connect`, {
    headers: { upgrade: "websocket", "x-forwarded-for": "203.0.113.9" },
  })
  expect(res.status).toBe(401)
})

test("connect tokens require opt-in and authorize only one upgrade for their PTY and directory", async () => {
  const query = `?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`
  const created = await fetch(`${base}/api/pty${query}`, {
    method: "POST",
    headers: { authorization: AUTH, "content-type": "application/json" },
    body: JSON.stringify({ command: "sh", args: ["-c", "sleep 30"] }),
  })
  const id = (await created.json()).data.id as string
  try {
    expect(
      (await fetch(`${base}/api/pty/${id}/connect-token${query}`, { method: "POST", headers: { authorization: AUTH } }))
        .status,
    ).toBe(403)
    const issued = await fetch(`${base}/api/pty/${id}/connect-token${query}`, {
      method: "POST",
      headers: { authorization: AUTH, "x-opencode-ticket": "1" },
    })
    expect(issued.status).toBe(200)
    const token = (await issued.json()).data
    expect(token.expires_in).toBeGreaterThan(0)
    const headers = { upgrade: "websocket", "x-forwarded-for": "203.0.113.9" }
    expect((await fetch(`${base}/api/pty/pty_wrong/connect${query}&ticket=${token.ticket}`, { headers })).status).toBe(
      403,
    )
    expect((await fetch(`${base}/api/pty/${id}/connect?ticket=${token.ticket}`, { headers })).status).toBe(403)
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${wsBase}/api/pty/${id}/connect${query}&ticket=${token.ticket}`, {
        headers: { "x-forwarded-for": "203.0.113.9" },
      } as unknown as string[])
      socket.onopen = () => {
        socket.close()
        resolve()
      }
      socket.onerror = () => reject(new Error("ticket upgrade failed"))
    })
    expect((await fetch(`${base}/api/pty/${id}/connect${query}&ticket=${token.ticket}`, { headers })).status).toBe(403)
  } finally {
    await fetch(`${base}/api/pty/${id}${query}`, { method: "DELETE", headers: { authorization: AUTH } })
  }
})
