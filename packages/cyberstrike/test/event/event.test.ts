import { describe, expect, test } from "bun:test"
import z from "zod"
import { EngagementEvent } from "../../src/event"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"

describe("engagement event normalization", () => {
  test("records tool lifecycle without arguments or output", () => {
    const event = EngagementEvent.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_test",
          messageID: "msg_test",
          sessionID: "ses_test",
          type: "tool",
          callID: "call_test",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "secret command" },
            output: "secret output",
            title: "Inspect host",
            metadata: { output: "secret stream" },
            time: { start: 1, end: 2 },
          },
        },
      },
    })

    expect(event).toEqual({
      sessionID: "ses_test",
      type: "message.part.updated",
      source: "tool",
      correlationID: "call_test",
      parentID: "msg_test",
      data: {
        messageID: "msg_test",
        partID: "prt_test",
        partType: "tool",
        tool: "bash",
        callID: "call_test",
        status: "completed",
        title: "Inspect host",
        startedAt: 1,
        endedAt: 2,
      },
    })
    expect(JSON.stringify(event)).not.toContain("secret")
  })

  test("drops raw streaming deltas", () => {
    expect(
      EngagementEvent.normalize({
        type: "message.part.delta",
        properties: { sessionID: "ses_test", delta: "secret output" },
      }),
    ).toBeUndefined()
  })

  test("uses session info IDs as the session scope", () => {
    expect(
      EngagementEvent.normalize({
        type: "session.created",
        properties: {
          info: {
            id: "ses_test",
            title: "New session",
          },
        },
      }),
    ).toMatchObject({
      sessionID: "ses_test",
      correlationID: "ses_test",
      data: {
        id: "ses_test",
        title: "New session",
      },
    })
  })

  test("summarizes finding lists", () => {
    const event = EngagementEvent.normalize({
      type: "vulnerability.updated",
      properties: {
        sessionID: "ses_test",
        vulnerabilities: [
          { id: "vul_one", description: "secret evidence" },
          { id: "vul_two", description: "more evidence" },
        ],
      },
    })

    expect(event?.source).toBe("finding")
    expect(event?.data).toEqual({ count: 2, ids: ["vul_one", "vul_two"] })
    expect(JSON.stringify(event)).not.toContain("evidence")
  })

  test("classifies Nmap scan updates as tool activity", () => {
    expect(
      EngagementEvent.normalize({
        type: "nmap.scan.updated",
        properties: { sessionID: "ses_test", scanID: "nms_test", hosts: 2 },
      })?.source,
    ).toBe("tool")
  })

  test("summarizes structured session status", () => {
    expect(
      EngagementEvent.normalize({
        type: "session.status",
        properties: { sessionID: "ses_test", status: { type: "busy" } },
      })?.data,
    ).toEqual({ status: "busy" })
  })

  test("preserves counters and identifiers used by live panels", () => {
    expect(
      EngagementEvent.normalize({
        type: "intel.updated",
        properties: { sessionID: "ses_test", entryCount: 2 },
      }),
    ).toMatchObject({
      correlationID: undefined,
      data: { entryCount: 2 },
    })
    expect(
      EngagementEvent.normalize({
        type: "memory.updated",
        properties: { sessionID: "ses_test", entryID: "mem_test", action: "created" },
      }),
    ).toMatchObject({
      correlationID: "mem_test",
      data: { entryID: "mem_test", action: "created" },
    })
  })

  test("persists and lists session events", async () => {
    await using tmp = await tmpdir()
    const sessionID = `ses_event_${Date.now()}`
    const event = BusEvent.define("test.engagement.event", z.object({ sessionID: z.string(), status: z.string() }))

    await Instance.provide({
      directory: tmp.path,
      init: () => {
        EngagementEvent.init()
        return Promise.resolve()
      },
      fn: async () => {
        const streamed: EngagementEvent.Info[] = []
        const unsub = EngagementEvent.subscribe((item) => streamed.push(item))
        await Bus.publish(event, { sessionID, status: "running" })
        const rows = EngagementEvent.list({ sessionID })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          sessionID,
          type: "test.engagement.event",
          source: "system",
          data: { status: "running" },
        })
        expect(streamed).toHaveLength(1)
        expect(streamed[0]?.id).toBe(rows[0]?.id)
        unsub()
        await Instance.dispose()
      },
    })
  })

  test("preserves repeated session lifecycle events", async () => {
    await using tmp = await tmpdir()
    const sessionID = `ses_lifecycle_${Date.now()}`
    const event = BusEvent.define("session.idle", z.object({ sessionID: z.string() }))

    await Instance.provide({
      directory: tmp.path,
      init: () => {
        EngagementEvent.init()
        return Promise.resolve()
      },
      fn: async () => {
        await Bus.publish(event, { sessionID })
        await Bus.publish(event, { sessionID })
        expect(EngagementEvent.list({ sessionID })).toHaveLength(2)
        await Instance.dispose()
      },
    })
  })

  test("deduplicates correlated events within each session", async () => {
    await using tmp = await tmpdir()
    const event = BusEvent.define(
      "dossier.note.updated",
      z.object({ sessionID: z.string(), entityID: z.string(), count: z.number() }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: () => {
        EngagementEvent.init()
        return Promise.resolve()
      },
      fn: async () => {
        await Bus.publish(event, { sessionID: "ses_one", entityID: "host:example", count: 1 })
        await Bus.publish(event, { sessionID: "ses_two", entityID: "host:example", count: 1 })
        expect(EngagementEvent.list({ sessionID: "ses_one" })).toHaveLength(1)
        expect(EngagementEvent.list({ sessionID: "ses_two" })).toHaveLength(1)
        await Instance.dispose()
      },
    })
  })

  test("pages events sharing the same timestamp without gaps", async () => {
    await using tmp = await tmpdir()
    const sessionID = `ses_cursor_${Date.now()}`
    const event = BusEvent.define("test.cursor", z.object({ sessionID: z.string(), id: z.string() }))
    const original = Date.now
    Date.now = () => 1_788_000_000_000

    try {
      await Instance.provide({
        directory: tmp.path,
        init: () => {
          EngagementEvent.init()
          return Promise.resolve()
        },
        fn: async () => {
          await Bus.publish(event, { sessionID, id: "one" })
          await Bus.publish(event, { sessionID, id: "two" })
          await Bus.publish(event, { sessionID, id: "three" })
          const latest = EngagementEvent.list({ sessionID, limit: 1 })
          const older = EngagementEvent.list({
            sessionID,
            before: latest[0]!.time,
            beforeID: latest[0]!.id,
            limit: 2,
          })
          expect(new Set([...older, ...latest].map((item) => item.correlationID))).toEqual(
            new Set(["one", "two", "three"]),
          )
          await Instance.dispose()
        },
      })
    } finally {
      Date.now = original
    }
  })

  test("preserves lossy aggregate updates", async () => {
    await using tmp = await tmpdir()
    const sessionID = `ses_aggregate_${Date.now()}`
    const event = BusEvent.define(
      "vulnerability.updated",
      z.object({
        sessionID: z.string(),
        vulnerabilities: z.array(z.object({ id: z.string(), severity: z.string() })),
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: () => {
        EngagementEvent.init()
        return Promise.resolve()
      },
      fn: async () => {
        await Bus.publish(event, { sessionID, vulnerabilities: [{ id: "vul_test", severity: "low" }] })
        await Bus.publish(event, { sessionID, vulnerabilities: [{ id: "vul_test", severity: "critical" }] })
        expect(EngagementEvent.list({ sessionID })).toHaveLength(2)
        await Instance.dispose()
      },
    })
  })

  test("signals that the live event stream is connected", async () => {
    await using tmp = await tmpdir()
    const abort = new AbortController()
    const response = await Server.App().request(
      `/event-log/session/ses_stream/stream?directory=${encodeURIComponent(tmp.path)}`,
      { signal: abort.signal },
    )
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await Promise.race([
      reader.read(),
      Bun.sleep(1_000).then(() => {
        throw new Error("event stream connection signal timed out")
      }),
    ])
    expect(new TextDecoder().decode(first.value)).toContain(": connected")
    abort.abort()
    await reader.cancel()
    await Instance.disposeAll()
  })

  test("closes the live event stream when its instance is disposed", async () => {
    await using tmp = await tmpdir()
    const response = await Server.App().request(
      `/event-log/session/ses_stream/stream?directory=${encodeURIComponent(tmp.path)}`,
    )
    const reader = response.body!.getReader()
    await reader.read()
    await Instance.provide({ directory: tmp.path, fn: () => Instance.dispose() })
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(1_000).then(() => {
        throw new Error("event stream did not close during instance disposal")
      }),
    ])
    expect(result.done).toBe(true)
  })
})
