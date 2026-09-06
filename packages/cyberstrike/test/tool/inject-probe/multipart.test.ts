import { describe, test, expect } from "bun:test"
import {
  multipartBoundary,
  multipartFieldNames,
  setMultipartField,
} from "../../../src/tool/inject-probe/multipart"
import type { ResolvedRequest } from "../../../src/tool/inject-probe/types"

const mkReq = (contentType: string, body: string) =>
  ({ contentType, body }) as unknown as ResolvedRequest

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
    const r = mkReq("multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk", "")
    expect(multipartBoundary(r)).toBe("----WebKitFormBoundary7MA4YWxk")
  })

  test("extracts quoted boundary", () => {
    const r = mkReq('multipart/form-data; boundary="my-boundary"', "")
    expect(multipartBoundary(r)).toBe("my-boundary")
  })

  test("falls back to body inspection when header lacks boundary", () => {
    const body =
      '------WebKitBoundary\r\nContent-Disposition: form-data; name="test"\r\n\r\nvalue\r\n------WebKitBoundary--'
    const r = mkReq("multipart/form-data", body)
    expect(multipartBoundary(r)).toBe("----WebKitBoundary")
  })

  test("returns null when no boundary found", () => {
    const r = mkReq("multipart/form-data", "no boundary here")
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
