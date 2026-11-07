import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it as test, onTestFinished } from "vitest";

import { inspectJadxProvider as inspectProvider } from "../../../src/android/JadxDoctor.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeJadxJarInventory } from "../../fixtures/android/jadxJar.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";

const inspectionOwner = () => {
  const resources = createInspectionResources();
  onTestFinished(() => resources.close());
  return resources.owner;
};
const inspectJadxProvider = (
  environment: Parameters<typeof inspectProvider>[0],
) => inspectProvider(environment, inspectionOwner());

const it = test.skipIf(process.platform === "win32");

it("publishes REA_JADX_MCP_JAR as registration environment when the configured JAR validates", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection).toMatchObject({
    id: "jadx",
    configured: true,
    available: true,
    providerVersion: null,
    registrationEnvironment: { REA_JADX_MCP_JAR: await realpath(jar) },
    checks: [
      {
        name: "configuration",
        ok: true,
        code: null,
        classification: "config_drift",
        details: { operation_timeout_ms: 120_000 },
      },
    ],
  });
});

it("publishes JAVA_HOME alongside the JAR when the configured JAR validates", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-javahome-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection.registrationEnvironment).toEqual({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });
});

it("preserves the caller-selected JAR path when it is a symlink", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-symlink-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const link = join(root, "current.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);
  await symlink(jar, link);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: link,
    JAVA_HOME: javaHome,
  });

  expect(inspection.available).toBe(true);
  expect(inspection.registrationEnvironment["REA_JADX_MCP_JAR"]).toBe(link);
});

it("guides Java selection when the Java runtime is missing", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-remediation-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: join(root, "missing-jdk"),
  });

  expect(inspection.checks[0]?.code).toBe("runtime_missing");
  expect(inspection.checks[0]?.remediation).toContain("JAVA_HOME");
  expect(inspection.checks[0]?.remediation).not.toContain("REA_JADX_MCP_JAR");
});

it("guides Java selection when JAVA_HOME is not an absolute path", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-options-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: "relative/path",
  });

  expect(inspection.checks[0]?.code).toBe("open_options_invalid");
  expect(inspection.checks[0]?.remediation).toContain("JAVA_HOME");
  expect(inspection.checks[0]?.remediation).not.toContain("REA_JADX_MCP_JAR");
});

it("publishes no registration environment when REA_JADX_MCP_JAR is unset", async () => {
  const inspection = await inspectJadxProvider({});

  expect(inspection).toMatchObject({
    id: "jadx",
    configured: false,
    available: false,
    providerVersion: null,
    registrationEnvironment: {},
    checks: [
      {
        name: "configuration",
        ok: false,
        code: "not_configured",
        classification: "missing_analysis_engine",
      },
    ],
  });
});

it("reports a relative REA_JADX_MCP_JAR as a rejected selection, not an unset one", async () => {
  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: "tools/jadx-headless-mcp.jar",
  });

  expect(inspection).toMatchObject({
    id: "jadx",
    configured: true,
    available: false,
    registrationEnvironment: {},
    checks: [
      {
        name: "configuration",
        ok: false,
        code: "open_options_invalid",
        classification: "config_drift",
      },
    ],
  });
  expect(inspection.checks[0]?.detail).toContain(
    'REA_JADX_MCP_JAR must be an absolute path; received "tools/jadx-headless-mcp.jar".',
  );
  expect(inspection.checks[0]?.remediation).toContain("REA_JADX_MCP_JAR");
});

it("publishes no registration environment when the configured JAR fails validation", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-invalid-");
  const jar = join(root, "engine.jar");
  const javaHome = await createFakeJdk(root);
  await writeFile(jar, "not a Java archive");

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection).toMatchObject({
    id: "jadx",
    configured: true,
    available: false,
    registrationEnvironment: {},
    checks: [
      {
        name: "configuration",
        ok: false,
        code: "version_unresolved",
        classification: "config_drift",
      },
    ],
  });
  expect(inspection.checks[0]?.detail).toContain("REA_JADX_MCP_JAR");
});

it("classifies a missing Java runtime as a missing dependency", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-runtime-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: join(root, "missing-jdk"),
  });

  expect(inspection).toMatchObject({
    configured: true,
    available: false,
    registrationEnvironment: {},
    checks: [
      {
        name: "configuration",
        ok: false,
        code: "runtime_missing",
        classification: "missing_dependency",
      },
    ],
  });
});

it("guides JVM option correction when REA_JADX_HEAP_MIB is invalid", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-heap-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_HEAP_MIB: "not-a-number",
  });

  expect(inspection.checks[0]?.code).toBe("open_options_invalid");
  expect(inspection.checks[0]?.remediation).toContain("REA_JADX_HEAP_MIB");
  expect(inspection.checks[0]?.remediation).not.toContain("JAVA_HOME");
});

it("publishes validated JVM resource overrides in the registration environment", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-overrides-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_HEAP_MIB: "4096",
    REA_JADX_ACTIVE_PROCESSOR_COUNT: "8",
  });

  expect(inspection.available).toBe(true);
  expect(inspection.registrationEnvironment).toEqual({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_HEAP_MIB: "4096",
    REA_JADX_ACTIVE_PROCESSOR_COUNT: "8",
  });
});

it("publishes and reports a validated operation deadline", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-deadline-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_OPERATION_TIMEOUT_MS: "900000",
  });

  expect(inspection.registrationEnvironment).toEqual({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_OPERATION_TIMEOUT_MS: "900000",
  });
  expect(inspection.checks[0]).toMatchObject({
    ok: true,
    details: { operation_timeout_ms: 900_000 },
  });
});

it("guides deadline correction when REA_JADX_OPERATION_TIMEOUT_MS is invalid", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-bad-deadline-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_OPERATION_TIMEOUT_MS: "2147483648",
  });

  expect(inspection.available).toBe(false);
  expect(inspection.registrationEnvironment).toEqual({});
  expect(inspection.checks[0]).toMatchObject({
    ok: false,
    code: "open_options_invalid",
    classification: "config_drift",
  });
  expect(inspection.checks[0]?.remediation).toContain(
    "REA_JADX_OPERATION_TIMEOUT_MS",
  );
  expect(inspection.checks[0]?.remediation).not.toContain("REA_JADX_MCP_JAR");
});

it("guides JDK selection when the Java runtime is older than 17", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-oldjdk-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root, "11");
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection.checks[0]?.code).toBe("unsupported_version");
  expect(inspection.checks[0]?.remediation).toContain("JDK");
  expect(inspection.checks[0]?.remediation).not.toContain("REA_JADX_MCP_JAR");
});

it("guides JAR replacement when the JAR misses bridge classes", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-classes-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeOrderedZip(jar, ["com/atxx/jhmcp/JadxSession.class"]);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection.checks[0]?.code).toBe("unsupported_version");
  expect(inspection.checks[0]?.remediation).toContain("REA_JADX_MCP_JAR");
});

it("remediates an unsupported host with platform guidance", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: "sunos",
    configurable: true,
  });
  try {
    const inspection = await inspectJadxProvider({
      REA_JADX_MCP_JAR: "/opt/jadx-headless-mcp.jar",
    });

    expect(inspection.checks[0]?.code).toBe("unsupported_host");
    expect(inspection.checks[0]?.remediation).toContain("Linux");
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  }
});

it("guides Windows native package correction when process ownership is unavailable", async () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  try {
    const inspection = await inspectJadxProvider({
      REA_JADX_MCP_JAR: "/opt/jadx-headless-mcp.jar",
    });

    expect(inspection.checks[0]?.code).toBe("runtime_missing");
    expect(inspection.checks[0]?.remediation).toContain(
      "Windows x64 REA package",
    );
    expect(inspection.checks[0]?.remediation).not.toContain("JAVA_HOME");
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: originalArch,
      configurable: true,
    });
  }
});

it("guides Java probe correction when the module listing is unparseable", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-unparseable-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);
  // Fake JDK whose module listing lacks a parseable java.base version.
  const javaHome = join(root, "fake-jdk");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  await writeFile(java, "#!/bin/sh\nprintf 'jdk.compiler@21\\n'\n");
  await chmod(java, 0o700);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection.checks[0]?.code).toBe("version_unresolved");
  expect(inspection.checks[0]?.remediation).toContain("java --list-modules");
  expect(inspection.checks[0]?.remediation).not.toContain("REA_JADX_MCP_JAR");
});

const createFakeJdk = async (root: string, major = "21"): Promise<string> => {
  const javaHome = join(root, "fake-jdk");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  await writeFile(
    java,
    `#!/bin/sh\nprintf 'java.base@${major}\\njdk.compiler@${major}\\n'\n`,
  );
  await chmod(java, 0o700);
  return javaHome;
};

it("classifies missing Windows native artifacts as missing dependencies", async () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  Object.defineProperty(process, "arch", { value: "x64", configurable: true });
  try {
    const inspection = await inspectJadxProvider({
      REA_JADX_MCP_JAR: "/opt/jadx-headless-mcp.jar",
    });

    expect(inspection.checks[0]?.code).toBe("runtime_missing");
    expect(inspection.checks[0]?.classification).toBe("missing_dependency");
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: originalArch,
      configurable: true,
    });
  }
});

it("classifies malformed JAVA_HOME as configuration drift", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-javahome-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: "relative/path",
  });

  expect(inspection.checks[0]?.code).toBe("open_options_invalid");
  expect(inspection.checks[0]?.classification).toBe("config_drift");
});

it("preserves Java probe diagnostics in doctor output", async () => {
  const root = await createTestTempDirectory("rea-jadx-doctor-probe-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);
  const javaHome = join(root, "fake-jdk-unparseable");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  // Emits jdk.compiler but no parseable java.base version.
  await writeFile(java, `#!/bin/sh\nprintf 'jdk.compiler@21\\n'\n`);
  await chmod(java, 0o700);

  const inspection = await inspectJadxProvider({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });

  expect(inspection.checks[0]?.code).toBe("version_unresolved");
  expect(inspection.checks[0]?.details).toMatchObject({
    java_executable: expect.any(String),
  });
});
