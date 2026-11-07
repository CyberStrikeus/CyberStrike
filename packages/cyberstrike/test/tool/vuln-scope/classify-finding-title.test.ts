import { describe, test, expect } from "bun:test"
import { classifyFindingTitle } from "../../../src/tool/vuln-scope"

describe("classifyFindingTitle", () => {
  describe("input-validation class", () => {
    test("SQL injection", () => {
      expect(classifyFindingTitle("SQL Injection in login form")).toBe("input-validation")
    })

    test("SQLi shorthand", () => {
      expect(classifyFindingTitle("Blind SQLi via search parameter")).toBe("input-validation")
    })

    test("NoSQL injection", () => {
      expect(classifyFindingTitle("NoSQLi in MongoDB query")).toBe("input-validation")
    })

    test("XSS", () => {
      expect(classifyFindingTitle("Reflected XSS in search")).toBe("input-validation")
    })

    test("cross-site scripting full phrase", () => {
      expect(classifyFindingTitle("Cross-Site Scripting via user input")).toBe("input-validation")
    })

    test("SSTI", () => {
      expect(classifyFindingTitle("SSTI in Jinja2 template")).toBe("input-validation")
    })

    test("XXE", () => {
      expect(classifyFindingTitle("XXE via XML parser")).toBe("input-validation")
    })

    test("command injection", () => {
      expect(classifyFindingTitle("Command Injection in ping utility")).toBe("input-validation")
    })

    test("LDAP injection", () => {
      expect(classifyFindingTitle("LDAP Injection in directory lookup")).toBe("input-validation")
    })

    test("SSRF", () => {
      expect(classifyFindingTitle("SSRF via URL parameter")).toBe("input-validation")
    })

    test("server-side request forgery full phrase", () => {
      expect(classifyFindingTitle("Server-Side Request Forgery in webhook")).toBe("input-validation")
    })

    test("path traversal", () => {
      expect(classifyFindingTitle("Path Traversal in file download")).toBe("input-validation")
    })

    test("directory traversal", () => {
      expect(classifyFindingTitle("Directory Traversal via filename param")).toBe("input-validation")
    })

    test("LFI", () => {
      expect(classifyFindingTitle("LFI via include parameter")).toBe("input-validation")
    })

    test("RFI", () => {
      expect(classifyFindingTitle("RFI through remote URL inclusion")).toBe("input-validation")
    })

    test("arbitrary file read", () => {
      expect(classifyFindingTitle("Arbitrary File Read via symlink")).toBe("input-validation")
    })

    test("arbitrary file upload", () => {
      expect(classifyFindingTitle("Arbitrary File Upload bypassing filter")).toBe("input-validation")
    })

    test("zip slip", () => {
      expect(classifyFindingTitle("Zip Slip in archive extraction")).toBe("input-validation")
    })

    test("mass assignment", () => {
      expect(classifyFindingTitle("Mass Assignment in user registration")).toBe("input-validation")
    })

    test("overposting variant", () => {
      expect(classifyFindingTitle("Over-Posting to set admin flag")).toBe("input-validation")
    })
  })

  describe("authorization class", () => {
    test("IDOR keyword", () => {
      expect(classifyFindingTitle("IDOR in user profile endpoint")).toBe("authorization")
    })

    test("BOLA keyword", () => {
      expect(classifyFindingTitle("BOLA: accessing other user data")).toBe("authorization")
    })

    test("insecure direct object reference", () => {
      expect(classifyFindingTitle("Insecure Direct Object reference in /api/orders")).toBe("authorization")
    })

    test("broken access control", () => {
      expect(classifyFindingTitle("Broken Access Control in admin API")).toBe("authorization")
    })

    test("privilege escalation", () => {
      expect(classifyFindingTitle("Privilege Escalation via role param")).toBe("authorization")
    })

    test("unauthenticated access to", () => {
      expect(classifyFindingTitle("Unauthenticated Access to /admin/settings")).toBe("authorization")
    })
  })

  describe("authentication class", () => {
    test("default credentials", () => {
      expect(classifyFindingTitle("Default Credentials on admin panel")).toBe("authentication")
    })

    test("brute force", () => {
      expect(classifyFindingTitle("Brute-Force attack on login")).toBe("authentication")
    })

    test("rate limit", () => {
      expect(classifyFindingTitle("Rate Limit bypass on OTP endpoint")).toBe("authentication")
    })

    test("password policy", () => {
      expect(classifyFindingTitle("Weak Password Policy allows short passwords")).toBe("authentication")
    })

    test("account lockout", () => {
      expect(classifyFindingTitle("No Account Lockout after failed attempts")).toBe("authentication")
    })

    test("session fixation", () => {
      expect(classifyFindingTitle("Session Fixation via cookie injection")).toBe("authentication")
    })

    test("weak password", () => {
      expect(classifyFindingTitle("Weak Password stored in plaintext")).toBe("authentication")
    })
  })

  describe("session-mgmt class", () => {
    test("CSRF", () => {
      expect(classifyFindingTitle("CSRF on password change form")).toBe("session-mgmt")
    })

    test("cross-site request forgery", () => {
      expect(classifyFindingTitle("Cross-Site Request Forgery in settings")).toBe("session-mgmt")
    })

    test("cookie flag", () => {
      expect(classifyFindingTitle("Cookie Flag missing HttpOnly")).toBe("session-mgmt")
    })
  })

  describe("business-logic class", () => {
    test("race condition", () => {
      expect(classifyFindingTitle("Race Condition in checkout flow")).toBe("business-logic")
    })

    test("negative amount", () => {
      expect(classifyFindingTitle("Negative Amount accepted in payment")).toBe("business-logic")
    })

    test("workflow bypass", () => {
      expect(classifyFindingTitle("Workflow Bypass skipping approval step")).toBe("business-logic")
    })
  })

  describe("config-deploy class", () => {
    test("misconfiguration", () => {
      expect(classifyFindingTitle("Security Misconfiguration in server headers")).toBe("config-deploy")
    })

    test("information disclosure", () => {
      expect(classifyFindingTitle("Information Disclosure via error page")).toBe("config-deploy")
    })

    test("stack trace", () => {
      expect(classifyFindingTitle("Stack Trace exposed in 500 response")).toBe("config-deploy")
    })
  })

  describe("llm class", () => {
    test("prompt injection", () => {
      expect(classifyFindingTitle("Prompt Injection via chat input")).toBe("llm")
    })

    test("jailbreak", () => {
      expect(classifyFindingTitle("Jailbreak bypasses system prompt")).toBe("llm")
    })

    test("system prompt leak", () => {
      expect(classifyFindingTitle("System Prompt Leak via role-play")).toBe("llm")
    })
  })

  describe("returns null for unclassifiable", () => {
    test("generic security finding", () => {
      expect(classifyFindingTitle("Potential issue in endpoint")).toBeNull()
    })

    test("empty string", () => {
      expect(classifyFindingTitle("")).toBeNull()
    })

    test("null/undefined handling", () => {
      expect(classifyFindingTitle(undefined as unknown as string)).toBeNull()
    })

    test("ambiguous short text", () => {
      expect(classifyFindingTitle("Suspicious response from API")).toBeNull()
    })
  })

  describe("priority ordering", () => {
    test("input-validation wins over authorization when both match", () => {
      expect(classifyFindingTitle("SQL Injection leading to privilege escalation")).toBe("input-validation")
    })

    test("input-validation wins over authorization when both keywords present (input-validation is first in scan order)", () => {
      expect(classifyFindingTitle("IDOR with SQL injection chain")).toBe("input-validation")
    })
  })
})
