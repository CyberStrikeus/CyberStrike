import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ownership from "../../../../src/process/ProcessOwnership.js";

import {
  DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  HOPPER_DEMO_DIALOG_TIMEOUT_SETTING,
  MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  type HopperStartupDiagnostic,
  type HopperStartupFailureCode,
} from "../../../../src/domain/hopperStartupFailure.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { HopperProcessError } from "../../../../src/domain/hopperErrors.js";
import { analysisErrorProjectionSchema } from "../../../../src/contracts/errorSchemas.js";
import {
  runLinuxPrivateDisplayProbe,
  selectLinuxPrivateDisplayStrategy,
  type LinuxPrivateDisplayProbeProcessResult,
  type LinuxPrivateDisplayProbeRunner,
  type LinuxPrivateDisplayRunnableStrategy,
} from "../../../../src/hopper/LinuxPrivateDisplayProbe.js";
import {
  LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX,
  parseLinuxPrivateDisplayDiagnostic,
} from "../../../../src/hopper/LinuxPrivateDisplayDiagnostic.js";

const helperPath = fileURLToPath(
  new URL("../../../../scripts/hopper-demo-x11.py", import.meta.url),
);
const hangingHelperPath = fileURLToPath(
  new URL("../../../fixtures/x11ProbeHang.py", import.meta.url),
);
const dialogDetectionFixturePath = fileURLToPath(
  new URL("../../../fixtures/hopperDialogDetection.py", import.meta.url),
);
const dialogOutcomeFixturePath = fileURLToPath(
  new URL("../../../fixtures/hopperDemoDialogOutcome.py", import.meta.url),
);
const pythonCommand = ["python3", "python"].find(
  (candidate) =>
    spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0,
);
const cleanupTimeoutFixturePath = fileURLToPath(
  new URL("../../../fixtures/hopperCleanupTimeout.py", import.meta.url),
);
const ownerLifetimeFixturePath = fileURLToPath(
  new URL("../../../fixtures/hopperOwnerLifetime.py", import.meta.url),
);
const displaySelectionFixturePath = fileURLToPath(
  new URL("../../../fixtures/hopperDisplaySelection.py", import.meta.url),
);

type DiagnosticOverrides = Partial<
  Omit<HopperStartupDiagnostic, "failure_code" | "status">
> &
  (
    | { readonly status?: "ready"; readonly failure_code?: null }
    | {
        readonly status: "error";
        readonly failure_code: HopperStartupFailureCode;
      }
  );

const diagnostic = (overrides: DiagnosticOverrides = {}) => {
  const common = {
    component: "hopper_private_display",
    operation: "probe",
    reason: "ready",
    socket_directory: "/tmp/.X11-unix",
    socket_directory_mode: "1777",
    mount_read_only: false,
    effective_socket_directory_mode: "1777",
    effective_mount_read_only: false,
    wsl: false,
    strategy: "direct",
    fallback_reason: null,
    xvfb_stderr_bytes: 0,
  } as const;
  return overrides.status === "error"
    ? ({ ...common, ...overrides } satisfies HopperStartupDiagnostic)
    : ({
        ...common,
        ...overrides,
        status: "ready",
        failure_code: null,
      } satisfies HopperStartupDiagnostic);
};

const processResult = (
  value: HopperStartupDiagnostic,
  overrides: Partial<LinuxPrivateDisplayProbeProcessResult> = {},
): LinuxPrivateDisplayProbeProcessResult => ({
  outcome: "exited",
  exitCode: value.status === "ready" ? 0 : failureExit(value.failure_code),
  stderr: `${LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX}${JSON.stringify(value)}\n`,
  stderrBytes: 0,
  cleanup: { status: "released" },
  ...overrides,
});

const failureExit = (code: HopperStartupFailureCode): number =>
  code === "x11_socket_directory_unusable"
    ? 80
    : code === "runtime_dependency_unavailable"
      ? 79
      : code === "demo_dialog_absent"
        ? 81
        : 70;

describe("Hopper demo dialog detection", () => {
  it.skipIf(process.platform !== "linux")(
    "uses the Hopper transient-parent relation instead of exact dialog geometry",
    () => {
      const result = spawnSync(
        "/usr/bin/python3",
        [dialogDetectionFixturePath, helperPath],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        dialog: [10, 20, 100, 1200, 284],
        click: [136, 362],
        wrong_parent_rejected: true,
      });
    },
  );
});

describe("Hopper demo dialog timeout outcomes", () => {
  it.skipIf(pythonCommand === undefined)(
    "distinguishes an unowned launcher from an admitted launcher without a dialog",
    () => {
      const result = spawnSync(
        pythonCommand ?? "python3",
        [dialogOutcomeFixturePath],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        not_owned: { code: 74, reason: "process_ownership_mismatch" },
        admitted_without_window: {
          code: 81,
          reason: "demo_dialog_absent",
        },
        admitted_with_window: {
          code: 76,
          reason: "unsupported_demo_dialog",
        },
        default_timeout: { ms: 10_000 },
        configured_timeout: { ms: 25_000 },
        requested_timeout: { ms: 500 },
        invalid_timeout: {
          code: 82,
          reason: "invalid_dialog_timeout",
          dialog_timeout: {
            setting: HOPPER_DEMO_DIALOG_TIMEOUT_SETTING,
            value: "-5",
            source: "setting",
            minimum_ms: MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
            maximum_ms: MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
            default_ms: DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
          },
        },
        watcher_no_window: {
          code: 81,
          reason: "demo_dialog_absent",
          elapsed_ms: 1_000,
        },
        watcher_hopper_window_without_dialog: {
          code: 76,
          reason: "unsupported_demo_dialog",
          elapsed_ms: 1_000,
        },
        watcher_dialog_after_legacy_limit: {
          dialog: 10,
          elapsed_ms: DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS + 100,
          legacy_limit_ms: DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
        },
      });
      const timeout = JSON.parse(result.stdout).invalid_timeout.dialog_timeout;
      const parsed = parseLinuxPrivateDisplayDiagnostic(
        `${LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX}${JSON.stringify({
          ...diagnostic({
            status: "error",
            operation: "launch",
            reason: "invalid_dialog_timeout",
            failure_code: "invalid_dialog_timeout",
          }),
          dialog_timeout: timeout,
        })}\n`,
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.value.status !== "error")
        throw new Error("Expected an error diagnostic for the invalid timeout");
      const projected = projectAnalysisError(
        new HopperProcessError(82, { diagnostic: parsed.value }),
      );
      expect(projected).toMatchObject({
        code: "provider_unavailable",
        details: {
          failure_code: "invalid_dialog_timeout",
          exit_code: 82,
          diagnostics: { dialog_timeout: timeout },
        },
      });
      expect(projected.details).not.toHaveProperty("launch_rejection");
      expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
        true,
      );
    },
  );
});

describe("Hopper process cleanup", () => {
  it.skipIf(process.platform !== "linux").each(["startup", "ready"])(
    "reaps only its own children when the owner pipe closes during %s",
    (phase) => {
      const result = spawnSync(
        "/usr/bin/python3",
        [ownerLifetimeFixturePath, helperPath, phase],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        phase,
        children_cleaned: true,
        sentinel_alive: true,
      });
    },
  );

  it.skipIf(process.platform !== "linux")(
    "kills a child that ignores SIGTERM after the bounded timeout",
    () => {
      const result = spawnSync(
        "/usr/bin/python3",
        [cleanupTimeoutFixturePath, helperPath],
        { encoding: "utf8", timeout: 5_000 },
      );
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

describe("Hopper demo explicit display number", () => {
  it.skipIf(process.platform !== "linux")(
    "honors an explicit display zero instead of choosing a random display",
    () => {
      const result = spawnSync(
        "/usr/bin/python3",
        [displaySelectionFixturePath, helperPath],
        { encoding: "utf8", timeout: 5_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const explicit = (display: string) => ({
        authorized: [`:${display}`],
        checked: [`/tmp/.X11-unix/X${display}`, `/tmp/.X${display}-lock`],
        random_calls: 0,
        reason: "xauth_failed",
      });
      expect(JSON.parse(result.stdout)).toEqual({
        explicit_zero: explicit("0"),
        explicit_zero_random_occupied: explicit("0"),
        explicit_zero_occupied: {
          authorized: [],
          checked: ["/tmp/.X11-unix/X0"],
          random_calls: 0,
          reason: "address_collision",
        },
        explicit_one: explicit("1"),
        omitted: {
          authorized: [":123"],
          checked: ["/tmp/.X11-unix/X123", "/tmp/.X123-lock"],
          random_calls: 1,
          reason: "xauth_failed",
        },
      });
    },
  );
});

describe("Linux private display selection", () => {
  it("prefers a successful direct Xvfb probe", async () => {
    const calls: LinuxPrivateDisplayRunnableStrategy[] = [];
    const runProbe: LinuxPrivateDisplayProbeRunner = (strategy) => {
      calls.push(strategy);
      return Promise.resolve(processResult(diagnostic({ strategy })));
    };

    await expect(
      selectLinuxPrivateDisplayStrategy({ helperPath, runProbe }),
    ).resolves.toMatchObject({ ok: true, strategy: "direct" });
    expect(calls).toEqual(["direct"]);
  });

  it("uses a private mount namespace only for the exact socket conflict", async () => {
    const calls: LinuxPrivateDisplayRunnableStrategy[] = [];
    const runProbe: LinuxPrivateDisplayProbeRunner = (strategy) => {
      calls.push(strategy);
      return Promise.resolve(
        strategy === "direct"
          ? processResult(
              diagnostic({
                strategy,
                status: "error",
                failure_code: "x11_socket_directory_unusable",
                reason: "socket_directory_read_only",
                socket_directory_mode: "0777",
                mount_read_only: true,
                effective_socket_directory_mode: "0777",
                effective_mount_read_only: true,
                wsl: true,
              }),
            )
          : processResult(diagnostic({ strategy, wsl: true })),
      );
    };

    const selected = await selectLinuxPrivateDisplayStrategy({
      helperPath,
      runProbe,
    });
    expect(selected).toMatchObject({
      ok: true,
      strategy: "user-mount-namespace",
      diagnostic: {
        socket_directory_mode: "0777",
        mount_read_only: true,
        effective_socket_directory_mode: "1777",
        effective_mount_read_only: false,
        wsl: true,
      },
    });
    expect(calls).toEqual(["direct", "user-mount-namespace"]);
  });

  it.each([
    ["missing_xvfb", "runtime_dependency_unavailable", 79],
    ["address_collision", "private_display_unavailable", 70],
  ] as const)(
    "does not mask deterministic direct failure %s with a namespace probe",
    async (reason, failureCode, exitCode) => {
      const calls: LinuxPrivateDisplayRunnableStrategy[] = [];
      const runProbe: LinuxPrivateDisplayProbeRunner = (strategy) => {
        calls.push(strategy);
        return Promise.resolve(
          processResult(
            diagnostic({
              strategy,
              status: "error",
              failure_code: failureCode,
              reason,
            }),
            { exitCode },
          ),
        );
      };
      await expect(
        selectLinuxPrivateDisplayStrategy({ helperPath, runProbe }),
      ).resolves.toMatchObject({ ok: false, exitCode });
      expect(calls).toEqual(["direct"]);
    },
  );

  it("rejects malformed helper diagnostics", async () => {
    const runProbe: LinuxPrivateDisplayProbeRunner = () =>
      Promise.resolve({
        ...processResult(diagnostic()),
        exitCode: 70,
        stderr: `${LINUX_PRIVATE_DISPLAY_DIAGNOSTIC_PREFIX}not-json`,
      });
    await expect(
      selectLinuxPrivateDisplayStrategy({ helperPath, runProbe }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostic: { reason: "diagnostic_malformed" },
    });
  });

  it("reports missing helper dependencies without exposing raw stderr", () => {
    for (const [option] of [
      ["--xauth", "missing_xauth"],
      ["--xvfb", "missing_xvfb"],
    ] as const) {
      const result = spawnSync(
        "/usr/bin/python3",
        [helperPath, "--probe", option, "/rea/missing-executable"],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(79);
      const parsed = parseLinuxPrivateDisplayDiagnostic(result.stderr);
      expect(parsed).toMatchObject({
        ok: true,
        value: {
          status: "error",
          failure_code: "runtime_dependency_unavailable",
        },
      });
      if (parsed.ok)
        expect(parsed.value.reason).toMatch(/^missing_(xauth|xvfb)$/u);
      expect(result.stderr).not.toContain("Traceback");
    }
  });

  it("kills the owned probe group when its absolute deadline expires", async () => {
    const result = await selectLinuxPrivateDisplayStrategy({
      helperPath: hangingHelperPath,
      timeoutMs: 75,
      runProbe: runLinuxPrivateDisplayProbe,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { reason: "probe_timeout" },
    });
    const processes = spawnSync("/bin/ps", ["-eo", "args="], {
      encoding: "utf8",
    }).stdout;
    expect(processes).not.toContain(hangingHelperPath);
  });
});

describe("private display probe output settlement", () => {
  it.skipIf(process.platform === "win32")(
    "retains inherited diagnostics written after the launcher exits",
    async () => {
      const result = await runLinuxPrivateDisplayProbe("direct", {
        helperPath: fileURLToPath(
          new URL("../../../fixtures/x11ProbeOutput.py", import.meta.url),
        ),
        timeoutMs: 5_000,
      });
      expect(result).toEqual({
        outcome: "exited",
        exitCode: 0,
        stderr: "firstlast",
        stderrBytes: Buffer.byteLength("firstlast"),
        cleanup: { status: "released" },
      });
    },
  );
});

it("passes the private X authority cookie through xauth stdin", () => {
  const fixture = fileURLToPath(
    new URL("../../../fixtures/hopperXauthority.py", import.meta.url),
  );
  const process = spawnSync("python3", ["-I", "-S", fixture, helperPath], {
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(process.status, process.stderr).toBe(0);
  expect(JSON.parse(process.stdout)).toMatchObject({
    arguments: ["fixture-xauth", "-q", "-f", expect.any(String), "source", "-"],
    stdin: `add :123 . ${"0123456789abcdef".repeat(2)}\n`,
    cookie_in_argv: false,
    mode: 0o600,
  });
});

const inertProbe = async (keepLeader = false) => {
  const root = await mkdtemp(join(tmpdir(), "rea-private-display-lifecycle-"));
  const marker = join(root, "descendant-survived");
  const ready = join(root, "ready");
  const helper = join(root, "probe.py");
  const child = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 800)`;
  await writeFile(
    helper,
    [
      "import subprocess, sys, time",
      `subprocess.Popen([${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(child)}], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
      `open(${JSON.stringify(ready)}, 'w').write('ready')`,
      "sys.stderr.write('authored probe diagnostic')",
      "sys.stderr.flush()",
      ...(keepLeader ? ["time.sleep(2)"] : []),
    ].join("\n"),
  );
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return { helper, marker, ready };
};

it.skipIf(process.platform === "win32")(
  "stops silent owned descendants before releasing a normally exited probe",
  async () => {
    const { helper, marker } = await inertProbe();
    const result = await runLinuxPrivateDisplayProbe("direct", {
      helperPath: helper,
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({
      outcome: "exited",
      exitCode: 0,
      stderr: "authored probe diagnostic",
      cleanup: { status: "released" },
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.skipIf(process.platform === "win32").each(["exited", "cancelled"] as const)(
  "retains refused probe cleanup and retries its exact owner after %s",
  async (outcome) => {
    const { helper, ready } = await inertProbe(outcome === "cancelled");
    const controller = new AbortController();
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    onTestFinished(() => {
      scheduled.mockRestore();
      cleared.mockRestore();
    });
    const original = ownership.cleanupOwnedProcessGroup;
    const cleanup = vi
      .spyOn(ownership, "cleanupOwnedProcessGroup")
      .mockImplementation(async () => {
        // Finalization cancellation must not replace a completed probe outcome.
        if (outcome === "exited") controller.abort("cancelled during cleanup");
        return {
          cleaned: false,
          reason: "controlled display probe cleanup refusal",
        };
      });
    let pending:
      | Extract<
          LinuxPrivateDisplayProbeProcessResult["cleanup"],
          { status: "pending" }
        >
      | undefined;
    onTestFinished(async () => {
      cleanup.mockRestore();
      await pending?.lease.release();
    });
    const operation = runLinuxPrivateDisplayProbe("direct", {
      helperPath: helper,
      timeoutMs: 5000,
      signal: controller.signal,
    });
    if (outcome === "cancelled") {
      await vi.waitFor(async () => expect(await access(ready)).toBeUndefined());
      controller.abort("caller stopped");
    }
    const result = await operation;
    expect(result.outcome).toBe(outcome);
    // The probe has settled despite refused cleanup; no abandoned output wait
    // should keep its original deadline alive until a later cleanup retry.
    const deadlines = scheduled.mock.calls.flatMap((arguments_, index) =>
      arguments_[1] === 5000 ? [scheduled.mock.results[index]!.value] : [],
    );
    expect(deadlines.length).toBeGreaterThan(0);
    for (const timer of deadlines) expect(cleared).toHaveBeenCalledWith(timer);
    expect(result.stderr).toBe("authored probe diagnostic");
    expect(result.cleanup.status).toBe("pending");
    if (result.cleanup.status !== "pending")
      throw new Error("Expected retained probe owner");
    pending = result.cleanup;
    const retainedRunId = cleanup.mock.calls[0]?.[0].runId;
    await expect(pending.lease.release()).rejects.toThrow(
      "controlled display probe cleanup refusal",
    );
    expect(
      cleanup.mock.calls.every(([owner]) => owner.runId === retainedRunId),
    ).toBe(true);
    cleanup.mockImplementation(original);
    await pending.lease.release();
    expect(pending.lease.released).toBe(true);
  },
);
