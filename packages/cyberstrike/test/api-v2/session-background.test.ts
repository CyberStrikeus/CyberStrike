import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Real commands only: the bash tool runs through its own path, and the endpoints are called over HTTP.

const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean) => {
  const deadline = Date.now() + 15_000
  while (true) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error("condition not reached in time")
    await Bun.sleep(50)
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test("background moves the running bash command into the shell registry and its tool call returns the shell id", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, server.url), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  try {
    const { data } = await (
      await fetch(new URL("/api/session", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: { directory: tmp.path } }),
      })
    ).json()
    const started = Promise.withResolvers<void>()
    const ctx = {
      sessionID: data.id as string,
      messageID: "",
      callID: "",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: (input: { metadata?: { output?: string } }) => {
        if (input.metadata?.output?.includes("started")) started.resolve()
      },
      ask: async () => {},
    }

    const pending = Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        return bash.execute({ command: "echo started; sleep 1; echo later; sleep 60", description: "Long command" }, ctx)
      },
    })
    await started.promise

    const backgrounded = await call(`/api/session/${data.id}/background`, { method: "POST" })
    expect(backgrounded.status).toBe(204)

    // The tool call returns at once with the registry id instead of waiting for the command.
    const result = await pending
    const id = result.output.match(/shell (sh_\w+)/)?.[1]
    expect(id).toBeDefined()

    const info = (await (await call(`/api/shell/${id}`)).json()).data
    expect(info).toMatchObject({ id, status: "running", command: expect.stringContaining("sleep 60") })
    const pid: number = info.pid
    expect(alive(pid)).toBe(true)

    // Output written after the tool call returned still reaches the registry's file.
    const page = await until(
      () => call(`/api/shell/${id}/output`).then((res) => res.json()),
      (value) => value.data.output.includes("later"),
    )
    expect(page.data.output).toContain("started")

    const removed = await call(`/api/shell/${id}`, { method: "DELETE" })
    expect(removed.status).toBe(204)
    await until(
      async () => alive(pid),
      (stillAlive) => !stillAlive,
    )
  } finally {
    await server.stop()
  }
}, 60_000)

test("background is a no-op when the session has no running bash command", async () => {
  await using tmp = await tmpdir({ git: true })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  try {
    const { data } = await (
      await fetch(new URL("/api/session", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: { directory: tmp.path } }),
      })
    ).json()

    const idle = await fetch(new URL(`/api/session/${data.id}/background?directory=${encodeURIComponent(tmp.path)}`, server.url), {
      method: "POST",
    })
    expect(idle.status).toBe(204)

    const finished = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        return bash.execute(
          { command: "echo done", description: "Finished command" },
          {
            sessionID: data.id,
            messageID: "",
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )
      },
    })
    expect(finished.output).toBe("done\n")

    const after = await fetch(new URL(`/api/session/${data.id}/background?directory=${encodeURIComponent(tmp.path)}`, server.url), {
      method: "POST",
    })
    expect(after.status).toBe(204)

    const missing = await fetch(new URL(`/api/session/ses_missing/background?directory=${encodeURIComponent(tmp.path)}`, server.url), {
      method: "POST",
    })
    expect(missing.status).toBe(404)
  } finally {
    await server.stop()
  }
}, 60_000)
