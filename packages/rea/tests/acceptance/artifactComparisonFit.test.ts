import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fitFixture } from "../../src/artifacts/fit/FitImage.fixture.js";
import {
  cells,
  dtString,
} from "../../src/firmware/devicetree/Devicetree.fixture.js";
import { artifactComparisonResultSchema } from "../../src/domain/artifactComparison.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import { parseEvidence, type Evidence } from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it("compares FIT declarations while preserving layout independence and unknowns", async () => {
  const root = await createTestTempDirectory("rea-fit-comparison-");
  const { call } = await connectLocalToolsMcp({
    REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
    REA_MCP_TOOL_FAMILIES: "artifact,application,session",
  });
  const properties = {
    type: dtString("kernel"),
    arch: dtString("arm64"),
    compression: dtString("none"),
    load: cells(0x400000),
    entry: cells(0x400004),
  };
  const image = {
    name: "kernel",
    data: Buffer.from("payload"),
    hashes: ["sha256"],
  };
  const inspect = async (
    name: string,
    overrides: Record<string, Buffer> = {},
    options: {
      mode?: "embedded" | "position";
      prefix?: boolean;
      omitLoad?: boolean;
      unsupportedHash?: boolean;
    } = {},
  ): Promise<Evidence> => {
    const path = join(root, name);
    const { load: _load, ...withoutLoad } = properties;
    await writeFile(
      path,
      fitFixture({
        images: [
          ...(options.prefix
            ? [{ name: "prefix", data: Buffer.from("prefix") }]
            : []),
          {
            ...image,
            properties: {
              ...(options.omitLoad ? withoutLoad : properties),
              ...overrides,
            },
            ...(options.unsupportedHash
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
          },
        ],
        mode: options.mode ?? "embedded",
      }),
    );
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const response = await call("inspect_artifact", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return parseEvidence(response.structuredContent);
  };
  const compare = async (left: Evidence, right: Evidence) => {
    const response = await call("compare_artifacts", { left, right });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return artifactComparisonResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
  };
  const occurrence = (evidence: Evidence) => {
    const inspection = artifactInspectionResultSchema.parse(
      evidence.normalized_result,
    );
    const row = artifactInventoryResultSchema
      .parse(inspection.substeps[0]?.evidence.normalized_result)
      .occurrences.find((row) => row.logical_path === "images/kernel.bin");
    if (row === undefined) throw new Error("Missing kernel occurrence");
    return row;
  };
  const left = await inspect("base.itb");
  for (const field of ["load", "entry"] as const) {
    const right = await inspect(field + ".itb", { [field]: cells(0x500000) });
    expect(occurrence(right).artifact_id).toBe(occurrence(left).artifact_id);
    const result = await compare(left, right);
    expect(
      result.changes.filter((row) => row.logical_path === "images/kernel.bin"),
    ).toMatchObject([{ classification: "changed", dimensions: ["metadata"] }]);
  }
  const relocated = await inspect(
    "relocated.itb",
    {},
    { mode: "position", prefix: true },
  );
  expect(occurrence(relocated).artifact_id).toBe(occurrence(left).artifact_id);
  expect(
    (await compare(left, relocated)).changes.filter(
      (row) => row.logical_path === "images/kernel.bin",
    ),
  ).toEqual([]);
  const unknownLeft = await inspect("unknown-left.itb", {
    load: cells(1, 2, 3),
  });
  const unknownRight = await inspect("unknown-right.itb", {
    load: cells(4, 5, 6),
  });
  expect(
    (await compare(unknownLeft, unknownRight)).changes.filter(
      (row) => row.logical_path === "images/kernel.bin",
    ),
  ).toMatchObject([
    { classification: "unknown", dimensions: ["availability"] },
  ]);
  const partialChange = await inspect("partial-entry.itb", {
    load: cells(4, 5, 6),
    entry: cells(0x600000),
  });
  expect(
    (await compare(unknownLeft, partialChange)).changes.filter(
      (row) => row.logical_path === "images/kernel.bin",
    ),
  ).toMatchObject([
    { classification: "changed", dimensions: ["metadata", "availability"] },
  ]);
  const absent = await inspect(
    "warn-absent.itb",
    {},
    { omitLoad: true, unsupportedHash: true },
  );
  const present = await inspect(
    "warn-present.itb",
    {},
    { unsupportedHash: true },
  );
  expect(
    (await compare(absent, present)).changes.filter(
      (row) => row.logical_path === "images/kernel.bin",
    ),
  ).toMatchObject([{ classification: "changed", dimensions: ["metadata"] }]);
});
