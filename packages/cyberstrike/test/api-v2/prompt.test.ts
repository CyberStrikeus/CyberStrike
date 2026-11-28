import { expect, test } from "bun:test"
import path from "node:path"
import { listen } from "../../src/api-v2/server"
import { tmpdir } from "../fixture/fixture"

test("prompt admission persists client IDs and inline files before returning, without resuming", async () => {
  await using tmp = await tmpdir({
    config: {
      model: "contract/test",
      enabled_providers: ["contract"],
      provider: {
        contract: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test", baseURL: "http://127.0.0.1:1/v1" },
          models: { test: { name: "Test", limit: { context: 128000, output: 4096 } } },
        },
      },
    },
  })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const call = (route: string, body?: unknown) =>
    fetch(new URL(route, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    const session = (await (await call("/api/session", { location: { directory: tmp.path } })).json()).data
    const admitted = await call(`/api/session/${session.id}/prompt`, {
      id: "msg_contract_client",
      text: "contract ping",
      resume: false,
      files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "pixel.png" }],
    })
    expect(admitted.status).toBe(200)
    expect((await admitted.json()).data).toMatchObject({
      id: "msg_contract_client",
      sessionID: session.id,
      type: "user",
      delivery: "queue",
      payload: { text: "contract ping", files: [{ data: "aGVsbG8=", mime: "image/png", name: "pixel.png" }] },
    })
    const messages = await (await call(`/api/session/${session.id}/message`)).json()
    expect(messages.data).toMatchObject([
      { id: "msg_contract_client", files: [{ data: "aGVsbG8=", mime: "image/png" }] },
    ])
    expect((await (await call(`/api/session/${session.id}/interrupt`, {})).json()).interrupted).toBe(false)
    expect(
      (
        await call(`/api/session/${session.id}/prompt`, {
          id: "msg_contract_client",
          text: "overwrite",
          resume: false,
        })
      ).status,
    ).toBe(409)
    const duplicate = await Promise.all(
      ["first", "second"].map((text) =>
        call(`/api/session/${session.id}/prompt`, {
          id: "msg_contract_duplicate",
          text,
          resume: false,
        }),
      ),
    )
    expect(duplicate.map((response) => response.status).sort()).toEqual([200, 409])
    expect(
      (
        await call(`/api/session/${session.id}/prompt`, {
          text: "bad",
          files: [{ uri: "data:image/png;base64,not-base64!" }],
        })
      ).status,
    ).toBe(400)
    await fetch(new URL(`/api/session/${session.id}`, server.url), { method: "DELETE" })
  } finally {
    await server.stop()
  }
}, 60_000)

test("a local model streams replies and interrupt stays responsive under HTTP and token load", async () => {
  const encoder = new TextEncoder()
  const chunk = (text: string, finish: string | null = null) =>
    encoder.encode(
      `data: ${JSON.stringify({
        id: "chatcmpl-contract",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { content: text }, finish_reason: finish }],
      })}\n\n`,
    )
  const state = { slow: false, calls: 0 }
  const timers = new Set<ReturnType<typeof setInterval>>()
  const model = Bun.serve({
    port: 0,
    fetch: async (request) => {
      await request.json()
      state.calls++
      let timer: ReturnType<typeof setInterval> | undefined
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk("contract reply"))
            if (state.slow) {
              timer = setInterval(() => controller.enqueue(chunk(" more")), 5)
              timers.add(timer)
              return
            }
            controller.enqueue(chunk("", "stop"))
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
          },
          cancel() {
            clearInterval(timer)
            if (timer) timers.delete(timer)
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  await using tmp = await tmpdir({
    config: {
      model: "contract/test",
      small_model: "contract/test",
      enabled_providers: ["contract", "openai"],
      agent: { contract: { mode: "primary", prompt: "Reply briefly.", tools: { "*": false } } },
      default_agent: "contract",
      provider: {
        contract: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test", baseURL: `${model.url.origin}/v1` },
          models: { test: { name: "Test", tool_call: true, limit: { context: 128000, output: 4096 } } },
        },
        openai: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test", baseURL: `${model.url.origin}/v1` },
          models: { "gpt-5": { name: "Contract GPT", limit: { context: 128000, output: 4096 } } },
        },
      },
    },
  })
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const abort = new AbortController()
  const call = (route: string, body?: unknown) =>
    fetch(new URL(route, server.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  try {
    const session = (
      await (await call("/api/session", { title: "contract", location: { directory: tmp.path } })).json()
    ).data
    const events = await fetch(new URL("/api/event", server.url), { signal: abort.signal })
    const reader = events.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const next = async (type: string) => {
      while (true) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary >= 0) {
          const line = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = JSON.parse(line.slice(6))
          if (event.type === type && event.data.sessionID === session.id) return event.data
          continue
        }
        const item = await reader.read()
        if (item.done) throw new Error(`event stream ended before ${type}`)
        buffer += decoder.decode(item.value, { stream: true })
      }
    }
    const timeout = setTimeout(() => abort.abort(), 30_000)
    try {
      const admitted = await call(`/api/session/${session.id}/prompt`, { text: "ping" })
      expect(admitted.status).toBe(200)
      const delta = await next("session.text.delta")
      expect(delta.delta).toBe("contract reply")
      expect(delta.ordinal).toBe(0)
      await next("session.idle")
      const messages = (await (await call(`/api/session/${session.id}/message`)).json()).data
      expect(
        messages.some(
          (message: { type: string; content?: { text?: string }[] }) =>
            message.type === "assistant" && message.content?.some((part) => part.text === "contract reply"),
        ),
      ).toBe(true)
      const gate = Bun.spawn(
        ["python3", "-I", path.resolve(import.meta.dir, "../../../../script/v2-contract-check.py")],
        {
          env: {
            ...process.env,
            V2_BASE: server.url.origin,
            V2_DIRECTORY: tmp.path,
            V2_PASSWORD: "contract",
            V2_ALLOW_PROMPT: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const output = await new Response(gate.stdout).text()
      await gate.exited
      for (const name of [
        "text-prompt-admitted",
        "message-list-has-text",
        "file-prompt-data-uri",
        "format-field-ignored",
        "prompt-id-honored",
      ]) {
        expect(output).toContain(`PASS  ${name} `)
      }
      state.slow = true
      expect((await call(`/api/session/${session.id}/prompt`, { text: "keep streaming" })).status).toBe(200)
      await next("session.text.delta")
      const started = Date.now()
      const [interrupt, ...load] = await Promise.all([
        call(`/api/session/${session.id}/interrupt`, {}),
        ...Array.from({ length: 20 }, () => call(`/api/session/${session.id}`)),
      ])
      expect(await interrupt!.json()).toEqual({ interrupted: true })
      expect(load.every((response) => response.status === 200)).toBe(true)
      expect(Date.now() - started).toBeLessThan(5000)
      await next("session.idle")
      expect((await (await call(`/api/session/${session.id}/interrupt`, {})).json()).interrupted).toBe(false)
      expect(state.calls).toBeGreaterThanOrEqual(2)
    } finally {
      clearTimeout(timeout)
      await fetch(new URL(`/api/session/${session.id}`, server.url), { method: "DELETE" })
    }
  } finally {
    abort.abort()
    timers.forEach(clearInterval)
    await server.stop()
    await model.stop(true)
  }
}, 60_000)
