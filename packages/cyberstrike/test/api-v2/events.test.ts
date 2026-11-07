import { expect, test } from "bun:test"
import { Effect } from "effect"
import { listen } from "../../src/api-v2/server"
import { inInstance } from "../../src/api-v2/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

test("live text ordinals match projected content, including when subscribing mid-message", async () => {
  await using tmp = await tmpdir()
  const server = await listen({ hostname: "127.0.0.1", port: 0 })
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 20_000)
  try {
    const session = await Effect.runPromise(inInstance(tmp.path, () => Session.create({ title: "ordinals" })))
    const messageID = Identifier.ascending("message")
    const reasoning = Identifier.ascending("part")
    const text = Identifier.ascending("part")
    await Effect.runPromise(
      inInstance(tmp.path, async () => {
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "assistant",
          parentID: "msg_parent",
          agent: "build",
          modelID: "test",
          providerID: "contract",
          mode: "build",
          path: { cwd: tmp.path, root: tmp.path },
          time: { created: Date.now() },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        await Session.updatePart({
          id: reasoning,
          sessionID: session.id,
          messageID,
          type: "reasoning",
          text: "thinking",
          time: { start: 1 },
        })
        await Session.updatePart({ id: text, sessionID: session.id, messageID, type: "text", text: "" })
      }),
    )
    const feed = await fetch(new URL("/api/event", server.url), { signal: abort.signal })
    const reader = feed.body!.getReader()
    await reader.read()
    await Effect.runPromise(
      inInstance(tmp.path, async () => {
        await Session.updatePartDelta({ sessionID: session.id, messageID, partID: text, field: "text", delta: "hello" })
        await Session.updatePart({
          id: text,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "hello",
          time: { start: 1, end: 2 },
        })
      }),
    )
    let buffer = ""
    while (!buffer.includes('"session.text.ended"')) {
      const item = await reader.read()
      if (item.done) throw new Error("stream closed")
      buffer += new TextDecoder().decode(item.value)
    }
    const events = buffer
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(6)))
    expect(events.find((event) => event.type === "session.text.delta")?.data).toMatchObject({
      ordinal: 1,
      delta: "hello",
    })
    expect(events.find((event) => event.type === "session.text.ended")?.data).toMatchObject({
      ordinal: 1,
      text: "hello",
    })
    const messages = await (await fetch(new URL(`/api/session/${session.id}/message`, server.url))).json()
    expect(messages.data[0].content[1]).toEqual({ type: "text", text: "hello" })
    await Effect.runPromise(inInstance(tmp.path, () => Session.remove(session.id)))
  } finally {
    clearTimeout(timeout)
    abort.abort()
    await server.stop()
  }
}, 60_000)
