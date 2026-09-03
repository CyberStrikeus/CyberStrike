import { describe, expect, test, beforeEach } from "bun:test"
import { RoleQueue } from "../../../src/session/web/role-queue"

const S = "s1"
const phases = () => RoleQueue.status(S).roles.map((r) => `${r.label}:${r.phase}`)

beforeEach(() => RoleQueue._reset())

describe("RoleQueue.enqueue", () => {
  test("adds in order, dedupes by label, skips blanks", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user", "user", "  ", "admin"])
    expect(phases()).toEqual(["Anonymous:pending", "user:pending", "admin:pending"])
  })
  test("panel-style one-at-a-time appends", () => {
    RoleQueue.enqueue(S, ["Anonymous"])
    RoleQueue.enqueue(S, ["user"])
    expect(phases()).toEqual(["Anonymous:pending", "user:pending"])
  })
})

describe("RoleQueue.captureStarted → next to spawn", () => {
  test("advances to the next pending role and marks it spawning", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user", "admin"])
    const next = RoleQueue.captureStarted(S, "Anonymous")
    expect(next).toEqual({ label: "user", phase: "spawning" })
    expect(phases()).toEqual(["Anonymous:capturing", "user:spawning", "admin:pending"])
  })
  test("repeat Start capture is idempotent — no re-spawn", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user"])
    expect(RoleQueue.captureStarted(S, "Anonymous")).toEqual({ label: "user", phase: "spawning" })
    expect(RoleQueue.captureStarted(S, "Anonymous")).toBeNull()
  })
  test("last role's Start capture returns null (queue drained)", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user"])
    RoleQueue.captureStarted(S, "Anonymous")
    RoleQueue.spawned(S, "user")
    expect(RoleQueue.captureStarted(S, "user")).toBeNull()
    expect(phases()).toEqual(["Anonymous:capturing", "user:capturing"])
  })
  test("an unqueued label is added (orchestrator started without enqueue)", () => {
    const next = RoleQueue.captureStarted(S, "Anonymous")
    expect(next).toBeNull()
    expect(phases()).toEqual(["Anonymous:capturing"])
  })
})

describe("RoleQueue.spawned", () => {
  test("moves spawning → awaiting; ignores other phases", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user"])
    RoleQueue.captureStarted(S, "Anonymous") // user → spawning
    RoleQueue.spawned(S, "user")
    expect(phases()).toEqual(["Anonymous:capturing", "user:awaiting"])
    RoleQueue.spawned(S, "Anonymous") // capturing, unaffected
    expect(phases()).toEqual(["Anonymous:capturing", "user:awaiting"])
  })
})

describe("RoleQueue.status.setup (what the orchestrator shows)", () => {
  test("tracks the role mid-setup through the sequence", () => {
    RoleQueue.enqueue(S, ["Anonymous", "user", "admin"])
    expect(RoleQueue.status(S).setup).toBeNull() // nothing mid-setup yet

    RoleQueue.captureStarted(S, "Anonymous") // user → spawning
    expect(RoleQueue.status(S).setup).toEqual({ label: "user", phase: "spawning" })

    RoleQueue.spawned(S, "user") // user → awaiting (please sign in as user)
    expect(RoleQueue.status(S).setup).toEqual({ label: "user", phase: "awaiting" })

    RoleQueue.captureStarted(S, "user") // user captured → admin spawning
    expect(RoleQueue.status(S).setup).toEqual({ label: "admin", phase: "spawning" })

    RoleQueue.spawned(S, "admin")
    RoleQueue.captureStarted(S, "admin") // admin captured → nothing left
    expect(RoleQueue.status(S).setup).toBeNull()
  })
})

describe("isolation between sessions", () => {
  test("queues do not bleed across sessions", () => {
    RoleQueue.enqueue("a", ["Anonymous"])
    RoleQueue.enqueue("b", ["admin"])
    expect(RoleQueue.status("a").roles.map((r) => r.label)).toEqual(["Anonymous"])
    expect(RoleQueue.status("b").roles.map((r) => r.label)).toEqual(["admin"])
  })
})
