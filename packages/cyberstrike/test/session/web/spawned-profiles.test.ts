import { describe, expect, test, beforeEach } from "bun:test"
import { SpawnedProfiles } from "../../../src/session/web/spawned-profiles"

const mkProc = () => {
  let killed = 0
  return { kill: () => (killed += 1), kills: () => killed }
}

beforeEach(() => SpawnedProfiles._reset())

describe("SpawnedProfiles", () => {
  test("track + count per session", () => {
    SpawnedProfiles.track("s1", mkProc())
    SpawnedProfiles.track("s1", mkProc())
    SpawnedProfiles.track("s2", mkProc())
    expect(SpawnedProfiles.count("s1")).toBe(2)
    expect(SpawnedProfiles.count("s2")).toBe(1)
    expect(SpawnedProfiles.count("nope")).toBe(0)
  })

  test("closeAll kills every proc for the session and returns the count", () => {
    const a = mkProc()
    const b = mkProc()
    SpawnedProfiles.track("s1", a)
    SpawnedProfiles.track("s1", b)
    expect(SpawnedProfiles.closeAll("s1")).toBe(2)
    expect(a.kills()).toBe(1)
    expect(b.kills()).toBe(1)
  })

  test("closeAll is idempotent — second call closes nothing", () => {
    SpawnedProfiles.track("s1", mkProc())
    expect(SpawnedProfiles.closeAll("s1")).toBe(1)
    expect(SpawnedProfiles.closeAll("s1")).toBe(0)
    expect(SpawnedProfiles.count("s1")).toBe(0)
  })

  test("closeAll on an unknown session is 0, not a throw", () => {
    expect(SpawnedProfiles.closeAll("ghost")).toBe(0)
  })

  test("closeAllSessions kills every proc across ALL sessions (server teardown)", () => {
    const a = mkProc()
    const b = mkProc()
    const c = mkProc()
    SpawnedProfiles.track("s1", a)
    SpawnedProfiles.track("s1", b)
    SpawnedProfiles.track("s2", c)
    expect(SpawnedProfiles.closeAllSessions()).toBe(3)
    expect(a.kills()).toBe(1)
    expect(b.kills()).toBe(1)
    expect(c.kills()).toBe(1)
    // registry drained → a second teardown closes nothing
    expect(SpawnedProfiles.closeAllSessions()).toBe(0)
    expect(SpawnedProfiles.count("s1")).toBe(0)
    expect(SpawnedProfiles.count("s2")).toBe(0)
  })

  test("a proc that throws on kill doesn't abort the rest", () => {
    const bad = { kill: () => { throw new Error("already dead") } }
    const good = mkProc()
    SpawnedProfiles.track("s1", bad)
    SpawnedProfiles.track("s1", good)
    // bad throws (not counted), good still killed
    expect(SpawnedProfiles.closeAll("s1")).toBe(1)
    expect(good.kills()).toBe(1)
  })
})
