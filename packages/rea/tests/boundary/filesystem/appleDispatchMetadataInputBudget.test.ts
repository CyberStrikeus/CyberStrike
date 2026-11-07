import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { enhancedInputSchemas } from "../../../src/contracts/enhancedInputs.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  DEFAULT_DISPATCH_METADATA_INPUT_BYTES,
  MAXIMUM_DISPATCH_METADATA_INPUT_BYTES,
} from "../../../src/domain/native/objcSwiftMetadata.js";
import {
  appleDispatchMetadataFailure,
  inspectAppleDispatchMetadata,
} from "../../../src/native/AppleDispatchMetadata.js";
import { withArtifactResourceScope } from "../../fixtures/artifactInventory.js";
import { machoWithPropertyAttributes } from "../../fixtures/objcPropertyMacho.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const fixtureTarget = async (bytes: Buffer, name = "fixture.bin") => {
  const directory = await createTestTempDirectory("rea-dispatch-budget-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  return { path, target: target.value };
};

const inspect = (
  target: Awaited<ReturnType<typeof fixtureTarget>>["target"],
  maxInputBytes?: number,
) =>
  withArtifactResourceScope((resources) =>
    resources.run(() =>
      inspectAppleDispatchMetadata(target, 100, resources, { maxInputBytes }),
    ),
  );

const refusal = async (
  path: string,
  run: () => Promise<unknown>,
): Promise<ReturnType<typeof projectAnalysisError>> => {
  const failure = await run().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (failure === undefined) throw new Error("Expected a budget refusal");
  return projectAnalysisError(appleDispatchMetadataFailure(failure, path));
};

it("records the default budget and the caller-selected budget it read under", async () => {
  const bytes = machoWithPropertyAttributes("Tq,N");
  const { target } = await fixtureTarget(bytes);
  await expect(inspect(target)).resolves.toMatchObject({
    input_admission: {
      maximum_bytes: DEFAULT_DISPATCH_METADATA_INPUT_BYTES,
      source: "default",
      retained_bytes: bytes.length,
    },
  });
  const exact = await inspect(target, bytes.length);
  expect(exact.input_admission).toEqual({
    maximum_bytes: bytes.length,
    source: "caller",
    retained_bytes: bytes.length,
  });
  // The budget changes admission only, never the decoded metadata.
  expect(exact.result).toEqual((await inspect(target)).result);
});

it("names the observed size, effective budget, its source and the budget to select", async () => {
  const bytes = machoWithPropertyAttributes("Tq,N");
  const { path, target } = await fixtureTarget(bytes);
  const projected = await refusal(path, () =>
    inspect(target, bytes.length - 1),
  );
  expect(projected).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    message: `Apple static metadata input (${String(bytes.length)} bytes) exceeds the selected max_input_bytes of ${String(bytes.length - 1)} bytes.`,
    remediation: {
      action: `Retry with max_input_bytes (CLI --max-input-bytes) of at least ${String(bytes.length)}, at most 1073741824 bytes (1 GiB); REA holds that many bytes in memory for the read.`,
    },
    details: {
      reported_limits: {
        input_bytes: bytes.length - 1,
        input_bytes_source: "caller",
        maximum_selectable_input_bytes: MAXIMUM_DISPATCH_METADATA_INPUT_BYTES,
        observed_input_bytes: bytes.length,
      },
    },
  });
  expect(JSON.stringify(projected)).not.toContain("no runtime override");
});

it("refuses files above the default without opt-in and points past the maximum to a deep provider", async () => {
  // Sparse files: admission is decided from the stat size before any read.
  const bytes = machoWithPropertyAttributes("Tq,N");
  for (const [size, source, action] of [
    [
      DEFAULT_DISPATCH_METADATA_INPUT_BYTES + 1,
      "default",
      `of at least ${String(DEFAULT_DISPATCH_METADATA_INPUT_BYTES + 1)}`,
    ],
    [
      MAXIMUM_DISPATCH_METADATA_INPUT_BYTES + 1,
      "caller",
      "use a deep analysis provider",
    ],
  ] as const) {
    const { path, target } = await fixtureTarget(bytes, `large-${source}.bin`);
    await truncate(path, size);
    const projected = await refusal(path, () =>
      inspect(
        target,
        source === "caller" ? MAXIMUM_DISPATCH_METADATA_INPUT_BYTES : undefined,
      ),
    );
    expect(projected.details).toMatchObject({
      reported_limits: {
        input_bytes_source: source,
        observed_input_bytes: size,
      },
    });
    expect(projected.remediation.action).toContain(action);
  }
});

it("validates max_input_bytes at the shared input contract", () => {
  const schema = enhancedInputSchemas.inspect_native_dispatch_metadata;
  expect(schema.parse({}).max_input_bytes).toBeUndefined();
  expect(
    schema.parse({ max_input_bytes: MAXIMUM_DISPATCH_METADATA_INPUT_BYTES })
      .max_input_bytes,
  ).toBe(MAXIMUM_DISPATCH_METADATA_INPUT_BYTES);
  for (const value of [0, -1, 1.5, MAXIMUM_DISPATCH_METADATA_INPUT_BYTES + 1])
    expect(schema.safeParse({ max_input_bytes: value }).success).toBe(false);
});
