import { describe, test, expect } from "bun:test"
import { testerClass, categoryInLane } from "../../../src/tool/vuln-scope"

describe("testerClass", () => {
  describe("recognized proxy-tester agents", () => {
    test("proxy-tester-injection returns injection", () => {
      expect(testerClass("proxy-tester-injection")).toBe("injection")
    })

    test("proxy-tester-idor returns idor", () => {
      expect(testerClass("proxy-tester-idor")).toBe("idor")
    })

    test("proxy-tester-ssrf returns ssrf", () => {
      expect(testerClass("proxy-tester-ssrf")).toBe("ssrf")
    })

    test("proxy-tester-authn returns authn", () => {
      expect(testerClass("proxy-tester-authn")).toBe("authn")
    })

    test("proxy-tester-authz returns authz", () => {
      expect(testerClass("proxy-tester-authz")).toBe("authz")
    })

    test("proxy-tester-file-attacks returns file-attacks", () => {
      expect(testerClass("proxy-tester-file-attacks")).toBe("file-attacks")
    })

    test("proxy-tester-mass-assignment returns mass-assignment", () => {
      expect(testerClass("proxy-tester-mass-assignment")).toBe("mass-assignment")
    })

    test("proxy-tester-business-logic returns business-logic", () => {
      expect(testerClass("proxy-tester-business-logic")).toBe("business-logic")
    })
  })

  describe("non-tester agents return undefined", () => {
    test("undefined agent", () => {
      expect(testerClass(undefined)).toBeUndefined()
    })

    test("cyberstrike agent", () => {
      expect(testerClass("cyberstrike")).toBeUndefined()
    })

    test("web-application agent", () => {
      expect(testerClass("web-application")).toBeUndefined()
    })

    test("unknown tester class", () => {
      expect(testerClass("proxy-tester-unknown")).toBeUndefined()
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
