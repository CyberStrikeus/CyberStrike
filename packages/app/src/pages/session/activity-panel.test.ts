import { describe, expect, test } from "bun:test"
import { isActivity, mergeActivity } from "./activity"

const event = (id: string, time: number, title = id) => ({
  id,
  projectID: "project",
  sessionID: "session",
  type: "session.updated",
  source: "agent" as const,
  data: { title },
  time,
})

describe("activity history", () => {
  test("preserves live events that arrive before history", () => {
    expect(mergeActivity([event("one", 1)], [event("two", 2)])).toEqual([event("one", 1), event("two", 2)])
  })

  test("keeps the live version of duplicate events", () => {
    expect(mergeActivity([event("one", 1, "old")], [event("one", 1, "new")])).toEqual([
      event("one", 1, "new"),
    ])
  })

  test("ignores SSE heartbeats", () => {
    expect(isActivity({})).toBe(false)
    expect(isActivity(event("one", 1))).toBe(true)
  })
})
