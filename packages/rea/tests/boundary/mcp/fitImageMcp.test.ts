import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  FIT_EXTERNAL,
  FIT_KERNEL,
} from "../../../src/artifacts/fit/FitImage.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";

// The compiled stdio fixture checks advertised schemas against their dialect and
// validates actual tool responses, avoiding a second source server module graph.
it.each(["full", "compact"] as const)(
  "exposes FIT facts and image extraction through MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-fit-mcp-");
    const path = join(root, "boot.itb");
    await writeFile(path, FIT_EXTERNAL);
    const { call } = await connectLocalToolsMcp({
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    });
    let outputRoot: string | undefined;
    try {
      const opened = await call("open_binary", { path });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const reply = await call("inspect_artifact", { detail: "summary" });
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      const summary = z
        .object({
          parent_evidence_id: z.string(),
          summary: z.object({ root_format_metadata: z.unknown() }),
        })
        .parse(parseEvidence(reply.structuredContent).normalized_result);
      expect(summary.summary.root_format_metadata).toMatchObject({
        kind: "fit",
        default_configuration: "conf-1",
      });
      const retained = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["images/kernel.bin"],
          fields: ["logical_path", "format_metadata"],
        },
      });
      expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
      const view = analysisViewResultSchema.parse(
        parseEvidence(retained.structuredContent).normalized_result,
      );
      expect(view).toMatchObject({
        kind: "inventory",
        items: [
          expect.objectContaining({
            logical_path: "images/kernel.bin",
            format_metadata: expect.objectContaining({
              kind: "fit-image",
              name: "kernel",
              type: "kernel",
              arch: "arm64",
            }),
          }),
        ],
      });
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, "images/kernel.bin")),
          FIT_KERNEL,
        ),
      ).toBe(0);
      await call("close_binary", {});
      const corrupted = Buffer.from(FIT_EXTERNAL);
      const kernel = corrupted.indexOf(FIT_KERNEL);
      corrupted[kernel] = (corrupted[kernel] ?? 0) ^ 1;
      await writeFile(path, corrupted);
      await call("open_binary", { path });
      const invalid = await call("inspect_artifact", {});
      expect(parseMcpToolError(invalid).error).toMatchObject({
        category: "integrity_mismatch",
        details: {
          reason: "integrity",
          detail: expect.stringContaining("kernel hash-1 crc32"),
        },
      });
      await call("close_binary", {});
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
);
