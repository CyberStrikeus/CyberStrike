import { expect, test } from "bun:test"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

// Real commands only: each test spawns a short shell command and reads its captured output.

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

test("a running command is listed, pages its output by cursor, and remove kills its process tree", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, server.url), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  try {
    const created = await call("/api/shell", {
      body: { command: "printf 'hello\\n'; sleep 60 & echo child:$!; wait" },
    })
    expect(created.status).toBe(200)
    const info = (await created.json()).data
    expect(info).toMatchObject({ status: "running", cwd: tmp.path })
    const id: string = info.id

    const withChild = await until(
      () => call(`/api/shell/${id}/output`).then((res) => res.json()),
      (page) => page.data.output.includes("child:"),
    )
    const childPid = Number(withChild.data.output.match(/child:(\d+)/)?.[1])
    expect(childPid).toBeGreaterThan(0)
    expect(alive(childPid)).toBe(true)

    const listed = await (await call("/api/shell")).json()
    expect(listed.data.map((item: { id: string }) => item.id)).toContain(id)

    // Pages reassemble to the full output, and the cursor always advances.
    const first = (await (await call(`/api/shell/${id}/output?cursor=0&limit=6`)).json()).data
    expect(first.output).toBe("hello\n")
    expect(first.cursor).toBe(6)
    expect(first.truncated).toBe(true)

    const got = await call(`/api/shell/${id}`)
    expect(got.status).toBe(200)
    expect((await got.json()).data).toMatchObject({ id, status: "running" })

    const removed = await call(`/api/shell/${id}`, { method: "DELETE" })
    expect(removed.status).toBe(204)

    const missing = await call(`/api/shell/${id}`)
    expect(missing.status).toBe(404)
    expect((await missing.json())._tag).toBe("ShellNotFoundError")
    const missingOutput = await call(`/api/shell/${id}/output`)
    expect(missingOutput.status).toBe(404)

    const after = await (await call("/api/shell")).json()
    expect(after.data.map((item: { id: string }) => item.id)).not.toContain(id)

    // The backgrounded child is in the command's process group, so removal takes it down too.
    await until(
      async () => alive(childPid),
      (stillAlive) => !stillAlive,
    )
  } finally {
    await server.stop()
  }
}, 60_000)

test("an exited command keeps its status, exit code and output until removed; timeouts stop the process", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, server.url), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  try {
    const exited = (await (await call("/api/shell", { body: { command: "echo done; exit 3" } })).json()).data
    const settled = await until(
      () => call(`/api/shell/${exited.id}`).then((res) => res.json()),
      (body) => body.data.status !== "running",
    )
    expect(settled.data).toMatchObject({ status: "exited", exit: 3 })
    expect(settled.data.time.completed).toBeGreaterThan(0)

    const output = (await (await call(`/api/shell/${exited.id}/output`)).json()).data
    expect(output).toMatchObject({ output: "done\n", cursor: 5, size: 5, truncated: false })

    const listed = await (await call("/api/shell")).json()
    expect(listed.data.map((item: { id: string }) => item.id)).not.toContain(exited.id)

    const slow = (await (await call("/api/shell", { body: { command: "sleep 60", timeout: 200 } })).json()).data
    const timedOut = await until(
      () => call(`/api/shell/${slow.id}`).then((res) => res.json()),
      (body) => body.data.status !== "running",
    )
    expect(timedOut.data.status).toBe("timeout")

    expect((await call(`/api/shell/${exited.id}`, { method: "DELETE" })).status).toBe(204)
    expect((await call(`/api/shell/${slow.id}`, { method: "DELETE" })).status).toBe(204)
  } finally {
    await server.stop()
  }
}, 60_000)

test("output pages never split a multi-byte character", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const query = `directory=${encodeURIComponent(tmp.path)}`
  const call = (route: string, init?: { method?: string; body?: unknown }) =>
    fetch(new URL(`${route}${route.includes("?") ? "&" : "?"}${query}`, server.url), {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  try {
    const created = (await (await call("/api/shell", { body: { command: "printf 'é€😀\\n'" } })).json()).data
    await until(
      () => call(`/api/shell/${created.id}`).then((res) => res.json()),
      (body) => body.data.status !== "running",
    )

    let cursor = 0
    let text = ""
    let size = Infinity
    while (cursor < size) {
      const page = (await (await call(`/api/shell/${created.id}/output?cursor=${cursor}&limit=1`)).json()).data
      expect(page.cursor).toBeGreaterThan(cursor)
      text += page.output
      cursor = page.cursor
      size = page.size
    }
    expect(text).toBe("é€😀\n")
    expect(text).not.toContain("�")

    expect((await call(`/api/shell/${created.id}`, { method: "DELETE" })).status).toBe(204)
  } finally {
    await server.stop()
  }
}, 60_000)
