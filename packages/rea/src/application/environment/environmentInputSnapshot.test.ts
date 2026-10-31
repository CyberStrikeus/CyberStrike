import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

import {
  environmentServeFixture,
  writeEnvironmentServeFiles,
} from "../../../tests/fixtures/environmentServe.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import {
  immutableJsonSnapshotMember,
  isImmutableJsonSnapshot,
} from "../../domain/immutableJson.js";
import { webNetworkCaptureSchema } from "../../domain/webNetworkCapture.js";
import { readEnvironmentExportInputs } from "./environmentExport.js";
import { loadEnvironmentSource } from "./environmentSource.js";

const member = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null)
    throw new Error("Missing fixture object");
  return Reflect.get(value, key);
};

it("seals privately parsed files and shares reported trees across both Evidence schema boundaries", async () => {
  const root = await createTestTempDirectory("rea-environment-owned-input-");
  const files = await writeEnvironmentServeFiles(root);
  const inputs = await readEnvironmentExportInputs(
    files.manifestPath,
    files.capturePath,
  );
  if (!inputs.ok) throw inputs.error;
  expect(isImmutableJsonSnapshot(inputs.value.evidence.value)).toBe(true);
  const loaded = loadEnvironmentSource(
    inputs.value.manifest.value,
    inputs.value.evidence.value,
  );
  if (!loaded.ok) throw loaded.error;
  const normalized = member(inputs.value.evidence.value, "normalized_result");
  const records = member(normalized, "records");
  if (!Array.isArray(records)) throw new Error("Missing fixture records");
  const reported = member(records[0], "reported");
  expect(isImmutableJsonSnapshot(reported)).toBe(true);
  expect(Object.isFrozen(reported)).toBe(true);
  expect(webNetworkCaptureSchema.parse(normalized).records[0]?.reported).toBe(
    reported,
  );
  expect(
    Buffer.compare(
      inputs.value.evidence.bytes,
      await readFile(files.capturePath),
    ),
  ).toBe(0);
  expect(
    immutableJsonSnapshotMember(
      inputs.value.evidence.value,
      "normalized_result",
    ),
  ).toBe(normalized);
});

it("authenticates mutable caller data without freezing caller-owned trees", () => {
  const fixture = structuredClone(environmentServeFixture());
  const normalized = member(fixture.capture, "normalized_result");
  const records = member(normalized, "records");
  if (!Array.isArray(records)) throw new Error("Missing fixture records");
  const reported = member(records[0], "reported");
  const loaded = loadEnvironmentSource(fixture.manifest, fixture.capture);
  if (!loaded.ok) throw loaded.error;
  expect(Object.isFrozen(fixture.capture)).toBe(false);
  expect(Object.isFrozen(normalized)).toBe(false);
  expect(Object.isFrozen(reported)).toBe(false);
  expect(isImmutableJsonSnapshot(reported)).toBe(false);
});
