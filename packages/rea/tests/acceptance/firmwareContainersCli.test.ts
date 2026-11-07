import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";
import { dfuseFile } from "../../src/domain/firmware/dfuse.fixture.js";
import {
  RP2040_FAMILY,
  RP2350_ARM_S_FAMILY,
  patternBytes,
  uf2Block,
  uf2File,
  uf2Image,
} from "../../src/domain/firmware/uf2.fixture.js";

const RP2040_APP = patternBytes(300, 1);
const RP2350_APP = patternBytes(300, 2);
const FLASH = Uint8Array.from([1, 2, 3, 4]);
const OPTION_BYTES = Uint8Array.from([0xaa, 0x55]);

const cases = [
  {
    format: "uf2",
    name: "universal.uf2",
    bytes: uf2File([
      ...uf2Image(RP2040_FAMILY, 0x1000_0000, RP2040_APP),
      ...uf2Image(RP2350_ARM_S_FAMILY, 0x1000_0000, RP2350_APP),
    ]),
    root: { kind: "uf2", family_count: 2, region_count: 2 },
    regions: {
      "family-0xe48bff56/0x10000000-0x1000012b.bin": RP2040_APP,
      "family-0xe48bff59/0x10000000-0x1000012b.bin": RP2350_APP,
    },
  },
  {
    format: "dfuse",
    name: "firmware.dfu",
    bytes: dfuseFile({
      targets: [
        {
          alternateSetting: 0,
          name: "Internal Flash",
          elements: [{ address: 0x0800_0000, data: FLASH }],
        },
        {
          alternateSetting: 1,
          name: "Option Bytes",
          elements: [{ address: 0x1fff_c000, data: OPTION_BYTES }],
        },
      ],
    }),
    root: { kind: "dfuse", target_count: 2, element_count: 2 },
    regions: {
      "target-0/element-0-0x08000000-0x08000003.bin": FLASH,
      "target-1/element-0-0x1fffc000-0x1fffc001.bin": OPTION_BYTES,
    },
  },
] as const;

const graphFrom = (json: unknown) =>
  artifactInventoryResultSchema.parse(
    artifactInspectionResultSchema.parse(parseEvidence(json).normalized_result)
      .substeps[0]?.evidence.normalized_result,
  );

cliTest.for(cases)(
  "inventories and extracts $format regions through the compiled CLI",
  async ({ format, name, bytes, root, regions }, { cli }) => {
    const directory = await createTestTempDirectory("rea-firmware-cli-");
    const source = join(directory, name);
    await writeFile(source, bytes);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = graphFrom(inspected.json);
    expect(graph.manifest.root_format).toBe(format);
    expect(graph.coverage.status).toBe("complete");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject(root);
    expect(
      graph.occurrences
        .filter((row) => row.logical_path !== ".")
        .map((row) => row.logical_path),
    ).toEqual(Object.keys(regions));
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
    for (const [path, expected] of Object.entries(regions))
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, path)),
          expected,
        ),
      ).toBe(0);
  },
);

cliTest(
  "applies strict and record-and-continue policies to a DfuSe suffix CRC",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-dfuse-crc-cli-");
    const source = join(directory, "firmware.dfu");
    const valid = dfuseFile({
      targets: [
        { alternateSetting: 0, elements: [{ address: 0, data: FLASH }] },
      ],
    });
    const observed = valid.readUInt32LE(valid.length - 4);
    const corrupt = Buffer.from(valid);
    corrupt.writeUInt32LE(0x1234_5678, corrupt.length - 4);
    await writeFile(source, corrupt);
    const rejected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.json).toMatchObject({
      code: "artifact_integrity_mismatch",
      details: {
        logical_path: ".",
        algorithm: "dfu-crc32",
        declared_crc32: "12345678",
        calculated_crc32: observed.toString(16).padStart(8, "0"),
        unpacked: false,
      },
    });
    const inspected = await cli.run({
      arguments: [
        "inspect-artifact",
        source,
        "--integrity-policy",
        "record-and-continue",
        "--json",
      ],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    expect(graphFrom(inspected.json).integrity_contradictions).toEqual([
      expect.objectContaining({
        logical_path: ".",
        algorithm: "dfu-crc32",
        declared_crc32: "12345678",
        observed_crc32: observed.toString(16).padStart(8, "0"),
        trust: "observed-untrusted",
      }),
    ]);
    // Extraction applies the same default policy and leaves no output behind.
    const refused = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: directory, TMP: directory, TEMP: directory },
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "artifact_integrity_mismatch",
      details: { logical_path: ".", algorithm: "dfu-crc32" },
    });
    expect(await readdir(directory)).toEqual(["firmware.dfu"]);
  },
);

cliTest(
  "refuses a conflicting UF2 rewrite through the CLI",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-uf2-conflict-cli-");
    const source = join(directory, "firmware.uf2");
    await writeFile(
      source,
      uf2File([
        ...uf2Image(RP2040_FAMILY, 0x1000_0000, RP2040_APP),
        uf2Block({
          address: 0x1000_0000,
          payload: [0xff],
          blockNo: 0,
          numBlocks: 1,
          familyId: RP2040_FAMILY,
        }),
      ]),
    );
    const result = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      details: { operation: "inspect_artifact", reason: "format" },
    });
    expect(result.stdout + result.stderr).toContain(
      "UF2 is malformed: family 0xe48bff56 (RP2040) address 0x10000000 is written with different values by blocks 0-1 (0x01) and block 2 (0xff)",
    );
  },
);
