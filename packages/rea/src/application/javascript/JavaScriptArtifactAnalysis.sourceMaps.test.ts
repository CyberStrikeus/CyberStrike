import { expect, it } from "vitest";

import { analyzeArtifactFiles } from "../../../tests/fixtures/javascriptArtifactAnalysis.js";

const HASH = "a".repeat(64);

it("retains resolved source declarations, Unicode spelling and null source positions", async () => {
  const sourceMapText = JSON.stringify({
    version: 3,
    file: "main.js",
    sourceRoot: "../src/",
    sources: ["cafe\u0301.ts", null, "other.ts"],
    sourcesContent: ["export const value = 1;", null, "export {};"],
    names: [],
    mappings: "",
  });
  const { analysis } = await analyzeArtifactFiles({
    files: [
      {
        path: "dist/main.js.map",
        container_sha256: HASH,
        sha256: HASH,
        bytes: Buffer.byteLength(sourceMapText),
        inventory_artifact_id: "artifact_test",
        kind: "source-map",
        unpacked: false,
        text: { included: true, value: sourceMapText },
      },
    ],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: Buffer.byteLength(sourceMapText),
    invalid_utf8_files: 0,
  });
  const originals = analysis.source_maps[0]?.sources;
  const original = originals?.[0];
  expect(originals?.[1]?.reference).toBeNull();
  expect(originals?.[2]?.reference?.resolution).toEqual({
    kind: "artifact-relative",
    path: "src/other.ts",
  });
  expect(original?.reference).toMatchObject({
    source_name: "cafe\u0301.ts",
    source_root: "../src/",
    map_path: "dist/main.js.map",
    resolution: {
      kind: "artifact-relative",
      path: "src/cafe\u0301.ts",
    },
  });
});
