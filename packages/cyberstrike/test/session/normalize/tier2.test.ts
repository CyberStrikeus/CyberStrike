import { describe, expect, test } from "bun:test"
import { parseRawRequest } from "../../../src/session/normalize/parser"
import { runTier1 } from "../../../src/session/normalize/tier1"
import { InMemoryTemplateStore, runTier2, scoreTemplate } from "../../../src/session/normalize/tier2"
import type { ParsedRequest, SegmentClassification } from "../../../src/session/normalize/types"

const SESSION = "ses_test_" + Math.random().toString(36).slice(2)
const ORIGIN = "https://api.example.com:443"
const METHOD = "GET" as const

function parsed(target: string, host = "api.example.com"): ParsedRequest {
  return parseRawRequest({
    raw: `GET ${target} HTTP/1.1\nhost: ${host}\n\n`,
    scheme: "https",
  })
}

describe("tier2.scoreTemplate — pure scoring", () => {
  function ambig(literal: string): SegmentClassification {
    return { kind: "ambiguous", literal, reason: "test" }
  }
  function dyn(): SegmentClassification {
    return { kind: "dynamic", placeholder: "{id}", reason: "test" }
  }
  function staticC(literal: string): SegmentClassification {
    return { kind: "static", literal, reason: "test" }
  }

  test("literal+2, placeholder+1 over a 3-segment path", () => {
    const tmpl = ["", "users", "{id}"]
    const path = ["", "users", "42"]
    const cls = [staticC(""), staticC("users"), dyn()]
    expect(scoreTemplate(tmpl, path, cls)).toBe(2 + 2 + 1)
  })

  test("rejects on segment count mismatch", () => {
    expect(
      scoreTemplate(
        ["", "users", "{id}"],
        ["", "users", "42", "posts"],
        [staticC(""), staticC("users"), dyn(), staticC("posts")],
      ),
    ).toBeNull()
  })

  test("rejects literal mismatch (template literal != path literal)", () => {
    expect(
      scoreTemplate(["", "users", "{id}"], ["", "orders", "42"], [staticC(""), staticC("orders"), dyn()]),
    ).toBeNull()
  })

  test("static segment must NOT fill a placeholder slot", () => {
    // /users/me hitting /users/{id} template — must reject so /users/me literal can win
    expect(
      scoreTemplate(["", "users", "{id}"], ["", "users", "me"], [staticC(""), staticC("users"), staticC("me")]),
    ).toBeNull()
  })

  test("ambiguous segment may fill placeholder slot", () => {
    expect(
      scoreTemplate(
        ["", "blog", "{slug}", "comments"],
        ["", "blog", "my-post", "comments"],
        [staticC(""), staticC("blog"), ambig("my-post"), staticC("comments")],
      ),
    ).toBe(2 + 2 + 1 + 2)
  })
})

describe("tier2.InMemoryTemplateStore — store contract", () => {
  test("upsert creates new template with hit_count=1", () => {
    const store = new InMemoryTemplateStore()
    const t = store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    expect(t.hitCount).toBe(1)
    expect(t.id.startsWith("ept_")).toBe(true)
    expect(t.template).toBe("/users/{id}")
  })

  test("upsert is idempotent — same key returns same row, hit_count++", () => {
    const store = new InMemoryTemplateStore()
    const a = store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    const b = store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    expect(b.id).toBe(a.id)
    expect(b.hitCount).toBe(2)
    expect(store.size()).toBe(1)
  })

  test("different origin yields a different bucket", () => {
    const store = new InMemoryTemplateStore()
    store.upsert({
      sessionID: SESSION,
      origin: "https://app.example.com:443",
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    store.upsert({
      sessionID: SESSION,
      origin: "https://api.example.com:443",
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    expect(store.size()).toBe(2)
  })

  test("incrementHit bumps hit_count", () => {
    const store = new InMemoryTemplateStore()
    const t = store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/x",
      segmentCount: 2,
      source: "tier1",
      confidence: 1.0,
    })
    store.incrementHit(t.id)
    expect(store.all()[0]!.hitCount).toBe(2)
  })
})

describe("tier2.runTier2 — end-to-end against in-memory store", () => {
  test("misses on empty store", () => {
    const store = new InMemoryTemplateStore()
    const p = parsed("/users/42")
    const t1 = runTier1(p.pathSegments)
    const r = runTier2(store, SESSION, p, t1)
    expect(r.matched).toBe(false)
    expect(r.candidateCount).toBe(0)
  })

  test("hits when matching template exists", () => {
    const store = new InMemoryTemplateStore()
    store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    const p = parsed("/users/42")
    const t1 = runTier1(p.pathSegments)
    const r = runTier2(store, SESSION, p, t1)
    expect(r.matched).toBe(true)
    expect(r.normalizedPath).toBe("/users/{id}")
    expect(r.score).toBe(2 + 2 + 1)
  })

  test("literal beats placeholder when both exist (/users/me vs /users/{id})", () => {
    const store = new InMemoryTemplateStore()
    store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    store.upsert({
      sessionID: SESSION,
      origin: ORIGIN,
      method: METHOD,
      template: "/users/me",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    const p = parsed("/users/me")
    const t1 = runTier1(p.pathSegments)
    const r = runTier2(store, SESSION, p, t1)
    expect(r.matched).toBe(true)
    expect(r.normalizedPath).toBe("/users/me") // literal won (score 6 > placeholder 5)
  })

  test("does not match across sessions", () => {
    const store = new InMemoryTemplateStore()
    store.upsert({
      sessionID: "ses_other",
      origin: ORIGIN,
      method: METHOD,
      template: "/users/{id}",
      segmentCount: 3,
      source: "tier1",
      confidence: 1.0,
    })
    const p = parsed("/users/42")
    const t1 = runTier1(p.pathSegments)
    const r = runTier2(store, SESSION, p, t1)
    expect(r.matched).toBe(false)
  })
})
