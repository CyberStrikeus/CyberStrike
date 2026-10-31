import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  INTEL_HEX_I32_GAP,
  intelHexRecord,
  SREC_S19,
} from "../../src/domain/firmware/hexRecords.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

const cases = [
  {
    encoding: "intel-hex",
    name: "firmware.hex",
    text: INTEL_HEX_I32_GAP,
    root: { variant: "I32HEX", start_address: 0x0800_0101 },
    regions: {
      "0x08000000-0x0800001f.bin": Buffer.from(
        Array.from({ length: 32 }, (_, index) => index),
      ),
      "0x08000100-0x08000103.bin": Buffer.from("deadbeef", "hex"),
    },
  },
  {
    encoding: "srec",
    name: "firmware.s19",
    text: SREC_S19,
    root: { variant: "S19", header_text: "HDR", start_address_record: "S9" },
    regions: {
      "0x00000000-0x0000001f.bin": Buffer.from(
        Array.from({ length: 32 }, (_, index) => index),
      ),
    },
  },
] as const;

cliTest.for(cases)(
  "inventories and extracts $encoding regions through the compiled CLI",
  async ({ encoding, name, text, root, regions }, { cli }) => {
    const directory = await createTestTempDirectory("rea-hex-cli-");
    const source = join(directory, name);
    await writeFile(source, text);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(graph.manifest.root_format).toBe(encoding);
    expect(graph.coverage.status).toBe("complete");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({ kind: "hex-records", encoding, ...root });
    expect(
      graph.occurrences
        .filter((row) => row.logical_path !== ".")
        .map((row) => row.logical_path),
    ).toEqual(Object.keys(regions));
    if (encoding === "intel-hex") {
      expect(graph.coverage.scope).toBe("container-entries");
      expect(graph.limitations).toContain(
        "Intel HEX/S-record inventory decodes data records into address-contiguous regions. It does not establish CPU, byte order, memory map, or that a declared start address is executable; gaps are unwritten, not zero.",
      );
      expect(
        graph.occurrences.find((row) => row.logical_path === "."),
      ).toMatchObject({
        artifact_kind: "container",
        format_metadata: { region_count: 2 },
      });
      expect(
        graph.occurrences
          .filter((row) => row.logical_path !== ".")
          .map((row) => [
            row.logical_path,
            row.declared_size,
            row.format_metadata,
          ]),
      ).toEqual([
        [
          "0x08000000-0x0800001f.bin",
          32,
          {
            kind: "hex-record-region",
            start_address: 0x0800_0000,
            end_address: 0x0800_001f,
            length: 32,
            record_count: 2,
            first_line: 2,
            last_line: 3,
          },
        ],
        [
          "0x08000100-0x08000103.bin",
          4,
          {
            kind: "hex-record-region",
            start_address: 0x0800_0100,
            end_address: 0x0800_0103,
            length: 4,
            record_count: 1,
            first_line: 4,
            last_line: 4,
          },
        ],
      ]);
    }
    expect(inspection.next_probes.map((probe) => probe.operation)).toEqual([
      "open_binary",
    ]);
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: directory, TMP: directory, TEMP: directory },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    onTestFinished(() =>
      rm(result.output_root, { recursive: true, force: true }),
    );
    expect(result.containment_verified).toBe(true);
    for (const [path, bytes] of Object.entries(regions))
      expect(
        Buffer.compare(await readFile(join(result.output_root, path)), bytes),
      ).toBe(0);
  },
);

cliTest("rejects a malformed record through the CLI", async ({ cli }) => {
  const directory = await createTestTempDirectory("rea-hex-invalid-cli-");
  const source = join(directory, "firmware.hex");
  await writeFile(source, INTEL_HEX_I32_GAP.replace("BEEFC3", "BEEFC4"));
  const result = await cli.run({
    arguments: ["inspect-artifact", source, "--json"],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.json).toMatchObject({
    code: "artifact_operation_failed",
    details: { operation: "inspect_artifact", reason: "format" },
  });
  expect(result.stdout + result.stderr).toContain(
    "Intel HEX is malformed: line 4: record type 00 checksum 0xc4 does not match computed 0xc3",
  );
});

cliTest.for([3, 5])(
  "rejects reserved offsets in Intel HEX start record %i through the CLI",
  async (type, { cli }) => {
    const directory = await createTestTempDirectory("rea-hex-start-cli-");
    const source = join(directory, "firmware.hex");
    await writeFile(
      source,
      [
        intelHexRecord(0, 0x20, [0xa5]),
        intelHexRecord(type, 0x1234, [0, 0, 0, 1]),
        intelHexRecord(1, 0),
      ].join("\n"),
    );
    const result = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "artifact_operation_failed",
      details: { operation: "inspect_artifact", reason: "format" },
    });
  },
);
