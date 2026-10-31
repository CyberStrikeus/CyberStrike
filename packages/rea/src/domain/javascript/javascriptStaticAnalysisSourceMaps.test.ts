import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const sourceMapUrls = (source: string): readonly string[] =>
  analyzeJavaScriptStaticSource(source).source_map_urls.map(
    ({ declared_url: declaredUrl }) => declaredUrl,
  );

describe("source map directives", () => {
  it.each([
    ["line comment", "//# sourceMappingURL=app.js.map", "app.js.map"],
    ["legacy line comment", "//@ sourceMappingURL=app.js.map", "app.js.map"],
    // Minifiers commonly emit the block form; it previously matched nothing.
    ["block comment", "/*# sourceMappingURL=app.js.map */", "app.js.map"],
    [
      "block comment after code",
      "code();\n/*# sourceMappingURL=vendor.abc.map */",
      "vendor.abc.map",
    ],
  ])("reads the %s form", (_label, source, expected) => {
    expect(sourceMapUrls(source)).toEqual([expected]);
  });

  it("retains every directive in a source", () => {
    expect(
      sourceMapUrls(
        "//# sourceMappingURL=first.map\n/*# sourceMappingURL=second.map */",
      ),
    ).toEqual(["first.map", "second.map"]);
  });

  it("reads a large inline map from a two-byte source without overflowing", () => {
    const declared =
      "data:application/json;charset=utf-8;base64," + "A".repeat(9_000_000);
    const source = `const label = "ğ";\n//# sourceMappingURL=${declared}`;

    expect(sourceMapUrls(source)).toEqual([declared]);
  });

  it.each([
    ["after the marker", "//#", "sourceMappingURL=x"],
    ["before the equals sign", "//# sourceMappingURL", "=x"],
    ["before the URL", "//# sourceMappingURL=", "x"],
  ])("reads 9.5M spaces %s without overflowing", (_label, prefix, suffix) => {
    const source = `ğ${prefix}${" ".repeat(9_500_000)}${suffix}`;
    expect(analyzeJavaScriptStaticSource(source).source_map_urls).toEqual([
      {
        declared_url: "x",
        location: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: source.length },
        },
      },
    ]);
  });

  it.each([
    "//#",
    "//# \t",
    "//# sourceMappingURL",
    "//# sourceMappingURL \t",
    "//# sourceMappingURL=",
    "//# sourceMappingURL= \t",
    "/*# sourceMappingURL= */",
    "//# sourceMappingURLx=app.js.map",
    "//# sourceMappingURL app.js.map",
  ])("ignores an incomplete or malformed directive: %s", (source) => {
    expect(sourceMapUrls(source)).toEqual([]);
  });

  it("preserves Unicode whitespace and URL terminator boundaries", () => {
    const source =
      "ğ/*@\u00a0sourceMappingURL\u2003=\ufeffapp.js.map* ignored */";
    const declaredEnd = source.indexOf(" ignored");
    expect(analyzeJavaScriptStaticSource(source).source_map_urls).toEqual([
      {
        declared_url: "app.js.map*",
        location: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: declaredEnd },
        },
      },
    ]);
  });

  it.each([
    ["/*#", "app*part.js.map", " */"],
    ["/*@", "*part.js.map", "*/"],
    ["/*#", "app.js.map*", "*/"],
    ["/*#", "**part.js.map", " */"],
    ["/*#", "app.js.map", "*/"],
    ["//#", "app*part.js.map", ""],
  ])("preserves the URL and range in %s %s%s", (marker, url, suffix) => {
    const directive = marker + " sourceMappingURL=" + url;
    const result = analyzeJavaScriptStaticSource(
      "export const value = 1;\n" + directive + suffix,
    );
    expect(result.source_map_urls).toEqual([
      {
        declared_url: url,
        location: {
          start: { line: 2, column: 0 },
          end: { line: 2, column: directive.length },
        },
      },
    ]);
  });

  it("reports nothing when no directive is present", () => {
    expect(sourceMapUrls("const value = 1;")).toEqual([]);
  });
});

const quotedDirectiveSources = [
  'const documentation = "//# sourceMappingURL=ghost.map ";',
  'const documentation = "/*# sourceMappingURL=ghost.map */";',
  "const documentation = `//# sourceMappingURL=ghost.map `;",
  "const pattern = /[//# sourceMappingURL=ghost.map ]/;",
  "const view = <div>//# sourceMappingURL=ghost.map </div>;",
  'const documentation: string = "//# sourceMappingURL=ghost.map ";',
  "/* Documentation example: //# sourceMappingURL=ghost.map */",
];

describe("source map comment boundaries", () => {
  it.each(quotedDirectiveSources)(
    "does not read a directive from %s",
    (source) => {
      const result = analyzeJavaScriptStaticSource(source);
      expect(result.parse_status).toBe("complete");
      expect(result.source_map_urls).toEqual([]);
    },
  );

  it("retains only the real trailing directive after quoted examples", () => {
    expect(
      sourceMapUrls(
        [
          quotedDirectiveSources[0],
          "const template = `/*# sourceMappingURL=template.map */`;",
          "//# sourceMappingURL=real.map",
        ].join("\n"),
      ),
    ).toEqual(["real.map"]);
  });

  it.each([
    "const value: number = 1;\n//# sourceMappingURL=typed.map",
    "const view = <div />;\n//# sourceMappingURL=typed.map",
    "const value = 1; /*@ sourceMappingURL=typed.map */",
    "const text = `${(() => { /*# sourceMappingURL=typed.map */ return 1; })()}`;",
  ])("keeps authentic comments in supported syntax: %s", (source) => {
    expect(sourceMapUrls(source)).toEqual(["typed.map"]);
  });
});

describe("source map comment locations and recovery", () => {
  it("keeps real comments when the parser recovers and reports partial syntax", () => {
    const result = analyzeJavaScriptStaticSource(
      "let value; let value;\n//# sourceMappingURL=recovered.map",
    );
    expect(result.parse_status).toBe("partial");
    expect(result.parse_error_count).toBeGreaterThan(0);
    expect(
      result.source_map_urls.map(({ declared_url }) => declared_url),
    ).toEqual(["recovered.map"]);
  });

  it("preserves the failed result when source cannot be parsed", () => {
    const result = analyzeJavaScriptStaticSource(
      "const value = ;\n//# sourceMappingURL=unparsed.map",
    );
    expect(result.parse_status).toBe("failed");
    expect(result.source_map_urls).toEqual([]);
  });
});
