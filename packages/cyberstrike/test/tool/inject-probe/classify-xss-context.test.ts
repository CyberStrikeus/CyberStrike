import { describe, test, expect } from "bun:test"
import { classifyXssContext } from "../../../src/tool/inject-probe/detect"

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
