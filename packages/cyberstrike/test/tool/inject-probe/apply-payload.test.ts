import { describe, test, expect } from "bun:test"

// Standalone copies from inject-probe.ts (not exported)
const sanitizeHeaderValue = (v: string) => v.replace(/[\r\n ]/g, "")

function setCookie(cookieHeader: string, name: string, value: string): string {
  const safeVal = value.replace(/[;\r\n ]/g, "")
  const parts = (cookieHeader ? cookieHeader.split(/;\s*/) : []).filter(
    (p) => p && p.split("=")[0].trim().toLowerCase() !== name.toLowerCase(),
  )
  parts.push(`${name}=${safeVal}`)
  return parts.join("; ")
}

function setJsonField(body: string, path: string, value: string): string {
  try {
    const root = JSON.parse(body || "{}")
    const keys = path.split(".")
    let cur: any = root
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== "object" || cur[keys[i]] == null) cur[keys[i]] = {}
      cur = cur[keys[i]]
    }
    cur[keys[keys.length - 1]] = value
    return JSON.stringify(root)
  } catch {
    return body
  }
}

function injectPathSegment(pathname: string, indexStr: string, value: string): string {
  const segs = pathname.split("/")
  const nonEmpty: number[] = []
  for (let i = 0; i < segs.length; i++) if (segs[i] !== "") nonEmpty.push(i)
  const target = nonEmpty[Number(indexStr)]
  if (target == null) return pathname
  segs[target] = encodeURIComponent(value.replace(/\.\.(\/|\\)?/g, ""))
  return segs.join("/")
}

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

type Location = "query" | "form_field" | "json_body" | "header" | "cookie" | "path"
interface InjPoint {
  location: Location
  name: string
}
interface ResolvedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: string
  contentType: string
}

function applyPayload(
  r: ResolvedRequest,
  point: InjPoint,
  value: string,
): { url: string; body: string; headers: Record<string, string> } {
  const headers = { ...r.headers }
  const u = new URL(r.url.toString())
  let body = r.body
  switch (point.location) {
    case "query":
      u.searchParams.set(point.name, value)
      break
    case "form_field": {
      if (r.contentType.includes("multipart/form-data")) {
        const b = multipartBoundary(r)
        const mp = b ? setMultipartField(r.body, b, point.name, value) : null
        body = mp ?? r.body
        break
      }
      const f = new URLSearchParams(r.body)
      f.set(point.name, value)
      body = f.toString()
      break
    }
    case "json_body":
      body = setJsonField(r.body, point.name, value)
      break
    case "header":
      headers[point.name.toLowerCase()] = sanitizeHeaderValue(value)
      break
    case "cookie":
      headers["cookie"] = setCookie(headers["cookie"] ?? "", point.name, value)
      break
    case "path":
      u.pathname = injectPathSegment(u.pathname, point.name, value)
      break
  }
  return { url: u.toString(), body, headers }
}

const mkRequest = (urlStr: string, opts: Partial<ResolvedRequest> = {}): ResolvedRequest => ({
  method: opts.method ?? "GET",
  url: new URL(urlStr),
  headers: opts.headers ?? {},
  body: opts.body ?? "",
  contentType: opts.contentType ?? "",
})

describe("applyPayload", () => {
  describe("query injection", () => {
    test("sets query parameter value", () => {
      const r = mkRequest("https://target.com/search?q=test&page=1")
      const result = applyPayload(r, { location: "query", name: "q" }, "<script>alert(1)</script>")
      const url = new URL(result.url)
      expect(url.searchParams.get("q")).toBe("<script>alert(1)</script>")
      expect(url.searchParams.get("page")).toBe("1")
    })

    test("adds new query parameter if not present", () => {
      const r = mkRequest("https://target.com/api")
      const result = applyPayload(r, { location: "query", name: "inject" }, "payload")
      expect(new URL(result.url).searchParams.get("inject")).toBe("payload")
    })
  })

  describe("form_field injection", () => {
    test("sets form-urlencoded field", () => {
      const r = mkRequest("https://target.com/login", {
        contentType: "application/x-www-form-urlencoded",
        body: "user=admin&pass=secret",
      })
      const result = applyPayload(r, { location: "form_field", name: "user" }, "' OR 1=1--")
      const params = new URLSearchParams(result.body)
      expect(params.get("user")).toBe("' OR 1=1--")
      expect(params.get("pass")).toBe("secret")
    })
  })

  describe("json_body injection", () => {
    test("sets JSON field value", () => {
      const r = mkRequest("https://target.com/api", {
        contentType: "application/json",
        body: '{"username":"admin","role":"user"}',
      })
      const result = applyPayload(r, { location: "json_body", name: "username" }, "{{7*7}}")
      const parsed = JSON.parse(result.body)
      expect(parsed.username).toBe("{{7*7}}")
      expect(parsed.role).toBe("user")
    })
  })

  describe("header injection", () => {
    test("sets header value with sanitization", () => {
      const r = mkRequest("https://target.com/api", { headers: { "x-token": "old" } })
      const result = applyPayload(r, { location: "header", name: "x-token" }, "payload")
      expect(result.headers["x-token"]).toBe("payload")
    })

    test("sanitizes CR/LF from header value", () => {
      const r = mkRequest("https://target.com/api")
      const result = applyPayload(r, { location: "header", name: "x-custom" }, "val\r\nEvil: header")
      expect(result.headers["x-custom"]).not.toContain("\r")
      expect(result.headers["x-custom"]).not.toContain("\n")
    })
  })

  describe("cookie injection", () => {
    test("sets cookie value", () => {
      const r = mkRequest("https://target.com/api", { headers: { cookie: "session=abc; lang=en" } })
      const result = applyPayload(r, { location: "cookie", name: "session" }, "INJECTED")
      expect(result.headers["cookie"]).toContain("session=INJECTED")
      expect(result.headers["cookie"]).toContain("lang=en")
    })
  })

  describe("path injection", () => {
    test("replaces path segment by index", () => {
      const r = mkRequest("https://target.com/api/users/123")
      const result = applyPayload(r, { location: "path", name: "2" }, "PAYLOAD")
      expect(new URL(result.url).pathname).toBe("/api/users/PAYLOAD")
    })
  })

  describe("isolation", () => {
    test("does not mutate the original request headers", () => {
      const headers = { "x-token": "original" }
      const r = mkRequest("https://target.com/api", { headers })
      applyPayload(r, { location: "header", name: "x-token" }, "modified")
      expect(headers["x-token"]).toBe("original")
    })

    test("does not mutate the original URL", () => {
      const r = mkRequest("https://target.com/search?q=safe")
      applyPayload(r, { location: "query", name: "q" }, "injected")
      expect(r.url.searchParams.get("q")).toBe("safe")
    })
  })
})
