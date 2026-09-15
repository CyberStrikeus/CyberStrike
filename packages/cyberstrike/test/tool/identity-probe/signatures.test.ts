import { describe, test, expect } from "bun:test"
import { classifyIdentifiers, usernamePolicyIssues, isHomoglyphOf, foldConfusables } from "../../../src/tool/identity-probe/signatures"

describe("identity-probe/signatures — classifyIdentifiers", () => {
  test("dense sequential numeric ids → guessable account space", () => {
    const f = classifyIdentifiers(["1001", "1002", "1003", "1007"])
    expect(f[0].kind).toBe("sequential-numeric-ids")
    expect(f[0].severity).toBe("high")
  })

  test("sparse/random ids do NOT false-positive", () => {
    expect(classifyIdentifiers(["10", "999999", "48213"])).toHaveLength(0)
  })

  test("fewer than 3 values → no verdict", () => {
    expect(classifyIdentifiers(["1", "2"])).toHaveLength(0)
  })

  test("userN pattern usernames flagged predictable", () => {
    const f = classifyIdentifiers(["user1", "user2", "user15"])
    expect(f.some((x) => x.kind === "predictable-username-pattern")).toBe(true)
  })
})

describe("identity-probe/signatures — username policy + homoglyph", () => {
  test("foldConfusables maps Cyrillic look-alikes to ASCII", () => {
    expect(foldConfusables("аdmin")).toBe("admin") // leading char is Cyrillic а
  })

  test("isHomoglyphOf detects a Cyrillic 'аdmin', ignores pure ASCII", () => {
    expect(isHomoglyphOf("аdmin")).toBe("admin")
    expect(isHomoglyphOf("admin")).toBeUndefined() // pure ASCII 'admin' is reserved, not a homoglyph
    expect(isHomoglyphOf("alice")).toBeUndefined()
  })

  test("usernamePolicyIssues: homoglyph impersonation", () => {
    expect(usernamePolicyIssues("аdmin").map((i) => i.kind)).toContain("homoglyph-impersonation")
  })

  test("usernamePolicyIssues: reserved (ASCII)", () => {
    expect(usernamePolicyIssues("root").map((i) => i.kind)).toContain("reserved-name")
  })

  test("usernamePolicyIssues: weak forms", () => {
    expect(usernamePolicyIssues("a").map((i) => i.kind)).toContain("too-short")
    expect(usernamePolicyIssues("12345").map((i) => i.kind)).toContain("all-numeric")
    expect(usernamePolicyIssues("x".repeat(300)).map((i) => i.kind)).toContain("too-long")
    expect(usernamePolicyIssues("a<b>").map((i) => i.kind)).toContain("special-chars")
  })

  test("a normal username yields no policy issue", () => {
    expect(usernamePolicyIssues("alice_92")).toHaveLength(0)
  })
})
