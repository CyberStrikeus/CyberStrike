import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const { verdict, exit, succeeds } of [
  { verdict: "Success", exit: 0, succeeds: true },
  { verdict: "Failure [not installed for 0]", exit: 0, succeeds: false },
  { verdict: "Failure [not installed for 0]", exit: 1, succeeds: false },
]) {
  cliTest.skipIf(process.platform === "win32")(
    `selects user 0 through CLI and MCP for ${verdict}, exit ${String(exit)}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-adb-uninstall-scope-");
      const binary = join(root, "fake-adb.mjs");
      await writeFile(
        binary,
        `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.argv[1] + '.calls', JSON.stringify(args) + '\\n');
if (args.length === 1 && args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture');
} else {
  console.log(${JSON.stringify(verdict)});
  process.exitCode = ${String(exit)};
}
`,
        { mode: 0o700 },
      );
      const environment = {
        REA_ADB_PATH: binary,
        HOME: root,
        TMPDIR: root,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      };
      const input = { serial: "emulator-5554", package: "com.example.app" };
      const output = await cli.run({
        arguments: [
          "uninstall-adb-package",
          input.serial,
          input.package,
          "--json",
        ],
        environment,
      });
      expect(output.exitCode).toBe(succeeds ? 0 : 1);
      expect(output.stderr).toBe("");
      const harness = await createApplicationMcpHarness({
        serverOptions: { adbDeviceAnalysis: new AdbProvider({ environment }) },
      });
      onTestFinished(() => harness.close());
      const schemas = await advertisedMcpToolSchemas(
        harness.client,
        "uninstall_adb_package",
      );
      const response = await harness.client.callTool(
        { name: schemas.name, arguments: input },
        { toolDefinition: schemas.toolDefinition },
      );
      if (succeeds) {
        const evidence = parseEvidence(output.json);
        expect(evidence.normalized_result).toMatchObject({
          serial: input.serial,
          package_name: input.package,
        });
        expect(evidence.limitations).toContain(
          "Uninstall explicitly requests user 0 without data retention (-k); device enforcement is not independently verified",
        );
        expect(response.isError).not.toBe(true);
        expect(
          schemas.ajv.validate(
            schemas.outputSchema,
            response.structuredContent,
          ),
        ).toBe(true);
        const mcpEvidence = parseEvidence(response.structuredContent);
        expect(mcpEvidence.parameters).toEqual(evidence.parameters);
        expect(mcpEvidence.normalized_result).toEqual(
          evidence.normalized_result,
        );
        expect(mcpEvidence.limitations).toEqual(evidence.limitations);
      } else {
        expect(output.json).toMatchObject({
          code: "unsupported_target",
          details: { reason: "not installed for 0" },
        });
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "unsupported_target",
          details: { reason: "not installed for 0" },
        });
      }
      const calls = (await readFile(binary + ".calls", "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const scoped = [
        "-s",
        input.serial,
        "shell",
        "pm",
        "uninstall",
        "--user",
        "0",
        input.package,
      ];
      expect(calls).toEqual([["version"], scoped, ["version"], scoped]);
    },
  );
}
