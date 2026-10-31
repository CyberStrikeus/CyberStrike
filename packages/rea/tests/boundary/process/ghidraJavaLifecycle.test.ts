import { beforeAll, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { DarwinProcessOwnershipInspectionError } from "../../../src/process/DarwinProcessRunTokenReader.js";
import { probeGhidraJava } from "../../../src/ghidra/GhidraJavaProbe.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  observeOwnedProcessGroups,
  prepareProcessOwnershipInspection,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real, idle Node processes stand in for Java. These controls exercise POSIX
// process ownership and complete-output semantics, not a JVM or Ghidra.
beforeAll(() => prepareProcessOwnershipInspection());
const posix = it.skipIf(process.platform === "win32");
type Launched = Awaited<ReturnType<typeof spawnOwnedProviderProcess>>;

const expectEmpty = async (launched: Launched) => {
  const { runId, processGroupId } = launched.ownership;
  const observed = await observeOwnedProcessGroups(runId, [processGroupId]);
  expect(observed.get(processGroupId)).toEqual({ state: "empty" });
};

posix(
  "cancels an active Java prerequisite with the exact opaque reason and joins cleanup",
  async () => {
    const resources = createInspectionResources();
    const controller = new AbortController();
    const reason = { request: "cancel Java", cleanup: "opaque caller value" };
    let launched: Launched | undefined;
    try {
      const result = await probeGhidraJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          signal: controller.signal,
          timeoutMs: 2500,
          launcher: async (input) => {
            launched = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                'process.stdout.write("READY"); setInterval(() => {}, 1000)',
              ],
            });
            launched.process.stdout?.on("data", () => controller.abort(reason));
            return launched;
          },
        },
      );
      if (result.ok || launched === undefined)
        throw new Error("Expected cancellation");
      expect(result.error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
      expect((result.error as AnalysisError).cause).toBe(reason);
      await expectEmpty(launched);
    } finally {
      controller.abort(reason);
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

posix(
  "bounds a SIGTERM-resistant prerequisite while the event loop remains responsive",
  async () => {
    const resources = createInspectionResources();
    let launched: Launched | undefined;
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
    }, 50);
    try {
      const result = await probeGhidraJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          timeoutMs: 750,
          launcher: async (input) => {
            launched = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                'process.on("SIGTERM", () => {}); process.stdout.write("READY"); setInterval(() => {}, 1000)',
              ],
            });
            return launched;
          },
        },
      );
      if (result.ok || launched === undefined)
        throw new Error("Expected deadline failure");
      expect(result.error).toMatchObject({
        _tag: "GhidraJavaProbeFailure",
        processErrorCode: "ETIMEDOUT",
        output: { stdout: "READY" },
      });
      expect(timerFired).toBe(true);
      await expectEmpty(launched);
    } finally {
      clearTimeout(timer);
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);

posix.each([true, false])(
  "preserves completed Java output across final-cleanup cancellation (valid: %s)",
  async (valid) => {
    const resources = createInspectionResources();
    const controller = new AbortController();
    const reason: { cycle?: unknown } = {};
    reason.cycle = reason;
    let launched: Launched | undefined;
    try {
      const output = valid
        ? "java.version = 21.0.1\njava.home = /controlled-java-home\n"
        : "invalid Java report";
      const result = await probeGhidraJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          signal: controller.signal,
          timeoutMs: 2500,
          launcher: async (input) => {
            const acquired = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                `process.stderr.write(${JSON.stringify(output)})`,
              ],
            });
            launched = acquired;
            return {
              ...acquired,
              cleanup: async () => {
                const cleaned = await cleanupOwnedProcessGroup(
                  acquired.ownership,
                );
                controller.abort(reason);
                return cleaned;
              },
            };
          },
        },
      );
      if (result.ok || launched === undefined)
        throw new Error("Expected finalization failure");
      if (valid) {
        expect(result.error).toMatchObject({
          _tag: "AnalysisCancelledError",
          diagnostics: { java_observation: { version: "21.0.1" } },
        });
        expect((result.error as AnalysisError).cause).toBe(reason);
      } else {
        expect(result.error).toMatchObject({
          _tag: "GhidraJavaProbeFailure",
          code: "version_unresolved",
          cancellation: { reason },
        });
        expect(Object.keys(result.error)).not.toContain("cancellation");
        expect(() => JSON.stringify(result.error)).not.toThrow();
      }
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

posix(
  "does not interpret a root's zero exit while a detached descendant holds its output open",
  async () => {
    const resources = createInspectionResources();
    const root = await createTestTempDirectory("rea-java-descendant-");
    const release = join(root, "release");
    let launched: Launched | undefined;
    let descendantGroup: number | undefined;
    const child = `const fs = require("node:fs");
    process.stdout.write("DESCENDANT_READY\\n");
    setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0); }, 50);
    setTimeout(() => process.exit(92), 10000);`;
    try {
      const result = await probeGhidraJava(
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
                `
          const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], {
            detached: true, stdio: ["ignore", "inherit", "inherit"]
          });
          process.stdout.write("DESCENDANT_GROUP:" + child.pid + "\\n");
          child.unref();
        `,
              ],
            });
            return launched;
          },
        },
      );
      if (
        result.ok ||
        launched === undefined ||
        result.error._tag !== "GhidraJavaProbeFailure"
      )
        throw new Error("Expected incomplete-output deadline failure");
      expect(result.error).toMatchObject({
        processErrorCode: "ETIMEDOUT",
        output: { exit_code: 0 },
      });
      expect(result.error.output?.stdout).toContain("DESCENDANT_READY");
      descendantGroup = Number(
        /DESCENDANT_GROUP:(\d+)/u.exec(result.error.output?.stdout ?? "")?.[1],
      );
      expect(Number.isSafeInteger(descendantGroup)).toBe(true);
      const observed = await observeOwnedProcessGroups(
        launched.ownership.runId,
        [descendantGroup],
      );
      expect(observed.get(descendantGroup)).toEqual({ state: "empty" });
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
  },
);

it("retains only the preparation owner's exact failed root through cancellation and retry", async () => {
  const resources = createInspectionResources();
  const controller = new AbortController();
  const reason = new ProviderCleanupError(
    "foreign",
    ["caller-owned-resource"],
    { reason: "opaque caller error" },
  );
  const cleanup = new ProviderCleanupError(
    "process-ownership",
    ["exact-helper-root"],
    { reason: "controlled cleanup refusal" },
  );
  let denied = true;
  let closes = 0;
  try {
    const result = await probeGhidraJava(
      process.execPath,
      {},
      {
        resourceOwner: resources.owner,
        signal: controller.signal,
        launcher: async () => {
          controller.abort(reason);
          throw new DarwinProcessOwnershipInspectionError(
            "cancelled preparation with failed root cleanup",
            {
              cancellation: { reason },
              cleanupFailure: cleanup,
              cleanupOwner: {
                close: async () => {
                  closes++;
                  if (denied) throw cleanup;
                  cleanup.resolveCleanup();
                },
              },
            },
          );
        },
      },
    );
    if (result.ok || !(result.error instanceof AnalysisError))
      throw new Error("Expected retained preparation failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.cleanupResources).toEqual(["exact-helper-root"]);
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
    await expect(resources.close()).rejects.toThrow();
    denied = false;
    await resources.close();
    expect(closes).toBe(2);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(reason.cleanupIncomplete).toBe(true);
  } finally {
    denied = false;
    await resources.close();
  }
});

posix.each([true, false])(
  "retains exact cleanup authority and resolves prior errors after retry (valid: %s)",
  async (valid) => {
    const resources = createInspectionResources();
    const controller = new AbortController();
    const reason = { request: "cancel during refused cleanup" };
    let denied = true;
    let launched: Launched | undefined;
    let attempts = 0;
    try {
      const output = valid
        ? "java.version = 21.0.1\njava.home = /controlled-java-home\n"
        : "invalid Java report";
      const result = await probeGhidraJava(
        process.execPath,
        {},
        {
          resourceOwner: resources.owner,
          signal: controller.signal,
          timeoutMs: 2500,
          launcher: async (input) => {
            const acquired = await spawnOwnedProviderProcess({
              ...input,
              arguments: [
                "-e",
                `process.stderr.write(${JSON.stringify(output)})`,
              ],
            });
            launched = acquired;
            return {
              ...acquired,
              cleanup: async () => {
                attempts++;
                if (denied) {
                  controller.abort(reason);
                  return {
                    cleaned: false,
                    reason: "controlled verification refusal",
                  };
                }
                return cleanupOwnedProcessGroup(acquired.ownership);
              },
            };
          },
        },
      );
      if (
        result.ok ||
        !(result.error instanceof AnalysisError) ||
        launched === undefined
      )
        throw new Error("Expected retained cleanup error");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupPrimary?.diagnostics).toMatchObject(
        valid
          ? { java_observation: { version: "21.0.1" } }
          : { java_probe_failure: { code: "version_unresolved" } },
      );
      denied = false;
      await resources.close();
      expect(attempts).toBe(2);
      expect(result.error.cleanupIncomplete).toBe(false);
      await expectEmpty(launched);
    } finally {
      denied = false;
      await resources.close();
      if (launched !== undefined)
        expect(
          (await cleanupOwnedProcessGroup(launched.ownership)).cleaned,
        ).toBe(true);
    }
  },
);
