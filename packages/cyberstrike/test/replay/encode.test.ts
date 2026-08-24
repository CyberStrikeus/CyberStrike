import { describe, test, expect } from "bun:test"
import { Encode } from "../../src/replay/encode"

describe("Encode.apply", () => {
  test("url encodes reserved chars but leaves unreserved", () => {
    expect(Encode.apply("a b&c", "url")).toBe("a%20b%26c")
  })

  test("url-all percent-encodes every byte", () => {
    expect(Encode.apply("AB", "url-all")).toBe("%41%42")
  })

  test("url-double applies url twice", () => {
    // space -> %20 -> %2520
    expect(Encode.apply(" ", "url-double")).toBe("%2520")
  })

  test("base64 / base64url", () => {
    expect(Encode.apply("hi!", "base64")).toBe("aGkh")
    // '>' + '?' produce + and / in std base64 -> - and _ in url variant, no padding
    expect(Encode.apply("<?", "base64")).toBe("PD8=")
    expect(Encode.apply("<?", "base64url")).toBe("PD8")
  })

  test("hex of UTF-8 bytes", () => {
    expect(Encode.apply("AB", "hex")).toBe("4142")
  })

  test("html entity encodings", () => {
    expect(Encode.apply("<a", "html-dec")).toBe("&#60;&#97;")
    expect(Encode.apply("<a", "html-hex")).toBe("&#x3c;&#x61;")
  })

  test("unicode escape (ASCII and astral)", () => {
    expect(Encode.apply("A", "unicode")).toBe("\\u0041")
    // 😀 is a surrogate pair
    expect(Encode.apply("😀", "unicode")).toBe("\\ud83d\\ude00")
  })

  test("case toggles", () => {
    expect(Encode.apply("SeLeCt", "upper")).toBe("SELECT")
    expect(Encode.apply("SeLeCt", "lower")).toBe("select")
  })

  test("multi-byte input encodes via UTF-8 bytes", () => {
    // 'ç' is 0xC3 0xA7 in UTF-8
    expect(Encode.apply("ç", "hex")).toBe("c3a7")
    expect(Encode.apply("ç", "url-all")).toBe("%C3%A7")
  })
})

describe("Encode.pipeline", () => {
  test("applies codecs left to right", () => {
    // base64("A")="QQ==", then url-encode the '=' padding
    expect(Encode.pipeline("A", ["base64", "url"])).toBe("QQ%3D%3D")
  })

  test("empty pipeline is identity", () => {
    expect(Encode.pipeline("abc", [])).toBe("abc")
  })

  test("realistic double-encode of a traversal payload", () => {
    expect(Encode.pipeline("../", ["url", "url"])).toBe(Encode.apply("../", "url-double"))
  })
})
