import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { buildUnityFs } from "../../fixtures/unityfs.js";

it.each(["full", "compact"] as const)(
  "retains UnityFS facts and unsupported content through compiled MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-unity-mcp-");
    const path = join(root, "bundle");
    const payload = Buffer.from("serialized bytes");
    await writeFile(path, buildUnityFs([{ path: "CAB", data: payload }]));
    const { call } = await connectLocalToolsMcp({
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    });
    let outputRoot: string | undefined;
    try {
      expect((await call("open_binary", { path })).isError).not.toBe(true);
      const reply = await call("inspect_artifact", {});
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      expect(
        inspection.substeps[0]!.evidence.normalized_result.occurrences,
      ).toContainEqual(
        expect.objectContaining({
          logical_path: "CAB",
          hash_status: "verified",
          source_location: null,
        }),
      );
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect((await readFile(join(outputRoot, "CAB"))).equals(payload)).toBe(
        true,
      );
      await call("close_binary", {});
      await writeFile(
        path,
        buildUnityFs([{ path: "CAB", data: payload }], {
          engineVersion: "0.0.0",
          flags: 0x243,
        }),
      );
      await call("open_binary", { path });
      const unknownReply = await call("inspect_artifact", {});
      expect(unknownReply.isError, JSON.stringify(unknownReply)).not.toBe(true);
      const unknown = artifactInspectionResultSchema.parse(
        parseEvidence(unknownReply.structuredContent).normalized_result,
      ).substeps[0]!.evidence.normalized_result;
      expect(unknown.coverage).toMatchObject({ status: "unknown" });
      expect(unknown.occurrences).toMatchObject([
        {
          format_metadata: {
            directory_status: "unsupported-layout",
            block_count: null,
            data_start: null,
          },
        },
      ]);
      await call("close_binary", {});
      await writeFile(
        path,
        buildUnityFs([{ path: "CAB-lzma", data: payload }], {
          blockCompression: 1,
        }),
      );
      await call("open_binary", { path });
      const partialReply = await call("inspect_artifact", {});
      expect(partialReply.isError, JSON.stringify(partialReply)).not.toBe(true);
      const partial = artifactInspectionResultSchema.parse(
        parseEvidence(partialReply.structuredContent).normalized_result,
      ).substeps[0]!.evidence.normalized_result;
      expect(partial.coverage).toMatchObject({ status: "unknown" });
      expect(partial.occurrences).toContainEqual(
        expect.objectContaining({
          logical_path: "CAB-lzma",
          hash_status: "unavailable",
          artifact_id: null,
        }),
      );
      await call("close_binary", {});
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
  60_000,
);
