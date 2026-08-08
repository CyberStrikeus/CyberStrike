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

    test("web-application agent", () => {
      expect(reportScopeViolation("web-application", "xss", "XSS attack")).toBeNull()
    })
  })

  describe("in-scope category + matching title — null", () => {
    test("injection tester, sqli category, sqli title", () => {
      expect(reportScopeViolation("proxy-tester-injection", "sqli", "SQL Injection in search")).toBeNull()
    })

    test("idor tester, idor category, idor title", () => {
      expect(reportScopeViolation("proxy-tester-idor", "idor", "IDOR in user endpoint")).toBeNull()
    })

    test("ssrf tester, ssrf category, ssrf title", () => {
      expect(reportScopeViolation("proxy-tester-ssrf", "ssrf", "SSRF via webhook")).toBeNull()
    })
  })

  describe("out-of-scope category — violation returned", () => {
    test("injection tester with idor category", () => {
      const result = reportScopeViolation("proxy-tester-injection", "idor", "IDOR in profile")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
    })

    test("idor tester with sqli category", () => {
      const result = reportScopeViolation("proxy-tester-idor", "sqli", "SQL Injection")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("idor")
    })
  })

  describe("anti-spoof: in-scope category but title reveals different class", () => {
    test("injection tester claims sqli but title says IDOR", () => {
      const result = reportScopeViolation("proxy-tester-injection", "sqli", "IDOR in user profile endpoint")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
    })

    test("idor tester claims bola but title says SQL Injection", () => {
      const result = reportScopeViolation("proxy-tester-idor", "bola", "SQL Injection in search parameter")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("idor")
    })

    test("authn tester claims session but title says path traversal", () => {
      const result = reportScopeViolation("proxy-tester-authn", "session", "Path Traversal in file download")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authn")
    })
  })

  describe("unclassifiable title — no anti-spoof rejection", () => {
    test("injection tester with in-scope category and generic title", () => {
      expect(reportScopeViolation("proxy-tester-injection", "sqli", "Security issue in endpoint")).toBeNull()
    })

    test("idor tester with in-scope category and generic title", () => {
      expect(reportScopeViolation("proxy-tester-idor", "idor", "Vulnerable endpoint found")).toBeNull()
    })
  })

  describe("no explicit category — title-only inference", () => {
    test("injection tester, no category, injection title — null", () => {
      expect(reportScopeViolation("proxy-tester-injection", undefined, "SQL Injection in login")).toBeNull()
    })

    test("injection tester, no category, idor title — violation", () => {
      const result = reportScopeViolation("proxy-tester-injection", undefined, "IDOR in user profile")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
    })

    test("injection tester, no category, generic title — null", () => {
      expect(reportScopeViolation("proxy-tester-injection", undefined, "Found a security issue")).toBeNull()
    })
  })

  describe("unknown tester class — null", () => {
    test("proxy-tester-nonexistent", () => {
      expect(reportScopeViolation("proxy-tester-nonexistent", "sqli", "SQL Injection")).toBeNull()
    })
  })
})
