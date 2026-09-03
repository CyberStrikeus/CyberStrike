import { describe, expect, test } from "bun:test"
import { FrameworkFingerprinter } from "../../../src/session/web/tech"

const det = FrameworkFingerprinter.detect

describe("FrameworkFingerprinter.detect", () => {
  test("React SPA from a page global", () => {
    const t = det({ globals: ["React", "__REACT_DEVTOOLS_GLOBAL_HOOK__"] })
    expect(t.client).toContain("React")
    expect(t.rendering).toBe("spa")
  })
  test("Angular from the ng-version DOM marker", () => {
    expect(det({ dom: ["ng-version"] }).client).toContain("Angular")
  })
  test("Vue from data-v attributes", () => {
    expect(det({ dom: ["data-v-7ba5bd90"] }).client).toContain("Vue")
  })
  test("Next.js meta-framework from /_next/ scripts", () => {
    const t = det({ scripts: ["/_next/static/chunks/main.js"] })
    expect(t.metaFramework).toBe("Next.js")
    expect(t.rendering).toBe("spa")
  })
  test("Java MPA from JSESSIONID cookie → SSR, session kind", () => {
    const t = det({ cookies: ["JSESSIONID"] })
    expect(t.server).toContain("Java")
    expect(t.sessionKind).toBe("Java")
    expect(t.rendering).toBe("ssr")
  })
  test("ASP.NET WebForms from __VIEWSTATE hidden field", () => {
    expect(det({ dom: ["__VIEWSTATE", "__EVENTVALIDATION"] }).server).toContain("ASP.NET WebForms")
  })
  test("PHP from X-Powered-By header", () => {
    expect(det({ headers: { "x-powered-by": "PHP/8.2.0" } }).server).toContain("PHP")
  })
  test("WordPress from the generator meta tag", () => {
    expect(det({ meta: "WordPress 6.4" }).server).toContain("WordPress")
  })
  test("empty input → unknown", () => {
    const t = det({})
    expect(t.rendering).toBe("unknown")
    expect(t.client).toEqual([])
    expect(t.server).toEqual([])
  })
  test("signals are recorded for transparency", () => {
    expect(det({ dom: ["ng-version"] }).signals).toContain("dom:ng-version")
  })
})

describe("FrameworkFingerprinter.describe (Navigator hint)", () => {
  test("SPA → client-side routing hint", () => {
    const h = FrameworkFingerprinter.describe(det({ globals: ["React"] }))
    expect(h).toMatch(/client-side routing|re-observe/i)
    expect(h).toContain("React")
  })
  test("meta-framework → hydration hint", () => {
    expect(FrameworkFingerprinter.describe(det({ scripts: ["/_next/x"] }))).toMatch(/hydrat/i)
  })
  test("SSR → full-page / CSRF hint", () => {
    const h = FrameworkFingerprinter.describe(det({ cookies: ["JSESSIONID"] }))
    expect(h).toMatch(/full-page|CSRF|POST/i)
  })
  test("unknown → treat as classic MPA", () => {
    expect(FrameworkFingerprinter.describe(det({}))).toMatch(/multi-page/i)
  })
})
