import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import type { RecordedCrash } from "../../../src/domain/native/recordedCrash.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";
import { PwntoolsRecordedCrashProvider } from "../../../src/native/pwntools/PwntoolsRecordedCrashProvider.js";
import { PWNTOOLS_PROVIDER_IDENTITY } from "../../../src/native/pwntools/PwntoolsRelease.js";
import {
  spawnOwnedProviderProcess,
  type OwnedProviderProcessSpawnOptions,
  type SpawnedOwnedProviderProcess,
} from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  stopProviderProcessFixture,
  waitForProviderProcessReady,
} from "../../fixtures/providerProcess.js";
import {
  recordedCrashFixture,
  recordedCrashFileMappingFixture,
  recordedCrashDebuggerFixture,
  recordedCrashFixtureBytes,
  recordedCrashSignalFixture,
} from "../../fixtures/binaryDiagnostics/recordedCrash.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";

const requestSchema = z.object({
  snapshot_path: z.string(),
  reply_path: z.string(),
});
const host = process.platform === "linux" && process.arch === "x64";

const withCleanupGate = (
  launched: SpawnedOwnedProviderProcess,
  cleanupAllowed: () => boolean,
): SpawnedOwnedProviderProcess => ({
  ...launched,
  cleanup: async () => {
    const result = await cleanupOwnedProcessGroup(launched.ownership);
    if (!cleanupAllowed())
      throw new Error("source-owned post-cleanup reporting failure");
    return result;
  },
});

const spawnDebuggerFixture = (
  spawn: OwnedProviderProcessSpawnOptions,
  scenario: string,
): Promise<SpawnedOwnedProviderProcess> => {
  const script =
    scenario === "process-failure"
      ? "process.stderr.write('debugger failed',()=>{process.exitCode=9;})"
      : scenario.startsWith("cancelled")
        ? "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"
        : "process.stdout.write('debugger stage diagnostic')";
  const exec = scenario.startsWith("cancelled-exec");
  return spawnOwnedProviderProcess({
    ...spawn,
    command: exec ? "/bin/sh" : process.execPath,
    arguments: exec
      ? [
          "-c",
          scenario === "cancelled-exec-foreign"
            ? 'REA_PROCESS_RUN_ID=source-owned-foreign exec "$1" -e "$2"'
            : 'exec "$1" -e "$2"',
          "recorded-debugger-launcher",
          process.execPath,
          script,
        ]
      : ["-e", script],
  });
};

const expectForeignDebuggerPreserved = async (
  child: SpawnedOwnedProviderProcess["process"] | undefined,
): Promise<void> => {
  if (child === undefined || child.pid === undefined)
    throw new Error("Expected an owned fixture PID");
  const environment = await readFile(`/proc/${child.pid}/environ`);
  expect(
    environment.includes(
      Buffer.from("REA_PROCESS_RUN_ID=source-owned-foreign\0"),
    ),
  ).toBe(true);
  expect(child.exitCode).toBeNull();
  expect(child.signalCode).toBeNull();
};

it
  .runIf(host)
  .each([
    "success",
    "success-aarch64",
    "wrong-register",
    "wrong-register-source",
    "missing-thread",
    "duplicate-thread",
    "missing-signal",
    "duplicate-signal",
    "missing-register",
    "duplicated-physical-thread",
    "duplicated-physical-signal",
    "omitted-physical-note",
    "hidden-segment",
    "wrong-header-range",
    "wrong-ei-version-zero",
    "wrong-ei-version-two",
    "wrong-e-version-zero",
    "wrong-e-version-two",
    "wrong-note-kind",
    "wrong-owner-display",
    "wrong-pid",
    "wrong-current-signal",
    "wrong-signal-number",
    "wrong-signal-code",
    "wrong-signal-errno",
    "wrong-signal-address",
    "wrong-raw-note",
    "malformed-range",
  ] as const)(
  "validates recorded source bytes and cleanup: %s",
  async (scenario) => {
    const architecture = scenario.endsWith("aarch64")
      ? "aarch64-little-endian"
      : "x86_64-little-endian";
    const { path, value, bytes } = await fixture((path) => {
      const value = recordedCrashSignalFixture(path, architecture);
      if (scenario === "wrong-owner-display") {
        value.notes = value.notes.map((note) =>
          note.index === 0
            ? {
                ...note,
                owner_bytes_base64: Buffer.from("EVIL\0").toString("base64"),
                owner_display: "EVIL",
              }
            : note,
        );
        value.threads = [];
      }
      return value;
    });
    if (scenario.startsWith("wrong-ei-version-"))
      bytes[6] = Number(scenario.at(-1));
    if (scenario.startsWith("wrong-e-version-"))
      bytes.writeUInt32LE(Number(scenario.at(-1)), 20);
    if (scenario.startsWith("wrong-e")) await writeFile(path, bytes);
    let owned = "";
    const provider = new PwntoolsRecordedCrashProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        owned = spawn.cwd ?? "";
        const request = requestSchema.parse(
          JSON.parse(await readFile(spawn.arguments.at(-1) ?? "", "utf8")),
        );
        expect(
          Buffer.compare(await readFile(request.snapshot_path), bytes),
        ).toBe(0);
        const payload = structuredClone(value);
        alterRecordedCrashReply(payload, scenario);
        const {
          artifact: _artifact,
          diagnostics: _diagnostics,
          debugger: _debugger,
          decoder_diagnostics: _decoderDiagnostics,
          ...raw
        } = payload;
        await writeFile(
          request.reply_path,
          JSON.stringify({
            ok: true,
            profile: PWNTOOLS_PROVIDER_IDENTITY.version,
            value: raw,
          }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", "process.stdout.write('recorded warning')"],
        });
      },
    );
    const result = await provider.inspect({
      path,
      include_debugger_context: false,
    });
    if (scenario === "success" || scenario === "success-aarch64") {
      if (!result.ok) throw result.error;
      expect(result.value.architecture).toBe(architecture);
      expect(result.value.threads).toEqual(value.threads);
      expect(result.value.diagnostics.stdout).toBe("recorded warning");
    } else
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          capturedOutput: { stdout: "recorded warning" },
        },
      });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    await expect(access(owned)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it
  .runIf(host)
  .each([
    "unconfigured",
    "unsafe-mapping",
    "success",
    "process-failure",
    "invalid-context",
    "cancelled",
    "cancelled-exec",
    "cancelled-exec-foreign",
    "cleanup-failure",
    "decoder-cleanup-failure",
  ] as const)(
  "owns optional context from the same snapshot: %s",
  async (scenario) => {
    const { path, value, bytes, root } = await fixture(
      scenario === "unsafe-mapping"
        ? (path) =>
            recordedCrashFileMappingFixture(
              [Buffer.from("../../outside-owned-root")],
              path,
            )
        : recordedCrashFixture,
    );
    const controller = new AbortController();
    let owned = "";
    let snapshotPath = "";
    let cleanupAllowed = false;
    let launches = 0;
    let debuggerProcess: SpawnedOwnedProviderProcess["process"] | undefined;
    const venv = join(root, "venv");
    const plugin = join(root, "gdbinit.py");
    await mkdir(venv);
    await writeFile(plugin, "");
    const provider = new PwntoolsRecordedCrashProvider(
      {
        REA_PWNTOOLS_PYTHON: process.execPath,
        ...(scenario === "unconfigured"
          ? {}
          : {
              REA_PWNDBG_GDB: process.execPath,
              REA_PWNDBG_GDBINIT: plugin,
              REA_PWNDBG_VENV_PATH: venv,
            }),
      },
      async (spawn) => {
        launches++;
        const request = requestSchema.parse(
          JSON.parse(await readFile(spawn.arguments.at(-1) ?? "", "utf8")),
        );
        expect(
          Buffer.compare(await readFile(request.snapshot_path), bytes),
        ).toBe(0);
        if (snapshotPath === "") {
          snapshotPath = request.snapshot_path;
          owned = spawn.cwd ?? "";
          const {
            artifact: _artifact,
            diagnostics: _diagnostics,
            debugger: _debugger,
            decoder_diagnostics: _decoderDiagnostics,
            ...raw
          } = value;
          await writeFile(
            request.reply_path,
            JSON.stringify({
              ok: true,
              profile: PWNTOOLS_PROVIDER_IDENTITY.version,
              value: raw,
            }),
          );
          const launched = await spawnOwnedProviderProcess({
            ...spawn,
            command: process.execPath,
            arguments: ["-e", "process.stdout.write('basic stage diagnostic')"],
          });
          return scenario === "decoder-cleanup-failure"
            ? withCleanupGate(launched, () => cleanupAllowed)
            : launched;
        }
        expect(request.snapshot_path).toBe(snapshotPath);
        const context = recordedCrashDebuggerFixture();
        if (scenario === "invalid-context")
          context.maps = context.maps.map((map) => ({ ...map, end: "0x0" }));
        await writeFile(
          request.reply_path,
          JSON.stringify({ ok: true, value: context }),
        );
        const launched = await spawnDebuggerFixture(spawn, scenario);
        debuggerProcess = launched.process;
        if (scenario.startsWith("cancelled")) {
          await waitForProviderProcessReady(launched.process);
          setImmediate(() => controller.abort());
        }
        return scenario === "cleanup-failure"
          ? withCleanupGate(launched, () => cleanupAllowed)
          : launched;
      },
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      // The test retains its creation handle even when the provider must refuse
      // an exec'd worker with a foreign token, or a regression leaves it live.
      if (debuggerProcess !== undefined)
        await stopProviderProcessFixture(debuggerProcess);
      await provider.close();
    });
    const result = await provider.inspect(
      {
        path,
        include_debugger_context: true,
      },
      { signal: controller.signal },
    );
    if (scenario === "success") {
      if (!result.ok) throw result.error;
      expect(result.value.debugger).toMatchObject({
        status: "available",
        maps: [{ permissions: null }],
        diagnostics: { stdout: "debugger stage diagnostic" },
      });
    } else {
      if (result.ok) throw new Error("Expected optional debugger failure");
      expectOptionalContextFailure(scenario, result.error, value);
      if (scenario === "unsafe-mapping") {
        expect(launches).toBe(1);
        await expect(access(owned)).rejects.toMatchObject({ code: "ENOENT" });
        snapshotPath = "";
        await expectBasicCoreFallback(provider, path, value.notes);
        expect(launches).toBe(2);
      }
      if (scenario === "cancelled-exec-foreign")
        await expectForeignDebuggerPreserved(debuggerProcess);
    }
    if (scenario === "cancelled" || scenario === "cancelled-exec")
      expectDebuggerStopped(debuggerProcess);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    if (
      scenario === "cleanup-failure" ||
      scenario === "decoder-cleanup-failure" ||
      scenario === "cancelled-exec-foreign"
    ) {
      await expect(access(owned)).resolves.toBeUndefined();
      expect(Buffer.compare(await readFile(snapshotPath), bytes)).toBe(0);
      const refused = await provider.inspect({
        path,
        include_debugger_context: true,
      });
      if (refused.ok)
        throw new Error("Unreleased ownership must block a launch");
      expect(refused.error.cleanupResources).toContain(owned);
      expect(launches).toBe(scenario === "decoder-cleanup-failure" ? 1 : 2);
      await expect(provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
      await expect(access(owned)).resolves.toBeUndefined();
      cleanupAllowed = true;
      if (
        scenario === "cancelled-exec-foreign" &&
        debuggerProcess !== undefined
      )
        await stopProviderProcessFixture(debuggerProcess);
      await provider.close();
    }
    await expect(access(owned)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

const expectDebuggerStopped = (
  child: SpawnedOwnedProviderProcess["process"] | undefined,
): void => {
  if (child === undefined)
    throw new Error("Expected an owned debugger process");
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
};

const expectBasicCoreFallback = async (
  provider: PwntoolsRecordedCrashProvider,
  path: string,
  notes: RecordedCrash["notes"],
) => {
  const basic = await provider.inspect({
    path,
    include_debugger_context: false,
  });
  if (!basic.ok) throw basic.error;
  expect(basic.value.notes).toEqual(notes);
  expect(basic.value.debugger).toEqual({ status: "not-requested" });
};

const expectOptionalContextFailure = (
  scenario: string,
  error: AnalysisError,
  value: RecordedCrash,
) => {
  const projected = projectAnalysisError(error);
  if (scenario === "unsafe-mapping")
    expect(error).toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      partialObservation: {
        notes: value.notes,
        debugger: { status: "unavailable", requested: true },
      },
    });
  if (scenario === "cancelled-exec-foreign")
    expect(projected.code).toBe("cleanup_incomplete");
  if (scenario === "unconfigured" || scenario === "unsafe-mapping")
    expect(projected).toMatchObject({
      details: { captured_output: { stdout: "basic stage diagnostic" } },
    });
  else if (scenario === "decoder-cleanup-failure")
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: { captured_output: { stdout: "basic stage diagnostic" } },
      },
    });
  else if (
    scenario === "invalid-context" ||
    scenario.startsWith("cancelled") ||
    scenario === "cleanup-failure"
  ) {
    const serialized = JSON.stringify(projected);
    expect(serialized).toContain("basic stage diagnostic");
    expect(serialized).toContain(
      scenario.startsWith("cancelled") ? "ready" : "debugger stage diagnostic",
    );
    expect(error.partialObservation).toMatchObject({
      artifact: {
        ...value.artifact,
        sha256: createHash("sha256")
          .update(recordedCrashFixtureBytes(value))
          .digest("hex"),
      },
      threads: value.threads,
      notes: value.notes,
    });
    expect(error._tag).toBe(
      scenario === "invalid-context"
        ? "AnalysisOutputError"
        : scenario.startsWith("cancelled") &&
            scenario !== "cancelled-exec-foreign"
          ? "AnalysisCancelledError"
          : "ProviderAdapterError",
    );
    if (scenario === "cleanup-failure" || scenario === "invalid-context") {
      if (scenario === "cleanup-failure")
        expect(error).toBeInstanceOf(ProviderCleanupError);
      expect(projected).toMatchObject({
        details: {
          partial_observation: {
            debugger: { status: "unavailable", requested: true },
          },
        },
      });
    }
  } else
    expect(projected).toMatchObject({
      category: "execution_failure",
      details: {
        diagnostics: {
          preceding_output: { stdout: "basic stage diagnostic" },
          stderr: "debugger failed",
        },
      },
    });
};

it.runIf(host)(
  "reports a non-default debugger deadline when pwndbg times out",
  async () => {
    const { path, value, bytes, root } = await fixture();
    const venv = join(root, "venv");
    const plugin = join(root, "gdbinit.py");
    await mkdir(venv);
    await writeFile(plugin, "");
    let stage = 0;
    const provider = new PwntoolsRecordedCrashProvider(
      {
        REA_PWNTOOLS_PYTHON: process.execPath,
        REA_PWNDBG_GDB: process.execPath,
        REA_PWNDBG_GDBINIT: plugin,
        REA_PWNDBG_VENV_PATH: venv,
      },
      async (spawn) => {
        stage += 1;
        const request = requestSchema.parse(
          JSON.parse(await readFile(spawn.arguments.at(-1) ?? "", "utf8")),
        );
        if (stage === 1) {
          const {
            artifact: _artifact,
            diagnostics: _diagnostics,
            debugger: _debugger,
            decoder_diagnostics: _decoderDiagnostics,
            ...raw
          } = value;
          await writeFile(
            request.reply_path,
            JSON.stringify({
              ok: true,
              profile: PWNTOOLS_PROVIDER_IDENTITY.version,
              value: raw,
            }),
          );
          return spawnOwnedProviderProcess({
            ...spawn,
            command: process.execPath,
            arguments: ["-e", "process.stdout.write('basic stage diagnostic')"],
          });
        }
        await new Promise<void>((resolve) => {
          if (spawn.signal?.aborted === true) {
            resolve();
            return;
          }
          spawn.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", "process.exit(0)"],
        });
      },
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspect({
      path,
      include_debugger_context: true,
      pwntools_timeout_ms: 1_500,
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    if (result.ok) throw new Error("expected debugger timeout");
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe("provider_timeout");
    expect(projected.message).toContain("of 1500 ms");
    expect(projected.remediation.action).toContain("above 1500");
    expect(projected.remediation.action).not.toContain("above 30000");
  },
  10_000,
);

const fixture = async (
  createReport: (path: string) => RecordedCrash = recordedCrashFixture,
) => {
  const workspace = await createTestWorkspace("rea-recorded-core-seam-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = join(workspace.root, "recorded.core");
  const value = createReport(path);
  const bytes = recordedCrashFixtureBytes(value);
  await writeFile(path, bytes);
  return { path, value, bytes, root: workspace.root };
};

const alterRecordedCrashReply = (
  payload: RecordedCrash,
  scenario: string,
): void => {
  if (scenario === "wrong-owner-display")
    payload.notes = payload.notes.map((note) =>
      note.index === 0 ? { ...note, owner_display: "FORGED" } : note,
    );
  if (
    scenario === "duplicated-physical-thread" ||
    scenario === "duplicated-physical-signal"
  ) {
    const noteIndex = scenario === "duplicated-physical-thread" ? 0 : 1;
    const note = payload.notes[noteIndex];
    if (note === undefined) throw new Error("missing fixture note");
    payload.notes.push({ ...note, index: 2 });
    if (noteIndex === 0)
      payload.threads.push(
        ...payload.threads.map((thread) => ({
          ...thread,
          note_index: 2,
        })),
      );
    else
      payload.signals.push(
        ...payload.signals.map((signal) => ({
          ...signal,
          note_index: 2,
        })),
      );
  }
  if (scenario === "omitted-physical-note") {
    payload.notes = payload.notes.filter((note) => note.index === 0);
    payload.signals = [];
  }
  if (scenario === "hidden-segment") {
    payload.segments = [];
    payload.notes = [];
    payload.threads = [];
    payload.signals = [];
  }
  if (scenario === "wrong-header-range")
    payload.segments = payload.segments.map((segment) => ({
      ...segment,
      header_location: { offset: "0x0", bytes: "0x38" },
    }));
  if (scenario === "wrong-note-kind") {
    payload.notes = payload.notes.map((note) =>
      note.index === 0 ? { ...note, type: "NT_AUXV", type_id: 6 } : note,
    );
    payload.threads = [];
  }
  if (scenario === "wrong-register-source")
    payload.threads = payload.threads.map((thread) => ({
      ...thread,
      registers: thread.registers.map((register) =>
        register.name === "rdi"
          ? {
              ...register,
              value: "0x0",
              location: { offset: "0x104", bytes: "0x8" },
            }
          : register,
      ),
    }));
  if (scenario === "missing-thread") payload.threads = [];
  if (scenario === "duplicate-thread")
    payload.threads = [...payload.threads, ...payload.threads];
  if (scenario === "missing-signal") payload.signals = [];
  if (scenario === "duplicate-signal")
    payload.signals = [...payload.signals, ...payload.signals];
  if (scenario === "missing-register")
    payload.threads = payload.threads.map((thread) => ({
      ...thread,
      registers: thread.registers.slice(1),
    }));
  if (scenario === "wrong-register")
    payload.threads = payload.threads.map((t) => ({
      ...t,
      registers: t.registers.map((r) => ({ ...r, value: "0x1" })),
    }));
  if (scenario === "wrong-pid")
    payload.threads = payload.threads.map((thread) => ({
      ...thread,
      historical_pid: -2,
    }));
  if (scenario === "wrong-current-signal")
    payload.threads = payload.threads.map((thread) => ({
      ...thread,
      recorded_current_signal: -1,
    }));
  if (scenario.startsWith("wrong-signal"))
    payload.signals = payload.signals.map((signal) => ({
      ...signal,
      ...(scenario === "wrong-signal-number"
        ? {
            number: 10,
            fault_address: null,
            fault_address_meaning: "unknown" as const,
          }
        : scenario === "wrong-signal-code"
          ? { code: 2 }
          : scenario === "wrong-signal-errno"
            ? { errno: 0 }
            : { fault_address: "0x1" }),
    }));
  if (scenario === "wrong-raw-note")
    payload.notes = payload.notes.map((n) => ({
      ...n,
      descriptor_bytes_base64: Buffer.alloc(336, 1).toString("base64"),
    }));
  if (scenario === "malformed-range")
    payload.notes = payload.notes.map((n) => ({
      ...n,
      descriptor_location: { offset: "0x200", bytes: "0x150" },
    }));
};
