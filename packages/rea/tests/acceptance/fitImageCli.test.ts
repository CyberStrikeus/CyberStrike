import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  FIT_DEVICETREE,
  FIT_EMBEDDED,
  FIT_EXTERNAL,
  FIT_KERNEL,
  fitFixture,
} from "../../src/artifacts/fit/FitImage.fixture.js";
import {
  cells,
  dtString,
} from "../../src/firmware/devicetree/Devicetree.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

const cases = [
  { mode: "embedded", bytes: FIT_EMBEDDED },
  { mode: "external", bytes: FIT_EXTERNAL },
] as const;

cliTest.for(cases)(
  "inventories and extracts $mode FIT images through the compiled CLI",
  async ({ bytes }, { cli }) => {
    const directory = await createTestTempDirectory("rea-fit-cli-");
    const source = join(directory, "boot.itb");
    await writeFile(source, bytes);
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
    expect(graph.manifest.root_format).toBe("fit");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      kind: "fit",
      description: "Test FIT",
      default_configuration: "conf-1",
    });
    expect(
      graph.occurrences
        .filter((row) => row.logical_path !== ".")
        .map((row) => row.logical_path)
        .sort(),
    ).toEqual(["images/fdt-1.bin", "images/kernel.bin"]);
    expect(inspection.next_probes.map((probe) => probe.operation)).toEqual([
      "inspect_devicetree",
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
    for (const [path, data] of [
      ["images/kernel.bin", FIT_KERNEL],
      ["images/fdt-1.bin", FIT_DEVICETREE],
    ] as const)
      expect(
        Buffer.compare(await readFile(join(result.output_root, path)), data),
      ).toBe(0);
  },
);

cliTest("rejects a FIT hash mismatch through the CLI", async ({ cli }) => {
  const directory = await createTestTempDirectory("rea-fit-invalid-cli-");
  const source = join(directory, "boot.itb");
  const bytes = Buffer.from(FIT_EXTERNAL);
  const kernel = bytes.indexOf(FIT_KERNEL);
  bytes[kernel] = (bytes[kernel] ?? 0) ^ 1;
  await writeFile(source, bytes);
  const result = await cli.run({
    arguments: ["inspect-artifact", source, "--json"],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(
    "FIT image kernel hash-1 crc32 does not match",
  );
});

cliTest.for([
  { label: "known", properties: { algo: dtString("aes256") } },
  { label: "missing", properties: {} },
  { label: "malformed", properties: { algo: Buffer.from([0xff, 0]) } },
])(
  "suggests no direct analysis for compressed or ciphered FIT images ($label algorithm)",
  async ({ label, properties }, { cli }) => {
    const directory = await createTestTempDirectory("rea-fit-encoded-cli-");
    const source = join(directory, "boot.itb");
    await writeFile(
      source,
      fitFixture({
        images: [
          {
            name: "kernel",
            data: FIT_KERNEL,
            properties: {
              type: dtString("flat_dt"),
              compression: dtString("none"),
              load: cells(0x4020_0000),
            },
            children: [{ name: "cipher", properties }],
          },
          {
            name: "fdt-1",
            data: FIT_DEVICETREE,
            properties: {
              type: dtString("flat_dt"),
              compression: dtString("gzip"),
            },
          },
        ],
      }),
    );
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
    expect(
      graph.occurrences.find((row) => row.logical_path === "images/kernel.bin")
        ?.format_metadata,
    ).toMatchObject({
      cipher_present: true,
      cipher_algo: label === "known" ? "aes256" : null,
    });
    expect(inspection.next_probes.map((probe) => probe.operation)).not.toEqual(
      expect.arrayContaining(["inspect_devicetree"]),
    );
    expect(inspection.next_probes.map((probe) => probe.operation)).not.toEqual(
      expect.arrayContaining(["open_binary"]),
    );
  },
);

cliTest.for([true, false])(
  "checks embedded image-data content (equal=%s)",
  async (equal, { cli }) => {
    const directory = await createTestTempDirectory("rea-fit-shared-cli-");
    const source = join(directory, "shared.itb");
    await writeFile(
      source,
      fitFixture({
        images: [
          { name: "target", data: Buffer.from("AAAA") },
          {
            name: "linked",
            data: Buffer.from(equal ? "AAAA" : "BBBB"),
            properties: { "image-data": dtString("target") },
          },
        ],
      }),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    if (!equal) {
      expect(inspected.exitCode).not.toBe(0);
      expect(inspected.stdout + inspected.stderr).toContain(
        "image-data target /images/target",
      );
      return;
    }
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    const target = graph.occurrences.find(
      (row) => row.logical_path === "images/target.bin",
    );
    const linked = graph.occurrences.find(
      (row) => row.logical_path === "images/linked.bin",
    );
    expect(linked?.format_metadata).toMatchObject({ image_data: "target" });
    expect(target?.artifact_id).toEqual(expect.any(String));
    expect(linked?.artifact_id).toBe(target?.artifact_id);
    expect(linked?.source_location?.offset).toEqual(expect.any(Number));
    expect(target?.source_location?.offset).toEqual(expect.any(Number));
    expect(linked?.source_location?.offset).not.toBe(
      target?.source_location?.offset,
    );
  },
);

cliTest(
  "preserves unreadable image and configuration signature declarations",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-fit-unknown-signatures-");
    const source = join(root, "signed.itb");
    const signatures = [
      { name: "signature-missing", properties: {} },
      {
        name: "signature-malformed",
        properties: { algo: Buffer.from([0xff, 0]) },
      },
    ];
    await writeFile(
      source,
      fitFixture({
        images: [
          { name: "plain", data: Buffer.from("plain") },
          { name: "signed", data: Buffer.from("signed"), children: signatures },
        ],
        configurations: {
          name: "configurations",
          children: [{ name: "conf", children: signatures }],
        },
      }),
    );
    const response = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(response.exitCode, response.stdout + response.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(
      graph.occurrences.find((row) => row.logical_path === "images/plain.bin")
        ?.format_metadata,
    ).toMatchObject({ signature_count: 0, signatures_unreadable: 0 });
    const signed = graph.occurrences.find(
      (row) => row.logical_path === "images/signed.bin",
    );
    expect(signed?.format_metadata).toMatchObject({
      signature_count: 2,
      signatures_unreadable: 2,
      signature_algorithms: [],
    });
    expect(
      signed?.limitations.some((value) => value.includes("signature-missing")),
    ).toBe(true);
    expect(
      signed?.limitations.some((value) =>
        value.includes("signature-malformed"),
      ),
    ).toBe(true);
    const metadata = graph.occurrences.find(
      (row) => row.logical_path === ".",
    )?.format_metadata;
    expect(metadata).toMatchObject({
      configurations: [
        {
          signature_count: 2,
          signatures_unreadable: 2,
          signature_algorithms: [],
        },
      ],
    });
    expect(
      graph.limitations.some((value) =>
        value.includes("/configurations/conf/signature-missing"),
      ),
    ).toBe(true);
    expect(
      graph.limitations.some((value) =>
        value.includes("/configurations/conf/signature-malformed"),
      ),
    ).toBe(true);
  },
);

cliTest.for([
  {
    label: "matching entry",
    arch: "arm",
    load: cells(0x400000),
    entry: cells(0x400000),
    bytes: 4,
    allowed: true,
  },
  {
    label: "unrelated hash warning",
    arch: "arm",
    load: cells(0x400000),
    bytes: 4,
    allowed: true,
    unsupportedHash: true,
  },
  {
    label: "absent entry",
    arch: "arm",
    load: cells(0x400000),
    bytes: 4,
    allowed: true,
  },
  {
    label: "missing architecture",
    load: cells(0x400000),
    bytes: 4,
    allowed: false,
  },
  {
    label: "unsupported architecture",
    arch: "mips",
    load: cells(0x400000),
    bytes: 4,
    allowed: false,
  },
  {
    label: "empty image",
    arch: "arm",
    load: cells(0x400000),
    bytes: 0,
    allowed: false,
  },
  {
    label: "misaligned load",
    arch: "arm",
    load: cells(0x400001),
    bytes: 4,
    allowed: false,
  },
  {
    label: "mapping beyond address width",
    arch: "arm",
    load: cells(0xfffffffc),
    bytes: 8,
    allowed: false,
  },
  {
    label: "divergent entry",
    arch: "arm",
    load: cells(0x400000),
    entry: cells(0x400004),
    bytes: 4,
    allowed: false,
  },
  {
    label: "unreadable entry",
    arch: "arm",
    load: cells(0x400000),
    entry: cells(1, 2, 3),
    bytes: 4,
    allowed: false,
  },
])("offers admitted FIT raw analysis ($label)", async (item, { cli }) => {
  const root = await createTestTempDirectory("rea-fit-raw-probe-");
  const source = join(root, "raw.itb");
  await writeFile(
    source,
    fitFixture({
      images: [
        {
          name: "kernel",
          data: Buffer.alloc(item.bytes, 1),
          ...("unsupportedHash" in item
            ? {
                children: [
                  {
                    name: "hash-unsupported",
                    properties: {
                      algo: dtString("crc16-ccitt"),
                      value: Buffer.alloc(2),
                    },
                  },
                ],
              }
            : {}),
          properties: {
            compression: dtString("none"),
            load: item.load,
            ...("arch" in item ? { arch: dtString(item.arch) } : {}),
            ...("entry" in item ? { entry: item.entry } : {}),
          },
        },
      ],
    }),
  );
  const reply = await cli.run({
    arguments: ["inspect-artifact", source, "--json"],
  });
  expect(reply.exitCode, reply.stdout + reply.stderr).toBe(0);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(reply.json).normalized_result,
  );
  expect(
    inspection.next_probes.some((probe) => probe.operation === "open_binary"),
  ).toBe(item.allowed);
  const graph = artifactInventoryResultSchema.parse(
    inspection.substeps[0]?.evidence.normalized_result,
  );
  expect(
    graph.occurrences.find((row) => row.logical_path === "images/kernel.bin")
      ?.declared_size,
  ).toBe(item.bytes);
});

cliTest.for([
  { algo: "sha256", verified: 1, unverified: 0 },
  { algo: "Xsha256", verified: 0, unverified: 1 },
  { algo: "\uFEFFsha256", verified: 0, unverified: 1 },
])(
  "preserves the exact FIT hash algorithm $algo through the CLI",
  async ({ algo, verified, unverified }, { cli }) => {
    const directory = await createTestTempDirectory("rea-fit-algorithm-cli-");
    const source = join(directory, "boot.itb");
    await writeFile(
      source,
      fitFixture({
        images: [
          {
            name: "kernel",
            data: FIT_KERNEL,
            children: [
              {
                name: "hash-1",
                properties: {
                  algo: dtString(algo),
                  value: createHash("sha256").update(FIT_KERNEL).digest(),
                },
              },
            ],
          },
        ],
      }),
    );
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
    expect(
      graph.occurrences.find((row) => row.logical_path === "images/kernel.bin")
        ?.format_metadata,
    ).toMatchObject({
      kind: "fit-image",
      hash_algorithms: [algo],
      hashes_verified: verified,
      hashes_unverified: unverified,
    });
  },
);
