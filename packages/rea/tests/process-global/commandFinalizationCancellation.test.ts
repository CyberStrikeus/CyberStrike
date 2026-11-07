import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Cli } from "incur";
import { afterEach, expect, it, vi } from "vitest";

import * as analysisViewService from "../../src/application/analysisView/AnalysisViewService.js";
import * as evidenceInputResolver from "../../src/application/EvidenceInputResolver.js";
import { WasmArtifactService } from "../../src/application/wasm/WasmArtifactService.js";
import { registerAnalysisViewCommands } from "../../src/cli/analysisViewCommands.js";
import { registerCutterCommands } from "../../src/cli/cutterCommands.js";
import { registerWasmCommands } from "../../src/cli/wasmCommands.js";
import { wasmArtifactModule } from "../../src/composition/wasm.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { toolContract } from "../../src/contracts/toolContracts.js";
import { CutterBridgeService } from "../../src/cutter/CutterBridgeService.js";
import { AnalysisOutputError } from "../../src/domain/analysisErrorCore.js";
import * as analysisView from "../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { err, ok } from "../../src/domain/result.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import { silentLogger } from "../../src/logger.js";
import { analysisViewLayoutEvidence } from "../fixtures/analysisView.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  wasmArtifactExecution,
  wasmArtifactFixture,
} from "../fixtures/wasm/artifact.js";

const host = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  get exitCode() {
    return process.exitCode;
  },
  set exitCode(value: typeof process.exitCode) {
    process.exitCode = value;
  },
  on(signal: string, listener: () => void) {
    this.listeners.set(signal, listener);
  },
  off(signal: string, listener: () => void) {
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal);
  },
}));

vi.mock("../../src/cli/commandCancellation.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/cli/commandCancellation.js")
    >();
  return {
    ...original,
    withCommandCancellation: <Value>(
      operation: (signal: AbortSignal) => Promise<Value>,
    ) => original.withCommandCancellation(operation, host),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  host.listeners.clear();
});

const cutterDiscoveryFixture = () =>
  toolContract("list_cutter_sessions").outputSchema.parse({
    sessions: [
      {
        session_id: "00000000-0000-4000-8000-000000000001",
        pid: 41,
        document_generation: 7,
        current_file: "C:\\Caller files\\token=literal%2F.bin",
        cutter_version: "2.3.4",
        identity_status: "partial",
      },
      {
        session_id: "00000000-0000-4000-8000-000000000002",
        pid: 42,
        document_generation: 0,
        current_file: null,
        cutter_version: null,
        identity_status: "partial",
      },
    ],
    bridge_directory: "/caller/Cutter bridge/token=literal%2F/证据",
    discovery_status: "sessions_found",
    bridge_directory_security: "unverified_platform_acl",
  });

const finalCloseGate = () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { enter, release, entered, pending };
};

it.each([
  "control",
  "cleanup-failure",
  "interrupt",
  "interrupt-cleanup-failure",
  "queued-interrupt",
] as const)(
  "retains registered Cutter discovery through final close: %s",
  async (scenario) => {
    const discoverySchema = toolContract("list_cutter_sessions").outputSchema;
    const discovery = cutterDiscoveryFixture();
    const cleanup = new ProviderCleanupError(
      "cutter",
      [],
      { reason: "controlled discovery close failure" },
      { operation: "list_cutter_sessions" },
    );
    const failsCleanup =
      scenario === "cleanup-failure" ||
      scenario === "interrupt-cleanup-failure";
    const expectsInterrupt =
      scenario === "interrupt" ||
      scenario === "interrupt-cleanup-failure" ||
      scenario === "queued-interrupt";
    const gate = finalCloseGate();
    let closed = false;
    let interruptHandled = false;
    let queuedInterrupt: Promise<void> | undefined;
    const interrupt = () => {
      const listener = host.listeners.get("SIGINT");
      interruptHandled = listener !== undefined;
      listener?.();
    };
    const list = vi
      .spyOn(CutterBridgeService.prototype, "listSessions")
      .mockResolvedValue(ok(discovery));
    const close = vi
      .spyOn(CutterBridgeService.prototype, "close")
      .mockImplementation(async () => {
        gate.enter();
        await gate.pending;
        if (
          scenario === "interrupt" ||
          scenario === "interrupt-cleanup-failure"
        )
          interrupt();
        if (scenario === "queued-interrupt")
          queuedInterrupt = new Promise<void>((resolve) => {
            setImmediate(() => {
              interrupt();
              resolve();
            });
          });
        closed = true;
        if (failsCleanup) throw cleanup;
      });
    const cli = Cli.create("cutter-discovery-finalization-test", {
      sync: false,
    });
    registerCutterCommands(cli, silentLogger, {});
    let output = "";
    let settled = false;
    let pending: Promise<void> | undefined;
    const previousExitCode = process.exitCode;
    let exitCode: typeof process.exitCode;
    try {
      process.exitCode = undefined;
      pending = cli
        .serve(["list-cutter-sessions", "--json"], {
          stdout: (part) => {
            expect(closed).toBe(true);
            output += part;
          },
          exit: () => {},
        })
        .then(() => {
          settled = true;
        });
      await Promise.race([gate.entered, pending]);
      expect(close).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      expect(output).toBe("");
      gate.release();
      await pending;
      await queuedInterrupt;
      exitCode = process.exitCode;
    } finally {
      gate.release();
      try {
        try {
          await pending;
        } finally {
          await queuedInterrupt;
        }
      } finally {
        process.exitCode = previousExitCode;
      }
    }

    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(close).toHaveBeenCalledOnce();
    expect(closed).toBe(true);
    expect(interruptHandled).toBe(expectsInterrupt);
    expect(host.listeners.size).toBe(0);
    expect(exitCode).toBe(
      expectsInterrupt ? 130 : failsCleanup ? 1 : undefined,
    );
    const result: unknown = JSON.parse(output);
    if (scenario === "control") {
      expect(result).toEqual(discovery);
      return;
    }

    const error = analysisErrorProjectionSchema.parse(result);
    expect(error.code).toBe(failsCleanup ? "cleanup_incomplete" : "cancelled");
    expect(error.details?.partial_observation).toEqual(discovery);
    expect(discoverySchema.parse(error.details?.partial_observation)).toEqual(
      discovery,
    );
    if (expectsInterrupt) expect(error.category).toBe("cancelled");
    if (failsCleanup) expect(error.details?.resources).toEqual([]);
    if (scenario === "cleanup-failure")
      expect(error.details?.diagnostics).toEqual({
        reason: "controlled discovery close failure",
      });
    if (scenario === "interrupt-cleanup-failure")
      expect(error.details?.diagnostics).toMatchObject({
        primary_error: {
          code: "cancelled",
          details: { operation: "list_cutter_sessions" },
        },
        cleanup_error: {
          code: "cleanup_incomplete",
          details: {
            resources: [],
            diagnostics: { reason: "controlled discovery close failure" },
          },
        },
      });
  },
);

it.each([
  "control",
  "interrupt",
  "primary-failure",
  "cleanup-failure",
  "interrupt-cleanup-failure",
] as const)(
  "finishes the registered WASM command through final close: %s",
  async (scenario) => {
    const value = wasmArtifactFixture();
    const primary = new AnalysisOutputError(
      "inspect_wasm_artifact",
      "primary reply failure",
    );
    const cleanup = new ProviderCleanupError(
      "wabt-artifact",
      ["exact-owned-root"],
      { reason: "close refused" },
      { operation: "inspect_wasm_artifact" },
    );
    let closed = false;
    const service = new WasmArtifactService({
      inspect: async () =>
        scenario === "primary-failure"
          ? err(primary)
          : ok(wasmArtifactExecution(value)),
      close: async () => {
        await Promise.resolve();
        if (scenario !== "control" && scenario !== "cleanup-failure")
          host.listeners.get("SIGINT")?.();
        closed = true;
        if (
          scenario === "cleanup-failure" ||
          scenario === "interrupt-cleanup-failure"
        )
          throw cleanup;
      },
    });
    vi.spyOn(wasmArtifactModule, "create").mockReturnValue(service);
    const cli = Cli.create("finalization-test", { sync: false });
    registerWasmCommands(cli, silentLogger, {});
    let output = "";
    const previousExitCode = process.exitCode;
    let exitCode;
    try {
      process.exitCode = undefined;
      await cli.serve(
        ["inspect-wasm-artifact", value.artifact.path, "--json"],
        {
          stdout: (part) => {
            output += part;
          },
          exit: () => {},
        },
      );
      exitCode = process.exitCode;
    } finally {
      process.exitCode = previousExitCode;
    }
    const result = JSON.parse(output);
    expect(closed).toBe(true);
    expect(host.listeners.size).toBe(0);
    if (scenario === "control") {
      expect(result.normalized_result).toEqual(value);
      expect(exitCode).toBeUndefined();
    } else if (scenario === "primary-failure") {
      expect(result).toMatchObject({
        code: "unreadable_output",
        details: { reason: "primary reply failure" },
      });
      expect(exitCode).toBe(130);
    } else {
      expect(result).toMatchObject({
        code: scenario === "interrupt" ? "cancelled" : "cleanup_incomplete",
        details: {
          partial_observation: {
            operation: "inspect_wasm_artifact",
            normalized_result: value,
          },
          ...(scenario === "interrupt"
            ? {}
            : { resources: ["exact-owned-root"] }),
        },
      });
      if (scenario !== "cleanup-failure") expect(exitCode).toBe(130);
    }
  },
);

const referenceViewEvidence = async (
  request: Parameters<typeof analysisViewService.inspectAnalysisView>[0],
  evidenceBundlePath: string,
  phase: string,
) => {
  if (phase !== "projection") return undefined;
  const result = await analysisViewService.inspectAnalysisView(
    request,
    undefined,
    { evidenceBundlePath },
  );
  if (!result.ok) throw new Error("Expected completed reference Evidence");
  return result.value;
};

type PreparedView = ReturnType<
  typeof analysisView.prepareAnalysisViewProjection
>;

const expectRetainedProjection = (
  observation: unknown,
  reference: Awaited<ReturnType<typeof referenceViewEvidence>>,
  projected: ReturnType<PreparedView["project"]> | undefined,
  parent: ReturnType<typeof analysisViewLayoutEvidence>,
) => {
  if (!projected?.ok || reference === undefined)
    throw new Error("Expected a completed page and reference Evidence");
  const partial = parseEvidence(observation);
  expect(partial).toEqual(reference);
  expect(partial.normalized_result).toEqual(projected.value);
  expect(partial).toMatchObject({
    operation: "inspect_analysis_view",
    evidence_links: [parent.evidence_id],
    subject: parent.subject,
  });
};

it.each([
  ["bundle", "control", "close"],
  ["bundle", "SIGINT", "close"],
  ["bundle", "SIGTERM", "close"],
  ["evidence-file", "control", "close"],
  ["evidence-file", "SIGINT", "close"],
  ["evidence-file", "SIGTERM", "close"],
  ["request-file", "control", "close"],
  ["request-file", "SIGINT", "close"],
  ["request-file", "SIGTERM", "close"],
  ["bundle", "SIGINT", "authentication"],
  ["bundle", "SIGTERM", "authentication"],
  ["bundle", "SIGINT", "projection"],
  ["bundle", "SIGTERM", "projection"],
  ["bundle", "SIGINT", "authentication-failure"],
  ["bundle", "SIGTERM", "source-resolution-failure"],
] as const)(
  "preserves the analysis-view result and exit status for %s: %s during %s",
  async (source, signal, phase) => {
    const root = await createTestTempDirectory("rea-analysis-view-signal-");
    const parent = analysisViewLayoutEvidence();
    const filename = `${source}.json`;
    const path = join(root, filename);
    const request = {
      source:
        source === "bundle"
          ? {
              kind: "retained-evidence",
              evidence_id:
                phase === "source-resolution-failure"
                  ? `ev_${"f".repeat(64)}`
                  : parent.evidence_id,
            }
          : source === "evidence-file"
            ? { kind: "evidence-file", path }
            : { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    };
    await writeFile(
      path,
      JSON.stringify(
        source === "bundle"
          ? {
              ...createEvidenceBundle([parent]),
              ...(phase === "authentication-failure"
                ? { records: [{ ...parent, normalized_result: "altered" }] }
                : {}),
            }
          : source === "evidence-file"
            ? parent
            : request,
      ),
    );
    let interruptHandled = false;
    let pendingInterrupt: Promise<void> | undefined;
    const interrupt = () => {
      const listener = host.listeners.get(signal);
      interruptHandled = listener !== undefined;
      listener?.();
    };
    const queueInterrupt = () => {
      pendingInterrupt = new Promise((resolve) => {
        setImmediate(() => {
          interrupt();
          resolve();
        });
      });
    };
    const expectedProjection = await referenceViewEvidence(
      request,
      path,
      phase,
    );
    // Intercept the prepared owner, whose project method keeps its admission
    // budget and calls the domain projector lexically rather than by export.
    const originalPrepare = analysisView.prepareAnalysisViewProjection;
    let projected: ReturnType<PreparedView["project"]> | undefined;
    const project = vi
      .fn<(parent: Parameters<PreparedView["project"]>[0]) => void>()
      .mockName("preparedProjection.project");
    vi.spyOn(analysisView, "prepareAnalysisViewProjection").mockImplementation(
      (...args) => {
        const projection = originalPrepare(...args);
        const originalProject = projection.project;
        vi.spyOn(projection, "project").mockImplementation((parent) => {
          project(parent);
          projected = originalProject.call(projection, parent);
          if (phase === "projection") queueInterrupt();
          return projected;
        });
        return projection;
      },
    );
    const originalResolve = evidenceInputResolver.resolveEvidenceInput;
    const resolve = vi
      .spyOn(evidenceInputResolver, "resolveEvidenceInput")
      .mockImplementation((...args) => {
        const resolved = originalResolve(...args);
        if (phase === "source-resolution-failure") queueInterrupt();
        return resolved;
      });
    const originalClose = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        await originalClose.call(this);
        expect(this.handle.fd).toBe(-1);
        if (signal !== "control" && phase === "close") interrupt();
        if (phase.startsWith("authentication")) queueInterrupt();
      });
    const cli = Cli.create("analysis-view-finalization-test", { sync: false });
    registerAnalysisViewCommands(cli, silentLogger);
    let output = "";
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      await cli.serve(
        [
          "inspect-analysis-view",
          source === "request-file" ? path : JSON.stringify(request),
          ...(source === "bundle" ? ["--evidence-bundle", path] : []),
          "--json",
        ],
        {
          stdout: (part) => {
            output += part;
          },
          exit: () => {},
        },
      );
      expect(close).toHaveBeenCalledOnce();
      expect(host.listeners.size).toBe(0);
      expect(await readdir(root)).toEqual([filename]);
      const result = JSON.parse(output);
      expect(result).toMatchObject(
        signal === "control"
          ? { operation: "inspect_analysis_view" }
          : {
              code: phase.endsWith("failure")
                ? "evidence_integrity_mismatch"
                : "cancelled",
            },
      );
      expect(process.exitCode ?? 0).toBe(
        signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 0,
      );
      if (signal !== "control") expect(interruptHandled).toBe(true);
      expect(project).toHaveBeenCalledTimes(
        Number(signal === "control" || phase === "projection"),
      );
      if (phase.startsWith("authentication"))
        expect(resolve).not.toHaveBeenCalled();
      if (phase === "projection" || phase === "source-resolution-failure")
        expect(resolve).toHaveBeenCalledOnce();
      if (phase === "projection") {
        expectRetainedProjection(
          result.details.partial_observation,
          expectedProjection,
          projected,
          parent,
        );
      }
    } finally {
      await pendingInterrupt;
      process.exitCode = previousExitCode;
    }
  },
);
