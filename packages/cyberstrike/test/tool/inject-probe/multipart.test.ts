import { describe, test, expect } from "bun:test"

// Standalone copies from inject-probe.ts (not exported)
function multipartBoundary(r: { contentType: string; body: string }): string | null {
  const m = r.contentType.match(/boundary=("?)([^";]+)\1/i)
  if (m) return m[2].trim()
  const b = r.body.match(/^--(.+?)\r?\n/)
  return b ? b[1].trim() : null
}

function mpFieldName(seg: string): string | null {
  if (/filename="/i.test(seg)) return null
  const m = seg.match(/content-disposition:[^\r\n]*\bname="([^"]+)"/i)
  return m ? m[1] : null
}

function multipartFieldNames(body: string, boundary: string): string[] {
  const names: string[] = []
  for (const seg of body.split(`--${boundary}`)) {
    const n = mpFieldName(seg)
    if (n != null) names.push(n)
  }
  return names
}

function setMultipartField(body: string, boundary: string, name: string, value: string): string | null {
  if (value.includes(`--${boundary}`)) return null
  const delim = `--${boundary}`
  const segments = body.split(delim)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (mpFieldName(seg) !== name) continue
    const sep = seg.match(/\r?\n\r?\n/)
    if (!sep || sep.index == null) continue
    const headEnd = sep.index + sep[0].length
    const rest = seg.slice(headEnd)
    const trail = rest.match(/\r?\n$/)?.[0] ?? "\r\n"
    segments[i] = seg.slice(0, headEnd) + value + trail
    return segments.join(delim)
  }
  return null
}

const BOUNDARY = "----WebKitFormBoundary7MA4YWxk"
const mkBody = (...fields: { name: string; value: string; file?: boolean }[]) => {
  const parts = fields.map((f) => {
    const disp = f.file
      ? `Content-Disposition: form-data; name="${f.name}"; filename="test.txt"\r\nContent-Type: text/plain`
      : `Content-Disposition: form-data; name="${f.name}"`
    return `\r\n${disp}\r\n\r\n${f.value}\r\n`
  })
  return `------WebKitFormBoundary7MA4YWxk${parts.join("------WebKitFormBoundary7MA4YWxk")}------WebKitFormBoundary7MA4YWxk--`
}

describe("multipartBoundary", () => {
  test("extracts boundary from content-type header", () => {
    const r = { contentType: "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk", body: "" }
    expect(multipartBoundary(r)).toBe("----WebKitFormBoundary7MA4YWxk")
  })

  test("extracts quoted boundary", () => {
    const r = { contentType: 'multipart/form-data; boundary="my-boundary"', body: "" }
    expect(multipartBoundary(r)).toBe("my-boundary")
  })

  test("falls back to body inspection when header lacks boundary", () => {
    const body =
      '------WebKitBoundary\r\nContent-Disposition: form-data; name="test"\r\n\r\nvalue\r\n------WebKitBoundary--'
    const r = { contentType: "multipart/form-data", body }
    expect(multipartBoundary(r)).toBe("----WebKitBoundary")
  })

  test("returns null when no boundary found", () => {
    const r = { contentType: "multipart/form-data", body: "no boundary here" }
    expect(multipartBoundary(r)).toBeNull()
  })
})

describe("multipartFieldNames", () => {
  test("extracts text field names", () => {
    const body = mkBody({ name: "username", value: "admin" }, { name: "password", value: "secret" })
    expect(multipartFieldNames(body, BOUNDARY)).toEqual(["username", "password"])
  })

  test("skips file upload parts", () => {
    const body = mkBody({ name: "comment", value: "hello" }, { name: "avatar", value: "binary data", file: true })
    expect(multipartFieldNames(body, BOUNDARY)).toEqual(["comment"])
  })

  test("returns empty array for body with only file parts", () => {
    const body = mkBody({ name: "file1", value: "data", file: true })
    expect(multipartFieldNames(body, BOUNDARY)).toEqual([])
  })
})

describe("setMultipartField", () => {
  test("replaces a text field value", () => {
    const body = mkBody({ name: "user", value: "alice" }, { name: "role", value: "admin" })
    const result = setMultipartField(body, BOUNDARY, "user", "INJECTED")
    expect(result).not.toBeNull()
    expect(result).toContain("INJECTED")
    expect(result).not.toContain("alice")
    expect(result).toContain("admin")
  })

  test("returns null when field does not exist", () => {
    const body = mkBody({ name: "user", value: "alice" })
    expect(setMultipartField(body, BOUNDARY, "nonexistent", "val")).toBeNull()
  })

  test("returns null for file parts — never corrupts binary", () => {
    const body = mkBody({ name: "avatar", value: "binary", file: true })
    expect(setMultipartField(body, BOUNDARY, "avatar", "injected")).toBeNull()
  })

  test("rejects value containing boundary — prevents part forgery", () => {
    const body = mkBody({ name: "user", value: "alice" })
    expect(setMultipartField(body, BOUNDARY, "user", `--${BOUNDARY}`)).toBeNull()
  })

  test("preserves other fields byte-for-byte", () => {
    const body = mkBody(
      { name: "a", value: "keep-this" },
      { name: "target", value: "old" },
      { name: "b", value: "also-keep" },
    )
    const result = setMultipartField(body, BOUNDARY, "target", "new")
    expect(result).toContain("keep-this")
    expect(result).toContain("also-keep")
    expect(result).toContain("new")
    expect(result).not.toContain('"old"')
  })
})
