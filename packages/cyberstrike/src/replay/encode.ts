// Encoding toolkit (design §3.5) — deterministic, composable codecs the agent
// applies to a payload before it lands on the wire. WAF-bypass testing needs
// exact control over encoding (single vs double URL-encode, overlong forms,
// HTML entities, case), so encoding is an EXPLICIT step separate from mutation —
// Mutate.* keeps values raw, Encode.* transforms them on request.
//
// Byte-oriented codecs (url-all, hex, base64) operate on UTF-8 bytes so
// multi-byte input is handled correctly; text-oriented codecs (html/unicode/
// case) operate on characters. Codecs chain via pipeline(): e.g. base64 then
// url so `["base64","url"]` yields a URL-safe wrapper around a base64 blob.
//
// No network, no dependencies.

export namespace Encode {
  export type Codec =
    | "url" // encodeURIComponent — standard percent-encoding
    | "url-all" // percent-encode EVERY byte (aggressive WAF bypass)
    | "url-double" // apply `url` twice
    | "base64"
    | "base64url" // base64url, no padding
    | "hex" // lowercase hex of UTF-8 bytes, no separator
    | "html-dec" // each char -> &#NN;
    | "html-hex" // each char -> &#xHH;
    | "unicode" // each char -> \uXXXX (JS-style, surrogate pairs preserved)
    | "upper"
    | "lower"

  const utf8 = new TextEncoder()

  function toBytes(s: string): Uint8Array {
    return utf8.encode(s)
  }

  function percentAll(s: string): string {
    let out = ""
    for (const b of toBytes(s)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0")
    return out
  }

  function hex(s: string): string {
    let out = ""
    for (const b of toBytes(s)) out += b.toString(16).padStart(2, "0")
    return out
  }

  function base64(s: string): string {
    // btoa needs a binary string; build one from UTF-8 bytes (latin1 1:1).
    let bin = ""
    for (const b of toBytes(s)) bin += String.fromCharCode(b)
    return btoa(bin)
  }

  function base64url(s: string): string {
    return base64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }

  function htmlDec(s: string): string {
    let out = ""
    for (const ch of s) out += `&#${ch.codePointAt(0)};`
    return out
  }

  function htmlHex(s: string): string {
    let out = ""
    for (const ch of s) out += `&#x${ch.codePointAt(0)!.toString(16)};`
    return out
  }

  function unicodeEscape(s: string): string {
    let out = ""
    // Iterate UTF-16 code units so astral chars emit a surrogate pair (😀),
    // which is what a JS/JSON string literal actually contains.
    for (let i = 0; i < s.length; i++) {
      out += "\\u" + s.charCodeAt(i).toString(16).padStart(4, "0")
    }
    return out
  }

  /** Apply a single codec. */
  export function apply(input: string, codec: Codec): string {
    switch (codec) {
      case "url":
        return encodeURIComponent(input)
      case "url-all":
        return percentAll(input)
      case "url-double":
        return encodeURIComponent(encodeURIComponent(input))
      case "base64":
        return base64(input)
      case "base64url":
        return base64url(input)
      case "hex":
        return hex(input)
      case "html-dec":
        return htmlDec(input)
      case "html-hex":
        return htmlHex(input)
      case "unicode":
        return unicodeEscape(input)
      case "upper":
        return input.toUpperCase()
      case "lower":
        return input.toLowerCase()
    }
  }

  /** Apply codecs left-to-right: pipeline(x, ["base64","url"]) === url(base64(x)). */
  export function pipeline(input: string, codecs: Codec[]): string {
    return codecs.reduce((acc, c) => apply(acc, c), input)
  }
}
