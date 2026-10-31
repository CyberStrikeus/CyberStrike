import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";

import { missingJavaProbe } from "./GhidraInstallation.fixture.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok as javaProbeOk } from "../domain/result.js";
import {
  parseGhidraJavaOutput,
  type GhidraJavaObservation,
} from "./GhidraJavaProbe.js";
import {
  chmod,
  mkdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { elf, fat, thinMach } from "../domain/binaryTarget.fixture.js";
import { projectGhidraDoctorInspection } from "./GhidraDoctor.js";
import {
  ghidraInstallationDiagnostics,
  ghidraJavaEnvironment,
  discoverGhidraInstallationOnPath,
  inspectGhidraInstallation,
  type GhidraInstallationHost,
} from "./GhidraInstallation.js";
import {
  ghidraApplicationProperties,
  ghidraJavaRequirement,
} from "./GhidraInstallationPolicy.js";
import {
  SUPPORTED_GHIDRA_JAVA_MAJOR,
  SUPPORTED_GHIDRA_VERSION,
} from "./GhidraReleasePolicy.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

const INSTALL = "/opt/ghidra";
const PROPERTIES = `${INSTALL}/Ghidra/application.properties`;
const HEADLESS = `${INSTALL}/support/analyzeHeadless`;
const LINUX_DECOMPILER = `${INSTALL}/Ghidra/Features/Decompiler/os/linux_x86_64/decompile`;
const MAC_DECOMPILER = `${INSTALL}/Ghidra/Features/Decompiler/os/mac_arm_64/decompile`;
const WINDOWS_INSTALL = "C:\\tools\\ghidra_12.1.4_PUBLIC";
const WINDOWS_PROPERTIES = `${WINDOWS_INSTALL}\\Ghidra\\application.properties`;
const WINDOWS_HEADLESS = `${WINDOWS_INSTALL}\\support\\analyzeHeadless.bat`;
const WINDOWS_DECOMPILER = `${WINDOWS_INSTALL}\\Ghidra\\Features\\Decompiler\\os\\win_x86_64\\decompile.exe`;

const headerProbe = (bytes: Buffer) =>
  javaProbeOk({ bytes, size: bytes.length });

const JAVA: GhidraJavaObservation = {
  osArch: "amd64",
  osName: "Linux",
  version: "21.0.11",
  major: SUPPORTED_GHIDRA_JAVA_MAJOR,
  home: "/usr/lib/jvm/jdk-21",
  bits: 64,
  runtime: "jdk",
};

const host = (
  overrides: Partial<GhidraInstallationHost> = {},
): GhidraInstallationHost => ({
  readText: (path) =>
    path === PROPERTIES
      ? `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=${String(SUPPORTED_GHIDRA_JAVA_MAJOR)}\n`
      : undefined,
  executable: (path) =>
    path === HEADLESS || path === MAC_DECOMPILER || path === LINUX_DECOMPILER,
  probeJava: () => javaProbeOk<GhidraJavaObservation>(JAVA),
  ...overrides,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it.skipIf(process.platform === "win32")(
  "resolves a PATH launcher only when its real target is a complete installation",
  async () => {
    const root = await createTestTempDirectory("rea-ghidra-path-");
    const installation = join(root, "installation");
    const pathDirectory = join(root, "bin");
    const launcher = join(installation, "ghidraRun");
    await mkdir(join(installation, "Ghidra"), { recursive: true });
    await mkdir(join(installation, "support"), { recursive: true });
    await mkdir(pathDirectory, { recursive: true });
    await writeFile(
      join(installation, "Ghidra", "application.properties"),
      "application.version=12.1.4\n",
    );
    await writeFile(launcher, "#!/bin/sh\nexit 0\n");
    await writeFile(
      join(installation, "support", "analyzeHeadless"),
      "#!/bin/sh\nexit 0\n",
    );
    await chmod(launcher, 0o700);
    await chmod(join(installation, "support", "analyzeHeadless"), 0o700);
    await symlink(launcher, join(pathDirectory, "ghidra"));

    expect(
      discoverGhidraInstallationOnPath(
        { PATH: pathDirectory },
        process.platform,
      ),
    ).toBe(installation);

    const incomplete = join(root, "incomplete");
    const incompletePath = join(root, "incomplete-bin");
    await mkdir(join(incomplete, "Ghidra"), { recursive: true });
    await mkdir(incompletePath, { recursive: true });
    await writeFile(
      join(incomplete, "Ghidra", "application.properties"),
      "application.version=12.1.4\n",
    );
    await writeFile(join(incomplete, "ghidraRun"), "launcher\n");
    await chmod(join(incomplete, "ghidraRun"), 0o700);
    await symlink(
      join(incomplete, "ghidraRun"),
      join(incompletePath, "ghidra"),
    );
    expect(
      discoverGhidraInstallationOnPath(
        { PATH: incompletePath },
        process.platform,
      ),
    ).toBeUndefined();

    const nonExecutable = join(root, "non-executable");
    const nonExecutablePath = join(root, "non-executable-bin");
    await mkdir(join(nonExecutable, "Ghidra"), { recursive: true });
    await mkdir(join(nonExecutable, "support"), { recursive: true });
    await mkdir(nonExecutablePath, { recursive: true });
    await writeFile(
      join(nonExecutable, "Ghidra", "application.properties"),
      "application.version=12.1.4\n",
    );
    await writeFile(
      join(nonExecutable, "support", "analyzeHeadless"),
      "headless\n",
    );
    await chmod(join(nonExecutable, "support", "analyzeHeadless"), 0o700);
    await writeFile(join(nonExecutablePath, "ghidra"), "not executable\n");
    expect(
      discoverGhidraInstallationOnPath(
        { PATH: nonExecutablePath },
        process.platform,
      ),
    ).toBeUndefined();
  },
);

it
  .skipIf(process.platform === "win32")
  .each([
    "selected alias",
    "selected foreign alias",
    "selected missing alias",
    "discovered matching opt",
    "discovered foreign opt",
    "discovered missing opt",
  ] as const)("keeps JDK registration identity for %s", async (scenario) => {
  const temporaryRoot = await createTestTempDirectory("rea-java-home-");
  const prefix = await realpath(temporaryRoot);
  const suffix = "libexec/openjdk.jdk/Contents/Home";
  const firstKeg = join(prefix, "Cellar", "openjdk@21", "21.0.12");
  const secondKeg = join(prefix, "Cellar", "openjdk@21", "21.0.13");
  const observedHome = join(firstKeg, suffix);
  const optAlias = join(prefix, "opt", "openjdk@21");
  const selectedAlias = join(prefix, "selected-jdk");
  await mkdir(observedHome, { recursive: true });
  await mkdir(join(secondKeg, suffix), { recursive: true });
  await mkdir(join(prefix, "opt"));
  const selected = scenario.startsWith("selected");
  const missing = scenario.includes("missing");
  const foreign = scenario.includes("foreign");
  if (!missing)
    await symlink(
      selected
        ? foreign
          ? join(secondKeg, suffix)
          : observedHome
        : foreign
          ? secondKeg
          : firstKeg,
      selected ? selectedAlias : optAlias,
    );
  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir: INSTALL,
      platform: process.platform,
      architecture: "x64",
      ...(selected ? { javaHome: selectedAlias } : {}),
    },
    host({
      probeJava: () =>
        javaProbeOk({
          ...JAVA,
          home: observedHome,
          osName: process.platform === "darwin" ? "Mac OS X" : "Linux",
        }),
      executable: (path) =>
        path === HEADLESS ||
        path === LINUX_DECOMPILER ||
        path ===
          `${INSTALL}/Ghidra/Features/Decompiler/os/mac_x86_64/decompile`,
    }),
  );
  expect(inspection.status).toBe("available");
  const stable =
    !missing && !foreign && (selected || process.platform === "darwin");
  const expected = stable
    ? selected
      ? selectedAlias
      : join(optAlias, suffix)
    : observedHome;
  expect(inspection.javaHome).toBe(expected);
  expect(
    projectGhidraDoctorInspection(inspection).registrationEnvironment.JAVA_HOME,
  ).toBe(expected);
  expect(
    inspection.checks.find(({ name }) => name === "java")?.detail,
  ).toContain(observedHome);
  if (stable && !selected) {
    await unlink(optAlias);
    await symlink(secondKeg, optAlias);
    await rm(firstKeg, { recursive: true });
    expect(await realpath(expected)).toBe(join(secondKeg, suffix));
  }
});

it.skipIf(process.platform !== "darwin")(
  "uses a same-installation Homebrew opt alias for doctor registration and survives keg rotation",
  async () => {
    const temporaryRoot = await createTestTempDirectory("rea-ghidra-homebrew-");
    const prefix = join(temporaryRoot, "brew\n雪");
    await mkdir(prefix);
    const pathDirectory = join(prefix, "bin");
    const optDirectory = join(prefix, "opt");
    const optAlias = join(optDirectory, "ghidra");
    const firstKeg = join(prefix, "Cellar", "ghidra", "12.1.4");
    const secondKeg = join(prefix, "Cellar", "ghidra", "12.1.5");
    const foreignKeg = join(prefix, "Cellar", "other-ghidra", "12.1.4");

    const createKeg = async (keg: string) => {
      const libexec = join(keg, "libexec");
      await mkdir(join(libexec, "Ghidra"), { recursive: true });
      await mkdir(join(libexec, "support"), { recursive: true });
      await writeFile(
        join(libexec, "Ghidra", "application.properties"),
        `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=${String(SUPPORTED_GHIDRA_JAVA_MAJOR)}\n`,
      );
      await writeFile(join(libexec, "ghidraRun"), "launcher\n");
      await writeFile(
        join(libexec, "support", "analyzeHeadless"),
        "headless\n",
      );
      await chmod(join(libexec, "ghidraRun"), 0o700);
      await chmod(join(libexec, "support", "analyzeHeadless"), 0o700);
      return libexec;
    };

    const firstRoot = await createKeg(firstKeg);
    const secondRoot = await createKeg(secondKeg);
    await createKeg(foreignKeg);
    await mkdir(pathDirectory, { recursive: true });
    await mkdir(optDirectory, { recursive: true });
    await symlink(firstKeg, optAlias);
    await symlink(
      join(optAlias, "libexec", "ghidraRun"),
      join(pathDirectory, "ghidra"),
    );

    const environment = { PATH: pathDirectory };
    const registeredRoot = join(optAlias, "libexec");
    expect(
      discoverGhidraInstallationOnPath(environment, process.platform),
    ).toBe(registeredRoot);
    const inspection = await inspectGhidraInstallation(
      {
        environment,
        resourceOwner: inspectionResources.owner,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        discoverInstallDirOnPath: discoverGhidraInstallationOnPath,
        readText: (path) =>
          path === join(registeredRoot, "Ghidra", "application.properties")
            ? `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=${String(SUPPORTED_GHIDRA_JAVA_MAJOR)}\n`
            : undefined,
        executable: (path) =>
          path === join(registeredRoot, "support", "analyzeHeadless") ||
          path ===
            join(
              registeredRoot,
              "Ghidra",
              "Features",
              "Decompiler",
              "os",
              "mac_arm_64",
              "decompile",
            ),
        probeJava: () =>
          javaProbeOk({ ...JAVA, osArch: "aarch64", osName: "Mac OS X" }),
      }),
    );
    expect(inspection.status).toBe("available");
    expect(inspection.installDir).toBe(registeredRoot);
    expect(
      projectGhidraDoctorInspection(inspection).registrationEnvironment
        .GHIDRA_INSTALL_DIR,
    ).toBe(registeredRoot);

    await unlink(optAlias);
    await symlink(secondKeg, optAlias);
    await rm(firstKeg, { recursive: true });
    expect(
      discoverGhidraInstallationOnPath(environment, process.platform),
    ).toBe(registeredRoot);
    expect(
      discoverGhidraInstallationOnPath(environment, process.platform),
    ).not.toBe(firstRoot);

    await unlink(join(pathDirectory, "ghidra"));
    await symlink(join(secondRoot, "ghidraRun"), join(pathDirectory, "ghidra"));
    await unlink(optAlias);
    expect(
      discoverGhidraInstallationOnPath(environment, process.platform),
    ).toBe(secondRoot);
    await symlink(foreignKeg, optAlias);
    expect(
      discoverGhidraInstallationOnPath(environment, process.platform),
    ).toBe(secondRoot);
  },
);

it("does not fall back to PATH when an explicit Ghidra installation path is malformed", async () => {
  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: { PATH: "/valid-ghidra-bin" },
      installDir: "relative/ghidra",
      platform: "linux",
      architecture: "x64",
    },
    host({ discoverInstallDirOnPath: () => INSTALL }),
  );
  expect(inspection.status).toBe("unavailable");
  expect(inspection.installDir).toBe("relative/ghidra");
  expect(inspection.checks[0]).toMatchObject({
    name: "configuration",
    status: "failed",
    detail: "GHIDRA_INSTALL_DIR must be absolute",
  });
});

it("probes the selected Java environment without reading conflicting ambient settings", async () => {
  vi.stubEnv("REA_GHIDRA_CONTEXT", "ambient");
  vi.stubEnv("REA_GHIDRA_AMBIENT", "ambient-only");
  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: { REA_GHIDRA_CONTEXT: "selected", PATH: "/selected-bin" },
      installDir: INSTALL,
      platform: "linux",
      architecture: "x64",
    },
    host({
      probeJava: (_command, environment) =>
        environment.REA_GHIDRA_CONTEXT === "selected" &&
        environment.REA_GHIDRA_AMBIENT === undefined &&
        environment.PATH === "/selected-bin"
          ? javaProbeOk<GhidraJavaObservation>(JAVA)
          : missingJavaProbe,
    }),
  );
  expect(inspection.status).toBe("available");
});

describe("Ghidra installation inspection", () => {
  it("clears inherited JVM option injection before probing Java", () => {
    expect(
      ghidraJavaEnvironment(
        "/opt/jdk-21",
        {
          PATH: "/usr/bin",
          _JAVA_OPTIONS: "-Xmx99G",
          JAVA_TOOL_OPTIONS: "-javaagent:/tmp/agent.jar",
          JDK_JAVA_OPTIONS: "-XX:MaxRAMPercentage=99",
          GHIDRA_JAVA_OPTIONS: "-Duser.home=/tmp/unapproved",
        },
        "linux",
      ),
    ).toMatchObject({
      PATH: "/opt/jdk-21/bin:/usr/bin",
      JAVA_HOME: "/opt/jdk-21",
      _JAVA_OPTIONS: "",
      JAVA_TOOL_OPTIONS: "",
      JDK_JAVA_OPTIONS: "",
      GHIDRA_JAVA_OPTIONS: "",
    });
  });

  it("accepts the verified Linux x64 Ghidra release and JDK", async () => {
    expect(
      await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host(),
      ),
    ).toMatchObject({
      status: "available",
      providerVersion: SUPPORTED_GHIDRA_VERSION,
      analyzeHeadlessPath: HEADLESS,
      javaVersion: "21.0.11",
    });
  });

  it.each([
    ["12.1.2", "27", 27],
    ["12.1.2-2.1", "27", 27],
    ["12.1.0", "21.0.2", 21],
    [SUPPORTED_GHIDRA_VERSION, "25.0.1", 25],
  ])(
    "accepts Ghidra %s with JDK %s on the verified release line",
    async (providerVersion, javaVersion, major) => {
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({
          readText: () =>
            `application.version=${providerVersion}\napplication.java.min=21\napplication.java.max=\n`,
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({
              ...JAVA,
              version: javaVersion,
              major,
            }),
        }),
      );
      expect(result.status).toBe("available");
      expect(result).toMatchObject({ providerVersion, javaVersion });
      expect(
        result.checks.find(({ name }) => name === "version"),
      ).toMatchObject({
        status: "passed",
        detail:
          providerVersion === SUPPORTED_GHIDRA_VERSION
            ? SUPPORTED_GHIDRA_VERSION
            : expect.stringContaining("verified build"),
      });
    },
  );

  it.each([
    ["darwin", "x64", "mac_x86_64"],
    ["darwin", "arm64", "mac_arm_64"],
    ["linux", "arm64", "linux_arm_64"],
  ] as const)(
    "accepts %s/%s with the matching distribution or locally built native tool",
    async (platform, architecture, nativeDirectory) => {
      for (const location of ["os", "build/os"]) {
        const decompiler = `${INSTALL}/Ghidra/Features/Decompiler/${location}/${nativeDirectory}/decompile`;
        expect(
          await inspectGhidraInstallation(
            {
              resourceOwner: inspectionResources.owner,
              environment: {},
              installDir: INSTALL,
              platform,
              architecture,
            },
            host({
              executable: (path) => path === HEADLESS || path === decompiler,
              probeJava: () =>
                javaProbeOk<GhidraJavaObservation>({
                  ...JAVA,
                  osArch: architecture === "arm64" ? "aarch64" : "amd64",
                  osName: platform === "darwin" ? "Mac OS X" : "Linux",
                }),
            }),
          ),
        ).toMatchObject({
          status: "available",
          platform,
          architecture,
          nativeDecompilerPath: decompiler,
        });
      }
    },
  );
});

describe("Ghidra Windows installation commitment", () => {
  it("accepts the exact Windows x64 batch launcher and JDK commitment", async () => {
    const windowsHost: GhidraInstallationHost = {
      platform: "win32",
      architecture: "x64",
      readText: (path) =>
        path === WINDOWS_PROPERTIES
          ? `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=21\n`
          : undefined,
      executable: (path) =>
        path === WINDOWS_HEADLESS || path === WINDOWS_DECOMPILER,
      probeJava: (command, environment) => {
        expect(command).toBe("C:\\Java\\jdk-21\\bin\\java.exe");
        expect(environment.PATH).toMatch(/^C:\\Java\\jdk-21\\bin;/u);
        return javaProbeOk<GhidraJavaObservation>({
          ...JAVA,
          home: "C:\\Java\\jdk-21",
          osName: "Windows 11",
        });
      },
    };

    expect(
      await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: WINDOWS_INSTALL,
          javaHome: "C:\\Java\\jdk-21",
          platform: "win32",
          architecture: "x64",
        },
        windowsHost,
      ),
    ).toMatchObject({
      status: "available",
      platform: "win32",
      architecture: "x64",
      analyzeHeadlessPath: WINDOWS_HEADLESS,
      javaCommand: "C:\\Java\\jdk-21\\bin\\java.exe",
      providerVersion: SUPPORTED_GHIDRA_VERSION,
    });
  });
});

describe("Ghidra installation rejection diagnostics", () => {
  it.each([
    {
      name: "missing configuration",
      options: { platform: "linux" as const, architecture: "x64" as const },
      override: {},
      failed: "configuration",
      code: "not_configured",
    },
    {
      name: "unsupported platform",
      options: {
        installDir: INSTALL,
        platform: "aix" as const,
        architecture: "x64" as const,
      },
      override: {},
      failed: "platform",
      code: "unsupported_host",
    },
    {
      name: "unsupported architecture",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "arm" as const,
      },
      override: {},
      failed: "architecture",
      code: "unsupported_host",
    },
    {
      name: "bad installation root",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: { readText: () => undefined },
      failed: "installation",
      code: "executable_missing",
    },
    {
      name: "wrong Ghidra version",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: {
        readText: () => "application.version=11.4\napplication.java.min=21\n",
      },
      failed: "version",
      code: "unsupported_version",
    },
    {
      name: "missing analyzeHeadless",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: { executable: () => false },
      failed: "headless",
      code: "executable_missing",
    },
    {
      name: "only a foreign-architecture decompiler on Linux arm64",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "arm64" as const,
      },
      override: {},
      failed: "native_decompiler",
      code: "executable_missing",
    },
    {
      name: "missing Java",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: { probeJava: () => missingJavaProbe },
      failed: "java",
      code: "runtime_missing",
    },
    {
      name: "wrong Java",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: {
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            major: 17,
            version: "17",
          }),
      },
      failed: "java",
      code: "unsupported_version",
    },
    {
      name: "JRE instead of JDK",
      options: {
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      override: {
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            runtime: "jre" as const,
          }),
      },
      failed: "java",
      code: "unsupported_version",
    },
  ])("distinguishes $name", async ({ options, override, failed, code }) => {
    const result = await inspectGhidraInstallation(
      { resourceOwner: inspectionResources.owner, ...options, environment: {} },
      host(override),
    );
    expect(result.status).toBe("unavailable");
    expect(
      result.checks.find(({ status }) => status === "failed"),
    ).toMatchObject({
      name: failed,
      code,
    });
  });
});

describe("Ghidra configuration directory identity", () => {
  it.each([
    [
      "application.version=12.1.4\napplication.release.name=PUBLIC\n",
      "ghidra_12.1.4_PUBLIC",
    ],
    [
      "application.version=12.1.2-2.1\napplication.release.name=DEV\n",
      "ghidra_12.1.2-2.1_DEV",
    ],
    [
      "application.version=12.1.4\napplication.release.name=pub\\\n lic\n",
      "ghidra_12.1.4_PUBLIC",
    ],
    ["application.version=12.1.4\n", null],
    ["application.release.name=PUBLIC\n", null],
    ["application.version=12.1.4\napplication.release.name=\n", null],
    ["application.version=12.1.4\napplication.release.name=../outside\n", null],
    [
      "application.version=12.1.4\napplication.release.name=..\\\\outside\n",
      null,
    ],
    ["application.version=../12.1.4\napplication.release.name=PUBLIC\n", null],
    [
      "application.version=12.1.4+build\napplication.release.name=PUBLIC\n",
      null,
    ],
    ["application.version=12.1.4\napplication.release.name=\\uNOTHEX\n", null],
  ])("derives a safe release coordinate from %j", (content, expected) => {
    expect(ghidraApplicationProperties(content)).toMatchObject({
      configurationDirectoryName: expected,
    });
  });

  it.each([
    ["12.1.0", "ghidra_12.1_PUBLIC"],
    ["012.01.000", "ghidra_12.1_PUBLIC"],
    ["12.1.0-BETA", "ghidra_12.1-BETA_PUBLIC"],
    ["12.1.0-", "ghidra_12.1_PUBLIC"],
  ])(
    "uses Ghidra's canonical configuration version while retaining %s",
    (raw, expected) => {
      expect(
        ghidraApplicationProperties(
          `application.version=${raw}\napplication.release.name=PUBLIC\n`,
        ),
      ).toMatchObject({
        providerVersion: raw,
        configurationDirectoryName: expected,
      });
    },
  );

  it.each([
    [
      "application.version=12.1.4\napplication.release.name=PUBLIC\napplication.java.min=21\n",
      "ghidra_12.1.4_PUBLIC",
    ],
    ["application.version=12.1.4\napplication.java.min=21\n", null],
  ])(
    "preserves the inspected identity independently of the installation basename",
    async (content, expected) => {
      const inspection = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({ readText: () => content }),
      );
      expect(inspection).toMatchObject({
        status: "available",
        configurationDirectoryName: expected,
      });
    },
  );
});

describe("Ghidra release line and JDK bounds", () => {
  it("uses Java Properties last-key, delimiter, escape, and continuation rules", () => {
    const properties = ghidraApplicationProperties(
      [
        "application.version=11.4",
        "# comment ending with a slash " + "\\",
        "application.\\u0076ersion : 12.\\",
        "  1.\\u0034",
        "! another comment " + "\\",
        "application.java.\\u006din\t21",
        "application.java.max=",
      ].join("\n"),
    );
    expect(properties).toEqual({
      providerVersion: "12.1.4",
      configurationDirectoryName: null,
      javaMinimum: { status: "major", major: 21 },
      javaMaximum: { status: "absent" },
      parseError: null,
    });
    expect(
      ghidraApplicationProperties("application.version=12.1.4").javaMinimum,
    ).toEqual({
      status: "absent",
    });
    expect(
      ghidraApplicationProperties(
        "application.version=12.1.4\napplication.java.min=\n",
      ).javaMinimum,
    ).toEqual({ status: "unresolved", raw: "" });
    expect(
      ghidraApplicationProperties("application.version=12.1.4\\")
        .providerVersion,
    ).toBe("12.1.4");
    expect(
      ghidraApplicationProperties("application.version=12.\\\n #.1")
        .providerVersion,
    ).toBe("12.#.1");
    expect(
      ghidraApplicationProperties(
        "application.version=12.\\\n\napplication.version=12.1.4",
      ).providerVersion,
    ).toBe("12.1.4");
  });

  it("matches Ghidra integer Java bounds and zero maximum semantics", () => {
    const properties = ghidraApplicationProperties(
      "application.java.min=21.0\napplication.java.max=0\n",
    );
    expect(properties.javaMinimum).toEqual({
      status: "unresolved",
      raw: "21.0",
    });
    expect(properties.javaMaximum).toEqual({ status: "absent" });
    expect(
      ghidraApplicationProperties("application.java.max=+0").javaMaximum,
    ).toEqual({
      status: "absent",
    });
    expect(
      ghidraApplicationProperties("application.java.max=+０").javaMaximum,
    ).toEqual({ status: "absent" });
    expect(
      ghidraApplicationProperties("application.java.min=+21").javaMinimum,
    ).toEqual({
      status: "major",
      major: 21,
    });
    expect(
      ghidraApplicationProperties("application.java.min=٢١").javaMinimum,
    ).toEqual({
      status: "major",
      major: 21,
    });
    expect(
      ghidraApplicationProperties("application.java.min=２１").javaMinimum,
    ).toEqual({
      status: "major",
      major: 21,
    });
    expect(
      ghidraApplicationProperties("application.java.max=＋０").javaMaximum,
    ).toEqual({
      status: "unresolved",
      raw: "＋０",
    });
    expect(
      ghidraApplicationProperties("application.java.min=②").javaMinimum,
    ).toEqual({
      status: "unresolved",
      raw: "②",
    });
    expect(
      ghidraApplicationProperties("application.java.min=2147483648")
        .javaMinimum,
    ).toEqual({ status: "unresolved", raw: "2147483648" });
  });

  it("keeps an unavailable properties file unresolved for Java admission", () => {
    expect(ghidraJavaRequirement(undefined).unresolved).toBe(
      "application.properties is unavailable",
    );
  });

  it("preserves property value trailing whitespace instead of normalizing it", () => {
    const properties = ghidraApplicationProperties(
      "application.version=12.1.4 \napplication.java.min=21 \n",
    );
    expect(properties.providerVersion).toBe("12.1.4 ");
    expect(properties.javaMinimum).toEqual({
      status: "unresolved",
      raw: "21 ",
    });
    expect(properties.parseError).toBeNull();
  });
});

describe("Ghidra malformed property admission", () => {
  it("fails installation and doctor admission closed on malformed Unicode escapes", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "linux",
        architecture: "x64",
      },
      host({
        readText: () =>
          "application.version=12.1.4\nbroken=\\u12G4\napplication.java.min=17\n",
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(result.providerVersion).toBeNull();
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "version",
          status: "failed",
          code: "version_unresolved",
          detail: expect.stringContaining("malformed_unicode_escape"),
        }),
        expect.objectContaining({
          name: "java",
          status: "failed",
          code: "version_unresolved",
          remediation: expect.stringContaining(
            "application.properties parse failed",
          ),
        }),
      ]),
    );
    expect(projectGhidraDoctorInspection(result)).toMatchObject({
      available: false,
      registrationEnvironment: {},
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "version", ok: false }),
        expect.objectContaining({ name: "java", ok: false }),
      ]),
    });
  });
});

describe("Ghidra installation version admission", () => {
  it.each([
    {
      name: "JDK above the installation maximum",
      readText: () =>
        "application.version=12.1.4\napplication.java.min=21\napplication.java.max=25\n",
      probeJava: () =>
        javaProbeOk<GhidraJavaObservation>({
          ...JAVA,
          major: 27,
          version: "27",
        }),
      failed: "java",
      code: "unsupported_version",
    },
    {
      name: "unreadable Java minimum",
      readText: () =>
        "application.version=12.1.4\napplication.java.min=latest\n",
      probeJava: () => javaProbeOk<GhidraJavaObservation>(JAVA),
      failed: "java",
      code: "version_unresolved",
    },
    {
      name: "missing Java minimum",
      readText: () => "application.version=12.1.4\n",
      probeJava: () => javaProbeOk<GhidraJavaObservation>(JAVA),
      failed: "java",
      code: "version_unresolved",
    },
    {
      name: "unparseable Ghidra version",
      readText: () => "application.version=latest\napplication.java.min=21\n",
      probeJava: () => javaProbeOk<GhidraJavaObservation>(JAVA),
      failed: "version",
      code: "version_unresolved",
    },
    {
      name: "different Ghidra line",
      readText: () => "application.version=13.0.0\napplication.java.min=21\n",
      probeJava: () => javaProbeOk<GhidraJavaObservation>(JAVA),
      failed: "version",
      code: "unsupported_version",
    },
  ])("distinguishes $name", async ({ readText, probeJava, failed, code }) => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "linux",
        architecture: "x64",
      },
      host({ readText, probeJava }),
    );
    expect(result.status).toBe("unavailable");
    expect(
      result.checks.find(({ status }) => status === "failed"),
    ).toMatchObject({ name: failed, code });
  });

  it("names the accepted Ghidra line and JDK range in failure remediation", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        javaHome: "/usr/lib/jvm/java-17-openjdk",
        platform: "linux",
        architecture: "x64",
      },
      host({
        readText: () =>
          "application.version=12.0.4\napplication.java.min=21\napplication.java.max=\n",
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            major: 17,
            version: "17.0.20.1",
          }),
      }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.rejection.reason).toContain("12.x (>=12.1)");
    expect(result.rejection.reason).toContain(SUPPORTED_GHIDRA_VERSION);
    expect(result.checks.find(({ name }) => name === "java")).toMatchObject({
      status: "failed",
      remediation: expect.stringContaining("JDK 21 or newer"),
    });
  });

  it("accepts a lower Java minimum declared by the installation", async () => {
    expect(
      await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({
          readText: () =>
            `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=17\n`,
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({
              ...JAVA,
              major: 17,
              version: "17.0.20.1",
            }),
        }),
      ),
    ).toMatchObject({ status: "available", javaVersion: "17.0.20.1" });
  });

  it.each([21, 25])(
    "admits Ghidra 12.2 independently of its declared Java 25 minimum (JDK %s)",
    async (major) => {
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({
          readText: () => "application.version=12.2\napplication.java.min=25\n",
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({
              ...JAVA,
              major,
              version: `${String(major)}.0.5`,
              home: `/usr/lib/jvm/jdk-${String(major)}`,
            }),
        }),
      );
      expect(result.providerVersion).toBe("12.2");
      expect(
        result.checks.find(({ name }) => name === "version"),
      ).toMatchObject({
        status: "passed",
      });
      expect(result.checks.find(({ name }) => name === "java")).toMatchObject({
        status: major === 25 ? "passed" : "failed",
      });
      expect(result.status).toBe(major === 25 ? "available" : "unavailable");
    },
  );
});

describe("Ghidra configuration paths", () => {
  it.each([
    [{ installDir: "./ghidra" }, "GHIDRA_INSTALL_DIR must be absolute"],
    [{ installDir: INSTALL, javaHome: "./jdk" }, "JAVA_HOME must be absolute"],
    [
      { installDir: "ghidra", javaHome: "jdk" },
      "GHIDRA_INSTALL_DIR and JAVA_HOME must be absolute",
    ],
  ])(
    "rejects relative paths that REA's configuration parser rejects (%o)",
    async (paths, detail) => {
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          ...paths,
          platform: "linux",
          architecture: "x64",
        },
        host(),
      );
      expect(result).toMatchObject({
        status: "unavailable",
        rejection: {
          code: "not_configured",
          reason: expect.stringContaining("reject relative paths"),
        },
      });
      expect(result.checks).toContainEqual(
        expect.objectContaining({ name: "configuration", detail }),
      );
      // Setup registers only an available inspection's environment.
      expect(projectGhidraDoctorInspection(result)).toMatchObject({
        available: false,
        registrationEnvironment: {},
      });
    },
  );

  it.each([
    ["linux", "./jdk"],
    ["linux", ""],
    ["win32", "jdk"],
  ] as const)(
    "does not run Java from a relative JAVA_HOME (%s %o)",
    async (platform, javaHome) => {
      const probed: string[] = [];
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: platform === "win32" ? WINDOWS_INSTALL : INSTALL,
          javaHome,
          platform,
          architecture: "x64",
        },
        host({
          probeJava: (command) => {
            probed.push(command);
            return javaProbeOk<GhidraJavaObservation>(JAVA);
          },
        }),
      );
      expect(probed).toEqual([]);
      expect(result).toMatchObject({
        status: "unavailable",
        rejection: { code: "not_configured" },
      });
    },
  );

  it.each([
    ["linux", undefined],
    ["linux", "/opt/jdk-21"],
    ["darwin", undefined],
    ["win32", "C:\\Java\\jdk-21"],
  ] as const)(
    "does not run Java without a Ghidra installation (%s %o)",
    async (platform, javaHome) => {
      const probed: string[] = [];
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: { PATH: "/usr/bin" },
          ...(javaHome === undefined ? {} : { javaHome }),
          platform,
          architecture: "x64",
        },
        host({
          discoverInstallDirOnPath: () => undefined,
          probeJava: (command) => {
            probed.push(command);
            return javaProbeOk<GhidraJavaObservation>(JAVA);
          },
        }),
      );
      expect(probed).toEqual([]);
      expect(result).toMatchObject({
        status: "unavailable",
        installDir: null,
        javaVersion: null,
        rejection: { code: "not_configured" },
      });
      expect(projectGhidraDoctorInspection(result)).toMatchObject({
        available: false,
        registrationEnvironment: {},
        checks: [
          expect.objectContaining({
            name: "configuration",
            code: "not_configured",
          }),
        ],
      });
    },
  );

  it("judges absolute paths by the inspected platform", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: "C:\\ghidra",
        platform: "win32",
        architecture: "x64",
      },
      host(),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "configuration", status: "passed" }),
    );
  });
});

describe("Ghidra FAT native decompiler admission", () => {
  it.each([
    {
      name: "foreign-only FAT",
      bytes: fat([0x01000007]),
      status: "unavailable",
      detail: "requires mach-o arm64",
    },
    {
      name: "foreign-only FAT whose first slice is undersized",
      bytes: (() => {
        const bytes = fat([0x01000007, 0x0000000c]);
        bytes.writeUInt32BE(31, 8 + 12);
        return bytes;
      })(),
      status: "unavailable",
      detail: "requires mach-o arm64",
    },
    {
      name: "foreign-only FAT declaring one family twice",
      bytes: fat([0x01000007, 0x01000007]),
      status: "unavailable",
      detail: "requires mach-o arm64",
    },
    {
      name: "foreign-only FAT whose first same-family slice is undersized",
      bytes: (() => {
        const bytes = fat([0x01000007, 0x01000007]);
        bytes.writeUInt32BE(31, 8 + 12);
        return bytes;
      })(),
      status: "unavailable",
      detail: "requires mach-o arm64",
    },
    {
      name: "matching universal FAT",
      bytes: fat([0x01000007, 0x0100000c]),
      status: "available",
      detail: "matches darwin/arm64",
    },
    {
      name: "truncated FAT table",
      bytes: fat([0x01000007], 2),
      status: "available",
      detail: "could not be established",
    },
  ])("distinguishes $name", async ({ bytes, status, detail }) => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Mac OS X",
          }),
        executableHeader: () => headerProbe(bytes),
      }),
    );
    expect(result.status).toBe(status);
    expect(
      result.checks.find(({ name }) => name === "native_decompiler")?.detail,
    ).toContain(detail);
  });

  it("keeps a truncated host slice unknown despite a readable foreign slice", async () => {
    const bytes = fat([0x01000007, 0x0100000c]);
    bytes.writeUInt32BE(bytes.length + 1, 8 + 20 + 12);
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Mac OS X",
          }),
        executableHeader: () => headerProbe(bytes),
      }),
    );
    expect(result.status).toBe("available");
    expect(
      result.checks.find(({ name }) => name === "native_decompiler")?.detail,
    ).toContain("could not be established");
  });
});

describe("Ghidra native decompiler admission", () => {
  it.each([
    {
      name: "a MIPS decompiler at the Linux x64 path",
      options: {
        environment: {},
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      executableHeader: (path: string) =>
        path === LINUX_DECOMPILER
          ? headerProbe(elf(1, 1, 8))
          : javaProbeOk(undefined),
    },
    {
      name: "a Linux x86-64 decompiler at the macOS arm64 path",
      options: {
        environment: {},
        installDir: INSTALL,
        platform: "darwin" as const,
        architecture: "arm64" as const,
      },
      executableHeader: (path: string) =>
        path === MAC_DECOMPILER
          ? headerProbe(elf(2, 1, 62))
          : javaProbeOk(undefined),
    },
    {
      name: "a macOS arm64 decompiler at the Linux x64 path",
      options: {
        environment: {},
        installDir: INSTALL,
        platform: "linux" as const,
        architecture: "x64" as const,
      },
      executableHeader: (path: string) =>
        path === LINUX_DECOMPILER
          ? headerProbe(thinMach(0xcffaedfe, 0x0100000c))
          : javaProbeOk(undefined),
    },
  ])("distinguishes $name", async ({ options, executableHeader }) => {
    const result = await inspectGhidraInstallation(
      { ...options, resourceOwner: inspectionResources.owner },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: options.architecture === "arm64" ? "aarch64" : "amd64",
            osName: options.platform === "darwin" ? "Mac OS X" : "Linux",
          }),
        executableHeader,
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(
      result.checks.find(({ status }) => status === "failed"),
    ).toMatchObject({ name: "native_decompiler", code: "executable_missing" });
  });

  it("explains an accepted decompiler by its header, not only its path", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "linux",
        architecture: "x64",
      },
      host({
        executableHeader: (path: string) =>
          path === LINUX_DECOMPILER
            ? headerProbe(elf(2, 1, 62))
            : javaProbeOk(undefined),
      }),
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "passed",
      detail: `${LINUX_DECOMPILER} reports elf x86_64, which matches linux/x64`,
    });
  });
});

describe("Ghidra native decompiler compatibility", () => {
  it("keeps an unreadable header unknown instead of failing the install", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "linux",
        architecture: "x64",
      },
      host({ executableHeader: () => javaProbeOk(undefined) }),
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "passed",
      detail: expect.stringContaining("could not be established"),
    });
  });

  it("accepts a one-slice universal-format Darwin native decompiler", async () => {
    const bytes = fat([0x0100000c]);
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Mac OS X",
          }),
        executableHeader: (path: string) =>
          path === MAC_DECOMPILER ? headerProbe(bytes) : javaProbeOk(undefined),
      }),
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "passed",
      detail: `${MAC_DECOMPILER} reports mach-o-universal arm64, which matches darwin/arm64`,
    });
  });

  it("names the observed and the required executable in the failure", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Mac OS X",
          }),
        executableHeader: (path: string) =>
          path === MAC_DECOMPILER
            ? headerProbe(elf(2, 1, 62))
            : javaProbeOk(undefined),
      }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "failed",
      detail: expect.stringMatching(
        /reports elf x86_64, but darwin\/arm64 requires mach-o arm64/u,
      ),
      remediation: expect.stringContaining("os/mac_arm_64/decompile"),
    });
  });
});

describe("Ghidra JVM native directory admission", () => {
  it("rejects a JDK whose os.arch selects a different native decompiler directory", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "x86_64",
            osName: "Mac OS X",
          }),
      }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "failed",
      code: "executable_missing",
      detail: expect.stringContaining(
        "JVM reports os.arch=x86_64, so Ghidra selects its native decompiler from os/mac_x86_64",
      ),
      remediation: expect.stringContaining("JAVA_HOME"),
    });
  });

  it("accepts a JDK whose os.arch selects the validated native decompiler directory", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Mac OS X",
          }),
      }),
    );
    expect(result.status).toBe("available");
  });

  it("rejects a successful Java probe that omits os.arch", async () => {
    const { osArch: _observedArchitecture, ...withoutArchitecture } = JAVA;
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>(withoutArchitecture),
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("did not report os.arch"),
    });
    expect(projectGhidraDoctorInspection(result).available).toBe(false);
  });

  it.each(["riscv64", "sparcv9", ""])(
    "refuses an unrecognized JVM os.arch (%s) instead of assuming alignment",
    async (osArch) => {
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "darwin",
          architecture: "arm64",
        },
        host({
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({ ...JAVA, osArch }),
        }),
      );
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") return;
      expect(
        result.checks.find(({ name }) => name === "native_decompiler"),
      ).toMatchObject({
        status: "failed",
        detail: expect.stringContaining("unrecognized os.arch="),
      });
    },
  );

  it("rejects a JDK whose os.name selects a different host OS", async () => {
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
      },
      host({
        probeJava: () =>
          javaProbeOk<GhidraJavaObservation>({
            ...JAVA,
            osArch: "aarch64",
            osName: "Windows 11",
          }),
      }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "failed",
      code: "executable_missing",
      detail: expect.stringContaining("JVM reports os.name=Windows 11"),
      remediation: expect.stringContaining("JAVA_HOME"),
    });
  });
});

describe("Ghidra JVM OS admission", () => {
  it("rejects a successful Java probe that omits os.name", async () => {
    const { osName: _observedOsName, ...withoutOsName } = JAVA;
    const result = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        platform: "linux",
        architecture: "x64",
      },
      host({
        probeJava: () => javaProbeOk<GhidraJavaObservation>(withoutOsName),
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(
      result.checks.find(({ name }) => name === "native_decompiler"),
    ).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("did not report os.name"),
    });
    expect(projectGhidraDoctorInspection(result).available).toBe(false);
  });

  it.each(["SunOS", "FreeBSD", ""])(
    "refuses an unrecognized JVM os.name (%s) instead of assuming alignment",
    async (osName) => {
      const result = await inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({
          probeJava: () =>
            javaProbeOk<GhidraJavaObservation>({ ...JAVA, osName }),
        }),
      );
      expect(result.status).toBe("unavailable");
      if (result.status !== "unavailable") return;
      expect(
        result.checks.find(({ name }) => name === "native_decompiler"),
      ).toMatchObject({
        status: "failed",
        detail: expect.stringContaining("os.name="),
      });
    },
  );
});

describe("Ghidra Java probe os.arch extraction", () => {
  it("extracts os.arch through the real Java probe into the installation diagnostics", async () => {
    const stderr = [
      "Property settings:",
      "    java.home = /usr/lib/jvm/jdk-21",
      "    java.version = 21.0.11",
      "    java.vm.name = OpenJDK 64-Bit Server VM",
      "    os.arch = x86_64",
      "    os.name = Linux",
      "    sun.arch.data.model = 64",
      "",
    ].join("\n");
    const inspection = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir: INSTALL,
        javaHome: "/usr/lib/jvm/jdk-21",
        platform: "linux",
        architecture: "x64",
      },
      host({
        probeJava: (command) =>
          parseGhidraJavaOutput(command, {
            exitCode: 0,
            signal: null,
            stdout: { text: "", bytes: 0, observedBytes: 0 },
            stderr: {
              text: stderr,
              bytes: Buffer.byteLength(stderr),
              observedBytes: Buffer.byteLength(stderr),
            },
          }),
      }),
    );
    expect(ghidraInstallationDiagnostics(inspection)).toMatchObject({
      java_os_arch: "x86_64",
      java_os_name: "Linux",
    });
  });
});

it("explains the macOS keg-only JDK case without probing an unselected installation", async () => {
  const probed: string[] = [];
  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir: INSTALL,
      platform: "darwin",
      architecture: "arm64",
    },
    host({
      probeJava: (command) => {
        probed.push(command);
        return missingJavaProbe;
      },
    }),
  );
  expect(probed).toEqual(["/usr/bin/java"]);
  expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject({
    status: "failed",
    code: "runtime_missing",
    remediation: expect.stringContaining("Homebrew OpenJDK can be keg-only"),
  });
  const java = inspection.checks.find(({ name }) => name === "java");
  expect(java?.status === "failed" ? java.remediation : "").toContain(
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
  );
});

it.each([
  ["arm64", "/opt/homebrew"],
  ["x64", "/usr/local"],
] as const)(
  "discovers keg-only Java for macOS %s",
  async (architecture, prefix) => {
    const probed: string[] = [];
    const checked: string[] = [];
    const inspection = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: { PATH: ":relative-bin:/empty-bin" },
        installDir: INSTALL,
        platform: "darwin",
        architecture,
      },
      host({
        executable: (candidate) => {
          checked.push(candidate);
          return (
            candidate.includes("/opt/openjdk/") || host().executable(candidate)
          );
        },
        probeJava: (command) => {
          probed.push(command);
          return javaProbeOk({
            ...JAVA,
            home: `${prefix}/opt/openjdk/libexec/openjdk.jdk/Contents/Home`,
            osArch: architecture === "arm64" ? "aarch64" : "x86_64",
            osName: "Mac OS X",
          });
        },
      }),
    );
    expect(probed).toEqual([
      `${prefix}/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java`,
    ]);
    expect(checked).not.toContain("java");
    expect(checked).not.toContain("relative-bin/java");
    expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject(
      {
        status: "passed",
      },
    );
  },
);

it.each([
  "PATH succeeds",
  "keg succeeds",
  "both fail",
  "explicit home",
] as const)(
  "discovers a keg-only JDK after a failed PATH launcher: %s",
  async (scenario) => {
    const commands: string[] = [];
    const keg =
      "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java";
    const selectedHome =
      scenario === "explicit home" ? "/selected-jdk" : undefined;
    const inspection = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: { PATH: "/usr/bin" },
        installDir: INSTALL,
        platform: "darwin",
        architecture: "arm64",
        ...(selectedHome === undefined ? {} : { javaHome: selectedHome }),
      },
      host({
        executable: (candidate) =>
          candidate === "/usr/bin/java" ||
          candidate === keg ||
          host().executable(candidate),
        probeJava: (command) => {
          commands.push(command);
          return scenario === "PATH succeeds" ||
            (scenario === "keg succeeds" && command === keg)
            ? javaProbeOk({ ...JAVA, osArch: "aarch64", osName: "Mac OS X" })
            : missingJavaProbe;
        },
      }),
    );
    expect(commands).toEqual(
      scenario === "explicit home"
        ? ["/selected-jdk/bin/java"]
        : scenario === "PATH succeeds"
          ? ["/usr/bin/java"]
          : ["/usr/bin/java", keg],
    );
    expect(inspection.status).toBe(
      scenario === "PATH succeeds" || scenario === "keg succeeds"
        ? "available"
        : "unavailable",
    );
    if (scenario === "keg succeeds" || scenario === "both fail") {
      expect(ghidraInstallationDiagnostics(inspection)).toMatchObject({
        java_discovery_failures: expect.arrayContaining([
          {
            command: "/usr/bin/java",
            code: "runtime_missing",
            detail: expect.any(String),
          },
        ]),
      });
    }
    if (scenario === "both fail")
      expect(inspection.javaCommand).toBe("/usr/bin/java");
  },
);

it.each([
  ["darwin", undefined, "/selected-bin/java", "/selected-bin/java"],
  ["darwin", undefined, "/linked/../jdk/java", "/linked/../jdk/java"],
  ["darwin", "/selected-jdk", undefined, "/selected-jdk/bin/java"],
  ["linux", undefined, undefined, "java"],
  ["win32", undefined, undefined, "java.exe"],
] as const)(
  "preserves selected Java on %s with JAVA_HOME %s",
  async (platform, javaHome, pathJava, expected) => {
    const checked: string[] = [];
    const probed: string[] = [];
    const inspection = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {
          PATH: `:relative-bin:${pathJava === undefined ? "/selected-bin" : pathJava.slice(0, -"/java".length)}`,
        },
        installDir: INSTALL,
        platform,
        architecture: "arm64",
        ...(javaHome === undefined ? {} : { javaHome }),
      },
      host({
        readText: () =>
          `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=21\n`,
        executable: (candidate) => {
          checked.push(candidate);
          return candidate === pathJava || host().executable(candidate);
        },
        probeJava: (command) => {
          probed.push(command);
          // A running JVM remains selected even when outside Ghidra's bounds.
          // An absent PATH runtime instead permits macOS fallback discovery.
          return javaProbeOk({
            ...JAVA,
            home: "/selected-jdk",
            major: 17,
            version: "17.0.20.1",
          });
        },
      }),
    );
    expect(probed).toEqual([expected]);
    expect(inspection).toMatchObject({
      status: "unavailable",
      javaCommand: expected,
      javaVersion: "17.0.20.1",
    });
    expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject(
      {
        status: "failed",
        code: "unsupported_version",
      },
    );
    expect(
      checked.some((candidate) => candidate.includes("/opt/openjdk/")),
    ).toBe(false);
  },
);

it("retains a failed header observation as unknown in installation and doctor diagnostics", async () => {
  const failure = new ProviderAdapterError("ghidra", "ghidra:installation", {
    userMessage: "controlled header read failure",
    diagnostics: {
      path: LINUX_DECOMPILER,
      stage: "native_decompiler_header",
      system_code: "EIO",
    },
  });
  const result = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir: INSTALL,
      platform: "linux",
      architecture: "x64",
    },
    host({ executableHeader: () => err(failure) }),
  );
  expect(result.status).toBe("available");
  expect(result.nativeDecompilerHeaderFailure).toBe(failure);
  expect(ghidraInstallationDiagnostics(result)).toMatchObject({
    native_decompiler_header_failure: {
      details: {
        operation: "ghidra:installation",
        diagnostics: { system_code: "EIO" },
      },
    },
  });
  expect(
    projectGhidraDoctorInspection(result).checks.find(
      ({ name }) => name === "native_decompiler",
    ),
  ).toMatchObject({
    ok: true,
    detail: expect.stringContaining("header is unknown"),
    details: {
      header_failure: { details: { diagnostics: { system_code: "EIO" } } },
    },
  });
});

it.each(["cancelled", "cleanup"] as const)(
  "propagates header %s instead of treating it as optional unknown compatibility",
  async (kind) => {
    const reason = { request: "header interrupted" };
    const failure =
      kind === "cancelled"
        ? new AnalysisCancelledError("ghidra:installation", { cause: reason })
        : new ProviderAdapterError("ghidra", "ghidra:installation", {
            cleanup: {
              resources: [LINUX_DECOMPILER],
              reason: "controlled close refusal",
            },
          });
    await expect(
      inspectGhidraInstallation(
        {
          resourceOwner: inspectionResources.owner,
          environment: {},
          installDir: INSTALL,
          platform: "linux",
          architecture: "x64",
        },
        host({ executableHeader: () => err(failure) }),
      ),
    ).rejects.toBe(failure);
  },
);
