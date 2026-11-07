import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "vitest";
import { elf, thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import {
  observeOwnedProcessGroups,
  systemProcessOwnershipHost,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { resolveExecutable } from "../../../src/process/capture/ProcessScenarioRuntimeValidation.js";

cliTest.skipIf(!["darwin", "linux"].includes(process.platform)).for([
  ["missing", "missing_dependency", "runtime_missing"],
  ["nonzero", "runtime_failure", "runtime_unavailable"],
  ["properties", "config_drift", "version_unresolved"],
] as const)(
  "preserves the %s Java prerequisite result through doctor",
  async ([failure, classification, code], { cli }) => {
    const root = await createTestTempDirectory("rea-java-doctor-");
    const jdk = join(root, "jdk");
    const install = join(root, "ghidra");
    const platform = process.platform === "darwin" ? "mac" : "linux";
    const architecture = process.arch === "arm64" ? "arm_64" : "x86_64";
    const native = join(
      install,
      "Ghidra/Features/Decompiler/os",
      `${platform}_${architecture}`,
      "decompile",
    );
    for (const path of [
      join(jdk, "bin"),
      join(install, "support"),
      join(install, "Ghidra"),
      join(native, ".."),
    ])
      await mkdir(path, { recursive: true });
    await writeFile(
      join(install, "Ghidra/application.properties"),
      "application.version=12.1.4\napplication.java.min=21\n",
    );
    await writeFile(
      join(install, "support/analyzeHeadless"),
      "#!/bin/sh\nexit 99\n",
    );
    await chmod(join(install, "support/analyzeHeadless"), 0o700);
    await writeFile(
      native,
      process.platform === "darwin"
        ? thinMach(
            0xfeedfacf,
            process.arch === "arm64" ? 0x0100000c : 0x01000007,
          )
        : elf(2, 1, process.arch === "arm64" ? 183 : 62),
    );
    await chmod(native, 0o700);
    if (failure !== "missing") {
      const body =
        failure === "nonzero"
          ? 'process.stderr.write("controlled runtime failure\\n"); process.exit(7);'
          : `process.stdout.write(${JSON.stringify(`java.home = ${jdk}\nos.arch = aarch64\n`)});`;
      await writeFile(
        join(jdk, "bin/java"),
        `#!${process.execPath}\n${body}\n`,
      );
      await chmod(join(jdk, "bin/java"), 0o700);
    }
    const result = await cli.run({
      arguments: ["doctor", "--provider", "ghidra", "--json"],
      environment: {
        JAVA_HOME: jdk,
        GHIDRA_INSTALL_DIR: install,
        REA_LOG_LEVEL: "silent",
      },
    });
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.json).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "ghidra-java",
          classification,
          ok: false,
        }),
      ]),
      providerInspections: expect.arrayContaining([
        expect.objectContaining({
          id: "ghidra",
          checks: expect.arrayContaining([
            expect.objectContaining({ name: "java", code }),
          ]),
        }),
      ]),
    });
    if (failure === "nonzero")
      expect(result.json).toMatchObject({
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "ghidra-java",
            detail: expect.stringContaining("Java exited 7"),
            details: expect.objectContaining({
              output: expect.objectContaining({
                stderr: "controlled runtime failure\n",
                exit_code: 7,
                stderr_bytes: 27,
              }),
            }),
          }),
        ]),
      });
    if (failure === "properties")
      expect(result.json).toMatchObject({
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "ghidra-java",
            details: expect.objectContaining({
              properties: expect.objectContaining({ home: jdk, version: null }),
            }),
          }),
        ]),
      });
  },
);

cliTest.skipIf(!["darwin", "linux"].includes(process.platform))(
  "doctor returns its own deadline result for a SIGTERM-resistant selected Java command",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-java-doctor-deadline-");
    const jdk = join(root, "jdk");
    const install = join(root, "ghidra");
    const started = join(root, "java-started.json");
    const release = join(root, "release-java");
    await mkdir(join(jdk, "bin"), { recursive: true });
    await mkdir(join(install, "Ghidra"), { recursive: true });
    await writeFile(
      join(install, "Ghidra/application.properties"),
      "application.version=12.1.4\napplication.java.min=21\n",
    );
    await writeFile(
      join(jdk, "bin/java"),
      `#!${process.execPath}
const fs = require("node:fs");
process.on("SIGTERM", () => {});
fs.writeFileSync(${JSON.stringify(`${started}.tmp`)}, JSON.stringify({ pid: process.pid, runId: process.env.REA_PROCESS_RUN_ID }));
fs.renameSync(${JSON.stringify(`${started}.tmp`)}, ${JSON.stringify(started)});
setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0); }, 50);
setTimeout(() => process.exit(92), 12000);
`,
      { mode: 0o700 },
    );
    const pending = cli.run({
      arguments: ["doctor", "--provider", "ghidra", "--json"],
      environment: {
        JAVA_HOME: jdk,
        GHIDRA_INSTALL_DIR: install,
        REA_LOG_LEVEL: "silent",
      },
      timeoutMs: 15000,
    });
    // Capture the actual group while the selected process is alive; the PID
    // alone is never used as cleanup authority. Release is a private protocol.
    let identity: { pid: number; runId: string } | undefined;
    let processGroupId: number | undefined;
    try {
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          identity = JSON.parse(
            await readFile(started, "utf8"),
          ) as typeof identity;
        } catch (cause: unknown) {
          if (
            !(
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ENOENT"
            )
          )
            throw cause;
        }
        if (identity !== undefined) break;
        await delay(50);
      }
      if (identity === undefined)
        throw new Error("Selected Java command did not start");
      expect(identity.runId).toEqual(expect.any(String));
      processGroupId = (await systemProcessOwnershipHost.listProcesses()).find(
        (entry) => entry.pid === identity?.pid,
      )?.processGroupId;
      expect(processGroupId).toBeDefined();
      const result = await pending;
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.json).toMatchObject({
        providerInspections: expect.arrayContaining([
          expect.objectContaining({
            id: "ghidra",
            checks: expect.arrayContaining([
              expect.objectContaining({
                name: "java",
                code: "runtime_unavailable",
                details: expect.objectContaining({
                  process_error_code: "ETIMEDOUT",
                }),
              }),
            ]),
          }),
        ]),
      });
      if (processGroupId !== undefined) {
        const observed = await observeOwnedProcessGroups(identity.runId, [
          processGroupId,
        ]);
        expect(observed.get(processGroupId)).toEqual({ state: "empty" });
      }
    } finally {
      await writeFile(release, "release");
      await pending;
      if (identity !== undefined && processGroupId !== undefined) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const observed = await observeOwnedProcessGroups(identity.runId, [
            processGroupId,
          ]);
          if (observed.get(processGroupId)?.state === "empty") break;
          await delay(50);
        }
        const observed = await observeOwnedProcessGroups(identity.runId, [
          processGroupId,
        ]);
        expect(observed.get(processGroupId)).toEqual({ state: "empty" });
      }
    }
  },
);

cliTest.skipIf(!["darwin", "linux"].includes(process.platform))(
  "doctor discovers Ghidra through an empty PATH component without executing its launchers",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ghidra-cwd-doctor-");
    const install = join(root, "installation");
    const marker = join(root, "launcher-execution");
    const bin = join(root, "bin");
    await mkdir(bin);
    const hostPath = process.env.PATH?.split(delimiter)
      .filter((directory) => isAbsolute(directory))
      .join(delimiter);
    await symlink(
      await resolveExecutable("ps", process.cwd(), hostPath),
      join(bin, "ps"),
    );
    await mkdir(join(install, "Ghidra"), { recursive: true });
    await mkdir(join(install, "support"), { recursive: true });
    await writeFile(
      join(install, "Ghidra/application.properties"),
      "application.version=12.1.4\napplication.java.min=21\n",
    );
    await writeFile(marker, "unexecuted");
    const launcher = `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`;
    for (const name of ["ghidraRun", "support/analyzeHeadless"])
      await writeFile(join(install, name), launcher, { mode: 0o700 });
    await symlink(join(install, "ghidraRun"), join(root, "ghidra"));

    const result = await cli.run({
      arguments: ["doctor", "--provider", "ghidra", "--json"],
      cwd: root,
      environment: {
        // Keep CWD discovery first while admitting only the ownership prerequisite.
        PATH: ["", bin].join(delimiter),
        JAVA_HOME: join(root, "missing-jdk"),
        REA_LOG_LEVEL: "silent",
      },
    });
    // The fixture deliberately has no JDK or native decompiler. Discovery must
    // retain the selected installation while reporting those later failures.
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.json).toMatchObject({
      providerInspections: expect.arrayContaining([
        expect.objectContaining({
          id: "ghidra",
          configured: true,
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: "configuration",
              ok: true,
              code: null,
              detail: install,
            }),
            expect.objectContaining({ name: "installation", ok: true }),
            expect.objectContaining({ name: "headless", ok: true }),
          ]),
        }),
      ]),
    });
    expect(await readFile(marker, "utf8")).toBe("unexecuted");
  },
);
