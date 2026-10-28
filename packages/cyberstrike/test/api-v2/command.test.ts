import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Command auth runs a locally configured argv. Each provider below sets `options.auth_command` to one scenario.
const OK = "fixture-command-ok"
const FAIL = "fixture-command-fail"
const SLOW = "fixture-command-slow"
const MISSING = "fixture-command-missing"

const provider = (argv: string[]) => ({
  npm: "@ai-sdk/openai-compatible",
  options: { apiKey: "test", baseURL: "http://127.0.0.1:1/v1", auth_command: argv },
  models: { test: { name: "Test", limit: { context: 128000, output: 4096 } } },
})

const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean) => {
  const deadline = Date.now() + 15_000
  while (true) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error("condition not reached in time")
    await Bun.sleep(50)
  }
}

test("command auth runs the configured argv, stores its stdout as the credential, and reports failures and cancels", async () => {
  await using tmp = await tmpdir({
    config: {
      model: `${OK}/test`,
      enabled_providers: [OK, FAIL, SLOW, MISSING],
      provider: {
        [OK]: provider(["/bin/sh", "-c", "echo noise >&2; printf 'sk-from-command\\n'"]),
        [FAIL]: provider(["/bin/sh", "-c", "echo nope >&2; exit 2"]),
        [SLOW]: provider(["/bin/sh", "-c", "sleep 60"]),
        [MISSING]: provider(["/no/such/cyberstrike-command"]),
      },
    },
  })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, server.url), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  const connect = (integrationID: string, methodID: string) =>
    call(`/api/integration/${integrationID}/connect/command`, { body: { methodID } })
  const poll = (integrationID: string, attemptID: string) =>
    until(
      () => call(`/api/integration/${integrationID}/connect/command/${attemptID}`).then((res) => res.json()),
      (body) => body.data.status !== "pending",
    )
  try {
    const listed = await (await call(`/api/integration/${OK}`)).json()
    expect(listed.data.methods).toContainEqual({
      id: "command",
      type: "command",
      label: "Run command",
      command: ["/bin/sh", "-c", "echo noise >&2; printf 'sk-from-command\\n'"],
    })

    const started = await connect(OK, "command")
    expect(started.status).toBe(200)
    const attempt = (await started.json()).data
    expect(typeof attempt.attemptID).toBe("string")
    expect(attempt.time.created).toBeGreaterThan(0)

    const done = await poll(OK, attempt.attemptID)
    expect(done.data).toMatchObject({ status: "complete" })
    expect(done.data.message).toBeUndefined()

    const connected = await (await call(`/api/integration/${OK}`)).json()
    expect(connected.data.connections).toEqual([
      expect.objectContaining({ type: "credential", label: OK, method: "key" }),
    ])

    const failed = (await (await connect(FAIL, "command")).json()).data
    expect(await poll(FAIL, failed.attemptID)).toMatchObject({ data: { status: "failed", message: "Command exited with code 2" } })

    const slow = (await (await connect(SLOW, "command")).json()).data
    const pending = await call(`/api/integration/${SLOW}/connect/command/${slow.attemptID}`)
    expect((await pending.json()).data).toMatchObject({ status: "pending" })
    const cancelled = await call(`/api/integration/${SLOW}/connect/command/${slow.attemptID}`, { method: "DELETE" })
    expect(cancelled.status).toBe(204)
    const gone = await call(`/api/integration/${SLOW}/connect/command/${slow.attemptID}`)
    expect(gone.status).toBe(404)
    expect((await gone.json())._tag).toBe("IntegrationAttemptNotFoundError")

    const unknownMethod = await connect(OK, "no-such-method")
    expect(unknownMethod.status).toBe(404)
    expect((await unknownMethod.json())._tag).toBe("IntegrationMethodNotFoundError")

    const unknownIntegration = await connect("no-such-integration", "command")
    expect(unknownIntegration.status).toBe(404)
    expect((await unknownIntegration.json())._tag).toBe("IntegrationNotFoundError")

    const cannotStart = await connect(MISSING, "command")
    expect(cannotStart.status).toBe(400)
    expect((await cannotStart.json())._tag).toBe("InvalidRequestError")

    const unknownStatus = await call(`/api/integration/${OK}/connect/command/con_missing`)
    expect(unknownStatus.status).toBe(404)
    expect((await unknownStatus.json())._tag).toBe("IntegrationAttemptNotFoundError")
  } finally {
    await server.stop()
  }
}, 60_000)
