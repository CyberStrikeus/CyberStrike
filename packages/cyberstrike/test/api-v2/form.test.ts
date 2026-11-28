import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { listen } from "../../src/api-v2/server"
import { inInstance } from "../../src/api-v2/instance"
import { Question } from "../../src/question"
import { PermissionNext } from "../../src/permission/next"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

test("nonempty form and permission lists decode and form values round-trip", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const session = await Effect.runPromise(inInstance(tmp.path, () => Session.create({})))
  const answers = Promise.withResolvers<string[][]>()
  const permission = Promise.withResolvers<void>()
  try {
    await Effect.runPromise(
      inInstance(tmp.path, () => {
        Question.ask({
          sessionID: session.id,
          questions: [
            {
              header: "pick",
              question: "Which?",
              options: [
                { label: "Alpha", description: "First" },
                { label: "Beta", description: "Second" },
              ],
            },
          ],
        }).then(answers.resolve, answers.reject)
        PermissionNext.ask({
          id: "per_contract",
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          always: ["*"],
          metadata: {},
          ruleset: [],
        }).then(permission.resolve, permission.reject)
      }),
    )
    const query = `?location%5Bdirectory%5D=${encodeURIComponent(tmp.path)}`
    const forms = await (await fetch(new URL(`/api/form${query}`, server.url))).json()
    expect(forms.data.length).toBe(1)
    expect(() => Schema.decodeUnknownSync(Schema.Array(Form.Info))(forms.data)).not.toThrow()
    const scoped = await (await fetch(new URL(`/api/session/${session.id}/form`, server.url))).json()
    expect(scoped.data).toEqual(forms.data)
    const permissions = await (await fetch(new URL(`/api/permission/request${query}`, server.url))).json()
    expect(permissions.data.length).toBe(1)
    expect(() => Schema.decodeUnknownSync(Schema.Array(Permission.Request))(permissions.data)).not.toThrow()
    expect(
      (
        await fetch(new URL(`/api/session/${session.id}/form/${forms.data[0].id}/reply`, server.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: {} }),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await fetch(new URL(`/api/session/${session.id}/form/${forms.data[0].id}/reply`, server.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: { "question-0": "Beta" } }),
        })
      ).status,
    ).toBe(204)
    expect(await answers.promise).toEqual([["Beta"]])
    expect(
      (
        await fetch(new URL(`/api/session/${session.id}/permission/per_contract/reply`, server.url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "once" }),
        })
      ).status,
    ).toBe(204)
    await permission.promise
  } finally {
    await Effect.runPromise(inInstance(tmp.path, () => Session.remove(session.id)))
    await server.stop()
  }
}, 60_000)
