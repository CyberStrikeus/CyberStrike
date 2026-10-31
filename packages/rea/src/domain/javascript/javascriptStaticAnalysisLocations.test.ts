import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const directive = "//# sourceMappingURL=app.js.map";

describe("source map directive coordinates", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
    ["same-line UTF-16 columns", " "],
    ["vertical tab whitespace", "\v"],
    ["form feed whitespace", "\f"],
    ["mixed terminators", "\r\n\r\u2028\n\u2029"],
  ])("agrees with Babel after %s", (_name, separator) => {
    const source = `const marker = "😀";${separator}  ${directive}`;
    const location = parse(source).comments?.[0]?.loc;
    if (location === undefined)
      throw new Error("Expected the directive comment location");
    const { start, end } = location;

    const result = analyzeJavaScriptStaticSource(source);
    expect(result.parse_status).toBe("complete");
    expect(result.source_map_urls).toEqual([
      {
        declared_url: "app.js.map",
        location: {
          start: { line: start.line, column: start.column },
          end: { line: end.line, column: end.column },
        },
      },
    ]);
  });

  it("counts terminators inside a block directive without including its closer", () => {
    const source =
      "const value = 1;\r/*#\u2028 sourceMappingURL=\r\n app.js.map */";
    expect(analyzeJavaScriptStaticSource(source).source_map_urls).toEqual([
      {
        declared_url: "app.js.map",
        location: {
          start: { line: 2, column: 0 },
          end: { line: 4, column: " app.js.map".length },
        },
      },
    ]);
  });

  it("preserves the first location when a URL is repeated across terminators", () => {
    const source = `const marker = "😀";\r  ${directive}\u2028${directive}`;
    expect(analyzeJavaScriptStaticSource(source).source_map_urls).toEqual([
      {
        declared_url: "app.js.map",
        location: {
          start: { line: 2, column: 2 },
          end: { line: 2, column: directive.length + 2 },
        },
      },
    ]);
  });
});
