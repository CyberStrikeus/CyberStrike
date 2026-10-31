import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LocalWebSourceLocationArtifacts } from "../../../src/browser/assets/WebSourceLocationArtifacts.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ok } from "../../../src/domain/result.js";
import { WEB_SOURCE_MAP_LIMITS } from "../../../src/domain/webSourceLocation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
} from "../../fixtures/webSourceLocation.js";

const reader = () => {
  const { sourceMap: _sourceMap, ...script } = webSourceLocationFixture();
  return new LocalWebSourceLocationArtifacts({
    load: () => Promise.resolve(ok(script)),
  });
};
it("reads exact selected map bytes, retaining a BOM and explicitly selected URL context", async () => {
  const root = await createTestTempDirectory("rea-map-artifacts-");
  const path = join(root, "app.map");
  const text = '\uFEFF{"version":3,"sources":[],"names":[],"mappings":""}';
  await writeFile(path, text);
  const response = await reader().load({
    ...webSourceLocationArgs,
    source_map: { ...webSourceLocationArgs.source_map, path },
  });
  if (!response.ok) throw response.error;
  expect(response.value.sourceMap).toEqual({
    file: {
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
    },
    url: webSourceLocationArgs.source_map.url,
    text,
  });
});
it.each(["unavailable", "invalid-utf8", "oversized"])(
  "preserves the selected map reader failure: %s",
  async (variant) => {
    const root = await createTestTempDirectory("rea-map-artifacts-");
    const path = join(root, "app.map");
    if (variant === "invalid-utf8")
      await writeFile(path, Buffer.from([255, 254]));
    if (variant === "oversized")
      await writeFile(
        path,
        Buffer.alloc(WEB_SOURCE_MAP_LIMITS.mapBytes + 1, 32),
      );
    const response = await reader().load({
      ...webSourceLocationArgs,
      source_map: { ...webSourceLocationArgs.source_map, path },
    });
    if (response.ok) throw new Error("expected map failure");
    const projection = projectAnalysisError(response.error);
    if (variant === "oversized")
      expect(response.error).toMatchObject({
        _tag: "ArtifactOperationError",
        reason: "limit",
        detail: expect.stringContaining(path),
      });
    else
      expect(projection).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["source_map", "path"],
              ...(variant === "unavailable"
                ? { reason: "invalid_value" }
                : { reason: "invalid_format" }),
              message: expect.stringContaining(
                variant === "unavailable" ? `(ENOENT): ${path}` : "UTF-8",
              ),
            },
          ],
        },
      });
  },
);
