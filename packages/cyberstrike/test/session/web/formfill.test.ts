import { beforeEach, describe, expect, test } from "bun:test"
import { WebFormFill } from "../../../src/session/web/formfill"
import { PageState } from "../../../src/session/web/page-state"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => {
  PageState._reset()
  Crawl._reset()
})

describe("WebFormFill.valueFor — benign deterministic values", () => {
  test("typeable fields get plausible values; unsafe/non-text fields are skipped", () => {
    expect(WebFormFill.valueFor({ name: "", type: "email" })).toBe("test@example.com")
    expect(WebFormFill.valueFor({ name: "user_email", type: "text" })).toBe("test@example.com")
    expect(WebFormFill.valueFor({ name: "", type: "tel" })).toBe("5551234567")
    expect(WebFormFill.valueFor({ name: "", type: "number" })).toBe("1")
    expect(WebFormFill.valueFor({ name: "q", type: "search" })).toBe("test")
    expect(WebFormFill.valueFor({ name: "comment", type: "textarea" })).toBe("test")
    // never auto-enter these
    expect(WebFormFill.valueFor({ name: "", type: "password" })).toBeNull()
    expect(WebFormFill.valueFor({ name: "", type: "hidden" })).toBeNull()
    expect(WebFormFill.valueFor({ name: "", type: "file" })).toBeNull()
    expect(WebFormFill.valueFor({ name: "", type: "checkbox" })).toBeNull()
  })
})

function state(sid: string) {
  PageState.set(sid, {
    url: "https://h/p",
    title: "",
    clickables: [
      { id: "f1", tag: "input", role: "textbox", label: "Query", href: "" },
      { id: "s1", tag: "button", role: "button", label: "Search", href: "" }, // query → fill
      { id: "s2", tag: "button", role: "button", label: "Sign in", href: "" }, // auth → skip
      { id: "s3", tag: "button", role: "button", label: "Delete account", href: "" }, // destructive → skip
    ],
    forms: [
      { action: "/search", method: "get", fields: [{ id: "f1", name: "q", type: "search", required: false }], submit_id: "s1" },
      { action: "/login", method: "post", fields: [{ id: "f1", name: "user", type: "text", required: true }], submit_id: "s2" },
      { action: "/del", method: "post", fields: [{ id: "f1", name: "x", type: "text", required: false }], submit_id: "s3" },
    ],
    links: [],
    observed_at: Date.now(),
  })
  return PageState.get(sid, "https://h/p")!
}

describe("WebFormFill.candidates — safety + fill plan", () => {
  test("fills the search form; skips login (auth) and delete (destructive)", () => {
    const cands = WebFormFill.candidates("s", state("s"))
    expect(cands.length).toBe(1)
    expect(cands[0].kind).toBe("query")
    expect(cands[0].submitId).toBe("s1")
    expect(cands[0].fills).toEqual([{ id: "f1", value: "test" }])
  })

  test("an already-submitted form is not offered again", () => {
    const st = state("s")
    const key = WebFormFill.candidates("s", st)[0].actionKey
    Crawl.record("s", key)
    expect(WebFormFill.candidates("s", st).length).toBe(0)
  })

  test("priorities boost a matching form", () => {
    const st = state("s")
    // "search" priority matches the search form's submit label.
    expect(WebFormFill.candidates("s", st, ["search"])[0].score).toBeGreaterThan(WebFormFill.candidates("s", st)[0].score)
  })
})
