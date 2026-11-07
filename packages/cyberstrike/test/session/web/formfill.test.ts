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
    // password is now filled — a non-login form (signup / change-password) can't submit without it,
    // and login-class forms are skipped whole at the candidate level (SKIP), not here.
    expect(WebFormFill.valueFor({ name: "", type: "password" })).toBe("Test1234!Aa")
    // structural / non-text controls stay null (select/checkbox/radio are handled by fillFor's ops)
    expect(WebFormFill.valueFor({ name: "", type: "hidden" })).toBeNull()
    expect(WebFormFill.valueFor({ name: "", type: "file" })).toBeNull()
    expect(WebFormFill.valueFor({ name: "", type: "checkbox" })).toBeNull()
    // fillFor gives non-text controls their own op
    expect(WebFormFill.fillFor({ name: "", type: "checkbox" })).toEqual({ op: "check", value: "true" })
    expect(WebFormFill.fillFor({ name: "", type: "select-one" })).toEqual({ op: "select", value: "" })
    expect(WebFormFill.fillFor({ name: "", type: "email" })).toEqual({ op: "type", value: "test@example.com" })
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
    expect(cands[0].fills).toEqual([{ id: "f1", value: "test", op: "type" }])
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

describe("WebFormFill.candidates — synthetic SPA forms (the chatbot case)", () => {
  // What the extension now emits for a React/Vue app: a textarea + a Send button that are NOT
  // wrapped in a real <form>. Before the SPA-form synthesis this produced zero candidates, so
  // the crawler could open an in-app chatbot page (/ask) but never TYPE a message into it.
  function chatState(sid: string) {
    PageState.set(sid, {
      url: "https://h/ask",
      title: "",
      clickables: [
        { id: "c1", tag: "textarea", role: "textbox", label: "Message", href: "" },
        { id: "c2", tag: "button", role: "button", label: "Send", href: "" },
      ],
      forms: [{ action: "", method: "post", fields: [{ id: "c1", name: "message", type: "textarea", required: false }], submit_id: "c2" }],
      links: [],
      observed_at: Date.now(),
    })
    return PageState.get(sid, "https://h/ask")!
  }

  test("a bare textarea + Send button (no <form>) yields a fillable candidate", () => {
    const cands = WebFormFill.candidates("c", chatState("c"))
    expect(cands.length).toBe(1)
    expect(cands[0].submitId).toBe("c2")
    // the textarea is typed into — this is the message that reaches the chatbot
    expect(cands[0].fills).toEqual([{ id: "c1", value: "test", op: "type" }])
    // Send is not auth/logout/destructive, so it is not skipped
    expect(cands[0].kind).not.toBe("auth")
  })
})

describe("WebFormFill.candidates — a full form (dropdown + checkbox + password), not just text", () => {
  test("select/checkbox/radio/password each get the right fill op so the form actually completes", () => {
    const sid = "reg"
    PageState.set(sid, {
      url: "https://h/signup",
      title: "",
      clickables: [{ id: "b", tag: "button", role: "button", label: "Create account", href: "" }],
      forms: [
        {
          action: "/signup",
          method: "post",
          fields: [
            { id: "email", name: "email", type: "email", required: true },
            { id: "pw", name: "password", type: "password", required: true },
            { id: "country", name: "country", type: "select-one", required: true },
            { id: "agree", name: "tos", type: "checkbox", required: true },
            { id: "plan", name: "plan", type: "radio", required: false },
          ],
          submit_id: "b",
        },
      ],
      links: [],
      observed_at: Date.now(),
    })
    const cands = WebFormFill.candidates(sid, PageState.get(sid, "https://h/signup")!)
    expect(cands.length).toBe(1)
    expect(cands[0].fills).toEqual([
      { id: "email", value: "test@example.com", op: "type" },
      { id: "pw", value: "Test1234!Aa", op: "type" }, // password now filled (non-login form)
      { id: "country", value: "", op: "select" }, // "" → extension picks first valid option
      { id: "agree", value: "true", op: "check" },
      { id: "plan", value: "true", op: "check" },
    ])
  })
})
