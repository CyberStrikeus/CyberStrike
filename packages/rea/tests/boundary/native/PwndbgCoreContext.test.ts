import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../../../src/domain/analysisErrorCore.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../../tests/support/workspace/workspaceFixture.js";
import { inspectPwndbgCore } from "../../../src/native/pwndbg/PwndbgCoreContext.js";

const diagnostics = { stdout: "", stderr: "", truncated: false };

it.each(["pre-aborted", "aborted-during-probe"] as const)(
  "observes cancellation at the debugger admission checkpoint: %s",
  async (scenario) => {
    const workspace = await createTestWorkspace("rea-pwndbg-cancel-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const controller = new AbortController();
    const reason = { cancelled: scenario };
    const gdb = join(workspace.root, "missing-gdb");
    let probes = 0;
    const probePath = async () => {
      probes++;
      if (scenario === "aborted-during-probe") {
        await new Promise<void>((resolve) => {
          setImmediate(() => {
            controller.abort(reason);
            resolve();
          });
        });
        return;
      }
      throw new Error("path is unavailable");
    };
    if (scenario === "pre-aborted") controller.abort(reason);
    const inspection = inspectPwndbgCore({
      environment: {
        REA_PWNDBG_GDB: gdb,
        REA_PWNDBG_GDBINIT: join(workspace.root, "missing-init"),
        REA_PWNDBG_VENV_PATH: join(workspace.root, "missing-venv"),
      },
      architecture: "x86_64-little-endian",
      rootPath: workspace.root,
      resources: new ArtifactResourceScope(),
      diagnostics,
      options: { signal: controller.signal },
      probePath,
      timeoutMs: 30_000,
      runCommand: () => {
        throw new Error("No process should exist before cancellation");
      },
    });
    const failure = await inspection.catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisCancelledError))
      throw new Error(
        "Expected cancellation at the debugger admission boundary",
      );
    expect(failure.cause).toBe(reason);
    expect(probes).toBe(scenario === "pre-aborted" ? 0 : 1);
    await expect(
      access(join(workspace.root, "debugger")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

const execute = promisify(execFile);

it("establishes core-only debugger state before querying recorded mappings", async () => {
  await execute(
    "python3",
    ["-m", "unittest", "bridge/pwndbg/test_core_context.py", "-v"],
    {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
});

it.each(["x86_64-little-endian", "aarch64-little-endian"] as const)(
  "passes the validated %s profile to the debugger without reinterpreting core bytes",
  async (architecture) => {
    const workspace = await createTestWorkspace("rea-pwndbg-profile-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    let requested = false;
    await expect(
      inspectPwndbgCore({
        architecture,
        environment: {
          REA_PWNDBG_GDB: join(workspace.root, "gdb"),
          REA_PWNDBG_GDBINIT: join(workspace.root, "gdbinit.py"),
          REA_PWNDBG_VENV_PATH: join(workspace.root, "venv"),
        },
        rootPath: workspace.root,
        resources: new ArtifactResourceScope(),
        diagnostics,
        options: undefined,
        probePath: async () => {},
        timeoutMs: 30_000,
        runCommand: async () => {
          const request: unknown = JSON.parse(
            await readFile(
              join(workspace.root, "debugger", "request.json"),
              "utf8",
            ),
          );
          expect(request).toMatchObject({
            architecture,
            snapshot_path: join(workspace.root, "object.snapshot"),
          });
          requested = true;
          throw new Error("Stop after observing the debugger request");
        },
      }),
    ).rejects.toBeDefined();
    expect(requested).toBe(true);
  },
);

it.each(["cancelled", "physical-name", "physical-identity"])(
  "uses the debugger command owner's outcome despite a late signal: %s",
  async (outcome) => {
    const workspace = await createTestWorkspace("rea-pwndbg-command-outcome-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const controller = new AbortController();
    const reason = { stage: "command handoff" };
    const failure = new OwnedCommandFailure(
      outcome === "cancelled" ? "cancelled" : "process",
      "owned command outcome",
      null,
      null,
      { cancellation: outcome === "cancelled" ? { reason } : undefined },
    );
    if (outcome === "physical-name") failure.name = "AbortError";
    const inspection = inspectPwndbgCore({
      environment: {
        REA_PWNDBG_GDB: workspace.path("gdb"),
        REA_PWNDBG_GDBINIT: workspace.path("gdbinit.py"),
        REA_PWNDBG_VENV_PATH: workspace.path("venv"),
      },
      architecture: "x86_64-little-endian",
      rootPath: workspace.root,
      resources: new ArtifactResourceScope(),
      diagnostics: { stdout: "basic evidence", stderr: "", truncated: false },
      options: { signal: controller.signal },
      probePath: async () => {},
      timeoutMs: 30_000,
      runCommand: async () => {
        controller.abort(outcome === "physical-identity" ? failure : reason);
        throw failure;
      },
    });
    const result = await inspection.catch((cause: unknown) => cause);
    if (!(result instanceof Error))
      throw new Error("Expected a typed command failure");
    expect(result).toMatchObject({
      _tag:
        outcome === "cancelled"
          ? "AnalysisCancelledError"
          : "ProviderAdapterError",
    });
    expect(result.cause).toBe(outcome === "cancelled" ? reason : failure);
  },
);

it("reports a non-default debugger deadline instead of 30000 ms", async () => {
  const workspace = await createTestWorkspace("rea-pwndbg-deadline-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const failure = await inspectPwndbgCore({
    environment: {
      REA_PWNDBG_GDB: workspace.path("gdb"),
      REA_PWNDBG_GDBINIT: workspace.path("gdbinit.py"),
      REA_PWNDBG_VENV_PATH: workspace.path("venv"),
    },
    architecture: "x86_64-little-endian",
    rootPath: workspace.root,
    resources: new ArtifactResourceScope(),
    diagnostics,
    options: undefined,
    probePath: async () => {},
    timeoutMs: 60_000,
    runCommand: () => {
      throw new OwnedCommandFailure("timeout", "deadline expired");
    },
  }).catch((cause: unknown) => cause);
  if (!(failure instanceof AnalysisTimeoutError))
    throw new Error("Expected a typed debugger timeout");
  const projected = projectAnalysisError(failure);
  expect(projected.code).toBe("provider_timeout");
  expect(projected.message).toContain("of 60000 ms");
  expect(projected.remediation.action).toContain("above 60000");
  expect(projected.remediation.action).not.toContain("above 30000");
});

it("retains a physical debugger path failure when cancellation arrives in the probe", async () => {
  const workspace = await createTestWorkspace("rea-pwndbg-probe-failure-");
  onTestFinished(() => removeTestWorkspace(workspace.root));
  const controller = new AbortController();
  const physical = Object.assign(new Error("path denied"), { code: "EACCES" });
  const inspection = inspectPwndbgCore({
    environment: {
      REA_PWNDBG_GDB: workspace.path("gdb"),
      REA_PWNDBG_GDBINIT: workspace.path("gdbinit.py"),
      REA_PWNDBG_VENV_PATH: workspace.path("venv"),
    },
    architecture: "x86_64-little-endian",
    rootPath: workspace.root,
    resources: new ArtifactResourceScope(),
    diagnostics,
    options: { signal: controller.signal },
    timeoutMs: 30_000,
    probePath: async () => {
      controller.abort({ late: true });
      throw physical;
    },
    runCommand: () => {
      throw new Error("No command may start after probe failure");
    },
  });
  const failure = await inspection.catch((cause: unknown) => cause);
  expect(failure).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    cause: physical,
  });
});
