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

    test("wstg-agent orchestrator", () => {
      expect(vrtScopeViolation("wstg-agent", "xss")).toBeNull()
    })

    test("random agent name", () => {
      expect(vrtScopeViolation("some-other-agent", "idor")).toBeNull()
    })
  })

  describe("in-scope categories — returns null", () => {
    test("input-validation tester recording sqli", () => {
      expect(vrtScopeViolation("wstg-input-validation", "sqli")).toBeNull()
    })

    test("input-validation tester recording xss", () => {
      expect(vrtScopeViolation("wstg-input-validation", "xss")).toBeNull()
    })

    test("input-validation tester recording cross-site scripting", () => {
      expect(vrtScopeViolation("wstg-input-validation", "cross-site scripting")).toBeNull()
    })

    test("input-validation tester recording ssrf", () => {
      expect(vrtScopeViolation("wstg-input-validation", "ssrf")).toBeNull()
    })

    test("input-validation tester recording path traversal", () => {
      expect(vrtScopeViolation("wstg-input-validation", "path traversal")).toBeNull()
    })

    test("input-validation tester recording mass assignment", () => {
      expect(vrtScopeViolation("wstg-input-validation", "mass assignment")).toBeNull()
    })

    test("authorization tester recording idor", () => {
      expect(vrtScopeViolation("wstg-authorization", "idor")).toBeNull()
    })

    test("authorization tester recording bola", () => {
      expect(vrtScopeViolation("wstg-authorization", "bola")).toBeNull()
    })

    test("authentication tester recording session", () => {
      expect(vrtScopeViolation("wstg-authentication", "session")).toBeNull()
    })

    test("authentication tester recording jwt", () => {
      expect(vrtScopeViolation("wstg-authentication", "jwt")).toBeNull()
    })

    test("session-mgmt tester recording csrf", () => {
      expect(vrtScopeViolation("wstg-session-mgmt", "csrf")).toBeNull()
    })

    test("business-logic tester recording race condition", () => {
      expect(vrtScopeViolation("wstg-business-logic", "race condition")).toBeNull()
    })

    test("config-deploy tester recording misconfiguration", () => {
      expect(vrtScopeViolation("wstg-config-deploy", "misconfiguration")).toBeNull()
    })
  })

  describe("out-of-scope categories — returns violation", () => {
    test("input-validation tester recording idor", () => {
      const result = vrtScopeViolation("wstg-input-validation", "idor")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("input-validation")
      expect(result!.allowed).toEqual(TESTER_VRT_SCOPE["input-validation"])
    })

    test("authorization tester recording sqli", () => {
      const result = vrtScopeViolation("wstg-authorization", "sqli")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authorization")
    })

    test("authentication tester recording ssrf", () => {
      const result = vrtScopeViolation("wstg-authentication", "ssrf")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authentication")
    })

    test("business-logic tester recording xss", () => {
      const result = vrtScopeViolation("wstg-business-logic", "xss")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("business-logic")
    })

    test("config-deploy tester recording sql injection", () => {
      const result = vrtScopeViolation("wstg-config-deploy", "sql injection")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("config-deploy")
    })
  })

  describe("substring matching — bidirectional", () => {
    test("category contains allowed term", () => {
      expect(vrtScopeViolation("wstg-input-validation", "blind sqli attack")).toBeNull()
    })

    test("allowed term contains category", () => {
      expect(vrtScopeViolation("wstg-input-validation", "sql")).toBeNull()
    })

    test("case insensitive matching", () => {
      expect(vrtScopeViolation("wstg-input-validation", "SQL INJECTION")).toBeNull()
    })
  })

  describe("edge cases", () => {
    test("empty category — returns null (no violation)", () => {
      expect(vrtScopeViolation("wstg-input-validation", "")).toBeNull()
    })

    test("unknown tester class — returns null", () => {
      expect(vrtScopeViolation("wstg-unknown", "sqli")).toBeNull()
    })

    test("partial match wstg-tester prefix but not a real agent", () => {
      expect(vrtScopeViolation("wstg-", "sqli")).toBeNull()
    })
  })
})
