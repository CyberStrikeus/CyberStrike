import { describe, test, expect } from "bun:test"
import { isExecutionDependentFinding } from "../../../src/tool/vuln-scope"

describe("isExecutionDependentFinding", () => {
  describe("execution-dependent by title (returns true)", () => {
    test("XSS keyword", () => {
      expect(isExecutionDependentFinding("Reflected XSS in search parameter")).toBe(true)
    })

    test("cross-site scripting full phrase", () => {
      expect(isExecutionDependentFinding("Cross-Site Scripting via user input")).toBe(true)
    })

    test("DOM-based variant", () => {
      expect(isExecutionDependentFinding("DOM-Based XSS in client-side rendering")).toBe(true)
      expect(isExecutionDependentFinding("DOM Based script injection")).toBe(true)
    })

    test("SSTI keyword", () => {
      expect(isExecutionDependentFinding("SSTI in template engine")).toBe(true)
    })

    test("template injection full phrase", () => {
      expect(isExecutionDependentFinding("Server-Side Template Injection via Jinja2")).toBe(true)
    })

    test("command injection", () => {
      expect(isExecutionDependentFinding("Command Injection in ping utility")).toBe(true)
    })

    test("OS command variant", () => {
      expect(isExecutionDependentFinding("OS Command execution through parameter")).toBe(true)
    })

    test("RCE keyword", () => {
      expect(isExecutionDependentFinding("RCE via unsafe deserialization")).toBe(true)
    })

    test("remote code execution full phrase", () => {
      expect(isExecutionDependentFinding("Remote Code Execution in file upload")).toBe(true)
    })

    test("insecure deserialization", () => {
      expect(isExecutionDependentFinding("Insecure Deserialization of Java objects")).toBe(true)
    })

    test("deserialization variant spelling", () => {
      expect(isExecutionDependentFinding("Unsafe Deserializing user-controlled data")).toBe(true)
    })
  })

  describe("NOT execution-dependent by title (returns false)", () => {
    test("SQL injection — response is proof", () => {
      expect(isExecutionDependentFinding("SQL Injection in login form")).toBe(false)
    })

    test("LFI — response is proof", () => {
      expect(isExecutionDependentFinding("Local File Inclusion via path parameter")).toBe(false)
    })

    test("IDOR — response is proof", () => {
      expect(isExecutionDependentFinding("IDOR in user profile endpoint")).toBe(false)
    })

    test("SSRF — response is proof", () => {
      expect(isExecutionDependentFinding("SSRF via URL parameter")).toBe(false)
    })

    test("info disclosure — response is proof", () => {
      expect(isExecutionDependentFinding("Information Disclosure in error page")).toBe(false)
    })

    test("privilege escalation — not exec-dependent", () => {
      expect(isExecutionDependentFinding("Privilege Escalation via role parameter")).toBe(false)
    })
  })

  describe("word-boundary safety", () => {
    test("rce does not match commerce", () => {
      expect(isExecutionDependentFinding("E-commerce cart bypass")).toBe(false)
    })

    test("xss does not match excess", () => {
      expect(isExecutionDependentFinding("Excessive rate limiting")).toBe(false)
    })

    test("ssti does not match substring bleed", () => {
      expect(isExecutionDependentFinding("Assist integration endpoint")).toBe(false)
    })
  })

  describe("execution-dependent by CWE (title miss, CWE hit)", () => {
    test("CWE-79 (XSS)", () => {
      expect(isExecutionDependentFinding("Some generic finding", "CWE-79")).toBe(true)
    })

    test("CWE-78 (OS command injection)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-78")).toBe(true)
    })

    test("CWE-502 (deserialization)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-502")).toBe(true)
    })

    test("CWE-94 (code injection)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-94")).toBe(true)
    })

    test("CWE-917 (expression-language injection / SSTI)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-917")).toBe(true)
    })

    test("CWE-1336 (template-engine injection / SSTI)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-1336")).toBe(true)
    })

    test("CWE-80 (basic XSS)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-80")).toBe(true)
    })

    test("CWE-83 (script in attributes)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-83")).toBe(true)
    })

    test("CWE-87 (alternate XSS syntax)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-87")).toBe(true)
    })

    test("CWE-95 (eval injection)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-95")).toBe(true)
    })

    test("CWE-77 (command injection)", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-77")).toBe(true)
    })
  })

  describe("NOT execution-dependent CWEs", () => {
    test("CWE-89 (SQL injection) — response is proof", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-89")).toBe(false)
    })

    test("CWE-22 (path traversal) — response is proof", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-22")).toBe(false)
    })

    test("CWE-918 (SSRF) — response is proof", () => {
      expect(isExecutionDependentFinding("Generic title", "CWE-918")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("empty title + no CWE returns false", () => {
      expect(isExecutionDependentFinding("")).toBe(false)
    })

    test("undefined title + no CWE returns false", () => {
      expect(isExecutionDependentFinding(undefined as unknown as string)).toBe(false)
    })

    test("case-insensitive CWE matching", () => {
      expect(isExecutionDependentFinding("Generic", "cwe-79")).toBe(true)
    })

    test("CWE with whitespace is trimmed", () => {
      expect(isExecutionDependentFinding("Generic", "  CWE-79  ")).toBe(true)
    })

    test("title match takes priority — CWE not even checked", () => {
      expect(isExecutionDependentFinding("XSS in search", "CWE-89")).toBe(true)
    })
  })
})
