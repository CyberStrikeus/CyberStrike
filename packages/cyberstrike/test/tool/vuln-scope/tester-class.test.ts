import { describe, test, expect } from "bun:test"
import { testerClass, categoryInLane } from "../../../src/tool/vuln-scope"

describe("testerClass", () => {
  describe("recognized hunt-tester agents", () => {
    test("hunt-injection returns injection", () => {
      expect(testerClass("hunt-injection")).toBe("injection")
    })

    test("hunt-idor returns idor", () => {
      expect(testerClass("hunt-idor")).toBe("idor")
    })

    test("hunt-ssrf returns ssrf", () => {
      expect(testerClass("hunt-ssrf")).toBe("ssrf")
    })

    test("hunt-authn returns authn", () => {
      expect(testerClass("hunt-authn")).toBe("authn")
    })

    test("hunt-authz returns authz", () => {
      expect(testerClass("hunt-authz")).toBe("authz")
    })

    test("hunt-file-attacks returns file-attacks", () => {
      expect(testerClass("hunt-file-attacks")).toBe("file-attacks")
    })

    test("hunt-mass-assignment returns mass-assignment", () => {
      expect(testerClass("hunt-mass-assignment")).toBe("mass-assignment")
    })

    test("hunt-business-logic returns business-logic", () => {
      expect(testerClass("hunt-business-logic")).toBe("business-logic")
    })
  })

  describe("non-tester agents return undefined", () => {
    test("undefined agent", () => {
      expect(testerClass(undefined)).toBeUndefined()
    })

    test("cyberstrike agent", () => {
      expect(testerClass("cyberstrike")).toBeUndefined()
    })

    test("hunt-agent agent", () => {
      expect(testerClass("hunt-agent")).toBeUndefined()
    })

    test("unknown tester class", () => {
      expect(testerClass("hunt-unknown")).toBeUndefined()
    })

    test("empty string", () => {
      expect(testerClass("")).toBeUndefined()
    })
  })
})

describe("categoryInLane", () => {
  describe("in-lane categories — returns true", () => {
    test("injection + sqli", () => {
      expect(categoryInLane("injection", "sqli")).toBe(true)
    })

    test("injection + xss", () => {
      expect(categoryInLane("injection", "xss")).toBe(true)
    })

    test("idor + idor", () => {
      expect(categoryInLane("idor", "idor")).toBe(true)
    })

    test("authn + jwt", () => {
      expect(categoryInLane("authn", "jwt")).toBe(true)
    })

    test("file-attacks + lfi", () => {
      expect(categoryInLane("file-attacks", "lfi")).toBe(true)
    })
  })

  describe("out-of-lane categories — returns false", () => {
    test("injection + idor", () => {
      expect(categoryInLane("injection", "idor")).toBe(false)
    })

    test("idor + ssrf", () => {
      expect(categoryInLane("idor", "ssrf")).toBe(false)
    })

    test("authn + path traversal", () => {
      expect(categoryInLane("authn", "path traversal")).toBe(false)
    })
  })

  describe("conservative defaults — returns true", () => {
    test("unknown class returns true", () => {
      expect(categoryInLane("nonexistent", "sqli")).toBe(true)
    })

    test("empty category returns true", () => {
      expect(categoryInLane("injection", "")).toBe(true)
    })

    test("undefined-like category returns true", () => {
      expect(categoryInLane("injection", undefined as unknown as string)).toBe(true)
    })
  })
})
