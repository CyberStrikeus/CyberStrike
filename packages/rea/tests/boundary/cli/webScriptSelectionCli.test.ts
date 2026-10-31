import { access, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import pino from "pino";
import { expect, it, vi } from "vitest";

import { registerWebScriptCommands } from "../../../src/cli/webScriptCommands.js";
import * as webScriptExport from "../../../src/application/WebScriptExportService.js";
import { CLI_COMMANDS } from "../../../src/cliCommandNames.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok } from "../../../src/domain/result.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  scriptCaptureEvidenceFixture,
  scriptScenarioFixture,
} from "../../fixtures/webScriptCapture.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const registeredExportCommand = () => {
  const commands = new Map<string, { run(input: unknown): Promise<unknown> }>();
  const cli = {
    command: (
      name: string,
      definition: { run(input: unknown): Promise<unknown> },
    ) => {
      commands.set(name, definition);
      return cli;
    },
  } as unknown as Parameters<typeof registerWebScriptCommands>[0];
  registerWebScriptCommands(cli, pino({ enabled: false }));
  return commands.get(CLI_COMMANDS.exportWebScripts)!;
};

it("forwards an interrupt into the export workflow and reports cancellation", async () => {
  const command = registeredExportCommand();
  const exported = vi
    .spyOn(webScriptExport, "exportWebScripts")
    .mockImplementation(async (_input, _resources, options) => {
      process.emit("SIGINT");
      return err(
        new AnalysisCancelledError("export_web_scripts", {
          cause: options?.signal?.reason,
        }),
      );
    });
  const previousExitCode = process.exitCode;
  try {
    const output = await command.run({
      args: {
        capturePath: "/unused/capture.json",
        outputDirectory: "/unused/out",
      },
    });
    expect(exported.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(output).toMatchObject({ code: "cancelled" });
    expect(process.exitCode).toBe(130);
  } finally {
    exported.mockRestore();
    process.exitCode = previousExitCode;
  }
});

it.each(["cleanup failure", "cancellation during cleanup"] as const)(
  "retains exported Evidence on %s",
  async (outcome) => {
    const command = registeredExportCommand();
    const evidence = scriptCaptureEvidenceFixture();
    const exported = vi
      .spyOn(webScriptExport, "exportWebScripts")
      .mockResolvedValue(ok(evidence));
    const close = vi
      .spyOn(ArtifactResourceScope.prototype, "close")
      .mockImplementation(async () => {
        if (outcome === "cleanup failure") throw new Error("close denied");
        process.emit("SIGINT");
      });
    const previousExitCode = process.exitCode;
    try {
      const output = await command.run({
        args: {
          capturePath: "/unused/capture.json",
          outputDirectory: "/unused/out",
        },
      });
      expect(close).toHaveBeenCalledOnce();
      expect(output).toMatchObject({
        error: "Script export failed",
        code:
          outcome === "cleanup failure" ? "cleanup_incomplete" : "cancelled",
        details: { partial_observation: evidence },
      });
    } finally {
      exported.mockRestore();
      close.mockRestore();
      process.exitCode = previousExitCode;
    }
  },
);

it("closes export resources when the operation throws", async () => {
  const command = registeredExportCommand();
  const exported = vi
    .spyOn(webScriptExport, "exportWebScripts")
    .mockRejectedValue(new Error("unexpected export failure"));
  const close = vi
    .spyOn(ArtifactResourceScope.prototype, "close")
    .mockResolvedValue();
  try {
    const output = await command.run({
      args: {
        capturePath: "/unused/capture.json",
        outputDirectory: "/unused/out",
      },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(output).toMatchObject({
      error: "Script export failed",
      details: { operation: "export_web_scripts" },
    });
  } finally {
    exported.mockRestore();
    close.mockRestore();
  }
});

cliTest.skipIf(process.platform === "win32")(
  "exits with a capture_path invalid_request for a named pipe before publishing output",
  async ({ cli, processes }) => {
    const root = await createTestTempDirectory("rea-script-selection-cli-");
    const capturePath = join(root, "capture.pipe");
    const outputDirectory = join(root, "export");
    const created = await processes.run("mkfifo", [capturePath], {
      timeoutMs: 5_000,
    });
    expect(created.exitCode).toBe(0);

    const response = await cli.run({
      arguments: ["export-web-scripts", capturePath, outputDirectory, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
      timeoutMs: 5_000,
    });
    expect(response.exitCode).toBe(1);
    expect(response.signal).toBeNull();
    expect(response.json).toMatchObject({
      error: "Script export failed",
      code: "invalid_request",
      details: {
        operation: "export_web_scripts",
        issues: [
          {
            path: ["capture_path"],
            reason: "invalid_value",
            message: expect.stringContaining("regular file"),
          },
        ],
      },
    });
    expect(response.stdout).toContain(capturePath);
    await expect(access(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

cliTest(
  "refuses an existing output directory or link as invalid output_directory input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-script-export-existing-");
    const capturePath = join(root, "capture.json");
    await writeFile(capturePath, JSON.stringify(scriptScenarioFixture()));
    const retained = join(root, "retained");
    await mkdir(retained);
    await writeFile(join(retained, "marker.txt"), "keep");
    const link = join(root, "output-link");
    await symlink(
      retained,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    for (const outputDirectory of [retained, link]) {
      const response = await cli.run({
        arguments: [
          "export-web-scripts",
          capturePath,
          outputDirectory,
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode).toBe(1);
      expect(response.json).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        recovery: {
          kind: "inspect_input_contract",
          operation: "export_web_scripts",
        },
        details: {
          operation: "export_web_scripts",
          issues: [
            {
              path: ["output_directory"],
              reason: "invalid_value",
              message: "Output root already exists",
            },
          ],
        },
      });
    }
    expect(await readdir(retained)).toEqual(["marker.txt"]);
  },
);
