import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import {
  nodeSeaPe,
  buildNodeSeaBlob,
} from "../../../src/artifacts/nodeSea/NodeSea.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { z } from "zod";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";

// The compiled stdio fixture checks advertised schemas against their dialect and
// validates actual tool responses, avoiding a second source server module graph.
it.each(["full", "compact"] as const)(
  "exposes SEA facts and extraction through MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-sea-mcp-");
    const path = join(root, "application.exe");
    await writeFile(
      path,
      nodeSeaPe({
        codePath: "main.js",
        main: "throw 1;",
        fuse: "set",
        assets: [{ name: "data.txt", body: "data" }],
      }),
    );
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
        kind: "node-sea",
        carrier: "pe",
        fuse_state: "set",
        code_path: "main.js",
      });
      const retained = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["main.js"],
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
          {
            logical_path: "main.js",
            format_metadata: { kind: "node-sea-entry", role: "main-script" },
          },
        ],
      });
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect(await readFile(join(result.output_root, "data.txt"), "utf8")).toBe(
        "data",
      );
      expect((await call("close_binary", {})).isError).not.toBe(true);
      await writeFile(path, nodeSeaPe({ blob: Buffer.alloc(16) }));
      expect((await call("open_binary", { path })).isError).not.toBe(true);
      const invalid = await call("inspect_artifact", {});
      expect(parseMcpToolError(invalid).error).toMatchObject({
        code: "artifact_operation_failed",
        details: {
          operation: "inspect_artifact",
          reason: "format",
          detail: expect.stringContaining("magic"),
        },
      });
      expect((await call("close_binary", {})).isError).not.toBe(true);
      await writeFile(
        path,
        nodeSeaPe({
          blob: buildNodeSeaBlob({
            assets: Array.from({ length: 100_001 }, (_, index) => ({
              name: `a${String(index)}`,
              body: "",
            })),
          }),
        }),
      );
      expect((await call("open_binary", { path })).isError).not.toBe(true);
      const overLimit = await call("inspect_artifact", {});
      expect(parseMcpToolError(overLimit).error).toMatchObject({
        code: "truncated",
        details: {
          operation: "inspect_artifact",
          reason: "limit",
          boundary: "capacity",
          truncated: true,
        },
      });
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
);
