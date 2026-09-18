// #40 P2 — the sound rule pre-filter's literal extraction. The critical property is SOUNDNESS: for any
// string the rule's matcher accepts, at least one extracted literal is present — so pruning a rule when
// none of its literals are present can never drop a real match. Anything uncertain must fall open.
import { describe, expect, test } from "bun:test"
import { preconditionOf, regexFactors, type Precondition } from "../src/index"

// A precondition proves absence-of-match only via its literals. This asserts the SOUNDNESS property for
// a regex: every string that matches it contains (case-insensitively) at least one extracted factor.
function assertRegexSound(pattern: string, matching: string[]) {
  const factors = regexFactors(pattern)
  expect(factors).toBeDefined()
  for (const s of matching) {
    const lc = s.toLowerCase()
    expect(factors!.some((f) => lc.includes(f))).toBe(true)
  }
}

describe("sound precondition extraction (#40 P2)", () => {
  test("regex factors are guaranteed substrings for the real signature patterns", () => {
    assertRegexSound("(AKIA|ASIA)[0-9A-Z]{16}", ["AKIAABCDEFGHIJKLMNOP", "ASIA0000000000000000"])
    assertRegexSound("AIza[0-9A-Za-z_-]{35}", ["AIza" + "b".repeat(35)])
    assertRegexSound("-----BEGIN [A-Z ]*PRIVATE KEY-----", ["-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----"])
    assertRegexSound("SQL syntax|mysql_fetch|SQLSTATE|ORA-[0-9]{4,}", ["...SQL syntax...", "mysql_fetch_array()", "SQLSTATE[42000]", "ORA-00933"])
    assertRegexSound("Traceback [(]most recent call last[)]", ["Traceback (most recent call last):"])
  })

  test("contains over a raw field → an `any` literal", () => {
    const p = preconditionOf('contains(resp.body, "X-Powered-By: Express")')
    expect(p.kind).toBe("any")
    expect((p as Extract<Precondition, { kind: "any" }>).literals).toEqual(["x-powered-by: express"])
  })

  test("&& requires both literals; || unions them", () => {
    const and = preconditionOf('contains(resp.body, "alpha") && contains(resp.body, "beta")')
    expect(and.kind).toBe("all")
    const or = preconditionOf('contains(resp.body, "alpha") || contains(resp.body, "beta")')
    expect(or).toEqual({ kind: "any", literals: ["alpha", "beta"] })
  })

  test("FAIL-OPEN: computed subject, unknown regex, comparisons → unconditional (never wrongly skip)", () => {
    // literal from a COMPUTED value (not raw text) — can't be found in the raw haystack → fall open
    expect(preconditionOf('contains(base64_decode(req.header.authorization), "alg")').kind).toBe("unconditional")
    // a regex with an alternative that has no fixed literal (.* matches anything) → fall open
    expect(preconditionOf('regex(".*|AKIA[0-9]{16}", resp.body)').kind).toBe("unconditional")
    // a comparison, not a literal presence test → fall open
    expect(preconditionOf("resp.status == 500").kind).toBe("unconditional")
    // negation → fall open (absence of a literal is not a presence constraint)
    expect(preconditionOf('!contains(resp.body, "ok")').kind).toBe("unconditional")
    // too-short literal → no useful constraint → fall open
    expect(preconditionOf('contains(resp.body, "ab")').kind).toBe("unconditional")
  })
})
