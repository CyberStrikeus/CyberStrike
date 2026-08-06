import { describe, test, expect } from "bun:test"
import { dispatchScopeViolation } from "../../../src/tool/vuln-scope"

describe("dispatchScopeViolation", () => {
  describe("non-tester subagent — always null", () => {
    test("undefined subagent", () => {
      expect(dispatchScopeViolation(undefined, "test for SQL injection")).toBeNull()
    })

    test("cyberstrike subagent", () => {
      expect(dispatchScopeViolation("cyberstrike", "test for XSS")).toBeNull()
    })

    test("web-application subagent", () => {
      expect(dispatchScopeViolation("web-application", "test IDOR")).toBeNull()
    })
  })

  describe("correct dispatch — null", () => {
    test("injection tester dispatched for sqli objective", () => {
      expect(dispatchScopeViolation("proxy-tester-injection", "Test for SQL injection in search")).toBeNull()
    })

    test("idor tester dispatched for idor objective", () => {
      expect(dispatchScopeViolation("proxy-tester-idor", "Check IDOR in user endpoint")).toBeNull()
    })

    test("ssrf tester dispatched for ssrf objective", () => {
      expect(dispatchScopeViolation("proxy-tester-ssrf", "Test SSRF via webhook URL")).toBeNull()
    })

    test("authn tester dispatched for auth objective", () => {
      expect(dispatchScopeViolation("proxy-tester-authn", "Test brute force on login")).toBeNull()
    })
  })

  describe("wrong dispatch — returns violation", () => {
    test("injection tester dispatched for idor objective", () => {
      const result = dispatchScopeViolation("proxy-tester-injection", "Check for IDOR in /api/users")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("injection")
      expect(result!.inferred).toBe("idor")
    })

    test("idor tester dispatched for sqli objective", () => {
      const result = dispatchScopeViolation("proxy-tester-idor", "Test SQL injection in search")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("idor")
      expect(result!.inferred).toBe("injection")
    })

    test("authn tester dispatched for path traversal objective", () => {
      const result = dispatchScopeViolation("proxy-tester-authn", "Test Path Traversal in file download")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authn")
      expect(result!.inferred).toBe("file-attacks")
    })

    test("business-logic tester dispatched for ssrf objective", () => {
      const result = dispatchScopeViolation("proxy-tester-business-logic", "Test SSRF via URL param")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("business-logic")
      expect(result!.inferred).toBe("ssrf")
    })
  })

  describe("ambiguous objective — conservative null", () => {
    test("generic objective that cannot be classified", () => {
      expect(dispatchScopeViolation("proxy-tester-injection", "Test the security of this endpoint")).toBeNull()
    })

    test("empty objective", () => {
      expect(dispatchScopeViolation("proxy-tester-injection", "")).toBeNull()
    })
  })

  describe("unknown tester class — null", () => {
    test("proxy-tester-nonexistent", () => {
      expect(dispatchScopeViolation("proxy-tester-nonexistent", "Test SQL injection")).toBeNull()
    })
  })
})
