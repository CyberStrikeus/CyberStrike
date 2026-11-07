import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { probeGhidraJava } from "../../../src/ghidra/GhidraJavaProbe.js";
import { DarwinProcessOwnershipInspectionError } from "../../../src/process/DarwinProcessRunTokenReader.js";
import {
  prepareProcessOwnershipInspection,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Long enough for an ordinary owned launch, short enough to keep the cold case quick.
const PROBE_TIMEOUT_MS = 2_000;

let inspectionResources = createInspectionResources();
afterEach(async () => {
  vi.restoreAllMocks();
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

// Prepare the real inspector once; each case models its own first-time preparation.
beforeAll(() => prepareProcessOwnershipInspection());

/** Java-shaped Node command that records whether it was launched; not a JVM. */
const writeJava = async () => {
  const home = await createTestTempDirectory("rea-java-preparation-");
  const launched = join(home, "launched");
  const command = join(home, "bin", "java");
  await mkdir(join(home, "bin"));
  await writeFile(
    command,
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(launched)}, "");\nprocess.stderr.write(${JSON.stringify(`    java.version = 21.0.11\n    java.home = ${home}\n    sun.arch.data.model = 64\n`)});\n`,
    { mode: 0o700 },
  );
  return { command, launched };
};

const probe = (command: string, signal?: AbortSignal) =>
  probeGhidraJava(
    command,
    {},
    {
      resourceOwner: inspectionResources.owner,
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );

it.runIf(process.platform === "darwin")(
  "spends a cold macOS ownership preparation outside the Java probe deadline",
  async () => {
    const java = await writeJava();
    const prepare = systemProcessOwnershipHost.prepare;
    let cold = true;
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
      async (signal) => {
        // A cold Swift SDK cache makes the first preparation outlast the probe.
        if (cold) {
          await delay(PROBE_TIMEOUT_MS + 1_000, undefined, { signal });
          cold = false;
        }
        await prepare?.(signal);
      },
    );

    const result = await probe(java.command);

    expect(result).toMatchObject({
      ok: true,
      value: { version: "21.0.11", major: 21 },
    });
    await expect(access(java.launched)).resolves.toBeUndefined();
  },
);

it.runIf(process.platform === "linux")(
  "keeps Linux ownership preparation inside the Java probe deadline",
  async () => {
    const java = await writeJava();
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
      // A stalled `ps` check has no time limit of its own.
      async (signal) => {
        await delay(60_000, undefined, { signal });
      },
    );

    const result = await probe(java.command);

    expect(result).toMatchObject({
      ok: false,
      error: {
        processErrorCode: "ETIMEDOUT",
        detail: expect.stringContaining(
          "Command deadline elapsed during ownership preparation.",
        ),
      },
    });
    await expect(access(java.launched)).rejects.toThrow();
  },
);

it.skipIf(process.platform === "win32")(
  "reports cancellation during ownership preparation without launching Java",
  async () => {
    const java = await writeJava();
    const controller = new AbortController();
    let entered = (): void => undefined;
    const preparing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
      async (signal) => {
        entered();
        await delay(60_000, undefined, { signal });
      },
    );

    const outcome = probe(java.command, controller.signal);
    await preparing;
    controller.abort();
    const result = await outcome;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a cancelled Java probe");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    await expect(access(java.launched)).rejects.toThrow();
  },
);

it.skipIf(process.platform === "win32")(
  "reports a failed ownership preparation as its own stage without launching Java",
  async () => {
    const java = await writeJava();
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockRejectedValue(
      new DarwinProcessOwnershipInspectionError("helper compilation failed", {
        compilerOutcome: {
          outcome: "exited",
          code: 1,
          signal: null,
          stderr: "error: failed to build module 'Swift'",
          stderrTruncated: false,
          outputTruncated: false,
          killed: false,
        },
      }),
    );

    const result = await probe(java.command);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a failed Java probe");
    expect(result.error).toBeInstanceOf(ProviderAdapterError);
    expect(result.error).toMatchObject({
      diagnostics: {
        stage: "ownership_preparation",
        compiler_outcome: { outcome: "exited", code: 1 },
      },
    });
    await expect(access(java.launched)).rejects.toThrow();
  },
);

it.runIf(process.platform === "darwin")(
  "retains preparation cleanup through cancellation and clears only the confirmed helper owner",
  async () => {
    const java = await writeJava();
    const controller = new AbortController();
    const reason = new ProviderCleanupError(
      "caller",
      ["caller-owned-resource"],
      {},
    );
    const cleanup = new ProviderCleanupError(
      "process-ownership",
      ["controlled-helper-root"],
      {},
    );
    let denied = true;
    const close = vi.fn(async () => {
      if (denied) throw cleanup;
      cleanup.resolveCleanup();
    });
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
      async () => {
        controller.abort(reason);
        throw new DarwinProcessOwnershipInspectionError(
          "cancelled helper with retained cleanup",
          {
            cancellation: { reason },
            cleanupFailure: cleanup,
            cleanupOwner: { close },
          },
        );
      },
    );
    try {
      const result = await probe(java.command, controller.signal);
      if (result.ok || !(result.error instanceof AnalysisError))
        throw new Error("Expected an owned cleanup failure");
      expect(result.error.cleanupResources).toEqual(["controlled-helper-root"]);
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
      await expect(inspectionResources.close()).rejects.toThrow();
      denied = false;
      await inspectionResources.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(result.error.cleanupPrimary?.cause).toBe(reason);
      expect(reason.cleanupIncomplete).toBe(true);
      expect(close).toHaveBeenCalledTimes(2);
      await expect(access(java.launched)).rejects.toThrow();
    } finally {
      denied = false;
      await inspectionResources.close();
    }
  },
);

it.runIf(process.platform === "darwin")(
  "refuses launch when cancellation arrives at the completed preparation handoff",
  async () => {
    const java = await writeJava();
    const controller = new AbortController();
    const reason = { caller: "after ownership preparation" };
    vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
      async () => {
        controller.abort(reason);
      },
    );
    const result = await probe(java.command, controller.signal);
    if (result.ok || !(result.error instanceof AnalysisCancelledError))
      throw new Error("Expected cancelled handoff");
    expect(result.error.cause).toBe(reason);
    await expect(access(java.launched)).rejects.toThrow();
  },
);
