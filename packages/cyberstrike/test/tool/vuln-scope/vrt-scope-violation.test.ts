import { describe, test, expect } from "bun:test"
import { vrtScopeViolation, TESTER_VRT_SCOPE } from "../../../src/tool/vuln-scope"

describe("vrtScopeViolation", () => {
  describe("non-tester agents — always returns null (unrestricted)", () => {
    test("undefined agent", () => {
      expect(vrtScopeViolation(undefined, "sqli")).toBeNull()
    })

    test("cyberstrike agent", () => {
      expect(vrtScopeViolation("cyberstrike", "sqli")).toBeNull()
    })

    test("hunt-agent agent", () => {
      expect(vrtScopeViolation("hunt-agent", "xss")).toBeNull()
    })

    test("random agent name", () => {
      expect(vrtScopeViolation("some-other-agent", "idor")).toBeNull()
    })
  })

  describe("in-scope categories — returns null", () => {
    test("injection tester recording sqli", () => {
      expect(vrtScopeViolation("hunt-injection", "sqli")).toBeNull()
    })

    test("injection tester recording xss", () => {
      expect(vrtScopeViolation("hunt-injection", "xss")).toBeNull()
    })

    test("injection tester recording cross-site scripting", () => {
      expect(vrtScopeViolation("hunt-injection", "cross-site scripting")).toBeNull()
    })

    test("idor tester recording idor", () => {
      expect(vrtScopeViolation("hunt-idor", "idor")).toBeNull()
    })

    test("idor tester recording bola", () => {
      expect(vrtScopeViolation("hunt-idor", "bola")).toBeNull()
    })

    test("ssrf tester recording ssrf", () => {
      expect(vrtScopeViolation("hunt-ssrf", "ssrf")).toBeNull()
    })

    test("authn tester recording session", () => {
      expect(vrtScopeViolation("hunt-authn", "session")).toBeNull()
    })

    test("authn tester recording jwt", () => {
      expect(vrtScopeViolation("hunt-authn", "jwt")).toBeNull()
    })

    test("file-attacks tester recording path traversal", () => {
      expect(vrtScopeViolation("hunt-file-attacks", "path traversal")).toBeNull()
    })

    test("business-logic tester recording race condition", () => {
      expect(vrtScopeViolation("hunt-business-logic", "race condition")).toBeNull()
    })
  })

  describe("out-of-scope categories — returns violation", () => {
    test("injection tester recording idor", () => {
      const result = vrtScopeViolation("hunt-injection", "idor")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
      expect(result!.allowed).toEqual(TESTER_VRT_SCOPE["injection"])
    })

    test("idor tester recording sqli", () => {
      const result = vrtScopeViolation("hunt-idor", "sqli")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("idor")
    })

    test("authn tester recording ssrf", () => {
      const result = vrtScopeViolation("hunt-authn", "ssrf")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authn")
    })

    test("ssrf tester recording xss", () => {
      const result = vrtScopeViolation("hunt-ssrf", "xss")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("ssrf")
    })

    test("file-attacks tester recording sql injection", () => {
      const result = vrtScopeViolation("hunt-file-attacks", "sql injection")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("file-attacks")
    })
  })

  describe("substring matching — bidirectional", () => {
    test("category contains allowed term", () => {
      expect(vrtScopeViolation("hunt-injection", "blind sqli attack")).toBeNull()
    })

    test("allowed term contains category", () => {
      expect(vrtScopeViolation("hunt-injection", "sql")).toBeNull()
    })

    test("case insensitive matching", () => {
      expect(vrtScopeViolation("hunt-injection", "SQL INJECTION")).toBeNull()
    })
  })

  describe("edge cases", () => {
    test("empty category — returns null (no violation)", () => {
      expect(vrtScopeViolation("hunt-injection", "")).toBeNull()
    })

    test("unknown tester class — returns null", () => {
      expect(vrtScopeViolation("hunt-unknown", "sqli")).toBeNull()
    })

    test("partial match hunt-tester prefix but not a real agent", () => {
      expect(vrtScopeViolation("hunt-", "sqli")).toBeNull()
    })
  })
})
