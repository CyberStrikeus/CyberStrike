import { describe, test, expect } from "bun:test"
import { classifyFindingTitle } from "../../../src/tool/vuln-scope"

describe("classifyFindingTitle", () => {
  describe("injection class", () => {
    test("SQL injection", () => {
      expect(classifyFindingTitle("SQL Injection in login form")).toBe("injection")
    })

    test("SQLi shorthand", () => {
      expect(classifyFindingTitle("Blind SQLi via search parameter")).toBe("injection")
    })

    test("NoSQL injection", () => {
      expect(classifyFindingTitle("NoSQLi in MongoDB query")).toBe("injection")
    })

    test("XSS", () => {
      expect(classifyFindingTitle("Reflected XSS in search")).toBe("injection")
    })

    test("cross-site scripting full phrase", () => {
      expect(classifyFindingTitle("Cross-Site Scripting via user input")).toBe("injection")
    })

    test("SSTI", () => {
      expect(classifyFindingTitle("SSTI in Jinja2 template")).toBe("injection")
    })

    test("XXE", () => {
      expect(classifyFindingTitle("XXE via XML parser")).toBe("injection")
    })

    test("command injection", () => {
      expect(classifyFindingTitle("Command Injection in ping utility")).toBe("injection")
    })

    test("LDAP injection", () => {
      expect(classifyFindingTitle("LDAP Injection in directory lookup")).toBe("injection")
    })
  })

  describe("idor class", () => {
    test("IDOR keyword", () => {
      expect(classifyFindingTitle("IDOR in user profile endpoint")).toBe("idor")
    })

    test("BOLA keyword", () => {
      expect(classifyFindingTitle("BOLA: accessing other user data")).toBe("idor")
    })

    test("insecure direct object reference", () => {
      expect(classifyFindingTitle("Insecure Direct Object reference in /api/orders")).toBe("idor")
    })
  })

  describe("ssrf class", () => {
    test("SSRF keyword", () => {
      expect(classifyFindingTitle("SSRF via URL parameter")).toBe("ssrf")
    })

    test("server-side request forgery full phrase", () => {
      expect(classifyFindingTitle("Server-Side Request Forgery in webhook")).toBe("ssrf")
    })
  })

  describe("file-attacks class", () => {
    test("path traversal", () => {
      expect(classifyFindingTitle("Path Traversal in file download")).toBe("file-attacks")
    })

    test("directory traversal", () => {
      expect(classifyFindingTitle("Directory Traversal via filename param")).toBe("file-attacks")
    })

    test("LFI", () => {
      expect(classifyFindingTitle("LFI via include parameter")).toBe("file-attacks")
    })

    test("RFI", () => {
      expect(classifyFindingTitle("RFI through remote URL inclusion")).toBe("file-attacks")
    })

    test("arbitrary file read", () => {
      expect(classifyFindingTitle("Arbitrary File Read via symlink")).toBe("file-attacks")
    })

    test("arbitrary file upload", () => {
      expect(classifyFindingTitle("Arbitrary File Upload bypassing filter")).toBe("file-attacks")
    })

    test("zip slip", () => {
      expect(classifyFindingTitle("Zip Slip in archive extraction")).toBe("file-attacks")
    })
  })

  describe("mass-assignment class", () => {
    test("mass assignment", () => {
      expect(classifyFindingTitle("Mass Assignment in user registration")).toBe("mass-assignment")
    })

    test("overposting variant", () => {
      expect(classifyFindingTitle("Over-Posting to set admin flag")).toBe("mass-assignment")
    })
  })

  describe("authn class", () => {
    test("default credentials", () => {
      expect(classifyFindingTitle("Default Credentials on admin panel")).toBe("authn")
    })

    test("brute force", () => {
      expect(classifyFindingTitle("Brute-Force attack on login")).toBe("authn")
    })

    test("rate limit", () => {
      expect(classifyFindingTitle("Rate Limit bypass on OTP endpoint")).toBe("authn")
    })

    test("password policy", () => {
      expect(classifyFindingTitle("Weak Password Policy allows short passwords")).toBe("authn")
    })

    test("account lockout", () => {
      expect(classifyFindingTitle("No Account Lockout after failed attempts")).toBe("authn")
    })

    test("session fixation", () => {
      expect(classifyFindingTitle("Session Fixation via cookie injection")).toBe("authn")
    })

    test("weak password", () => {
      expect(classifyFindingTitle("Weak Password stored in plaintext")).toBe("authn")
    })
  })

  describe("authz class", () => {
    test("broken access control", () => {
      expect(classifyFindingTitle("Broken Access Control in admin API")).toBe("authz")
    })

    test("privilege escalation", () => {
      expect(classifyFindingTitle("Privilege Escalation via role param")).toBe("authz")
    })

    test("unauthenticated access to", () => {
      expect(classifyFindingTitle("Unauthenticated Access to /admin/settings")).toBe("authz")
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

  describe("returns null for unclassifiable", () => {
    test("generic security finding", () => {
      expect(classifyFindingTitle("Security misconfiguration in headers")).toBeNull()
    })

    test("empty string", () => {
      expect(classifyFindingTitle("")).toBeNull()
    })

    test("null/undefined handling", () => {
      expect(classifyFindingTitle(undefined as unknown as string)).toBeNull()
    })

    test("information disclosure (not in any class)", () => {
      expect(classifyFindingTitle("Sensitive Information in response headers")).toBeNull()
    })
  })

  describe("priority ordering", () => {
    test("injection wins over authz when both match", () => {
      expect(classifyFindingTitle("SQL Injection leading to privilege escalation")).toBe("injection")
    })

    test("injection wins over idor when both keywords present (injection is first in scan order)", () => {
      expect(classifyFindingTitle("IDOR with SQL injection chain")).toBe("injection")
    })
  })
})
