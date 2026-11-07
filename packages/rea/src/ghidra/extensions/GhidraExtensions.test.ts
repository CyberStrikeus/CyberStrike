import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../config/parseConfig.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";
import {
  ghidraExtensionSchema,
  resolveGhidraExtensions,
  snapshotGhidraExtensions,
  validateGhidraExtensionResults,
  validateGhidraExtensionProfile,
  type GhidraExtensionResult,
} from "./GhidraExtensions.js";

const roots: string[] = [];
let resources = new ArtifactResourceScope();
afterEach(async () => {
  await resources.close();
  resources = new ArtifactResourceScope();
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const root = async () => {
  const path = await mkdtemp(join(tmpdir(), "rea-extension-test-"));
  roots.push(path);
  return path;
};
const target: BinaryTarget = {
  path: "/tmp/native",
  kind: "executable",
  format: "elf",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
  sha256: "a".repeat(64),
};
const config = (path?: string) => {
  const parsed = parseConfig(
    path === undefined ? {} : { REA_GHIDRA_NATIVEAOT_JAR: path },
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};
const artifact = async () => {
  const directory = await root();
  const path = join(directory, "fixture.jar");
  const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2, 3]);
  await writeFile(path, bytes);
  const resolved = await resolveGhidraExtensions(
    config(path),
    target,
    "linux",
    resources,
  );
  if (!resolved.ok || resolved.value[0] === undefined)
    throw new Error("expected fixture artifact");
  return { extension: resolved.value[0], bytes, path };
};
const result = (sha256: string): GhidraExtensionResult => ({
  id: "nativeaot",
  sha256,
  status: "not_applicable",
  reason: "No matching directory",
  result: {
    id: "nativeaot",
    integration_api: 1,
    source_revision: "effeb734fc570c32650f88b159608979dc7b423e",
    source_revision_authority: "build-reported-unattested",
    status: "not_applicable",
    reason: "No matching directory",
    method_tables: 0,
    diagnostics: [],
  },
});

describe("optional Ghidra extension refusals", () => {
  it("rejects unsupported hosts and target architectures before opening files", async () => {
    const host = await resolveGhidraExtensions(
      config("/absent.jar"),
      target,
      "darwin",
      resources,
    );
    expect(host.ok).toBe(false);
    if (!host.ok)
      // A host restriction is not an execution failure to retry or repair.
      expect(projectAnalysisError(host.error)).toMatchObject({
        code: "capability_unavailable",
        retryable: false,
        message: expect.stringContaining("verified on Linux only"),
        remediation: {
          action: expect.stringContaining("omit REA_GHIDRA_NATIVEAOT_JAR"),
        },
        details: {
          provider_id: "ghidra",
          operation: "resolve_analysis_profile",
        },
      });
    const architecture = await resolveGhidraExtensions(
      config("/absent.jar"),
      {
        ...target,
        architecture: "arm64",
        availableArchitectures: ["arm64"],
      },
      "linux",
      resources,
    );
    expect(architecture.ok).toBe(false);
    if (!architecture.ok)
      expect(projectAnalysisError(architecture.error)).toMatchObject({
        code: "unsupported_target",
        remediation: {
          action: expect.stringContaining("omit REA_GHIDRA_NATIVEAOT_JAR"),
        },
        details: {
          operation: "resolve_analysis_profile",
          path: target.path,
          reason: expect.stringContaining("x86-64 ELF or native PE"),
        },
      });
  });
});

describe("optional Ghidra extension boundary", () => {
  it("keeps ordinary profiles free of unconfigured extensions", async () => {
    expect(
      await resolveGhidraExtensions(config(), target, "linux", resources),
    ).toEqual({
      ok: true,
      value: [],
    });
  });
  it("validates configuration paths rather than ignoring an unsupported value", () => {
    expect(parseConfig({ REA_GHIDRA_NATIVEAOT_JAR: "relative.jar" }).ok).toBe(
      false,
    );
  });
  it("commits the actual regular artifact bytes and caller path", async () => {
    const { extension, bytes, path } = await artifact();
    expect(extension).toMatchObject({
      configured_path: path,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integration_api: 1,
    });
  });
  it("snapshots identical bytes exclusively into the private runtime", async () => {
    const { extension, bytes } = await artifact();
    const runtime = await root();
    const snapshots = await snapshotGhidraExtensions(
      [extension],
      runtime,
      resources,
    );
    expect(snapshots[0]?.path).toBe(join(runtime, "extensions/nativeaot.jar"));
    expect(
      Buffer.compare(
        await readFile(join(runtime, "extensions/nativeaot.jar")),
        bytes,
      ),
    ).toBe(0);
    await expect(
      snapshotGhidraExtensions([extension], runtime, resources),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      cause: { code: "EEXIST" },
    });
  });
  it("rejects artifact changes after the profile commitment", async () => {
    const { extension, path } = await artifact();
    await writeFile(path, Buffer.from([0x50, 0x4b, 3, 4, 9, 9, 9, 9]));
    await expect(
      snapshotGhidraExtensions([extension], await root(), resources),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: {
        code: "digest_differs",
        id: extension.id,
        reason: "digest_differs",
        path: extension.path,
      },
    });
  });
  it("rejects nonexistent, empty and non-JAR artifacts with useful reasons", async () => {
    const directory = await root();
    for (const bytes of [Buffer.alloc(0), Buffer.from("invalid jar")]) {
      const path = join(directory, "invalid.jar");
      await writeFile(path, bytes);
      const resolved = await resolveGhidraExtensions(
        config(path),
        target,
        "linux",
        resources,
      );
      expect(resolved.ok).toBe(false);
      if (!resolved.ok)
        expect(resolved.error).toMatchObject({
          diagnostics: { path, extension: "nativeaot" },
        });
    }
    const absentPath = join(directory, "absent.jar");
    const absent = await resolveGhidraExtensions(
      config(absentPath),
      target,
      "linux",
      resources,
    );
    expect(absent.ok).toBe(false);
    if (!absent.ok)
      expect(absent.error).toMatchObject({
        diagnostics: {
          path: absentPath,
          extension: "nativeaot",
          reason: expect.stringContaining("ENOENT"),
        },
      });
  });
  it.skipIf(process.platform === "win32")(
    "rejects a FIFO without requiring another process to open its writer",
    async () => {
      const path = join(await root(), "not-a-jar.fifo");
      await promisify(execFile)("mkfifo", [path]);
      let writerRequired = false;
      let rescueTimer: ReturnType<typeof setTimeout> | undefined;
      // Release a broken blocking-open implementation so regression failures
      // do not strand a libuv filesystem worker. Success needs no FIFO peer.
      const rescue = new Promise<void>((resolve) => {
        rescueTimer = setTimeout(() => {
          writerRequired = true;
          void open(path, constants.O_WRONLY | constants.O_NONBLOCK)
            .then((file) => file.close())
            .then(resolve, () => resolve());
        }, 1000);
      });
      try {
        const resolved = await resolveGhidraExtensions(
          config(path),
          target,
          "linux",
          resources,
        );
        expect(resolved.ok).toBe(false);
        if (!resolved.ok)
          expect(resolved.error).toMatchObject({
            diagnostics: { reason: expect.stringContaining("regular file") },
          });
        expect(writerRequired).toBe(false);
      } finally {
        clearTimeout(rescueTimer);
        if (writerRequired) await rescue;
      }
    },
  );
  it("honors cancellation before artifact I/O", async () => {
    const controller = new AbortController();
    controller.abort();
    const resolved = await resolveGhidraExtensions(
      config("/absent.jar"),
      target,
      "linux",
      resources,
      controller.signal,
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok)
      expect(resolved.error._tag).toBe("AnalysisCancelledError");
  });
});

it("refuses traversal identities in an imported extension profile", () => {
  expect(
    ghidraExtensionSchema.safeParse({
      id: "../escape",
      path: "/fixture.jar",
      configured_path: "/fixture.jar",
      sha256: "a".repeat(64),
      integration_api: 1,
      entry_class: "ignored",
    }).success,
  ).toBe(false);
});

describe("Ghidra extension profile and producer validation", () => {
  it("requires exact inventory, artifact digest and consistent producer status", async () => {
    const { extension } = await artifact();
    const valid = result(extension.sha256);
    expect(validateGhidraExtensionResults([extension], [valid])).toBeNull();
    expect(validateGhidraExtensionResults([extension], [])).toContain(
      "inventory",
    );
    expect(validateGhidraExtensionResults([], [valid])).toContain("inventory");
    expect(
      validateGhidraExtensionResults([extension], [valid, valid]),
    ).toContain("inventory");
    const identityMismatch = validateGhidraExtensionResults(
      [extension],
      [{ ...valid, sha256: "b".repeat(64) }],
    );
    expect(identityMismatch).toContain("identity");
    expect(identityMismatch).toContain(extension.id);
    expect(
      validateGhidraExtensionResults(
        [extension],
        [{ ...valid, status: "complete" }],
      ),
    ).toContain("producer report");
  });
  it("requires matching explicit configuration for imported executable profiles", async () => {
    const { extension, path } = await artifact();
    expect(
      validateGhidraExtensionProfile(
        [extension],
        config(path),
        target,
        "linux",
      ),
    ).toBeNull();
    expect(
      validateGhidraExtensionProfile([extension], config(), target, "linux"),
    ).toContain("inventory");
    const unsupportedHost = validateGhidraExtensionProfile(
      [extension],
      config(path),
      target,
      "darwin",
    );
    expect(unsupportedHost).toContain("Linux");
    expect(unsupportedHost).toContain("REA_GHIDRA_NATIVEAOT_JAR");
    for (const changed of [
      { ...extension, entry_class: "arbitrary.Code" },
      { ...extension, configured_path: "/another.jar" },
    ]) {
      const invalid = validateGhidraExtensionProfile(
        [changed],
        config(path),
        target,
        "linux",
      );
      expect(invalid).toContain("configuration");
      expect(invalid).toContain(extension.id);
    }
  });
  it("does not classify PE/CLI or ReadyToRun as NativeAOT", async () => {
    const resolved = await resolveGhidraExtensions(
      config("/absent.jar"),
      { ...target, format: "pe", managed: true, executableRole: "application" },
      "linux",
      resources,
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok)
      expect(projectAnalysisError(resolved.error)).toMatchObject({
        code: "unsupported_target",
        remediation: {
          action: expect.stringContaining("inspect_managed_artifact"),
        },
      });
  });
  it("does not substitute another artifact under an unchanged configured path", async () => {
    const first = await artifact();
    const second = await artifact();
    await expect(
      snapshotGhidraExtensions(
        [{ ...second.extension, configured_path: first.path }],
        await root(),
        resources,
      ),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: {
        code: "path_differs",
        id: second.extension.id,
        reason: "path_differs",
      },
    });
  });
  it("rejects unregistered descriptors before snapshot filesystem writes", async () => {
    const { extension } = await artifact();
    const runtime = await root();
    await expect(
      snapshotGhidraExtensions(
        [{ ...extension, id: "unknown" }],
        runtime,
        resources,
      ),
    ).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: {
        code: "unregistered",
        id: "unknown",
        reason: "unregistered",
      },
    });
  });
});

describe("Ghidra extension recovery coverage", () => {
  it("validates positive recovery, measured partial coverage and distinct table identities", async () => {
    const { extension } = await artifact();
    const baseline = result(extension.sha256);
    const positive: GhidraExtensionResult = {
      ...baseline,
      status: "complete",
      reason: null,
      result: {
        ...baseline.result,
        status: "complete",
        reason: null,
        method_tables: 1,
        header_address: "0x401000",
        discovery: "signature-heuristic",
        format_major: 9,
        format_minor: 1,
        types: [
          {
            address: "0x402000",
            type: "/NativeAOT/MethodTables/Class_00402000_MT",
          },
        ],
        derived_memory: {
          address: "0x402000",
          size_bytes: 64,
          sha256: "a".repeat(64),
          file_offset: null,
        },
        coverage: {
          frozen_object_candidates: 1,
          frozen_objects_annotated: 1,
          basis: "rehydrated-pointer-candidates-and-committed-instance-types",
        },
      },
    };
    expect(validateGhidraExtensionResults([extension], [positive])).toBeNull();
    const incomplete = {
      ...positive,
      result: {
        ...positive.result,
        coverage: {
          frozen_object_candidates: 2,
          frozen_objects_annotated: 1,
          basis: "rehydrated-pointer-candidates-and-committed-instance-types",
        },
      },
    };
    expect(validateGhidraExtensionResults([extension], [incomplete])).toContain(
      "coverage",
    );
    expect(
      validateGhidraExtensionResults(
        [extension],
        [
          {
            ...incomplete,
            status: "partial",
            result: { ...incomplete.result, status: "partial" },
          },
        ],
      ),
    ).toBeNull();
    expect(
      validateGhidraExtensionResults(
        [extension],
        [{ ...positive, result: { ...positive.result, discovery: null } }],
      ),
    ).toContain("producer report");
  });
  it("preserves real loader failures without requiring a successful analyzer report", async () => {
    const { extension } = await artifact();
    const reason = "Extension loading/analysis failed: ClassNotFoundException";
    expect(
      validateGhidraExtensionResults(
        [extension],
        [
          {
            id: "nativeaot",
            sha256: extension.sha256,
            status: "failed",
            reason,
            result: { loader_failure: reason },
          },
        ],
      ),
    ).toBeNull();
  });
  it("does not accept complete recovery without format and byte identities", async () => {
    const { extension } = await artifact();
    const incomplete = result(extension.sha256);
    incomplete.result.status = "complete";
    incomplete.result.reason = null;
    const rejection = validateGhidraExtensionResults(
      [extension],
      [{ ...incomplete, status: "complete", reason: null }],
    );
    expect(rejection).toContain("format");
    expect(rejection).toContain("method-table");
    expect(rejection).toContain("derived-memory");
  });
  it.each(["not_applicable", "unsupported", "failed"] as const)(
    "rejects contradictory %s reports without discarding discovery context",
    async (status) => {
      const { extension } = await artifact();
      const unavailable = result(extension.sha256);
      const report = {
        ...unavailable,
        status,
        result: {
          ...unavailable.result,
          status,
          header_address: "0x401000",
          discovery: "signature-heuristic",
          format_major: 9,
          format_minor: 1,
        },
      } satisfies GhidraExtensionResult;
      expect(validateGhidraExtensionResults([extension], [report])).toBeNull();
      expect(
        validateGhidraExtensionResults(
          [extension],
          [{ ...report, result: { ...report.result, method_tables: 1 } }],
        ),
      ).toContain("metadata");
      for (const reason of [null, "", " "] as const)
        expect(
          validateGhidraExtensionResults(
            [extension],
            [
              {
                ...report,
                reason,
                result: { ...report.result, reason },
              },
            ],
          ),
        ).toContain("reason");
    },
  );
});
