import { AnalysisSettings } from "../../../src/application/AnalysisSettings.js";
import { JadxProvider } from "../../../src/android/JadxProvider.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it as test, onTestFinished, vi } from "vitest";

import {
  inspectJadxAvailability as inspectAvailability,
  resolveJadxConfigurationInputs,
  validateJadxConfiguration,
} from "../../../src/android/JadxConfiguration.js";
import { AnalysisCapabilityUnavailableError } from "../../../src/domain/analysisErrorCore.js";
import {
  LinuxOwnedProcessPrerequisiteError,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { writeJadxJarInventory } from "../../fixtures/android/jadxJar.js";

const inspectionOwner = () => {
  const resources = createInspectionResources();
  onTestFinished(() => resources.close());
  return resources.owner;
};
const inspectJadxAvailability = (
  environment: Parameters<typeof inspectAvailability>[0],
  signal?: AbortSignal,
) =>
  inspectAvailability(environment, {
    resourceOwner: inspectionOwner(),
    signal,
  });

const it = test.skipIf(process.platform === "win32");

const resolveConfiguration = async (
  environment: Parameters<typeof resolveJadxConfigurationInputs>[0],
  operation: Parameters<typeof resolveJadxConfigurationInputs>[1],
) => {
  const configuration = await resolveJadxConfigurationInputs(
    environment,
    operation,
  );
  await validateJadxConfiguration(configuration, environment, operation, {
    resourceOwner: inspectionOwner(),
  });
  return configuration;
};

it("uses the JDK selected through a symlink parent traversal", async () => {
  const root = await createTestTempDirectory("rea-jadx-java-traversal-");
  const intended = join(root, "selected");
  await mkdir(join(intended, "child"), { recursive: true });
  const javaHome = await createFakeJdk(intended);
  await symlink(await createFakeJdk(root, false), join(root, "fake-jdk"));
  await symlink(join(intended, "child"), join(root, "alias"));
  const selectedHome = `${root}/alias/../fake-jdk`;
  expect(await realpath(selectedHome)).toBe(await realpath(javaHome));
  const jar = join(root, "jadx.jar");
  await writeJadxJarInventory(jar);
  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: selectedHome },
      "inspect_android_package",
    ),
  ).resolves.toMatchObject({ java: `${selectedHome}/bin/java` });
});

it("rejects malformed or unrelated engine archives with JAR-specific recovery", async () => {
  const root = await createTestTempDirectory("rea-jadx-invalid-jar-");
  const javaHome = await createFakeJdk(root);
  const jar = join(root, "engine.jar");
  for (const malformed of [true, false]) {
    if (malformed) await writeFile(jar, "not a Java archive");
    else await writeOrderedZip(jar, ["unrelated/Library.class"]);
    const environment = { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome };
    const availability = await inspectJadxAvailability(environment);
    expect(availability).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("REA_JADX_MCP_JAR"),
      diagnostics: { jar_path: await realpath(jar), phase: "jar-inspection" },
    });
    await expect(
      resolveConfiguration(environment, "inspect_android_package"),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining("REA_JADX_MCP_JAR"),
    });
    expect(availability.reason).not.toContain("Select a full JDK");
  }
});

it("rejects an explicit JAVA_HOME without an executable java binary", async () => {
  const root = await createTestTempDirectory("rea-jadx-config-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = join(root, "missing-jdk");
  await writeJadxJarInventory(jar);

  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome },
      "inspect_android_package",
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining(join(javaHome, "bin", "java")),
  });
});

it("accepts a full JDK and canonicalizes the selected JAR", async () => {
  const root = await createTestTempDirectory("rea-jadx-config-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);

  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome },
      "inspect_android_package",
    ),
  ).resolves.toEqual({
    jar: await realpath(jar),
    java: join(javaHome, "bin", "java"),
    jvmArguments: [],
  });
});

it("admits engine classes past repeated ZIP resource filenames", async () => {
  const root = await createTestTempDirectory("rea-jadx-duplicate-resource-");
  const jar = join(root, "engine.jar");
  const javaHome = await createFakeJdk(root);
  await writeOrderedZip(jar, [
    "META-INF/LICENSE.txt",
    "META-INF/LICENCE.txt",
    "com/atxx/jhmcp/JadxSession.class",
    "com/atxx/jhmcp/SessionHolder.class",
    "jadx/api/JadxDecompiler.class",
    "com/google/gson/Gson.class",
    "io/modelcontextprotocol/kotlin/sdk/server/Server.class",
  ]);
  const bytes = await readFile(jar);
  const original = Buffer.from("META-INF/LICENCE.txt");
  let renamed = 0;
  for (
    let offset = bytes.indexOf(original);
    offset >= 0;
    offset = bytes.indexOf(original, offset + original.length)
  ) {
    bytes.write("META-INF/LICENSE.txt", offset);
    renamed++;
  }
  expect(renamed).toBe(2);
  await writeFile(jar, bytes);
  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome },
      "inspect_android_package",
    ),
  ).resolves.toMatchObject({ jar: await realpath(jar) });
});

it("configures heap and visible processors independently without forcing either", async () => {
  const root = await createTestTempDirectory("rea-jadx-config-");
  const jar = join(root, "engine.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);
  const configuration = await resolveConfiguration(
    {
      REA_JADX_MCP_JAR: jar,
      JAVA_HOME: javaHome,
      REA_JADX_HEAP_MIB: "8192",
      REA_JADX_ACTIVE_PROCESSOR_COUNT: "4",
    },
    "inspect_android_package",
  );
  expect(configuration.jvmArguments).toEqual([
    "-Xmx8192m",
    "-XX:ActiveProcessorCount=4",
  ]);
  await expect(
    resolveConfiguration(
      {
        REA_JADX_MCP_JAR: jar,
        JAVA_HOME: javaHome,
        REA_JADX_ACTIVE_PROCESSOR_COUNT: "2147483648",
      },
      "inspect_android_package",
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining("32-bit"),
  });
  for (const name of ["REA_JADX_HEAP_MIB", "REA_JADX_ACTIVE_PROCESSOR_COUNT"])
    for (const value of ["", "0", "-1", "1.5", "8g", " 4", "9007199254740992"])
      await expect(
        resolveConfiguration(
          {
            REA_JADX_MCP_JAR: jar,
            JAVA_HOME: javaHome,
            [name]: value,
          },
          "inspect_android_package",
        ),
      ).rejects.toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        reason: expect.stringContaining(name),
      });
});

it("distinguishes a runnable JRE from a missing Java executable", async () => {
  const root = await createTestTempDirectory("rea-jadx-runtime-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);
  const jreHome = await createFakeJdk(root, false);
  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: jreHome },
      "inspect_android_package",
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining("does not provide jdk.compiler"),
    userMessage: expect.stringContaining("A JRE cannot compile"),
    capturedOutput: {
      stdout: "java.base@21\n",
      stderr: "",
      truncated: false,
    },
  });

  const emptyPath = join(root, "empty-path");
  await mkdir(emptyPath);
  const availability = await inspectJadxAvailability({
    REA_JADX_MCP_JAR: jar,
    PATH: emptyPath,
  });
  expect(availability).toMatchObject({
    status: "unavailable",
    code: "runtime_missing",
    reason: expect.stringContaining("Cannot find an executable java"),
    diagnostics: {
      java_executable: "java",
      phase: "path-lookup",
    },
  });
});

it("preserves exact Java probe output and marks max-buffer capture as truncated", async () => {
  const root = await createTestTempDirectory("rea-jadx-output-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = join(root, "fake-jdk");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  await writeJadxJarInventory(jar);
  await writeFile(
    java,
    `#!/bin/sh\nexec ${process.execPath} -e 'process.stdout.write("x".repeat(2 * 1024 * 1024))'\n`,
  );
  await chmod(java, 0o700);

  const failure = await resolveConfiguration(
    { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome },
    "inspect_android_package",
  ).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(failure).toBeInstanceOf(AnalysisCapabilityUnavailableError);
  if (!(failure instanceof AnalysisCapabilityUnavailableError)) return;
  expect(failure.reason).toContain("1048576-byte");
  expect(failure.reason).toContain("no runtime override");
  expect(failure.reason).not.toContain("Select a full JDK");
  expect(failure.capturedOutput).toMatchObject({
    stdout: expect.stringMatching(/^x/u),
    stderr: "",
    truncated: true,
  });
  expect(failure.capturedOutput?.stdout.length).toBeLessThan(2 * 1024 * 1024);
  await expect(
    inspectJadxAvailability({
      REA_JADX_MCP_JAR: jar,
      JAVA_HOME: javaHome,
    }),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "version_unresolved",
    diagnostics: {
      process_error_code: null,
      failure: "output_limit",
      output_truncated: true,
    },
  });
});

it("distinguishes an unreported Java version from an unsupported old version", async () => {
  const root = await createTestTempDirectory("rea-jadx-version-listing-");
  const jar = join(root, "jadx-headless-mcp.jar");
  await writeJadxJarInventory(jar);

  const unresolvedHome = await createFakeJdk(root);
  await writeFile(
    join(unresolvedHome, "bin", "java"),
    "#!/bin/sh\nprintf 'jdk.compiler@21\\n'\n",
  );
  await chmod(join(unresolvedHome, "bin", "java"), 0o700);
  await expect(
    inspectJadxAvailability({
      REA_JADX_MCP_JAR: jar,
      JAVA_HOME: unresolvedHome,
    }),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "version_unresolved",
    reason: expect.stringContaining(
      "did not report a parseable java.base version",
    ),
    diagnostics: { stdout: "jdk.compiler@21\n", java_major: null },
  });

  const oldHome = await createFakeJdk(root);
  await writeFile(
    join(oldHome, "bin", "java"),
    "#!/bin/sh\nprintf 'java.base@16\\njdk.compiler@16\\n'\n",
  );
  await chmod(join(oldHome, "bin", "java"), 0o700);
  await expect(
    resolveConfiguration(
      { REA_JADX_MCP_JAR: jar, JAVA_HOME: oldHome },
      "inspect_android_package",
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining("must be JDK 17 or newer"),
  });
});

it("cancels an in-flight Java readiness probe", async () => {
  const root = await createTestTempDirectory("rea-jadx-cancel-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const { javaHome, marker } = await createHangingJdk(root);
  await writeJadxJarInventory(jar);
  const controller = new AbortController();
  const pending = inspectJadxAvailability(
    { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome },
    controller.signal,
  );
  try {
    await expect
      .poll(
        () =>
          readFile(marker, "utf8").then(
            () => true,
            () => false,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      _tag: "AnalysisCancelledError",
    });
  } finally {
    controller.abort();
    await pending.catch(() => undefined);
  }
});

it("reports a killed Java probe as unresolved instead of missing runtime", async () => {
  const root = await createTestTempDirectory("rea-jadx-timeout-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const { javaHome, java } = await createHangingJdk(root);
  await writeJadxJarInventory(jar);

  const availability = await inspectJadxAvailability({
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
  });
  expect(availability).toMatchObject({
    status: "unavailable",
    code: "version_unresolved",
    reason: expect.stringContaining("10000 ms"),
    diagnostics: {
      java_executable: java,
      failure: "probe_terminated",
      killed: null,
      deadline_ms: 10_000,
    },
  });
  expect(availability.reason).toContain("no runtime override");
  expect(availability.reason).not.toContain("Select a full JDK");
});

const createHangingJdk = async (root: string) => {
  const javaHome = join(root, "fake-jdk");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  const marker = join(root, "java-probe-started");
  await mkdir(bin, { recursive: true });
  await writeFile(
    java,
    `#!/bin/sh\nexec ${process.execPath} -e 'require("node:fs").writeFileSync(process.argv[1], "ready"); setTimeout(() => {}, 30_000)' '${marker}'\n`,
  );
  await chmod(java, 0o700);
  return { javaHome, java, marker };
};

const createFakeJdk = async (
  root: string,
  compiler = true,
): Promise<string> => {
  const javaHome = join(root, compiler ? "fake-jdk" : "fake-jre");
  const bin = join(javaHome, "bin");
  const java = join(bin, "java");
  await mkdir(bin, { recursive: true });
  await writeFile(
    java,
    `#!/bin/sh\nprintf 'java.base@21${compiler ? "\\njdk.compiler@21" : ""}\\n'\n`,
  );
  await chmod(java, 0o700);
  return javaHome;
};

it("tags unavailable diagnostics with the boundary failure kind", async () => {
  const availability = await inspectJadxAvailability({});
  expect(availability.status).toBe("unavailable");
  if (availability.status !== "unavailable") throw new Error("unreachable");
  expect(availability.diagnostics["failure_kind"]).toBe("jar");
});

it("reports the effective operation deadline and rejects unusable values", async () => {
  const root = await createTestTempDirectory("rea-jadx-deadline-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);
  const environment = { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome };
  for (const [value, expected] of [
    [undefined, 120_000],
    ["1", 1],
    ["900000", 900_000],
    ["2147483647", 2_147_483_647],
  ] as const)
    await expect(
      inspectJadxAvailability({
        ...environment,
        ...(value === undefined
          ? {}
          : { REA_JADX_OPERATION_TIMEOUT_MS: value }),
      }),
    ).resolves.toMatchObject({
      status: "available",
      diagnostics: { operation_timeout_ms: expected },
    });
  // Node clamps timer delays above the signed 32-bit range to 1 ms.
  for (const value of ["", "0", "-1", "1.5", "1e3", " 5", "abc", "2147483648"])
    await expect(
      inspectJadxAvailability({
        ...environment,
        REA_JADX_OPERATION_TIMEOUT_MS: value,
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      code: "open_options_invalid",
      reason: expect.stringContaining("REA_JADX_OPERATION_TIMEOUT_MS"),
      diagnostics: {
        setting: "REA_JADX_OPERATION_TIMEOUT_MS",
        value,
        failure_kind: "operation_timeout",
      },
    });
});

it("joins a cancelled Java readiness probe until its owned child exits", async () => {
  const root = await createTestTempDirectory("rea-jadx-probe-finalization-");
  const javaHome = join(root, "jdk");
  const java = join(javaHome, "bin", "java");
  const jar = join(root, "engine.jar");
  const ready = join(root, "ready");
  const stopping = join(root, "stopping");
  const release = join(root, "release");
  const exiting = join(root, "exiting");
  await mkdir(join(javaHome, "bin"), { recursive: true });
  await writeJadxJarInventory(jar);
  await writeFile(
    java,
    `#!${process.execPath}
const fs = require("node:fs");
const ready = ${JSON.stringify(ready)};
const stopping = ${JSON.stringify(stopping)};
const release = ${JSON.stringify(release)};
const exiting = ${JSON.stringify(exiting)};
process.on("SIGTERM", () => { fs.writeFileSync(stopping, "received"); });
const check = setInterval(() => {
  if (fs.existsSync(release)) {
    fs.writeFileSync(exiting, "released");
    process.stderr.write("final readiness diagnostic");
    clearInterval(check);
    clearTimeout(watchdog);
  }
}, 10);
const watchdog = setTimeout(() => { process.exitCode = 99; clearInterval(check); }, 10000);
fs.writeFileSync(ready, String(process.pid));
`,
  );
  await chmod(java, 0o700);
  const caller = new AbortController();
  const pending = inspectJadxAvailability(
    { JAVA_HOME: javaHome, REA_JADX_MCP_JAR: jar },
    caller.signal,
  ).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const fileExists = (path: string) =>
    readFile(path, "utf8").then(
      () => true,
      () => false,
    );
  let pid: number | undefined;
  const absent = () => {
    if (pid === undefined) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch (cause: unknown) {
      if (cause instanceof Error && "code" in cause && cause.code === "ESRCH")
        return true;
      throw cause;
    }
  };
  try {
    await expect.poll(() => fileExists(ready)).toBe(true);
    pid = Number(await readFile(ready, "utf8"));
    caller.abort({ caller: "readiness cancellation" });
    const outcome = await pending;
    expect(outcome).toMatchObject({ error: { cause: caller.signal.reason } });
    // A zero-signal observation is conservative under PID reuse and never
    // grants cleanup authority; only the fixture's release file requests exit.
    expect(absent()).toBe(true);
  } finally {
    caller.abort();
    await writeFile(release, "release");
    await pending;
    await expect.poll(absent).toBe(true);
  }
});

it.each([
  null,
  { caller: "before readiness" },
  new ProviderCleanupError("foreign", ["foreign-resource"], {
    reason: "foreign cleanup",
  }),
])(
  "preserves opaque pre-admission readiness cancellation %j",
  async (reason) => {
    const caller = new AbortController();
    caller.abort(reason);
    const error: unknown = await inspectJadxAvailability(
      {},
      caller.signal,
    ).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
      cleanupIncomplete: false,
    });
    if (reason instanceof ProviderCleanupError)
      expect(reason.cleanupIncomplete).toBe(true);
  },
);

it("reports the runtime JADX repair and restores invalid launch availability on reset", async () => {
  const root = await createTestTempDirectory("rea-jadx-runtime-availability-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);
  const environment = {
    REA_JADX_MCP_JAR: jar,
    JAVA_HOME: javaHome,
    REA_JADX_OPERATION_TIMEOUT_MS: "0",
  };
  const settings = new AnalysisSettings(environment);
  const provider = new JadxProvider(environment, undefined, settings.read);
  try {
    const unavailable = {
      status: "unavailable",
      code: "open_options_invalid",
      diagnostics: { failure_kind: "operation_timeout" },
    };
    await expect(
      settings.run(() => provider.inspectAvailability()),
    ).resolves.toMatchObject(unavailable);
    expect(
      settings.update({
        changes: [
          { setting: "jadx.operation_timeout_ms", action: "set", value: 42000 },
        ],
      }).ok,
    ).toBe(true);
    await expect(
      settings.run(() => provider.inspectAvailability()),
    ).resolves.toMatchObject({
      status: "available",
      diagnostics: { operation_timeout_ms: 42000 },
    });
    expect(
      settings.update({
        changes: [{ setting: "jadx.operation_timeout_ms", action: "reset" }],
      }).ok,
    ).toBe(true);
    await expect(
      settings.run(() => provider.inspectAvailability()),
    ).resolves.toMatchObject(unavailable);
  } finally {
    await provider.close();
  }
});

it("reports the owned-process prerequisite as JADX unavailability, not a probe failure", async () => {
  const root = await createTestTempDirectory("rea-jadx-ps-prerequisite-");
  const jar = join(root, "jadx-headless-mcp.jar");
  const javaHome = await createFakeJdk(root);
  await writeJadxJarInventory(jar);
  const environment = { REA_JADX_MCP_JAR: jar, JAVA_HOME: javaHome };
  await expect(inspectJadxAvailability(environment)).resolves.toMatchObject({
    status: "available",
  });

  vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
    async () => {
      throw new LinuxOwnedProcessPrerequisiteError(
        new Error("spawn ps ENOENT"),
      );
    },
  );
  onTestFinished(() => {
    vi.restoreAllMocks();
  });

  await expect(inspectJadxAvailability(environment)).resolves.toMatchObject({
    status: "unavailable",
    code: "runtime_unavailable",
    reason: expect.stringContaining("procps-compatible ps") as unknown,
    diagnostics: { stage: "ownership_preparation" },
  });
  await expect(
    resolveConfiguration(environment, "inspect_android_package"),
  ).rejects.toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    providerId: "process-ownership",
    reason: expect.stringContaining("spawn ps ENOENT") as unknown,
  });
});
