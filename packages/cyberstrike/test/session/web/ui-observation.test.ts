import { describe, expect, test } from "bun:test"
import { UiObservation } from "../../../src/session/web/ui-observation"
import { Session } from "../../../src/session"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"

type Row = UiObservation.Row
const row = (credentialID: string | null, pageUrl: string, role: string, label: string): Row => ({
  credentialID,
  pageUrl,
  role,
  label,
})

// Store functions (observe/forPage/clearSession) touch the DB → need an Instance +
// a real session (FK). A fresh tmpdir per call gives an empty DB, so no reset needed.
async function withSession(fn: (sid: string) => Promise<void>) {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({})
      await fn(session.id)
    },
  })
}

// ---- Pure derivation (no DB) ----
describe("normalizePageUrl", () => {
  test("drops query and fragment from an absolute url", () => {
    expect(UiObservation.normalizePageUrl("https://h.tld/users?tab=1#x")).toBe("https://h.tld/users")
  })
  test("distinct paths stay distinct", () => {
    expect(UiObservation.normalizePageUrl("https://h.tld/users/42")).not.toBe(
      UiObservation.normalizePageUrl("https://h.tld/users/99"),
    )
  })
  test("relative url: strips query/hash best-effort", () => {
    expect(UiObservation.normalizePageUrl("/users?x=1")).toBe("/users")
    expect(UiObservation.normalizePageUrl("/users#frag")).toBe("/users")
  })
})

describe("elementAvailability", () => {
  test("admin-only Delete, shared Edit", () => {
    const rows = [
      row("admin", "/users", "button", "Delete User"),
      row("admin", "/users", "button", "Edit"),
      row("user", "/users", "button", "Edit"),
    ]
    const avail = UiObservation.elementAvailability(rows)
    expect(avail.get("button:Delete User")).toEqual(["admin"])
    expect(avail.get("button:Edit")!.sort()).toEqual(["admin", "user"])
  })
  test("null credentials carry no role identity", () => {
    const avail = UiObservation.elementAvailability([row(null, "/users", "button", "Delete User")])
    expect(avail.get("button:Delete User")).toBeUndefined()
  })
  test("same element seen twice by a credential appears once", () => {
    const avail = UiObservation.elementAvailability([
      row("admin", "/users", "button", "Delete User"),
      row("admin", "/users", "button", "Delete User"),
    ])
    expect(avail.get("button:Delete User")).toEqual(["admin"])
  })
  test("label drift is NOT merged (known limitation)", () => {
    const avail = UiObservation.elementAvailability([
      row("admin", "/x", "button", "Delete (3)"),
      row("user", "/x", "button", "Delete (2)"),
    ])
    expect(avail.get("button:Delete (3)")).toEqual(["admin"])
    expect(avail.get("button:Delete (2)")).toEqual(["user"])
  })
})

describe("pageVisitedBy", () => {
  test("distinct credentials only", () => {
    const rows = [
      row("admin", "/users", "button", "Edit"),
      row("admin", "/users", "button", "Delete User"),
      row("user", "/users", "button", "Edit"),
      row(null, "/users", "a", "Home"),
    ]
    expect(UiObservation.pageVisitedBy(rows).sort()).toEqual(["admin", "user"])
  })
})

describe("deriveAccessContext (pure, over already-filtered rows)", () => {
  const rows = [
    row("admin", "https://h.tld/users", "button", "Delete User"),
    row("admin", "https://h.tld/users", "button", "Edit"),
    row("user", "https://h.tld/users", "button", "Edit"),
  ]
  test("BFLA signal: Delete offered only to admin, page visited by both", () => {
    const ctx = UiObservation.deriveAccessContext("https://h.tld/users?tab=2", "button:Delete User", rows)
    expect(ctx.elementRoles).toEqual(["admin"])
    expect(ctx.pageVisitedBy!.sort()).toEqual(["admin", "user"])
  })
  test("shared element resolves to both roles", () => {
    const ctx = UiObservation.deriveAccessContext("https://h.tld/users", "button:Edit", rows)
    expect(ctx.elementRoles!.sort()).toEqual(["admin", "user"])
  })
  test("trigger not observed → no elementRoles, page_visited_by still present", () => {
    const ctx = UiObservation.deriveAccessContext("https://h.tld/users", "button:Nonexistent", rows)
    expect(ctx.elementRoles).toBeUndefined()
    expect(ctx.pageVisitedBy!.sort()).toEqual(["admin", "user"])
  })
  test("no page_url → empty context", () => {
    expect(UiObservation.deriveAccessContext(undefined, "button:Delete User", rows)).toEqual({})
  })
  test("no trigger_element → only page_visited_by", () => {
    const ctx = UiObservation.deriveAccessContext("https://h.tld/users", undefined, rows)
    expect(ctx.elementRoles).toBeUndefined()
    expect(ctx.pageVisitedBy!.sort()).toEqual(["admin", "user"])
  })
  test("empty rows → empty context", () => {
    expect(UiObservation.deriveAccessContext("https://h.tld/users", "button:Delete User", [])).toEqual({})
  })
})

// ---- DB-backed store ----
describe("observe + forPage (web_ui_observation table)", () => {
  test("dedup: identical observation is idempotent", async () => {
    await withSession(async (sid) => {
      expect(UiObservation.observe(sid, row("admin", "/users", "button", "Delete User"))).toBe(true)
      expect(UiObservation.observe(sid, row("admin", "/users", "button", "Delete User"))).toBe(false)
      expect(UiObservation.forPage(sid, "/users").length).toBe(1)
    })
  })
  test("forPage matches across query/fragment, excludes other paths", async () => {
    await withSession(async (sid) => {
      UiObservation.observe(sid, row("admin", "https://h.tld/users?tab=1", "button", "Delete User"))
      UiObservation.observe(sid, row("user", "https://h.tld/users#frag", "button", "Edit"))
      UiObservation.observe(sid, row("admin", "https://h.tld/settings", "button", "Save"))
      const rows = UiObservation.forPage(sid, "https://h.tld/users")
      expect(rows.length).toBe(2)
      expect(rows.every((r) => r.label !== "Save")).toBe(true)
    })
  })
  test("clearSession removes a session's rows", async () => {
    await withSession(async (sid) => {
      UiObservation.observe(sid, row("admin", "/users", "button", "Delete User"))
      UiObservation.clearSession(sid)
      expect(UiObservation.forPage(sid, "/users").length).toBe(0)
    })
  })
  test("end-to-end: observe → forPage → deriveAccessContext (BFLA)", async () => {
    await withSession(async (sid) => {
      UiObservation.observe(sid, row("admin", "https://h.tld/users", "button", "Delete User"))
      UiObservation.observe(sid, row("admin", "https://h.tld/users", "button", "Edit"))
      UiObservation.observe(sid, row("user", "https://h.tld/users", "button", "Edit"))
      const rows = UiObservation.forPage(sid, "https://h.tld/users?tab=9")
      const ctx = UiObservation.deriveAccessContext("https://h.tld/users?tab=9", "button:Delete User", rows)
      expect(ctx.elementRoles).toEqual(["admin"])
      expect(ctx.pageVisitedBy!.sort()).toEqual(["admin", "user"])
    })
  })
})
