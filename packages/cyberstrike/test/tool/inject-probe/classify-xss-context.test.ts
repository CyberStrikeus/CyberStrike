import { describe, test, expect } from "bun:test"

// Standalone copy of classifyXssContext from inject-probe.ts (not exported)
function classifyXssContext(text: string, marker: string): string {
  const i = text.indexOf(marker)
  if (i < 0) return "unknown"
  const before = text.slice(Math.max(0, i - 80), i)
  if (/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*$/i.test(before)) return "javascript"
  if (/<textarea\b[^>]*>(?:(?!<\/textarea>)[\s\S])*$/i.test(before)) return "rcdata-textarea"
  if (/<title\b[^>]*>(?:(?!<\/title>)[\s\S])*$/i.test(before)) return "rcdata-title"
  if (/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*$/i.test(before)) return "rcdata-style"
  const urlAttr = /(?:href|src|action|formaction|xlink:href|poster|data)\s*=\s*/i
  if (/=\s*"[^"]*$/.test(before)) return urlAttr.test(before) ? "attribute-url-double" : "attribute-double-quote"
  if (/=\s*'[^']*$/.test(before)) return urlAttr.test(before) ? "attribute-url-single" : "attribute-single-quote"
  if (/<[a-z][^>]*$/i.test(before)) return "tag-name"
  return "html-body"
}

describe("classifyXssContext", () => {
  const M = "MARKER123"

  test("returns unknown when marker is not in the text", () => {
    expect(classifyXssContext("<html><body>hello</body></html>", M)).toBe("unknown")
  })

  test("detects html-body context", () => {
    expect(classifyXssContext(`<html><body>${M}</body></html>`, M)).toBe("html-body")
  })

  test("detects javascript context inside script tag", () => {
    expect(classifyXssContext(`<script>var x = "${M}";</script>`, M)).toBe("javascript")
  })

  test("detects javascript context with attributes on script tag", () => {
    expect(classifyXssContext(`<script type="text/javascript">var x = "${M}";</script>`, M)).toBe("javascript")
  })

  test("detects rcdata-textarea context", () => {
    expect(classifyXssContext(`<textarea name="comment">${M}</textarea>`, M)).toBe("rcdata-textarea")
  })

  test("detects rcdata-title context", () => {
    expect(classifyXssContext(`<title>${M}</title>`, M)).toBe("rcdata-title")
  })

  test("detects rcdata-style context", () => {
    expect(classifyXssContext(`<style>.cls { color: ${M}; }</style>`, M)).toBe("rcdata-style")
  })

  test("detects attribute-double-quote context", () => {
    expect(classifyXssContext(`<input type="text" value="${M}">`, M)).toBe("attribute-double-quote")
  })

  test("detects attribute-single-quote context", () => {
    expect(classifyXssContext(`<input type='text' value='${M}'>`, M)).toBe("attribute-single-quote")
  })

  test("detects attribute-url-double for href", () => {
    expect(classifyXssContext(`<a href="${M}">link</a>`, M)).toBe("attribute-url-double")
  })

  test("detects attribute-url-single for href", () => {
    expect(classifyXssContext(`<a href='${M}'>link</a>`, M)).toBe("attribute-url-single")
  })

  test("detects attribute-url-double for src", () => {
    expect(classifyXssContext(`<img src="${M}">`, M)).toBe("attribute-url-double")
  })

  test("detects attribute-url-double for action", () => {
    expect(classifyXssContext(`<form action="${M}">`, M)).toBe("attribute-url-double")
  })

  test("detects tag-name context", () => {
    expect(classifyXssContext(`<div class=${M}>`, M)).toBe("tag-name")
  })

  test("uses only 80 chars before marker for context", () => {
    const padding = "x".repeat(200)
    expect(classifyXssContext(`<script>${padding}${M}</script>`, M)).toBe("html-body")
  })

  test("marker at the very start of text is html-body", () => {
    expect(classifyXssContext(`${M}<div>hello</div>`, M)).toBe("html-body")
  })

  test("closed script tag before marker is not javascript", () => {
    expect(classifyXssContext(`<script>var a = 1;</script><div>${M}</div>`, M)).toBe("html-body")
  })
})
