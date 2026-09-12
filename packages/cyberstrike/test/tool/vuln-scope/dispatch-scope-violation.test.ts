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

    test("wstg-agent subagent", () => {
      expect(dispatchScopeViolation("wstg-agent", "test IDOR")).toBeNull()
    })
  })

  describe("correct dispatch — null", () => {
    test("input-validation tester dispatched for sqli objective", () => {
      expect(dispatchScopeViolation("wstg-input-validation", "Test for SQL injection in search")).toBeNull()
    })

    test("authorization tester dispatched for idor objective", () => {
      expect(dispatchScopeViolation("wstg-authorization", "Check IDOR in user endpoint")).toBeNull()
    })

    test("input-validation tester dispatched for ssrf objective", () => {
      expect(dispatchScopeViolation("wstg-input-validation", "Test SSRF via webhook URL")).toBeNull()
    })

    test("authentication tester dispatched for auth objective", () => {
      expect(dispatchScopeViolation("wstg-authentication", "Test brute force on login")).toBeNull()
    })
  })

  describe("wrong dispatch — returns violation", () => {
    test("input-validation tester dispatched for idor objective", () => {
      const result = dispatchScopeViolation("wstg-input-validation", "Check for IDOR in /api/users")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("input-validation")
      expect(result!.inferred).toBe("authorization")
    })

    test("authorization tester dispatched for sqli objective", () => {
      const result = dispatchScopeViolation("wstg-authorization", "Test SQL injection in search")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authorization")
      expect(result!.inferred).toBe("input-validation")
    })

    test("authentication tester dispatched for path traversal objective", () => {
      const result = dispatchScopeViolation("wstg-authentication", "Test Path Traversal in file download")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("authentication")
      expect(result!.inferred).toBe("input-validation")
    })

    test("business-logic tester dispatched for ssrf objective", () => {
      const result = dispatchScopeViolation("wstg-business-logic", "Test SSRF via URL param")
      expect(result).not.toBeNull()
      expect(result!.cls).toBe("business-logic")
      expect(result!.inferred).toBe("input-validation")
    })
  })

  describe("ambiguous objective — conservative null", () => {
    test("generic objective that cannot be classified", () => {
      expect(dispatchScopeViolation("wstg-input-validation", "Test the security of this endpoint")).toBeNull()
    })

    test("empty objective", () => {
      expect(dispatchScopeViolation("wstg-input-validation", "")).toBeNull()
    })
  })

  describe("unknown tester class — null", () => {
    test("wstg-nonexistent", () => {
      expect(dispatchScopeViolation("wstg-nonexistent", "Test SQL injection")).toBeNull()
    })
  })
})
