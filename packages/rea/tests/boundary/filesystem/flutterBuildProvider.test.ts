import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { createReadStream } from "node:fs";
import {
  open,
  readFile,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it, onTestFinished, vi } from "vitest";

import {
  aotFixtureImage,
  engineFixtureImage,
  buildElf64Image,
  REFERENCE_HASH,
  snapshotSection,
} from "../../../src/flutter/FlutterBuild.fixture.js";
import { FlutterBuildProvider } from "../../../src/flutter/FlutterBuildProvider.js";
import { FlutterBuildAnalysisService } from "../../../src/application/flutter/FlutterBuildAnalysisService.js";
import { finishAnalysisCommand } from "../../../src/cli/finishAnalysisCommand.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import {
  flutterResultSchemas,
  type FlutterOperation,
} from "../../../src/domain/flutter/flutterBuildAnalysis.js";
import { ZipArtifactReader } from "../../../src/artifacts/ZipArtifactReader.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import {
  createFlutterApk as buildApk,
  createDuplicateFlutterApk,
} from "../../fixtures/flutterApk.js";
import * as regularFile from "../../../src/filesystem/RegularFile.js";
import * as fsPromises from "node:fs/promises";
import * as dartElf from "../../../src/flutter/DartElf.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, createReadStream: vi.fn(original.createReadStream) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original };
});

const buildIdNote = (): Buffer =>
  Buffer.concat([
    Buffer.from([4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0]),
    Buffer.from([
      0xe8, 0xd9, 0x07, 0xef, 0x7c, 0x17, 0x5e, 0xc4, 0x31, 0x3f, 0x47, 0x11,
      0x10, 0x19, 0xad, 0xc9, 0x58, 0x8c, 0x5f, 0x61,
    ]),
  ]);

const TOOLCHAIN_LINE =
  "Android (5900059 based on r365631c) clang version 9.0.8 (based on LLVM 9.0.8svn)";

const libapp = aotFixtureImage;

const libflutter = (): Buffer =>
  engineFixtureImage({ notes: buildIdNote(), labels: [TOOLCHAIN_LINE] });

/**
 * Self-contained Dart AOT image: a synthetic ELF64 carrying the four
 * snapshot symbols, two snapshot sections, and a string pool, so goldens
 * do not depend on any file outside the repository.
 */
const aotImage = aotFixtureImage;

/** Two data symbols at one offset and size: aliased exports. */
const aliasedDataImage = (): Buffer => {
  const elf = buildElf64Image([
    { name: "_kDartVmSnapshotData", value: 0x1000, size: 52 },
    { name: "_kDartIsolateSnapshotData", value: 0x1000, size: 52 },
  ]);
  return Buffer.concat([
    elf,
    Buffer.alloc(0x1000 - elf.length),
    snapshotSection(REFERENCE_HASH),
  ]);
};

/** Two data symbols whose snapshot hashes disagree. */
const conflictingHashImage = (): Buffer => {
  const elf = buildElf64Image([
    { name: "_kDartVmSnapshotData", value: 0x1000, size: 52 },
    { name: "_kDartIsolateSnapshotData", value: 0x1200, size: 52 },
  ]);
  const vm = snapshotSection("11111111111111111111111111111111");
  const isolate = snapshotSection("22222222222222222222222222222222");
  return Buffer.concat([
    elf,
    Buffer.alloc(0x1000 - elf.length),
    vm,
    Buffer.alloc(0x1200 - 0x1000 - vm.length),
    isolate,
  ]);
};

const analyzeImage = async (bytes: Buffer, operation: FlutterOperation) => {
  const path = await buildApk("image.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes },
    { path: "lib/arm64-v8a/libflutter.so", bytes: libflutter() },
  ]);
  const provider = new FlutterBuildProvider();
  onTestFinished(() => provider.close());
  const result = await provider.execute({ operation, input: { path } });
  if (!result.ok) throw result.error;
  return result.value;
};

it.each([false, true])(
  "qualifies unified snapshot exports without aliasing legacy sources (text=%s)",
  async (includeText) => {
    const symbols = [
      { name: "_kDartSnapshotData", value: 0x1000, size: 52 },
      ...(includeText
        ? [{ name: "_kDartSnapshotText", value: 0x1100, size: 16 }]
        : []),
    ];
    const image = Buffer.alloc(0x1110);
    buildElf64Image(symbols).copy(image);
    const data = snapshotSection(REFERENCE_HASH);
    data.writeBigUInt64LE(2n, 12); // Pinned unified producer enum; support is not inferred.
    data.copy(image, 0x1000);
    const path = await buildApk("unified.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: image },
    ]);
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const inspected = await provider.execute({
      operation: "inspect_dart_aot",
      input: { path },
    });
    expect(inspected.ok).toBe(false);
    if (inspected.ok)
      throw new Error("Unified profile was admitted as split VM/isolate");
    expect(projectAnalysisError(inspected.error)).toMatchObject({
      code: "unsupported_target",
      category: "unsupported_target",
      details: {
        diagnostics: {
          supported_profile: "dart-2.14-split-full-aot",
          observed_exports: symbols.map(({ name, value, size }) => ({
            name,
            offset: value,
            size,
          })),
          abi: "arm64-v8a",
          libapp_bytes: image.length,
          libapp_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });
    const identified = await provider.execute({
      operation: "identify_flutter_build",
      input: { path },
    });
    if (!identified.ok) throw identified.error;
    const value = flutterResultSchemas.identify_flutter_build.parse(
      identified.value.result,
    );
    expect(value.coverage).toBe("partial");
    expect(value.abis[0]?.libapp).toMatchObject({
      snapshot_hash: REFERENCE_HASH,
      snapshot_hash_sources: 1,
    });
    expect(identified.value.limitations.join(" ")).toContain(
      "supported legacy split VM/isolate profile",
    );
    expect(identified.value.limitations.join(" ")).not.toContain(
      "library is truncated",
    );
  },
);

it.each([32, 64] as const)(
  "reads only ELF-owned notes in an ELF%s engine",
  async (bits) => {
    const fake = Buffer.from(buildIdNote());
    fake.fill(0x11, 16);
    for (const ownership of ["program", "section", "both"] as const) {
      const path = await buildApk("owned-notes.apk", [
        { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
        {
          path: "lib/arm64-v8a/libflutter.so",
          bytes: engineFixtureImage({
            bits,
            ownership,
            prefix: fake,
            notes: buildIdNote(),
          }),
        },
      ]);
      const provider = new FlutterBuildProvider();
      onTestFinished(() => provider.close());
      const result = await provider.execute({
        operation: "identify_flutter_build",
        input: { path },
      });
      if (!result.ok) throw result.error;
      const value = flutterResultSchemas.identify_flutter_build.parse(
        result.value.result,
      );
      expect(value.coverage).toBe("complete");
      expect(value.abis[0]!.libflutter).toMatchObject({
        build_id: "e8d907ef7c175ec4313f47111019adc9588c5f61",
        build_id_candidates: ["e8d907ef7c175ec4313f47111019adc9588c5f61"],
      });
    }
  },
);

it.each(["conflicting", "truncated", "capacity"] as const)(
  "preserves %s engine-note uncertainty",
  async (shape) => {
    const second = Buffer.from(buildIdNote());
    second.fill(0x11, 16);
    const notes =
      shape === "conflicting"
        ? Buffer.concat([buildIdNote(), second])
        : shape === "truncated"
          ? Buffer.concat([buildIdNote(), Buffer.from([1])])
          : Buffer.concat(
              Array.from({ length: 65 }, (_, index) => {
                const note = Buffer.from(buildIdNote());
                note.writeUInt32LE(index, 16);
                return note;
              }),
            );
    const path = await buildApk("uncertain-notes.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
      {
        path: "lib/arm64-v8a/libflutter.so",
        bytes: engineFixtureImage({ notes }),
      },
    ]);
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "identify_flutter_build",
      input: { path },
    });
    if (!result.ok) throw result.error;
    const value = flutterResultSchemas.identify_flutter_build.parse(
      result.value.result,
    );
    expect(value.coverage).toBe("partial");
    expect(value.abis[0]!.libflutter.build_id).toBeNull();
    expect(value.abis[0]!.libflutter.build_id_candidates).toHaveLength(
      shape === "conflicting" ? 2 : shape === "truncated" ? 1 : 64,
    );
  },
);

it.each([0, 1, 2, 4, 0xffff])(
  "retains snapshot kind %s with partial decoding coverage",
  async (kind) => {
    const image = aotImage();
    image.writeBigUInt64LE(BigInt(kind), 0x1000 + 12);
    image.writeBigUInt64LE(BigInt(kind), 0x2000 + 12);
    const execution = await analyzeImage(image, "inspect_dart_aot");
    const value = flutterResultSchemas.inspect_dart_aot.parse(execution.result);
    expect(value).toMatchObject({
      coverage: "partial",
      libapp: { coverage: "partial" },
      string_pool: { coverage: "complete" },
    });
    expect(
      value.libapp.sections
        .filter((section) => section.name.endsWith("Data"))
        .map((section) => section.kind),
    ).toEqual([kind, kind]);
    expect(value.libapp.snapshot_hash).toBe(REFERENCE_HASH);
  },
);

it.each(["absent", "range", "metadata-budget"] as const)(
  "preserves %s engine-note coverage at the ELF boundary",
  async (shape) => {
    const engine = engineFixtureImage({
      notes:
        shape === "metadata-budget"
          ? Buffer.alloc(8 * 1024 * 1024)
          : Buffer.alloc(0),
    });
    if (shape === "range")
      engine.writeBigUInt64LE(BigInt(engine.length + 1), 64 + 56 + 8);
    const path = await buildApk("note-bounds.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
      { path: "lib/arm64-v8a/libflutter.so", bytes: engine },
    ]);
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "identify_flutter_build",
      input: { path },
    });
    if (!result.ok) throw result.error;
    const value = flutterResultSchemas.identify_flutter_build.parse(
      result.value.result,
    );
    expect(value.coverage).toBe(shape === "absent" ? "complete" : "partial");
    expect(value.abis[0]!.libflutter).toMatchObject({
      build_id: null,
      build_id_candidates: [],
    });
    if (shape !== "absent")
      expect(result.value.limitations.join(" ")).toContain(
        shape === "range" ? "not file-backed" : "metadata budget",
      );
  },
);

it.each([
  ["root", "EACCES"],
  ["open", "EPERM"],
  ["write", "ENOSPC"],
  ["close", "EIO"],
  ["chmod", "EACCES"],
  ["stat", "EIO"],
  ["digest", "EACCES"],
  ["zip-library", "EIO"],
] as const)(
  "classifies owned snapshot %s failure (%s) separately from source input",
  async (stage, code) => {
    const path = await buildApk("owned-io.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    const cause = Object.assign(new Error("owned snapshot failure"), { code });
    const native =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    if (stage === "zip-library")
      vi.spyOn(ZipArtifactReader.prototype, "open").mockRejectedValueOnce(
        cause,
      );
    if (stage === "root")
      vi.spyOn(fsPromises, "mkdtemp").mockRejectedValueOnce(cause);
    if (stage === "chmod")
      vi.spyOn(fsPromises, "chmod").mockRejectedValueOnce(cause);
    if (stage === "stat")
      vi.spyOn(fsPromises, "stat").mockImplementation((...args) => {
        if (args[0] !== path) return Promise.reject(cause);
        return native.stat(...args);
      });
    if (["open", "write", "close"].includes(stage))
      vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
        if (args[1] === "wx" && stage === "open") throw cause;
        const handle = await native.open(...args);
        if (args[1] === "wx") {
          if (stage === "write")
            vi.spyOn(handle, "writeFile").mockRejectedValueOnce(cause);
          if (stage === "close")
            vi.spyOn(handle, "close").mockRejectedValueOnce(cause);
        }
        return handle;
      });
    if (stage === "digest")
      vi.mocked(createReadStream).mockImplementation(
        () =>
          Readable.from(
            (async function* () {
              yield Buffer.alloc(0);
              throw cause;
            })(),
          ) as ReturnType<typeof createReadStream>,
      );
    onTestFinished(() => {
      vi.restoreAllMocks();
      vi.mocked(createReadStream).mockReset();
    });
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "identify_flutter_build",
      input: { path },
    });
    if (result.ok) throw new Error("expected owned I/O failure");
    expect(result.error.cause).toBe(cause);
    // Only storage exhaustion is a resource constraint; other owned-storage
    // failures keep their system code instead of claiming a size allowance.
    // These causes carry no errno path, so the failure is located by the owned
    // workspace once allocated; before allocation no workspace exists.
    const workspace =
      stage === "root"
        ? null
        : (expect.stringMatching(/[/\\]rea-flutter-[^/\\]+$/u) as unknown);
    const location = { workspace_path: workspace, path: workspace };
    expect(projectAnalysisError(result.error)).toMatchObject(
      code === "ENOSPC"
        ? {
            code: "resource_constraint",
            details: { reported_limits: { ...location, system_code: code } },
          }
        : {
            code: "execution_failure",
            details: {
              provider_id: "flutter",
              diagnostics: {
                stage: "workspace",
                ...location,
                system_code: code,
              },
            },
          },
    );
  },
);

it.each(["close", "elf", "pool", "cleanup"] as const)(
  "honors cancellation during final %s work",
  async (stage) => {
    const path = await buildApk("late-cancellation.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    const controller = new AbortController();
    const originalClose = OwnedFileHandle.prototype.close;
    let closed = 0;
    vi.spyOn(OwnedFileHandle.prototype, "close").mockImplementation(
      async function (this: OwnedFileHandle) {
        await originalClose.call(this);
        if (++closed === 4) {
          if (stage === "close") controller.abort();
          if (stage === "elf") setImmediate(() => controller.abort());
        }
      },
    );
    if (stage === "pool") {
      const original = dartElf.readElfSymbols;
      vi.spyOn(dartElf, "readElfSymbols").mockImplementation(
        async (...args) => {
          const value = await original(...args);
          setImmediate(() => controller.abort());
          return value;
        },
      );
    }
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const provider = new FlutterBuildProvider({
      removeRoot: async (root) => {
        await rm(root, { recursive: true, force: true });
        if (stage === "cleanup") controller.abort();
      },
    });
    onTestFinished(() => provider.close());
    const result = await provider.execute(
      { operation: "inspect_dart_aot", input: { path } },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("late cancellation must prevent success");
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
  },
);

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s keeps completed Evidence when cancelled during successful snapshot removal",
  async (operation) => {
    const path = await buildApk("removal-cancellation.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
      { path: "lib/arm64-v8a/libflutter.so", bytes: libflutter() },
    ]);
    const controlProvider = new FlutterBuildProvider();
    onTestFinished(() => controlProvider.close());
    const control = await new FlutterBuildAnalysisService(
      controlProvider,
    ).execute(operation, { path });
    if (!control.ok) throw control.error;

    const controller = new AbortController();
    const reason = new Error("caller interrupted snapshot removal");
    const removedRoots: string[] = [];
    const provider = new FlutterBuildProvider({
      removeRoot: async (root) => {
        await rm(root, { recursive: true, force: true });
        removedRoots.push(root);
        controller.abort(reason);
      },
    });
    const result = await new FlutterBuildAnalysisService(provider).execute(
      operation,
      { path },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("cancellation must prevent success");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.partialObservation).toEqual(control.value);
    expect(removedRoots).toHaveLength(1);
    await expect(stat(removedRoots[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await provider.close();
    expect(removedRoots).toHaveLength(1);
  },
);

it("projects each payload shape through the owned snapshot", async () => {
  const hash = REFERENCE_HASH;
  const agreeBoth = await buildApk("agree.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: libapp(hash) },
    { path: "lib/arm64-v8a/libflutter.so", bytes: libflutter() },
    { path: "lib/x86_64/libapp.so", bytes: libapp(hash) },
    { path: "lib/x86_64/libflutter.so", bytes: libflutter() },
  ]);
  const half = await buildApk("half.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: libapp(hash) },
  ]);
  const disagree = await buildApk("disagree.apk", [
    {
      path: "lib/arm64-v8a/libapp.so",
      bytes: Buffer.concat([
        snapshotSection("11111111111111111111111111111111"),
        snapshotSection("22222222222222222222222222222222"),
      ]),
    },
    { path: "lib/arm64-v8a/libflutter.so", bytes: libflutter() },
  ]);
  const plain = await buildApk("plain.apk", [
    { path: "classes.dex", bytes: Buffer.from("dex\n0123456789") },
    { path: "lib/arm64-v8a/libnative.so", bytes: Buffer.from("plain-elf") },
  ]);
  const provider = new FlutterBuildProvider();
  const identify = async (apk: string) => {
    const outcome = await provider.execute({
      operation: "identify_flutter_build",
      input: { path: apk },
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    return outcome.value.result as {
      flutter_detected: boolean;
      coverage: string;
      abis: {
        abi: string;
        libapp: {
          present: boolean;
          snapshot_hash: string | null;
          snapshot_hash_sources: number;
          snapshot_hash_candidates: string[];
        };
        libflutter: { present: boolean; build_id: string | null };
      }[];
    };
  };

  const both = await identify(agreeBoth);
  expect(both.flutter_detected).toBe(true);
  expect(both.coverage).toBe("complete");
  expect(both.abis.map((abi) => abi.abi)).toEqual(["arm64-v8a", "x86_64"]);
  for (const abi of both.abis) {
    expect(abi.libapp.snapshot_hash).toBe(hash);
    expect(abi.libapp.snapshot_hash_sources).toBe(2);
    expect(abi.libflutter.build_id).toBe(
      "e8d907ef7c175ec4313f47111019adc9588c5f61",
    );
  }

  const engineless = await identify(half);
  expect(engineless.coverage).toBe("partial");
  expect(engineless.abis[0]?.libapp.present).toBe(true);
  expect(engineless.abis[0]?.libflutter.present).toBe(false);

  const conflicted = await identify(disagree);
  expect(conflicted.coverage).toBe("partial");
  expect(conflicted.abis[0]?.libapp.snapshot_hash).toBeNull();
  expect(conflicted.abis[0]?.libapp.snapshot_hash_candidates).toEqual([
    "11111111111111111111111111111111",
    "22222222222222222222222222222222",
  ]);

  const negative = await identify(plain);
  expect(negative.flutter_detected).toBe(false);
  expect(negative.abis).toEqual([]);
  expect(negative.coverage).toBe("complete");
});

it("rejects a target that is not a readable file", async () => {
  const projected = await (async () => {
    const result = await new FlutterBuildProvider().execute({
      operation: "identify_flutter_build",
      input: { path: "/nonexistent/app.apk" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    return projectAnalysisError(result.error);
  })();
  expect(projected).toMatchObject({ code: "invalid_request" });
});

it("refuses an APK without a Dart payload", async () => {
  const apk = await buildApk("noflutter.apk", [
    { path: "classes.dex", bytes: Buffer.from("dex\n0123456789") },
  ]);
  const result = await new FlutterBuildProvider().execute({
    operation: "inspect_dart_aot",
    input: { path: apk },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unsupported_target",
  });
});

it("refuses a requested ABI the payload does not carry", async () => {
  const apk = await buildApk("oneabi.apk", [
    {
      path: "lib/arm64-v8a/libapp.so",
      bytes: libapp(REFERENCE_HASH),
    },
  ]);
  const result = await new FlutterBuildProvider().execute({
    operation: "inspect_dart_aot",
    input: { path: apk, abi: "x86_64" },
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unsupported_target",
  });
  expect(result.error.message).toContain("arm64-v8a");
});

it("inspects a full synthetic AOT image end to end", async () => {
  const apk = await buildApk("realgallery.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const result = await new FlutterBuildProvider().execute({
    operation: "inspect_dart_aot",
    input: { path: apk },
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value.result as {
    abi: string;
    libapp: {
      snapshot_hash: string | null;
      snapshot_hash_candidates: string[];
      snapshot_hash_sources: number;
      sections: { name: string; magic_valid: boolean }[];
    };
    string_pool: {
      package_uri_count_at_least: number;
      dart_uri_count_at_least: number;
    };
    coverage: string;
  };
  expect(value.abi).toBe("arm64-v8a");
  expect(value.libapp.snapshot_hash).toBe(REFERENCE_HASH);
  expect(value.libapp.snapshot_hash_candidates).toEqual([REFERENCE_HASH]);
  expect(value.libapp.snapshot_hash_sources).toBe(2);
  expect(value.libapp.sections.map((section) => section.name)).toEqual([
    "_kDartVmSnapshotData",
    "_kDartVmSnapshotInstructions",
    "_kDartIsolateSnapshotData",
    "_kDartIsolateSnapshotInstructions",
  ]);
  expect(
    value.libapp.sections
      .filter((section) => section.name.endsWith("Data"))
      .every((section) => section.magic_valid),
  ).toBe(true);
  expect(value.string_pool.package_uri_count_at_least).toBe(2);
  expect(value.string_pool.dart_uri_count_at_least).toBe(2);
  // All four symbols present, both data magics valid, pool under budget:
  // the honest answer for a complete payload is complete coverage.
  expect(value.coverage).toBe("complete");
});

it("reports aliased snapshot data symbols as partial coverage", async () => {
  const apk = await buildApk("aliased.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aliasedDataImage() },
  ]);
  const result = await new FlutterBuildProvider().execute({
    operation: "inspect_dart_aot",
    input: { path: apk },
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value.result as {
    coverage: string;
    libapp: {
      snapshot_hash: string | null;
      snapshot_hash_candidates: string[];
      snapshot_hash_sources: number;
    };
  };
  // The aliased range is scanned once, so one candidate no longer counts
  // as two agreeing sources.
  expect(value.coverage).toBe("partial");
  expect(value.libapp.snapshot_hash_sources).toBe(1);
  expect(value.libapp.snapshot_hash_candidates).toEqual([REFERENCE_HASH]);
  expect(result.value.limitations).toContain(
    "Two or more snapshot data symbols share one header offset; its hash counts as one source instead of two agreeing ones",
  );
});

it("preserves conflicting snapshot hash candidates from the AOT image", async () => {
  const apk = await buildApk("conflicted.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: conflictingHashImage() },
  ]);
  const result = await new FlutterBuildProvider().execute({
    operation: "inspect_dart_aot",
    input: { path: apk },
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value.result as {
    coverage: string;
    libapp: {
      snapshot_hash: string | null;
      snapshot_hash_candidates: string[];
      snapshot_hash_sources: number;
    };
  };
  expect(value.coverage).toBe("partial");
  expect(value.libapp.snapshot_hash).toBeNull();
  expect(value.libapp.snapshot_hash_sources).toBe(2);
  expect(value.libapp.snapshot_hash_candidates).toEqual([
    "11111111111111111111111111111111",
    "22222222222222222222222222222222",
  ]);
});

it("accepts an APK whose path contains spaces through the owned snapshot", async () => {
  const apk = await buildApk("flutter spaced.apk", [
    {
      path: "lib/arm64-v8a/libapp.so",
      bytes: libapp(REFERENCE_HASH),
    },
    { path: "lib/arm64-v8a/libflutter.so", bytes: libflutter() },
  ]);
  expect(apk).toContain(" ");
  const result = await new FlutterBuildProvider().execute({
    operation: "identify_flutter_build",
    input: { path: apk },
  });
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value.result as { flutter_detected: boolean };
  expect(value.flutter_detected).toBe(true);
});

it("retains failed snapshot cleanup and retries it on close", async () => {
  const apk = await buildApk("cleanup.apk", [
    {
      path: "lib/arm64-v8a/libapp.so",
      bytes: libapp(REFERENCE_HASH),
    },
  ]);
  const roots: string[] = [];
  let failing = true;
  const provider = new FlutterBuildProvider({
    removeRoot: async (path) => {
      roots.push(path);
      if (failing) throw new Error("cleanup refused");
      await rm(path, { recursive: true, force: true });
    },
  });
  onTestFinished(async () => {
    failing = false;
    await provider.close();
  });
  const service = new FlutterBuildAnalysisService(provider);
  const result = await finishAnalysisCommand(
    () =>
      service.execute("identify_flutter_build", {
        path: apk,
      }),
    { close: () => provider.close() },
    "flutter",
    "identify_flutter_build",
    new AbortController().signal,
  ).then(projectCliAnalysisResult);
  expect(result).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      resources: [expect.stringContaining("rea-flutter-")],
      partial_observation: {
        operation: "identify_flutter_build",
        subject: { local_path: apk },
        normalized_result: { flutter_detected: true },
      },
    },
  });
  expect(result).toMatchObject({
    details: { resources: [roots[0]] },
  });
  expect(roots).toHaveLength(2);
  expect(roots[1]).toBe(roots[0]);
  failing = false;
  await provider.close();
  expect(roots).toHaveLength(3);
  expect(roots[2]).toBe(roots[0]);
});

it("cancels before creating any snapshot root", async () => {
  const apk = await buildApk("cancel.apk", [
    {
      path: "lib/arm64-v8a/libapp.so",
      bytes: libapp(REFERENCE_HASH),
    },
  ]);
  const controller = new AbortController();
  controller.abort();
  const provider = new FlutterBuildProvider();
  const result = await provider.execute(
    { operation: "identify_flutter_build", input: { path: apk } },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  await provider.close();
});

it.each([1, 20, 47, 48, 61])(
  "identifies a valid ELF when ZIP chunks are only %i bytes",
  async (chunkBytes) => {
    const originalOpen = ZipArtifactReader.prototype.open;
    const spy = vi
      .spyOn(ZipArtifactReader.prototype, "open")
      .mockImplementation(async function (
        this: ZipArtifactReader,
        entry,
        signal,
      ) {
        const source = await originalOpen.call(this, entry, signal);
        return Readable.from(
          (async function* () {
            for await (const chunk of source) {
              const bytes = chunk as Buffer;
              for (let offset = 0; offset < bytes.length; offset += chunkBytes)
                yield bytes.subarray(offset, offset + chunkBytes);
            }
          })(),
        );
      });
    onTestFinished(() => spy.mockRestore());
    const execution = await analyzeImage(aotImage(), "identify_flutter_build");
    const value = flutterResultSchemas.identify_flutter_build.parse(
      execution.result,
    );
    expect(value.coverage).toBe("complete");
    expect(value.abis[0]?.libapp).toMatchObject({
      elf_header_valid: true,
      snapshot_hash: REFERENCE_HASH,
      snapshot_hash_sources: 2,
    });
  },
);

it.each([
  {
    name: "zeroed offsets",
    corrupt: (image: Buffer) => image.fill(0, 0x20, 0x30),
  },
  {
    name: "program table past EOF",
    corrupt: (image: Buffer) =>
      image.writeBigUInt64LE(BigInt(image.length + 1), 0x20),
  },
  {
    name: "section table past EOF",
    corrupt: (image: Buffer) =>
      image.writeBigUInt64LE(BigInt(image.length - 1), 0x28),
  },
  {
    name: "zero program entry width",
    corrupt: (image: Buffer) => image.writeUInt16LE(0, 0x36),
  },
  {
    name: "short section entry width",
    corrupt: (image: Buffer) => image.writeUInt16LE(1, 0x3a),
  },
  {
    name: "absent program table",
    corrupt: (image: Buffer) => image.writeUInt16LE(0, 0x38),
  },
  {
    name: "unsupported class",
    corrupt: (image: Buffer) => image.writeUInt8(3, 4),
  },
  {
    name: "unsupported byte order",
    corrupt: (image: Buffer) => image.writeUInt8(2, 5),
  },
  {
    name: "unsafe table offset",
    corrupt: (image: Buffer) => image.writeBigUInt64LE(1n << 63n, 0x20),
  },
  {
    name: "table inside header",
    corrupt: (image: Buffer) => image.writeBigUInt64LE(1n, 0x20),
  },
  {
    name: "extended section count",
    corrupt: (image: Buffer) => image.writeUInt16LE(0, 0x3c),
  },
])(
  "retains hash observations with partial coverage for $name",
  async ({ corrupt }) => {
    const image = aotImage();
    corrupt(image);
    const execution = await analyzeImage(image, "identify_flutter_build");
    const value = flutterResultSchemas.identify_flutter_build.parse(
      execution.result,
    );
    expect(value.coverage).toBe("partial");
    expect(value.abis[0]?.libapp).toMatchObject({
      elf_header_valid: false,
      snapshot_hash: REFERENCE_HASH,
      snapshot_hash_sources: 2,
    });
    expect(execution.limitations.join("\n")).toContain(
      "ELF header or table extent",
    );
  },
);

it.each([0, 4, 20, 47, 61])(
  "reports a %i-byte ELF prefix as partial without throwing",
  async (length) => {
    const execution = await analyzeImage(
      aotImage().subarray(0, length),
      "identify_flutter_build",
    );
    const value = flutterResultSchemas.identify_flutter_build.parse(
      execution.result,
    );
    expect(value.coverage).toBe("partial");
    expect(value.abis[0]?.libapp.elf_header_valid).toBe(false);
  },
);

it("accepts a section-stripped ELF32 header and bounds its program table", async () => {
  const image = Buffer.alloc(52 + 32 + 104);
  image.writeUInt32LE(0x464c457f);
  image.set([1, 1, 1], 4); // ELF32, little-endian, version 1
  image.writeUInt16LE(3, 0x10); // ET_DYN
  image.writeUInt32LE(1, 0x14);
  image.writeUInt32LE(52, 0x1c);
  image.writeUInt16LE(52, 0x28);
  image.writeUInt16LE(32, 0x2a);
  image.writeUInt16LE(1, 0x2c);
  image.writeUInt32LE(1, 52); // PT_LOAD
  image.writeUInt32LE(image.length, 52 + 16);
  snapshotSection(REFERENCE_HASH).copy(image, 84);
  snapshotSection(REFERENCE_HASH).copy(image, 136);
  const good = await analyzeImage(image, "identify_flutter_build");
  expect(
    flutterResultSchemas.identify_flutter_build.parse(good.result).coverage,
  ).toBe("complete");
  image.writeUInt32LE(image.length - 31, 0x1c); // One byte short of the table.
  const bad = await analyzeImage(image, "identify_flutter_build");
  expect(
    flutterResultSchemas.identify_flutter_build.parse(bad.result).coverage,
  ).toBe("partial");
});

it.each([0n, 15n, 47n, 49n, 1n << 63n])(
  "retains malformed snapshot length %s as partial evidence",
  async (length) => {
    const image = aotImage();
    image.writeBigUInt64LE(length, 0x1004);
    const execution = await analyzeImage(image, "inspect_dart_aot");
    const value = flutterResultSchemas.inspect_dart_aot.parse(execution.result);
    expect(value.coverage).toBe("partial");
    expect(value.libapp.snapshot_hash).toBe(REFERENCE_HASH);
    expect(value.libapp.sections[0]).toMatchObject({
      magic_valid: true,
      header_length:
        length > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(length),
    });
    expect(execution.limitations.join("\n")).toContain(
      "_kDartVmSnapshotData has an incomplete or invalid snapshot header",
    );
  },
);

it("does not let two VM records replace a missing isolate header hash", async () => {
  const image = aotImage();
  const elf = buildElf64Image([
    { name: "_kDartVmSnapshotData", value: 0x1000, size: 104 },
    { name: "_kDartVmSnapshotInstructions", value: 0x1800, size: 16 },
    { name: "_kDartIsolateSnapshotData", value: 0x2000, size: 0x600 },
    { name: "_kDartIsolateSnapshotInstructions", value: 0x2600, size: 16 },
  ]);
  elf.copy(image);
  snapshotSection(REFERENCE_HASH).copy(image, 0x1000 + 52);
  image[0x2000 + 20] = 0x78; // Keep the isolate magic but invalidate its hash.
  const execution = await analyzeImage(image, "inspect_dart_aot");
  const value = flutterResultSchemas.inspect_dart_aot.parse(execution.result);
  expect(value.libapp.sections).toHaveLength(4);
  expect(value.coverage).toBe("partial");
  expect(value.libapp.snapshot_hash_sources).toBe(1);
  expect(value.libapp.snapshot_hash_candidates).toEqual([REFERENCE_HASH]);
  expect(execution.limitations.join("\n")).toContain(
    "_kDartIsolateSnapshotData has an incomplete or invalid snapshot header",
  );
});

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s preserves an oversized APK refusal as a resource constraint",
  async (operation) => {
    const root = await createTestTempDirectory("rea-flutter-size-");
    const path = join(root, "oversized.apk");
    const file = await open(path, "wx");
    try {
      await file.truncate(2 * 1024 ** 3 + 1); // Sparse file: no multi-GiB allocation.
    } finally {
      await file.close();
    }
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("expected a size refusal");
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe("resource_constraint");
    expect(projected.retryable).toBe(false);
    expect(projected.remediation.action).toContain("APK snapshot allowance");
    expect(projected.remediation.action).not.toMatch(/evidence reply/u);
    expect(result.error).toMatchObject({
      operation,
      reportedLimits: {
        max_apk_bytes: 2 * 1024 ** 3,
        observed_bytes: 2 * 1024 ** 3 + 1,
      },
    });
  },
);

it.each([
  { operation: "identify_flutter_build" },
  { operation: "inspect_dart_aot" },
] as const)(
  "preserves native stream aborts during $operation digest",
  async ({ operation }) => {
    const path = await buildApk("abort.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    const controller = new AbortController();
    const nativeFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const streamMock = vi.mocked(createReadStream);
    let abortCode: string | undefined;
    streamMock.mockImplementation((streamPath, options) => {
      const stream = nativeFs.createReadStream(streamPath, options);
      if (streamPath !== path) {
        stream.once("error", (cause: NodeJS.ErrnoException) => {
          abortCode = cause.code;
        });
        stream.once("readable", () =>
          controller.abort(new Error("caller requested stop")),
        );
      }
      return stream;
    });
    onTestFinished(() => {
      streamMock.mockReset();
    });
    const removedRoots: string[] = [];
    const provider = new FlutterBuildProvider({
      removeRoot: async (root) => {
        await rm(root, { recursive: true, force: true });
        removedRoots.push(root);
      },
    });
    onTestFinished(() => provider.close());
    const result = await provider.execute(
      { operation, input: { path } },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("expected cancellation");
    expect(abortCode).toBe("ABORT_ERR");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error).toMatchObject({ operation });
    expect(projectAnalysisError(result.error).code).toBe("cancelled");
    expect(removedRoots).toHaveLength(1);
  },
);

it.each([undefined, "arm64-v8a", "x86_64", "mips"])(
  "applies the library cap only to selected ABI %s",
  async (abi) => {
    const path = await buildApk("mixed-sizes.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
      { path: "lib/x86_64/libapp.so", bytes: aotImage() },
    ]);
    const originalEntries = ZipArtifactReader.prototype.entries;
    const inventory = vi
      .spyOn(ZipArtifactReader.prototype, "entries")
      .mockImplementation(async function* (this: ZipArtifactReader, signal) {
        for await (const entry of originalEntries.call(this, signal))
          yield entry.path.includes("x86_64")
            ? { ...entry, declaredSize: 256 * 1024 ** 2 + 1 }
            : entry;
      });
    const reads = vi.spyOn(ZipArtifactReader.prototype, "open");
    onTestFinished(() => {
      inventory.mockRestore();
      reads.mockRestore();
    });
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({
      operation: "inspect_dart_aot",
      input: { path, ...(abi === undefined ? {} : { abi }) },
    });
    if (abi === "x86_64" || abi === "mips") {
      if (result.ok) throw new Error("expected selected-ABI refusal");
      expect(projectAnalysisError(result.error).code).toBe(
        abi === "x86_64" ? "resource_constraint" : "unsupported_target",
      );
      expect(reads).not.toHaveBeenCalled();
    } else {
      if (!result.ok) throw result.error;
      expect(
        flutterResultSchemas.inspect_dart_aot.parse(result.value.result).abi,
      ).toBe("arm64-v8a");
      expect(reads.mock.calls.map(([entry]) => entry.path)).toEqual([
        "lib/arm64-v8a/libapp.so",
      ]);
    }
  },
);

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s preserves a real ZIP metadata budget refusal",
  async (operation) => {
    const root = await createTestTempDirectory("rea-flutter-metadata-");
    const path = join(root, "large-directory.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      useWebWorkers: false,
    });
    const comment = "x".repeat(65535);
    for (let index = 0; index < 129; index += 1)
      await writer.add(
        `assets/empty-${String(index)}`,
        new Uint8ArrayReader(new Uint8Array()),
        { comment, level: 0 },
      );
    await writeFile(path, await writer.close());
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("expected metadata capacity refusal");
    expect(projectAnalysisError(result.error).code).toBe("resource_constraint");
    expect(result.error).toMatchObject({
      operation,
      reportedLimits: { max_metadata_read_bytes: 8 * 1024 ** 2 },
    });
    expect(result.error.message).toContain("ZIP metadata read requires");
  },
);

it("refuses an AOT image whose snapshot names are all undefined imports", async () => {
  const image = aotImage();
  const table = Number(
    image.readBigUInt64LE(Number(image.readBigUInt64LE(0x28)) + 64 + 0x18),
  );
  for (let index = 0; index < 4; index += 1)
    image.writeUInt16LE(0, table + index * 24 + 6);
  await expect(analyzeImage(image, "inspect_dart_aot")).rejects.toMatchObject({
    _tag: "AnalysisUnsupportedTargetError",
  });
});

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s retains a reader whose close failed before removing its root",
  async (operation) => {
    const path = await buildApk("reader-close.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    const readers = new Set<ZipArtifactReader>();
    const originalClose = ZipArtifactReader.prototype.close;
    let failClose = true;
    const close = vi
      .spyOn(ZipArtifactReader.prototype, "close")
      .mockImplementation(async function (this: ZipArtifactReader) {
        readers.add(this);
        if (failClose) throw new Error("file handle close refused");
        await originalClose.call(this);
      });
    const removeRoot = vi.fn((root: string) =>
      rm(root, { recursive: true, force: true }),
    );
    const provider = new FlutterBuildProvider({ removeRoot });
    onTestFinished(async () => {
      failClose = false;
      await provider.close();
      for (const reader of readers) await originalClose.call(reader);
      close.mockRestore();
    });
    const result = await provider.execute({ operation, input: { path } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained reader cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.partialObservation).toMatchObject({ operation });
    expect(removeRoot).not.toHaveBeenCalled();
    let cleanupFailure: unknown;
    try {
      await provider.close();
    } catch (cause) {
      cleanupFailure = cause;
    }
    expect(cleanupFailure).toBeInstanceOf(ProviderCleanupError);
    expect(cleanupFailure).toMatchObject({
      operation: "close_flutter_build",
      cleanupResources: [expect.stringContaining("rea-flutter-")],
      diagnostics: {
        reason: expect.stringContaining("file handle close refused"),
        retained_roots: [
          {
            path: expect.stringContaining("rea-flutter-"),
            failures: [
              { message: expect.stringContaining("file handle close refused") },
            ],
          },
        ],
      },
    });
    expect(removeRoot).not.toHaveBeenCalled();
    failClose = false;
    await provider.close();
    expect(close).toHaveBeenCalledTimes(3);
    expect(removeRoot).toHaveBeenCalledTimes(1);
  },
);

it("reports omitted Dart labels independently of toolchain labels", async () => {
  const path = await buildApk("dart-label.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    {
      path: "lib/arm64-v8a/libflutter.so",
      bytes: Buffer.concat([
        libflutter(),
        Buffer.from(`Dart VM version:${"x".repeat(201)}\0`),
      ]),
    },
  ]);
  const provider = new FlutterBuildProvider();
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  if (!result.ok) throw result.error;
  const value = flutterResultSchemas.identify_flutter_build.parse(
    result.value.result,
  );
  expect(value.coverage).toBe("partial");
  expect(value.abis[0]?.libflutter).toMatchObject({
    dart_version: null,
    dart_version_capped: true,
    toolchain_capped: false,
  });
});

it.each([0, 1, 2, 3])(
  "retains failed local file-handle closure at acquisition stage %i",
  async (stage) => {
    const path = await buildApk("file-close.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    // Close order: snapshot writer, admitted source, extracted-image writer, image reader.
    const owners: OwnedFileHandle[] = [];
    const originalClose = OwnedFileHandle.prototype.close;
    let failing = true;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (!owners.includes(this)) owners.push(this);
        if (failing && owners[stage] === this)
          throw new Error("handle close refused");
        await originalClose.call(this);
      });
    const removeRoot = vi.fn((root: string) =>
      rm(root, { recursive: true, force: true }),
    );
    const provider = new FlutterBuildProvider({ removeRoot });
    onTestFinished(async () => {
      failing = false;
      await provider.close();
      for (const owner of owners) await originalClose.call(owner);
      close.mockRestore();
    });
    const result = await provider.execute({
      operation: "inspect_dart_aot",
      input: { path },
    });
    expect(result.ok).toBe(false);
    expect(removeRoot).not.toHaveBeenCalled();
    await expect(provider.close()).rejects.toBeInstanceOf(ProviderCleanupError);
    failing = false;
    await provider.close();
    expect(removeRoot).toHaveBeenCalledTimes(1);
  },
);

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s rejects duplicate real ZIP members before extracting either occurrence",
  async (operation) => {
    const path = await createDuplicateFlutterApk();
    const extract = vi.spyOn(ZipArtifactReader.prototype, "open");
    onTestFinished(() => extract.mockRestore());
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("Duplicate libraries must be refused");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            message: expect.stringContaining(
              `duplicate Flutter library members: ${path}:`,
            ),
          },
        ],
      },
    });
    expect(extract).not.toHaveBeenCalled();
  },
);

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s refuses ABI metadata expansion before opening empty libraries",
  async (operation) => {
    const path = await buildApk(
      "many-abis.apk",
      Array.from({ length: 33 }, (_, index) => ({
        path: `lib/abi_${String(index)}/libapp.so`,
        bytes: Buffer.alloc(0),
      })),
    );
    const extract = vi.spyOn(ZipArtifactReader.prototype, "open");
    onTestFinished(() => extract.mockRestore());
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("ABI expansion must be refused");
    expect(projectAnalysisError(result.error).code).toBe("resource_constraint");
    expect(extract).not.toHaveBeenCalled();
  },
);

it.each(["identify_flutter_build", "inspect_dart_aot"] as const)(
  "%s uses the selected path in malformed-APK diagnostics",
  async (operation) => {
    const root = await createTestTempDirectory("rea-flutter-malformed-");
    const path = join(root, "selected.apk");
    await writeFile(path, "not a ZIP");
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("Malformed APK must be refused");
    const error = projectAnalysisError(result.error);
    expect(error).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ message: expect.stringContaining(path) }] },
    });
    expect(JSON.stringify(error)).not.toContain("input.apk");
  },
);

const expectSelectionIssue = async (
  provider: FlutterBuildProvider,
  path: string,
  message: string,
): Promise<void> => {
  for (const operation of [
    "identify_flutter_build",
    "inspect_dart_aot",
  ] as const) {
    const result = await provider.execute({ operation, input: { path } });
    if (result.ok) throw new Error("A non-file APK selection must fail");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `${message}: ${path}`,
          },
        ],
      },
    });
  }
};

it("names a missing or non-file APK selection instead of blaming package bytes", async () => {
  const root = await createTestTempDirectory("rea-flutter-selection-");
  const provider = new FlutterBuildProvider();
  onTestFinished(() => provider.close());
  await expectSelectionIssue(
    provider,
    join(root, "absent.apk"),
    "Selected APK does not exist",
  );
  await expectSelectionIssue(
    provider,
    root,
    "Selected APK is not a regular file",
  );
});

// Windows listens on named pipes rather than filesystem sockets.
it.skipIf(process.platform === "win32")(
  "names an unopenable Unix socket APK selection as a non-file",
  async () => {
    const root = await createTestTempDirectory("rea-flutter-socket-");
    const socketPath = join(root, "s.sock");
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
    onTestFinished(
      () => new Promise<void>((resolve) => socket.close(() => resolve())),
    );
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    await expectSelectionIssue(
      provider,
      socketPath,
      "Selected APK is not a regular file",
    );
  },
);

it.each(["EACCES", "EPERM"] as const)(
  "preserves %s at the shared source admission boundary",
  async (code) => {
    const admitted = vi
      .spyOn(regularFile, "openRegularFile")
      .mockRejectedValue(Object.assign(new Error("denied"), { code }));
    onTestFinished(() => admitted.mockRestore());
    const provider = new FlutterBuildProvider();
    onTestFinished(() => provider.close());
    for (const operation of [
      "identify_flutter_build",
      "inspect_dart_aot",
    ] as const) {
      const result = await provider.execute({
        operation,
        input: { path: "/selected.apk" },
      });
      if (result.ok) throw new Error("Denied read must fail");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "access_denied",
      });
    }
  },
);

it.each(["EACCES", "EPERM"] as const)(
  "preserves %s during opened-source reads and path revalidation",
  async (code) => {
    const path = await buildApk("source-denied.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    const original = regularFile.openRegularFile;
    const cause = Object.assign(new Error("source denied"), { code });
    for (const stage of ["read", "revalidate"] as const) {
      const provider = new FlutterBuildProvider();
      onTestFinished(() => provider.close());
      const admitted = vi
        .spyOn(regularFile, "openRegularFile")
        .mockImplementation(async (...args) => {
          const descriptor = await original(...args);
          const { handle } = descriptor;
          if (stage === "read")
            vi.spyOn(handle, "read").mockRejectedValueOnce(cause);
          return descriptor;
        });
      const pathStat =
        stage === "revalidate"
          ? vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(cause)
          : undefined;
      try {
        const result = await provider.execute({
          operation: "identify_flutter_build",
          input: { path },
        });
        if (result.ok) throw new Error("Denied source must fail");
        expect(projectAnalysisError(result.error).code).toBe("access_denied");
        expect(result.error.cause).toBe(cause);
      } finally {
        admitted.mockRestore();
        pathStat?.mockRestore();
      }
    }
  },
);

it("detects same-size source rewrites with restored mtime through the opened descriptor", async () => {
  const path = await buildApk("changing.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const before = await stat(path);
  const content = await readFile(path);
  const nativeAdmission = regularFile.openRegularFile;
  const admitted = vi
    .spyOn(regularFile, "openRegularFile")
    .mockImplementation(async (...args) => {
      const descriptor = await nativeAdmission(...args);
      const { handle } = descriptor;
      // Rewrite after a real descriptor read. The retained admission snapshot
      // remains the baseline for final verification, including ctime.
      const nativeRead = handle.read.bind(handle);
      let rewritten = false;
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
        const result = await nativeRead(...readArgs);
        if (!rewritten) {
          rewritten = true;
          await new Promise((resolve) => setTimeout(resolve, 10));
          await writeFile(path, content);
          await utimes(path, before.atime, before.mtime);
        }
        return result;
      });
      return descriptor;
    });
  onTestFinished(() => admitted.mockRestore());
  const provider = new FlutterBuildProvider();
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  if (result.ok) throw new Error("Concurrent source rewrite must fail");
  expect(projectAnalysisError(result.error).code).toBe("artifact_changed");
});

it("refuses truncated hash-candidate evidence and includes five-character tokens", async () => {
  const image = aotImage();
  Buffer.from("Login\0").copy(image, 0x2300);
  const aot = await analyzeImage(image, "inspect_dart_aot");
  expect(
    flutterResultSchemas.inspect_dart_aot.parse(aot.result).string_pool
      .class_like_tokens,
  ).toContain("Login");
  const bytes = Buffer.concat(
    Array.from({ length: 65 }, (_, index) =>
      snapshotSection(index.toString(16).padStart(32, "0")),
    ),
  );
  const path = await buildApk("many-hashes.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes },
  ]);
  const provider = new FlutterBuildProvider();
  onTestFinished(() => provider.close());
  const result = await provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  if (result.ok) throw new Error("Incomplete candidate set must be explicit");
  expect(projectAnalysisError(result.error).code).toBe("resource_constraint");
});

it("stops a cancelled descriptor copy before writing its next chunk and releases every owner", async () => {
  const path = await buildApk("copy-cancel.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const controller = new AbortController();
  const nativeAdmission = regularFile.openRegularFile;
  const admitted = vi
    .spyOn(regularFile, "openRegularFile")
    .mockImplementation(async (...args) => {
      const descriptor = await nativeAdmission(...args);
      const { handle } = descriptor;
      const nativeRead = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(async (...readArgs) => {
        const result = await nativeRead(...readArgs);
        controller.abort(new Error("cancelled while copy read was pending"));
        return result;
      });
      return descriptor;
    });
  onTestFinished(() => admitted.mockRestore());
  const removeRoot = vi.fn((root: string) =>
    rm(root, { recursive: true, force: true }),
  );
  const provider = new FlutterBuildProvider({ removeRoot });
  onTestFinished(() => provider.close());
  const result = await provider.execute(
    { operation: "identify_flutter_build", input: { path } },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Cancelled copying must fail");
  expect(projectAnalysisError(result.error).code).toBe("cancelled");
  expect(removeRoot).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "reports actual nonempty-root removal failure and resolves its exact error after retry (cancel=%s)",
  async (cancel) => {
    const path = await buildApk("retained-root.apk", [
      { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
    ]);
    let refuse = true;
    let retainedRoot = "";
    const controller = new AbortController();
    const reason = { caller: "cancel during refused cleanup" };
    const provider = new FlutterBuildProvider({
      removeRoot: async (root) => {
        retainedRoot = root;
        if (refuse) {
          if (cancel) controller.abort(reason);
          await rmdir(root); // Actual OS refusal: the owned snapshot still occupies the directory.
        } else await rm(root, { recursive: true, force: true });
      },
    });
    onTestFinished(async () => {
      refuse = false;
      await provider.close();
    });
    const controlProvider = new FlutterBuildProvider();
    const control = await new FlutterBuildAnalysisService(
      controlProvider,
    ).execute("identify_flutter_build", { path });
    await controlProvider.close();
    if (!control.ok) throw control.error;
    const result = await provider.execute(
      { operation: "identify_flutter_build", input: { path } },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected owned cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual([retainedRoot]);
    expect(result.error.partialObservation).toEqual(control.value);
    if (cancel) expect(result.error.cleanupPrimary?.cause).toBe(reason);
    await expect(stat(join(retainedRoot, "input.apk"))).resolves.toBeDefined();
    let retryFailure: unknown;
    try {
      await provider.close();
    } catch (cause) {
      retryFailure = cause;
    }
    expect(retryFailure).toBeInstanceOf(ProviderCleanupError);
    refuse = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(retryFailure).toMatchObject({
      cleanupIncomplete: false,
      cleanupResources: [],
    });
    await expect(stat(retainedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("drains admitted snapshot work before close and fences later execution", async () => {
  const path = await buildApk("drain-root.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  let reached!: () => void;
  let proceed!: () => void;
  const boundary = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const original = ZipArtifactReader.prototype.open;
  const list = vi
    .spyOn(ZipArtifactReader.prototype, "open")
    .mockImplementation(async function (
      this: ZipArtifactReader,
      ...args: Parameters<typeof original>
    ) {
      reached();
      await barrier;
      return original.apply(this, args);
    });
  const removeRoot = vi.fn((root: string) =>
    rm(root, { recursive: true, force: true }),
  );
  const provider = new FlutterBuildProvider({ removeRoot });
  onTestFinished(async () => {
    proceed();
    list.mockRestore();
    await provider.close();
  });
  const running = provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  await boundary;
  let closed = false;
  const closing = provider.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(removeRoot).not.toHaveBeenCalled();
  proceed();
  expect((await running).ok).toBe(true);
  await closing;
  expect(removeRoot).toHaveBeenCalledTimes(1);
  expect(
    (
      await provider.execute({
        operation: "identify_flutter_build",
        input: { path },
      })
    ).ok,
  ).toBe(false);
});

it("preserves source admission failure when cancellation arrives during its root cleanup", async () => {
  const root = await createTestTempDirectory("flutter-primary-");
  const controller = new AbortController();
  const provider = new FlutterBuildProvider({
    removeRoot: async (path) => {
      await rm(path, { recursive: true, force: true });
      controller.abort({ caller: "late cleanup cancellation" });
    },
  });
  onTestFinished(() => provider.close());
  const result = await provider.execute(
    {
      operation: "identify_flutter_build",
      input: { path: join(root, "absent.apk") },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected missing selected source");
  expect(result.error).not.toBeInstanceOf(AnalysisCancelledError);
  expect(result.error).toMatchObject({ _tag: "AnalysisInputError" });
  expect(result.error.cleanupIncomplete).toBe(false);
});

it("retains mixed-root cleanup diagnostics and releases aggregate errors only after every root recovers", async () => {
  const path = await buildApk("mixed-roots.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const roots: string[] = [];
  const allowed = new Set<string>();
  const provider = new FlutterBuildProvider({
    removeRoot: async (root) => {
      if (!roots.includes(root)) roots.push(root);
      if (!allowed.has(root)) await rmdir(root);
      else await rm(root, { recursive: true, force: true });
    },
  });
  onTestFinished(async () => {
    roots.forEach((root) => allowed.add(root));
    await provider.close();
  });
  const [first, second] = await Promise.all([
    provider.execute({ operation: "identify_flutter_build", input: { path } }),
    provider.execute({ operation: "identify_flutter_build", input: { path } }),
  ]);
  expect(first.ok || second.ok).toBe(false);
  if (first.ok || second.ok) throw new Error("Expected both cleanup owners");
  let aggregate: unknown;
  try {
    await provider.close();
  } catch (cause) {
    aggregate = cause;
  }
  expect(aggregate).toMatchObject({
    cleanupIncomplete: true,
    cleanupResources: expect.arrayContaining(roots),
    diagnostics: {
      retained_roots: expect.arrayContaining(
        roots.map((root) => ({
          path: root,
          failures: [expect.objectContaining({ code: "ENOTEMPTY" })],
        })),
      ),
    },
  });
  allowed.add(first.error.cleanupResources[0]!);
  await expect(provider.close()).rejects.toBeInstanceOf(ProviderCleanupError);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(second.error.cleanupIncomplete).toBe(true);
  expect(aggregate).toMatchObject({
    cleanupIncomplete: true,
    cleanupResources: second.error.cleanupResources,
  });
  allowed.add(second.error.cleanupResources[0]!);
  await provider.close();
  expect(second.error.cleanupIncomplete).toBe(false);
  expect(aggregate).toMatchObject({
    cleanupIncomplete: false,
    cleanupResources: [],
  });
});

it("retries retained cleanup before admitting replacement snapshots", async () => {
  const path = await buildApk("blocked-roots.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const roots = new Set<string>();
  let refuse = true;
  const provider = new FlutterBuildProvider({
    removeRoot: async (root) => {
      roots.add(root);
      if (refuse) await rmdir(root);
      else await rm(root, { recursive: true, force: true });
    },
  });
  onTestFinished(async () => {
    refuse = false;
    await provider.close();
  });
  const first = await provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  const blocked = await provider.execute({
    operation: "identify_flutter_build",
    input: { path },
  });
  expect(roots.size).toBe(1);
  expect(blocked.ok).toBe(false);
  if (first.ok || blocked.ok) throw new Error("Expected retained cleanup");
  expect(blocked.error.cleanupResources).toEqual(first.error.cleanupResources);
  refuse = false;
  expect(
    (
      await provider.execute({
        operation: "identify_flutter_build",
        input: { path },
      })
    ).ok,
  ).toBe(true);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(blocked.error.cleanupIncomplete).toBe(false);
  expect(roots.size).toBe(2);
});

it("does not create a replacement snapshot when cancelled during cleanup retry", async () => {
  const path = await buildApk("cancel-cleanup-retry.apk", [
    { path: "lib/arm64-v8a/libapp.so", bytes: aotImage() },
  ]);
  const roots = new Set<string>();
  const controller = new AbortController();
  const reason = { caller: "cancel during cleanup retry" };
  let attempts = 0;
  const provider = new FlutterBuildProvider({
    removeRoot: async (root) => {
      roots.add(root);
      attempts++;
      if (attempts === 1) await rmdir(root);
      else {
        controller.abort(reason);
        await rm(root, { recursive: true, force: true });
      }
    },
  });
  onTestFinished(() => provider.close());
  const request = {
    operation: "identify_flutter_build" as const,
    input: { path },
  };
  const first = await provider.execute(request);
  if (first.ok) throw new Error("Expected retained cleanup");
  const cancelled = await provider.execute(request, {
    signal: controller.signal,
  });
  expect(cancelled.ok).toBe(false);
  if (cancelled.ok) throw new Error("Expected cancellation");
  expect(projectAnalysisError(cancelled.error).code).toBe("cancelled");
  expect(cancelled.error.cause).toBe(reason);
  expect(first.error.cleanupIncomplete).toBe(false);
  expect(roots.size).toBe(1);
});

it("preserves a completed analysis failure through refused cleanup and late cancellation", async () => {
  const path = await buildApk("unsupported-cleanup.apk", []);
  const controlProvider = new FlutterBuildProvider();
  const control = await controlProvider.execute({
    operation: "inspect_dart_aot",
    input: { path },
  });
  await controlProvider.close();
  if (control.ok) throw new Error("Expected unsupported package control");
  const controller = new AbortController();
  let refuse = true;
  const provider = new FlutterBuildProvider({
    removeRoot: async (root) => {
      if (refuse) {
        controller.abort({ caller: "late failed cleanup" });
        await rmdir(root);
      } else await rm(root, { recursive: true, force: true });
    },
  });
  onTestFinished(async () => {
    refuse = false;
    await provider.close();
  });
  const result = await provider.execute(
    { operation: "inspect_dart_aot", input: { path } },
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("Expected primary and cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(projectAnalysisError(result.error.cleanupPrimary!)).toEqual(
    projectAnalysisError(control.error),
  );
  expect(result.error.cleanupPrimary).not.toBeInstanceOf(
    AnalysisCancelledError,
  );
  refuse = false;
  await provider.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(projectAnalysisError(result.error)).toMatchObject(
    projectAnalysisError(control.error),
  );
});
