import { expect, test } from "bun:test"
import { Schema } from "effect"
import { EventLog } from "@opencode/schema/event-log"
import { SessionEvent } from "@opencode/schema/session-event"
import { listen } from "../../src/api-v2/server"
import { SessionEnvironment } from "../../src/session/environment"
import { SessionInstructions } from "../../src/session/instructions"
import { tmpdir } from "../fixture/fixture"

const decodeLog = Schema.decodeUnknownSync(Schema.Union([SessionEvent.Durable, EventLog.Synced]))

// Reads a finished SSE body into its JSON items.
const frames = (body: string) =>
  body
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)))

test("session instructions, environment, view and log answer from durable session state", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (route: string, body?: unknown, method?: string) =>
    fetch(new URL(route, server.url), {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const session = (await (await call("/api/session", { location: { directory: tmp.path } })).json()).data
    const entries = `/api/experimental/session/${session.id}/instructions/entries`

    const put = await call(`${entries}/style.guide`, { value: "Be terse" }, "PUT")
    expect(put.status).toBe(204)
    const listed = await call(entries)
    expect((await listed.json()).data).toEqual([{ key: "style.guide", value: "Be terse" }])
    expect(SessionInstructions.render(session.id)).toEqual(["Instructions from: api/style.guide\nBe terse"])

    const tooLarge = await call(`${entries}/big.value`, { value: "x".repeat(300 * 1024) }, "PUT")
    expect(tooLarge.status).toBe(413)
    expect((await tooLarge.json())._tag).toBe("InstructionEntryValueTooLargeError")

    const removed = await call(`${entries}/style.guide`, undefined, "DELETE")
    expect(removed.status).toBe(204)
    expect((await (await call(entries)).json()).data).toEqual([])
    expect(SessionInstructions.render(session.id)).toEqual([])

    const environment = await call(
      `/api/session/${session.id}/environment`,
      { variables: { CS_TEST_VAR: "on" } },
      "PUT",
    )
    expect(environment.status).toBe(204)
    expect(SessionEnvironment.get(session.id)).toEqual({ CS_TEST_VAR: "on" })

    const idle = 1_700_000_000_000
    expect((await call(`/api/session/${session.id}/view`, { idle })).status).toBe(204)
    expect((await call(`/api/session/${session.id}/view`, { idle })).status).toBe(204)
    expect((await call(`/api/session/${session.id}/view`, { idle: idle - 1 })).status).toBe(204)

    const log = await call(`/api/experimental/session/${session.id}/log`)
    expect(log.headers.get("content-type")).toContain("text/event-stream")
    const items = frames(await log.text())
    items.forEach((item) => expect(() => decodeLog(item)).not.toThrow())
    // The session.created event is recorded at creation, so the first log entry is the first instruction change.
    expect(items.map((item) => item.type)).toEqual([
      "session.created",
      "session.instructions.updated",
      "session.instructions.updated",
      "session.viewed",
      "log.synced",
    ])
    expect(items[0].durable.seq).toBe(1)
    expect(items[1].data.delta).toEqual({ "api/style.guide": expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(items[2].data.delta).toEqual({ "api/style.guide": "removed" })
    expect(items[3].data).toMatchObject({ idle })
    expect(items[4]).toEqual({ type: "log.synced", aggregateID: session.id, seq: 4 })

    const after = frames(await (await call(`/api/experimental/session/${session.id}/log?after=2`)).text())
    expect(after.map((item) => item.type)).toEqual(["session.instructions.updated", "session.viewed", "log.synced"])
    expect(after[2]).toEqual({ type: "log.synced", aggregateID: session.id, seq: 4 })
  } finally {
    await server.stop()
  }
}, 60_000)

test("session move, import and inbox answer from real session state", async () => {
  await using tmp = await tmpdir()
  await using other = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (route: string, body?: unknown, method?: string) =>
    fetch(new URL(route, server.url), {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const session = (await (await call("/api/session", { location: { directory: tmp.path } })).json()).data

    const missingDir = await call(`/api/session/${session.id}/move`, { directory: `${tmp.path}/does-not-exist` })
    expect(missingDir.status).toBe(400)
    expect((await missingDir.json())._tag).toBe("InvalidRequestError")

    const moved = await call(`/api/session/${session.id}/move`, { directory: other.path })
    expect(moved.status).toBe(204)
    const fetched = (await (await call(`/api/session/${session.id}`)).json()).data
    expect(fetched.location.directory).toBe(other.path)

    const imported = { ...fetched, id: "ses_imported_remaining" }
    const missingParent = await call("/api/experimental/session/import", {
      info: { ...imported, parentID: "ses_missing_parent" },
      messages: [],
    })
    expect(missingParent.status).toBe(404)
    expect((await missingParent.json())._tag).toBe("SessionNotFoundError")

    const created = await call("/api/experimental/session/import", { info: imported, messages: [] })
    expect(created.status).toBe(200)
    expect((await created.json()).data).toMatchObject({ id: "ses_imported_remaining", title: fetched.title })
    const duplicate = await call("/api/experimental/session/import", { info: imported, messages: [] })
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json())._tag).toBe("ConflictError")

    const log = frames(await (await call(`/api/experimental/session/${session.id}/log`)).text())
    expect(log.map((item) => item.type)).toEqual(["session.created", "session.moved", "log.synced"])
    expect(log[1].data).toMatchObject({ location: { directory: other.path } })
    const importLog = frames(await (await call(`/api/experimental/session/ses_imported_remaining/log`)).text())
    expect(importLog[0]).toMatchObject({ type: "session.created", durable: { seq: 1 } })

    // A prompt admitted without resuming stays in the inbox until the loop answers it.
    const admitted = await call(`/api/session/${session.id}/prompt`, {
      id: "msg_inbox_remaining",
      text: "hold",
      resume: false,
    })
    expect(admitted.status).toBe(200)
    const inbox = (await (await call(`/api/session/${session.id}/inbox`)).json()).data
    expect(inbox).toMatchObject([
      { id: "msg_inbox_remaining", type: "user", delivery: "queue", payload: { text: "hold" } },
    ])

    const missingItem = await call(`/api/session/${session.id}/inbox/msg_inbox_absent`, { delivery: "queue" }, "PATCH")
    expect(missingItem.status).toBe(409)
    expect((await missingItem.json())._tag).toBe("ConflictError")

    const retimed = await call(`/api/session/${session.id}/inbox/msg_inbox_remaining`, { delivery: "queue" }, "PATCH")
    expect(retimed.status).toBe(204)

    const cancelled = await call(`/api/session/${session.id}/inbox/msg_inbox_remaining`, undefined, "DELETE")
    expect(cancelled.status).toBe(204)
    expect((await (await call(`/api/session/${session.id}/inbox`)).json()).data).toEqual([])
    const again = await call(`/api/session/${session.id}/inbox/msg_inbox_remaining`, undefined, "DELETE")
    expect(again.status).toBe(204)
  } finally {
    await server.stop()
  }
}, 60_000)
