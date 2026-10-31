import { probeGhidraJava } from "../../../src/ghidra/GhidraJavaProbe.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import {
  inspectGhidraInstallation,
  systemGhidraInstallationHost,
  ghidraInstallationDiagnostics,
} from "../../../src/ghidra/GhidraInstallation.js";
import { SUPPORTED_GHIDRA_VERSION } from "../../../src/ghidra/GhidraReleasePolicy.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

/** Controlled Java-shaped command exercising the real process owner, not a JVM. */
const writeJavaProbe = async (
  home: string,
  stderrText: string,
  outputBytes?: number,
) => {
  const executable = join(
    home,
    "bin",
    process.platform === "win32" ? "java.exe" : "java",
  );
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(
    process.platform === "win32" ? `${executable}.cjs` : executable,
    `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(join(home, "probe-arguments.json"))}, JSON.stringify(process.argv.slice(2)));\nconst prefix = ${JSON.stringify(stderrText)};\nprocess.stderr.write(prefix${outputBytes === undefined ? "" : ` + 'X'.repeat(${outputBytes} - Buffer.byteLength(prefix))`});\n`,
    { mode: 0o700 },
  );
};

// Windows executes the controlled JS prerequisite with the real owned Node exe;
// POSIX executes its selected shebang path. Neither fixture is a real JVM.
const probeHost =
  process.platform !== "win32"
    ? undefined
    : {
        ...systemGhidraInstallationHost(),
        probeJava: (
          command: string,
          environment: NodeJS.ProcessEnv,
          options: Parameters<typeof probeGhidraJava>[2],
        ) =>
          probeGhidraJava(command, environment, {
            ...options,
            launcher: (spawn) =>
              spawnOwnedProviderProcess({
                ...spawn,
                command: process.execPath,
                arguments: [`${command}.cjs`, ...spawn.arguments],
                // The controlled Node prerequisite needs Windows runtime state.
                hostEnvironment: {
                  SystemRoot: process.env.SystemRoot,
                  TEMP: tmpdir(),
                  TMP: tmpdir(),
                  ...spawn.hostEnvironment,
                },
              }),
          }),
      };

it.each([
  { major: 17, fullJdk: true, vmName: "Java HotSpot(TM) 64-Bit Server VM" },
  { major: 21, fullJdk: true, vmName: "Eclipse OpenJ9 VM" },
  { major: 21, fullJdk: false, vmName: undefined },
])(
  "preserves the reported Unicode Java home and classifies JDK $major (full JDK: $fullJdk)",
  async ({ major, fullJdk, vmName }) => {
    const root = await createTestTempDirectory("rea-java-probe-");
    const configuredHome = join(root, "selected-jdk");
    const reportedHome = join(root, "Réa逆向", `JDK ${String(major)}`);
    const installDir = join(root, "ghidra");
    await mkdir(join(installDir, "Ghidra"), { recursive: true });
    await writeFile(
      join(installDir, "Ghidra", "application.properties"),
      `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=17\n`,
    );
    if (fullJdk) {
      await mkdir(join(reportedHome, "bin"), { recursive: true });
      await writeFile(
        join(
          reportedHome,
          "bin",
          process.platform === "win32" ? "javac.exe" : "javac",
        ),
        "compiler presence fixture",
        { mode: 0o755 },
      );
    }
    const version = `${String(major)}.0.11`;
    await writeJavaProbe(
      configuredHome,
      `    java.version = ${version}\n    java.home = ${reportedHome}\n    sun.arch.data.model = 64\n${vmName === undefined ? "" : `    java.vm.name = ${vmName}\n`}`,
    );

    const inspection = await inspectGhidraInstallation(
      {
        resourceOwner: inspectionResources.owner,
        environment: {},
        installDir,
        javaHome: configuredHome,
      },
      probeHost,
    );

    expect(inspection.javaHome).toBe(reportedHome);
    expect(inspection.javaVersion).toBe(version);
    expect(inspection.javaVmName).toBe(vmName);
    expect(ghidraInstallationDiagnostics(inspection).java_vm_name).toBe(
      vmName ?? null,
    );
    expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject(
      {
        status: fullJdk ? "passed" : "failed",
        detail: expect.stringContaining(fullJdk ? "; JDK;" : "; runtime only;"),
      },
    );
    expect(
      JSON.parse(
        await readFile(join(configuredHome, "probe-arguments.json"), "utf8"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "-Dstdout.encoding=UTF-8",
        "-Dstderr.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-Dsun.stderr.encoding=UTF-8",
      ]),
    );
  },
);

it.each([
  { label: "omitted", property: "", shown: "bitness unknown" },
  {
    label: "empty",
    property: "sun.arch.data.model = \n",
    shown: 'bitness unknown (sun.arch.data.model = "")',
  },
  {
    label: "nonstandard framing",
    property: "sun.arch.data.model =\n",
    shown: "bitness unknown",
  },
  {
    label: "malformed",
    property: "sun.arch.data.model = 64junk\n",
    shown: 'bitness unknown (sun.arch.data.model = "64junk")',
  },
  {
    label: "not exactly representable",
    property: "sun.arch.data.model = 9007199254740993\n",
    shown: 'bitness unknown (sun.arch.data.model = "9007199254740993")',
  },
])("keeps $label Java bitness unresolved", async ({ property, shown }) => {
  const root = await createTestTempDirectory("rea-java-bitness-");
  const configuredHome = join(root, "selected-jdk");
  const reportedHome = join(root, "reported-jdk");
  const installDir = join(root, "ghidra");
  await mkdir(join(installDir, "Ghidra"), { recursive: true });
  await mkdir(join(reportedHome, "bin"), { recursive: true });
  await writeFile(
    join(
      reportedHome,
      "bin",
      process.platform === "win32" ? "javac.exe" : "javac",
    ),
    "fixture",
    {
      mode: 0o755,
    },
  );
  await writeFile(
    join(installDir, "Ghidra", "application.properties"),
    `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=17\n`,
  );
  await writeJavaProbe(
    configuredHome,
    `    java.version = 21.0.11\n    java.home = ${reportedHome}\n${property}`,
  );

  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir,
      javaHome: configuredHome,
    },
    probeHost,
  );

  expect(inspection.status).toBe("unavailable");
  expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject({
    status: "failed",
    code: "version_unresolved",
    detail: expect.stringContaining(shown),
  });
  expect(
    inspection.checks.find(({ name }) => name === "java")?.detail,
  ).not.toMatch(/(?:0-bit|9007199254740992-bit)/);
});

it("keeps a known 32-bit Java report classified as unsupported", async () => {
  const root = await createTestTempDirectory("rea-java-bitness-known-");
  const configuredHome = join(root, "selected-jdk");
  const reportedHome = join(root, "reported-jdk");
  const installDir = join(root, "ghidra");
  await mkdir(join(installDir, "Ghidra"), { recursive: true });
  await mkdir(join(reportedHome, "bin"), { recursive: true });
  await writeFile(
    join(
      reportedHome,
      "bin",
      process.platform === "win32" ? "javac.exe" : "javac",
    ),
    "fixture",
    {
      mode: 0o755,
    },
  );
  await writeFile(
    join(installDir, "Ghidra", "application.properties"),
    `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=17\n`,
  );
  await writeJavaProbe(
    configuredHome,
    `    java.version = 21.0.11\n    java.home = ${reportedHome}\n    sun.arch.data.model = 32\n`,
  );

  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir,
      javaHome: configuredHome,
    },
    probeHost,
  );

  expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject({
    status: "failed",
    code: "unsupported_version",
    detail: expect.stringContaining("32-bit"),
  });
});

it("bounds the Java version probe and reports an over-budget probe as a failed Java check", async () => {
  const root = await createTestTempDirectory("rea-java-probe-bound-");
  const configuredHome = join(root, "selected-jdk");
  const installDir = join(root, "ghidra");
  await mkdir(join(installDir, "Ghidra"), { recursive: true });
  await writeFile(
    join(installDir, "Ghidra", "application.properties"),
    `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=17\n`,
  );
  // The real command owner observes output beyond its one-MiB aggregate budget.
  await writeJavaProbe(
    configuredHome,
    "java.version = 21.0.11\n",
    1024 * 1024 + 1,
  );

  const inspection = await inspectGhidraInstallation(
    {
      resourceOwner: inspectionResources.owner,
      environment: {},
      installDir,
      javaHome: configuredHome,
    },
    probeHost,
  );

  expect(inspection.javaVersion).toBeNull();
  expect(inspection.javaHome).toBe(configuredHome);
  expect(inspection.checks.find(({ name }) => name === "java")).toMatchObject({
    status: "failed",
    code: "runtime_unavailable",
  });
  expect(
    ghidraInstallationDiagnostics(inspection).java_probe_failure,
  ).toMatchObject({
    code: "runtime_unavailable",
    process_error_code: "ENOBUFS",
    output: {
      stderr: expect.stringContaining("java.version = 21.0.11\n"),
      truncated: true,
      signal: null,
    },
  });
});
