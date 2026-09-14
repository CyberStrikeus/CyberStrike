import { describe, test, expect } from "bun:test"
import { classifyAccess, tokenSimilarity } from "../../src/tool/access-probe"

const OWNER = { status: 200, body: `{"id":42,"ssn":"111-22-3333","email":"a@b.c","role":"user"}` }

describe("tokenSimilarity", () => {
  test("identical bodies → 1", () => expect(tokenSimilarity("a b c", "a b c")).toBe(1))
  test("disjoint → 0", () => expect(tokenSimilarity("a b c", "x y z")).toBe(0))
  test("both empty → 1", () => expect(tokenSimilarity("", "")).toBe(1))
  test("one empty → 0", () => expect(tokenSimilarity("a b", "")).toBe(0))
  test("partial overlap is between", () => {
    const s = tokenSimilarity("a b c d", "a b x y")
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe("classifyAccess — cross-identity decision-differential", () => {
  test("swapped identity gets the owner's exact response → BROKEN (IDOR/BOLA)", () => {
    const f = classifyAccess(OWNER, { status: 200, body: OWNER.body }, "bob", "credential")
    expect(f.verdict).toBe("broken")
    expect(f.similarity).toBe(1)
    expect(f.note).toContain("Broken Access Control")
  })

  test("unauthenticated gets the owner's response → BROKEN (missing authz), labeled", () => {
    const f = classifyAccess(OWNER, { status: 200, body: OWNER.body }, "unauthenticated", "unauthenticated")
    expect(f.verdict).toBe("broken")
    expect(f.note).toContain("UNAUTHENTICATED")
  })

  test("server denies the swap (403) → enforced", () => {
    const f = classifyAccess(OWNER, { status: 403, body: "forbidden" }, "bob", "credential")
    expect(f.verdict).toBe("enforced")
  })

  test("401 / redirect-to-login also → enforced", () => {
    expect(classifyAccess(OWNER, { status: 401, body: "" }, "bob", "credential").verdict).toBe("enforced")
    expect(classifyAccess(OWNER, { status: 302, body: "" }, "bob", "credential").verdict).toBe("enforced")
  })

  test("2xx but a DIFFERENT body (their own object) → weak-lead, not broken", () => {
    const f = classifyAccess(OWNER, { status: 200, body: `{"id":99,"ssn":"999-88-7777","email":"z@z.z","role":"user"}` }, "bob", "credential")
    expect(f.verdict).toBe("weak-lead")
    expect(f.similarity).toBeLessThan(0.9)
  })

  test("transport error / no response → error verdict, never a false 'broken'", () => {
    expect(classifyAccess(OWNER, { error: "connection reset" }, "bob", "credential").verdict).toBe("error")
    expect(classifyAccess(OWNER, {}, "bob", "credential").verdict).toBe("error")
  })

  test("read: 404 → enforced (hide-not-found), not a break", () => {
    expect(classifyAccess(OWNER, { status: 404, body: "not found" }, "bob", "credential").verdict).toBe("enforced")
  })

  test("WRITE: swapped identity gets 2xx → BROKEN (BFLA), judged on status + flags a write ran", () => {
    const f = classifyAccess({}, { status: 200, body: `{"ok":true}` }, "bob", "credential", true)
    expect(f.verdict).toBe("broken")
    expect(f.note).toMatch(/BFLA|state-changing|write ran/i)
  })

  test("WRITE: swapped identity denied (403) → enforced", () => {
    expect(classifyAccess({}, { status: 403, body: "no" }, "bob", "credential", true).verdict).toBe("enforced")
  })

  test("WRITE: unauthenticated allowed to write (201) → BROKEN (missing authz on a write)", () => {
    const f = classifyAccess({}, { status: 201, body: "" }, "unauthenticated", "unauthenticated", true)
    expect(f.verdict).toBe("broken")
    expect(f.note).toContain("UNAUTHENTICATED")
  })

  test("near-identical body (>=90% tokens) still → broken", () => {
    // same object, one field reformatted — still the owner's data
    const f = classifyAccess(
      { status: 200, body: "alpha beta gamma delta epsilon zeta eta theta iota kappa" },
      { status: 200, body: "alpha beta gamma delta epsilon zeta eta theta iota XX" },
      "bob",
      "credential",
    )
    expect(f.similarity).toBeGreaterThanOrEqual(0.8) // 9/11 shared
  })
})
