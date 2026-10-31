import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { z } from "zod";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { primaryAnalysisError } from "../../src/domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { PwntoolsRecordedCrashProvider } from "../../src/native/pwntools/PwntoolsRecordedCrashProvider.js";
import type { PwntoolsLauncher } from "../../src/native/pwntools/PwntoolsDecoder.js";
import {
  PWNTOOLS_MEMORY_FAILURE_EXIT,
  PWNTOOLS_PROVIDER_IDENTITY,
} from "../../src/native/pwntools/PwntoolsRelease.js";
import {
  cleanupOwnedProcessGroup,
  type OwnedProcessGroup,
} from "../../src/process/ProcessOwnership.js";
import { prepareProcessOwnershipInspection } from "../../src/process/ProcessOwnershipObservation.js";
import { spawnOwnedProviderProcess } from "../../src/process/ProviderProcess.js";
import { PrivateRuntimeRoot } from "../../src/process/PrivateRuntimeRoot.js";
import {
  withArtifactFileHandle,
  ArtifactFileCleanupFailure,
} from "../../src/artifacts/ArtifactFileOperation.js";
import * as artifacts from "../../src/artifacts/readStableArtifact.js";
import {
  recordedCrashFixture,
  recordedCrashFixtureBytes,
  recordedCrashDebuggerFixture,
} from "../fixtures/binaryDiagnostics/recordedCrash.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../support/workspace/workspaceFixture.js";

const supportedHost = process.platform !== "win32";
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const architecture = Object.getOwnPropertyDescriptor(process, "arch");
const worker = fileURLToPath(
  new URL("../fixtures/pwntoolsChangingArtifact.mjs", import.meta.url),
);
beforeAll(() =>
  supportedHost ? prepareProcessOwnershipInspection() : undefined,
);
beforeEach(() => {
  // Use the actual host inspector; simulate only the decoder availability gate.
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
});
afterEach(() => {
  if (platform !== undefined)
    Object.defineProperty(process, "platform", platform);
  if (architecture !== undefined)
    Object.defineProperty(process, "arch", architecture);
  vi.restoreAllMocks();
});

const fixture = async () => {
  const workspace = await createTestWorkspace("rea-stage-retirement-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const path = workspace.path("selected.core");
  const value = recordedCrashFixture(path);
  await writeFile(path, recordedCrashFixtureBytes(value));
  const root = await PrivateRuntimeRoot.create({
    parent: workspace.root,
    prefix: "owned-",
  });
  const venv = workspace.path("venv");
  const plugin = workspace.path("gdbinit.py");
  await mkdir(venv);
  await writeFile(plugin, "");
  const environment = {
    REA_PWNTOOLS_PYTHON: process.execPath,
    REA_PWNDBG_GDB: process.execPath,
    REA_PWNDBG_GDBINIT: plugin,
    REA_PWNDBG_VENV_PATH: venv,
  };
  const {
    artifact: _artifact,
    diagnostics: _diagnostics,
    debugger: _debugger,
    decoder_diagnostics: _decoderDiagnostics,
    ...payload
  } = value;
  const reply = JSON.stringify({
    ok: true,
    profile: PWNTOOLS_PROVIDER_IDENTITY.version,
    value: payload,
  });
  const basic: PwntoolsLauncher = async (spawn) => {
    await writeFile(join(root.path, "reply.json"), reply);
    return spawnOwnedProviderProcess({
      ...spawn,
      arguments: ["-e", "process.stdout.write('basic diagnostic')"],
    });
  };
  return { path, root, environment, basic, reply };
};

const changingWorker = async (
  spawn: Parameters<NonNullable<PwntoolsLauncher>>[0],
  path: string,
  contents: { initial: string; final: string; exitCode: number },
  cleanupAllowed: () => boolean = () => true,
) => {
  const trigger = join(spawn.cwd ?? "", "change.trigger");
  const ready = join(spawn.cwd ?? "", "descendant.ready");
  const done = join(spawn.cwd ?? "", "change.done");
  const launched = await spawnOwnedProviderProcess({
    ...spawn,
    arguments: [
      worker,
      "leader",
      path,
      contents.initial,
      contents.final,
      trigger,
      ready,
      done,
      String(contents.exitCode),
    ],
  });
  let stops = 0;
  return {
    ...launched,
    cleanup: async () => {
      if (++stops === 1 || !cleanupAllowed())
        return {
          cleaned: false as const,
          reason: "fixture inspection unavailable",
        };
      const descendant = Number(await readFile(ready, "utf8"));
      expect(() => process.kill(descendant, 0)).not.toThrow();
      await writeFile(trigger, "change now");
      await expect
        .poll(() =>
          access(done).then(
            () => true,
            () => false,
          ),
        )
        .toBe(true);
      return cleanupOwnedProcessGroup(launched.ownership);
    },
  };
};

it.runIf(supportedHost).each(["decoder", "debugger"] as const)(
  "classifies %s failure markers only after surviving descendants stop",
  async (stage) => {
    const { path, root, environment, basic } = await fixture();
    let launches = 0;
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        if (stage === "debugger" && ++launches === 1) return basic(spawn);
        const marker = join(spawn.cwd ?? "", "resource.failure");
        await writeFile(
          join(spawn.cwd ?? "", "limits.json"),
          JSON.stringify(recordedCrashDebuggerFixture().reported_limits),
        );
        return changingWorker(spawn, marker, {
          initial: "M",
          final: "!",
          exitCode: PWNTOOLS_MEMORY_FAILURE_EXIT,
        });
      },
      async () => root,
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspectAndClose({
      path,
      include_debugger_context: stage === "debugger",
    });
    if (result.ok) throw new Error("Expected the original command failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "execution_failure",
      details: {
        diagnostics: {
          phase: stage,
          resource_failure_marker: { resource: null },
          exit_code: PWNTOOLS_MEMORY_FAILURE_EXIT,
          captured_output: { stdout: "stage diagnostic" },
        },
      },
    });
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "publishes debugger replies only after surviving descendants stop",
  async () => {
    const { path, root, environment, basic } = await fixture();
    let launches = 0;
    const context = recordedCrashDebuggerFixture();
    const finalContext = { ...context, pwndbg_version: "after retirement" };
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        if (++launches === 1) return basic(spawn);
        return changingWorker(spawn, join(spawn.cwd ?? "", "reply.json"), {
          initial: JSON.stringify({ ok: true, value: context }),
          final: JSON.stringify({ ok: true, value: finalContext }),
          exitCode: 0,
        });
      },
      async () => root,
    );
    onTestFinished(() => provider.close());
    const result = await provider.inspectAndClose({
      path,
      include_debugger_context: true,
    });
    if (!result.ok) throw result.error;
    expect(result.value.debugger).toMatchObject({
      status: "available",
      pwndbg_version: "after retirement",
    });
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost).each([
  { stage: "decoder", outcome: "success" },
  { stage: "decoder", outcome: "failure" },
  { stage: "debugger", outcome: "success" },
  { stage: "debugger", outcome: "failure" },
] as const)(
  "does not read unresolved $stage files after command $outcome",
  async ({ stage, outcome }) => {
    const { path, root, environment, basic } = await fixture();
    let launches = 0;
    let cleanupAllowed = false;
    let retainedOwnership: OwnedProcessGroup | undefined;
    const read = vi.spyOn(artifacts, "readStableArtifact");
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        if (stage === "debugger" && ++launches === 1) return basic(spawn);
        const launched = await changingWorker(
          spawn,
          join(spawn.cwd ?? "", "resource.failure"),
          {
            initial: "M",
            final: "!",
            exitCode: outcome === "success" ? 0 : PWNTOOLS_MEMORY_FAILURE_EXIT,
          },
          () => cleanupAllowed,
        );
        retainedOwnership = launched.ownership;
        return launched;
      },
      async () => root,
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspectAndClose({
      path,
      include_debugger_context: true,
    });
    if (result.ok) throw new Error("Expected unresolved process ownership");
    const projected = projectAnalysisError(result.error);
    expect(projected.code).toBe("cleanup_incomplete");
    if (retainedOwnership === undefined)
      throw new Error("Expected retained process ownership");
    expect(projected.details?.resources).toEqual(
      expect.arrayContaining([
        retainedOwnership.runId,
        root.path,
        `pid:${retainedOwnership.leaderPid}`,
        `process-group:${retainedOwnership.processGroupId}`,
      ]),
    );
    expect(projected.details?.resources).toHaveLength(4);
    if (stage === "debugger")
      expect(projected).toMatchObject({
        details: {
          partial_observation: {
            artifact: { path },
            debugger: { status: "unavailable", requested: true },
          },
        },
      });
    if (outcome === "failure")
      expect(projected).toMatchObject({
        details: {
          diagnostics: {
            primary_error: { code: "execution_failure" },
          },
        },
      });
    const stagePath =
      stage === "debugger" ? join(root.path, "debugger") : root.path;
    const paths = read.mock.calls.map(([selected]) => selected);
    for (const file of ["reply.json", "resource.failure", "limits.json"])
      expect(paths).not.toContain(join(stagePath, file));
    const descendant = Number(
      await readFile(join(stagePath, "descendant.ready"), "utf8"),
    );
    expect(() => process.kill(descendant, 0)).not.toThrow();
    await expect(access(root.path)).resolves.toBeUndefined();
  },
);

it.runIf(supportedHost)(
  "retains a live debugger after output overflow with basic evidence and retryable cleanup",
  async () => {
    const { path, root, environment, basic } = await fixture();
    let launches = 0;
    let pid: number | undefined;
    let cleanupAllowed = false;
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        if (++launches === 1) return basic(spawn);
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          arguments: [
            "-e",
            'process.stdout.write("x".repeat(1048577)); setInterval(() => undefined, 1000)',
          ],
        });
        pid = launched.process.pid;
        return {
          ...launched,
          cleanup: () =>
            cleanupAllowed
              ? cleanupOwnedProcessGroup(launched.ownership)
              : Promise.resolve({
                  cleaned: false as const,
                  reason: "fixture inspection unavailable",
                }),
        };
      },
      async () => root,
    );
    onTestFinished(async () => {
      cleanupAllowed = true;
      await provider.close();
    });
    const result = await provider.inspectAndClose({
      path,
      include_debugger_context: true,
    });
    if (result.ok) throw new Error("Expected retained output-limit failure");
    const projected = projectAnalysisError(result.error);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        captured_output: { truncated: true },
        diagnostics: { primary_error: { code: "unreadable_output" } },
        partial_observation: {
          artifact: { path },
          diagnostics: { stdout: "basic diagnostic" },
          debugger: { status: "unavailable", requested: true },
        },
      },
    });
    if (pid === undefined) throw new Error("Expected a live owned debugger");
    const debuggerPid = pid;
    expect(() => process.kill(debuggerPid, 0)).not.toThrow();
    cleanupAllowed = true;
    await provider.close();
    expect(() => process.kill(debuggerPid, 0)).toThrow();
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost).each(["decoder", "debugger"])(
  "does not reinterpret a completed %s read when retention cancels after failed close",
  async (stage) => {
    const { path, root, environment, basic } = await fixture();
    const controller = new AbortController();
    const reason = { stage: "retention callback after owner completion" };
    const reply = join(
      root.path,
      ...(stage === "debugger" ? ["debugger"] : []),
      "reply.json",
    );
    const read = artifacts.readStableArtifact;
    let injected = false;
    let releaseAllowed = false;
    const closeFailure = new Error("reply close refused");
    const emergencyCloses: (() => Promise<void>)[] = [];
    vi.spyOn(artifacts, "readStableArtifact").mockImplementation(
      async (...args) => {
        if (args[0] !== reply || injected) return read(...args);
        injected = true;
        const resources = args[4];
        if (resources === undefined)
          throw new Error("Reply must have an artifact resource owner");
        const file = await open(reply, "r");
        const close = file.close.bind(file);
        emergencyCloses.push(close);
        file.close = async () => {
          if (!releaseAllowed) throw closeFailure;
          await close();
        };
        const retain = resources.retain.bind(resources);
        const spy = vi
          .spyOn(resources, "retain")
          .mockImplementation((owner) => {
            retain(owner);
            controller.abort(reason);
          });
        try {
          return await withArtifactFileHandle(
            reply,
            file,
            resources,
            controller.signal,
            () => read(...args),
          );
        } finally {
          spy.mockRestore();
        }
      },
    );
    let launches = 0;
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        if (++launches === 1) return basic(spawn);
        await writeFile(
          reply,
          JSON.stringify({ ok: true, value: recordedCrashDebuggerFixture() }),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: ["-e", "process.stdout.write('debugger diagnostic')"],
        });
      },
      async () => root,
    );
    onTestFinished(async () => {
      releaseAllowed = true;
      try {
        await provider.close();
      } finally {
        await Promise.all(emergencyCloses.map((close) => close()));
      }
    });
    const result = await provider.inspectAndClose(
      { path, include_debugger_context: true },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected the physical reply-close failure");
    expect(controller.signal.reason).toBe(reason);
    const completionFailure = primaryAnalysisError(result.error);
    if (stage === "debugger") {
      expect(result.error).toBeInstanceOf(ProviderCleanupError);
      expect(result.error.diagnostics).toMatchObject({
        stage: "debugger_reply_descriptor_close",
      });
      expect(result.error.partialObservation).toMatchObject({
        artifact: { path },
        debugger: {
          status: "available",
          connection: "core",
          maps: recordedCrashDebuggerFixture().maps,
          diagnostics: { stdout: "debugger diagnostic" },
        },
      });
    } else {
      expect(launches).toBe(1);
      expect(completionFailure).toBeInstanceOf(ProviderCleanupError);
      expect(completionFailure.diagnostics).toMatchObject({
        phase: "reply_descriptor_close",
      });
      expect(result.error.partialObservation).toMatchObject({
        artifact: { path },
        debugger: { status: "unavailable", requested: true },
      });
    }
    expect(completionFailure.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
    if (!(completionFailure.cause instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected exact file owner");
    expect(completionFailure.cause.fileCleanupFailure.outcome.kind).toBe(
      "completed",
    );
    expect(completionFailure.cause.fileCleanupFailure.cleanupCause).toBe(
      closeFailure,
    );
    expect(
      completionFailure.cause.fileCleanupFailure.completionCancellation,
    ).toBeUndefined();
    expect(result.error.cleanupIncomplete).toBe(true);
    const observation = result.error.partialObservation;
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    await expect(access(root.path)).resolves.toBeUndefined();
    releaseAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(result.error.partialObservation).toBe(observation);
    expect(result.error.capturedOutput?.stdout).toContain("basic diagnostic");
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost).each(
  ["resource.failure", "limits.json"].flatMap((receipt) =>
    ["valid", "malformed", "read-failure"].map((outcome) => ({
      receipt,
      outcome,
    })),
  ),
)(
  "retains $outcome $receipt receipt facts while its exact descriptor awaits retry",
  async ({ receipt, outcome }) => {
    const { path, root, environment } = await fixture();
    const selected = join(root.path, receipt);
    const read = artifacts.readStableArtifact;
    let releaseAllowed = false;
    let injected = false;
    const emergencyCloses: (() => Promise<void>)[] = [];
    vi.spyOn(artifacts, "readStableArtifact").mockImplementation(
      async (...args) => {
        if (args[0] !== selected || injected) return read(...args);
        injected = true;
        return read(
          args[0],
          args[1],
          args[2],
          {
            lstat: (filePath) => lstat(filePath, { bigint: true }),
            open: async (filePath, flags) => {
              const file = await open(filePath, flags);
              const close = file.close.bind(file);
              if (outcome === "read-failure")
                file.read = async () => {
                  throw new Error("receipt physical read refused");
                };
              emergencyCloses.push(close);
              file.close = async () => {
                if (!releaseAllowed)
                  throw new Error("receipt descriptor close refused");
                await close();
              };
              return file;
            },
          },
          args[4],
        );
      },
    );
    const limits = recordedCrashDebuggerFixture().reported_limits;
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        await writeFile(
          join(root.path, "resource.failure"),
          receipt === "resource.failure" && outcome === "malformed" ? "F" : "M",
        );
        await writeFile(
          join(root.path, "limits.json"),
          receipt === "limits.json" && outcome === "malformed"
            ? '{"cpu_seconds": "invalid"}'
            : JSON.stringify(limits),
        );
        return spawnOwnedProviderProcess({
          ...spawn,
          arguments: [
            "-e",
            `process.exit(${String(PWNTOOLS_MEMORY_FAILURE_EXIT)})`,
          ],
        });
      },
      async () => root,
    );
    onTestFinished(async () => {
      releaseAllowed = true;
      await provider.close();
      await Promise.all(emergencyCloses.map((close) => close()));
    });
    const result = await provider.inspectAndClose({
      path,
      include_debugger_context: false,
    });
    if (result.ok)
      throw new Error("Expected the observed bridge memory failure");
    const primary = projectAnalysisError(result.error).details?.diagnostics;
    expect(primary).toMatchObject({
      primary_error: {
        code:
          receipt === "resource.failure" && outcome !== "valid"
            ? "execution_failure"
            : "resource_constraint",
        ...(receipt === "resource.failure" && outcome !== "valid"
          ? {
              details: {
                diagnostics: { resource_failure_marker: { resource: null } },
              },
            }
          : {
              details: {
                resource: "memory",
                reported_limits:
                  receipt === "limits.json" && outcome !== "valid"
                    ? null
                    : limits,
              },
            }),
      },
    });
    if (outcome === "valid")
      expect(JSON.stringify(primary)).toContain(
        "receipt_finalization_failures",
      );
    if (outcome === "read-failure")
      expect(JSON.stringify(primary)).toContain(
        receipt === "resource.failure"
          ? "receipt physical read refused"
          : "Effective limit report unavailable",
      );
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    await expect(access(root.path)).resolves.toBeUndefined();
    releaseAllowed = true;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.runIf(supportedHost)(
  "keeps decoder and debugger children on one selected environment while later calls reconfigure",
  async () => {
    const { path, root, environment: selected, reply } = await fixture();
    const environment: NodeJS.ProcessEnv = {
      ...selected,
      REA_ENV_MARKER: "first",
    };
    const originalPython = join(root.path, "..", "python-selected");
    const { symlink } = await import("node:fs/promises");
    await symlink(process.execPath, originalPython);
    environment.REA_PWNTOOLS_PYTHON = originalPython;
    const commands: string[] = [];
    const provider = new PwntoolsRecordedCrashProvider(
      environment,
      async (spawn) => {
        const request = z
          .object({ reply_path: z.string(), gdb: z.string().optional() })
          .parse(
            JSON.parse(await readFile(spawn.arguments.at(-1) ?? "", "utf8")),
          );
        const debuggerStage = request.gdb !== undefined;
        commands.push(spawn.command);
        if (debuggerStage) expect(request.gdb).toBe(selected.REA_PWNDBG_GDB);
        await writeFile(
          request.reply_path,
          debuggerStage
            ? JSON.stringify({
                ok: true,
                value: recordedCrashDebuggerFixture(),
              })
            : reply,
        );
        environment.REA_ENV_MARKER = "changed-during-launch";
        environment.REA_PWNTOOLS_PYTHON = "/missing-python";
        environment.REA_PWNDBG_GDB = "/missing-gdb";
        const child = await spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", "process.stdout.write(process.env.REA_ENV_MARKER)"],
        });
        return child;
      },
      async () => {
        environment.REA_ENV_MARKER = "changed-during-runtime";
        environment.REA_PWNTOOLS_PYTHON = "/missing-python";
        return PrivateRuntimeRoot.create({
          parent: root.path,
          prefix: "operation-",
        });
      },
    );
    onTestFinished(async () => {
      await provider.close();
      await root.close();
    });
    for (const marker of ["first", "second"]) {
      if (marker === "second")
        Object.assign(environment, selected, { REA_ENV_MARKER: marker });
      const result = await provider.inspect({
        path,
        include_debugger_context: true,
      });
      expect(
        result.ok
          ? result.value.decoder_diagnostics.stdout
          : result.error.capturedOutput?.stdout,
      ).toBe(marker);
      if (!result.ok) throw result.error;
      expect(result.value.debugger).toMatchObject({
        status: "available",
        diagnostics: { stdout: marker },
      });
    }
    expect(commands).toEqual([
      originalPython,
      originalPython,
      process.execPath,
      process.execPath,
    ]);
  },
);
