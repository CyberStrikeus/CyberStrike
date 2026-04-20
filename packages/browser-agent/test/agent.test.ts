import { test, expect } from "bun:test"
import { intentSignature, reconcileQueue } from "../src/agent.ts"
import type { PageTask } from "../src/types.ts"

// ============================================================
// intentSignature — base-intent identity independent of suffix
// ============================================================

test("intentSignature: form tasks keyed by submit label (base)", () => {
  const a: PageTask = { type: "form", fields: [], submit: { role: "button", label: "Add User" } }
  const b: PageTask = { type: "form", fields: [], submit: { role: "button", label: "Add User (2)" } }
  expect(intentSignature(a)).toBe(intentSignature(b))
})

test("intentSignature: different form submits have different intents", () => {
  const a: PageTask = { type: "form", fields: [], submit: { role: "button", label: "Save" } }
  const b: PageTask = { type: "form", fields: [], submit: { role: "button", label: "Search" } }
  expect(intentSignature(a)).not.toBe(intentSignature(b))
})

test("intentSignature: click tasks keyed by role+base label", () => {
  const a: PageTask = { type: "click", role: "button", label: "Publish" }
  const b: PageTask = { type: "click", role: "button", label: "Publish (3)" }
  expect(intentSignature(a)).toBe(intentSignature(b))
})

test("intentSignature: same label, different roles → distinct intents", () => {
  const a: PageTask = { type: "click", role: "button", label: "Delete" }
  const b: PageTask = { type: "click", role: "menuitem", label: "Delete" }
  expect(intentSignature(a)).not.toBe(intentSignature(b))
})

test("intentSignature: suffix-like but non-numeric text preserved (e.g. '(v2)')", () => {
  const a: PageTask = { type: "click", role: "button", label: "Save (v2)" }
  const b: PageTask = { type: "click", role: "button", label: "Save" }
  // Regex strips only purely numeric suffixes ' (42)', not ' (v2)'
  expect(intentSignature(a)).not.toBe(intentSignature(b))
})

// ============================================================
// reconcileQueue — supersede stale tasks, prepend fresh ones
// ============================================================

test("reconcileQueue: fresh form task supersedes stale same-intent form", () => {
  const queue: PageTask[] = [
    { type: "form", fields: [], submit: { role: "button", label: "Add User" } },
    { type: "click", role: "button", label: "Export CSV" },
  ]
  const fresh: PageTask[] = [
    { type: "form", fields: [], submit: { role: "button", label: "Add User (2)" } },
  ]
  reconcileQueue(queue, fresh)
  // The stale "Add User" form dropped; Export CSV preserved
  expect(queue.length).toBe(2)
  expect(queue[0]!.type).toBe("form")
  expect((queue[0] as any).submit.label).toBe("Add User (2)")
  expect(queue[1]!.type).toBe("click")
  expect((queue[1] as any).label).toBe("Export CSV")
})

test("reconcileQueue: unrelated tasks in queue are preserved", () => {
  const queue: PageTask[] = [
    { type: "click", role: "button", label: "Refresh" },
    { type: "click", role: "button", label: "Export" },
  ]
  const fresh: PageTask[] = [
    { type: "click", role: "button", label: "Confirm" },
  ]
  reconcileQueue(queue, fresh)
  expect(queue.length).toBe(3)
  expect((queue[0] as any).label).toBe("Confirm")
  expect((queue[1] as any).label).toBe("Refresh")
  expect((queue[2] as any).label).toBe("Export")
})

test("reconcileQueue: empty fresh tasks → no-op", () => {
  const queue: PageTask[] = [
    { type: "click", role: "button", label: "Refresh" },
  ]
  reconcileQueue(queue, [])
  expect(queue.length).toBe(1)
  expect((queue[0] as any).label).toBe("Refresh")
})

test("reconcileQueue: multi-form page keeps distinct form intents", () => {
  // Login form + Search form on same page
  const queue: PageTask[] = [
    { type: "form", fields: [], submit: { role: "button", label: "Log in" } },
    { type: "form", fields: [], submit: { role: "button", label: "Search" } },
  ]
  const fresh: PageTask[] = [
    { type: "form", fields: [], submit: { role: "button", label: "Log in" } },
  ]
  reconcileQueue(queue, fresh)
  // Only login superseded; Search preserved (different intent)
  expect(queue.length).toBe(2)
  expect((queue[0] as any).submit.label).toBe("Log in")
  expect((queue[1] as any).submit.label).toBe("Search")
})

test("reconcileQueue: click with suffix supersedes base-label click", () => {
  const queue: PageTask[] = [
    { type: "click", role: "button", label: "Publish" },
    { type: "click", role: "button", label: "Archive" },
  ]
  const fresh: PageTask[] = [
    { type: "click", role: "button", label: "Publish (2)" },
  ]
  reconcileQueue(queue, fresh)
  expect(queue.length).toBe(2)
  expect((queue[0] as any).label).toBe("Publish (2)")
  expect((queue[1] as any).label).toBe("Archive")
})
