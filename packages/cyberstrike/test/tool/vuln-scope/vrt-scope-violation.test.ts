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

    test("web-application agent", () => {
      expect(vrtScopeViolation("web-application", "xss")).toBeNull()
    })

    test("random agent name", () => {
      expect(vrtScopeViolation("some-other-agent", "idor")).toBeNull()
    })
  })

  describe("in-scope categories — returns null", () => {
    test("injection tester recording sqli", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "sqli")).toBeNull()
    })

    test("injection tester recording xss", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "xss")).toBeNull()
    })

    test("injection tester recording cross-site scripting", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "cross-site scripting")).toBeNull()
    })

    test("idor tester recording idor", () => {
      expect(vrtScopeViolation("proxy-tester-idor", "idor")).toBeNull()
    })

    test("idor tester recording bola", () => {
      expect(vrtScopeViolation("proxy-tester-idor", "bola")).toBeNull()
    })

    test("ssrf tester recording ssrf", () => {
      expect(vrtScopeViolation("proxy-tester-ssrf", "ssrf")).toBeNull()
    })

    test("authn tester recording session", () => {
      expect(vrtScopeViolation("proxy-tester-authn", "session")).toBeNull()
    })

    test("authn tester recording jwt", () => {
      expect(vrtScopeViolation("proxy-tester-authn", "jwt")).toBeNull()
    })

    test("file-attacks tester recording path traversal", () => {
      expect(vrtScopeViolation("proxy-tester-file-attacks", "path traversal")).toBeNull()
    })

    test("business-logic tester recording race condition", () => {
      expect(vrtScopeViolation("proxy-tester-business-logic", "race condition")).toBeNull()
    })
  })

  describe("out-of-scope categories — returns violation", () => {
    test("injection tester recording idor", () => {
      const result = vrtScopeViolation("proxy-tester-injection", "idor")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
      expect(result!.allowed).toEqual(TESTER_VRT_SCOPE["injection"])
    })

    test("idor tester recording sqli", () => {
      const result = vrtScopeViolation("proxy-tester-idor", "sqli")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("idor")
    })

    test("authn tester recording ssrf", () => {
      const result = vrtScopeViolation("proxy-tester-authn", "ssrf")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authn")
    })

    test("ssrf tester recording xss", () => {
      const result = vrtScopeViolation("proxy-tester-ssrf", "xss")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("ssrf")
    })

    test("file-attacks tester recording sql injection", () => {
      const result = vrtScopeViolation("proxy-tester-file-attacks", "sql injection")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("file-attacks")
    })
  })

  describe("substring matching — bidirectional", () => {
    test("category contains allowed term", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "blind sqli attack")).toBeNull()
    })

    test("allowed term contains category", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "sql")).toBeNull()
    })

    test("case insensitive matching", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "SQL INJECTION")).toBeNull()
    })
  })

  describe("edge cases", () => {
    test("empty category — returns null (no violation)", () => {
      expect(vrtScopeViolation("proxy-tester-injection", "")).toBeNull()
    })

    test("unknown tester class — returns null", () => {
      expect(vrtScopeViolation("proxy-tester-unknown", "sqli")).toBeNull()
    })

    test("partial match proxy-tester prefix but not a real agent", () => {
      expect(vrtScopeViolation("proxy-tester-", "sqli")).toBeNull()
    })
  })
})
