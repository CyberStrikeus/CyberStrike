import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { createCli } from "../../src/cli.js";
import * as composition from "../../src/composition/binaryDiagnostics.js";
import { BinaryLayoutService } from "../../src/application/binaryDiagnostics/BinaryLayoutService.js";
import { RecordedCrashService } from "../../src/application/binaryDiagnostics/RecordedCrashService.js";
import { PwntoolsLayoutProvider } from "../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { PwntoolsRecordedCrashProvider } from "../../src/native/pwntools/PwntoolsRecordedCrashProvider.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../support/workspace/workspaceFixture.js";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
const architecture = Object.getOwnPropertyDescriptor(process, "arch");
const exitCode = process.exitCode;

beforeEach(() => {
  // Exercise configuration admission on this host without starting Python.
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
});
afterEach(() => {
  if (platform !== undefined)
    Object.defineProperty(process, "platform", platform);
  if (architecture !== undefined)
    Object.defineProperty(process, "arch", architecture);
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});

it
  .skipIf(process.platform === "win32")
  .each(["inspect-binary-layout", "inspect-recorded-crash"] as const)(
  "reports actionable configuration failures through %s",
  async (command) => {
    const workspace = await createTestWorkspace("rea-pwntools-remediation-");
    onTestFinished(() => removeTestWorkspace(workspace.root));
    const nonExecutable = workspace.path("python-no-execute");
    await writeFile(nonExecutable, "not executable", { mode: 0o600 });
    const missing = workspace.path("missing-python");
    const configurations = [
      {
        environment: {},
        message: "Set REA_PWNTOOLS_PYTHON",
        key: "REA_PWNTOOLS_PYTHON",
      },
      {
        environment: { REA_PWNTOOLS_PYTHON: workspace.root },
        message: "not a directory",
        key: "REA_PWNTOOLS_PYTHON",
      },
      {
        environment: { REA_PWNTOOLS_PYTHON: missing },
        message: "ENOENT",
        key: "REA_PWNTOOLS_PYTHON",
      },
      {
        environment: { REA_PWNTOOLS_PYTHON: nonExecutable },
        message: "EACCES",
        key: "REA_PWNTOOLS_PYTHON",
      },
      {
        environment: {
          REA_PWNTOOLS_PYTHON: process.execPath,
          REA_PWNTOOLS_MAX_INPUT_BYTES: "0",
        },
        message: "REA_PWNTOOLS_MAX_INPUT_BYTES",
        key: "REA_PWNTOOLS_MAX_INPUT_BYTES",
      },
    ];
    for (const { environment, message, key } of configurations) {
      if (command === "inspect-binary-layout")
        vi.spyOn(composition, "createBinaryLayoutService").mockReturnValue(
          new BinaryLayoutService(new PwntoolsLayoutProvider(environment)),
        );
      else
        vi.spyOn(composition, "createRecordedCrashService").mockReturnValue(
          new RecordedCrashService(
            new PwntoolsRecordedCrashProvider(environment),
          ),
        );
      let stdout = "";
      process.exitCode = 0;
      await createCli({}).serve(
        [command, workspace.path("selected.elf"), "--json"],
        {
          env: {},
          stdout: (text) => {
            stdout += text;
          },
          exit: () => undefined,
        },
      );
      const output: unknown = JSON.parse(stdout);
      expect(output).toMatchObject({
        code: "provider_unavailable",
        message: expect.stringContaining(message),
        remediation: { action: expect.stringContaining(message) },
        details: {
          requested_provider_id: "pwntools-elf",
          rejections: [
            {
              reason: expect.stringContaining(message),
              diagnostics: { configuration_key: key },
            },
          ],
        },
      });
      expect(stdout).not.toContain("rea doctor");
      expect(process.exitCode).toBe(1);
    }
  },
);
