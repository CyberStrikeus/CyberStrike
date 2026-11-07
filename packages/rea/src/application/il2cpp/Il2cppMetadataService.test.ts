import { createEmptyIl2cppMetadataFixture } from "../../domain/il2cpp/il2cppMetadata.fixture.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { expect, it } from "vitest";
import { Il2cppMetadataService } from "./Il2cppMetadataService.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import type { Il2cppMetadata } from "../../domain/il2cpp/il2cppMetadata.js";
import { err, ok } from "../../domain/result.js";
import { EvidenceFileError } from "../../domain/evidenceErrors.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import type { Il2cppSeedWriterPort } from "./Il2cppSeedWriterPort.js";

const identity = {
  id: "fixture-il2cpp",
  name: "Source-owned IL2CPP reader seam",
  version: "1",
};
const report = createEmptyIl2cppMetadataFixture();

const serviceReturning = (value: Il2cppMetadata, calls = { count: 0 }) =>
  new Il2cppMetadataService({
    close: async () => {},
    identity,
    inspect: () => {
      calls.count += 1;
      return Promise.resolve(ok(value));
    },
  });

it("rejects invalid paths and extra arguments before invoking the reader", async () => {
  const calls = { count: 0 };
  const service = serviceReturning(report, calls);
  for (const input of [
    { path: "relative/global-metadata.dat", detail: "complete" },
    { path: "/artifacts/\0global-metadata.dat", detail: "complete" },
    { path: report.artifact.path, detail: "complete", decrypt: true },
    { path: report.artifact.path, detail: "rows" },
  ]) {
    const result = await service.inspect(input);
    expect(result).toMatchObject({
      ok: false,
      error: expect.any(AnalysisInputError),
    });
  }
  expect(calls.count).toBe(0);
});

it.each(["summary", undefined] as const)(
  "refuses %s summary delivery without Evidence retention before reading",
  async (detail) => {
    const calls = { count: 0 };
    const result = await serviceReturning(report, calls).inspect({
      path: report.artifact.path,
      ...(detail === undefined ? {} : { detail }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
    expect(calls.count).toBe(0);
  },
);

it("returns explicit complete artifact-bound Evidence without retention", async () => {
  const result = await serviceReturning(report).inspect({
    path: report.artifact.path,
    detail: "complete",
  });
  if (!result.ok) throw result.error;
  expect(result.value.parameters).toEqual({ path: report.artifact.path });
  expect(result.value.normalized_result).toEqual(report);
  expect(result.value.subject).toMatchObject({
    format: "file",
    local_path: report.artifact.path,
    digest: { sha256: report.artifact.sha256 },
  });
});

it("rejects a reader that changes the selected artifact identity", async () => {
  const result = await serviceReturning({
    ...report,
    artifact: { ...report.artifact, path: "/artifacts/other.dat" },
  }).inspect({ path: report.artifact.path, detail: "complete" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
});

it("reports cancellation before and after reading", async () => {
  const aborted = new AbortController();
  aborted.abort();
  const calls = { count: 0 };
  const before = await serviceReturning(report, calls).inspect(
    { path: report.artifact.path, detail: "complete" },
    { signal: aborted.signal },
  );
  expect(before.ok).toBe(false);
  if (!before.ok) {
    expect(before.error).toBeInstanceOf(AnalysisCancelledError);
    expect(before.error.cause).toBe(aborted.signal.reason);
  }
  expect(calls.count).toBe(0);

  const during = new AbortController();
  const service = new Il2cppMetadataService({
    close: async () => {},
    identity,
    inspect: () => {
      during.abort();
      return Promise.resolve(ok(report));
    },
  });
  const after = await service.inspect(
    { path: report.artifact.path, detail: "complete" },
    { signal: during.signal },
  );
  expect(after.ok).toBe(false);
  if (!after.ok) {
    expect(after.error).toBeInstanceOf(AnalysisCancelledError);
    expect(after.error.cause).toBe(during.signal.reason);
    expect(after.error.partialObservation).toMatchObject({
      operation: "inspect_il2cpp_metadata",
      normalized_result: report,
    });
  }
});

const linkedReport = (): Il2cppMetadata => ({
  ...report,
  binary: {
    artifact: {
      path: "/artifacts/GameAssembly.dll",
      sha256: "b".repeat(64),
      bytes: 4096,
    },
    format: "pe",
    architecture: "amd64",
    image_base: "0x1000",
    code_gen_modules_field: "0x1100",
    code_gen_modules_array: "0x1200",
    code_gen_modules: [],
    types_field: "0x1300",
    types_count: 0,
    generic_methods: null,
  },
});
const seedWriter = (
  write: Il2cppSeedWriterPort["write"],
  close: () => Promise<void> = async () => {},
): Il2cppSeedWriterPort => ({ check: async () => ok(undefined), write, close });
const selectedPair = {
  path: report.artifact.path,
  binary_path: "/artifacts/GameAssembly.dll",
  detail: "complete",
} as const;
it("preserves source Evidence and requested output choices when publication fails", async () => {
  const failure = new EvidenceFileError("write", "io", {
    path: "/output/seeds.tsv",
  });
  const service = new Il2cppMetadataService(
    {
      close: async () => {},
      identity,
      inspect: async () => ok(linkedReport()),
    },
    seedWriter(async () => err(failure)),
  );
  const result = await service.inspectWithGhidraSeeds(selectedPair, {
    path: "/output/seeds.tsv",
    base: "0x2000",
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Failed publication accepted");
  expect(result.error).toBe(failure);
  expect(result.error.partialObservation).toMatchObject({
    operation: "inspect_il2cpp_metadata",
    parameters: {
      path: selectedPair.path,
      binary_path: selectedPair.binary_path,
      ghidra_seeds: "/output/seeds.tsv",
      seed_base: "0x2000",
    },
  });
  await service.close();
});
it("retains a published seed receipt if cancellation arrives after the atomic write", async () => {
  const controller = new AbortController(),
    reason = new Error("cancel after publication");
  const receipt = {
    path: "/output/seeds.tsv",
    bytes: 200,
    functions: 0,
    folded: 0,
    no_body: 0,
    unknown: 0,
    generic_instances: null,
  };
  const service = new Il2cppMetadataService(
    {
      close: async () => {},
      identity,
      inspect: async () => ok(linkedReport()),
    },
    seedWriter(async () => {
      controller.abort(reason);
      return ok(receipt);
    }),
  );
  const result = await service.inspectWithGhidraSeeds(
    selectedPair,
    { path: receipt.path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Cancellation ignored");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(result.error.diagnostics).toMatchObject({
    published_seed_output: receipt,
  });
  await service.close();
});
it("closes both ports and keeps combined cleanup incomplete until both owners resolve", async () => {
  const metadata = new ProviderCleanupError(
      identity.id,
      ["metadata-reader"],
      {},
    ),
    output = new ProviderCleanupError(identity.id, ["seed-output"], {});
  let metadataCloses = 0,
    seedCloses = 0;
  const service = new Il2cppMetadataService(
    {
      identity,
      inspect: async () => ok(report),
      close: async () => {
        metadataCloses++;
        throw metadata;
      },
    },
    seedWriter(
      async () => {
        throw new Error("not used");
      },
      async () => {
        seedCloses++;
        throw output;
      },
    ),
  );
  let combined;
  try {
    await service.close();
  } catch (cause) {
    combined = cause;
  }
  expect(metadataCloses).toBe(1);
  expect(seedCloses).toBe(1);
  expect(combined).toBeInstanceOf(AnalysisError);
  if (!(combined instanceof AnalysisError))
    throw new Error("Missing cleanup failure");
  const failure = combined;
  expect([...failure.cleanupResources].sort()).toEqual([
    "metadata-reader",
    "seed-output",
  ]);
  output.resolveCleanup();
  expect(failure.cleanupIncomplete).toBe(true);
  metadata.resolveCleanup();
  expect(failure.cleanupIncomplete).toBe(false);
});
it.each([
  ["static", null, "derived"],
  ["module array", "code_gen_modules_field", "inferred"],
  ["type table", "types_field", "inferred"],
] as const)(
  "classifies native association confidence (%s)",
  async (_, inferred, confidence) => {
    const value = linkedReport();
    if (inferred !== null) value.binary![inferred] = null;
    const result = await serviceReturning(value).inspect(selectedPair);
    if (!result.ok) throw result.error;
    expect(result.value.confidence).toBe(confidence);
  },
);
