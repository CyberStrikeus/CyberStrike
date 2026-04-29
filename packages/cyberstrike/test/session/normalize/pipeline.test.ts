import { describe, expect, test } from "bun:test"
import { runTier1 } from "../../../src/session/normalize/tier1"
import { parseRawRequest } from "../../../src/session/normalize/parser"
import { assemble, orchestrate } from "../../../src/session/normalize/pipeline"
import { InMemoryTemplateStore } from "../../../src/session/normalize/tier2"
import type { Tier3Client, Tier3ClassifyResponse } from "../../../src/session/normalize/tier3"
import type { LLMSegmentDecision } from "../../../src/session/normalize/types"

const SESSION = "ses_pipeline_test"

function rawHttp(method: string, target: string, host: string): string {
  return `${method} ${target} HTTP/1.1\nhost: ${host}\n\n`
}

// Returns a deterministic mock client whose decisions are pre-canned per ambiguous segment value.
function mockClient(decisions: Record<string, LLMSegmentDecision["classification"]>): Tier3Client {
  return {
    async classify({ parsed, ambiguousIndices }) {
      const out: LLMSegmentDecision[] = []
      for (const i of ambiguousIndices) {
        const seg = parsed.pathSegments[i]!
        const cls = decisions[seg]
        if (cls) out.push({ segment_index: i, classification: cls })
      }
      const response: Tier3ClassifyResponse = {
        decisions: out,
        model: "mock",
        promptTokens: 0,
        completionTokens: 0,
      }
      return response
    },
  }
}

function failingClient(error = "mock failure"): Tier3Client {
  return {
    async classify() {
      throw new Error(error)
    },
  }
}

// ---------- assemble() — defense-in-depth against LLM rewrites ----------

describe("pipeline.assemble — Tier 1 decisions are authoritative", () => {
  test("uses Tier 1 dynamic placeholders, ignores LLM for those slots", () => {
    const p = parseRawRequest({
      raw: rawHttp("GET", "/team/1/user/123/comments/my-first-post", "x.t"),
      scheme: "https",
    })
    const t1 = runTier1(p.pathSegments)
    // Malicious: LLM tries to override Tier 1 static "team" → slug; must be ignored
    const decisions: LLMSegmentDecision[] = [
      { segment_index: 1, classification: "slug" }, // SHOULD BE IGNORED (tier1 said static)
      { segment_index: 6, classification: "slug" }, // legitimate ambiguous decision
    ]
    expect(assemble(p, t1, decisions)).toBe("/team/{id}/user/{id}/comments/{slug}")
  })

  test("falls back to literal when LLM returns no decision for ambiguous segment", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/blog/why-rust-is-fast/comments", "x.t"), scheme: "https" })
    const t1 = runTier1(p.pathSegments)
    expect(assemble(p, t1, [])).toBe("/blog/why-rust-is-fast/comments")
  })

  test("ignores out-of-range LLM segment_index", () => {
    const p = parseRawRequest({
      raw: rawHttp("GET", "/team/1/user/123/comments/my-first-post", "x.t"),
      scheme: "https",
    })
    const t1 = runTier1(p.pathSegments)
    const decisions: LLMSegmentDecision[] = [{ segment_index: 99, classification: "slug" }]
    expect(assemble(p, t1, decisions)).toBe("/team/{id}/user/{id}/comments/my-first-post")
  })

  test("static decision keeps the literal segment unchanged", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/posts/draft/save", "x.t"), scheme: "https" })
    const t1 = runTier1(p.pathSegments)
    expect(t1.resolved).toBe(true) // posts/draft/save are all static via tier1
    expect(assemble(p, t1, [])).toBe("/posts/draft/save")
  })

  test("supports each placeholder kind", () => {
    const p = parseRawRequest({ raw: rawHttp("GET", "/x/abc-1234567890ab", "x.t"), scheme: "https" })
    const t1 = runTier1(p.pathSegments)
    expect(assemble(p, t1, [{ segment_index: 2, classification: "id" }])).toBe("/x/{id}")
    expect(assemble(p, t1, [{ segment_index: 2, classification: "slug" }])).toBe("/x/{slug}")
    expect(assemble(p, t1, [{ segment_index: 2, classification: "uuid" }])).toBe("/x/{uuid}")
    expect(assemble(p, t1, [{ segment_index: 2, classification: "hash" }])).toBe("/x/{hash}")
  })
})

// ---------- orchestrate() — end-to-end with InMemoryTemplateStore ----------

describe("pipeline.orchestrate — tier-by-tier resolution", () => {
  test("tier1 fast-path: pure numeric resolves without touching tier2/3", async () => {
    const store = new InMemoryTemplateStore()
    let calls = 0
    const client: Tier3Client = {
      async classify() {
        calls++
        return { decisions: [], model: "mock" }
      },
    }
    const r = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/orders/202", "api.example.com"),
      scheme: "https",
      store,
      client,
    })
    expect(r.normSource).toBe("tier1")
    expect(r.normalizedPath).toBe("/orders/{id}")
    expect(calls).toBe(0)
    expect(r.tier2).toBeUndefined()
    expect(r.tier3).toBeUndefined()
  })

  test("tier2 cache hit: same template across distinct values, no LLM call", async () => {
    const store = new InMemoryTemplateStore()
    const client = mockClient({ "why-rust-is-fast": "slug" })
    // First call seeds the template via Tier 3
    await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/blog/why-rust-is-fast/comments", "blog.example.com"),
      scheme: "https",
      store,
      client,
    })
    // Second call should hit cache — different slug value, same shape
    let calls = 0
    const counterClient: Tier3Client = {
      async classify() {
        calls++
        return { decisions: [], model: "mock" }
      },
    }
    const r = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/blog/another-post/comments", "blog.example.com"),
      scheme: "https",
      store,
      client: counterClient,
    })
    expect(r.normSource).toBe("tier2")
    expect(r.normalizedPath).toBe("/blog/{slug}/comments")
    expect(calls).toBe(0)
    expect(r.tier3).toBeUndefined()
  })

  test("tier3 LLM: ambiguous slug gets classified and template is cached", async () => {
    const store = new InMemoryTemplateStore()
    const client = mockClient({ "my-first-post": "slug" })
    const r = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/team/1/user/123/comments/my-first-post", "api.acme.io"),
      scheme: "https",
      store,
      client,
    })
    expect(r.normSource).toBe("tier3")
    expect(r.normalizedPath).toBe("/team/{id}/user/{id}/comments/{slug}")
    expect(r.templateId).toBeDefined()
    expect(store.size()).toBe(1)
  })

  test("tier3 failure: returns Tier 1 best-effort path and does NOT cache", async () => {
    const store = new InMemoryTemplateStore()
    const r = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/blog/why-rust-is-fast/comments", "blog.example.com"),
      scheme: "https",
      store,
      client: failingClient(),
    })
    expect(r.normSource).toBe("failed")
    expect(r.normalizedPath).toBe("/blog/why-rust-is-fast/comments") // tier1 best-effort
    expect(r.templateId).toBeUndefined()
    expect(store.size()).toBe(0) // critical: no polluted template
  })

  test("multi-origin separation: same path, different origins → different templates", async () => {
    const store = new InMemoryTemplateStore()
    const client = mockClient({})
    const a = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/users/2", "app.example.com"),
      scheme: "https",
      store,
      client,
    })
    const b = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/users/2", "api.example.com"),
      scheme: "https",
      store,
      client,
    })
    expect(a.templateId).toBeDefined()
    expect(b.templateId).toBeDefined()
    expect(a.templateId).not.toBe(b.templateId)
    expect(store.size()).toBe(2)
  })

  test("session isolation: same path under different sessions, different templates", async () => {
    const store = new InMemoryTemplateStore()
    const client = mockClient({})
    await orchestrate({
      sessionID: "ses_a",
      raw: rawHttp("GET", "/users/1", "x.t"),
      scheme: "https",
      store,
      client,
    })
    const r = await orchestrate({
      sessionID: "ses_b",
      raw: rawHttp("GET", "/users/2", "x.t"),
      scheme: "https",
      store,
      client,
    })
    expect(r.normSource).toBe("tier1") // tier1 always resolves /users/{id}
    expect(store.size()).toBe(2) // one template per session
  })

  test("hit count amortization: 100 distinct numeric IDs share one template", async () => {
    const store = new InMemoryTemplateStore()
    const client = failingClient("should not be called")
    for (let i = 1; i <= 100; i++) {
      await orchestrate({
        sessionID: SESSION,
        raw: rawHttp("GET", `/users/${i}`, "api.example.com"),
        scheme: "https",
        store,
        client,
      })
    }
    expect(store.size()).toBe(1)
    expect(store.all()[0]!.template).toBe("/users/{id}")
    expect(store.all()[0]!.hitCount).toBe(100)
  })

  test("preserves Tier 1 decisions even if LLM returns conflicting classification", async () => {
    const store = new InMemoryTemplateStore()
    // LLM tries to reclassify "team" as a slug — pipeline must ignore it
    const malicious: Tier3Client = {
      async classify() {
        return {
          decisions: [
            { segment_index: 1, classification: "slug" }, // tier1 said static — IGNORED
            { segment_index: 6, classification: "slug" }, // legitimate ambiguous → applied
          ],
          model: "mock",
        }
      },
    }
    const r = await orchestrate({
      sessionID: SESSION,
      raw: rawHttp("GET", "/team/1/user/123/comments/my-first-post", "api.acme.io"),
      scheme: "https",
      store,
      client: malicious,
    })
    expect(r.normalizedPath).toBe("/team/{id}/user/{id}/comments/{slug}")
  })
})
