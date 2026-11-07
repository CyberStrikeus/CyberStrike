import { expect, it } from "vitest";

import { inspectSourceMapEnvelope } from "../../domain/sourceMapEnvelope.js";
import { inspectSourceMapValue } from "./SourceMapFormat.js";
import { traceSourceMap } from "./TraceSourceMap.js";

const leaf = {
  version: 3,
  sources: ["original.ts"],
  sourcesContent: ["hello"],
  mappings: "AAAA",
};
const indexed = (map: unknown) => ({
  version: 3,
  sections: [{ offset: { line: 0, column: 0 }, map }],
});

it.each([2, null, undefined, "3"])(
  "rejects nested indexed version %s consistently",
  (version) => {
    const map = indexed({ ...indexed(leaf), version });
    expect(inspectSourceMapEnvelope(map)).toMatchObject({
      status: "malformed",
      invalid_sections: [{ section_path: [0] }],
    });
    for (const profile of [undefined, "browser-collection"] as const)
      expect(() =>
        inspectSourceMapValue(map, profile === undefined ? {} : { profile }),
      ).toThrow(expect.objectContaining({ reason: "format" }));
    expect(() =>
      traceSourceMap(JSON.stringify(map), "https://example.test/main.js.map", {
        line: 1,
        column: 0,
      }),
    ).toThrow(expect.objectContaining({ reason: "format" }));
  },
);

it("admits numeric version 3 through the same consumers", () => {
  const map = indexed(indexed(leaf));
  expect(inspectSourceMapEnvelope(map)).toMatchObject({ status: "included" });
  expect(
    inspectSourceMapValue(map, { profile: "browser-collection" }).leaves,
  ).toHaveLength(1);
  expect(
    traceSourceMap(JSON.stringify(map), "https://example.test/main.js.map", {
      line: 1,
      column: 0,
    }).matches,
  ).toMatchObject([{ section_path: [0, 0], reported_source: "original.ts" }]);
});
