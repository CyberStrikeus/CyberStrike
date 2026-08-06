import { describe, test, expect } from "bun:test"

// Standalone copy from inject-probe.ts (not exported)
function setCookie(cookieHeader: string, name: string, value: string): string {
  const safeVal = value.replace(/[;\r\n ]/g, "")
  const parts = (cookieHeader ? cookieHeader.split(/;\s*/) : []).filter(
    (p) => p && p.split("=")[0].trim().toLowerCase() !== name.toLowerCase(),
  )
  parts.push(`${name}=${safeVal}`)
  return parts.join("; ")
}

describe("setCookie", () => {
  test("adds a cookie to an empty header", () => {
    expect(setCookie("", "session", "abc123")).toBe("session=abc123")
  })

  test("appends a new cookie to existing cookies", () => {
    expect(setCookie("session=abc", "token", "xyz")).toBe("session=abc; token=xyz")
  })

  test("replaces an existing cookie by name", () => {
    expect(setCookie("session=old; token=xyz", "session", "new")).toBe("token=xyz; session=new")
  })

  test("replaces cookie case-insensitively", () => {
    expect(setCookie("Session=old; other=val", "session", "new")).toBe("other=val; session=new")
  })

  test("strips semicolons from value to prevent injection", () => {
    expect(setCookie("", "key", "val;injected=true")).toBe("key=valinjected=true")
  })

  test("strips CR/LF from value to prevent header injection", () => {
    expect(setCookie("", "key", "val\r\nInjected: header")).toBe("key=valInjected:header")
  })

  test("strips spaces from value", () => {
    expect(setCookie("", "key", "val ue")).toBe("key=value")
  })

  test("preserves multiple existing cookies when adding new", () => {
    expect(setCookie("a=1; b=2; c=3", "d", "4")).toBe("a=1; b=2; c=3; d=4")
  })

  test("handles cookie value with equals sign", () => {
    expect(setCookie("", "token", "abc=def")).toBe("token=abc=def")
  })

  test("replaces only the matching cookie among many", () => {
    const result = setCookie("a=1; target=old; b=2", "target", "new")
    expect(result).toBe("a=1; b=2; target=new")
  })
})
