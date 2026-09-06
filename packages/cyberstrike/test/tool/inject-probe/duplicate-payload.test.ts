import { describe, test, expect } from "bun:test"
import { duplicatePayload } from "../../../src/tool/inject-probe/mutate"
import type { ResolvedRequest, InjPoint } from "../../../src/tool/inject-probe/types"

const makeR = (urlStr = "http://example.com/page?id=1&name=foo"): ResolvedRequest => ({
  method: "POST",
  url: new URL(urlStr),
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: "user=admin&pass=secret",
  contentType: "application/x-www-form-urlencoded",
  auth: { source: "none" },
  provenance: { fromRaw: false, reconstructed: false, bodyMaybeTruncated: false },
})

describe("duplicatePayload", () => {
  describe("query location", () => {
    test("last: appends value after original", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "query", name: "id" }, "PAYLOAD", "last")
      expect(result).not.toBeNull()
      const params = new URL(result!.url).searchParams.getAll("id")
      expect(params).toEqual(["1", "PAYLOAD"])
    })

    test("first: prepends value before original", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "query", name: "id" }, "PAYLOAD", "first")
      expect(result).not.toBeNull()
      const params = new URL(result!.url).searchParams.getAll("id")
      expect(params).toEqual(["PAYLOAD", "1"])
    })

    test("preserves other query params", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "query", name: "id" }, "PAYLOAD", "last")
      expect(result).not.toBeNull()
      const u = new URL(result!.url)
      expect(u.searchParams.get("name")).toBe("foo")
    })

    test("returns null if param not found", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "query", name: "missing" }, "PAYLOAD", "last")
      expect(result).toBeNull()
    })
  })

  describe("form_field location", () => {
    test("last: appends value in body", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "form_field", name: "user" }, "PAYLOAD", "last")
      expect(result).not.toBeNull()
      const f = new URLSearchParams(result!.body)
      expect(f.getAll("user")).toEqual(["admin", "PAYLOAD"])
    })

    test("first: prepends value in body", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "form_field", name: "user" }, "PAYLOAD", "first")
      expect(result).not.toBeNull()
      const f = new URLSearchParams(result!.body)
      expect(f.getAll("user")).toEqual(["PAYLOAD", "admin"])
    })

    test("returns null if param not found in body", () => {
      const r = makeR()
      const result = duplicatePayload(r, { location: "form_field", name: "missing" }, "PAYLOAD", "last")
      expect(result).toBeNull()
    })

    test("returns null for multipart form", () => {
      const r = makeR()
      r.contentType = "multipart/form-data; boundary=----WebKitFormBoundary"
      const result = duplicatePayload(r, { location: "form_field", name: "user" }, "PAYLOAD", "last")
      expect(result).toBeNull()
    })
  })

  describe("unsupported locations", () => {
    const unsupported: InjPoint["location"][] = ["json_body", "header", "cookie", "path"]
    for (const loc of unsupported) {
      test(`returns null for ${loc}`, () => {
        const r = makeR()
        const result = duplicatePayload(r, { location: loc, name: "x" }, "PAYLOAD", "last")
        expect(result).toBeNull()
      })
    }
  })
})
