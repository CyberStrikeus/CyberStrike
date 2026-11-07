import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { dfuseFile } from "../../../src/domain/firmware/dfuse.fixture.js";
import {
  RP2040_FAMILY,
  RP2XXX_ABSOLUTE_FAMILY,
  patternBytes,
  uf2Block,
  uf2File,
  uf2Image,
} from "../../../src/domain/firmware/uf2.fixture.js";

const APP = patternBytes(300, 9);
const REGION = "family-0xe48bff56/0x10000000-0x1000012b.bin";
const ABSOLUTE_REGION = "family-0xe48bff57/0x10ffff00-0x10ffffff.bin";

// The compiled stdio fixture checks advertised schemas against their dialect and
// validates actual tool responses, avoiding a second source server module graph.
it.each(["full", "compact"] as const)(
  "exposes UF2 facts, retained regions and extraction through MCP (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-uf2-mcp-");
    const path = join(root, "firmware.uf2");
    await writeFile(
      path,
      uf2File([
        uf2Block({
          address: 0x10ff_ff00,
          payload: new Uint8Array(256).fill(0xef),
          blockNo: 0,
          numBlocks: 2,
          familyId: RP2XXX_ABSOLUTE_FAMILY,
        }),
        ...uf2Image(RP2040_FAMILY, 0x1000_0000, APP),
      ]),
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
          summary: z.object({
            root_format_metadata: z.unknown(),
            source_coverage: z.unknown(),
          }),
        })
        .parse(parseEvidence(reply.structuredContent).normalized_result);
      expect(summary.summary.root_format_metadata).toMatchObject({
        kind: "uf2",
        family_count: 2,
        missing_block_count: 1,
        region_count: 2,
      });
      expect(summary.summary.source_coverage).toMatchObject({
        status: "unknown",
      });
      const retained = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: [REGION],
          fields: ["format_metadata"],
        },
      });
      expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
      expect(JSON.stringify(retained.structuredContent)).toContain(
        '"family_name":"RP2040"',
      );
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      expect(result.containment_verified).toBe(true);
      expect(result.coverage.status).toBe("unknown");
      expect(
        Buffer.compare(await readFile(join(result.output_root, REGION)), APP),
      ).toBe(0);
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, ABSOLUTE_REGION)),
          Buffer.alloc(256, 0xef),
        ),
      ).toBe(0);
      await call("close_binary", {});
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
);

it("delivers a DfuSe CRC contradiction under both integrity policies through MCP", async () => {
  const root = await createTestTempDirectory("rea-dfuse-mcp-");
  const path = join(root, "firmware.dfu");
  const valid = dfuseFile({
    targets: [
      {
        alternateSetting: 0,
        name: "Internal Flash",
        elements: [{ address: 0x0800_0000, data: [1, 2, 3, 4] }],
      },
    ],
  });
  const corrupt = Buffer.from(valid);
  corrupt.writeUInt32LE(0, corrupt.length - 4);
  await writeFile(path, corrupt);
  const { call } = await connectLocalToolsMcp({});
  const opened = await call("open_binary", { path });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const rejected = parseMcpToolError(await call("inspect_artifact", {}));
  expect(rejected.error).toMatchObject({
    code: "artifact_integrity_mismatch",
    details: {
      logical_path: ".",
      algorithm: "dfu-crc32",
      declared_crc32: "00000000",
      calculated_crc32: valid
        .readUInt32LE(valid.length - 4)
        .toString(16)
        .padStart(8, "0"),
    },
  });
  const recorded = await call("inspect_artifact", {
    integrity_policy: "record-and-continue",
  });
  expect(recorded.isError, JSON.stringify(recorded)).not.toBe(true);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(recorded.structuredContent).normalized_result,
  );
  expect(inspection.contradictions).toEqual([
    expect.objectContaining({
      algorithm: "dfu-crc32",
      declared_crc32: "00000000",
    }),
  ]);
  const graph = artifactInventoryResultSchema.parse(
    inspection.substeps[0]?.evidence.normalized_result,
  );
  expect(
    graph.occurrences.find((row) => row.logical_path === ".")?.hash_status,
  ).toBe("mismatched");
  await call("close_binary", {});
});
