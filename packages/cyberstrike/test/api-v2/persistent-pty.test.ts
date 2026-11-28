import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Covers the experimental persistent PTY group against a real server, its v1 PTY domain, and the WebSocket upgrade.
setDefaultTimeout(60_000)

let base: string
let wsBase: string
let stop: () => Promise<void>
let dir: Awaited<ReturnType<typeof tmpdir>>
let sessionID: string

const call = (route: string, body?: unknown, init?: { method?: string; headers?: Record<string, string> }) =>
  fetch(new URL(route, base), {
    method: init?.method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...init?.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// Polls until the probe returns a value, so tests wait on real terminal output rather than fixed sleeps.
const until = async <A>(probe: () => Promise<A | undefined>, ms = 20_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("condition not met in time")
}

const create = (body: Record<string, unknown>) =>
  call(`/api/experimental/session/${sessionID}/terminal`, {
    title: "persistent",
    env: {},
    args: [],
    ...body,
  })

beforeAll(async () => {
  dir = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0, password: "persistent-pw" })
  base = server.url.toString().replace(/\/$/, "")
  wsBase = base.replace(/^http/, "ws")
  stop = server.stop
  sessionID = (await (await call("/api/session", { location: { directory: dir.path } })).json()).data.id
})

afterAll(async () => {
  await stop()
  await dir[Symbol.asyncDispose]()
})

test("a session with no persistent terminal reads null and lists none; an unknown session cannot create one", async () => {
  const read = await call(`/api/experimental/session/${sessionID}/terminal/read`)
  expect(read.status).toBe(200)
  expect(await read.json()).toEqual({ data: null })

  const list = await call(`/api/experimental/session/${sessionID}/terminal`)
  expect((await list.json()).data).toEqual([])

  const orphan = await create({ command: "sh" })
  expect(orphan.status).toBe(200)
  const unknown = await call("/api/experimental/session/ses_unknown/terminal", {
    title: "x",
    env: {},
    args: [],
    command: "sh",
  })
  expect(unknown.status).toBe(400)
  expect((await unknown.json())._tag).toBe("InvalidRequestError")
})

test("a created terminal is listed, read from its live screen, snapshotted and resized", async () => {
  const created = await create({
    command: "sh",
    args: ["-c", "printf 'alpha\\nbeta\\n'; sleep 30"],
    size: { rows: 24, cols: 80 },
  })
  expect(created.status).toBe(200)
  const info = (await created.json()).data
  expect(info.id.startsWith("pty")).toBe(true)
  expect(info).toMatchObject({ sessionID, status: "running", size: { rows: 24, cols: 80 }, title: "persistent" })
  expect(info.output).toEqual({ head: 0, tail: 0 })

  const read = await until(async () => {
    const body = (await (await call(`/api/experimental/session/${sessionID}/terminal/read?lines=2`)).json()).data
    return body?.screen.text.includes("beta") ? body : undefined
  })
  expect(read).toMatchObject({ ptyID: info.id, screen: { cols: 80, rows: 24 } })
  expect(read.screen.text).toBe("beta\n")

  const list = (await (await call(`/api/experimental/session/${sessionID}/terminal`)).json()).data
  expect(list.map((item: { id: string }) => item.id)).toContain(info.id)

  const got = await call(`/api/experimental/persistent-pty/${info.id}`)
  expect((await got.json()).data).toMatchObject({ id: info.id, sessionID })

  const snapshot = await call(`/api/experimental/persistent-pty/${info.id}/snapshot`)
  expect(snapshot.status).toBe(200)
  const shot = (await snapshot.json()).data
  expect(shot.text).toContain("alpha")
  expect(shot.text).toContain("beta")
  expect(typeof shot.cursor.x).toBe("number")
  expect(typeof shot.cursor.y).toBe("number")
  expect(shot.checkpoint).toBeDefined()

  const updated = await call(
    `/api/experimental/persistent-pty/${info.id}`,
    { size: { rows: 30, cols: 100 } },
    { method: "PUT" },
  )
  expect(updated.status).toBe(200)
  expect((await updated.json()).data.size).toEqual({ rows: 30, cols: 100 })

  const removed = await call(`/api/experimental/persistent-pty/${info.id}`, undefined, { method: "DELETE" })
  expect(removed.status).toBe(204)
  const gone = await call(`/api/experimental/persistent-pty/${info.id}`)
  expect(gone.status).toBe(404)
  expect((await gone.json())._tag).toBe("PtyNotFoundError")
})

test("connect tokens need the ticket header, authorize one upgrade, and a handoff ticket attaches the same way", async () => {
  const created = await create({ command: "sh", args: ["-c", "printf 'handoff-ready'; sleep 30"] })
  const id = (await created.json()).data.id as string

  expect((await call(`/api/experimental/persistent-pty/${id}/connect-token`, {}, { method: "POST" })).status).toBe(403)
  const issued = await call(
    `/api/experimental/persistent-pty/${id}/connect-token`,
    {},
    { method: "POST", headers: { "x-opencode-ticket": "1" } },
  )
  expect(issued.status).toBe(200)
  const token = (await issued.json()).data
  expect(token.expires_in).toBeGreaterThan(0)

  const attach = (ticket: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`${wsBase}/api/experimental/persistent-pty/${id}/connect?ticket=${ticket}`)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error("no replayed output"))
      }, 20_000)
      socket.onmessage = (event) => {
        const text = String(event.data)
        if (!text.includes("handoff-ready")) return
        clearTimeout(timer)
        socket.close()
        resolve(text)
      }
      socket.onerror = () => reject(new Error("websocket error"))
    })

  expect(await attach(token.ticket)).toContain("handoff-ready")
  const plain = await fetch(`${base}/api/experimental/persistent-pty/${id}/connect?ticket=${token.ticket}`, {
    headers: { upgrade: "websocket" },
  })
  expect(plain.status).toBe(403)

  const handoff = await call("/api/experimental/persistent-pty/handoff", {})
  expect(handoff.status).toBe(200)
  const offered = (await handoff.json()).handoff
  expect(typeof offered.instanceID).toBe("string")
  expect(offered.expiresAt).toBeGreaterThan(Date.now())
  expect(await attach(offered.ticket as string)).toContain("handoff-ready")

  expect((await call(`/api/experimental/persistent-pty/${id}`, undefined, { method: "DELETE" })).status).toBe(204)
})

test("a terminal whose process exits leaves the persistent list, and shutdown ends the rest", async () => {
  const short = await create({ command: "sh", args: ["-c", "printf done"] })
  const shortID = (await short.json()).data.id as string
  await until(async () => {
    const got = await call(`/api/experimental/persistent-pty/${shortID}`)
    return got.status === 404 ? true : undefined
  })
  const listed = (await (await call(`/api/experimental/session/${sessionID}/terminal`)).json()).data
  expect(listed.map((item: { id: string }) => item.id)).not.toContain(shortID)

  const long = await create({ command: "sh", args: ["-c", "sleep 30"] })
  const longID = (await long.json()).data.id as string
  const shutdown = await call("/api/experimental/persistent-pty/shutdown", {})
  expect(shutdown.status).toBe(204)
  expect((await call(`/api/experimental/persistent-pty/${longID}`)).status).toBe(404)
  expect((await call(`/api/experimental/session/${sessionID}/terminal`)).status).toBe(200)
  expect((await (await call(`/api/experimental/session/${sessionID}/terminal`)).json()).data).toEqual([])
})
