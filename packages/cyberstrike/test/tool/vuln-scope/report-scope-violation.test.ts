import { describe, test, expect } from "bun:test"
import { reportScopeViolation } from "../../../src/tool/vuln-scope"

describe("reportScopeViolation", () => {
  describe("non-tester agents — always null", () => {
    test("undefined agent", () => {
      expect(reportScopeViolation(undefined, "sqli", "SQL Injection in login")).toBeNull()
    })

    test("cyberstrike agent", () => {
      expect(reportScopeViolation("cyberstrike", "sqli", "SQL Injection")).toBeNull()
    })

    test("wstg-agent orchestrator", () => {
      expect(reportScopeViolation("wstg-agent", "xss", "XSS attack")).toBeNull()
    })
  })

  describe("in-scope category + matching title — null", () => {
    test("input-validation tester, sqli category, sqli title", () => {
      expect(reportScopeViolation("wstg-input-validation", "sqli", "SQL Injection in search")).toBeNull()
    })

    test("authorization tester, idor category, idor title", () => {
      expect(reportScopeViolation("wstg-authorization", "idor", "IDOR in user endpoint")).toBeNull()
    })

    test("input-validation tester, ssrf category, ssrf title", () => {
      expect(reportScopeViolation("wstg-input-validation", "ssrf", "SSRF via webhook")).toBeNull()
    })
  })

  describe("out-of-scope category — violation returned", () => {
    test("input-validation tester with idor category", () => {
      const result = reportScopeViolation("wstg-input-validation", "idor", "IDOR in profile")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("input-validation")
    })

    test("authorization tester with sqli category", () => {
      const result = reportScopeViolation("wstg-authorization", "sqli", "SQL Injection")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authorization")
    })
  })

  describe("anti-spoof: in-scope category but title reveals different class", () => {
    test("input-validation tester claims sqli but title says IDOR", () => {
      const result = reportScopeViolation("wstg-input-validation", "sqli", "IDOR in user profile endpoint")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("input-validation")
    })

    test("authorization tester claims bola but title says SQL Injection", () => {
      const result = reportScopeViolation("wstg-authorization", "bola", "SQL Injection in search parameter")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authorization")
    })

    test("authentication tester claims session but title says path traversal", () => {
      const result = reportScopeViolation("wstg-authentication", "session", "Path Traversal in file download")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authentication")
    })
  })

  describe("unclassifiable title — no anti-spoof rejection", () => {
    test("input-validation tester with in-scope category and generic title", () => {
      expect(reportScopeViolation("wstg-input-validation", "sqli", "Security issue in endpoint")).toBeNull()
    })

    test("authorization tester with in-scope category and generic title", () => {
      expect(reportScopeViolation("wstg-authorization", "idor", "Vulnerable endpoint found")).toBeNull()
    })
  })

  describe("no explicit category — title-only inference", () => {
    test("input-validation tester, no category, injection title — null", () => {
      expect(reportScopeViolation("wstg-input-validation", undefined, "SQL Injection in login")).toBeNull()
    })

    test("input-validation tester, no category, idor title — violation", () => {
      const result = reportScopeViolation("wstg-input-validation", undefined, "IDOR in user profile")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("input-validation")
    })

    test("input-validation tester, no category, generic title — null", () => {
      expect(reportScopeViolation("wstg-input-validation", undefined, "Found a security issue")).toBeNull()
    })
  })

  describe("unknown tester class — null", () => {
    test("wstg-nonexistent", () => {
      expect(reportScopeViolation("wstg-nonexistent", "sqli", "SQL Injection")).toBeNull()
    })
  })
})
