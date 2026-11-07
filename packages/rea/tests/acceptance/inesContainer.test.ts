import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactInventoryResultSchema,
  artifactExtractionResultSchema,
} from "../../src/domain/artifactGraph.js";
import { analysisViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { inesFixture } from "../fixtures/ines.js";
import { writeOrderedZip } from "../fixtures/artifactEntryOrder.js";
import { ZIP_PACKAGE_FORMATS } from "../../src/domain/zipPackageFormat.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { buildBinary } from "plist";

cliTest(
  "refuses extraction after an already open plist is replaced through MCP",
  async () => {
    const root = await createTestTempDirectory("rea-ines-plist-refresh-");
    const path = join(root, "source.bin");
    await writeFile(path, buildBinary({ value: "old" }));
    const { call } = await connectLocalToolsMcp();
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened.structuredContent)).not.toBe(
      true,
    );
    expect(
      toolContract("open_binary").outputSchema.parse(opened.structuredContent)
        .result,
    ).toMatchObject({ format: "plist" });
    const bytes = inesFixture();
    await writeFile(path, bytes);
    const extracted = await call("extract_artifact", {});
    expect(extracted.isError).toBe(true);
    expect(JSON.stringify(parseMcpToolError(extracted))).toContain(
      "Artifact format has no extraction reader: plist",
    );
    await call("close_binary", {});
  },
);

cliTest(
  "refreshes an iNES path through MCP for every ZIP package family",
  async () => {
    const root = await createTestTempDirectory("rea-ines-zip-refresh-");
    const { call } = await connectLocalToolsMcp();
    for (const format of ZIP_PACKAGE_FORMATS) {
      const path = join(
        root,
        `cartridge.${format === "app-pack" ? "app" : format}`,
      );
      await writeFile(path, inesFixture());
      const first = await call("open_binary", { path });
      expect(first.isError, JSON.stringify(first)).not.toBe(true);
      await writeOrderedZip(path, ["payload.txt"]);
      const refreshed = await call("open_binary", { path });
      expect(
        refreshed.isError,
        JSON.stringify({ format, response: refreshed }),
      ).not.toBe(true);
      expect(
        toolContract("open_binary").outputSchema.parse(
          refreshed.structuredContent,
        ).result,
      ).toMatchObject({ kind: "archive", format });
      const session = await call("binary_session", {});
      expect(
        session.isError,
        JSON.stringify(session.structuredContent),
      ).not.toBe(true);
      expect(
        toolContract("binary_session").outputSchema.parse(
          session.structuredContent,
        ).result,
      ).toMatchObject({ open: true, kind: "archive", format });
    }
  },
);

const inventoryFrom = (input: unknown) => {
  const evidence = parseEvidence(input);
  expect(evidence.subject).toMatchObject({
    format: "ines",
    architecture: null,
  });
  const inspection = artifactInspectionResultSchema.parse(
    evidence.normalized_result,
  );
  expect(inspection.coverage.status).toBe("complete-within-substeps");
  expect(inspection.observations.map(({ kind }) => kind)).toEqual([
    "root-manifest",
    "container-header",
    "reconstruction",
  ]);
  const substep = inspection.substeps[0];
  if (substep === undefined) throw new Error("Missing inventory substep");
  parseEvidence(substep.evidence);
  const inventory = artifactInventoryResultSchema.parse(
    substep.evidence.normalized_result,
  );
  expect(inventory.coverage.status).toBe("complete");
  expect(inventory.limitations).toContainEqual(
    expect.stringContaining("CPU bank mappings"),
  );
  return inventory;
};

cliTest(
  "classic iNES has the same complete byte inventory through compiled CLI and stdio MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ines-public-");
    const path = join(root, "卡带.hop");
    const bytes = inesFixture({
      trainer: true,
      trailing: Buffer.from([0, 255, 3, 0]),
    });
    await writeFile(path, bytes);
    const cliResult = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(cliResult.exitCode, cliResult.stderr).toBe(0);
    const inventory = inventoryFrom(cliResult.json);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(inventory.ines).toMatchObject({
      header: {
        header_hex: bytes.subarray(0, 16).toString("hex"),
        mapper: 19,
        trainer_present: true,
        prg_rom_units_16k: 2,
        chr_rom_units_8k: 1,
      },
      reconstruction: { bytes: bytes.length, sha256: digest, verified: true },
    });
    const expected = [
      ["header.bin", 0, 16],
      ["trainer.bin", 16, 512],
      ["prg/000.bin", 528, 16_384],
      ["prg/001.bin", 16_912, 16_384],
      ["chr/000.bin", 33_296, 8_192],
      ["trailing.bin", 41_488, 4],
    ] as const;
    const nodes = new Map(
      inventory.nodes.map((node) => [node.artifact_id, node]),
    );
    for (const [logical_path, offset, length] of expected) {
      const occurrence = inventory.occurrences.find(
        (item) => item.logical_path === logical_path,
      );
      if (
        occurrence?.artifact_id === undefined ||
        occurrence.artifact_id === null
      )
        throw new Error(`Missing region ${logical_path}`);
      expect(occurrence.source_location).toEqual({ offset, length });
      expect(nodes.get(occurrence.artifact_id)?.sha256).toBe(
        createHash("sha256")
          .update(bytes.subarray(offset, offset + length))
          .digest("hex"),
      );
      expect(nodes.get(occurrence.artifact_id)?.size).toBe(length);
      if (logical_path === "header.bin") {
        expect(nodes.get(occurrence.artifact_id)?.format).toBe("file");
      }
    }
    expect(inventory.ines?.reconstruction.region_order).toEqual(
      expected.map(([logicalPath]) => logicalPath),
    );

    const { call } = await connectLocalToolsMcp();
    const opened = await call("open_binary", { path });
    if (opened.isError) throw new Error(JSON.stringify(opened));
    const inspected = await call("inspect_artifact", {});
    expect(
      inspected.isError,
      JSON.stringify(inspected.structuredContent),
    ).not.toBe(true);
    expect(inventoryFrom(inspected.structuredContent)).toEqual(inventory);
    const typed = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.structuredContent).normalized_result,
    );
    expect(typed.substeps[0]?.evidence.normalized_result).toMatchObject({
      ines: inventory.ines,
    });
    const withInventory = (normalized_result: unknown) => ({
      ...typed,
      substeps: typed.substeps.map((substep) => ({
        ...substep,
        evidence: { ...substep.evidence, normalized_result },
      })),
    });
    expect(
      artifactInspectionResultSchema.safeParse(
        withInventory({ ...inventory, ines: undefined }),
      ).success,
    ).toBe(false);
    const withoutInes = { ...inventory };
    delete withoutInes.ines;
    expect(
      artifactInspectionResultSchema.safeParse(withInventory(withoutInes))
        .success,
    ).toBe(true);

    const summary = await call("inspect_artifact", { detail: "summary" });
    expect(summary.isError, JSON.stringify(summary.structuredContent)).not.toBe(
      true,
    );
    const view = analysisViewResultSchema.parse(
      parseEvidence(summary.structuredContent).normalized_result,
    );
    expect(view.kind).toBe("summary");
    const regions = await call("inspect_analysis_view", {
      source: {
        kind: "retained-evidence",
        evidence_id: view.parent_evidence_id,
      },
      view: {
        kind: "inventory",
        collection: "occurrences",
        logical_paths: ["prg/000.bin"],
      },
    });
    expect(regions.isError, JSON.stringify(regions.structuredContent)).not.toBe(
      true,
    );
    expect(
      parseEvidence(regions.structuredContent).normalized_result,
    ).toMatchObject({
      kind: "inventory",
      items: inventory.occurrences.filter(
        (item) => item.logical_path === "prg/000.bin",
      ),
    });
    const extracted = await call("extract_artifact", {});
    expect(
      extracted.isError,
      JSON.stringify(extracted.structuredContent),
    ).not.toBe(true);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.structuredContent).normalized_result,
    );
    try {
      expect(extraction.artifacts).toHaveLength(expected.length);
      const reconstructed = Buffer.concat(
        await Promise.all(
          expected.map(([region]) =>
            readFile(join(extraction.output_root, region)),
          ),
        ),
      );
      expect(reconstructed.equals(bytes)).toBe(true);
    } finally {
      // The successful extraction transfers this exact output directory to the caller.
      await rm(extraction.output_root, { recursive: true, force: true });
    }
    await call("close_binary", {});
    expect((await readFile(path)).equals(bytes)).toBe(true);
  },
);

cliTest(
  "unsupported NES containers fail explicitly and leave a valid MCP session usable",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ines-public-refusal-");
    const validPath = join(root, "valid.nes");
    await writeFile(validPath, inesFixture({ chrUnits: 0 }));
    const { call } = await connectLocalToolsMcp();
    const opened = await call("open_binary", { path: validPath });
    if (opened.isError) throw new Error(JSON.stringify(opened));
    for (const [name, bytes, reason] of [
      ["truncated", inesFixture().subarray(0, 20), "truncated iNES payload"],
      [
        "nes2",
        (() => {
          const bytes = inesFixture();
          bytes[7] = 8;
          return bytes;
        })(),
        "nes-2.0",
      ],
      ["unif", Buffer.from("UNIF"), "unif"],
    ] as const) {
      const path = join(root, `${name}.nes`);
      await writeFile(path, bytes);
      const refused = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
      });
      expect(refused.exitCode).not.toBe(0);
      expect(JSON.stringify(refused.json)).toContain(reason);
      const switched = await call("open_binary", { path });
      expect(switched.isError).toBe(true);
      expect(JSON.stringify(parseMcpToolError(switched))).toContain(reason);
    }
    const retained = await call("inspect_artifact", {});
    expect(
      retained.isError,
      JSON.stringify(retained.structuredContent),
    ).not.toBe(true);
    const inventory = inventoryFrom(retained.structuredContent);
    expect(inventory.ines?.header.chr_rom_units_8k).toBe(0);
    expect(
      inventory.occurrences.some(({ logical_path }) =>
        logical_path.startsWith("chr/"),
      ),
    ).toBe(false);
    await call("close_binary", {});
  },
);
