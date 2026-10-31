import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { mkdir, open, readFile, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, expect, it, vi } from "vitest";

import { translateArtifactFailure } from "../../../src/artifacts/ArtifactOperationFailure.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import {
  admitAsarHeader,
  asarHeaderAdmissionRecovery,
} from "../../../src/artifacts/AsarHeader.js";
import { parseEnvironment } from "../../../src/config/environment.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import {
  DEFAULT_ASAR_HEADER_ADMISSION,
  parseAsarHeaderAdmission,
  type AsarHeaderAdmission,
} from "../../../src/config/asarHeaderAdmission.js";
import {
  MAXIMUM_ASAR_MAX_HEADER_BYTES,
  DEFAULT_ASAR_MAX_HEADER_BYTES,
} from "../../../src/domain/analysisResourceLimits.js";
import { ArtifactOperationError } from "../../../src/domain/artifactOperationError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";

const createFixture = async () => {
  const root = await createTestTempDirectory("rea-asar-header-admission-");
  const source = join(root, "source");
  const archive = join(root, "fixture.asar");
  await mkdir(source);
  await writeFile(join(source, "main.js"), "export const answer = 42;\n");
  await createPackage(source, archive);
  return { archive, original: await readFile(archive) };
};

const admit = async (path: string, admission?: AsarHeaderAdmission) => {
  const handle = await open(path, "r");
  const read = vi.spyOn(handle, "read");
  try {
    return await admitAsarHeader(handle, undefined, admission);
  } finally {
    // Admission must inspect only the fixed prefix, even for forged extents.
    const calls = [...read.mock.calls];
    const results = await Promise.all(
      read.mock.results.map(
        ({ value }) => value as Promise<{ readonly bytesRead: number }>,
      ),
    );
    read.mockRestore();
    await handle.close();
    expect(handle.fd).toBe(-1);
    expect(calls.length).toBeGreaterThan(0);
    let filled = 0;
    for (const [index, call] of calls.entries()) {
      const [buffer, offset, length, position]: readonly unknown[] =
        call as unknown as readonly unknown[];
      expect(buffer).toBeInstanceOf(Buffer);
      expect(offset).toBe(filled);
      expect(position).toBe(filled);
      expect(length).toBe(16 - filled);
      filled += results[index]!.bytesRead;
    }
    expect(filled).toBeLessThanOrEqual(16);
  }
};

it("admits a header produced by the upstream ASAR serializer", async () => {
  const { archive, original } = await createFixture();
  await expect(admit(archive)).resolves.toEqual({
    archiveBytes: original.length,
    headerBytes: original.readUInt32LE(4),
    jsonBytes: original.readUInt32LE(12),
  });
  expect(Buffer.compare(await readFile(archive), original)).toBe(0);
});

it("rejects every truncated prefix of a real serialized header", async () => {
  const { archive, original } = await createFixture();
  const headerEnd = 8 + original.readUInt32LE(4);
  for (let length = 0; length < headerEnd; length++) {
    await writeFile(archive, original.subarray(0, length));
    await expect(
      admit(archive),
      `truncated at byte ${length}`,
    ).rejects.toMatchObject({
      reason: "format",
    });
  }
  // Member data is outside header admission; an intact header still passes.
  await writeFile(archive, original.subarray(0, headerEnd));
  await expect(admit(archive)).resolves.toMatchObject({
    archiveBytes: headerEnd,
  });
});

it("rejects contradictory and unsigned-boundary extents before decoding", async () => {
  const { archive, original } = await createFixture();
  const mutations = [
    { offset: 0, values: [0, 1, 3, 5, 0xffffffff] },
    { offset: 4, values: [0, 4, 7, original.length, 0x80000000, 0xffffffff] },
    { offset: 8, values: [0, 1, original.readUInt32LE(8) + 4, 0xffffffff] },
    { offset: 12, values: [original.readUInt32LE(8), 0x80000000, 0xffffffff] },
  ];
  for (const { offset, values } of mutations) {
    for (const value of values) {
      const bytes = Buffer.from(original);
      bytes.writeUInt32LE(value, offset);
      await writeFile(archive, bytes);
      await expect(
        admit(archive),
        `uint32 at ${offset} = ${value}`,
      ).rejects.toMatchObject({
        reason: "format",
      });
    }
  }
});

it("separates the header decode budget from container validity at its exact boundary", async () => {
  const root = await createTestTempDirectory("rea-asar-header-budget-");
  const archive = join(root, "budget.asar");
  expect(DEFAULT_ASAR_MAX_HEADER_BYTES).toBe(16 * 1024 * 1024);
  for (const headerBytes of [
    DEFAULT_ASAR_MAX_HEADER_BYTES,
    DEFAULT_ASAR_MAX_HEADER_BYTES + 4,
  ]) {
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(headerBytes, 4);
    prefix.writeUInt32LE(headerBytes - 4, 8);
    prefix.writeUInt32LE(2, 12);
    await writeFile(archive, prefix);
    // Supply the declared extent without allocating a header-sized JS buffer.
    // This tests extent admission only; the padding is not valid archive JSON.
    await truncate(archive, headerBytes + 8);
    if (headerBytes === DEFAULT_ASAR_MAX_HEADER_BYTES)
      await expect(admit(archive)).resolves.toEqual({
        archiveBytes: headerBytes + 8,
        headerBytes,
        jsonBytes: 2,
      });
    else
      await expect(admit(archive)).rejects.toMatchObject({
        reason: "limit",
        message: asarHeaderAdmissionRecovery(DEFAULT_ASAR_HEADER_ADMISSION),
        admission: {
          kind: "asar-header",
          maximumBytes: DEFAULT_ASAR_MAX_HEADER_BYTES,
          source: "default",
        },
      });
  }
});

const writeOversizedHeaderArchive = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-asar-header-recovery-");
  const archive = join(root, "app.asar");
  const headerBytes = DEFAULT_ASAR_MAX_HEADER_BYTES + 4;
  const json = Buffer.from("{}");
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerBytes, 4);
  prefix.writeUInt32LE(headerBytes - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  await writeFile(archive, Buffer.concat([prefix, json]));
  await truncate(archive, headerBytes + 8);
  return archive;
};

it("names the default header admission budget and its setting when source selection cannot bypass it", async () => {
  const recovery = asarHeaderAdmissionRecovery(DEFAULT_ASAR_HEADER_ADMISSION);
  expect(DEFAULT_ASAR_MAX_HEADER_BYTES).toBe(16 * 1024 * 1024);
  const archive = await writeOversizedHeaderArchive();
  let inventoryFailure: unknown;
  try {
    await inventoryArtifact(archive);
  } catch (cause: unknown) {
    inventoryFailure = cause;
  }
  expect(inventoryFailure).toBeInstanceOf(ArtifactReaderFailure);
  if (!(inventoryFailure instanceof ArtifactReaderFailure))
    throw new Error("inventory failure was not an artifact reader failure");
  expect(inventoryFailure.cleanup).toBeUndefined();
  const wrapped = ArtifactReaderFailure.withCleanup(inventoryFailure, {
    reason: "close failed",
    resources: ["header"],
  });
  expect(wrapped.message).toBe(recovery);
  expect(wrapped.admission).toEqual(inventoryFailure.admission);
  const inventory = projectAnalysisError(
    translateArtifactFailure("inventory_artifact", inventoryFailure),
  );
  expect(inventory).toMatchObject({
    code: "truncated",
    message: recovery,
    remediation: { action: recovery },
    details: {
      reason: "limit",
      truncated: true,
      detail: recovery,
      admission: "asar-header",
      maximum_header_bytes: DEFAULT_ASAR_MAX_HEADER_BYTES,
      maximum_header_bytes_source: "default",
      setting: "REA_ASAR_MAX_HEADER_BYTES",
      limit: {
        setting: "asar.max_header_bytes",
        effective_value: DEFAULT_ASAR_MAX_HEADER_BYTES,
        unit: "bytes",
        minimum: 1,
        maximum: MAXIMUM_ASAR_MAX_HEADER_BYTES,
        source: "default",
        applies_at: "next_operation",
        agent_editable: true,
        scope: "rea-runtime",
        rea_restart_required: false,
      },
    },
  });
  expect(
    projectAnalysisError(translateArtifactFailure("inspect_artifact", wrapped))
      .message,
  ).toBe(recovery);

  const selected = await analyzeJavaScriptApplication({
    input_path: archive,
    source_paths: ["package.json"],
    max_heap_mb: 2048,
  });
  const unselected = await analyzeJavaScriptApplication({
    input_path: archive,
  });
  if (selected.ok || unselected.ok)
    throw new Error("ASAR header admission succeeded");
  expect(projectAnalysisError(selected.error).message).toBe(recovery);
  expect(projectAnalysisError(unselected.error).message).toBe(recovery);
  for (const failure of [selected.error, unselected.error])
    expect(projectAnalysisError(failure).details?.limit).toEqual(
      inventory.details?.limit,
    );
  expect(projectAnalysisError(selected.error).remediation.action).toBe(
    recovery,
  );
});

it("keeps unrelated artifact limit recovery distinct from header admission", () => {
  expect(
    projectAnalysisError(
      new ArtifactOperationError(
        "inventory_artifact",
        "limit",
        undefined,
        "Directory traversal reached its examined-entry budget",
      ),
    ).message,
  ).toBe("Directory traversal reached its examined-entry budget");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("admits a header above the default when the selected admission raises the budget", async () => {
  const archive = await writeOversizedHeaderArchive();
  const headerBytes = DEFAULT_ASAR_MAX_HEADER_BYTES + 4;
  await expect(
    admit(archive, { maximumBytes: headerBytes - 1, source: "setting" }),
  ).rejects.toMatchObject({
    reason: "limit",
    admission: { maximumBytes: headerBytes - 1, source: "setting" },
  });
  await expect(
    admit(archive, { maximumBytes: headerBytes, source: "setting" }),
  ).resolves.toEqual({
    archiveBytes: headerBytes + 8,
    headerBytes,
    jsonBytes: 2,
  });
});

it("applies the caller-selected environment, not the ambient one, to inventory and JavaScript analysis", async () => {
  const { archive, original } = await createFixture();
  const headerBytes = original.readUInt32LE(4);
  const lowered = { REA_ASAR_MAX_HEADER_BYTES: String(headerBytes - 1) };
  const recovery = asarHeaderAdmissionRecovery({
    maximumBytes: headerBytes - 1,
    source: "setting",
  });
  // An ambient value that would refuse the archive must not reach callers
  // whose selected environment leaves the setting unset.
  vi.stubEnv("REA_ASAR_MAX_HEADER_BYTES", "1");
  for (const operation of ["inventory_artifact", "inspect_artifact"] as const) {
    await expect(
      createDirectAnalysis(lowered)
        .runProviderAnalysis(archive, operation, {})
        .then(projectCliAnalysisResult),
    ).resolves.toMatchObject({
      code: "truncated",
      message: recovery,
      details: {
        maximum_header_bytes: headerBytes - 1,
        maximum_header_bytes_source: "setting",
        setting: "REA_ASAR_MAX_HEADER_BYTES",
      },
    });
    await expect(
      createDirectAnalysis({})
        .runProviderAnalysis(archive, operation, {})
        .then(projectCliAnalysisResult),
    ).resolves.toMatchObject({ operation });
  }
  const refused = await analyzeJavaScriptApplication(
    { input_path: archive },
    { environment: lowered },
  );
  if (refused.ok) throw new Error("Lowered ASAR header admission succeeded");
  expect(projectAnalysisError(refused.error).message).toBe(recovery);
  const admitted = await analyzeJavaScriptApplication(
    { input_path: archive },
    { environment: { REA_ASAR_MAX_HEADER_BYTES: String(headerBytes) } },
  );
  expect(admitted.ok).toBe(true);
  expect((await analyzeJavaScriptApplication({ input_path: archive })).ok).toBe(
    true,
  );
});

it("refuses invalid settings at startup validation and at each owner", async () => {
  expect(parseAsarHeaderAdmission(undefined)).toEqual({
    ok: true,
    value: DEFAULT_ASAR_HEADER_ADMISSION,
  });
  expect(
    parseAsarHeaderAdmission(String(MAXIMUM_ASAR_MAX_HEADER_BYTES)),
  ).toEqual({
    ok: true,
    value: { maximumBytes: MAXIMUM_ASAR_MAX_HEADER_BYTES, source: "setting" },
  });
  for (const value of [
    "",
    "0",
    "-1",
    "016777216",
    "16MiB",
    "1e6",
    " 16777216",
    String(MAXIMUM_ASAR_MAX_HEADER_BYTES + 1),
  ]) {
    const parsed = parseAsarHeaderAdmission(value);
    if (parsed.ok) throw new Error(`Accepted ${JSON.stringify(value)}`);
    expect(parsed.error.settings).toEqual([
      {
        setting: "REA_ASAR_MAX_HEADER_BYTES",
        constraint: expect.stringContaining("at most 268435456 bytes"),
      },
    ]);
    const startup = parseEnvironment({ REA_ASAR_MAX_HEADER_BYTES: value });
    if (startup.ok)
      throw new Error(`Startup accepted ${JSON.stringify(value)}`);
    expect(startup.error.settings).toContainEqual({
      setting: "REA_ASAR_MAX_HEADER_BYTES",
      constraint: expect.stringContaining("at most 268435456 bytes"),
    });
  }

  // Owners refuse rather than falling back to the default.
  const { archive } = await createFixture();
  const invalid = { REA_ASAR_MAX_HEADER_BYTES: "0" };
  await expect(
    createDirectAnalysis(invalid)
      .runProviderAnalysis(archive, "inventory_artifact", {})
      .then(projectCliAnalysisResult),
  ).resolves.toMatchObject({ code: "configuration_invalid" });
  const analyzed = await analyzeJavaScriptApplication(
    { input_path: archive },
    { environment: invalid },
  );
  if (analyzed.ok) throw new Error("Invalid setting was ignored");
  expect(projectAnalysisError(analyzed.error)).toMatchObject({
    code: "configuration_invalid",
  });
});
