import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it as test, vi } from "vitest";
import { withVerifierCleanup } from "../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../tests/fixtures/lifecycleAcknowledgement.js";

import { createSystemDoctorHost } from "./doctorRuntime.js";
import { DOCTOR_PROVIDER_IDS } from "./application/DoctorProviderIds.js";
import { providerRegistrationEnvironment } from "./application/SetupRegistrationEnvironment.js";
import { createTestTempDirectory } from "../tests/fixtures/temporaryDirectory.js";
import { writeJadxJarInventory } from "../tests/fixtures/android/jadxJar.js";
import * as privateDisplay from "./hopper/LinuxPrivateDisplayProbe.js";
import * as pythonRuntime from "./application/LinuxHopperPython.js";
import { err, ok } from "./domain/result.js";
import { AnalysisError } from "./domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "./domain/analysisErrorCore.js";
import { createDoctorHostFixture } from "./application/Doctor.fixture.js";
import { runDoctorOwned } from "./application/Doctor.js";
import { waitForAbortable } from "./process/AbortablePromise.js";
import { AnalysisCleanupLease } from "./artifacts/AnalysisCleanupLease.js";

const readyDisplay = {
  ok: true,
  strategy: "direct",
  diagnostic: {
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
    status: "ready",
    failure_code: null,
  },
} as const satisfies privateDisplay.LinuxPrivateDisplaySelection;

test.each([undefined, "controlled close refusal"])(
  "propagates runtime-probe cancellation through owned doctor cleanup: %s",
  async (cleanupFailure) => {
    const controller = new AbortController();
    const reason = { request: "cancel Python runtime inspection" };
    const display = vi
      .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
      .mockResolvedValue(readyDisplay);
    const python = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockImplementation(async (_environment, signal) => {
        expect(signal?.aborted).toBe(false);
        controller.abort(reason);
        expect(signal?.reason).toBe(reason);
        return err(
          new pythonRuntime.LinuxHopperPythonError(
            "cancelled",
            "Controlled runtime cancellation",
            reason,
          ),
        );
      });
    const systemHost = createSystemDoctorHost({}, controller.signal);
    const close = vi.fn(async () => {
      await systemHost.close?.();
      return cleanupFailure;
    });
    try {
      const failure = await runDoctorOwned(
        undefined,
        createDoctorHostFixture({
          platform: "linux",
          configuredHopperPath: "/fixture/Hopper",
          signal: controller.signal,
          linuxDemoRuntimeCheck: systemHost.linuxDemoRuntimeCheck,
          close,
        }),
      ).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      if (!(failure instanceof AnalysisError))
        throw new Error("Expected a doctor cancellation failure");
      const primary = failure.cleanupPrimary ?? failure;
      expect(primary).toBeInstanceOf(AnalysisCancelledError);
      expect(primary.cause).toBe(reason);
      expect(primary.diagnostics).toMatchObject({
        hopper_demo_runtime: {
          private_display: readyDisplay.diagnostic,
          embedded_python: { status: "unknown", reason: "cancelled" },
        },
      });
      expect(close).toHaveBeenCalledTimes(1);
      if (cleanupFailure === undefined) expect(failure).toBe(primary);
      else expect(failure.cleanupIncomplete).toBe(true);
    } finally {
      try {
        await systemHost.close?.();
      } finally {
        python.mockRestore();
        display.mockRestore();
      }
    }
  },
);

test("retains a failed display-probe owner until doctor closure confirms release", async () => {
  let released = false;
  const lease = new AnalysisCleanupLease(async () => {
    if (!released) throw new Error("Fixture probe remains owned");
  }, ["fixture-private-display-probe"]);
  const display = vi
    .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
    .mockResolvedValue({
      ok: false,
      strategy: "unavailable",
      exitCode: 70,
      diagnostic: {
        ...readyDisplay.diagnostic,
        status: "error",
        failure_code: "private_display_unavailable",
        strategy: "unavailable",
        reason: "probe_timeout",
      },
      cleanup: {
        status: "pending",
        lease,
        reason: "Fixture probe remains owned",
      },
    });
  const host = createSystemDoctorHost({});
  try {
    const failure = await host.linuxDemoRuntimeCheck().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected retained probe cleanup failure");
    expect(failure.cleanupIncomplete).toBe(true);
    expect(failure.cleanupResources).toEqual(["fixture-private-display-probe"]);
    await expect(host.close?.()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    expect(failure.cleanupIncomplete).toBe(true);
    released = true;
    expect(await host.close?.()).toBeUndefined();
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
  } finally {
    released = true;
    await host.close?.();
    display.mockRestore();
  }
});

test.each(["unavailable", "unknown"] as const)(
  "does not report a healthy Hopper runtime when Python is %s",
  async (state) => {
    const display = vi
      .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
      .mockResolvedValue(readyDisplay);
    const python = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockResolvedValue(
        state === "unavailable"
          ? ok({
              interpreter: "/usr/bin/python3",
              version: [3, 14],
              library: {
                status: "unavailable",
                path: "/usr/lib/libpython3.14.so.1.0",
                reason: "No such file",
              },
            })
          : err(
              new pythonRuntime.LinuxHopperPythonError(
                "query_failed",
                "Fixture query failed",
              ),
            ),
      );
    try {
      const check = await createSystemDoctorHost({}).linuxDemoRuntimeCheck?.();
      expect(check).toMatchObject({
        name: "hopper-demo-runtime",
        ok: false,
        classification:
          state === "unavailable" ? "missing_dependency" : "unknown",
        details: {
          private_display: readyDisplay.diagnostic,
          embedded_python: {
            scope: "system_interpreter",
            hopper_interpreter: "unknown",
            ...(state === "unavailable"
              ? { status: "observed", library: { status: "unavailable" } }
              : { status: "unknown", reason: "query_failed" }),
          },
        },
      });
      expect(check?.remediation).toContain(
        state === "unavailable"
          ? "rea setup --install-hopper"
          : "Retry rea doctor",
      );
    } finally {
      python.mockRestore();
      display.mockRestore();
    }
  },
);

test.each([true, false])(
  "interrupts the Hopper display readiness check when doctor is cancelled: cancel=%s",
  async (cancel) => {
    const controller = new AbortController();
    const reason = { request: "cancel doctor display check" };
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const selected = vi
      .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
      .mockImplementation(async (options) => {
        enter();
        await waitForAbortable(gate, options.signal);
        return readyDisplay;
      });
    const inspected = vi
      .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
      .mockImplementation(async (_environment, signal) =>
        signal?.aborted === true
          ? err(
              new pythonRuntime.LinuxHopperPythonError(
                "cancelled",
                "Fixture cancellation",
                signal.reason,
              ),
            )
          : ok({
              interpreter: "/usr/bin/python3",
              version: [3, 14],
              library: {
                status: "loadable",
                path: "/fixture/libpython.so",
              },
            }),
      );
    const system = createSystemDoctorHost({}, controller.signal);
    let settled = false;
    const pending = runDoctorOwned(
      undefined,
      createDoctorHostFixture({
        platform: "linux",
        configuredHopperPath: "/fixture/Hopper",
        signal: controller.signal,
        linuxDemoRuntimeCheck: system.linuxDemoRuntimeCheck,
        close: async () => {
          await system.close?.();
          return undefined;
        },
      }),
      { providers: ["hopper"] },
    )
      .then(
        (report) => ({ report, error: undefined }),
        (error: unknown) => ({ report: undefined, error }),
      )
      .finally(() => {
        settled = true;
      });
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(entered, pending, "display selection");
      expect(selected.mock.calls).toHaveLength(1);
      if (cancel) {
        controller.abort(reason);
        const result = await pending;
        const selectedSignal = selected.mock.calls[0]?.[0].signal;
        expect(selectedSignal?.aborted).toBe(true);
        expect(selectedSignal?.reason).toBe(reason);
        expect(inspected).not.toHaveBeenCalled();
        expect(result.error).toBeInstanceOf(AnalysisCancelledError);
        expect((result.error as Error).cause).toBe(reason);
      } else {
        expect(settled).toBe(false);
        expect(inspected).not.toHaveBeenCalled();
        release();
        const result = await pending;
        expect(result.error).toBeUndefined();
        expect(result.report?.checks).toContainEqual(
          expect.objectContaining({ name: "hopper-demo-runtime", ok: true }),
        );
      }
    }, [
      release,
      async () => {
        await pending;
      },
      async () => {
        await system.close?.();
      },
      () => inspected.mockRestore(),
      () => selected.mockRestore(),
    ]);
  },
  5_000,
);

test("joins display finalization before preserving a late cancellation", async () => {
  const controller = new AbortController();
  const reason = { phase: "display finalization" };
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const finalized = new Promise<void>((resolve) => {
    release = resolve;
  });
  const selected = vi
    .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
    .mockImplementation(async () => {
      // Controlled selector finalization: cancellation must not detach this wait.
      enter();
      await finalized;
      return readyDisplay;
    });
  const inspected = vi
    .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
    .mockRejectedValue(
      new Error("Python inspection must not start after cancellation"),
    );
  const system = createSystemDoctorHost({}, controller.signal);
  let settled = false;
  const pending = system.linuxDemoRuntimeCheck!()
    .then(
      () => undefined,
      (error: unknown) => error,
    )
    .finally(() => {
      settled = true;
    });
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(entered, pending, "display finalization");
    controller.abort(reason);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(inspected).not.toHaveBeenCalled();
    release();
    const failure = await pending;
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    expect((failure as Error).cause).toBe(reason);
    expect(inspected).not.toHaveBeenCalled();
  }, [
    release,
    async () => {
      await pending;
    },
    async () => {
      await system.close?.();
    },
    () => inspected.mockRestore(),
    () => selected.mockRestore(),
  ]);
});

test("rejects a pre-aborted caller before the Hopper display check", async () => {
  const controller = new AbortController();
  controller.abort("pre-aborted");
  const runtime = vi.fn();
  await expect(
    runDoctorOwned(
      undefined,
      createDoctorHostFixture({
        platform: "linux",
        signal: controller.signal,
        linuxDemoRuntimeCheck: runtime,
      }),
    ),
  ).rejects.toBeInstanceOf(AnalysisCancelledError);
  expect(runtime).not.toHaveBeenCalled();
});

test("preserves both X11 and Python failures and their independent remediation", async () => {
  const display = vi
    .spyOn(privateDisplay, "selectLinuxPrivateDisplayStrategy")
    .mockResolvedValue({
      ok: false,
      strategy: "unavailable",
      exitCode: 80,
      diagnostic: {
        ...readyDisplay.diagnostic,
        status: "error",
        failure_code: "x11_socket_directory_unusable",
      },
    });
  const python = vi
    .spyOn(pythonRuntime, "inspectLinuxHopperPythonRuntime")
    .mockResolvedValue(
      ok({
        interpreter: "/usr/bin/python3",
        version: [3, 14],
        library: { status: "unknown", reason: "No INSTSONAME" },
      }),
    );
  try {
    const check = await createSystemDoctorHost({}).linuxDemoRuntimeCheck?.();
    expect(check).toMatchObject({
      ok: false,
      classification: "config_drift",
      details: {
        private_display: { failure_code: "x11_socket_directory_unusable" },
        embedded_python: { status: "observed", library: { status: "unknown" } },
      },
    });
    expect(check?.remediation).toContain("user and mount namespaces");
    expect(check?.remediation).toContain("shared-runtime configuration");
  } finally {
    python.mockRestore();
    display.mockRestore();
  }
});

const it = test.skipIf(process.platform === "win32");

it("exposes jadx through the doctor provider selector", () => {
  expect(DOCTOR_PROVIDER_IDS).toContain("jadx");
});

it("carries a validated REA_JADX_MCP_JAR into the provider registration environment", async () => {
  const root = await createTestTempDirectory("rea-jadx-registration-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const host = createSystemDoctorHost({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });
  const inspections = await host.providerInspections?.();
  expect(inspections?.map(({ id }) => id)).toContain("jadx");

  const environment = providerRegistrationEnvironment(inspections ?? []);
  expect(environment).toMatchObject({
    REA_JADX_MCP_JAR: await realpath(jar),
  });
});

it("omits REA_JADX_MCP_JAR from the provider registration environment when it is not configured", async () => {
  const host = createSystemDoctorHost({});
  const inspections = await host.providerInspections?.();

  const environment = providerRegistrationEnvironment(inspections ?? []);
  expect(environment).not.toHaveProperty("REA_JADX_MCP_JAR");
});

it("shares one parsed IDA registration between timeout-budget and doctor projections", async () => {
  const root = await createTestTempDirectory("rea-ida-registration-fact-");
  const registration = join(root, "registration.json");
  await writeFile(
    registration,
    JSON.stringify({ command: "fixture", timeoutMs: 3210 }),
  );
  const host = createSystemDoctorHost({ REA_IDA_MCP_CONFIG: registration });
  try {
    expect(
      await host.resolveProviderRequestBudget?.("ida", {
        REA_IDA_MCP_CONFIG: registration,
      }),
    ).toEqual(ok(3210));
    await writeFile(registration, "not JSON anymore");
    const inspections = await host.providerInspections?.();
    expect(inspections?.find(({ id }) => id === "ida")).toMatchObject({
      configured: true,
      available: true,
      checks: [{ name: "registration", ok: true }],
    });
  } finally {
    await host.close?.();
  }
});

it("carries a validated REA_KUNA_COMMAND into the provider registration environment", async () => {
  expect(DOCTOR_PROVIDER_IDS).toContain("kuna");
  const root = await createTestTempDirectory("rea-kuna-registration-");
  const kuna = join(root, "kuna");
  await writeFile(kuna, "#!/bin/sh\nprintf 'kuna 1.833\\n'\n", { mode: 0o700 });

  const inspections = await createSystemDoctorHost({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  }).providerInspections?.();

  expect(inspections?.find(({ id }) => id === "kuna")).toMatchObject({
    available: true,
    providerVersion: "1.833",
  });
  expect(providerRegistrationEnvironment(inspections ?? [])).toMatchObject({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });
});

const createFakeJdk = async (root: string): Promise<string> => {
  const javaHome = join(root, "fake-jdk");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  await writeFile(
    java,
    "#!/bin/sh\nprintf 'java.base@21\\njdk.compiler@21\\n'\n",
  );
  await chmod(java, 0o700);
  return javaHome;
};
