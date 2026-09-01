import { describe, expect, test } from "bun:test"
import z from "zod"
import { EngagementEvent } from "../../src/event"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

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
})
