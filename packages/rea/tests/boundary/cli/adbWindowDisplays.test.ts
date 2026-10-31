import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const inactive =
  "  Display: mDisplayId=3 rootTasks=0\n  mCurrentFocus=null\n  mFocusedApp=null\n";
const active =
  "  Display: mDisplayId=0 rootTasks=12\n  mCurrentFocus=Window{active}\n  mFocusedApp=ActivityRecord{active}\n";
for (const { serial, capture, ids } of [
  { serial: "inactive-first", capture: inactive + active, ids: ["3", "0"] },
  { serial: "active-first", capture: active + inactive, ids: ["0", "3"] },
  { serial: "active-only", capture: active, ids: ["0"] },
]) {
  cliTest.skipIf(process.platform === "win32")(
    `retains display-scoped focus through CLI and MCP: ${serial}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-adb-display-focus-");
      const binary = join(root, "fake-adb.mjs");
      await writeFile(
        binary,
        `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture');
} else if (args[0] === '-s' && args[1] === ${JSON.stringify(serial)} && args[2] === 'shell' && args[3] === 'dumpsys' && args[4] === 'window') {
  appendFileSync(process.argv[1] + '.calls', args[5] + '\\n');
  process.stdout.write(args[5] === 'windows' ? 'no focus declarations\\n' : ${JSON.stringify(capture)});
} else process.exitCode = 9;
`,
        { mode: 0o700 },
      );
      const environment = {
        REA_ADB_PATH: binary,
        HOME: root,
        TMPDIR: root,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      };
      const output = await cli.run({
        arguments: ["inspect-adb-window", serial, "--json"],
        environment,
      });
      expect(output.exitCode).toBe(0);
      expect(output.stderr).toBe("");
      const harness = await createApplicationMcpHarness({
        serverOptions: { adbDeviceAnalysis: new AdbProvider({ environment }) },
      });
      onTestFinished(() => harness.close());
      const schemas = await advertisedMcpToolSchemas(
        harness.client,
        "inspect_adb_window",
      );
      const response = await harness.client.callTool(
        { name: schemas.name, arguments: { serial } },
        { toolDefinition: schemas.toolDefinition },
      );
      expect(response.isError).not.toBe(true);
      expect(
        schemas.ajv.validate(schemas.outputSchema, response.structuredContent),
      ).toBe(true);
      for (const raw of [output.json, response.structuredContent]) {
        const evidence = parseEvidence(raw);
        expect(evidence.normalized_result).toMatchObject({
          serial,
          source_section: "displays",
          focus_summary: ids.length === 1 ? "single_context" : "ambiguous",
          focused_window: ids.length === 1 ? "Window{active}" : null,
          focused_app: ids.length === 1 ? "ActivityRecord{active}" : null,
          observed_lines: capture.trimEnd().split("\n"),
          focus_contexts: ids.map((id) => ({
            scope: "display",
            display_id: id,
            declarations: [
              {
                field: "mCurrentFocus",
                value: id === "0" ? "Window{active}" : null,
              },
              {
                field: "mFocusedApp",
                value: id === "0" ? "ActivityRecord{active}" : null,
              },
            ],
          })),
        });
        if (ids.length > 1)
          expect(evidence.limitations).toContainEqual(
            expect.stringContaining("prevent a singular focus summary"),
          );
      }
      expect(
        (await readFile(binary + ".calls", "utf8")).trim().split("\n"),
      ).toEqual(["windows", "displays", "windows", "displays"]);
    },
  );
}
