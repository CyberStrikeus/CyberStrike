import { copyFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect } from "vitest";

import { workspaceCliTest } from "../../support/cli/workspaceCliFixture.js";
import type { TestWorkspace } from "../../support/workspace/workspaceFixture.js";

const CLI_OUTPUT_RUNTIME =
  "export const cliConfigurationError = () => undefined; export const parseCliOutputArguments = () => ({ validation: { ok: true } }); export const renderCliOutputArgumentError = () => ''; export const renderEmptyFilteredCliOutput = () => undefined; export const renderVersionReport = () => undefined;\n";

const installCliRuntime = async (
  workspace: TestWorkspace,
  cliSource: string,
  resultOutput = "export const createCliResultOutput = () => undefined;\n",
): Promise<void> => {
  await workspace.mkdir("scripts/lib");
  await workspace.mkdir("dist");
  // The bundle's entrypoints and shared chunks form one emitted runtime.
  await cp("dist/cli-runtime", workspace.path("dist/cli-runtime"), {
    recursive: true,
  });
  await Promise.all([
    copyFile("scripts/rea.mjs", workspace.path("scripts/rea.mjs")),
    copyFile(
      "scripts/lib/cli-process-environment.mjs",
      workspace.path("scripts/lib/cli-process-environment.mjs"),
    ),
    workspace.write(
      "package.json",
      JSON.stringify({ type: "module", version: "1.0.0" }),
    ),
    workspace.write("dist/cli-runtime/cli.js", cliSource),
    workspace.write("dist/cli-runtime/cliOutput.js", CLI_OUTPUT_RUNTIME),
    workspace.write("dist/cli-runtime/cliResultOutput.js", resultOutput),
  ]);
};

describe("version report dispatch", () => {
  workspaceCliTest(
    "reports formatted versions without loading analysis commands and preserves preflight errors",
    async ({ processes, workspace }) => {
      const blocked =
        'throw new Error("analysis command runtime was loaded");\n';
      await installCliRuntime(workspace, blocked, blocked);
      await workspace.write(
        "package.json",
        JSON.stringify({
          type: "module",
          name: "rea-fixture",
          version: "1.0.0",
        }),
      );
      // Use the built production preflight, while making full CLI imports fail.
      await workspace.write(
        "dist/cli-runtime/cliOutput.js",
        `export * from ${JSON.stringify(pathToFileURL(resolve("dist/cli-runtime/cliOutput.js")).href)};\n`,
      );
      const invoke = (arguments_: readonly string[], invalidLogLevel = false) =>
        processes.run(
          process.execPath,
          [workspace.path("scripts/rea.mjs"), ...arguments_],
          {
            cwd: workspace.root,
            env: {
              ...process.env,
              REA_LOG_LEVEL: invalidLogLevel ? "invalid-level" : "silent",
            },
          },
        );

      const report = await invoke(["--version", "--json"]);
      expect(report.exitCode, report.stderr).toBe(0);
      expect(JSON.parse(report.stdout)).toMatchObject({
        name: "rea-fixture",
        version: "1.0.0",
        runtime: { id: "node", version: process.versions.node },
      });
      const invalidOutput = await invoke([
        "--version",
        "--json",
        "--token-limit",
        "5",
      ]);
      expect(invalidOutput.exitCode, invalidOutput.stderr).toBe(1);
      expect(JSON.parse(invalidOutput.stdout)).toMatchObject({
        error: { code: "UNSUPPORTED_OUTPUT_COMBINATION" },
      });
      const invalidConfiguration = await invoke(["--version", "--json"], true);
      expect(invalidConfiguration.exitCode).toBe(1);
      expect(invalidConfiguration.stdout).toBe("");
      expect(invalidConfiguration.stderr).toContain("REA_LOG_LEVEL");
      expect(invalidConfiguration.stderr).not.toContain(
        "analysis command runtime was loaded",
      );
    },
  );
});

describe("doctor configuration dispatch", () => {
  workspaceCliTest(
    "exempts only the production root doctor tokens from invalid logging configuration",
    async ({ processes, workspace }) => {
      const imported = "CLI command runtime imported";
      await installCliRuntime(
        workspace,
        `process.stderr.write(${JSON.stringify(`${imported}\n`)}); export const closeCliResources = () => {}; export const createCli = () => ({ serve: (args, options) => options.stdout(JSON.stringify({ adapter: "cli", args })) });\n`,
      );
      // Both token ownership and output/configuration admission use production code.
      await workspace.write(
        "dist/cli-runtime/cliOutput.js",
        `export * from ${JSON.stringify(pathToFileURL(resolve("dist/cli-runtime/cliOutput.js")).href)};\n`,
      );
      const invoke = (args: readonly string[], completion = "") =>
        processes.run(
          process.execPath,
          [workspace.path("scripts/rea.mjs"), ...args],
          {
            cwd: workspace.root,
            env: {
              ...process.env,
              REA_LOG_LEVEL: "invalid-level",
              COMPLETE: completion,
            },
          },
        );

      for (const [args, normalized] of [
        [["doctor"], ["doctor"]],
        [
          ["--json", "doctor"],
          ["--json", "doctor"],
        ],
        [
          ["--format=json", "doctor"],
          ["--format", "json", "doctor"],
        ],
        [
          ["--filter-output", "healthy", "doctor"],
          ["--filter-output", "healthy", "doctor"],
        ],
        [
          ["--token-limit", "10", "doctor"],
          ["--token-limit", "10", "doctor"],
        ],
        [
          ["--token-offset", "1", "doctor"],
          ["--token-offset", "1", "doctor"],
        ],
      ] as const) {
        const result = await invoke(args);
        expect(
          result.exitCode,
          `${JSON.stringify(args)}: ${result.stderr}`,
        ).toBe(0);
        expect(result.stderr).toBe(`${imported}\n`);
        expect(JSON.parse(result.stdout)).toEqual({
          adapter: "cli",
          args: normalized,
        });
      }

      for (const args of [
        ["--filter-output", "doctor", "providers"],
        ["providers", "doctor"],
        ["--format", "", "doctor"],
        ["--filter-output", "", "doctor"],
        ["--token-limit", "", "doctor"],
        ["--token-offset", "", "doctor"],
        ["--unknown", "doctor"],
        ["--version", "doctor"],
        ["--", "doctor"],
      ]) {
        const result = await invoke(args);
        expect(result.exitCode, JSON.stringify(args)).toBe(1);
        expect(result.stdout, JSON.stringify(args)).toBe("");
        expect(result.stderr, JSON.stringify(args)).toContain("REA_LOG_LEVEL");
        expect(result.stderr, JSON.stringify(args)).not.toContain(imported);
      }

      const completion = await invoke(["doctor"], "bash");
      expect(completion.exitCode).toBe(1);
      expect(completion.stdout).toBe("");
      expect(completion.stderr).toContain("REA_LOG_LEVEL");
      expect(completion.stderr).not.toContain(imported);
    },
  );
});

describe("executable dispatcher", () => {
  workspaceCliTest(
    "does not append recovery output after delegated stdout has begun",
    async ({ processes, workspace }) => {
      await installCliRuntime(
        workspace,
        'export const closeCliResources = () => {}; export const createCli = () => ({ serve: (_args, options) => { options.stdout("first document\\n"); throw new RangeError("Invalid string length"); } });\n',
        'export const createCliResultOutput = () => ({ handled: false, failed: false, captureSdkOutput: () => false, finishSdkOutput: async () => {}, recoverFormattingFailure: () => { process.stdout.write("unexpected second document"); return true; } });\n',
      );
      const result = await processes.run(
        process.execPath,
        [workspace.path("scripts/rea.mjs"), "fixture"],
        { cwd: workspace.root },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("first document\n");
      expect(result.stderr).toContain("RangeError: Invalid string length");
    },
  );

  workspaceCliTest(
    "reserves production MCP routing for bare mode arguments",
    async ({ processes, workspace }) => {
      await installCliRuntime(
        workspace,
        'export const closeCliResources = () => {}; export const createCli = () => ({ serve: (args) => process.stdout.write(JSON.stringify({ adapter: "cli", args })) });\n',
      );
      const scripts = workspace.path("scripts");
      await workspace.mkdir("dist/mcp");
      await Promise.all([
        workspace.write(
          "dist/mcp/main.js",
          'export const runEntrypoint = () => process.stdout.write(JSON.stringify({ adapter: "mcp" })); export const runMcpHttpEntrypoint = (args) => process.stdout.write(JSON.stringify({ adapter: "mcp-http", args }));\n',
        ),
        workspace.write(
          "dist/cli-runtime/mcpDoctor.js",
          'export const runProductionMcpDoctorCli = (args, input) => Promise.resolve({ output: JSON.stringify({ adapter: "mcp-doctor", args, stdoutIsTerminal: input.stdoutIsTerminal }), exitCode: 0 });\n',
        ),
      ]);

      const invoke = async (args: readonly string[]): Promise<unknown> => {
        const { exitCode, stdout } = await processes.run(
          process.execPath,
          [join(scripts, "rea.mjs"), ...args],
          { cwd: workspace.root },
        );
        expect(exitCode).toBe(0);
        return JSON.parse(stdout) as unknown;
      };

      await expect(invoke(["mcp"])).resolves.toEqual({ adapter: "mcp" });
      await expect(invoke(["--mcp"])).resolves.toEqual({ adapter: "mcp" });
      for (const args of [
        ["mcp", "doctor", "--json"],
        ["--json", "mcp", "doctor"],
        ["mcp", "--json", "doctor"],
        ["--format", "json", "mcp", "doctor"],
        ["mcp", "--format=json", "doctor"],
      ]) {
        await expect(invoke(args)).resolves.toEqual({
          adapter: "mcp-doctor",
          args: args.includes("--json") ? ["--json"] : ["--format", "json"],
          stdoutIsTerminal: false,
        });
      }
      await expect(
        invoke(["--filter-output", "mcp", "doctor"]),
      ).resolves.toEqual({
        adapter: "cli",
        args: ["--filter-output", "mcp", "doctor"],
      });
      await expect(invoke(["mcp", "add"])).resolves.toEqual({
        adapter: "cli",
        args: ["mcp", "add"],
      });
      await expect(invoke(["--mcp", "extra"])).resolves.toEqual({
        adapter: "cli",
        args: ["--mcp", "extra"],
      });
      for (const args of [
        ["mcp", "--http", "--port", "0"],
        ["--mcp", "--http"],
        ["mcp", "-h", "--http"],
        ["mcp", "--host", "127.0.0.1", "--http"],
      ])
        await expect(invoke(args)).resolves.toEqual({
          adapter: "mcp-http",
          args: args.slice(1),
        });
      await expect(invoke(["mcp", "doctor", "--http"])).resolves.toEqual({
        adapter: "mcp-doctor",
        args: ["--http"],
        stdoutIsTerminal: false,
      });
      await expect(invoke(["mcp", "add", "--http"])).resolves.toEqual({
        adapter: "cli",
        args: ["mcp", "add", "--http"],
      });
    },
  );

  workspaceCliTest(
    "explains how to restore a missing compiled runtime",
    async ({ processes, workspace }) => {
      const scripts = await workspace.mkdir("scripts");
      await workspace.mkdir("scripts/lib");
      await Promise.all([
        copyFile("scripts/rea.mjs", join(scripts, "rea.mjs")),
        copyFile(
          "scripts/lib/cli-process-environment.mjs",
          workspace.path("scripts/lib/cli-process-environment.mjs"),
        ),
        workspace.write(
          "package.json",
          JSON.stringify({ type: "module", version: "1.0.0" }),
        ),
      ]);

      for (const args of [["mcp"], ["mcp", "doctor"], ["--help"]]) {
        const result = await processes.run(
          process.execPath,
          [join(scripts, "rea.mjs"), ...args],
          { cwd: workspace.root },
        );
        expect(result).toMatchObject({
          exitCode: 1,
          stderr: expect.stringContaining(
            "REA's compiled runtime is missing. Run `npm ci && npm run build:cached` in",
          ),
        });
        expect(result.stderr).toContain(
          "If this is an installed package, reinstall rea-agents.",
        );
        expect(result).toMatchObject({
          stderr: expect.not.stringContaining("ERR_MODULE_NOT_FOUND"),
        });
      }
    },
  );
});

describe("executable dispatcher JavaScript shutdown", () => {
  workspaceCliTest.for([false, true])(
    "handles a thrown pipe error while preserving mixed cleanup failure: %s",
    async (cleanupFails, { processes, workspace }) => {
      await installCliRuntime(
        workspace,
        `export const closeCliResources = async () => { ${cleanupFails ? 'throw new Error("worker still owned");' : ""} }; export const createCli = () => ({ serve: () => { throw Object.assign(new Error("broken pipe"), { code: "EPIPE" }); } });\n`,
      );
      const result = await processes.run(
        process.execPath,
        [workspace.path("scripts/rea.mjs"), "fixture"],
        { cwd: workspace.root },
      );
      expect(result.exitCode).toBe(cleanupFails ? 1 : 141);
      expect(result.stdout).toBe("");
      if (cleanupFails) {
        expect(result.stderr).toContain("broken pipe");
        expect(result.stderr).toContain("worker still owned");
      } else expect(result.stderr).toBe("");
    },
  );

  workspaceCliTest.for([
    "success",
    "cleanup-failure",
    "write-failure",
    "closed-pipe",
  ] as const)(
    "awaits SDK output after cleanup and retains finalization status: %s",
    async (scenario, { processes, workspace }) => {
      const cleanupFails = scenario === "cleanup-failure";
      const finish =
        scenario === "closed-pipe"
          ? 'process.stdout.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })); throw new Error("broken pipe");'
          : scenario === "write-failure"
            ? 'throw new Error("final write failed");'
            : 'process.stdout.write("complete document\\n");';
      await installCliRuntime(
        workspace,
        `export const closeCliResources = () => { globalThis.cleaned = true; ${cleanupFails ? 'return Promise.reject(new Error("worker still owned"));' : ""} }; export const createCli = () => ({ serve: (_args, options) => { options.stdout("pending document"); options.exit(0); } });\n`,
        `export const createCliResultOutput = () => ({ handled: false, failed: false, captureSdkOutput: () => true, finishSdkOutput: async () => { if (!globalThis.cleaned) throw new Error("output preceded cleanup"); await new Promise(resolve => setTimeout(resolve, 10)); ${finish} } });\n`,
      );
      const result = await processes.run(
        process.execPath,
        [workspace.path("scripts/rea.mjs"), "fixture"],
        { cwd: workspace.root },
      );
      expect(result.exitCode).toBe(
        scenario === "closed-pipe" ? 141 : scenario === "success" ? 0 : 1,
      );
      expect(result.stdout).toBe(
        scenario === "success" || cleanupFails ? "complete document\n" : "",
      );
      expect(result.stderr).not.toContain("output preceded cleanup");
      if (cleanupFails) expect(result.stderr).toContain("worker still owned");
      if (scenario === "write-failure")
        expect(result.stderr).toContain("final write failed");
      if (scenario === "closed-pipe") expect(result.stderr).toBe("");
    },
  );

  workspaceCliTest(
    "reports a failed JavaScript worker shutdown instead of exiting successfully",
    async ({ processes, workspace }) => {
      await installCliRuntime(
        workspace,
        'export const closeCliResources = () => Promise.reject(new Error("worker still owned")); export const createCli = () => ({ serve: (_args, options) => { options.exit(0); } });\n',
      );
      const result = await processes.run(
        process.execPath,
        [workspace.path("scripts/rea.mjs"), "fixture"],
        { cwd: workspace.root },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("worker still owned");
    },
  );

  workspaceCliTest(
    "keeps the closed-pipe status when JavaScript worker shutdown fails",
    async ({ processes, workspace }) => {
      await installCliRuntime(
        workspace,
        'export const closeCliResources = () => Promise.reject(new Error("worker still owned")); export const createCli = () => ({ serve: (_args, options) => { process.stdout.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })); options.exit(0); } });\n',
      );
      const result = await processes.run(
        process.execPath,
        [workspace.path("scripts/rea.mjs"), "fixture"],
        { cwd: workspace.root },
      );
      expect(result.exitCode).toBe(141);
      expect(result.stderr).toContain("worker still owned");
    },
  );
});
