import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { beforeAll, expect, it as test, vi } from "vitest";
import { inspectJadxJava } from "../../../src/android/JadxJavaProbe.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  observeOwnedProcessGroups,
  prepareProcessOwnershipInspection,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { writeFile, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createJadxProtocolFixture } from "../../fixtures/android/jadx.js";
import { inspectJadxProvider } from "../../../src/android/JadxDoctor.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real idle Node commands exercise ownership; they do not establish JVM behavior.
beforeAll(() => prepareProcessOwnershipInspection());
const it = test.skipIf(process.platform === "win32");
type Launched = Awaited<ReturnType<typeof spawnOwnedProviderProcess>>;
const modules = "java.base@21\njdk.compiler@21\n";

const expectEmpty = async (launched: Launched) => {
  const observed = await observeOwnedProcessGroups(launched.ownership.runId, [
    launched.ownership.processGroupId,
  ]);
  expect(observed.get(launched.ownership.processGroupId)).toEqual({
    state: "empty",
  });
};

it.each([
  null,
  { caller: "opaque" },
  new ProviderCleanupError("foreign", ["/foreign/resource"], {
    reason: "foreign cleanup",
  }),
])(
  "joins active Java cancellation with exact opaque reason %j",
  async (reason) => {
    const resources = createInspectionResources();
    const caller = new AbortController();
    let launched: Launched | undefined;
    try {
      const pending = inspectJadxJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          signal: caller.signal,
          timeoutMs: 2500,
          launcher: async (input) => {
            launched = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                'process.stdout.write("READY"); setInterval(() => {}, 1000)',
              ],
            });
            launched.process.stdout?.once("data", () => caller.abort(reason));
            return launched;
          },
        },
      );
      const error: unknown = await pending.catch((cause: unknown) => cause);
      expect(error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cleanupIncomplete: false,
      });
      if (!(error instanceof AnalysisError) || launched === undefined)
        throw new Error("Expected owned cancellation");
      expect(error.cause).toBe(reason);
      expect(error.cleanupResources).not.toContain("/foreign/resource");
      if (reason instanceof ProviderCleanupError)
        expect(reason.cleanupIncomplete).toBe(true);
      await expectEmpty(launched);
    } finally {
      caller.abort(reason);
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

it.each([true, false])(
  "keeps completed Java module facts across cleanup cancellation (valid: %s)",
  async (valid) => {
    const resources = createInspectionResources();
    const caller = new AbortController();
    const reason = { caller: "cleanup interruption" };
    let launched: Launched | undefined;
    try {
      const result: unknown = await inspectJadxJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          signal: caller.signal,
          timeoutMs: 2500,
          launcher: async (input) => {
            const child = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                `process.stdout.write(${JSON.stringify(valid ? modules : "java.base@21\n")})`,
              ],
            });
            launched = child;
            return {
              ...child,
              cleanup: async () => {
                const cleaned = await cleanupOwnedProcessGroup(child.ownership);
                caller.abort(reason);
                return cleaned;
              },
            };
          },
        },
      ).catch((cause: unknown) => cause);
      if (valid) {
        expect(result).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
          diagnostics: {
            java_module_observation: { compiler: true, major: 21 },
          },
          capturedOutput: { stdout: modules, truncated: false },
        });
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: "runtime_missing",
            kind: "java_runtime",
            diagnostics: { jdk_compiler: false, stdout: "java.base@21\n" },
          },
        });
      }
      if (launched === undefined) throw new Error("Expected a launched probe");
      await expectEmpty(launched);
    } finally {
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

it.each([true, false])(
  "retains cleanup and blocks replacement probes until exact retry (valid: %s)",
  async (valid) => {
    const resources = createInspectionResources();
    let failing = true;
    let launches = 0;
    let launched: Launched | undefined;
    const probe = () =>
      inspectJadxJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          timeoutMs: 2500,
          launcher: async (input) => {
            launches++;
            const child = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                `process.stdout.write(${JSON.stringify(valid ? modules : "java.base@21\n")})`,
              ],
            });
            launched = child;
            return {
              ...child,
              cleanup: async () =>
                failing
                  ? {
                      cleaned: false as const,
                      reason: "controlled ownership verification failure",
                    }
                  : cleanupOwnedProcessGroup(child.ownership),
            };
          },
        },
      );
    try {
      const error: unknown = await probe().catch((cause: unknown) => cause);
      if (!(error instanceof AnalysisError))
        throw new Error("Expected retained cleanup error");
      expect(error.cleanupIncomplete).toBe(true);
      expect(error.cleanupResources.length).toBeGreaterThan(0);
      if (valid)
        expect(error.cleanupPrimary).toMatchObject({
          diagnostics: {
            java_module_observation: { major: 21, compiler: true },
          },
        });
      else
        expect(error.cleanupPrimary).toMatchObject({
          _tag: "AnalysisCapabilityUnavailableError",
        });
      const retry: unknown = await probe().catch((cause: unknown) => cause);
      expect(retry).toBeInstanceOf(AnalysisError);
      if (retry instanceof AnalysisError)
        expect(retry.cleanupResources).toEqual(error.cleanupResources);
      expect(launches).toBe(1);
      failing = false;
      const recovered = await probe();
      expect(recovered.ok).toBe(valid);
      expect(launches).toBe(2);
      expect(error.cleanupIncomplete).toBe(false);
      expect(error.cleanupResources).toEqual([]);
      if (!valid)
        expect(projectAnalysisError(error).code).toBe("capability_unavailable");
      if (!valid)
        expect(error.cleanupPrimary?.diagnostics).toMatchObject({
          jdk_compiler: false,
          phase: "module-inspection",
        });
    } finally {
      failing = false;
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

it("uses the operation deadline's exact reason while joining the Java probe", async () => {
  const resources = createInspectionResources();
  const deadline = new AbortController();
  const reason = new Error("whole Android operation deadline");
  let launched: Launched | undefined;
  try {
    const outcome: unknown = await inspectJadxJava(
      process.execPath,
      {},
      {
        resourceOwner: resources.owner,
        signal: deadline.signal,
        operation: "inspect_android_package",
        operationDeadline: { signal: deadline.signal, timeoutMs: 2000 },
        timeoutMs: 2500,
        launcher: async (input) => {
          launched = await spawnOwnedProviderProcess({
            ...input,
            arguments: [
              "-e",
              'process.stdout.write("READY"); setInterval(() => {}, 1000)',
            ],
          });
          launched.process.stdout?.once("data", () => deadline.abort(reason));
          return launched;
        },
      },
    ).catch((cause: unknown) => cause);
    expect(outcome).toMatchObject({
      _tag: "AnalysisTimeoutError",
      cause: reason,
      operation: "inspect_android_package",
    });
    if (launched === undefined)
      throw new Error("Expected owned deadline probe");
    await expectEmpty(launched);
  } finally {
    await resources.close();
    if (launched !== undefined)
      expect((await cleanupOwnedProcessGroup(launched.ownership)).cleaned).toBe(
        true,
      );
  }
});

it.each(["0", "9007199254740993", "9".repeat(400)])(
  "refuses an unrepresentable Java major %s without losing its source value",
  async (major) => {
    const resources = createInspectionResources();
    let launched: Launched | undefined;
    try {
      const result = await inspectJadxJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          timeoutMs: 2500,
          launcher: async (input) => {
            launched = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                `process.stdout.write(${JSON.stringify(`java.base@${major}\njdk.compiler@21\n`)})`,
              ],
            });
            return launched;
          },
        },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "version_unresolved",
          diagnostics: { java_major: null, unparsed_java_major: major },
        },
      });
    } finally {
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

it("joins concurrent provider readiness on shutdown while an independent doctor probe remains owned", async () => {
  const f = await createJadxProtocolFixture();
  const resources = createInspectionResources();
  const doctor = new AbortController();
  const marker = join(dirname(f.apk), "readiness-processes");
  const java = join(f.environment.JAVA_HOME!, "bin", "java");
  await writeFile(
    java,
    String.raw`#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(marker)}, String(process.pid) + "\n");
process.stdout.write(String(process.pid));
process.on("SIGTERM", () => {});
setTimeout(() => process.exit(99), 10000);
`,
  );
  const first = f.provider
    .inspectAvailability()
    .catch((cause: unknown) => cause);
  const second = f.provider
    .inspectAvailability()
    .catch((cause: unknown) => cause);
  let doctorSettled = false;
  const independent = inspectJadxProvider(
    f.environment,
    resources.owner,
    doctor.signal,
  ).then(
    (value) => {
      doctorSettled = true;
      return value;
    },
    (cause: unknown) => {
      doctorSettled = true;
      return cause;
    },
  );
  const pids = () =>
    readFile(marker, "utf8").then(
      (value) => value.trim().split("\n").map(Number),
      () => [],
    );
  try {
    await expect.poll(async () => (await pids()).length).toBe(3);
    await f.provider.close();
    const cancelled = await Promise.all([first, second]);
    for (const error of cancelled)
      expect(error).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(doctorSettled).toBe(false);
    doctor.abort("stop independent doctor");
    expect(await independent).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: "stop independent doctor",
    });
    for (const pid of await pids()) {
      // Observation only; cleanup remains with each command's run identity.
      expect(() => process.kill(pid, 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
    }
  } finally {
    doctor.abort();
    await f.provider.close();
    await resources.close();
    await Promise.all([first, second, independent]);
  }
});

it("refuses a root's valid listing until an inherited descendant pipe is finalized", async () => {
  const resources = createInspectionResources();
  const root = await createTestTempDirectory("rea-jadx-readiness-descendant-");
  const release = join(root, "release");
  const child = String.raw`const fs = require("node:fs"); process.stdout.write("DESCENDANT_READY\n");
    setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0); }, 50);
    setTimeout(() => process.exit(92), 10000);`;
  let launched: Launched | undefined;
  try {
    const result = await inspectJadxJava(
      process.execPath,
      {},
      {
        resourceOwner: resources.owner,
        timeoutMs: 1000,
        launcher: async (input) => {
          launched = await spawnOwnedProviderProcess({
            ...input,
            arguments: [
              "-e",
              String.raw`
          const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], {detached: true, stdio: ["ignore", "inherit", "inherit"]});
          process.stdout.write(${JSON.stringify(modules)} + "DESCENDANT_GROUP:" + child.pid + "\n"); child.unref();
        `,
            ],
          });
          return launched;
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "version_unresolved",
        diagnostics: { failure: "probe_terminated", exit_code: 0 },
      },
    });
    if (result.ok || launched === undefined)
      throw new Error("Expected incomplete-output deadline");
    const group = Number(
      /DESCENDANT_GROUP:(\d+)/u.exec(
        String(result.error.diagnostics.stdout),
      )?.[1],
    );
    expect(Number.isSafeInteger(group)).toBe(true);
    const observed = await observeOwnedProcessGroups(launched.ownership.runId, [
      group,
    ]);
    expect(observed.get(group)).toEqual({ state: "empty" });
    await expectEmpty(launched);
  } finally {
    await writeFile(release, "release");
    await resources.close();
    if (launched !== undefined)
      expect(
        (
          await (launched.cleanup?.() ??
            cleanupOwnedProcessGroup(launched.ownership))
        ).cleaned,
      ).toBe(true);
  }
});

it("joins the whole availability call while its final archive close is held", async () => {
  const f = await createJadxProtocolFixture();
  let started: () => void = () => {};
  const closingArchive = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const identity = await stat(f.jar);
  const original = OwnedFileHandle.prototype.close;
  const archive = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      const observed = await this.handle.stat();
      if (observed.dev === identity.dev && observed.ino === identity.ino) {
        started();
        await held;
      }
      await original.call(this);
    });
  const availability = f.provider
    .inspectAvailability()
    .catch((cause: unknown) => cause);
  let completed = false;
  let close: Promise<void> | undefined;
  try {
    await closingArchive;
    close = f.provider.close().then(() => {
      completed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    release();
    await close;
    expect(await availability).toMatchObject({
      _tag: "AnalysisCancelledError",
    });
  } finally {
    release();
    archive.mockRestore();
    await availability.catch(() => undefined);
    await close;
    await f.provider.close();
  }
});
