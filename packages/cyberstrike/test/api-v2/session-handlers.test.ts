import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionStats } from "@opencode/schema/session-stats"
import { Form } from "@opencode/schema/form"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

test("session stats, export, context, message and synthetic admission answer from real session data", async () => {
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
    const empty = await call(`/api/experimental/session/stats?project=${session.projectID}`)
    expect(empty.status).toBe(200)
    const emptyBody = await empty.json()
    expect(() => Schema.decodeUnknownSync(SessionStats.Info)(emptyBody.data)).not.toThrow()

    const admitted = await call(`/api/session/${session.id}/prompt`, { id: "msg_stats_user", text: "hello", resume: false })
    expect(admitted.status).toBe(200)

    const stats = (await (await call(`/api/experimental/session/stats?project=${session.projectID}`)).json()).data
    expect(stats).toMatchObject({ sessions: 1, prompts: 1, steps: 0 })

    const message = await call(`/api/session/${session.id}/message/msg_stats_user`)
    expect(message.status).toBe(200)
    expect((await message.json()).data).toMatchObject({ id: "msg_stats_user", type: "user", text: "hello" })
    const missing = await call(`/api/session/${session.id}/message/msg_missing`)
    expect(missing.status).toBe(404)
    expect((await missing.json())._tag).toBe("MessageNotFoundError")

    const exported = (await (await call(`/api/experimental/session/${session.id}/export`)).json()).data
    expect(exported.info.id).toBe(session.id)
    expect(exported.messages).toMatchObject([{ id: "msg_stats_user", type: "user" }])

    const context = (await (await call(`/api/session/${session.id}/context`)).json()).data
    expect(context).toMatchObject([{ id: "msg_stats_user" }])

    const synthetic = await call(`/api/session/${session.id}/synthetic`, {
      id: "msg_synthetic_one",
      text: "note for the model",
      metadata: { source: "contract" },
      resume: false,
    })
    expect(synthetic.status).toBe(200)
    expect((await synthetic.json()).data).toMatchObject({
      id: "msg_synthetic_one",
      type: "synthetic",
      payload: { text: "note for the model", metadata: { source: "contract" } },
    })
    const duplicate = await call(`/api/session/${session.id}/synthetic`, {
      id: "msg_synthetic_one",
      text: "again",
      resume: false,
    })
    expect(duplicate.status).toBe(409)
  } finally {
    await server.stop()
  }
}, 60_000)

test("session command, skill, wait and revert answer with declared errors and real state", async () => {
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

    const command = await call(`/api/session/${session.id}/command`, { name: "does-not-exist", text: "" })
    expect(command.status).toBe(404)
    expect((await command.json())._tag).toBe("CommandNotFoundError")

    const skill = await call(`/api/experimental/session/${session.id}/skill`, { id: "no-such-skill", resume: false })
    expect(skill.status).toBe(404)
    expect((await skill.json())._tag).toBe("SkillNotFoundError")

    expect((await call(`/api/experimental/session/${session.id}/wait`, {})).status).toBe(204)

    const stage = await call(`/api/session/${session.id}/revert/stage`, { messageID: "msg_unknown" })
    expect(stage.status).toBe(404)
    expect((await stage.json())._tag).toBe("MessageNotFoundError")

    expect((await call(`/api/session/${session.id}/revert/commit`, {})).status).toBe(204)

    const created = await call(`/api/session/${session.id}/form`, {
      title: "Pick one",
      fields: [
        {
          key: "color",
          type: "multiselect",
          title: "Colors",
          options: [
            { value: "red", label: "Red" },
            { value: "blue", label: "Blue" },
          ],
        },
      ],
    })
    expect(created.status).toBe(200)
    const form = (await created.json()).data
    expect(() => Schema.decodeUnknownSync(Form.Info)(form)).not.toThrow()
    expect(form.fields).toMatchObject([{ key: "question-0", type: "multiselect" }])

    const detail = await call(`/api/session/${session.id}/form/${form.id}`)
    expect(detail.status).toBe(200)
    expect((await detail.json()).data).toMatchObject({ id: form.id, state: { status: "pending" } })

    const unknownForm = await call(`/api/session/${session.id}/form/frm_missing`)
    expect(unknownForm.status).toBe(404)
    expect((await unknownForm.json())._tag).toBe("FormNotFoundError")

    const unsupported = await call(`/api/session/${session.id}/form`, {
      title: "Number",
      fields: [{ key: "count", type: "number", title: "Count" }],
    })
    expect(unsupported.status).toBe(400)
  } finally {
    await server.stop()
  }
}, 60_000)

test("session shell runs the command in the session directory and records it", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  try {
    const session = (
      await (
        await fetch(new URL("/api/session", server.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ location: { directory: tmp.path } }),
        })
      ).json()
    ).data
    const shell = await fetch(new URL(`/api/session/${session.id}/shell`, server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "echo session-shell-marker" }),
    })
    expect(shell.status).toBe(204)
    const context = (await (await fetch(new URL(`/api/session/${session.id}/context`, server.url))).json()).data
    expect(JSON.stringify(context)).toContain("session-shell-marker")
  } finally {
    await server.stop()
  }
}, 60_000)
