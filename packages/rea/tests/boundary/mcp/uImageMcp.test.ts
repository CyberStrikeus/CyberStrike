import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { buildUImage, buildMultiPayload } from "../../fixtures/uimage.js";

it.each(["full", "compact"] as const)(
  "retains uImage physical facts and unknown text through compiled MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-uimage-mcp-");
    const path = join(root, "firmware");
    const parts = [Buffer.from("abc"), Buffer.from("second part")];
    const bytes = buildUImage({
      arch: 22,
      os: 14,
      type: 4,
      name: "测".repeat(11),
      payload: buildMultiPayload(parts),
    });
    await writeFile(path, bytes);
    const { call } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "session,artifact",
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
      REA_MCP_OUTPUT_SCHEMA_PROFILE: profile,
    });
    let outputRoot: string | undefined;
    try {
      const opened = await call("open_binary", { path });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      expect(opened.structuredContent).toMatchObject({
        result: { kind: "archive", format: "uimage", architecture: null },
      });
      const reply = await call("inspect_artifact", {});
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      const inventory = inspection.substeps[0]!.evidence.normalized_result;
      expect(inventory.coverage.status).toBe("complete");
      expect(inventory.occurrences).toContainEqual(
        expect.objectContaining({
          logical_path: ".",
          format_metadata: expect.objectContaining({
            kind: "uimage",
            arch: 22,
            arch_name: "arm64",
            os: 14,
            os_name: "vxworks",
            name: null,
            name_bytes_hex: bytes.subarray(32, 64).toString("hex"),
            crc_verified: true,
          }),
        }),
      );
      expect(inventory.occurrences).toContainEqual(
        expect.objectContaining({
          logical_path: "image-1.bin",
          source_location: { offset: 80, length: parts[1]!.length },
        }),
      );
      for (const part of parts)
        expect(inventory.nodes).toContainEqual(
          expect.objectContaining({
            sha256: createHash("sha256").update(part).digest("hex"),
          }),
        );
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect(result.containment_verified).toBe(true);
      expect(result.cleanup).toMatchObject({
        verified: true,
        residual_paths: [],
      });
      for (const [index, part] of parts.entries())
        expect(
          (
            await readFile(join(outputRoot, `image-${String(index)}.bin`))
          ).equals(part),
        ).toBe(true);
      expect((await readFile(path)).equals(bytes)).toBe(true);
      await call("close_binary", {});
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
  60_000,
);
