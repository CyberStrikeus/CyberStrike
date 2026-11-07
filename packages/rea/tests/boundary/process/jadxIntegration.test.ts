import { SdkErrorCode } from "@modelcontextprotocol/client";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { expect, it as test, onTestFinished, vi } from "vitest";
import {
  access,
  chmod,
  mkdir,
  readFile,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { AndroidAnalysisService } from "../../../src/application/android/AndroidAnalysisService.js";
import { JadxProvider } from "../../../src/android/JadxProvider.js";
import { JadxSession } from "../../../src/android/JadxSession.js";
import { androidResultSchemas } from "../../../src/domain/android/androidAnalysis.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { snapshotAndroidEngine } from "../../../src/android/AndroidTargetSnapshot.js";
import { hashStableFile } from "../../../src/filesystem/StableFileHash.js";
import * as stableHash from "../../../src/filesystem/StableFileHash.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { RegularFileCleanupFailure } from "../../../src/filesystem/OwnedRegularFile.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import {
  createJadxProtocolFixture as setup,
  verifyJadxFixtureCleanup as verifyCleanup,
} from "../../fixtures/android/jadx.js";
import { writeJadxJarInventory } from "../../fixtures/android/jadxJar.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const it = test.skipIf(process.platform === "win32");

it.each(["alias/../bin", ""])(
  "keeps PATH=%j Java tied to each caller directory across private-workspace launches",
  async (searchPath) => {
    const root = await createTestTempDirectory("rea-jadx-relative-java-");
    const apk = join(root, "fixture.apk"),
      jar = join(root, "fixture.jar");
    await writeOrderedZip(apk, ["AndroidManifest.xml", "classes.dex"]);
    await writeJadxJarInventory(jar);
    const fixture = new URL(
      "../../fixtures/android/jadx-mcp.mjs",
      import.meta.url,
    );
    const command = [process.execPath, fileURLToPath(fixture)]
      .map((value) => `'${value.replaceAll("'", `'"'"'`)}'`)
      .join(" ");
    const shim = join(root, "java-shim");
    await writeFile(
      shim,
      `#!/bin/sh\nselected="\${0%/*}"\n[ -f "$selected/runtime-marker" ] || exit 19\npwd >> "$selected/java.log"\nif [ "$1" = "--list-modules" ]; then\n  printf 'java.base@21.0.0\\njdk.compiler@21.0.0\\n'\nelse\n  exec ${command}\nfi\n`,
    );
    await chmod(shim, 0o755);
    const directories = [join(root, "first"), join(root, "second")];
    for (const directory of directories) {
      await mkdir(join(directory, "real/deep"), { recursive: true });
      await mkdir(join(directory, "real/bin"));
      await symlink(join(directory, "real/deep"), join(directory, "alias"));
      await symlink(shim, join(directory, "real/bin/java"));
      await writeFile(join(directory, "real/bin/runtime-marker"), directory);
      await symlink(shim, join(directory, "java"));
      await writeFile(join(directory, "runtime-marker"), directory);
    }
    const logPath = (directory: string) =>
      join(directory, searchPath === "" ? "java.log" : "real/bin/java.log");
    const provider = new JadxProvider({
      ...process.env,
      JAVA_HOME: undefined,
      PATH: searchPath,
      REA_JADX_MCP_JAR: jar,
      REA_JADX_OPERATION_TIMEOUT_MS: "5000",
      REA_FAKE_JADX_CLASS_COUNT: "0",
    });
    const service = new AndroidAnalysisService(provider);
    const previousCwd = process.cwd();
    try {
      process.chdir(directories[0]!);
      const availability = await provider.inspectAvailability();
      expect(availability, JSON.stringify(availability)).toMatchObject({
        status: "available",
      });
      const first = await service.execute("inspect_android_package", {
        path: apk,
      });
      if (!first.ok) throw first.error;
      const firstStarts = (await readFile(logPath(directories[0]!), "utf8"))
        .trim()
        .split("\n");
      expect(firstStarts).toHaveLength(3);
      const firstWorkspace = firstStarts.at(-1)!;
      expect(firstWorkspace).not.toBe(directories[0]);
      process.chdir(directories[1]!);
      const second = await service.execute("inspect_android_package", {
        path: apk,
      });
      if (!second.ok) throw second.error;
      expect(second.value.subject?.digest.sha256).toBe(
        first.value.subject?.digest.sha256,
      );
      const secondStarts = (await readFile(logPath(directories[1]!), "utf8"))
        .trim()
        .split("\n");
      expect(secondStarts).toHaveLength(2);
      const secondWorkspace = secondStarts.at(-1)!;
      expect(secondWorkspace).not.toBe(firstWorkspace);
      await expect(access(firstWorkspace)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await provider.close();
      await expect(access(secondWorkspace)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      process.chdir(previousCwd);
      await provider.close();
    }
  },
);

// Select the provider's source hash after resolver and engine admission complete.
const failInputHashCloses = (path: string, failures: number) => {
  const originalHash = stableHash.hashStableFile;
  const originalClose = OwnedFileHandle.prototype.close;
  let hashingInput = false;
  const retained = new Set<OwnedFileHandle>();
  const owners: OwnedFileHandle[] = [];
  const close = vi.fn(async (owner: OwnedFileHandle) => {
    owners.push(owner);
    if (owners.length <= failures)
      throw new Error("fixture input hash close unavailable");
    return originalClose.call(owner);
  });
  const hash = vi
    .spyOn(stableHash, "hashStableFile")
    .mockImplementation(async (selected, options) => {
      hashingInput = selected === path;
      try {
        return await originalHash(selected, options);
      } finally {
        hashingInput = false;
      }
    });
  const closing = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      if (!hashingInput && !retained.has(this)) return originalClose.call(this);
      retained.add(this);
      return close(this);
    });
  return {
    close,
    owners,
    restore: () => {
      closing.mockRestore();
      hash.mockRestore();
    },
  };
};

it("retains a failed input hash descriptor until provider shutdown retries it", async () => {
  const { apk, provider, launches } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const fault = failInputHashCloses(target.value.path, 2);
  const { close, owners } = fault;
  try {
    const result = await provider.execute(target.value, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(close).toHaveBeenCalledTimes(2);
    expect(owners).toHaveLength(2);
    expect(owners[0]).toBe(owners[1]);
    if (result.ok) throw new Error("Expected incomplete hash cleanup");
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(close).toHaveBeenCalledTimes(3);
    expect(owners[0]!.handle.fd).toBe(-1);
    expect(launches).toHaveLength(0);
  } finally {
    fault.restore();
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("clears hash cleanup uncertainty when the provider immediately retries the same handle", async () => {
  const { apk, provider, launches } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const fault = failInputHashCloses(target.value.path, 1);
  const { close } = fault;
  try {
    const result = await provider.execute(target.value, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("Expected the hash close failure");
    expect(close).toHaveBeenCalledTimes(2);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    expect(launches).toHaveLength(0);
  } finally {
    fault.restore();
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("drains hash descriptors even when session shutdown fails and retains its workspace", async () => {
  const { service, apk, provider, launches } = await setup();
  const initial = await service.execute("inspect_android_package", {
    path: apk,
  });
  if (!initial.ok) throw initial.error;

  const workspace = launches[0]?.cwd;
  if (workspace === undefined)
    throw new Error("Expected an acquired workspace");
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const fault = failInputHashCloses(target.value.path, 1);
  const sessionClose = vi
    .spyOn(JadxSession.prototype, "close")
    .mockRejectedValueOnce(new Error("fixture session cleanup failure"));
  try {
    const outcome = await provider.execute(target.value, {
      operation: "inspect_android_package",
      input: { path: apk },
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        cleanupResources: [expect.any(String), workspace],
      },
    });
    if (outcome.ok) throw new Error("Expected retained session cleanup");
    expect(fault.close).toHaveBeenCalledTimes(2);
    await expect(access(workspace)).resolves.toBeUndefined();

    sessionClose.mockRestore();
    fault.restore();
    await provider.close();
    expect(outcome.error.cleanupIncomplete).toBe(false);
    await verifyCleanup(launches);
  } finally {
    sessionClose.mockRestore();
    fault.restore();
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("cancels Android admission while hashing the selected APK", async () => {
  const { apk, launches, provider } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  await writeFile(apk, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await truncate(apk, 1024 * 1024 * 1024);
  const controller = new AbortController();
  const abortCause = new Error("fixture caller cancelled JADX hashing");
  const timer = setTimeout(() => controller.abort(abortCause), 100);
  try {
    const result = await provider.execute(
      target.value,
      { operation: "inspect_android_package", input: { path: apk } },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (result.ok) throw new Error("Expected Android admission cancellation");
    expect(result.error.cause).toBe(abortCause);
    expect(launches).toHaveLength(0);
  } finally {
    clearTimeout(timer);
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("preserves cancellation cause when hashing succeeded but descriptor close failed", async () => {
  const { apk, launches, provider } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const controller = new AbortController();
  const abortCause = new Error("fixture caller cancelled after hash read");
  const closeCause = new Error("fixture hash descriptor close failed");
  const owners: OwnedFileHandle[] = [];
  const originalClose = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementationOnce(async function (this: OwnedFileHandle) {
      owners.push(this);
      controller.abort(abortCause);
      throw closeCause;
    })
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      return originalClose.call(this);
    });
  try {
    const result = await provider.execute(
      target.value,
      { operation: "inspect_android_package", input: { path: apk } },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: false },
    });
    if (result.ok) throw new Error("Expected the descriptor close failure");
    expect(close).toHaveBeenCalledTimes(2);
    expect(result.error.cause).toBeInstanceOf(AggregateError);
    const causes = (result.error.cause as AggregateError).errors;
    expect(causes[0]).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect((causes[0] as Error).cause).toBe(abortCause);
    const cleanupFailure = (causes[1] as Error).cause;
    if (!(cleanupFailure instanceof RegularFileCleanupFailure))
      throw new Error("Expected the retained hash cleanup failure");
    expect(cleanupFailure.cleanupCause).toBe(closeCause);
    expect(owners[1]).toBe(owners[0]);
    expect(owners[0]?.handle.fd).toBe(-1);
    expect(launches).toHaveLength(0);
  } finally {
    close.mockRestore();
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("rejects a copied JAR that differs from its admitted session identity", async () => {
  const { jar } = await setup();
  const hashOwners: OwnedFileHandle[] = [];
  let admitted: string;
  try {
    admitted = (
      await hashStableFile(jar, {
        retainFailedClose: (owner) => hashOwners.push(owner),
      })
    ).sha256;
  } finally {
    await Promise.all(hashOwners.map((owner) => owner.close()));
  }
  await writeFile(jar, "engine changed between hashing and copying");
  const root = await PrivateRuntimeRoot.create({
    prefix: "rea-jadx-admission-",
  });
  try {
    await expect(
      snapshotAndroidEngine(
        jar,
        admitted,
        root.path,
        "inspect_android_package",
      ),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining("bytes changed"),
    });
  } finally {
    await root.close();
  }
});

it("reuses immutable engine state while keeping each Evidence observation separate", async () => {
  const { service, apk, launches, provider } = await setup();
  const first = await service.execute("inspect_android_package", { path: apk });
  if (!first.ok) throw first.error;
  const preserved = JSON.stringify(first.value);
  const second = await service.execute("inspect_android_class", {
    path: apk,
    class_name: "fixture.Target",
  });
  if (!second.ok) throw second.error;
  expect(launches).toHaveLength(1);
  expect(JSON.stringify(first.value)).toBe(preserved);
  expect(second.value.raw_result).toMatchObject({
    loaded: { class_count: 401 },
    calls: [
      expect.objectContaining({ operation: "rea_jvm_status" }),
      expect.objectContaining({ operation: "get_class_summary" }),
    ],
  });
  expect(
    androidResultSchemas.inspect_android_class.parse(
      second.value.normalized_result,
    ).engine.heap_limit_mib,
  ).toBe(8192);
  await provider.close();
  await verifyCleanup(launches);
});

it("bounds output per operation without repeating prerequisite probes for a retained session", async () => {
  const { service, apk, launches, provider, javaProbeCount } =
    await setup("large-manifest");
  const expectedManifest = "x".repeat(1024 * 1024);
  for (let index = 0; index < 34; index += 1) {
    const result = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!result.ok) throw result.error;
    expect(
      androidResultSchemas.inspect_android_package.parse(
        result.value.normalized_result,
      ).manifest.text,
    ).toBe(expectedManifest);
  }
  expect(launches).toHaveLength(1);
  expect(await javaProbeCount()).toBe(1);
  await provider.close();
  await verifyCleanup(launches);
});

it("retire sessions when APK bytes, engine bytes or JVM options change", async () => {
  const { service, apk, jar, launches, provider, environment, javaProbeCount } =
    await setup();
  const inspect = async () => {
    const result = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!result.ok) throw result.error;
    return result.value;
  };
  const first = await inspect();
  await writeFile(
    apk,
    Buffer.concat([await readFile(apk), Buffer.from("new artifact bytes")]),
  );
  const changed = await inspect();
  expect(first.subject?.digest.sha256).toEqual(expect.any(String));
  expect(changed.subject?.digest.sha256).toEqual(expect.any(String));
  expect(changed.subject?.digest.sha256).not.toBe(first.subject?.digest.sha256);
  await verifyCleanup(launches.slice(0, 1));
  await writeJadxJarInventory(jar, ["fixture/NewEngineMarker.class"]);
  await inspect();
  environment.JAVA_TOOL_OPTIONS = "-Xmx8g";
  environment._JAVA_OPTIONS = "-XX:+UseG1GC";
  await inspect();
  expect(launches).toHaveLength(4);
  expect(await javaProbeCount()).toBe(4);
  expect(launches[3]).toMatchObject({
    javaToolOptions: "-Xmx8g",
    legacyJavaOptions: "-XX:+UseG1GC",
  });
  expect(launches[3]?.arguments).not.toContain("-Xmx512m");
  expect(launches[3]?.arguments).not.toContain("-XX:ActiveProcessorCount=1");
  await provider.close();
  await verifyCleanup(launches);
});

it("keeps one operation's JVM environment aligned with its retained session identity", async () => {
  const { service, apk, launches, provider, environment } = await setup();
  environment.JAVA_TOOL_OPTIONS = "-Xmx512m";
  const createRoot = PrivateRuntimeRoot.create.bind(PrivateRuntimeRoot);
  const allocation = vi
    .spyOn(PrivateRuntimeRoot, "create")
    .mockImplementationOnce(async (options) => {
      // Configuration and the reuse key are already admitted; launch follows
      // this asynchronous workspace boundary.
      environment.JAVA_TOOL_OPTIONS = "-Xmx8g";
      return createRoot(options);
    });
  try {
    const first = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!first.ok) throw first.error;
    expect(allocation).toHaveBeenCalledOnce();
    environment.JAVA_TOOL_OPTIONS = "-Xmx512m";
    const second = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!second.ok) throw second.error;
    expect(launches).toHaveLength(1);
    expect(launches[0]?.javaToolOptions).toBe("-Xmx512m");
  } finally {
    allocation.mockRestore();
    await provider.close();
    await verifyCleanup(launches);
  }
});

it("retires an idle engine and starts a fresh one for a later request", async () => {
  const { service, apk, launches, provider } = await setup();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const first = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!first.ok) throw first.error;
    vi.advanceTimersByTime(60_000);
  } finally {
    vi.useRealTimers();
  }
  await expect
    .poll(async () => {
      try {
        await verifyCleanup(launches);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  const later = await service.execute("inspect_android_package", { path: apk });
  if (!later.ok) throw later.error;
  expect(launches).toHaveLength(2);
  await provider.close();
  await verifyCleanup(launches);
});

it("keeps idle retirement after refusing a mapping for a loaded engine", async () => {
  const { service, apk, launches, provider } = await setup();
  const missing = `${await createTestTempDirectory("rea-jadx-mapping-")}/mapping.txt`;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const first = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!first.ok) throw first.error;
    const refused = await service.execute("inspect_android_class", {
      path: apk,
      class_name: "example.Missing",
      mapping_path: missing,
    });
    expect(refused.ok).toBe(false);
    vi.advanceTimersByTime(60_000);
  } finally {
    vi.useRealTimers();
  }
  await expect
    .poll(async () => {
      try {
        await verifyCleanup(launches);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  expect(launches).toHaveLength(1);
  await provider.close();
});

it("completes large class inventories with exact case-sensitive search semantics", async () => {
  const { service, apk, provider } = await setup("large-inventory");
  const full = await service.execute("search_android_classes", {
    path: apk,
    query: "",
  });
  if (!full.ok) throw full.error;
  const inventory = androidResultSchemas.search_android_classes.parse(
    full.value.normalized_result,
  );
  expect(inventory.matches).toHaveLength(9001);
  expect(inventory.matches.at(-1)).toBe("fixture.Class8999");
  const mixedCase = await service.execute("search_android_classes", {
    path: apk,
    query: "target",
  });
  if (!mixedCase.ok) throw mixedCase.error;
  expect(
    androidResultSchemas.search_android_classes.parse(
      mixedCase.value.normalized_result,
    ).matches,
  ).toEqual([]);
  await provider.close();
});

it("close cancels active and queued work and prevents later acquisition", async () => {
  const { service, apk, launches, provider } = await setup("stall");
  const active = service.execute("inspect_android_package", { path: apk });
  await expect.poll(() => launches.length).toBe(1);
  const queued = service.execute("inspect_android_package", { path: apk });
  await provider.close();
  for (const result of [
    await active,
    await queued,
    await service.execute("inspect_android_package", { path: apk }),
  ])
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  expect(launches).toHaveLength(1);
  await verifyCleanup(launches);
});

it("does not carry a factory instance's cleanup failure into another instance", async () => {
  const failed = await setup("cleanup-failure");
  const healthy = await setup();
  const failure = await failed.service.execute("inspect_android_package", {
    path: failed.apk,
  });
  expect(failure).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const result = await healthy.service.execute("inspect_android_package", {
    path: healthy.apk,
  });
  expect(result.ok).toBe(true);
  await healthy.provider.close();
  await verifyCleanup(healthy.launches);
});

it("retains APK identity, original input, raw producer data and normalized observations", async () => {
  const { service, apk, launches, provider } = await setup();
  const outcome = await service.execute("inspect_android_package", {
    path: apk,
  });
  if (!outcome.ok) throw outcome.error;
  const result = androidResultSchemas.inspect_android_package.parse(
    outcome.value.normalized_result,
  );
  expect(result.package_name).toBe("fixture");
  expect(result.engine.source_revision).toBeNull();
  expect(outcome.value.subject?.local_path).toBe(apk);
  expect(outcome.value.parameters).toEqual({ path: apk });
  expect(outcome.value.raw_result).toMatchObject({
    calls: expect.arrayContaining([
      expect.objectContaining({ operation: "get_android_manifest" }),
    ]),
  });
  await provider.close();
  await verifyCleanup(launches);
});

it("pages matching classes independently of the total APK class count", async () => {
  const { service, apk, launches, provider } = await setup("large-inventory");
  const outcome = await service.execute("search_android_classes", {
    path: apk,
    query: "Class",
  });
  if (!outcome.ok) throw outcome.error;
  const result = androidResultSchemas.search_android_classes.parse(
    outcome.value.normalized_result,
  );
  expect(result.total_classes).toBe(9001);
  expect(result.matches).toHaveLength(9000);
  expect(result.matches[0]).toBe("fixture.Class0");
  expect(result.matches[4096]).toBe("fixture.Class4096");
  expect(result.matches.at(-1)).toBe("fixture.Class8999");
  await provider.close();
  await verifyCleanup(launches);
});

it("preserves duplicate class-name rows and occurrence counts", async () => {
  const { service, apk, launches, provider } = await setup(
    "duplicate-class-name",
  );
  const outcome = await service.execute("search_android_classes", {
    path: apk,
    query: "fixture.Target",
  });
  if (!outcome.ok) throw outcome.error;
  const result = androidResultSchemas.search_android_classes.parse(
    outcome.value.normalized_result,
  );
  expect(result.total_classes).toBe(402);
  expect(result.matches).toEqual(["fixture.Target", "fixture.Target"]);
  expect(result.duplicate_names).toEqual([
    { name: "fixture.Target", occurrences: 2 },
  ]);
  const full = await service.execute("search_android_classes", {
    path: apk,
    query: "",
  });
  if (!full.ok) throw full.error;
  const fullResult = androidResultSchemas.search_android_classes.parse(
    full.value.normalized_result,
  );
  expect(fullResult.total_classes).toBe(402);
  expect(fullResult.matches).toHaveLength(402);
  expect(fullResult.duplicate_names).toEqual([
    { name: "fixture.Target", occurrences: 2 },
  ]);
  await provider.close();
  await verifyCleanup(launches);
});

it("exposes overload candidates and executes only an explicitly selected ambiguous method", async () => {
  const { service, apk, launches, provider } = await setup();
  const input = {
    path: apk,
    class_name: "fixture.Target",
    method_name: "choose",
  };
  const ambiguous = await service.execute("inspect_android_method", input);
  expect(ambiguous).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["overload_index"],
          message: expect.stringContaining("1: choose(int)"),
        },
      ],
    },
  });
  const selected = await service.execute("inspect_android_method", {
    ...input,
    overload_index: 1,
  });
  if (!selected.ok) throw selected.error;
  const result = androidResultSchemas.inspect_android_method.parse(
    selected.value.normalized_result,
  );
  expect(result.method).toMatchObject({
    overload_index: 1,
    reported_signature: "choose(int): void",
    dex_descriptor: "(I)V",
  });
  expect(result.source.text).toContain("overload 1");
  const references = await service.execute("trace_android_references", input);
  expect(references).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [expect.objectContaining({ path: ["overload_index"] })],
    },
  });
  const selectedReferences = await service.execute("trace_android_references", {
    ...input,
    overload_index: 1,
  });
  if (!selectedReferences.ok) throw selectedReferences.error;
  expect(
    androidResultSchemas.trace_android_references.parse(
      selectedReferences.value.normalized_result,
    ),
  ).toMatchObject({
    overload_index: 1,
    reported_signature: "choose(int): void",
  });
  await provider.close();
  await verifyCleanup(launches);
});

it.each([
  "wrong-apk",
  "empty-page",
  "summary-error",
  "wrong-method",
  "wrong-descriptor",
  "partial-xrefs",
])(
  "rejects producer failure %s rather than claiming complete analysis",
  async (mode) => {
    const { service, apk, launches, provider } = await setup(mode);
    const operation =
      mode === "wrong-apk"
        ? "inspect_android_package"
        : mode === "empty-page"
          ? "search_android_classes"
          : mode === "partial-xrefs"
            ? "trace_android_references"
            : "inspect_android_method";
    const outcome = await service.execute(operation, {
      path: apk,
      ...(operation === "search_android_classes"
        ? { query: "" }
        : operation === "inspect_android_package"
          ? {}
          : { class_name: "fixture.Target", method_name: "onCreate" }),
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError" },
    });
    await provider.close();
    await verifyCleanup(launches);
  },
);

it("rejects fuzzy class resolution and unsupported upstream versions", async () => {
  for (const mode of ["wrong-class", "version", "engine-version"]) {
    const { service, apk, launches, provider } = await setup(mode);
    const outcome = await service.execute("inspect_android_class", {
      path: apk,
      class_name: "fixture.Target",
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        _tag:
          mode === "version" || mode === "engine-version"
            ? "AnalysisCapabilityUnavailableError"
            : "AnalysisInputError",
      },
    });
    await provider.close();
    await verifyCleanup(launches);
  }
});

it.each(["truncated", "smali"])(
  "retains %s source coverage instead of presenting it as successful complete Java",
  async (mode) => {
    const { service, apk, launches, provider } = await setup(mode);
    const outcome = await service.execute("inspect_android_method", {
      path: apk,
      class_name: "fixture.Target",
      method_name: "onCreate",
    });
    if (!outcome.ok) throw outcome.error;
    const result = androidResultSchemas.inspect_android_method.parse(
      outcome.value.normalized_result,
    );
    expect(result.source.status).toBe(
      mode === "truncated" ? "partial" : "complete",
    );
    expect(result.representation).toBe(mode === "smali" ? "smali" : "java");
    if (mode === "truncated")
      expect(result.source.reported_total_bytes).toBe(100);
    else expect(result.fell_back).toBe(true);
    await provider.close();
    await verifyCleanup(launches);
  },
);

it("cancels active and queued requests, cleans ownership and never launches a queued cancelled request", async () => {
  const { service, apk, launches, provider } = await setup("stall");
  const activeController = new AbortController();
  const active = service.execute(
    "inspect_android_package",
    { path: apk },
    { signal: activeController.signal },
  );
  await expect.poll(() => launches.length).toBe(1);
  const queuedController = new AbortController();
  const queued = service.execute(
    "inspect_android_package",
    { path: apk },
    { signal: queuedController.signal },
  );
  queuedController.abort();
  expect(await queued).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(launches).toHaveLength(1);
  activeController.abort();
  expect(await active).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  await provider.close();
  await verifyCleanup(launches);
});

it("ends each queued stalled operation at the caller-selected deadline and cleans ownership", async () => {
  const { service, apk, launches, provider } = await setup(
    "stall",
    undefined,
    undefined,
    { REA_JADX_OPERATION_TIMEOUT_MS: "1500" },
  );
  const started = performance.now();
  // The second request waits behind the first; its deadline starts at the
  // queue front, so it gets its own engine launch and runtime reply.
  const outcomes = await Promise.all([
    service.execute("inspect_android_package", { path: apk }),
    service.execute("inspect_android_package", { path: apk }),
  ]);
  expect(performance.now() - started).toBeLessThan(20_000);
  for (const outcome of outcomes) {
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisTimeoutError",
        timeoutMs: 1500,
        partialObservation: {
          calls: [expect.objectContaining({ operation: "rea_jvm_status" })],
        },
      },
    });
    if (outcome.ok) throw new Error("Expected the selected deadline");
    expect(projectAnalysisError(outcome.error)).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 1500 },
    });
  }
  expect(launches).toHaveLength(2);
  // The deadline path itself releases ownership before provider shutdown.
  await verifyCleanup(launches);
  await provider.close();
});

it("completes an operation under the largest accepted deadline", async () => {
  const { service, apk, provider, launches } = await setup(
    "normal",
    undefined,
    undefined,
    { REA_JADX_OPERATION_TIMEOUT_MS: "2147483647" },
  );
  const outcome = await service.execute("inspect_android_package", {
    path: apk,
  });
  expect(outcome.ok).toBe(true);
  await provider.close();
  await verifyCleanup(launches);
});

it.each(["", "2147483648"])(
  "rejects REA_JADX_OPERATION_TIMEOUT_MS=%j before probing or launching Java",
  async (value) => {
    const { service, apk, launches, javaProbeCount } = await setup(
      "normal",
      undefined,
      undefined,
      { REA_JADX_OPERATION_TIMEOUT_MS: value },
    );
    const outcome = await service.execute("inspect_android_package", {
      path: apk,
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        reason: expect.stringContaining("REA_JADX_OPERATION_TIMEOUT_MS"),
      },
    });
    expect(launches).toHaveLength(0);
    // The fake JDK records each module-listing probe; none may have run.
    await expect(javaProbeCount()).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("bounds each upstream call by the selected deadline instead of a fixed limit", async () => {
  // Provider workflows cannot reach the former fixed 120-second call limit in
  // a test, so exercise the session boundary that owns each upstream call.
  const { apk } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  const workspace = await createTestTempDirectory("rea-jadx-call-deadline-");
  const pids: number[] = [];
  const session = new JadxSession(
    {
      command: process.execPath,
      arguments: [],
      cwd: workspace,
      hostEnvironment: process.env,
      signal: new AbortController().signal,
    },
    async (options) => {
      const spawned = await spawnOwnedProviderProcess({
        ...options,
        command: process.execPath,
        arguments: [
          fileURLToPath(
            new URL("../../fixtures/android/jadx-mcp.mjs", import.meta.url),
          ),
        ],
        expectedCommand: process.execPath,
        env: { ...options.env, REA_FAKE_JADX_MODE: "stall" },
      });
      if (spawned.process.pid !== undefined) pids.push(spawned.process.pid);
      return spawned;
    },
  );
  onTestFinished(() => session.close());
  try {
    const started = performance.now();
    await expect(
      session.execute({
        request: { operation: "inspect_android_package", input: { path: apk } },
        target: target.value,
        snapshot: apk,
        jarHash: "0".repeat(64),
        bridgeHash: "0".repeat(64),
        signal: new AbortController().signal,
        timeoutMs: 300,
        resources: new ArtifactResourceScope(),
        deadline: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: SdkErrorCode.RequestTimeout,
      data: { timeout: 300 },
    });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(session.partialObservation()?.calls).toEqual([
      expect.objectContaining({ operation: "rea_jvm_status" }),
    ]);
  } finally {
    await session.close();
  }
  expect(pids).toHaveLength(1);
  for (const pid of pids)
    expect(() => process.kill(-pid, 0)).toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
});

it("reports missing explicit tools without trying to install or launch them", async () => {
  const { apk } = await setup();
  const provider = new JadxProvider({}, () => {
    throw new Error("must not launch");
  });
  const outcome = await new AndroidAnalysisService(provider).execute(
    "inspect_android_package",
    { path: apk },
  );
  expect(outcome).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining("REA_JADX_MCP_JAR"),
    },
  });
});

it.each(["tool-error", "frame-overflow", "body-error", "heap-decoy"])(
  "preserves the actual failed provider constraint for %s",
  async (mode) => {
    const { service, apk, launches, provider } = await setup(mode);
    const outcome = await service.execute(
      mode === "body-error"
        ? "inspect_android_method"
        : "inspect_android_package",
      {
        path: apk,
        ...(mode === "body-error"
          ? { class_name: "fixture.Target", method_name: "onCreate" }
          : {}),
      },
    );
    if (outcome.ok) throw new Error("Expected a provider failure");
    if (mode !== "frame-overflow")
      expect(outcome.error).toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: {
          upstream_operation:
            mode === "body-error"
              ? "get_method_body"
              : mode === "heap-decoy"
                ? "load_apk"
                : "get_android_manifest",
          reason:
            mode === "body-error"
              ? "// ERROR: decompile timed out or failed"
              : mode === "heap-decoy"
                ? "load failed: cannot read /inputs/Java heap space.apk"
                : "manifest decoder rejected malformed binary XML",
        },
      });
    else
      expect(outcome.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: expect.stringContaining("MCP frame exceeds"),
      });
    await provider.close();
    await verifyCleanup(launches);
  },
);

it.each(["heap-failure", "other-memory-failure"])(
  "projects typed JVM memory failure and cleans its process for %s",
  async (mode) => {
    const { service, apk, launches, provider } = await setup(mode);
    const outcome = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (outcome.ok) throw new Error("Expected memory allocation failure");
    expect(outcome.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "memory",
      retryable: false,
      reportedLimits: {
        observed_max_heap_bytes: 67108864,
        memory_area: mode === "heap-failure" ? "heap" : "unknown",
      },
      diagnostics: { upstream_operation: "load_apk", target_path: apk },
    });
    const projected = projectAnalysisError(outcome.error);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      retryable: false,
    });
    expect(projected.remediation.action).toContain(
      mode === "heap-failure"
        ? "REA_JADX_HEAP_MIB"
        : "increasing heap alone may not help",
    );
    await provider.close();
    await verifyCleanup(launches);
  },
);

it("retains typed memory failure through failed cleanup and restores it after retry", async () => {
  let fails = true;
  const { service, apk, launches, provider } = await setup(
    "heap-failure",
    () => fails,
  );
  const originalRootClose = PrivateRuntimeRoot.prototype.close;
  const workspaceCloseCause = new Error("fixture workspace close failure");
  let workspaceCloseFails = true;
  let workspaceCloseAttempts = 0;
  const rootClose = vi
    .spyOn(PrivateRuntimeRoot.prototype, "close")
    .mockImplementation(function (this: PrivateRuntimeRoot) {
      // Independent native helpers own their own roots. Keep the acquired
      // Android workspace's failure active until the test explicitly clears it.
      if (this.path === launches[0]?.cwd) {
        workspaceCloseAttempts += 1;
        if (workspaceCloseFails) return Promise.reject(workspaceCloseCause);
      }
      return originalRootClose.call(this);
    });
  try {
    const result = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (result.ok) throw new Error("Expected failed memory cleanup");
    const failure = result.error;
    expect(failure.cleanupIncomplete).toBe(true);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: { primary_error: { code: "resource_constraint" } },
      },
    });
    const workspace = launches[0]?.cwd;
    expect(failure.cleanupResources).toContain(workspace);
    expect(workspaceCloseAttempts).toBe(0);
    fails = false;
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(failure.cleanupResources).toEqual([workspace]);
    expect(workspaceCloseAttempts).toBeGreaterThan(0);
    workspaceCloseFails = false;
    await provider.close();
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      remediation: { action: expect.stringContaining("REA_JADX_HEAP_MIB") },
      details: {
        resource: "memory",
        reported_limits: { observed_max_heap_bytes: 67108864 },
      },
    });
    await verifyCleanup(launches);
  } finally {
    rootClose.mockRestore();
    workspaceCloseFails = false;
    fails = false;
    await provider.close();
  }
});

it("rejects bytes changed after target admission without launching an engine", async () => {
  const { provider, apk, launches } = await setup();
  const target = await parseBinaryTarget(apk);
  if (!target.ok) throw target.error;
  await writeFile(
    apk,
    Buffer.concat([
      await readFile(apk),
      Buffer.from("changed after admission"),
    ]),
  );
  const outcome = await provider.execute(target.value, {
    operation: "inspect_android_package",
    input: { path: apk },
  });
  expect(outcome).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [{ message: expect.stringContaining("bytes changed") }],
    },
  });
  expect(launches).toHaveLength(0);
});

it("retains an uncertain workspace and blocks later launches after cleanup cannot be verified", async () => {
  const { service, apk, launches } = await setup("cleanup-failure");
  const outcome = await service.execute("inspect_android_package", {
    path: apk,
  });
  expect(outcome).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true },
  });
  const workspace = launches[0]?.cwd;
  if (workspace === undefined) throw new Error("Expected acquired workspace");
  await expect(access(workspace)).resolves.toBeUndefined();
  expect(
    await service.execute("inspect_android_package", { path: apk }),
  ).toMatchObject({ ok: false, error: { cleanupIncomplete: true } });
  expect(launches).toHaveLength(1);
});

it("resolves every reported shutdown cleanup failure after ownership recovers", async () => {
  let cleanupFails = true;
  const { service, apk, launches, provider } = await setup(
    "normal",
    () => cleanupFails,
  );
  const closeAfterRecovery = async () => {
    cleanupFails = false;
    // Closing the transport can leave the child between live and exited
    // snapshots. Retry retained ownership until cleanup is actually verified.
    await expect
      .poll(() => provider.close(), { timeout: 5_000 })
      .toBeUndefined();
  };
  try {
    const outcome = await service.execute("inspect_android_package", {
      path: apk,
    });
    if (!outcome.ok) throw outcome.error;
    const firstClose = provider.close();
    expect(provider.close()).toBe(firstClose);
    const firstFailure = await firstClose.then(
      () => {
        throw new Error("Expected shutdown cleanup to remain incomplete");
      },
      (cause: unknown) => cause,
    );
    expect(firstFailure).toMatchObject({ cleanupIncomplete: true });
    expect(firstFailure).toHaveProperty("cause", expect.any(AggregateError));
    const secondFailure = await provider.close().then(
      () => {
        throw new Error(
          "Expected the second cleanup retry to remain incomplete",
        );
      },
      (cause: unknown) => cause,
    );
    expect(secondFailure).toMatchObject({ cleanupIncomplete: true });
    expect(secondFailure).toHaveProperty("cause", expect.any(AggregateError));
    const workspace = launches[0]?.cwd;
    if (workspace === undefined) throw new Error("Expected acquired workspace");
    await expect(access(workspace)).resolves.toBeUndefined();
    await closeAfterRecovery();
    expect(firstFailure).toMatchObject({ cleanupIncomplete: false });
    expect(secondFailure).toMatchObject({ cleanupIncomplete: false });
    await verifyCleanup(launches);
    expect(launches).toHaveLength(1);
  } finally {
    await closeAfterRecovery();
  }
});

it.each(["idle", "target-change"])(
  "retries %s retirement before acquiring another engine",
  async (retirement) => {
    let cleanupFails = true;
    let cleanupAttempts = 0;
    const { service, apk, jar, launches, provider } = await setup(
      "normal",
      () => {
        cleanupAttempts += 1;
        return cleanupFails;
      },
    );
    try {
      if (retirement === "idle")
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const first = await service.execute("inspect_android_package", {
        path: apk,
      });
      if (!first.ok) throw first.error;
      if (retirement === "idle") {
        vi.advanceTimersByTime(60_000);
        vi.useRealTimers();
        await expect.poll(() => cleanupAttempts).toBeGreaterThan(0);
      } else {
        await writeJadxJarInventory(jar, ["fixture/NewEngineMarker.class"]);
        expect(
          await service.execute("inspect_android_package", { path: apk }),
        ).toMatchObject({
          ok: false,
          error: { cleanupIncomplete: true },
        });
      }
      const workspace = launches[0]?.cwd;
      if (workspace === undefined)
        throw new Error("Expected acquired workspace");
      await expect(access(workspace)).resolves.toBeUndefined();
      expect(launches).toHaveLength(1);
      cleanupFails = false;
      const retried = await service.execute("inspect_android_package", {
        path: apk,
      });
      if (!retried.ok) throw retried.error;
      expect(launches).toHaveLength(2);
      await provider.close();
      await verifyCleanup(launches);
    } finally {
      vi.useRealTimers();
      cleanupFails = false;
      await provider.close();
    }
  },
);

it("retains the execution failure while cleanup is pending and resumes after cleanup recovers", async () => {
  let cleanupFails = true;
  const { service, apk, launches, provider } = await setup(
    "tool-error",
    () => cleanupFails,
  );
  try {
    const outcome = await service.execute("inspect_android_package", {
      path: apk,
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: true,
        diagnostics: {
          primary_error: {
            details: {
              diagnostics: {
                reason: "manifest decoder rejected malformed binary XML",
              },
            },
          },
        },
      },
    });
    if (outcome.ok) throw new Error("Expected cleanup failure");
    expect(outcome.error.cause).toBeInstanceOf(AggregateError);
    const causes = (outcome.error.cause as AggregateError).errors;
    expect(causes[0]).toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: {
        reason: "manifest decoder rejected malformed binary XML",
      },
    });
    expect(
      await service.execute("inspect_android_package", { path: apk }),
    ).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true },
    });
    expect(launches).toHaveLength(1);
    cleanupFails = false;
    const retried = await service.execute("inspect_android_package", {
      path: apk,
    });
    expect(retried).toMatchObject({
      ok: false,
      error: {
        cleanupIncomplete: false,
        diagnostics: {
          reason: "manifest decoder rejected malformed binary XML",
        },
      },
    });
    expect(launches).toHaveLength(2);
    expect(outcome.error.cleanupIncomplete).toBe(false);
    expect(outcome.error.cleanupResources).toEqual([]);
    expect(projectAnalysisError(outcome.error)).toMatchObject({
      code: "execution_failure",
      details: {
        diagnostics: {
          reason: "manifest decoder rejected malformed binary XML",
        },
      },
    });
    await verifyCleanup(launches);
  } finally {
    cleanupFails = false;
    await provider.close();
  }
});

it("accepts exact selected-overload smali from the bridge", async () => {
  const { service, apk, launches, provider } = await setup(
    "selected-overload-smali",
  );
  const outcome = await service.execute("inspect_android_method", {
    path: apk,
    class_name: "fixture.Target",
    method_name: "choose",
    overload_index: 1,
  });
  if (!outcome.ok) throw outcome.error;
  const result = androidResultSchemas.inspect_android_method.parse(
    outcome.value.normalized_result,
  );
  expect(result).toMatchObject({
    method: { overload_index: 1, dex_descriptor: "(I)V" },
    representation: "smali",
    body_status: "available",
  });
  await provider.close();
  await verifyCleanup(launches);
});

it("retains parsed native body absence without claiming an empty implementation", async () => {
  const { service, apk, launches, provider } = await setup("native-method");
  const outcome = await service.execute("inspect_android_method", {
    path: apk,
    class_name: "fixture.Target",
    method_name: "onCreate",
  });
  if (!outcome.ok) throw outcome.error;
  const result = androidResultSchemas.inspect_android_method.parse(
    outcome.value.normalized_result,
  );
  expect(result.body_status).toBe("not_available");
  expect(result.source.text).toBe("");
  expect(result.markers).toEqual(["native_method"]);
  await provider.close();
  await verifyCleanup(launches);
});
