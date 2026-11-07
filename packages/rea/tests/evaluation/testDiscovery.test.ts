import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { compareTestDiscovery } from "../../scripts/lib/test-discovery.mjs";

const root = resolve("test-discovery-fixture");
const first = "src/domain/sample.test.ts";
const second = "src/new-provider/sample.test.ts";

describe("test discovery migration guard", () => {
  it("accepts absolute discovered paths without changing their project ownership", () => {
    expect(
      compareTestDiscovery(
        [first],
        [{ file: resolve(root, first), projectName: "domain" }],
        root,
      ),
    ).toEqual({ missing: [], unexpected: [], duplicates: [], discovered: 1 });
  });

  it("reports a new provider test omitted by the current project globs", () => {
    expect(
      compareTestDiscovery(
        [first, second],
        [{ file: first, projectName: "domain" }],
        root,
      ).missing,
    ).toEqual([second]);
  });

  it("reports overlapping project discovery and unexpected files separately", () => {
    const report = compareTestDiscovery(
      [first],
      [
        { file: first, projectName: "domain" },
        { file: first, projectName: "adapters" },
        { file: second, projectName: "adapters" },
      ],
      root,
    );
    expect(report.duplicates).toEqual([
      { file: first, projects: ["adapters", "domain"] },
    ]);
    expect(report.unexpected).toEqual([second]);
  });

  it.each([
    null,
    {},
    [{ file: "", projectName: "domain" }],
    [{ file: first }],
    [{ file: first, projectName: null }],
  ])("rejects malformed producer output: %j", (input) => {
    expect(() => compareTestDiscovery([first], input, root)).toThrow(TypeError);
  });
});
