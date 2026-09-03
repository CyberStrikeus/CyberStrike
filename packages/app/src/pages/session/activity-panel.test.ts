import { describe, expect, test } from "bun:test"
import { activityChannels, activityRefreshChannels, isActivity, mergeActivity } from "./activity"

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

  test("routes live changes to affected workbench surfaces", () => {
    expect(activityChannels({ ...event("memory", 1), type: "memory.updated", source: "system" })).toEqual([
      "activity",
      "memory",
    ])
    expect(activityChannels({ ...event("nmap", 2), type: "nmap.scan.updated", source: "tool" })).toEqual([
      "activity",
      "topology",
    ])
    expect(
      activityChannels({ ...event("finding", 3), type: "vulnerability.updated", source: "finding" }),
    ).toEqual(["activity", "vulns", "mission", "topology"])
    expect(activityChannels({ ...event("intel", 4), type: "intel.updated", source: "finding" })).toEqual([
      "activity",
      "mission",
      "topology",
    ])
  })

  test("refreshes derived surfaces without marking unchanged tabs", () => {
    const idle = { ...event("idle", 1), type: "session.idle" }
    expect(activityChannels(idle)).toEqual(["activity"])
    expect(activityRefreshChannels(idle)).toEqual([
      "mission",
      "topology",
      "memory",
      "mcp",
      "bolt",
      "vulns",
      "web",
    ])
  })
})
