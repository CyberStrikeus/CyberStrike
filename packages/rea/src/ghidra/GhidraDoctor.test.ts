import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";

import { missingJavaProbe } from "./GhidraInstallation.fixture.js";
import { ok as javaProbeOk } from "../domain/result.js";
import type { GhidraJavaObservation } from "./GhidraJavaProbe.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor, type DoctorHost } from "../application/Doctor.js";
import { createDoctorHostFixture } from "../application/Doctor.fixture.js";
import { providerRegistrationEnvironment } from "../application/SetupRegistrationEnvironment.js";
import * as nativeLoader from "../windows/WindowsNativeLoader.js";
import {
  inspectGhidraInstallation,
  type GhidraInstallationHost,
  type GhidraInstallationInspection,
} from "./GhidraInstallation.js";
import { projectGhidraDoctorInspection } from "./GhidraDoctor.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

const INSTALL = "/opt/ghidra_12.1.4_PUBLIC";
const installationHost = (
  overrides: Partial<GhidraInstallationHost> = {},
  platform: NodeJS.Platform = "linux",
): GhidraInstallationHost => ({
  readText: () => "application.version=12.1.4\napplication.java.min=21\n",
  executable: () => true,
  probeJava: () =>
    javaProbeOk<GhidraJavaObservation>({
      osArch: "amd64",
      osName: platform === "win32" ? "Windows 11" : "Linux",
      version: "21.0.11",
      major: 21,
      home: "/usr/lib/jvm/jdk-21",
      bits: 64,
      runtime: "jdk",
    }),
  ...overrides,
});

const inspection = async (
  options: {
    readonly installDir?: string;
    readonly architecture?: NodeJS.Architecture;
    readonly platform?: NodeJS.Platform;
  } = { installDir: INSTALL },
  overrides: Partial<GhidraInstallationHost> = {},
): Promise<GhidraInstallationInspection> =>
  await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      platform: options.platform ?? "linux",
      architecture: options.architecture ?? "x64",
      ...(options.installDir === undefined
        ? {}
        : { installDir: options.installDir }),
    },
    installationHost(overrides, options.platform ?? "linux"),
  );

const doctorHost = (
  ghidra: GhidraInstallationInspection,
  hopperAvailable = false,
): DoctorHost =>
  createDoctorHostFixture({
    platform: "linux",
    architecture: "x64",
    macosVersion: () => Promise.resolve(undefined),
    linuxDistribution: () =>
      Promise.resolve({
        id: "ubuntu",
        versionId: "24.04",
        packageFamily: "deb",
        hopperSetupSupported: true,
      }),
    validTarget: () => Promise.resolve(true),
    executable: (path) =>
      Promise.resolve(hopperAvailable && path.includes("Hopper")),
    linuxDemoRuntimeCheck: () =>
      Promise.resolve({
        name: "hopper-demo-runtime",
        ok: true,
        classification: "healthy",
      }),
    brewHopperPath: () => Promise.resolve(undefined),
    manualHopperPaths: () => Promise.resolve([]),
    providerInspections: () =>
      Promise.resolve([projectGhidraDoctorInspection(ghidra)]),
  });

describe("Ghidra doctor integration", async () => {
  it("accepts a valid BYO Ghidra engine when Hopper is absent", async () => {
    const result = await runDoctor(undefined, doctorHost(await inspection()));

    expect(result.healthy).toBe(true);
    expect(result.hopperPath).toBeUndefined();
    expect(result.providerInspections?.[0]).toMatchObject({
      id: "ghidra",
      available: true,
      providerVersion: "12.1.4",
      registrationEnvironment: {
        GHIDRA_INSTALL_DIR: INSTALL,
        JAVA_HOME: "/usr/lib/jvm/jdk-21",
      },
    });
    expect(
      result.checks.find(({ name }) => name === "ghidra-java"),
    ).toMatchObject({
      ok: true,
      detail: expect.stringContaining("21.0.11"),
    });
  });

  it.each([
    [
      "bad installation",
      await inspection({ installDir: INSTALL }, { readText: () => undefined }),
      "ghidra-installation",
    ],
    [
      "wrong version",
      await inspection(
        { installDir: INSTALL },
        {
          readText: () => "application.version=11.4\napplication.java.min=21\n",
        },
      ),
      "ghidra-version",
    ],
    [
      "missing analyzeHeadless",
      await inspection({ installDir: INSTALL }, { executable: () => false }),
      "ghidra-headless",
    ],
    [
      "wrong Java",
      await inspection(
        { installDir: INSTALL },
        {
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({
              osArch: "amd64",
              osName: "Linux",
              version: "17.0.12",
              major: 17,
              home: "/usr/lib/jvm/jdk-17",
              bits: 64,
              runtime: "jdk",
            }),
        },
      ),
      "ghidra-java",
    ],
    [
      "missing Java minimum",
      await inspection(
        { installDir: INSTALL },
        { readText: () => "application.version=12.1.4\n" },
      ),
      "ghidra-java",
    ],
    [
      "unsupported architecture",
      await inspection({ installDir: INSTALL, architecture: "arm" }),
      "ghidra-architecture",
    ],
  ] as const)("distinguishes %s", async (_label, ghidra, checkName) => {
    const result = await runDoctor(undefined, doctorHost(ghidra, true));

    expect(result.healthy).toBe(false);
    expect(result.checks.find(({ name }) => name === checkName)).toMatchObject({
      ok: false,
      remediation: expect.any(String),
    });
  });

  it("treats unconfigured Ghidra as optional when Hopper is healthy", async () => {
    const result = await runDoctor(
      undefined,
      doctorHost(await inspection({}), true),
    );

    expect(result.healthy).toBe(true);
    expect(result.checks.find(({ name }) => name === "ghidra")).toMatchObject({
      ok: false,
      classification: "missing_analysis_engine",
    });
  });
});

describe("Windows Ghidra doctor authority", () => {
  beforeEach(() => {
    vi.spyOn(nativeLoader, "systemWindowsNativeAuthority").mockReturnValue({
      available: false,
      failureStage: "artifact",
      reason: "Authored native artifact unavailable diagnostic",
    });
  });
  afterEach(() => vi.restoreAllMocks());
  it("distinguishes a valid Windows installation from unavailable native authority", async () => {
    const ghidra = await inspection({
      installDir: "C:\\tools\\ghidra_12.1.4_PUBLIC",
      platform: "win32",
    });
    const result = await runDoctor(undefined, {
      ...doctorHost(ghidra),
      platform: "win32",
      architecture: "x64",
      linuxDistribution: () => Promise.resolve(undefined),
    });

    expect(result.healthy).toBe(false);
    expect(result.providerInspections?.[0]).toMatchObject({
      available: false,
      providerVersion: "12.1.4",
      registrationEnvironment: {
        GHIDRA_INSTALL_DIR: "C:\\tools\\ghidra_12.1.4_PUBLIC",
      },
    });
    expect(
      providerRegistrationEnvironment(result.providerInspections ?? []),
    ).toMatchObject({
      GHIDRA_INSTALL_DIR: "C:\\tools\\ghidra_12.1.4_PUBLIC",
    });
    expect(result.checks.find(({ name }) => name === "host")).toMatchObject({
      ok: true,
      detail: "win32 x64",
    });
    expect(result.checks.find(({ name }) => name === "ghidra")).toMatchObject({
      ok: true,
    });
    expect(
      result.checks.find(({ name }) => name === "ghidra-java"),
    ).toMatchObject({ ok: true });
    expect(
      result.checks.find(({ name }) => name === "ghidra-native_authority"),
    ).toMatchObject({
      ok: false,
      classification: "missing_dependency",
      detail: "Authored native artifact unavailable diagnostic",
      remediation: expect.stringContaining("matching Windows x64 REA package"),
    });
  });

  it("fails provider-scoped Windows readiness without blaming installation", async () => {
    const ghidra = await inspection({
      installDir: "C:\\tools\\ghidra_12.1.4_PUBLIC",
      platform: "win32",
    });
    const result = await runDoctor(
      undefined,
      {
        ...doctorHost(ghidra),
        platform: "win32",
        linuxDistribution: () => Promise.resolve(undefined),
      },
      { providers: ["ghidra"] },
    );
    expect(result.healthy).toBe(false);
    expect(result.scope_checks).toContainEqual(
      expect.objectContaining({
        name: "ghidra-native_authority",
        classification: "missing_dependency",
        detail: "Authored native artifact unavailable diagnostic",
      }),
    );
  });
});

describe("Windows native doctor failure diagnostics", () => {
  beforeEach(() => {
    vi.spyOn(nativeLoader, "systemWindowsNativeAuthority").mockReturnValue({
      available: false,
      failureStage: "artifact",
      reason: "Authored native artifact unavailable diagnostic",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["host", "unsupported_host", "unsupported_host", "Windows x64 host"],
    [
      "artifact",
      "runtime_missing",
      "missing_dependency",
      "native/windows/README.md",
    ],
    [
      "self-test",
      "runtime_unavailable",
      "runtime_failure",
      "preserved native self-test error",
    ],
    [
      "inspection",
      "runtime_unavailable",
      "runtime_failure",
      "every required security control",
    ],
  ] as const)(
    "projects %s failure without blaming Ghidra",
    async (failureStage, code, classification, remediation) => {
      const reason =
        "Windows native failure: remove_owned_directory: directory is not empty (145)";
      const load = vi.mocked(nativeLoader.systemWindowsNativeAuthority);
      load.mockReturnValue({ available: false, failureStage, reason });
      const result = await runDoctor(
        undefined,
        {
          ...doctorHost(
            await inspection({ installDir: INSTALL, platform: "win32" }),
          ),
          platform: "win32",
          linuxDistribution: () => Promise.resolve(undefined),
        },
        { providers: ["ghidra"] },
      );
      expect(load).toHaveBeenCalledTimes(1);
      expect(result.healthy).toBe(false);
      expect(result.providerInspections?.[0]).toMatchObject({
        available: false,
        registrationEnvironment: { GHIDRA_INSTALL_DIR: INSTALL },
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "native_authority",
            ok: false,
            code,
            detail: reason,
          }),
        ]),
      });
      expect(result.scope_checks).toContainEqual(
        expect.objectContaining({
          name: "ghidra-native_authority",
          classification,
          detail: reason,
          remediation: expect.stringContaining(remediation),
        }),
      );
    },
  );

  it("keeps one failure observation even when the next query would differ", async () => {
    const load = vi.mocked(nativeLoader.systemWindowsNativeAuthority);
    load.mockReturnValueOnce({
      available: false,
      failureStage: "self-test",
      retryable: true,
      reason: "cleanup failed (145)",
    });
    const ghidra = await inspection({ installDir: INSTALL, platform: "win32" });
    const failed = projectGhidraDoctorInspection(ghidra);
    expect(load).toHaveBeenCalledTimes(1);
    expect(failed.checks).toContainEqual(
      expect.objectContaining({
        name: "native_authority",
        ok: false,
        code: "runtime_unavailable",
        detail: "cleanup failed (145)",
      }),
    );
    const later = projectGhidraDoctorInspection(ghidra);
    expect(load).toHaveBeenCalledTimes(2);
    expect(later.checks).toContainEqual(
      expect.objectContaining({
        name: "native_authority",
        code: "runtime_missing",
        detail: "Authored native artifact unavailable diagnostic",
      }),
    );
  });

  it("keeps missing Windows Java actionable as a dependency failure", async () => {
    const projected = projectGhidraDoctorInspection(
      await inspection(
        {
          installDir: "C:\\tools\\ghidra_12.1.4_PUBLIC",
          platform: "win32",
        },
        { probeJava: () => missingJavaProbe },
      ),
    );
    expect(projected.available).toBe(false);
    expect(projected.checks).toContainEqual(
      expect.objectContaining({
        name: "java",
        ok: false,
        classification: "missing_dependency",
        remediation: expect.any(String),
      }),
    );
  });
});
