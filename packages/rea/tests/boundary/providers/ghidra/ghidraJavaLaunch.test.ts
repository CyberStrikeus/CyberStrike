import { ok as javaProbeOk } from "../../../../src/domain/result.js";
import type { GhidraJavaObservation } from "../../../../src/ghidra/GhidraJavaProbe.js";
import {
  mkdir,
  stat,
  writeFile,
  readFile,
  readdir,
  realpath,
  symlink,
} from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import { ArtifactFileCleanupFailure } from "../../../../src/artifacts/ArtifactFileOperation.js";
import {
  GhidraLaunchSupportError,
  ghidraJavaLaunch,
} from "../../../../src/ghidra/GhidraJavaLaunch.js";
import {
  inspectGhidraInstallation,
  ghidraJavaEnvironment,
} from "../../../../src/ghidra/GhidraInstallation.js";
import {
  SUPPORTED_GHIDRA_VERSION,
  SUPPORTED_GHIDRA_JAVA_MAJOR,
} from "../../../../src/ghidra/GhidraReleasePolicy.js";
import { createInspectionResources } from "../../../fixtures/inspectionResources.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { AnalysisCancelledError } from "../../../../src/domain/analysisErrorCore.js";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { createGhidraDiagnostics } from "../../../../src/ghidra/GhidraDiagnostics.js";
import {
  GhidraHeadlessLauncher,
  GhidraLaunchError,
  GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
  type GhidraLaunchSession,
} from "../../../../src/ghidra/GhidraLauncher.js";
import { bindGhidraSessionFailure } from "../../../../src/ghidra/GhidraSessionError.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { waitForAbortableDelay } from "../../../../src/process/ProviderDeadline.js";
import { execFileOutput } from "../../../../src/process/ExecFileOutput.js";
import { GhidraProvider } from "../../../../src/ghidra/GhidraProvider.js";
import { GhidraClient } from "../../../../src/ghidra/GhidraClient.js";
import { parseConfig } from "../../../../src/config/parseConfig.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { analysisErrorProjectionSchema } from "../../../../src/contracts/errorSchemas.js";
import type { BinaryTarget } from "../../../../src/domain/binaryTargetTypes.js";
import { elf } from "../../../../src/domain/binaryTarget.fixture.js";
import { silentLogger } from "../../../../src/logger.js";

const warning =
  "[0.004s][warning][os,container] Cgroup limits may be inaccurate: /tmp/password-fixture?token=public-value";

it.skipIf(process.platform === "win32")(
  "keeps the same symlink parent selection from installation inspection through Java launch",
  async () => {
    const root = await createTestTempDirectory("rea-ghidra-selected-parent-");
    const intended = join(root, "selected");
    for (const directory of [
      "child",
      "bin",
      "support",
      "Ghidra/Framework/Utility/lib",
      `Ghidra/Features/Decompiler/os/${process.platform === "darwin" ? "mac_x86_64" : "linux_x86_64"}`,
    ])
      await mkdir(join(intended, directory), { recursive: true });
    await symlink(join(intended, "child"), join(root, "alias"));
    const selected = `${root}/alias/..`;
    await writeFile(
      join(intended, "Ghidra/application.properties"),
      `application.version=${SUPPORTED_GHIDRA_VERSION}\napplication.java.min=${SUPPORTED_GHIDRA_JAVA_MAJOR}\n`,
    );
    for (const file of [
      "support/analyzeHeadless",
      "support/LaunchSupport.jar",
      "Ghidra/Framework/Utility/lib/Utility.jar",
      `Ghidra/Features/Decompiler/os/${process.platform === "darwin" ? "mac_x86_64" : "linux_x86_64"}/decompile`,
    ])
      await writeFile(join(intended, file), "selected", { mode: 0o700 });
    await writeFile(
      join(intended, "bin/java"),
      `#!/bin/sh
previous=""
for argument do
  if [ "$previous" = "-cp" ]; then
    [ "$(/bin/cat "$argument")" = "selected" ] || exit 92
  fi
  previous="$argument"
done
if [ "$previous" = "-envvars" ]; then
  printf 'GHIDRA_MAXMEM=1G\\n'
else
  printf '%s\\n' '-Dfile.encoding=UTF8'
fi
`,
      { mode: 0o700 },
    );
    const resources = createInspectionResources();
    onTestFinished(() => resources.close());
    const observedJava: string[] = [];
    const inspected = await inspectGhidraInstallation(
      {
        installDir: selected,
        javaHome: selected,
        environment: {},
        platform: process.platform,
        architecture: "x64",
        resourceOwner: resources.owner,
      },
      {
        readText: (path) => readFile(path, "utf8"),
        executable: (path) => existsSync(path) && statSync(path).isFile(),
        probeJava: async (command) => {
          observedJava.push(await realpath(command));
          return javaProbeOk({
            version: `${SUPPORTED_GHIDRA_JAVA_MAJOR}.0.1`,
            major: SUPPORTED_GHIDRA_JAVA_MAJOR,
            home: await realpath(intended),
            bits: 64,
            runtime: "jdk",
            osArch: "amd64",
            osName: process.platform === "darwin" ? "Mac OS X" : "Linux",
          });
        },
      },
    );
    expect(inspected.status).toBe("available");
    expect(observedJava).toEqual([await realpath(join(intended, "bin/java"))]);
    if (inspected.status !== "available")
      throw new Error("Expected selected installation");
    expect(inspected.installDir).toBe(selected);
    expect(inspected.javaHome).toBe(selected);
    const environment = ghidraJavaEnvironment(
      inspected.javaHome,
      {},
      process.platform,
    );
    expect(environment.PATH?.split(":")[0]).toBe(`${selected}/bin`);
    const launched = await ghidraJavaLaunch({
      platform: process.platform,
      analyzeHeadlessPath: inspected.analyzeHeadlessPath,
      javaHome: inspected.javaHome,
      homeRoot: root,
      tempRoot: root,
      arguments: [],
      environment,
      onStderr: () => {},
    });
    expect(await realpath(launched.command)).toBe(
      await realpath(join(intended, "bin/java")),
    );
    expect(launched.arguments).toContain(
      `${selected}/Ghidra/Framework/Utility/lib/Utility.jar`,
    );
  },
);

const fixture = async (
  mode: string,
  javaVmName: string | null = "OpenJDK 64-Bit Server VM",
) => {
  const root = await createTestTempDirectory("rea-ghidra-java-launch-");
  const javaHome = join(root, "jdk");
  await mkdir(join(javaHome, "bin"), { recursive: true });
  await writeFile(
    join(javaHome, "bin", "java"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const probe = args.at(-1);
if (probe !== "-envvars" && probe !== "-vmargs") process.exit(64);
const mode = ${JSON.stringify(mode)};
if (mode === "non-hotspot" && args.some(arg => arg.startsWith("-Xlog:"))) process.exit(65);
const warning = ${JSON.stringify(warning)};
const stream = args.includes("-Xlog:disable") && args.includes("-Xlog:all=warning:stderr") ? process.stderr : process.stdout;
if (mode !== "quiet" && mode !== "non-hotspot") stream.write(probe + ": " + warning + "\\n");
if (mode === "credential") stream.write("explicit credential: private-transport-token\\n");
if (mode === "large") stream.write("é".repeat(${GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES}) + "UNRETAINED-TAIL\\n");
if (mode === "env-failure" || (probe === "-vmargs" && mode === "vm-failure")) {
  process.stderr.write("failed " + probe + "\\n");
  process.exitCode = 3;
} else if (probe === "-envvars") {
  process.stdout.write(mode === "env-malformed" ? "invalid environment\\n" : mode.startsWith("env-injection:") ? mode.slice("env-injection:".length) + "\\n" : mode.startsWith("env-race:") ? "JDK_JAVA_OPTIONS=@" + mode.slice("env-race:".length) + "\\n" : "GHIDRA_MAXMEM=1G\\n");
} else {
  if (mode.startsWith("env-race:")) require("node:fs").writeFileSync(mode.slice("env-race:".length), "-Dos.arch=changed_after_admission\\n");
  const vmArguments = mode === "vm-malformed"
    ? "invalid JVM argument\\n"
    : mode === "os-arch-override"
      ? "-Dos.arch=x86_64\\n"
      : mode === "os-name-override"
        ? "-Dos.name=Windows\\n"
        : mode === "heap-override"
          ? "-Xmx128M\\n"
          : "-Dfile.encoding=UTF8\\n";
  process.stdout.write(vmArguments);
}
`,
    { mode: 0o755 },
  );
  const session: GhidraLaunchSession = {
    runtimeRoot: join(root, "runtime"),
    transport: "unix-socket",
    endpointPath: join(root, "endpoint.sock"),
    token: "private-transport-token",
    runId: randomUUID(),
    targetPath: join(root, "target.bin"),
    targetSha256: "0".repeat(64),
    providerVersion: "test",
    profileDigest: "test",
  };
  const analysisArguments: (readonly string[])[] = [];
  const analysisEnvironments: NodeJS.ProcessEnv[] = [];
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  const controller = new AbortController();
  const launcher = new GhidraHeadlessLauncher({
    environment: { PATH: process.env.PATH ?? "" },
    platform: process.platform,
    javaHome,
    ...(javaVmName === null ? {} : { javaVmName }),
    analyzeHeadlessPath: join(root, "ghidra", "support", "analyzeHeadless"),
    configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
    bridgeScriptPath: join(root, "ReaGhidraBridge.java"),
    spawnProcess: async (options) => {
      analysisArguments.push(options.arguments);
      analysisEnvironments.push(options.env ?? {});
      const spawned = await spawnOwnedProviderProcess({
        ...options,
        command: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
        expectedCommand: process.execPath,
      });
      onTestFinished(async () => {
        const cleanup =
          spawned.cleanup === undefined
            ? await cleanupOwnedProcessGroup(spawned.ownership)
            : await spawned.cleanup();
        expect(cleanup.cleaned).toBe(true);
      });
      if (mode === "cancel-after-spawn") controller.abort();
      if (mode === "timeout-after-spawn")
        await waitForAbortableDelay(10_000, options.signal);
      return spawned;
    },
  });
  return {
    session,
    launcher,
    analysisArguments,
    analysisEnvironments,
    controller,
    resources,
  };
};

describe.skipIf(process.platform === "win32")(
  "Ghidra inspected configuration identity",
  () => {
    it("prepares the inspected release directory without reinterpreting changed properties", async () => {
      const { session, launcher } = await fixture("quiet");
      const propertiesRoot = join(
        session.runtimeRoot,
        "..",
        "ghidra",
        "Ghidra",
      );
      await mkdir(propertiesRoot, { recursive: true });
      await writeFile(
        join(propertiesRoot, "application.properties"),
        "application.version=12.1.2\napplication.release.name=OTHER\n",
      );
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      expect(
        (
          await stat(
            join(
              session.runtimeRoot,
              "config",
              "ghidra",
              "ghidra_12.1.4_PUBLIC",
            ),
          )
        ).isDirectory(),
      ).toBe(true);
      await expect(
        stat(
          join(session.runtimeRoot, "config", "ghidra", "ghidra_12.1.2_OTHER"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects unresolved identity before creating runtime directories or starting Java", async () => {
      const { session, launcher, analysisArguments } = await fixture("quiet");
      const unresolved = new GhidraHeadlessLauncher({
        ...launcher.options,
        configurationDirectoryName: null,
      });
      const launched = await unresolved.launch(session);
      expect(launched).toMatchObject({
        ok: false,
        error: {
          cause: {
            message: expect.stringContaining(
              "configuration directory identity is unresolved",
            ),
          },
        },
      });
      expect(analysisArguments).toEqual([]);
      await expect(stat(session.runtimeRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra LaunchSupport JVM compatibility",
  () => {
    it("reports the selected heap after LaunchSupport's earlier heap argument", async () => {
      const { session, launcher, analysisArguments } =
        await fixture("heap-override");
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      expect(
        analysisArguments[0]?.filter((argument) => argument.startsWith("-Xmx")),
      ).toEqual(["-Xmx128M", "-Xmx1G"]);
      expect(launched.value.configuredMaxHeap).toBe("1G");
      expect(
        createGhidraDiagnostics({
          targetPath: session.targetPath,
          targetSha256: session.targetSha256,
          transport: session.transport,
          providerVersion: session.providerVersion,
          profileDigest: session.profileDigest,
          launch: launched.value,
          token: session.token,
          previous: {},
        }),
      ).toMatchObject({ configured_jvm_max_heap: "1G" });
    });

    it.each(["Eclipse OpenJ9 VM", "unrecognized VM", ""])(
      "keeps HotSpot-only flags off a VM identified as %s",
      async (javaVmName) => {
        const { session, launcher, analysisArguments } = await fixture(
          "non-hotspot",
          javaVmName === "" ? null : javaVmName,
        );
        const launched = await launcher.launch(session);
        if (!launched.ok) throw launched.error;
        expect(analysisArguments).toHaveLength(1);
        expect(launched.value.launchSupport).toBeUndefined();
      },
    );

    it.each([
      "OpenJDK 64-Bit Server VM",
      "Java HotSpot(TM) 64-Bit Server VM",
      "OpenJDK 64-Bit Zero VM",
    ])(
      "preserves redirected warnings for %s while keeping the analysis JVM arguments clean",
      async (javaVmName) => {
        const { session, launcher, analysisArguments } = await fixture(
          "success",
          javaVmName,
        );
        const launched = await launcher.launch(session);
        if (!launched.ok) throw launched.error;
        expect(analysisArguments[0]).toContain("-Dfile.encoding=UTF8");
        expect(analysisArguments[0]).toContain("-Xmx1G");
        expect(
          analysisArguments[0]?.some(
            (argument) =>
              argument.startsWith("-Xlog:") || argument.includes("[warning]"),
          ),
        ).toBe(false);
        const diagnostics = createGhidraDiagnostics({
          targetPath: session.targetPath,
          targetSha256: session.targetSha256,
          transport: session.transport,
          providerVersion: session.providerVersion,
          profileDigest: session.profileDigest,
          launch: launched.value,
          token: session.token,
          previous: {},
        });
        expect(diagnostics.launch_support).toEqual(
          ["-envvars", "-vmargs"].map((mode) => ({
            mode,
            stderr: `${mode}: ${warning}\n`,
            stderr_bytes: Buffer.byteLength(`${mode}: ${warning}\n`),
            stderr_truncated: false,
          })),
        );
      },
    );
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra LaunchSupport diagnostics",
  () => {
    it.each(["env-failure", "vm-failure", "env-malformed", "vm-malformed"])(
      "retains helper warnings through session failure diagnostics after %s",
      async (mode) => {
        const { session, launcher, analysisArguments } = await fixture(mode);
        const launched = await launcher.launch(session);
        expect(launched.ok).toBe(false);
        if (launched.ok) throw new Error("Expected a helper failure");
        expect(analysisArguments).toEqual([]);
        const failure = bindGhidraSessionFailure(() => ({}))(
          "start",
          launched.error.message,
          launched.error,
        );
        const cause = failure.diagnostics.failure_cause;
        if (mode === "env-failure") {
          expect(cause).toMatchObject({
            cause: {
              name: "GhidraLaunchSupportError",
              command_outcome: {
                killed: false,
                stderr: expect.stringContaining(`-envvars: ${warning}`),
              },
              cause: { code: 3 },
            },
          });
        } else {
          expect(cause).toMatchObject({
            launch_support: expect.arrayContaining([
              expect.objectContaining({
                mode: "-envvars",
                stderr: `-envvars: ${warning}\n`,
              }),
            ]),
          });
        }
        if (mode === "vm-failure")
          expect(cause).toMatchObject({
            cause: {
              name: "GhidraLaunchSupportError",
              command_outcome: {
                killed: false,
                stderr: expect.stringContaining(`-vmargs: ${warning}`),
              },
              cause: { code: 3 },
            },
          });
        if (mode === "env-malformed")
          expect(cause).toMatchObject({
            cause: {
              code: "invalid_environment_entry",
              detail: { check: "separator", line: "invalid environment" },
            },
          });
        if (mode === "vm-malformed")
          expect(cause).toMatchObject({
            launch_support: expect.arrayContaining([
              expect.objectContaining({
                mode: "-vmargs",
                stderr: `-vmargs: ${warning}\n`,
              }),
            ]),
          });
      },
    );

    it.each(["os-arch-override", "os-name-override"])(
      "rejects LaunchSupport %s before starting analysis",
      async (mode) => {
        const { session, launcher, analysisArguments } = await fixture(mode);
        const launched = await launcher.launch(session);
        expect(launched.ok).toBe(false);
        expect(analysisArguments).toEqual([]);
        if (launched.ok)
          throw new Error("Expected a JVM platform override failure");
        expect(launched.error.cause).toMatchObject({
          _tag: "GhidraAdmissionError",
          code: "platform_override",
        });
      },
    );

    it.each([
      ["JAVA_TOOL_OPTIONS", "-Dos.arch=x86_64"],
      ["JAVA_TOOL_OPTIONS", '"-Dos.arch=x86_64"'],
      ["_JAVA_OPTIONS", "'-Dos.name=Windows'"],
      ["JDK_JAVA_OPTIONS", '-D"os.name"=Windows'],
      ["JDK_JAVA_OPTIONS", "-D'os.arch'=x86_64"],
    ])(
      "rejects helper-environment platform injection from %s=%s before analysis",
      async (key, value) => {
        const { session, launcher, analysisArguments } = await fixture(
          `env-injection:${key}=${value}`,
        );
        const launched = await launcher.launch(session);
        expect(launched.ok).toBe(false);
        expect(analysisArguments).toEqual([]);
        if (launched.ok)
          throw new Error("Expected a JVM platform override failure");
        expect(launched.error.cause).toMatchObject({
          _tag: "GhidraAdmissionError",
          code: "platform_override",
        });
      },
    );

    it("admits a quoted non-platform option without mistaking its value for a platform argument", async () => {
      const { session, launcher, analysisArguments } = await fixture(
        'env-injection:JAVA_TOOL_OPTIONS=-Ddescription="text -Dos.arch=x86_64"',
      );
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      expect(analysisArguments).toHaveLength(1);
    });

    it("bounds retained UTF-8 warnings and reports original byte counts", async () => {
      const { session, launcher } = await fixture("large");
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      for (const output of launched.value.launchSupport ?? []) {
        expect(output.stderr_truncated).toBe(true);
        expect(output.stderr_bytes).toBeGreaterThan(
          GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
        );
        expect(Buffer.byteLength(output.stderr)).toBeLessThanOrEqual(
          GHIDRA_LAUNCH_COMMAND_OUTPUT_BYTES,
        );
        expect(output.stderr).not.toContain("UNRETAINED-TAIL");
        expect(output.stderr).not.toContain("�");
      }
      expect(launched.value.launchSupport).toHaveLength(2);
    });

    it("omits helper diagnostics when both stderr streams are empty", async () => {
      const { session, launcher } = await fixture("quiet");
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      expect(launched.value.launchSupport).toBeUndefined();
    });

    it("redacts the explicit transport credential and preserves caller-selected paths and URL values", async () => {
      const { session, launcher } = await fixture("credential");
      const launched = await launcher.launch(session);
      if (!launched.ok) throw launched.error;
      expect(launched.value.launchSupport).toHaveLength(2);
      for (const output of launched.value.launchSupport ?? []) {
        expect(output.stderr).toContain(warning);
        expect(output.stderr).toContain("explicit credential: [REDACTED]");
        expect(output.stderr).not.toContain(session.token);
        expect(output.stderr_truncated).toBe(false);
      }
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra LaunchSupport JDK_JAVA_OPTIONS argument files",
  () => {
    it.each([
      '-Dnote="prefix\\"#suffix" -Dos.arch=rea_argfile_probe\n',
      '"-Dos.ar\\\n    ch=rea_argfile_probe"\n',
      '"-Dos.ar"discard#comment\n  ch=rea_argfile_probe\n',
    ])(
      "rejects effective platform overrides after argfile quoting and continuation: %s",
      async (text) => {
        const root = await createTestTempDirectory("rea-ghidra-jdk-grammar-");
        const optionsFile = join(root, "platform.options");
        await writeFile(optionsFile, text);
        const { session, launcher, analysisArguments, resources } =
          await fixture(`env-injection:JDK_JAVA_OPTIONS=@${optionsFile}`);
        const launched = await launcher.launch(session, {
          resourceScope: resources,
        });
        expect(launched.ok).toBe(false);
        expect(analysisArguments).toEqual([]);
        if (launched.ok)
          throw new Error("Expected an effective platform override refusal");
        expect(launched.error.cause).toMatchObject({
          _tag: "GhidraAdmissionError",
          code: "platform_override",
        });
      },
    );

    it("rejects argument-file platform overrides before starting analysis", async () => {
      const root = await createTestTempDirectory("rea-ghidra-jdk-argfile-");
      const optionsFile = join(root, "platform.options");
      await writeFile(optionsFile, "-Dos.arch=rea_argfile_probe\n");
      const { session, launcher, analysisArguments, resources } = await fixture(
        `env-injection:JDK_JAVA_OPTIONS=@${optionsFile}`,
      );
      const launched = await launcher.launch(session, {
        resourceScope: resources,
      });
      expect(launched.ok).toBe(false);
      expect(analysisArguments).toEqual([]);
      if (launched.ok)
        throw new Error("Expected a JVM platform override failure");
      expect(launched.error.cause).toMatchObject({
        _tag: "GhidraAdmissionError",
        code: "platform_override",
      });
    });

    it("admits an argument file that does not override the platform", async () => {
      const root = await createTestTempDirectory("rea-ghidra-jdk-argfile-ok-");
      const optionsFile = join(root, "platform.options");
      await writeFile(optionsFile, "-Dfile.encoding=UTF8\n");
      const { session, launcher, analysisArguments, resources } = await fixture(
        `env-injection:JDK_JAVA_OPTIONS=@${optionsFile}`,
      );
      const launched = await launcher.launch(session, {
        resourceScope: resources,
      });
      if (!launched.ok) throw launched.error;
      expect(analysisArguments).toHaveLength(1);
    });

    it("rejects an unreadable argument file before starting analysis", async () => {
      const root = await createTestTempDirectory(
        "rea-ghidra-jdk-argfile-missing-",
      );
      const optionsFile = join(root, "missing.options");
      const { session, launcher, analysisArguments, resources } = await fixture(
        `env-injection:JDK_JAVA_OPTIONS=@${optionsFile}`,
      );
      const launched = await launcher.launch(session, {
        resourceScope: resources,
      });
      expect(launched.ok).toBe(false);
      expect(analysisArguments).toEqual([]);
      if (launched.ok)
        throw new Error("Expected an unreadable argument-file failure");
      expect(launched.error.cause).toMatchObject({
        _tag: "GhidraAdmissionError",
        code: "argument_file_unreadable",
        detail: { path: optionsFile },
      });
    });

    it("rejects nested argument-file references before starting analysis", async () => {
      const root = await createTestTempDirectory(
        "rea-ghidra-jdk-argfile-nested-",
      );
      const nested = join(root, "nested.options");
      const optionsFile = join(root, "platform.options");
      await writeFile(nested, "-Dfile.encoding=UTF8\n");
      await writeFile(optionsFile, `@${nested}\n`);
      const { session, launcher, analysisArguments, resources } = await fixture(
        `env-injection:JDK_JAVA_OPTIONS=@${optionsFile}`,
      );
      const launched = await launcher.launch(session, {
        resourceScope: resources,
      });
      expect(launched.ok).toBe(false);
      expect(analysisArguments).toEqual([]);
      if (launched.ok)
        throw new Error("Expected a nested argument-file failure");
      expect(launched.error.cause).toMatchObject({
        _tag: "GhidraAdmissionError",
        code: "nested_argument_file",
      });
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra argument-file admission",
  () => {
    it.each([false, true])(
      "keeps @ values literal after expansion was disabled by a file: %s",
      async (fromFile) => {
        const root = await createTestTempDirectory(
          "rea-ghidra-options-disabled-",
        );
        const path = join(root, "options.args"),
          missing = join(root, "literal-classpath");
        await writeFile(path, "--disable-@files\n");
        const value = `${fromFile ? `@${path}` : "--disable-@files"} --class-path @${missing}`;
        const { session, launcher, resources, analysisEnvironments } =
          await fixture(`env-injection:JDK_JAVA_OPTIONS=${value}`);
        const result = await launcher.launch(session, {
          resourceScope: resources,
        });
        if (!result.ok) throw result.error;
        expect(analysisEnvironments[0]?.JDK_JAVA_OPTIONS).toContain(missing);
        const snapshots = (await readdir(session.runtimeRoot)).filter((name) =>
          name.startsWith("rea-jdk-options-"),
        );
        expect(snapshots).toHaveLength(fromFile ? 1 : 0);
      },
    );

    it.each([100, 40000])(
      "counts repeated references within the cumulative byte budget: %s",
      async (size) => {
        const root = await createTestTempDirectory(
          "rea-ghidra-options-repeat-",
        );
        const path = join(root, "options.args");
        await writeFile(path, " ".repeat(size));
        const { session, launcher, resources, analysisArguments } =
          await fixture(`env-injection:JDK_JAVA_OPTIONS=@${path} @${path}`);
        const result = await launcher.launch(session, {
          resourceScope: resources,
        });
        expect(result.ok).toBe(size * 2 <= 65536);
        expect(analysisArguments).toHaveLength(result.ok ? 1 : 0);
        const snapshots = (await readdir(session.runtimeRoot)).filter((name) =>
          name.startsWith("rea-jdk-options-"),
        );
        expect(snapshots).toHaveLength(1);
      },
    );

    it.each([
      { label: "oversized", content: Buffer.alloc(65537, 32) },
      { label: "invalid UTF-8", content: Buffer.from([255]) },
    ])(
      "refuses $label input without starting analysis",
      async ({ content }) => {
        const root = await createTestTempDirectory(
          "rea-ghidra-options-admission-",
        );
        const path = join(root, "options.args");
        await writeFile(path, content);
        const { session, launcher, resources, analysisArguments } =
          await fixture(`env-injection:JDK_JAVA_OPTIONS=@${path}`);
        const result = await launcher.launch(session, {
          resourceScope: resources,
        });
        expect(result.ok).toBe(false);
        expect(analysisArguments).toEqual([]);
        expect(resources.hasPending).toBe(false);
      },
    );

    it("refuses a named pipe without blocking an owned file read", async () => {
      const root = await createTestTempDirectory("rea-ghidra-options-pipe-");
      const path = join(root, "options.args");
      await execFileOutput("mkfifo", [path], { maxBuffer: 1024 });
      const { session, launcher, resources, analysisArguments } = await fixture(
        `env-injection:JDK_JAVA_OPTIONS=@${path}`,
      );
      const result = await launcher.launch(session, {
        resourceScope: resources,
      });
      expect(result.ok).toBe(false);
      expect(analysisArguments).toEqual([]);
      expect(resources.hasPending).toBe(false);
    }, 5000);
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra argument-file ownership",
  () => {
    it("launches with admitted bytes rather than reopening a file changed by the next helper", async () => {
      const root = await createTestTempDirectory(
        "rea-ghidra-options-snapshot-",
      );
      const path = join(root, "options.args");
      const content = '-Dnote="retained\\"#literal"\n';
      await writeFile(path, content);
      const { session, launcher, resources, analysisEnvironments } =
        await fixture(`env-race:${path}`);
      const result = await launcher.launch(session, {
        resourceScope: resources,
      });
      if (!result.ok) throw result.error;
      expect(await readFile(path, "utf8")).toContain("changed_after_admission");
      expect(analysisEnvironments[0]?.JDK_JAVA_OPTIONS).not.toContain(path);
      const snapshots = (await readdir(session.runtimeRoot)).filter((name) =>
        name.startsWith("rea-jdk-options-"),
      );
      expect(snapshots).toHaveLength(1);
      expect(
        await readFile(join(session.runtimeRoot, snapshots[0]!), "utf8"),
      ).toBe(content);
    });

    it.each([false, true])(
      "retains the exact failed close owner alongside an invalid-read fact: %s",
      async (invalid) => {
        const root = await createTestTempDirectory("rea-ghidra-options-close-");
        const path = join(root, "options.args");
        await writeFile(
          path,
          invalid ? "-Dos.arch=invalid\n" : "-Dnote=valid\n",
        );
        const { session, launcher, resources, analysisArguments } =
          await fixture(`env-injection:JDK_JAVA_OPTIONS=@${path}`);
        const close = OwnedFileHandle.prototype.close;
        let denied: OwnedFileHandle | undefined;
        const calls: OwnedFileHandle[] = [];
        const spy = vi
          .spyOn(OwnedFileHandle.prototype, "close")
          .mockImplementation(async function (this: OwnedFileHandle) {
            calls.push(this);
            if (denied === undefined) {
              denied = this;
              throw new Error("controlled file close denial");
            }
            await close.call(this);
          });
        try {
          const result = await launcher.launch(session, {
            resourceScope: resources,
          });
          expect(result.ok).toBe(false);
          expect(analysisArguments).toEqual([]);
          expect(resources.hasPending).toBe(true);
          if (
            result.ok ||
            !(result.error.cause instanceof GhidraLaunchSupportError)
          )
            throw new Error("Expected a retained argument-file failure");
          const cleanup = result.error.cause.cause;
          if (!(cleanup instanceof ArtifactFileCleanupFailure))
            throw new Error("Expected the exact artifact file owner");
          expect(cleanup.fileCleanupFailure.owner).toBe(denied);
          expect(cleanup.fileCleanupFailure.outcome.kind).toBe(
            invalid ? "failed" : "completed",
          );
          if (cleanup.fileCleanupFailure.outcome.kind === "failed")
            expect(cleanup.fileCleanupFailure.outcome.cause).toMatchObject({
              _tag: "GhidraAdmissionError",
              code: "platform_override",
            });
          await resources.retryCleanup();
          expect(resources.hasPending).toBe(false);
          expect(calls).toEqual([denied, denied]);
        } finally {
          spy.mockRestore();
          await resources.close();
        }
      },
    );

    it("preserves an abort observed during final descriptor close", async () => {
      const root = await createTestTempDirectory(
        "rea-ghidra-options-late-abort-",
      );
      const path = join(root, "options.args");
      await writeFile(path, "-Dnote=valid\n");
      const { session, launcher, resources, analysisArguments, controller } =
        await fixture(`env-injection:JDK_JAVA_OPTIONS=@${path}`);
      const reason = { phase: "argument-file close" };
      const close = OwnedFileHandle.prototype.close;
      const spy = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockImplementation(async function (this: OwnedFileHandle) {
          await close.call(this);
          controller.abort(reason);
        });
      try {
        const result = await launcher.launch(session, {
          resourceScope: resources,
          signal: controller.signal,
        });
        expect(result.ok).toBe(false);
        if (result.ok || !(result.error instanceof GhidraLaunchError))
          throw new Error("Expected a typed launch cancellation");
        expect(result.error.primaryFailure).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(result.error.primaryFailure?.cause).toBe(reason);
        expect(analysisArguments).toEqual([]);
        expect(resources.hasPending).toBe(false);
      } finally {
        spy.mockRestore();
        await resources.close();
      }
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "Ghidra startup interruption diagnostics",
  () => {
    it.each(["cancelled", "timeout"] as const)(
      "preserves helper warnings through the provider-neutral %s projection",
      async (kind) => {
        const { session, launcher, controller } = await fixture(
          kind === "cancelled" ? "cancel-after-spawn" : "timeout-after-spawn",
        );
        const bytes = elf(2, 1, 62);
        await writeFile(session.targetPath, bytes);
        const target: BinaryTarget = {
          path: session.targetPath,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          kind: "executable",
          format: "elf",
          architecture: "x86_64",
          availableArchitectures: ["x86_64"],
        };
        const config = parseConfig({
          GHIDRA_INSTALL_DIR: "/fixture/ghidra",
          REA_GHIDRA_STARTUP_TIMEOUT_MS: "3000",
        });
        if (!config.ok) throw config.error;
        const provider = new GhidraProvider(
          config.value,
          silentLogger,
          {},
          {
            platform: process.platform,
            architecture: process.arch,
            readText: () =>
              "application.version=12.1.4\napplication.java.min=21\n",
            executable: () => true,
            probeJava: () =>
              javaProbeOk<GhidraJavaObservation>({
                osArch: process.arch === "arm64" ? "aarch64" : "amd64",
                osName:
                  process.platform === "darwin"
                    ? "Mac OS X"
                    : process.platform === "win32"
                      ? "Windows 11"
                      : "Linux",
                version: "21.0.12",
                major: 21,
                home: "/fixture/jdk",
                bits: 64,
                runtime: "jdk",
              }),
          },
          (options) => new GhidraClient({ ...options, launcher }),
        );
        const profile = await provider.resolveAnalysisProfile(target);
        if (!profile.ok) throw profile.error;
        if (profile.value.profile === null)
          throw new Error("Expected Ghidra profile");
        const client = provider.createClient(target, profile.value.profile);
        onTestFinished(async () => {
          expect((await client.close()).ok).toBe(true);
        });
        const result = await client.execute(
          "health",
          {},
          { signal: controller.signal },
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected interrupted startup");
        const projected = analysisErrorProjectionSchema.parse(
          JSON.parse(JSON.stringify(projectAnalysisError(result.error))),
        );
        expect(projected.code).toBe(
          kind === "cancelled" ? "cancelled" : "provider_timeout",
        );
        expect(projected).toMatchObject({
          details: {
            diagnostics: {
              failure_cause: {
                launch_support: expect.arrayContaining([
                  expect.objectContaining({
                    mode: "-envvars",
                    stderr: `-envvars: ${warning}\n`,
                  }),
                  expect.objectContaining({
                    mode: "-vmargs",
                    stderr: `-vmargs: ${warning}\n`,
                  }),
                ]),
              },
            },
          },
        });
      },
    );
  },
);

it.each([null, "caller stopped", new Error("caller stopped")] as const)(
  "retains the helper producer's exact %s cancellation reason",
  async (reason) => {
    const { ghidraJavaLaunch, GhidraLaunchSupportError } =
      await import("../../../../src/ghidra/GhidraJavaLaunch.js");
    const controller = new AbortController();
    controller.abort(reason);
    const failure: unknown = await ghidraJavaLaunch({
      platform: process.platform,
      analyzeHeadlessPath: "/unused-ghidra/support/analyzeHeadless",
      homeRoot: "/unused-runtime/home",
      tempRoot: "/unused-runtime/tmp",
      arguments: [],
      environment: {},
      signal: controller.signal,
      onStderr: () => {
        throw new Error("An aborted probe must not produce output");
      },
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GhidraLaunchSupportError);
    if (!(failure instanceof GhidraLaunchSupportError))
      throw new Error("Expected helper failure");
    expect(failure.cancellation?.reason).toBe(reason);
    expect(failure.outcome).toBeUndefined();
  },
);

it("does not infer helper cancellation from an arbitrary failure's display code", async () => {
  const { GhidraLaunchSupportError } =
    await import("../../../../src/ghidra/GhidraJavaLaunch.js");
  const cause = Object.assign(new Error("ordinary failure"), {
    code: "ABORT_ERR",
    stdout: "out",
    stderr: "err",
    killed: true,
    outputTruncated: true,
  });
  const failure = new GhidraLaunchSupportError("-envvars", cause);
  expect(failure.cancellation).toBeUndefined();
  expect(failure.outcome).toMatchObject({
    killed: true,
    outputTruncated: true,
    stdout: "out",
    stderr: "err",
  });
});
