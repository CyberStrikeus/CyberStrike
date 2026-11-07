import { projectCliAnalysisResult } from "../../src/cli/projectCliAnalysisResult.js";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as firmwareFiles from "../../src/firmware/FirmwareFiles.js";
import { SafeOutputTree } from "../../src/artifacts/SafeOutputTree.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import { DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS } from "../../src/domain/firmware/firmwareAnalysis.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { ProviderProcessSupervisor } from "../../src/process/ProviderProcess.js";
import { finishAnalysisCommand } from "../../src/cli/finishAnalysisCommand.js";
import { AnalysisOutputError } from "../../src/domain/analysisErrorCore.js";
import { FIRMWARE_LIMITS } from "../../src/firmware/FirmwareRelease.js";
import {
  firmwareFixture,
  assertFirmwareCleanup,
} from "../fixtures/firmware/provider.js";

const test = it.skipIf(process.platform !== "linux" || process.arch !== "x64");
afterEach(() => vi.restoreAllMocks());

test("preserves an already aborted caller reason without launching firmware work", async () => {
  const fixture = await firmwareFixture();
  const reason = { stop: "before admission" };
  const result = await fixture.service.execute(
    "extract_firmware",
    {
      path: fixture.path,
      output_directory: fixture.output,
      publication_timeout_ms: 654_321,
    },
    { signal: AbortSignal.abort(reason) },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  if (result.ok) throw new Error("Expected caller cancellation");
  expect(result.error.cause).toBe(reason);
  expect(fixture.launches).toEqual([]);
  await fixture.close();
});

const phases = (
  publicationMs: number = DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS,
  analysisMs: number = DEFAULT_FIRMWARE_ANALYSIS_TIMEOUT_MS,
) => {
  const analysis = new AbortController();
  const publication = new AbortController();
  const budgets: number[] = [];
  const timeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    if (budgets.length === 0 && ms === analysisMs) {
      budgets.push(ms);
      return analysis.signal;
    }
    if (ms === publicationMs) {
      budgets.push(ms);
      return publication.signal;
    }
    return timeout(ms);
  });
  return { analysis, publication, budgets };
};

const phaseClock = () => {
  const now = performance.now.bind(performance);
  let offset = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() + offset);
  return (elapsedMs: number) => {
    offset += elapsedMs;
  };
};

test("charges inspection workspace cleanup to its selectable analysis budget, without a hidden publication phase", async () => {
  const phase = phases(120_000, 1234);
  const advance = phaseClock();
  const fixture = await firmwareFixture();
  const close = PrivateRuntimeRoot.prototype.close;
  vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
    async function (this: PrivateRuntimeRoot) {
      await close.call(this);
      advance(1235);
    },
  );
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
    analysis_timeout_ms: 1234,
  });
  if (result.ok)
    throw new Error(
      "Expected inspection cleanup to exceed its analysis budget",
    );
  expect(phase.budgets).toEqual([1234]);
  expect(phase.analysis.signal.aborted).toBe(false);
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "provider_timeout",
    details: {
      timeout_ms: 1234,
      diagnostics: { phase: "analysis" },
      partial_observation: {
        kind: "firmware",
        result: { analysis_timeout_ms: 1234, coverage: "signature_scan" },
      },
    },
    remediation: { action: expect.stringContaining("analysis_timeout_ms") },
  });
  await fixture.close();
  await assertFirmwareCleanup(fixture.launches);
});

test("allows publication after the analysis phase expires", async () => {
  const phase = phases();
  const fixture = await firmwareFixture();
  const publish = firmwareFiles.FirmwareFileAccess.prototype.publish;
  let publicationSignal: AbortSignal | undefined;
  vi.spyOn(
    firmwareFiles.FirmwareFileAccess.prototype,
    "publish",
  ).mockImplementation(function (
    this: firmwareFiles.FirmwareFileAccess,
    entry,
    digest,
    tree,
    signal,
  ) {
    publicationSignal = signal;
    phase.analysis.abort(
      new DOMException("earlier analysis deadline", "TimeoutError"),
    );
    return publish.call(this, entry, digest, tree, signal);
  });
  const result = await fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
  });
  expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
  expect(publicationSignal).toBe(phase.publication.signal);
  expect(await readFile(join(fixture.output, "rootfs/config"), "utf8")).toBe(
    "firmware=true\n",
  );
  expect(phase.budgets).toEqual([120_000, 120_000]);
  await fixture.close();
  await assertFirmwareCleanup(fixture.launches);
});

test.each(["signal", "clock"] as const)(
  "does not revive expired analysis when inventory finishes: %s",
  async (expiry) => {
    const phase = phases();
    const advance = phaseClock();
    const fixture = await firmwareFixture();
    const inventory = firmwareFiles.inventoryFirmwareOutput;
    vi.spyOn(firmwareFiles, "inventoryFirmwareOutput").mockImplementation(
      async (...args) => {
        const entries = await inventory(...args);
        if (expiry === "clock") advance(120_001);
        else
          phase.analysis.abort(
            new DOMException("inventory deadline", "TimeoutError"),
          );
        return entries;
      },
    );
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
    });
    if (result.ok) throw new Error("Expected expired analysis");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 120_000, diagnostics: { phase: "analysis" } },
    });
    expect(phase.budgets).toEqual([120_000]);
    expect(phase.analysis.signal.aborted).toBe(expiry === "signal");
    await expect(access(fixture.output)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await fixture.close();
    await assertFirmwareCleanup(fixture.launches);
  },
);

test("keeps each queued request's independent analysis and publication budgets", async () => {
  const fixture = await firmwareFixture();
  const budgets: number[] = [];
  const timeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    budgets.push(ms);
    return timeout(ms);
  });
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const publish = firmwareFiles.FirmwareFileAccess.prototype.publish;
  let first = true;
  vi.spyOn(
    firmwareFiles.FirmwareFileAccess.prototype,
    "publish",
  ).mockImplementation(async function (
    this: firmwareFiles.FirmwareFileAccess,
    ...args
  ) {
    if (first) {
      first = false;
      enter();
      await gate;
    }
    return publish.apply(this, args);
  });
  const pending = fixture.service.execute("extract_firmware", {
    path: fixture.path,
    output_directory: fixture.output,
    publication_timeout_ms: 123_456,
    analysis_timeout_ms: 234_567,
  });
  try {
    await entered;
    const queued = fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: join(fixture.root, "second-output"),
      publication_timeout_ms: 654_321,
      analysis_timeout_ms: 765_432,
    });
    expect(budgets).toEqual([234_567, 123_456]);
    release();
    const results = await Promise.all([pending, queued]);
    expect(
      results.map((result) =>
        result.ok
          ? result.value.parameters.publication_timeout_ms
          : result.error.message,
      ),
    ).toEqual([123_456, 654_321]);
    expect(
      results.map((result) => result.ok && result.value.normalized_result),
    ).toMatchObject([
      { analysis_timeout_ms: 234_567 },
      { analysis_timeout_ms: 765_432 },
    ]);
    expect(budgets).toEqual([234_567, 123_456, 765_432, 654_321]);
  } finally {
    release();
  }
  await fixture.close();
  await assertFirmwareCleanup(fixture.launches);
});

test("uses the selected phase deadline inside an owned command beyond the former 120-second cap", async () => {
  const fixture = await firmwareFixture();
  const advance = phaseClock();
  const wait = ProviderProcessSupervisor.prototype.waitForOutputClose;
  let advanced = false;
  vi.spyOn(
    ProviderProcessSupervisor.prototype,
    "waitForOutputClose",
  ).mockImplementation(async function (
    this: ProviderProcessSupervisor,
    ...args
  ) {
    const closed = await wait.apply(this, args);
    if (!advanced) {
      advanced = true;
      advance(120_001);
      return false;
    }
    return closed;
  });
  const result = await fixture.service.execute("inspect_firmware_regions", {
    path: fixture.path,
    analysis_timeout_ms: 240_000,
  });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    analysis_timeout_ms: 240_000,
  });
  expect(fixture.launches).toHaveLength(2);
  expect(
    fixture.launches.every((launch) =>
      launch.args.includes(
        `--cpu=${String(FIRMWARE_LIMITS.cpuSeconds)}:${String(FIRMWARE_LIMITS.cpuSeconds)}`,
      ),
    ),
  ).toBe(true);
  await fixture.close();
  await assertFirmwareCleanup(fixture.launches);
});

test.each([false, true])(
  "retains typed analysis timeout recovery through failed command cleanup (one-shot close: %s)",
  async (oneShot) => {
    const fixture = await firmwareFixture("cleanup-failure");
    const analysis = new AbortController();
    const timeout = AbortSignal.timeout;
    const timer = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) =>
        ms === 1234 ? analysis.signal : timeout(ms),
      );
    const wait = ProviderProcessSupervisor.prototype.waitForOutputClose;
    const waiter = vi
      .spyOn(ProviderProcessSupervisor.prototype, "waitForOutputClose")
      .mockImplementation(async function (
        this: ProviderProcessSupervisor,
        ...args
      ) {
        const closed = await wait.apply(this, args);
        if (closed)
          analysis.abort(
            new DOMException("controlled analysis expiry", "TimeoutError"),
          );
        return closed;
      });
    const result = await fixture.service.execute("inspect_firmware_regions", {
      path: fixture.path,
      analysis_timeout_ms: 1234,
    });
    if (result.ok) throw new Error("Expected timeout with retained cleanup");
    expect(result.error.cleanupPrimary).toMatchObject({
      _tag: "AnalysisTimeoutError",
      timeoutMs: 1234,
    });
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          previous_error: {
            code: "provider_timeout",
            details: { timeout_ms: 1234 },
          },
        },
        captured_output: { stdout: expect.stringContaining("binwalk 3.1.0") },
      },
    });
    expect(JSON.stringify(projected).split("binwalk 3.1.0")).toHaveLength(2);
    timer.mockRestore();
    waiter.mockRestore();
    if (oneShot) {
      const delivered = await finishAnalysisCommand(
        async () => result,
        fixture.service,
        "binwalk",
        "inspect_firmware_regions",
        new AbortController().signal,
      ).then(projectCliAnalysisResult);
      expect(delivered).toMatchObject({ code: "cleanup_incomplete" });
      expect(JSON.stringify(delivered).split("binwalk 3.1.0")).toHaveLength(2);
    }
    fixture.restoreCleanup();
    if (oneShot) await fixture.close();
    else {
      const retried = await fixture.service.execute(
        "inspect_firmware_regions",
        {
          path: fixture.path,
        },
      );
      if (!retried.ok) throw retried.error;
    }
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 1234 },
    });
    await fixture.close();
    await assertFirmwareCleanup(fixture.launches);
  },
);

test.each(["analysis", "clock", "caller", "prior-failure"] as const)(
  "retains an interruption observed during incomplete command cleanup: %s",
  async (interruption) => {
    const phase = phases(120_000, 54_321);
    const advance = phaseClock();
    const fixture = await firmwareFixture("cleanup-failure");
    const caller = new AbortController();
    const reason = { caller: "during owned command cleanup" };
    const original = new AnalysisOutputError(
      "inspect_firmware_regions",
      "earlier command failure",
    );
    const stop = ProviderProcessSupervisor.prototype.stop;
    const stopper = vi
      .spyOn(ProviderProcessSupervisor.prototype, "stop")
      .mockImplementation(async function (
        this: ProviderProcessSupervisor,
        ...args
      ) {
        const stopped = await stop.apply(this, args);
        if (interruption === "clock") advance(54_322);
        else if (interruption === "caller") caller.abort(reason);
        else
          phase.analysis.abort(
            new DOMException("during owned command cleanup", "TimeoutError"),
          );
        return stopped;
      });
    if (interruption === "prior-failure")
      vi.spyOn(
        ProviderProcessSupervisor.prototype,
        "waitForOutputClose",
      ).mockRejectedValueOnce(original);
    const result = await fixture.service.execute(
      "inspect_firmware_regions",
      {
        path: fixture.path,
        analysis_timeout_ms: 54_321,
      },
      { signal: caller.signal },
    );
    if (result.ok) throw new Error("Expected retained command cleanup");
    const expected =
      interruption === "caller"
        ? "cancelled"
        : interruption === "prior-failure"
          ? "unreadable_output"
          : "provider_timeout";
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: { diagnostics: { previous_error: { code: expected } } },
    });
    const primary = result.error.cleanupPrimary;
    if (primary === undefined)
      throw new Error("Expected typed cleanup primary");
    if (interruption === "prior-failure") expect(primary).toBe(original);
    else {
      expect(primary._tag).toBe(
        interruption === "caller"
          ? "AnalysisCancelledError"
          : "AnalysisTimeoutError",
      );
      if (interruption !== "caller")
        expect(projectAnalysisError(primary).details).toMatchObject({
          timeout_ms: 54_321,
          diagnostics: { phase: "analysis" },
        });
      if (interruption === "caller") expect(primary.cause).toBe(reason);
      if (interruption === "analysis")
        expect(primary.cause).toBe(phase.analysis.signal.reason);
    }
    stopper.mockRestore();
    fixture.restoreCleanup();
    await fixture.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(result.error).code).toBe(expected);
    await assertFirmwareCleanup(fixture.launches);
  },
);

test.each(["none", "caller", "publication", "clock"] as const)(
  "preserves the selected budget, verified progress and rollback at commit: %s",
  async (interruption) => {
    const phase = phases(654_321);
    const advance = phaseClock();
    const caller = new AbortController();
    const reason = { stop: "before publication commit" };
    const fixture = await firmwareFixture();
    if (interruption === "clock") {
      const publish = firmwareFiles.FirmwareFileAccess.prototype.publish;
      vi.spyOn(
        firmwareFiles.FirmwareFileAccess.prototype,
        "publish",
      ).mockImplementation(async function (
        this: firmwareFiles.FirmwareFileAccess,
        ...args
      ) {
        const file = await publish.apply(this, args);
        advance(654_322);
        return file;
      });
    }
    const commit = SafeOutputTree.prototype.commit;
    vi.spyOn(SafeOutputTree.prototype, "commit").mockImplementation(
      async function (this: SafeOutputTree, signal) {
        if (interruption === "caller") caller.abort(reason);
        if (interruption === "publication")
          phase.publication.abort(
            new DOMException("publication deadline", "TimeoutError"),
          );
        await commit.call(this, signal);
      },
    );
    const result = await fixture.service.execute(
      "extract_firmware",
      {
        path: fixture.path,
        output_directory: fixture.output,
        publication_timeout_ms: 654_321,
      },
      { signal: caller.signal },
    );
    expect(phase.budgets).toEqual([120_000, 654_321]);
    if (interruption === "none") {
      if (!result.ok) throw result.error;
      expect(result.value.parameters).toMatchObject({
        publication_timeout_ms: 654_321,
      });
    } else {
      if (result.ok) throw new Error("Expected interrupted publication");
      expect(result.error.cause).toBe(
        interruption === "caller" ? reason : phase.publication.signal.reason,
      );
      if (interruption === "clock")
        expect(phase.publication.signal.aborted).toBe(false);
      expect(projectAnalysisError(result.error)).toMatchObject(
        interruption === "caller"
          ? { code: "cancelled" }
          : {
              code: "provider_timeout",
              details: {
                timeout_ms: 654_321,
                diagnostics: {
                  phase: "publication",
                  publication: {
                    output_directory: fixture.output,
                    verified_files: 1,
                    total_files: 1,
                  },
                },
              },
            },
      );
      await expect(access(fixture.output)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await fixture.close();
    await assertFirmwareCleanup(fixture.launches);
  },
);

test.each([
  { expiry: "signal", denied: false },
  { expiry: "signal", denied: true },
  { expiry: "clock", denied: false },
  { expiry: "clock", denied: true },
] as const)(
  "retains committed output and late timeout through workspace cleanup: $expiry, denied: $denied",
  async ({ expiry, denied }) => {
    const phase = phases(654_321, 234_567);
    const advance = phaseClock();
    const fixture = await firmwareFixture();
    const commit = SafeOutputTree.prototype.commit;
    const close = PrivateRuntimeRoot.prototype.close;
    let committed = false;
    let blocked = denied;
    vi.spyOn(SafeOutputTree.prototype, "commit").mockImplementation(
      async function (this: SafeOutputTree, signal) {
        await commit.call(this, signal);
        committed = true;
      },
    );
    vi.spyOn(PrivateRuntimeRoot.prototype, "close").mockImplementation(
      async function (this: PrivateRuntimeRoot) {
        if (committed) {
          if (expiry === "clock") advance(654_322);
          else
            phase.publication.abort(
              new DOMException("final cleanup deadline", "TimeoutError"),
            );
          if (blocked)
            throw new Error("controlled firmware root cleanup denial");
        }
        await close.call(this);
      },
    );
    const result = await fixture.service.execute("extract_firmware", {
      path: fixture.path,
      output_directory: fixture.output,
      analysis_timeout_ms: 234_567,
      publication_timeout_ms: 654_321,
    });
    if (result.ok) throw new Error("Expected timeout during final cleanup");
    expect(phase.budgets).toEqual([234_567, 654_321]);
    expect(phase.publication.signal.aborted).toBe(expiry === "signal");
    const projected = projectAnalysisError(result.error);
    expect(
      denied ? result.error.diagnostics?.primary_error : projected,
    ).toMatchObject({
      code: "provider_timeout",
      details: { timeout_ms: 654_321, diagnostics: { phase: "publication" } },
    });
    expect(result.error.partialObservation).toMatchObject({
      kind: "firmware",
      result: {
        output_directory: fixture.output,
        analysis_timeout_ms: 234_567,
      },
    });
    expect(await readFile(join(fixture.output, "rootfs/config"), "utf8")).toBe(
      "firmware=true\n",
    );
    expect(result.error.cleanupIncomplete).toBe(denied);
    blocked = false;
    await fixture.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    await assertFirmwareCleanup(fixture.launches);
  },
);
