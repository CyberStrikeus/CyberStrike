import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it } from "vitest";

import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import {
  createKunaResourceScope,
  inspectKunaInstallation,
  kunaInstallationCancellation,
} from "../../../../src/kuna/KunaInstallation.js";
import { KunaProvider } from "../../../../src/kuna/KunaProvider.js";
import type { RetainedResourceScope } from "../../../../src/application/AnalysisProvider.js";
import { ProviderAdapterError } from "../../../../src/domain/providerAdapterError.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { RegularFileCleanupFailure } from "../../../../src/filesystem/OwnedRegularFile.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { makeLauncher, ownedGroupCleanup } from "./kunaVersionProbeProcess.js";

const writeProbe = async (
  root: string,
  modeFile: string,
  childStarted: string,
  parentExited: string,
) => {
  const executable = join(root, "kuna-probe");
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, "utf8");
process.stdout.write("kuna 1.833\\n");
process.stderr.write("x".repeat(1024));
if (mode === "hold" || mode === "detached") {
  const child = spawn(process.execPath, ["-e", ${JSON.stringify(
    `const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(childStarted)},"started");process.on("SIGTERM",()=>{});setInterval(()=>{},1000);`,
  )}], { stdio: mode === "hold" ? "inherit" : "ignore" });
  const poll = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(childStarted)})) return;
    clearInterval(poll);
    fs.writeFileSync(${JSON.stringify(parentExited)}, "exited");
    process.exit(0);
  }, 5);
}
`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  await writeFile(modeFile, "hold");
  return executable;
};

const resourceScopeFor = (
  scope: ArtifactResourceScope,
): RetainedResourceScope => ({
  retain: (owner, resource) =>
    scope.retain({
      kind: "lease",
      resource,
      lease: { release: () => owner.close() },
    }),
  run: (operation) => scope.run(operation),
});

const waitForFile = async (path: string) => {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await import("node:fs/promises").then(({ access }) => access(path));
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Timed out waiting for test marker ${path}`);
};

const target = (path: string) => ({
  path,
  sha256: createHash("sha256").update("target").digest("hex"),
  kind: "executable" as const,
  format: "elf" as const,
  architecture: "x86_64" as const,
  availableArchitectures: ["x86_64" as const],
});

it.skipIf(process.platform === "win32")(
  "bounds timeout settlement when a test-owned descendant holds stdout and preserves the captured version output",
  async () => {
    const root = await createTestTempDirectory("rea-kuna-held-version-pipe-");
    const modeFile = join(root, "mode");
    const childStarted = join(root, "child-started");
    const parentExited = join(root, "parent-exited");
    const executable = await writeProbe(
      root,
      modeFile,
      childStarted,
      parentExited,
    );
    const launcher = makeLauncher();
    const scope = new ArtifactResourceScope();
    const startedAt = Date.now();
    try {
      const result = await inspectKunaInstallation(
        { REA_KUNA_COMMAND: executable },
        {
          resourceScope: resourceScopeFor(scope),
          processLauncher: launcher.launcher,
          probeTimeoutMs: 3_000,
        },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "version_unresolved",
          diagnostics: {
            exit_code: 0,
            signal: null,
            probe_failure_reason: "timeout",
            stdout: "kuna 1.833\n",
            stderr: "x".repeat(1024),
            stdout_bytes: 11,
            stdout_observed_bytes: 11,
            stderr_bytes: 1024,
            stderr_observed_bytes: 1024,
            diagnostic_truncated: false,
            output_incomplete: false,
            output_truncated: false,
            deadline_ms: 3_000,
          },
        },
      });
      await waitForFile(childStarted);
      await waitForFile(parentExited);
      expect(Date.now() - startedAt).toBeLessThan(7_000);
      expect(scope.hasPending).toBe(false);
      expect(launcher.groups).toHaveLength(1);
    } finally {
      await scope.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a complete successful version capture unavailable until cleanup-only ownership is confirmed",
  async () => {
    const root = await createTestTempDirectory(
      "rea-kuna-cleanup-only-version-owner-",
    );
    const modeFile = join(root, "mode");
    const childStarted = join(root, "child-started");
    const parentExited = join(root, "parent-exited");
    const executable = await writeProbe(
      root,
      modeFile,
      childStarted,
      parentExited,
    );
    await writeFile(modeFile, "detached");
    let cleanupAttempts = 0;
    let allowCleanup = false;
    const launcher = makeLauncher(async (_child, pid) => {
      cleanupAttempts += 1;
      if (!allowCleanup)
        return { cleaned: false, reason: "controlled cleanup-only refusal" };
      return ownedGroupCleanup(pid);
    });
    const scope = new ArtifactResourceScope();
    const provider = new KunaProvider(
      { REA_KUNA_COMMAND: executable, REA_KUNA_CACHE_DIR: join(root, "cache") },
      { launcher: launcher.launcher },
    );
    const input = target(join(root, "target"));
    await writeFile(input.path, "target");
    const options = { resourceScope: resourceScopeFor(scope) };
    try {
      const first = await provider.resolveAnalysisProfile(input, options);
      await waitForFile(childStarted);
      await waitForFile(parentExited);
      expect(first.ok).toBe(false);
      if (first.ok)
        throw new Error("Unconfirmed cleanup cannot admit a profile");
      expect(first.error.diagnostics).toMatchObject({
        exit_code: 0,
        signal: null,
        probe_failure_reason: "process",
        cleanup_incomplete: true,
        stdout: "kuna 1.833\n",
        stderr: "x".repeat(1024),
        stdout_bytes: 11,
        stdout_observed_bytes: 11,
        stderr_bytes: 1024,
        stderr_observed_bytes: 1024,
        diagnostic_truncated: false,
        output_incomplete: false,
        output_truncated: false,
      });
      expect(scope.hasPending).toBe(true);

      const blocked = await provider.resolveAnalysisProfile(input, options);
      expect(blocked.ok).toBe(false);
      expect(launcher.launches).toBe(1);
      expect(cleanupAttempts).toBe(2);

      allowCleanup = true;
      const retried = await provider.resolveAnalysisProfile(input, options);
      expect(retried.ok).toBe(true);
      expect(launcher.launches).toBe(2);
      expect(scope.hasPending).toBe(false);
      expect(first.error.cleanupIncomplete).toBe(false);
    } finally {
      allowCleanup = true;
      await scope.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "settles caller abort after direct-child exit with the exact reason and partial streams",
  async () => {
    const root = await createTestTempDirectory("rea-kuna-abort-version-pipe-");
    const modeFile = join(root, "mode");
    const childStarted = join(root, "child-started");
    const parentExited = join(root, "parent-exited");
    const executable = await writeProbe(
      root,
      modeFile,
      childStarted,
      parentExited,
    );
    const launcher = makeLauncher();
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = Object.freeze({
      request: "cancel while inherited stdout stays open",
    });
    try {
      const pending = inspectKunaInstallation(
        { REA_KUNA_COMMAND: executable },
        {
          resourceScope: resourceScopeFor(scope),
          processLauncher: launcher.launcher,
          signal: controller.signal,
          probeTimeoutMs: 10_000,
        },
      );
      await waitForFile(parentExited);
      controller.abort(reason);
      const cause = await pending.catch((error: unknown) => error);
      const cancellation = kunaInstallationCancellation(cause);
      expect(cancellation?.reason).toBe(reason);
      expect(cancellation?.diagnostics).toMatchObject({
        kuna_version_probe: {
          status: "partial",
          exit_code: 0,
          signal: null,
          stdout: "kuna 1.833\n",
          stderr: "x".repeat(1024),
          stdout_bytes: 11,
          stdout_observed_bytes: 11,
          stderr_bytes: 1024,
          stderr_observed_bytes: 1024,
          diagnostic_truncated: false,
          output_incomplete: false,
          output_truncated: false,
        },
      });
      expect(scope.hasPending).toBe(false);
    } finally {
      controller.abort(reason);
      await scope.close();
    }
  },
);

it.skipIf(process.platform === "win32")(
  "retains incomplete probe cleanup, blocks another profile, then retries only that exact process group",
  async () => {
    const root = await createTestTempDirectory(
      "rea-kuna-retained-version-owner-",
    );
    const modeFile = join(root, "mode");
    const childStarted = join(root, "child-started");
    const parentExited = join(root, "parent-exited");
    const executable = await writeProbe(
      root,
      modeFile,
      childStarted,
      parentExited,
    );
    let cleanupAttempts = 0;
    let allowCleanup = false;
    const launcher = makeLauncher(async (_child, pid) => {
      cleanupAttempts += 1;
      if (!allowCleanup)
        return { cleaned: false, reason: "controlled stop refusal" };
      return ownedGroupCleanup(pid);
    });
    const scope = new ArtifactResourceScope();
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    await new Promise<void>((resolve, reject) => {
      unrelated.once("spawn", resolve);
      unrelated.once("error", reject);
    });
    const provider = new KunaProvider(
      { REA_KUNA_COMMAND: executable, REA_KUNA_CACHE_DIR: join(root, "cache") },
      { launcher: launcher.launcher, probeTimeoutMs: 2_500 },
    );
    const input = target(join(root, "target"));
    await writeFile(input.path, "target");
    const options = { resourceScope: resourceScopeFor(scope) };
    try {
      const first = await provider.resolveAnalysisProfile(input, options);
      expect(first.ok).toBe(false);
      if (first.ok)
        throw new Error("Expected the held version probe to time out");
      const primary = first.error;
      expect(primary.cleanupIncomplete).toBe(true);
      expect(scope.hasPending).toBe(true);
      await waitForFile(parentExited);

      const blocked = await provider.resolveAnalysisProfile(input, options);
      expect(blocked.ok).toBe(false);
      expect(launcher.launches).toBe(1);
      expect(cleanupAttempts).toBe(2);
      if (blocked.ok)
        throw new Error("Expected retained cleanup to block a new probe");
      expect(blocked.error.cleanupIncomplete).toBe(true);

      allowCleanup = true;
      await writeFile(modeFile, "success");
      const retried = await provider.resolveAnalysisProfile(input, options);
      expect(retried.ok).toBe(true);
      expect(launcher.launches).toBe(2);
      expect(scope.hasPending).toBe(false);
      expect(primary.cleanupIncomplete).toBe(false);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      allowCleanup = true;
      await scope.close();
      unrelated.kill("SIGKILL");
    }
  },
);

it("keeps a file-operation primary linked to every retained file and process owner", async () => {
  const scope = new ArtifactResourceScope();
  const resourceScope = resourceScopeFor(scope);
  const kunaResources = createKunaResourceScope(resourceScope);
  let processCanClose = false;
  let processResources = ["initial Kuna process group"];
  const processOwner = {
    close: async () => {
      processResources = ["remaining Kuna descendant"];
      if (!processCanClose) throw new Error("process stop unconfirmed");
    },
    get cleanupResources() {
      return processResources;
    },
  };
  const fileHandle = new OwnedFileHandle({
    fd: 17,
    close: async () => {},
  }) as unknown as OwnedFileHandle;
  kunaResources.owner.retain(fileHandle, "/tmp/kuna-test-source");
  kunaResources.owner.retain(processOwner, "kuna test process");
  const primary = new ProviderAdapterError("kuna", "kuna:profile", {
    userMessage: "The admitted Kuna version probe failed.",
    cleanup: {
      reason: "The source descriptor close is unconfirmed.",
      resources: ["/tmp/kuna-test-source"],
    },
  });
  const fileFailure = new RegularFileCleanupFailure({
    path: "/tmp/kuna-test-source",
    owner: fileHandle,
    outcome: { kind: "failed", cause: primary },
    cleanupCause: new Error("descriptor close refused"),
  });
  kunaResources.bindFailure(fileFailure, primary);
  expect(primary.cleanupIncomplete).toBe(true);
  expect(primary.cleanupResources).toEqual([
    "/tmp/kuna-test-source",
    "initial Kuna process group",
  ]);
  await expect(scope.retryCleanup()).rejects.toMatchObject({
    failedOwners: expect.any(Array),
  });
  expect(primary.cleanupIncomplete).toBe(true);
  expect(primary.cleanupResources).toEqual(["remaining Kuna descendant"]);
  processCanClose = true;
  await scope.retryCleanup();
  expect(primary.cleanupIncomplete).toBe(false);
  expect(primary.userMessage).toBe("The admitted Kuna version probe failed.");
  await scope.close();
});

it("keeps unknown cleanup labels unknown instead of substituting the lookup key", async () => {
  const scope = new ArtifactResourceScope();
  const kunaResources = createKunaResourceScope(resourceScopeFor(scope));
  const unknownOwner = {
    close: async () => {
      throw new Error("stop remains unconfirmed");
    },
    cleanupResources: undefined,
  };
  kunaResources.owner.retain(unknownOwner, "display-only lookup key");
  const primary = new ProviderAdapterError("kuna", "kuna:profile", {
    userMessage: "Cleanup is still pending.",
    cleanup: { reason: "stop remains unconfirmed", resources: [] },
  });
  kunaResources.bindRetainedFailure(primary);
  expect(kunaResources.hasPending).toBe(true);
  expect(kunaResources.cleanupResources).toBeUndefined();
  await scope.close().catch(() => undefined);
});

it.skipIf(process.platform === "win32")(
  "keeps caller cancellation primary while cancellation cleanup is held and then retried",
  async () => {
    const root = await createTestTempDirectory(
      "rea-kuna-final-cancel-cleanup-",
    );
    const modeFile = join(root, "mode");
    const childStarted = join(root, "child-started");
    const parentExited = join(root, "parent-exited");
    const executable = await writeProbe(
      root,
      modeFile,
      childStarted,
      parentExited,
    );
    const cleanupGate = (() => {
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const started = new Promise<void>((resolve) => (entered = resolve));
      return { held, started, release, entered };
    })();
    const launcher = makeLauncher(async (_child, pid) => {
      cleanupGate.entered();
      await cleanupGate.held;
      return ownedGroupCleanup(pid);
    });
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = Object.freeze({
      request: "abort during final process cleanup",
    });
    try {
      const pending = inspectKunaInstallation(
        { REA_KUNA_COMMAND: executable },
        {
          resourceScope: resourceScopeFor(scope),
          processLauncher: launcher.launcher,
          signal: controller.signal,
          probeTimeoutMs: 10_000,
        },
      );
      await waitForFile(parentExited);
      controller.abort(reason);
      await cleanupGate.started;
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      await delay(25);
      expect(settled).toBe(false);
      cleanupGate.release();
      const cause = await pending.catch((error: unknown) => error);
      expect(kunaInstallationCancellation(cause)?.reason).toBe(reason);
      expect(scope.hasPending).toBe(false);
    } finally {
      controller.abort(reason);
      cleanupGate.release();
      await scope.close();
    }
  },
);
