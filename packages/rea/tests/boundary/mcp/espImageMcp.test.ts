import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  ESP32C3_APP_SEGMENTS,
  esp8266Image,
  espImage,
  signedEspImage,
} from "../../fixtures/espImage.js";
import { ESP8266_REFUSAL } from "../../../src/domain/firmware/espImage.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";

// The compiled stdio fixture checks advertised schemas against their dialect and
// validates actual tool responses, avoiding a second source server module graph.
// Full-profile retained-view schema work needs the compiled MCP boundary budget.
it.each(["full", "compact"] as const)(
  "exposes ESP image facts and segment extraction through MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-esp-mcp-");
    const path = join(root, "firmware.bin");
    const image = signedEspImage(espImage({ segments: ESP32C3_APP_SEGMENTS }), [
      "ecdsa-p256",
    ]);
    await writeFile(path, image);
    const { call } = await connectLocalToolsMcp({
      REA_MCP_TOOL_FAMILIES: "session,artifact,application",
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
      REA_MCP_OUTPUT_SCHEMA_PROFILE: profile,
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
        kind: "esp-image",
        chip: { target: "esp32c3", isa: "riscv", source: "ESP-IDF v6.1" },
        checksum: { status: "valid" },
        appended_sha256: { status: "valid" },
        undescribed_trailing: [],
        signature_sector_offset: 4096,
        descriptor: { kind: "app", project_name: "rea_esp_fixture" },
      });
      const retained = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["segment-03.bin", "signature-block-0.bin"],
          fields: ["logical_path", "format_metadata", "source_location"],
        },
      });
      expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
      const view = analysisViewResultSchema.parse(
        parseEvidence(retained.structuredContent).normalized_result,
      );
      expect(view).toMatchObject({
        kind: "inventory",
        items: expect.arrayContaining([
          expect.objectContaining({
            logical_path: "segment-03.bin",
            format_metadata: expect.objectContaining({
              classification: "mapped",
            }),
          }),
          expect.objectContaining({
            logical_path: "signature-block-0.bin",
            format_metadata: expect.objectContaining({
              scheme: "ecdsa",
              signature_status: "unverified",
            }),
          }),
        ]),
      });
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, "segment-03.bin")),
          image.subarray(392, 456),
        ),
      ).toBe(0);
      await call("close_binary", {});
      await writeFile(path, esp8266Image());
      const refused = await call("open_binary", { path });
      expect(JSON.stringify(parseMcpToolError(refused))).toContain(
        ESP8266_REFUSAL,
      );
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
  60_000,
);
