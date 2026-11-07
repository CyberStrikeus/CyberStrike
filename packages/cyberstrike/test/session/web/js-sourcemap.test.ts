import { describe, expect, test } from "bun:test"
import { JsSourceMap } from "../../../src/session/web/js-sourcemap"

const JS_URL = "https://h.tld/static/app.js"

describe("JsSourceMap.refUrl", () => {
  test("resolves a relative //# sourceMappingURL against the bundle url", () => {
    expect(JsSourceMap.refUrl(`console.log(1)\n//# sourceMappingURL=app.js.map`, JS_URL)).toBe("https://h.tld/static/app.js.map")
  })
  test("supports the legacy //@ form", () => {
    expect(JsSourceMap.refUrl(`x\n//@ sourceMappingURL=/maps/app.map`, JS_URL)).toBe("https://h.tld/maps/app.map")
  })
  test("the LAST directive wins", () => {
    expect(JsSourceMap.refUrl(`//# sourceMappingURL=a.map\n//# sourceMappingURL=b.map`, JS_URL)).toBe("https://h.tld/static/b.map")
  })
  test("inline data-URI maps and absent maps → null (handled by inline())", () => {
    expect(JsSourceMap.refUrl(`//# sourceMappingURL=data:application/json;base64,e30=`, JS_URL)).toBeNull()
    expect(JsSourceMap.refUrl(`no map here`, JS_URL)).toBeNull()
  })
})

describe("JsSourceMap.parse", () => {
  test("extracts sources + sourcesContent", () => {
    const map = JSON.stringify({ version: 3, sources: ["src/a.ts", "src/b.ts"], sourcesContent: ["export const x=1", "export const y=2"], mappings: "AAAA" })
    expect(JsSourceMap.parse(map)).toEqual({ sources: ["src/a.ts", "src/b.ts"], sourcesContent: ["export const x=1", "export const y=2"] })
  })
  test("malformed JSON → null; a map with neither sources nor content → null", () => {
    expect(JsSourceMap.parse("{not json")).toBeNull()
    expect(JsSourceMap.parse(JSON.stringify({ version: 3, mappings: "AAAA" }))).toBeNull()
  })
  test("filters non-string entries defensively", () => {
    const map = JSON.stringify({ sources: ["ok", 5, null], sourcesContent: ["code", 7] })
    expect(JsSourceMap.parse(map)).toEqual({ sources: ["ok"], sourcesContent: ["code"] })
  })
})

describe("JsSourceMap.inline", () => {
  const map = JSON.stringify({ sources: ["src/api.ts"], sourcesContent: [`fetch("/api/x")`] })

  test("decodes a base64 inline map", () => {
    const b64 = Buffer.from(map, "utf8").toString("base64")
    const js = `code();\n//# sourceMappingURL=data:application/json;base64,${b64}`
    expect(JsSourceMap.inline(js)).toEqual({ sources: ["src/api.ts"], sourcesContent: [`fetch("/api/x")`] })
  })
  test("decodes a url-encoded (non-base64) inline map", () => {
    const js = `code();\n//# sourceMappingURL=data:application/json,${encodeURIComponent(map)}`
    expect(JsSourceMap.inline(js)?.sources).toEqual(["src/api.ts"])
  })
  test("non-inline (external / absent) → null", () => {
    expect(JsSourceMap.inline(`//# sourceMappingURL=app.js.map`)).toBeNull()
    expect(JsSourceMap.inline(`no map`)).toBeNull()
  })
})
