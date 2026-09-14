import { describe, test, expect } from "bun:test"
import { luhnValid, findSensitive, classifyHsts, findMixedContent } from "../../../src/tool/crypto-probe/signatures"

describe("crypto-probe/signatures", () => {
  test("luhnValid accepts a valid card, rejects a bad one / wrong length", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true) // canonical Visa test number
    expect(luhnValid("4111-1111-1111-1112")).toBe(false) // fails checksum
    expect(luhnValid("1234")).toBe(false) // too short
    expect(luhnValid("42424242424242424242424")).toBe(false) // too long
  })

  test("findSensitive detects credential field names in JSON and form/query", () => {
    expect(findSensitive("body", '{"username":"a","password":"x"}').map((s) => s.detail)).toContain("password")
    expect(findSensitive("query", "user=a&api_key=abc&token=z").map((s) => s.detail).sort()).toEqual(["api_key", "token"])
    expect(findSensitive("body", "just=data&foo=bar")).toHaveLength(0)
  })

  test("findSensitive flags a Luhn-valid card number in the text", () => {
    const s = findSensitive("body", '{"card_number":"4111111111111111"}')
    expect(s.some((x) => x.kind === "credit-card")).toBe(true)
    expect(s.some((x) => x.detail === "card_number")).toBe(true)
  })

  test("classifyHsts: missing / weak (short max-age or no includeSubDomains) / ok", () => {
    expect(classifyHsts(undefined).verdict).toBe("missing")
    expect(classifyHsts("max-age=3600; includeSubDomains").verdict).toBe("weak") // < 6 months
    expect(classifyHsts("max-age=31536000").verdict).toBe("weak") // no includeSubDomains
    expect(classifyHsts("max-age=31536000; includeSubDomains").verdict).toBe("ok")
  })

  test("findMixedContent extracts http:// subresources, deduped", () => {
    const body = `<img src="http://cdn.x/a.png"><script src='http://cdn.x/b.js'></script><link href="https://ok/x.css"><img src="http://cdn.x/a.png">`
    expect(findMixedContent(body).sort()).toEqual(["http://cdn.x/a.png", "http://cdn.x/b.js"])
    expect(findMixedContent('<img src="https://secure/a.png">')).toHaveLength(0)
  })
})
