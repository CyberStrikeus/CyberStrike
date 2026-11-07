import { describe, test, expect } from "bun:test"
import { testerClass, categoryInLane } from "../../../src/tool/vuln-scope"

describe("testerClass", () => {
  describe("recognized wstg-tester agents", () => {
    test("wstg-input-validation returns input-validation", () => {
      expect(testerClass("wstg-input-validation")).toBe("input-validation")
    })

    test("wstg-authorization returns authorization", () => {
      expect(testerClass("wstg-authorization")).toBe("authorization")
    })

    test("wstg-authentication returns authentication", () => {
      expect(testerClass("wstg-authentication")).toBe("authentication")
    })

    test("wstg-session-mgmt returns session-mgmt", () => {
      expect(testerClass("wstg-session-mgmt")).toBe("session-mgmt")
    })

    test("wstg-business-logic returns business-logic", () => {
      expect(testerClass("wstg-business-logic")).toBe("business-logic")
    })

    test("wstg-config-deploy returns config-deploy", () => {
      expect(testerClass("wstg-config-deploy")).toBe("config-deploy")
    })

    test("wstg-llm returns llm", () => {
      expect(testerClass("wstg-llm")).toBe("llm")
    })
  })

  describe("non-tester agents return undefined", () => {
    test("undefined agent", () => {
      expect(testerClass(undefined)).toBeUndefined()
    })

    test("cyberstrike agent", () => {
      expect(testerClass("cyberstrike")).toBeUndefined()
    })

    test("wstg-agent orchestrator", () => {
      expect(testerClass("wstg-agent")).toBeUndefined()
    })

    test("unknown tester class", () => {
      expect(testerClass("wstg-unknown")).toBeUndefined()
    })

    test("empty string", () => {
      expect(testerClass("")).toBeUndefined()
    })
  })
})

describe("categoryInLane", () => {
  describe("in-lane categories — returns true", () => {
    test("input-validation + sqli", () => {
      expect(categoryInLane("input-validation", "sqli")).toBe(true)
    })

    test("input-validation + xss", () => {
      expect(categoryInLane("input-validation", "xss")).toBe(true)
    })

    test("input-validation + ssrf", () => {
      expect(categoryInLane("input-validation", "ssrf")).toBe(true)
    })

    test("input-validation + path traversal", () => {
      expect(categoryInLane("input-validation", "path traversal")).toBe(true)
    })

    test("input-validation + mass assignment", () => {
      expect(categoryInLane("input-validation", "mass assignment")).toBe(true)
    })

    test("authorization + idor", () => {
      expect(categoryInLane("authorization", "idor")).toBe(true)
    })

    test("authorization + bola", () => {
      expect(categoryInLane("authorization", "bola")).toBe(true)
    })

    test("authentication + jwt", () => {
      expect(categoryInLane("authentication", "jwt")).toBe(true)
    })

    test("session-mgmt + csrf", () => {
      expect(categoryInLane("session-mgmt", "csrf")).toBe(true)
    })
  })

  describe("out-of-lane categories — returns false", () => {
    test("input-validation + idor", () => {
      expect(categoryInLane("input-validation", "idor")).toBe(false)
    })

    test("authorization + ssrf", () => {
      expect(categoryInLane("authorization", "ssrf")).toBe(false)
    })

    test("authentication + path traversal", () => {
      expect(categoryInLane("authentication", "path traversal")).toBe(false)
    })
  })

  describe("conservative defaults — returns true", () => {
    test("unknown class returns true", () => {
      expect(categoryInLane("nonexistent", "sqli")).toBe(true)
    })

    test("empty category returns true", () => {
      expect(categoryInLane("input-validation", "")).toBe(true)
    })

    test("undefined-like category returns true", () => {
      expect(categoryInLane("input-validation", undefined as unknown as string)).toBe(true)
    })
  })
})
