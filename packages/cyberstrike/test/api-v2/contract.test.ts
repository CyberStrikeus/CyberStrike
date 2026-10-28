import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import path from "node:path"
import { listen } from "../../src/api-v2/server"
import { Schema } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Config } from "@opencode/schema/config"

// The no-prompt cases of the opencodex v2 contract gate, run in-process. The real prompt cases need a model and
// are opt-in there; they are not run here.
// The first request for a directory boots that instance (several seconds, as the v1 server does too).
setDefaultTimeout(60_000)
const PASSWORD = "contract-pw"
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

const call = (method: string, route: string, body?: unknown) =>
  fetch(`${base}${route}`, {
    method,
    headers: {
      authorization: AUTH,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const json = async (res: Response) => (await res.json().catch(() => null)) as Record<string, any> | null

test("v1 health is not a json document and v2 info carries a version", async () => {
  const health = await call("GET", "/global/health")
  expect(health.status).toBe(404)
  const info = await call("GET", "/api/info")
  expect(info.status).toBe(200)
  expect(typeof (await json(info))?.version).toBe("string")
  expect((await call("GET", "/api/health")).status).toBe(404)
})

test("session lifecycle: create, list, get, patch, delete", async () => {
  const created = await call("POST", "/api/session", { location: { directory: DIRECTORY } })
  expect(created.status).toBe(200)
  const session = (await json(created))?.data
  expect(session.id.startsWith("ses_")).toBe(true)
  expect(session.location.directory).toBe(DIRECTORY)
  const id = session.id

  const listed = await json(await call("GET", "/api/session?limit=50"))
  expect(listed?.data.map((item: { id: string }) => item.id)).toContain(id)

  const got = await json(await call("GET", `/api/session/${id}`))
  expect(got?.data.id).toBe(id)

  const patched = await call("PATCH", `/api/session/${id}`, { title: "contract-probe" })
  expect(patched.status).toBe(204)
  expect(await patched.text()).toBe("")
  const renamed = await json(await call("GET", `/api/session/${id}`))
  expect(renamed?.data.title).toBe("contract-probe")

  const archived = await call("PATCH", `/api/session/${id}`, { time: { archived: 1 } })
  expect(archived.status).toBe(204)
  const after = await json(await call("GET", `/api/session/${id}`))
  expect(after?.data.time.archived).toBeUndefined()

  expect((await call("DELETE", `/api/session/${id}`)).status).toBe(204)
})

test("the v1 prompt body is rejected and an idle interrupt answers a bool", async () => {
  const created = await json(await call("POST", "/api/session", { location: { directory: DIRECTORY } }))
  const id = created?.data.id
  expect((await call("POST", `/api/session/${id}/prompt`, { parts: [{ type: "text", text: "ping" }] })).status).toBe(
    400,
  )

  const interrupt = await call("POST", `/api/session/${id}/interrupt`, {})
  expect(interrupt.status).toBe(200)
  expect(typeof (await json(interrupt))?.interrupted).toBe("boolean")

  await call("DELETE", `/api/session/${id}`)
})

test("switch agent and model answer 204 with an empty body", async () => {
  const created = await json(await call("POST", "/api/session", { location: { directory: DIRECTORY } }))
  const id = created?.data.id
  const agent = await call("POST", `/api/session/${id}/agent`, { agent: "build" })
  expect(agent.status).toBe(204)
  const model = await call("POST", `/api/session/${id}/model`, { model: { id: "gpt-5", providerID: "openai" } })
  expect(model.status).toBe(204)
  await call("DELETE", `/api/session/${id}`)
})

test("catalog and location endpoints answer the shapes the gate checks", async () => {
  expect((await json(await call("GET", "/api/location")))?.project.id).toEqual(expect.any(String))
  expect(Array.isArray(await json(await call("GET", "/api/project")))).toBe(true)
  expect((await call("GET", "/api/project/current")).status).toBe(404)
  expect(Array.isArray((await json(await call("GET", "/api/agent")))?.data)).toBe(true)
  expect(Array.isArray((await json(await call("GET", "/api/provider")))?.data)).toBe(true)
  expect(Array.isArray((await json(await call("GET", "/api/model")))?.data)).toBe(true)
  expect(await json(await call("GET", "/api/model/default"))).toHaveProperty("data")
  expect(Array.isArray(await json(await call("GET", "/api/config")))).toBe(true)
})

test("catalog entries conform to upstream schemas, not just their envelopes", async () => {
  const agents = await json(await call("GET", "/api/agent"))
  expect(agents?.data.length).toBeGreaterThan(0)
  expect(() => Schema.decodeUnknownSync(Schema.Array(Agent.Info))(agents?.data)).not.toThrow()
  const models = await json(await call("GET", "/api/model"))
  expect(() => Schema.decodeUnknownSync(Schema.Array(Model.Info))(models?.data)).not.toThrow()
  const providers = await json(await call("GET", "/api/provider"))
  expect(() => Schema.decodeUnknownSync(Schema.Array(Provider.Info))(providers?.data)).not.toThrow()
  const config = await json(await call("GET", "/api/config"))
  expect(Array.isArray(config)).toBe(true)
  expect(() => Schema.decodeUnknownSync(Schema.Array(Config.Entry))(config)).not.toThrow()
})

test("permission and form endpoints answer unknown ids with a typed 404", async () => {
  const created = await json(await call("POST", "/api/session", { location: { directory: DIRECTORY } }))
  const id = created?.data.id
  expect(Array.isArray((await json(await call("GET", `/api/session/${id}/permission`)))?.data)).toBe(true)
  expect(Array.isArray((await json(await call("GET", `/api/session/${id}/form`)))?.data)).toBe(true)

  const permission = await call("POST", `/api/session/${id}/permission/per_missing/reply`, { decision: "once" })
  expect(permission.status).toBe(404)
  expect((await json(permission))?._tag).toBe("PermissionNotFoundError")

  const reply = await call("POST", `/api/session/${id}/form/frm_missing/reply`, { answer: {} })
  expect(reply.status).toBe(404)
  expect((await json(reply))?._tag).toBe("FormNotFoundError")

  expect((await call("DELETE", `/api/session/${id}/form/frm_missing`)).status).toBe(404)
  await call("DELETE", `/api/session/${id}`)
})

test("fs and vcs answer lists, reads and typed not-found", async () => {
  const listed = await json(await call("GET", "/api/fs/list"))
  expect(Array.isArray(listed?.data)).toBe(true)
  expect(Array.isArray((await json(await call("GET", "/api/fs/list?path=.")))?.data)).toBe(true)
  expect(Array.isArray((await json(await call("GET", "/api/fs/find?query=README&limit=5")))?.data)).toBe(true)

  const vcs = await call("GET", `/api/vcs/status?location%5Bdirectory%5D=${encodeURIComponent(DIRECTORY)}`)
  expect(vcs.status).toBe(200)

  const missing = await call("GET", "/api/fs/read/no-such-file-anywhere.txt")
  expect(missing.status).toBe(404)
  expect((await json(missing))?._tag).toBe("FileNotFoundError")

  const escape = await call("GET", "/api/fs/read/..%2F..%2F..%2Fetc%2Fpasswd")
  expect(escape.status).toBe(404)
})

test("a location that is not a directory is a typed 404, not a 500", async () => {
  const res = await call("GET", "/api/location?location%5Bdirectory%5D=/no/such/directory/anywhere")
  expect(res.status).toBe(404)
  expect((await json(res))?._tag).toBe("LocationNotFoundError")
})

test("listing a file instead of a directory is a typed 404", async () => {
  const res = await call("GET", "/api/fs/list?path=package.json")
  expect(res.status).toBe(404)
  expect((await json(res))?._tag).toBe("FileNotFoundError")
})

test("the event feed opens with server.connected", async () => {
  const controller = new AbortController()
  const res = await fetch(`${base}/api/event`, {
    headers: { authorization: AUTH, accept: "text/event-stream" },
    signal: controller.signal,
  })
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  expect(text.startsWith('data: {"type":"server.connected","data":{}}')).toBe(true)
  controller.abort()
})

test("groups with no backing still answer 503", async () => {
  expect((await call("GET", "/api/experimental/voice/models")).status).toBe(503)
  expect((await call("GET", "/api/credential")).status).toBe(200)
})
