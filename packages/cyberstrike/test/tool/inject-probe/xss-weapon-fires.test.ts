import { describe, test, expect } from "bun:test"

// Standalone copy of xssWeaponFires from inject-probe.ts (not exported)
function xssWeaponFires(payload: string, survived: boolean, ctx: string): boolean {
  const s = payload.replace(/^\s+/, "")
  if (s.startsWith("javascript:")) return /attribute-url/.test(ctx)
  if (s.startsWith("<")) return survived
  if (/^["']/.test(s)) return /attribute|javascript/.test(ctx)
  return /javascript/.test(ctx) || survived
}

describe("xssWeaponFires", () => {
  describe("javascript: URI payloads", () => {
    test("fires in attribute-url-double context", () => {
      expect(xssWeaponFires("javascript:alert(1)", false, "attribute-url-double")).toBe(true)
    })

    test("fires in attribute-url-single context", () => {
      expect(xssWeaponFires("javascript:alert(1)", false, "attribute-url-single")).toBe(true)
    })

    test("does not fire in html-body context", () => {
      expect(xssWeaponFires("javascript:alert(1)", true, "html-body")).toBe(false)
    })

    test("does not fire in javascript context", () => {
      expect(xssWeaponFires("javascript:alert(1)", true, "javascript")).toBe(false)
    })

    test("does not fire in attribute-double-quote context", () => {
      expect(xssWeaponFires("javascript:alert(1)", true, "attribute-double-quote")).toBe(false)
    })
  })

  describe("tag-based payloads (start with <)", () => {
    test("fires when a tag survived", () => {
      expect(xssWeaponFires("<svg onload=alert(1)>", true, "html-body")).toBe(true)
    })

    test("does not fire when no tag survived", () => {
      expect(xssWeaponFires("<svg onload=alert(1)>", false, "html-body")).toBe(false)
    })

    test("fires regardless of context when tag survived", () => {
      expect(xssWeaponFires("<img src=x onerror=alert(1)>", true, "javascript")).toBe(true)
      expect(xssWeaponFires("<img src=x onerror=alert(1)>", true, "attribute-double-quote")).toBe(true)
    })

    test("does not fire even in javascript context without tag survival", () => {
      expect(xssWeaponFires("<svg onload=alert(1)>", false, "javascript")).toBe(false)
    })
  })

  describe("quote-breakout payloads (start with \" or ')", () => {
    test("fires in attribute-double-quote context", () => {
      expect(xssWeaponFires('" onmouseover=alert(1) x="', false, "attribute-double-quote")).toBe(true)
    })

    test("fires in attribute-single-quote context", () => {
      expect(xssWeaponFires("' onmouseover=alert(1) x='", false, "attribute-single-quote")).toBe(true)
    })

    test("fires in javascript context", () => {
      expect(xssWeaponFires('" onmouseover=alert(1) x="', false, "javascript")).toBe(true)
    })

    test("fires in attribute-url-double context", () => {
      expect(xssWeaponFires('" onmouseover=alert(1) x="', false, "attribute-url-double")).toBe(true)
    })

    test("does not fire in html-body context", () => {
      expect(xssWeaponFires('" onmouseover=alert(1) x="', false, "html-body")).toBe(false)
    })

    test("does not fire in tag-name context", () => {
      expect(xssWeaponFires('" onmouseover=alert(1) x="', false, "tag-name")).toBe(false)
    })
  })

  describe("bare alert payloads (no tag, no quote, no javascript:)", () => {
    test("fires in javascript context", () => {
      expect(xssWeaponFires("alert(1)", false, "javascript")).toBe(true)
    })

    test("fires when tag survived regardless of context", () => {
      expect(xssWeaponFires("alert(1)", true, "html-body")).toBe(true)
    })

    test("does not fire in html-body without tag survival", () => {
      expect(xssWeaponFires("alert(1)", false, "html-body")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("strips leading whitespace before classification", () => {
      expect(xssWeaponFires("  <svg onload=alert(1)>", true, "html-body")).toBe(true)
      expect(xssWeaponFires("  javascript:alert(1)", false, "attribute-url-double")).toBe(true)
    })
  })
})
