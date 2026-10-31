import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
} from "vitest";

import { PwntoolsLayoutProvider } from "../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../src/process/ProcessOwnership.js";
import { prepareProcessOwnershipInspection } from "../../src/process/ProcessOwnershipObservation.js";
import { stopProviderProcessFixture } from "../fixtures/providerProcess.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../support/workspace/workspaceFixture.js";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
const architecture = Object.getOwnPropertyDescriptor(process, "arch");
const supportedHost = process.platform !== "win32";

beforeAll(() =>
  supportedHost ? prepareProcessOwnershipInspection() : undefined,
);

// Only the decoder's availability gate is simulated. The module-owned process
// inspector was created and prepared for the real host before these overrides;
// every fixture launch, output stream, cleanup signal and filesystem is real.
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
});

afterEach(() => {
  if (platform !== undefined)
    Object.defineProperty(process, "platform", platform);
  if (architecture !== undefined)
    Object.defineProperty(process, "arch", architecture);
});

const fixture = async () => {
  const workspace = await createTestWorkspace("rea-pwntools-cleanup-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = join(workspace.root, "selected.elf");
  await writeFile(path, "source-owned-seam-bytes");
  return { workspace, path };
};

it.runIf(supportedHost)(
  "retains live worker files, refuses another launch, and retries cleanup on close",
  async () => {
    const { workspace, path } = await fixture();
    let ownedPath = "";
    let pid: number | undefined;
    let launches = 0;
    let cleanupAllowed = false;
    let rootRemovalAllowed = false;
    let releaseFixture: (() => Promise<void>) | undefined;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        launches++;
        ownedPath = input.cwd ?? "";
        const launched = await spawnOwnedProviderProcess({
          ...input,
          arguments: [
            "-e",
            'process.stdout.write("x".repeat(1048577)); setInterval(() => undefined, 1000)',
          ],
        });
        pid = launched.process.pid;
        releaseFixture = () => stopProviderProcessFixture(launched.process);
        return {
          ...launched,
          cleanup: () =>
            cleanupAllowed
              ? cleanupOwnedProcessGroup(launched.ownership)
              : Promise.resolve({
                  cleaned: false as const,
                  reason: "fixture process inspection denied",
                }),
        };
      },
      async () => {
        const root = await PrivateRuntimeRoot.create({
          parent: workspace.root,
          prefix: "owned-",
        });
        return {
          path: root.path,
          close: async () => {
            if (!rootRemovalAllowed)
              throw new Error("root removal refused after process retirement");
            await root.close();
          },
        };
      },
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      rootRemovalAllowed = true;
      await provider.close();
      await releaseFixture?.();
    });

    const result = await provider.inspect({ path });
    if (result.ok)
      throw new Error("Expected output overflow and failed cleanup");
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      capturedOutput: { truncated: true },
      diagnostics: {
        primary_error: {
          code: "unreadable_output",
        },
        cleanup_error: { code: "cleanup_incomplete" },
      },
    });
    const projected = projectAnalysisError(result.error);
    expect(projected.details?.captured_output).toEqual(
      result.error.capturedOutput,
    );
    expect(projected).not.toHaveProperty(
      "details.diagnostics.primary_error.details.captured_output",
    );
    const output = result.error.capturedOutput?.stdout;
    if (!output) throw new Error("Expected retained truncated worker output");
    // The cleanup owner also retains a bounded worker snapshot for its own
    // failed-close receipt. Generic primary history must not add a third copy.
    expect(projected).toHaveProperty(
      "details.diagnostics.cleanup_error.details.diagnostics.captured_output.stdout",
      output,
    );
    expect(JSON.stringify(projected).split(output)).toHaveLength(3);
    if (pid === undefined)
      throw new Error("The fixture did not acquire a process");
    const workerPid = pid;
    expect(() => process.kill(workerPid, 0)).not.toThrow();
    expect(await readFile(join(ownedPath, "object.snapshot"), "utf8")).toBe(
      "source-owned-seam-bytes",
    );
    const refused = await provider.inspect({ path });
    if (refused.ok)
      throw new Error("Unreleased ownership must block another launch");
    expect(refused.error.cleanupResources).toContain(ownedPath);
    expect(launches).toBe(1);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    await expect(access(ownedPath)).resolves.toBeUndefined();

    cleanupAllowed = true;
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(() => process.kill(workerPid, 0)).toThrow();
    expect(result.error.cleanupResources).toEqual([ownedPath]);
    expect(result.error.cleanupIncomplete).toBe(true);
    rootRemovalAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(refused.error.cleanupIncomplete).toBe(false);
    await expect(access(ownedPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "retains a failed root removal and retries it before acquiring another decoder",
  async () => {
    const { workspace, path } = await fixture();
    let releases = 0;
    let launches = 0;
    let removalAllowed = false;
    const root = await PrivateRuntimeRoot.create({
      parent: workspace.root,
      prefix: "owned-",
    });
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        launches++;
        return spawnOwnedProviderProcess({
          ...input,
          arguments: [
            "-e",
            'process.stdout.write("retained diagnostic"); process.exitCode = 2',
          ],
        });
      },
      async () => ({
        path: root.path,
        close: async () => {
          releases++;
          if (!removalAllowed) throw new Error("fixture root removal denied");
          await root.close();
        },
      }),
    );
    onTestFinished(async () => {
      removalAllowed = true;
      await provider.close();
      await root.close();
    });
    const result = await provider.inspect({ path });
    if (result.ok)
      throw new Error("Expected command and root-removal failures");
    expect(result.error).toMatchObject({
      cleanupIncomplete: true,
      diagnostics: {
        primary_error: {
          code: "execution_failure",
          details: { diagnostics: { stdout: "retained diagnostic" } },
        },
        cleanup_error: { code: "cleanup_incomplete" },
      },
    });
    const refused = await provider.inspect({ path });
    if (refused.ok)
      throw new Error("Retained root cleanup must precede a new launch");
    expect(refused.error.cleanupResources).toEqual([root.path]);
    expect(launches).toBe(1);
    expect(releases).toBe(2);
    removalAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "cancels queued inspections promptly and drains the running inspection when closing",
  async () => {
    const { workspace, path } = await fixture();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let launches = 0;
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (input) => {
        launches++;
        entered?.();
        await gate;
        return spawnOwnedProviderProcess({
          ...input,
          arguments: ["-e", "process.exit(2)"],
        });
      },
      () =>
        PrivateRuntimeRoot.create({ parent: workspace.root, prefix: "owned-" }),
    );
    onTestFinished(async () => {
      release?.();
      await provider.close();
    });
    const first = provider.inspect({ path });
    await started;
    const controller = new AbortController();
    const cancelled = provider.inspect({ path }, { signal: controller.signal });
    const reason = { stage: "queued" };
    controller.abort(reason);
    await expect(cancelled).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    const cancelledResult = await cancelled;
    if (cancelledResult.ok) throw new Error("Expected queued cancellation");
    expect(cancelledResult.error.cause).toBe(reason);
    const queued = provider.inspect({ path });
    const closing = provider.close();
    const late = provider.inspect({ path });
    release?.();
    const [firstResult, queuedResult, lateResult] = await Promise.all([
      first,
      queued,
      late,
    ]);
    if (firstResult.ok) throw new Error("The fixture exits with failure");
    expect(firstResult.error).not.toMatchObject({ cleanupIncomplete: true });
    expect(queuedResult).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        cleanupIncomplete: false,
      },
    });
    expect(lateResult).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        cleanupIncomplete: false,
      },
    });
    await closing;
    expect(launches).toBe(1);
  },
);
