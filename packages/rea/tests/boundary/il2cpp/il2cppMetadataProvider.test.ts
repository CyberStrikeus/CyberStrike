import { setImmediate } from "node:timers/promises";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { Il2cppMetadataProvider } from "../../../src/il2cpp/Il2cppMetadataProvider.js";
import { Il2cppGhidraSeedWriter } from "../../../src/il2cpp/Il2cppGhidraSeedWriter.js";
import { Il2cppMetadataService } from "../../../src/application/il2cpp/Il2cppMetadataService.js";
import { il2cppMetadataSchema } from "../../../src/domain/il2cpp/il2cppMetadata.js";
import {
  createElfFixture,
  createIl2cppBinaryFixture,
  FIXTURE_GENERIC_INSTANCES,
} from "../../fixtures/il2cpp/binary.js";
import {
  createIl2cppMetadataFixture,
  createLinkedIl2cppMetadataFixture,
} from "../../fixtures/il2cpp/metadata.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** One-shot inspections keep the real reader's cleanup at one test boundary. */
const inspectMetadata = async (path: string, limit?: number) => {
  const provider = new Il2cppMetadataProvider(limit);
  try {
    return await provider.inspect({ path });
  } finally {
    await provider.close();
  }
};

/** Version 29 file whose methods all share one long name. */
const sharedNameMetadata = (
  nameBytes: number | Buffer,
  methods: number,
  fill = 0x41,
) => {
  const encoded = Buffer.isBuffer(nameBytes)
    ? nameBytes
    : Buffer.alloc(nameBytes, fill);
  const name = Buffer.concat([encoded, Buffer.from([0])]);
  const records = Buffer.alloc(methods * 32);
  for (let index = 0; index < methods; index += 1)
    records.writeInt32LE(-1, index * 32 + 4);
  const header = Buffer.alloc(256);
  header.writeUInt32LE(0xfab11baf, 0);
  header.writeInt32LE(29, 4);
  let cursor = 256;
  for (let section = 0; section < 31; section += 1) {
    // strings is section 2 and methods is section 5.
    const content = section === 2 ? name : section === 5 ? records : undefined;
    header.writeInt32LE(cursor, 8 + section * 8);
    header.writeInt32LE(content?.length ?? 0, 12 + section * 8);
    cursor += content?.length ?? 0;
  }
  return Buffer.concat([header, name, records]);
};

/** Fixed-width metadata whose literals share one span; no target code is involved. */
const sharedLiteralMetadata = (literalBytes: Buffer, count: number) => {
  const header = Buffer.alloc(256),
    records = Buffer.alloc(count * 8);
  header.writeUInt32LE(0xfab11baf, 0);
  header.writeInt32LE(29, 4);
  for (let i = 0; i < count; i++)
    records.writeUInt32LE(literalBytes.length, i * 8);
  let cursor = 256;
  for (let section = 0; section < 31; section++) {
    const size =
      section === 0 ? records.length : section === 1 ? literalBytes.length : 0;
    header.writeInt32LE(cursor, 8 + section * 8);
    header.writeInt32LE(size, 12 + section * 8);
    cursor += size;
  }
  return Buffer.concat([header, records, literalBytes]);
};

it("bounds repeated literal output during decoding and reuses one span instead of allocating every repetition", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-literals-");
  const path = join(root, "global-metadata.dat");
  await writeFile(path, sharedLiteralMetadata(Buffer.alloc(4096, 65), 20));
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  const result = await inspectMetadata(path, 12_000);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expanded literals accepted");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error.partialObservation).toMatchObject({
    normalized_result: {
      validated_section_row_counts: { string_literals: 20 },
    },
  });
  expect(
    decode.mock.calls.filter(([bytes]) => bytes?.byteLength === 4096),
  ).toHaveLength(1);
});

it("refuses raw literal expansion before decoding and admits invalid UTF-8 only when base64 fits", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-literal-forms-");
  const path = join(root, "global-metadata.dat");
  const decode = vi.spyOn(TextDecoder.prototype, "decode");
  for (const [bytes, limit, expectedDecodes] of [
    [Buffer.alloc(4096, 65), 1024, 0],
    [Buffer.alloc(2048, 255), 2400, 1],
  ] as const) {
    decode.mockClear();
    await writeFile(path, sharedLiteralMetadata(bytes, 1));
    const result = await inspectMetadata(path, limit);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(
      decode.mock.calls.filter(([value]) => value?.byteLength === bytes.length),
    ).toHaveLength(expectedDecodes);
  }
});

it("counts an unclaimed parameter table before allocating any member rows", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-member-counts-");
  const path = join(root, "global-metadata.dat");
  const fixture = createIl2cppMetadataFixture({
    wide: { fillerTypes: 0, genericContainers: 0, parameters: 2000 },
  });
  const bytes = Buffer.from(fixture.bytes);
  bytes.writeInt32LE(0x7fffffff, fixture.section("parameters").offset);
  await writeFile(path, bytes);
  const result = await inspectMetadata(path, 4096);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
});

it.each([
  {
    name: "shared-name row lower bound",
    bytes: () => sharedNameMetadata(65_536, 1_100),
    limit: undefined,
  },
  {
    name: "JSON escaping",
    bytes: () => sharedNameMetadata(4096, 1, 0x01),
    limit: 8192,
  },
  {
    name: "UTF-8 expansion",
    bytes: () => sharedNameMetadata(Buffer.from("雪".repeat(4096)), 1),
    limit: 8192,
  },
])(
  "refuses $name before allocating serialized text",
  async ({ bytes, limit }) => {
    const root = await createTestTempDirectory("rea-il2cpp-text-budget-");
    const path = join(root, "global-metadata.dat");
    await writeFile(path, bytes());
    const stringify = vi.spyOn(JSON, "stringify");
    const result = await inspectMetadata(path, limit);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(
      stringify.mock.calls.some(
        ([value]) =>
          (typeof value === "string" && value.length >= 4096) ||
          (typeof value === "object" && value !== null && "methods" in value),
      ),
    ).toBe(false);
  },
);

it("admits a report whose escaped names fit the budget exactly", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-provider-fit-");
  const path = join(root, "global-metadata.dat");
  await writeFile(path, sharedNameMetadata(4096, 1, 0x01));
  const unbounded = new Il2cppMetadataProvider();
  let bytes: number;
  try {
    const result = await unbounded.inspect({ path });
    if (!result.ok) throw result.error;
    expect(result.value.methods[0]?.name).toBe("".repeat(4096));
    bytes = Buffer.byteLength(JSON.stringify(result.value));
  } finally {
    await unbounded.close();
  }
  const exact = new Il2cppMetadataProvider(bytes);
  try {
    expect((await exact.inspect({ path })).ok).toBe(true);
  } finally {
    await exact.close();
  }
});

it("keeps observed source facts with a complete-report refusal", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-report-evidence-");
  const path = join(root, "global-metadata.dat");
  const bytes = createIl2cppMetadataFixture().bytes;
  await writeFile(path, bytes);
  const result = await inspectMetadata(path, 256);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected report allowance refusal");
  expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
  expect(result.error.partialObservation).toMatchObject({
    operation: "observe_il2cpp_metadata_source",
    normalized_result: {
      artifact: {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
      inventory_status: "not-returned-as-complete",
    },
  });
  const projected = projectAnalysisError(result.error);
  expect(projected.retryable).toBe(false);
  expect(projected.code).toBe("resource_constraint");
  expect(projected.remediation.action).toContain(
    "No complete metadata inventory is retained",
  );
  expect(projected.remediation.action).toContain(
    "Source facts already observed stay with this refusal",
  );
  expect(projected.remediation.action).not.toMatch(
    /does not leave a completed report or Evidence record/u,
  );
  expect(projected.remediation.action).not.toMatch(/worker memory/u);
});

it("refuses from row counts before decoding any row", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-provider-counts-");
  const path = join(root, "global-metadata.dat");
  // A broken method name would fail as invalid-string if rows were decoded.
  const fixture = createIl2cppMetadataFixture();
  const bytes = Buffer.from(fixture.bytes);
  bytes.writeInt32LE(0x7fff, fixture.record("methods", 0));
  await writeFile(path, bytes);
  const result = await inspectMetadata(path, 256);
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
});

it.each([
  { requested: "cancel during metadata decoding" },
  new AnalysisResourceConstraintError(
    "caller-selected-reason",
    "memory",
    "Caller cancellation reason",
    {},
  ),
])(
  "accepts cancellation during decoded batches with exact reason %j",
  async (reason) => {
    const root = await createTestTempDirectory("rea-il2cpp-provider-cancel-");
    const path = join(root, "global-metadata.dat");
    const bytes = sharedNameMetadata(1, 100_000);
    await writeFile(path, bytes);
    const controller = new AbortController();
    let batches = 0;
    const provider = new Il2cppMetadataProvider(undefined, async () => {
      await setImmediate();
      if (++batches === 3) controller.abort(reason);
    });
    try {
      const result = await provider.inspect(
        { path },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected cancellation");
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(reason);
      expect(batches).toBe(3);
      expect(result.error.partialObservation).toMatchObject({
        operation: "observe_il2cpp_metadata_source",
        normalized_result: {
          artifact: {
            path,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
          },
          inventory_status: "not-returned-as-complete",
          validated_section_row_counts: {
            images: 0,
            types: 0,
            methods: 100_000,
          },
        },
      });
      const replacement = createIl2cppMetadataFixture();
      await writeFile(path, replacement.bytes);
      const next = await provider.inspect({ path });
      if (!next.ok) throw next.error;
      expect(next.value.artifact.sha256).toBe(
        createHash("sha256").update(replacement.bytes).digest("hex"),
      );
      expect(next.value.methods).toHaveLength(5);
    } finally {
      await provider.close();
    }
  },
);

it("bounds concurrent snapshots and retains active decoding until close completes", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-provider-close-");
  const path = join(root, "global-metadata.dat");
  await writeFile(path, createIl2cppMetadataFixture().bytes);
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let resume!: () => void;
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const provider = new Il2cppMetadataProvider(undefined, () => {
    markEntered();
    return release;
  });
  const active = provider.inspect({ path });
  let closed = false;
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered, active, "metadata decoding");
    closing = provider.close().then(() => {
      closed = true;
    });
    const refused = await provider.inspect({ path });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
      expect(projectAnalysisError(refused.error)).toMatchObject({
        code: "capability_unavailable",
        retryable: false,
        details: { reason: "IL2CPP metadata reader is closed" },
      });
      expect(
        projectAnalysisError(refused.error).remediation.action,
      ).not.toMatch(/retry/i);
    }
    await setImmediate();
    expect(closed).toBe(false);
    resume();
    await closing;
    expect((await active).ok).toBe(true);
    expect(closed).toBe(true);
    const afterClose = await provider.inspect({ path });
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) {
      expect(afterClose.error).toBeInstanceOf(
        AnalysisCapabilityUnavailableError,
      );
      expect(projectAnalysisError(afterClose.error).retryable).toBe(false);
    }
  }, [
    resume,
    async () => {
      await closing;
    },
    async () => {
      await active;
    },
    async () => {
      await provider.close();
    },
  ]);
});

it("keeps occupied capacity retryable while the reader remains open", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-provider-occupied-");
  const path = join(root, "global-metadata.dat");
  await writeFile(path, createIl2cppMetadataFixture().bytes);
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let resume!: () => void;
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const provider = new Il2cppMetadataProvider(undefined, () => {
    markEntered();
    return release;
  });
  const active = provider.inspect({ path });
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered, active, "metadata decoding");
    const refused = await provider.inspect({ path });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toBeInstanceOf(AnalysisResourceConstraintError);
      expect(projectAnalysisError(refused.error)).toMatchObject({
        retryable: true,
        details: {
          resource: "capacity",
          reported_limits: { maximum_concurrent_inspections: 1 },
        },
        remediation: {
          action: expect.stringContaining("active IL2CPP metadata inspection"),
        },
      });
    }
  }, [
    resume,
    async () => {
      await active;
    },
    async () => {
      await provider.close();
    },
  ]);
});

it.each([false, true])(
  "keeps an independent failure with shared cancellation reason: %s",
  async (sharedReason) => {
    const root = await createTestTempDirectory("rea-il2cpp-failure-cancel-");
    const path = join(root, "global-metadata.dat");
    await writeFile(path, createIl2cppMetadataFixture().bytes);
    const controller = new AbortController();
    const failure = Object.assign(
      new Error("independent scheduler I/O failure"),
      { code: "EIO" },
    );
    const provider = new Il2cppMetadataProvider(undefined, () => {
      controller.abort(sharedReason ? failure : "separate caller cancellation");
      return Promise.reject(failure);
    });
    try {
      const result = await provider.inspect(
        { path },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected the independent failure");
      expect(result.error).not.toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(failure);
    } finally {
      await provider.close();
    }
  },
);

it("retains the exact empty source observation without claiming a decoded inventory", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-empty-");
  const path = join(root, "empty.dat");
  await writeFile(path, Buffer.alloc(0));
  const result = await inspectMetadata(path);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected unsupported empty metadata");
  expect(result.error.message).toContain("unrecognized-magic");
  expect(result.error.partialObservation).toMatchObject({
    operation: "observe_il2cpp_metadata_source",
    normalized_result: {
      artifact: {
        path,
        bytes: 0,
        sha256: createHash("sha256").digest("hex"),
      },
      inventory_status: "not-returned-as-complete",
    },
  });
});

it("retains the exact source when recognized magic has no complete version", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-short-prefix-");
  const path = join(root, "global-metadata.dat");
  const bytes = Buffer.alloc(7);
  bytes.writeUInt32LE(0xfab11baf, 0);
  await writeFile(path, bytes);
  const result = await inspectMetadata(path);

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected truncated metadata prefix");
  expect(result.error).toMatchObject({
    _tag: "AnalysisInputError",
    issues: [
      {
        path: ["path"],
        reason: "invalid_format",
        message: expect.stringMatching(
          /truncated-header:.*metadata version is unknown/u,
        ),
      },
    ],
  });
  expect(result.error.partialObservation).toMatchObject({
    operation: "observe_il2cpp_metadata_source",
    normalized_result: {
      artifact: {
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      inventory_status: "not-returned-as-complete",
    },
  });
});

it("keeps the metadata source observation when the selected binary does not link", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-binary-failure-");
  const path = join(root, "global-metadata.dat");
  const binaryPath = join(root, "GameAssembly.dll");
  const fixture = createLinkedIl2cppMetadataFixture();
  await writeFile(path, fixture.bytes);
  await writeFile(binaryPath, Buffer.from("not a native image"));
  const provider = new Il2cppMetadataProvider();
  try {
    const result = await provider.inspect({ path, binary_path: binaryPath });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the binary to be refused");
    expect(result.error.partialObservation).toMatchObject({
      operation: "observe_il2cpp_metadata_source",
      normalized_result: {
        artifact: {
          path,
          sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
          bytes: fixture.bytes.length,
        },
        inventory_status: "not-returned-as-complete",
      },
    });
  } finally {
    await provider.close();
  }
});

it("accepts cancellation between binary linking batches and keeps the metadata source", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-link-cancel-");
  const path = join(root, "global-metadata.dat");
  const binaryPath = join(root, "libil2cpp.so");
  const fixture = createLinkedIl2cppMetadataFixture();
  await writeFile(path, fixture.bytes);
  await writeFile(binaryPath, createElfFixture(createIl2cppBinaryFixture()));
  // Yields taken by the metadata decode alone; later ones belong to linking.
  let decodeYields = 0;
  const counting = new Il2cppMetadataProvider(undefined, async () => {
    decodeYields++;
  });
  try {
    expect((await counting.inspect({ path })).ok).toBe(true);
  } finally {
    await counting.close();
  }
  const controller = new AbortController();
  const reason = new Error("stop linking");
  let yields = 0;
  const provider = new Il2cppMetadataProvider(undefined, async () => {
    if (++yields === decodeYields + 2) controller.abort(reason);
  });
  try {
    const result = await provider.inspect(
      { path, binary_path: binaryPath },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(yields).toBe(decodeYields + 2);
    expect(result.error.partialObservation).toMatchObject({
      operation: "observe_il2cpp_metadata_source",
      normalized_result: { artifact: { path } },
    });
  } finally {
    await provider.close();
  }
});

it("refuses duplicate MethodDef tokens before publishing linked Evidence or Ghidra seeds", async () => {
  const root = await createTestTempDirectory(
    "rea-il2cpp-duplicate-method-token-",
  );
  const path = join(root, "global-metadata.dat");
  const binaryPath = join(root, "GameAssembly.dylib");
  const duplicateSeeds = join(root, "duplicate.tsv");
  const foldedSeeds = join(root, "folded.tsv");
  const fixture = createLinkedIl2cppMetadataFixture({ version: 31 });
  const duplicate = Buffer.from(fixture.bytes);
  const firstTokenAt = fixture.record("methods", 0) + 24;
  const secondTokenAt = fixture.record("methods", 1) + 24;
  duplicate.writeUInt32LE(duplicate.readUInt32LE(firstTokenAt), secondTokenAt);
  await writeFile(path, duplicate);
  await writeFile(binaryPath, createIl2cppBinaryFixture());

  const service = new Il2cppMetadataService(
    new Il2cppMetadataProvider(),
    new Il2cppGhidraSeedWriter(),
  );
  try {
    const refused = await service.inspectWithGhidraSeeds(
      { path, binary_path: binaryPath, detail: "complete" },
      { path: duplicateSeeds },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok)
      throw new Error("Duplicate MethodDef identity was accepted");
    if (!(refused.error instanceof AnalysisInputError))
      throw new Error("Duplicate MethodDef identity was not an input refusal");
    expect(refused.error.issues[0]?.message).toContain("invalid-method-token");
    expect(refused.error.issues[0]?.message).toContain("share MethodDef token");
    expect(refused.error.partialObservation).toMatchObject({
      normalized_result: { artifact: { path } },
    });
    await expect(readFile(duplicateSeeds)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const foldedBinary = createIl2cppBinaryFixture();
    foldedBinary.writeBigUInt64LE(foldedBinary.readBigUInt64LE(0x308), 0x300);
    await writeFile(path, fixture.bytes);
    await writeFile(binaryPath, foldedBinary);
    const accepted = await service.inspectWithGhidraSeeds(
      { path, binary_path: binaryPath, detail: "complete" },
      { path: foldedSeeds },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw accepted.error;
    const result = il2cppMetadataSchema.parse(accepted.value.normalized_result);
    expect(result.method_addresses[0]?.address).toBe(
      result.method_addresses[1]?.address,
    );
    expect(await readFile(foldedSeeds, "utf8")).toContain("# folded");
  } finally {
    await service.close();
  }
});

it("retains both observed file identities and the selected architecture when native linking fails", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-failed-pair-");
  const path = join(root, "global-metadata.dat"),
    binary_path = join(root, "GameAssembly.dylib");
  const bytes = createIl2cppBinaryFixture({ codeRegistration: false });
  await writeFile(path, createLinkedIl2cppMetadataFixture().bytes);
  await writeFile(binary_path, bytes);
  const provider = new Il2cppMetadataProvider();
  try {
    const result = await provider.inspect({ path, binary_path });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Unresolved registration accepted");
    expect(result.error.partialObservation).toMatchObject({
      normalized_result: {
        artifact: { path },
        selected_binary: {
          path: binary_path,
          identity_status: "observed",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        },
      },
    });
  } finally {
    await provider.close();
  }
});

it.each([
  {
    architecture: "x86-64",
    name: "libil2cpp.so",
    binary: () =>
      createElfFixture(
        createIl2cppBinaryFixture({
          codeRegistration: false,
          codeReference: true,
        }),
        { machine: 62 },
      ),
    named: "RIP-relative LEA/MOV",
    absent: "ADRP+ADD",
  },
  {
    architecture: "arm64",
    name: "GameAssembly.dylib",
    binary: () =>
      createIl2cppBinaryFixture({
        codeRegistration: false,
        adrpAdd: [[0xc00, 0x500]],
      }),
    named: "ADRP+ADD",
    absent: "RIP-relative LEA/MOV",
  },
])(
  "names the $architecture instruction form behind an inferred module array",
  async ({ name, binary, named, absent }) => {
    const root = await createTestTempDirectory("rea-il2cpp-inferred-form-");
    const path = join(root, "global-metadata.dat"),
      binary_path = join(root, name);
    await writeFile(path, createLinkedIl2cppMetadataFixture().bytes);
    await writeFile(binary_path, binary());
    const provider = new Il2cppMetadataProvider();
    try {
      const result = await provider.inspect({ path, binary_path });
      if (!result.ok) throw result.error;
      const inferred = result.value.limitations.filter((line) =>
        line.includes("static CodeRegistration pair was not resolved"),
      );
      expect(inferred).toHaveLength(1);
      expect(inferred[0]).toContain(named);
      expect(inferred[0]).not.toContain(absent);
    } finally {
      await provider.close();
    }
  },
);

it("states that an inferred type table's count is a run length", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-inferred-types-");
  const path = join(root, "global-metadata.dat"),
    binary_path = join(root, "GameAssembly.dylib");
  // A field typed as type 3 makes the metadata reference the whole
  // four-entry table, as real builds reference most of theirs.
  const fixture = createLinkedIl2cppMetadataFixture();
  const metadata = Buffer.from(fixture.bytes);
  metadata.writeUInt8(3, fixture.section("fields").offset + 4);
  await writeFile(path, metadata);
  await writeFile(
    binary_path,
    createIl2cppBinaryFixture({
      metadataRegistration: false,
      adrpAdd: [[0xc20, 0x900]],
    }),
  );
  const provider = new Il2cppMetadataProvider();
  try {
    const result = await provider.inspect({ path, binary_path });
    if (!result.ok) throw result.error;
    expect(result.value.binary).toMatchObject({
      types_field: null,
      types_count: 4,
      code_gen_modules_field: expect.any(String),
    });
    const inferred = result.value.limitations.filter((line) =>
      line.includes(
        "No static MetadataRegistration had the type-definition counts",
      ),
    );
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toContain("ADRP+ADD");
    expect(
      result.value.limitations.some((line) =>
        line.includes("static CodeRegistration pair was not resolved"),
      ),
    ).toBe(false);
  } finally {
    await provider.close();
  }
});

it("reports generic method instances only when generic_instances is set", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-provider-generic-");
  const path = join(root, "global-metadata.dat");
  const binaryPath = join(root, "GameAssembly.dylib");
  await writeFile(
    path,
    createIl2cppMetadataFixture({ version: 31, genericOwners: true }).bytes,
  );
  await writeFile(
    binaryPath,
    createIl2cppBinaryFixture({ genericMethods: {} }),
  );
  const provider = new Il2cppMetadataProvider();
  try {
    const plain = await provider.inspect({ path, binary_path: binaryPath });
    if (!plain.ok) throw plain.error;
    // Not requested is unknown, not an empty table.
    expect(plain.value.generic_method_instances).toBeNull();
    expect(plain.value.binary?.generic_methods).toBeNull();
    const result = await provider.inspect({
      path,
      binary_path: binaryPath,
      generic_instances: true,
    });
    if (!result.ok) throw result.error;
    expect(result.value.binary?.generic_methods).toEqual({
      generic_method_pointers_field: "0x1000005a8",
      generic_method_pointers_count: 3,
      generic_method_table: "0x100000bc0",
      generic_method_table_count: 3,
      generic_method_table_stride: 16,
      method_specs_count: 3,
      generic_insts_count: 2,
      issues: [],
    });
    expect(result.value.generic_method_instances).toEqual(
      FIXTURE_GENERIC_INSTANCES,
    );
  } finally {
    await provider.close();
  }
});

it("names the metadata, not the binary, when linking reads a malformed metadata name", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-link-metadata-name-");
  const path = join(root, "global-metadata.dat"),
    binaryPath = join(root, "GameAssembly.dylib");
  const fixture = createLinkedIl2cppMetadataFixture({ version: 39 });
  // One generic parameter whose name index points past the string table;
  // only native linking reads it, through a field typed as that parameter.
  const parameterAt = fixture.bytes.length;
  const metadata = Buffer.concat([fixture.bytes, Buffer.alloc(13)]);
  metadata.writeInt32LE(fixture.section("strings").size, parameterAt + 1);
  metadata.writeInt32LE(parameterAt, 8 + 12 * 12);
  metadata.writeInt32LE(13, 8 + 12 * 12 + 4);
  metadata.writeInt32LE(1, 8 + 12 * 12 + 8);
  metadata.writeUInt8(3, fixture.section("fields").offset + 4);
  const binary = Buffer.from(createIl2cppBinaryFixture());
  binary.writeBigUInt64LE(0n, 0x980 + 48);
  binary.writeUInt32LE(0x13 << 16, 0x980 + 48 + 8);
  await writeFile(path, metadata);
  await writeFile(binaryPath, binary);
  const provider = new Il2cppMetadataProvider();
  try {
    const result = await provider.inspect({ path, binary_path: binaryPath });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the metadata name to be refused");
    expect(result.error).toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["path"],
          reason: "invalid_format",
          message: expect.stringContaining(
            `Selected artifact ${path} is corrupt: invalid-string:`,
          ),
        },
      ],
    });

    const corrected = Buffer.from(metadata);
    corrected.writeInt32LE(
      fixture.stringOffset("Player") - fixture.section("strings").offset,
      parameterAt + 1,
    );
    await writeFile(path, corrected);
    expect((await provider.inspect({ path, binary_path: binaryPath })).ok).toBe(
      true,
    );
  } finally {
    await provider.close();
  }
});

it("refuses generic rows that exceed the report budget and keeps the requested pair", async () => {
  const root = await createTestTempDirectory("rea-il2cpp-generic-budget-");
  const path = join(root, "global-metadata.dat");
  const binary_path = join(root, "GameAssembly.dylib");
  await writeFile(
    path,
    createIl2cppMetadataFixture({ version: 31, genericOwners: true }).bytes,
  );
  await writeFile(
    binary_path,
    createIl2cppBinaryFixture({ genericMethods: {} }),
  );
  // Budget the exact plain link: it fits, and the generic rows cannot.
  const plain = new Il2cppMetadataProvider();
  let limit: number;
  try {
    const linked = await plain.inspect({ path, binary_path });
    if (!linked.ok) throw linked.error;
    limit = Buffer.byteLength(JSON.stringify(linked.value)) + 64;
  } finally {
    await plain.close();
  }
  const provider = new Il2cppMetadataProvider(limit);
  try {
    expect((await provider.inspect({ path, binary_path })).ok).toBe(true);
    const result = await provider.inspect({
      path,
      binary_path,
      generic_instances: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected report allowance refusal");
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    expect(result.error.partialObservation).toMatchObject({
      operation: "observe_il2cpp_metadata_source",
      parameters: { binary_path, generic_instances: true },
      normalized_result: { selected_binary: { path: binary_path } },
    });
  } finally {
    await provider.close();
  }
});
