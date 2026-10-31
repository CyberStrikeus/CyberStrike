import { describe, expect, it } from "vitest";

import { inspectSourceMapEnvelope } from "./sourceMapEnvelope.js";

const leaf = {
  version: 3,
  mappings: "AAAA",
  sources: ["app.ts"],
  names: [],
};

describe("source-map envelope walk", () => {
  it("collects indexed section leaves without interpreting generated offsets", () => {
    const root = {
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sections: [
              {
                offset: { line: 0, column: 0 },
                map: { ...leaf, sources: ["b.ts"] },
              },
              {
                offset: { line: 1, column: 0 },
                map: { ...leaf, sources: ["c.ts"] },
              },
            ],
          },
        },
        {
          offset: { line: 10, column: 0 },
          map: { ...leaf, sources: ["d.ts"] },
        },
      ],
    };
    const result = inspectSourceMapEnvelope(root);
    expect(result.status).toBe("included");
    if (result.status !== "included") throw new Error("Expected embedded maps");
    expect(result.leaves.map(({ map }) => map.sources)).toEqual([
      ["b.ts"],
      ["c.ts"],
      ["d.ts"],
    ]);
  });

  it("retains external sections in canonical path order and embedded leaves", () => {
    const url = "https://app.test/maps/part.map";
    const result = inspectSourceMapEnvelope({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sections: [
              { offset: { line: 0, column: 0 }, url: `${url}/nested` },
              { offset: { line: 1, column: 0 }, map: leaf },
            ],
          },
        },
        { offset: { line: 1, column: 0 }, url },
        {
          offset: { line: 2, column: 0 },
          map: { ...leaf, sources: ["after.ts"] },
        },
      ],
    });
    expect(result).toEqual({
      status: "unsupported",
      leaves: [
        { section_path: [0, 1], map: leaf },
        { section_path: [2], map: { ...leaf, sources: ["after.ts"] } },
      ],
      external_sections: [
        { section_path: [0, 0], url: `${url}/nested` },
        { section_path: [1], url },
      ],
      invalid_sections: [],
    });
  });

  it("retains valid leaves and URLs when a sibling section is malformed", () => {
    const url = "https://app.test/maps/part.map";
    const result = inspectSourceMapEnvelope({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { ...leaf, sources: ["before.ts"] },
        },
        { offset: { line: 1, column: 0 }, url },
        { offset: { line: 2, column: 0 }, url: 12, map: leaf },
        {
          offset: { line: 3, column: 0 },
          map: { ...leaf, sources: ["after.ts"] },
        },
      ],
    });
    expect(result).toEqual({
      status: "malformed",
      leaves: [
        { section_path: [0], map: { ...leaf, sources: ["before.ts"] } },
        { section_path: [3], map: { ...leaf, sources: ["after.ts"] } },
      ],
      external_sections: [{ section_path: [1], url }],
      invalid_sections: [
        {
          section_path: [2],
          reason: "External source-map section URL must be a string.",
        },
      ],
    });
  });

  it("rejects sections without embedded maps or an external URL", () => {
    const missing = {
      version: 3,
      sections: [{ offset: { line: 0, column: 0 } }],
    };
    expect(inspectSourceMapEnvelope(missing)).toMatchObject({
      status: "malformed",
      invalid_sections: [
        {
          section_path: [0],
          reason:
            "Indexed source-map section requires an embedded map or external URL.",
        },
      ],
    });
  });
});

describe("malformed source-map envelope facts", () => {
  it("marks a present non-array sections member malformed at the map path", () => {
    expect(
      inspectSourceMapEnvelope({
        version: 3,
        sections: null,
        sources: ["must-not-be-read.ts"],
        mappings: "AAAA",
      }),
    ).toEqual({
      status: "malformed",
      leaves: [],
      external_sections: [],
      invalid_sections: [
        {
          section_path: [],
          reason: "Indexed source-map sections must be an array.",
        },
      ],
    });
  });

  it("rejects non-version-3 roots and nested maps", () => {
    expect(inspectSourceMapEnvelope({ version: 3 })).toMatchObject({
      status: "included",
      leaves: [{ section_path: [], map: {} }],
    });
    expect(inspectSourceMapEnvelope(null)).toMatchObject({ status: "invalid" });
    expect(inspectSourceMapEnvelope([{ version: 3 }])).toMatchObject({
      status: "invalid",
    });
    expect(
      inspectSourceMapEnvelope({ version: 2, mappings: "AAAA" }),
    ).toMatchObject({
      status: "invalid",
    });
    expect(inspectSourceMapEnvelope({ mappings: "AAAA" })).toMatchObject({
      status: "invalid",
    });
    expect(
      inspectSourceMapEnvelope({
        version: 3,
        sections: [{ offset: { line: 0, column: 0 }, map: { version: 2 } }],
      }),
    ).toMatchObject({
      status: "malformed",
      invalid_sections: [
        {
          section_path: [0],
          reason: "Indexed source-map section map is not a version 3 map.",
        },
      ],
    });
  });
});
