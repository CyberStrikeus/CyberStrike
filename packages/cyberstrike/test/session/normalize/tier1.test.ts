import { describe, expect, test } from "bun:test"
import { runTier1 } from "../../../src/session/normalize/tier1"
import type { SegmentClassification } from "../../../src/session/normalize/types"

function classify(segments: string[]): SegmentClassification[] {
  return runTier1(segments).classifications
}

function kindAt(segs: string[], i: number): string {
  const c = classify(segs)[i]
  if (!c) return "missing"
  if (c.kind === "dynamic") return c.placeholder
  return c.kind
}

describe("tier1 — dynamic patterns (deterministic)", () => {
  test("pure numeric → {id}", () => {
    expect(kindAt(["", "users", "42"], 2)).toBe("{id}")
    expect(kindAt(["", "orders", "202"], 2)).toBe("{id}")  // original /orders/202 bug
    expect(kindAt(["", "x", "0"], 2)).toBe("{id}")
  })

  test("UUID → {uuid}", () => {
    expect(kindAt(["", "x", "550e8400-e29b-41d4-a716-446655440000"], 2)).toBe("{uuid}")
    expect(kindAt(["", "x", "550E8400-E29B-41D4-A716-446655440000"], 2)).toBe("{uuid}")
  })

  test("email-shaped → {email}", () => {
    expect(kindAt(["", "users", "john@example.com"], 2)).toBe("{email}")
  })

  test("JWT-shaped → {token}", () => {
    expect(kindAt(["", "auth", "eyJhbGciOiJIUzI1NiJ9.payload.signature"], 2)).toBe("{token}")
  })

  test("hex >=12 chars → {hash}", () => {
    expect(kindAt(["", "commits", "a1b2c3d4e5f6"], 2)).toBe("{hash}")
    expect(kindAt(["", "commits", "da39a3ee5e6b4b0d3255bfef95601890afd80709"], 2)).toBe("{hash}")
  })

  test("hex <12 chars NOT classified as hash (false-positive guard)", () => {
    // 'facade' is a real English word that's also valid hex — must stay static.
    expect(kindAt(["", "users", "facade"], 2)).toBe("static")
    // 7-char short git hash — falls through to ambiguous (tier 3 will decide)
    expect(kindAt(["", "commits", "abc1234"], 2)).toBe("ambiguous")
  })
})

describe("tier1 — static patterns", () => {
  test("pure alphabetic → static", () => {
    expect(kindAt(["", "users"], 1)).toBe("static")
    expect(kindAt(["", "me"], 1)).toBe("static")
    expect(kindAt(["", "whoami"], 1)).toBe("static")
  })

  test("API version → static", () => {
    expect(kindAt(["", "v1", "users"], 1)).toBe("static")
    expect(kindAt(["", "v2", "users"], 1)).toBe("static")
  })

  test("filename with known extension → static", () => {
    expect(kindAt(["", "admin", "edit.aspx"], 2)).toBe("static")
    expect(kindAt(["", "users", "user.php"], 2)).toBe("static")
  })

  test("path root '' → static (root reason)", () => {
    expect(kindAt([""], 0)).toBe("static")
  })
})

describe("tier1 — ambiguous segments fall through", () => {
  test("hyphenated slug → ambiguous", () => {
    expect(kindAt(["", "blog", "why-rust-is-fast", "comments"], 2)).toBe("ambiguous")
  })

  test("alphanumeric opaque ID → ambiguous", () => {
    expect(kindAt(["", "orgs", "org_2xK9mP"], 2)).toBe("ambiguous")
    expect(kindAt(["", "orders", "ORD-12345"], 2)).toBe("ambiguous")
  })

  test("numeric+unit → ambiguous", () => {
    expect(kindAt(["", "items", "10kg"], 2)).toBe("ambiguous")
  })

  test("snake_case with digit → ambiguous", () => {
    expect(kindAt(["", "x", "user_2"], 2)).toBe("ambiguous")
  })
})

describe("tier1 — full result behaviour", () => {
  test("resolved=true when every segment is non-ambiguous", () => {
    const r = runTier1(["", "api", "users", "42"])
    expect(r.resolved).toBe(true)
    expect(r.normalizedPath).toBe("/api/users/{id}")
  })

  test("resolved=false when any segment is ambiguous", () => {
    const r = runTier1(["", "blog", "why-rust", "comments"])
    expect(r.resolved).toBe(false)
    // best-effort path keeps the ambiguous segment literal
    expect(r.normalizedPath).toBe("/blog/why-rust/comments")
  })

  test("recognizes deeply nested numeric ids", () => {
    const r = runTier1(["", "api", "v1", "users", "42", "posts", "789", "comments", "12"])
    expect(r.resolved).toBe(true)
    expect(r.normalizedPath).toBe("/api/v1/users/{id}/posts/{id}/comments/{id}")
  })

  test("durationMs is reported and small", () => {
    const r = runTier1(["", "api", "users", "1"])
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
    expect(r.durationMs).toBeLessThan(50)  // even on slowest CI, sub-50ms
  })
})
