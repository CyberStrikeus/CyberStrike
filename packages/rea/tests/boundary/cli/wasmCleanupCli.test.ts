import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const canDenyCleanup = process.platform !== "win32" && process.getuid?.() !== 0;

cliTest.runIf(canDenyCleanup)(
  "retains wasm evidence and primary diagnostics when real scratch cleanup is denied",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-wasm-cleanup-cli-");
    const tools = join(directory, "tools");
    const artifact = join(directory, "module.wasm");
    const locked = join(directory, "locked-paths.txt");
    await mkdir(tools);
    const wasm = Buffer.from(
      "0061736d01000000010401600000020b0103656e7603666f6f0000030201000503010001071002066d656d6f727902000372756e00010a0601040001010b000c04746573747061796c6f6164",
      "hex",
    );
    expect(wasm).toHaveLength(76);
    await writeFile(artifact, wasm);
    execFileSync(process.execPath, [
      "-e",
      "WebAssembly.compile(require('node:fs').readFileSync(process.argv[1])).catch(() => { process.exitCode = 1; });",
      artifact,
    ]);
    const objdump = fileURLToPath(
      new URL("../../fixtures/wasm/objdump.txt", import.meta.url),
    );
    const makeTool = async (name: string, body: string) => {
      const path = join(tools, name);
      await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
      await chmod(path, 0o700);
    };
    const deny = `mkdir denied\nprintf '%s\\n' "$PWD/denied" >> "$REA_LOCKED_PATHS"\nprintf marker > denied/marker\nchmod 000 denied`;
    await makeTool(
      "wasm-validate",
      `if [ "$1" = "--version" ]; then echo '1.0.42'; exit 0; fi\nif [ "$REA_PRIMARY_FAILURE" = "1" ]; then ${deny}\n  echo 'fixture validation rejected' >&2\n  exit 1\nfi\nexit 0`,
    );
    await makeTool(
      "wasm-objdump",
      `if [ "$1" = "--version" ]; then echo '1.0.42'; exit 0; fi\ncat "$REA_FIXTURE_OBJDUMP"`,
    );
    await makeTool(
      "wasm2wat",
      `if [ "$1" = "--version" ]; then echo '1.0.42'; exit 0; fi\nif [ "$REA_DENY_CLEANUP" = "1" ]; then ${deny}; fi\nprintf '%s\\n' '(module (@custom "test" "payload"))'`,
    );

    const environment = {
      ...process.env,
      REA_WABT_BIN_DIRECTORY: tools,
      REA_FIXTURE_OBJDUMP: objdump,
      REA_LOCKED_PATHS: locked,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    };
    const invoke = (extra: NodeJS.ProcessEnv = {}) =>
      cli.run({
        arguments: ["inspect-wasm-artifact", artifact, "--format", "json"],
        environment: {
          ...environment,
          ...extra,
        },
      });
    const restoreDeniedDirectories = async () => {
      let paths: string[] = [];
      try {
        paths = (await readFile(locked, "utf8")).trim().split("\n");
      } catch (cause: unknown) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          return;
        throw cause;
      }
      for (const path of paths) await chmod(path, 0o700);
    };

    try {
      const controlInvocation = await invoke();
      expect(controlInvocation.exitCode, controlInvocation.stderr).toBe(0);
      expect(controlInvocation.signal).toBeNull();
      const control = parseEvidence(controlInvocation.json);
      expect(control.normalized_result).toMatchObject({ validation: "valid" });

      const completedThenCleanupFailsInvocation = await invoke({
        REA_DENY_CLEANUP: "1",
      });
      expect(
        completedThenCleanupFailsInvocation.exitCode,
        completedThenCleanupFailsInvocation.stderr,
      ).toBe(1);
      expect(completedThenCleanupFailsInvocation.signal).toBeNull();
      const completedThenCleanupFails = analysisErrorProjectionSchema.parse(
        completedThenCleanupFailsInvocation.json,
      );
      expect(completedThenCleanupFails).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          cleanup: "incomplete",
          partial_observation: {
            normalized_result: { validation: "valid" },
          },
        },
      });

      await restoreDeniedDirectories();
      await writeFile(locked, "");
      const primaryAndCleanupFailInvocation = await invoke({
        REA_PRIMARY_FAILURE: "1",
      });
      expect(
        primaryAndCleanupFailInvocation.exitCode,
        primaryAndCleanupFailInvocation.stderr,
      ).toBe(1);
      expect(primaryAndCleanupFailInvocation.signal).toBeNull();
      const primaryAndCleanupFail = analysisErrorProjectionSchema.parse(
        primaryAndCleanupFailInvocation.json,
      );
      expect(primaryAndCleanupFail).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          execution_failure: "invalid_request",
          diagnostics: {
            primary_error: { code: "cleanup_incomplete" },
            cleanup_error: { code: "cleanup_incomplete" },
          },
        },
      });
      expect(JSON.stringify(primaryAndCleanupFail.details)).toContain(
        "fixture validation rejected",
      );
    } finally {
      await restoreDeniedDirectories();
    }
  },
);
