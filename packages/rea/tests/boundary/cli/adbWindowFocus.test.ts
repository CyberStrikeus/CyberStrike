import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";

import { AdbProvider } from "../../../src/adb/AdbProvider.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

for (const { serial, section, focused, missing } of [
  { serial: "null-device", section: "windows", focused: false, missing: false },
  {
    serial: "fallback-null-device",
    section: "displays",
    focused: false,
    missing: false,
  },
  {
    serial: "focused-device",
    section: "windows",
    focused: true,
    missing: false,
  },
  {
    serial: "missing-device",
    section: "displays",
    focused: false,
    missing: true,
  },
]) {
  cliTest.skipIf(process.platform === "win32")(
    `preserves focus presence through CLI and MCP: ${serial}`,
    async ({ cli }) => {
      const root = await createTestTempDirectory("rea-adb-window-focus-");
      const binary = join(root, "adb");
      await writeFile(
        binary,
        `#!/bin/sh
if [ "$1" = version ]; then
  printf 'Android Debug Bridge version 1.0.41\\nVersion 34.0.5-fixture\\nInstalled as %s\\n' "$0"
  exit 0
fi
if [ "$1" = -s ] && [ "$3" = shell ] && [ "$4" = dumpsys ] && [ "$5" = window ]; then
  printf '%s\\n' "$6" >> "$0.calls"
  if [ "$2" = missing-device ]; then printf 'no focus declarations\\n'; exit 0; fi
  if [ "$2" = fallback-null-device ] && [ "$6" = windows ]; then printf 'no focus declarations\\n'; exit 0; fi
  if [ "$2" = focused-device ]; then
    printf '  mCurrentFocus=Window{current}\\n  mFocusedApp=ActivityRecord{current}\\n'
  else
    printf '  mCurrentFocus=null\\n  mFocusedApp=null\\n'
  fi
  exit 0
fi
exit 1
`,
        { mode: 0o755 },
      );
      const output = await cli.run({
        arguments: ["inspect-adb-window", serial, "--json"],
        environment: { REA_ADB_PATH: binary },
      });
      expect(output.exitCode).toBe(0);
      const provider = new AdbProvider({
        environment: { REA_ADB_PATH: binary },
      });
      const harness = await createApplicationMcpHarness({
        serverOptions: { adbDeviceAnalysis: provider },
      });
      onTestFinished(() => harness.close());
      const schemas = await advertisedMcpToolSchemas(
        harness.client,
        "inspect_adb_window",
      );
      const args = { serial };
      expect(schemas.ajv.validate(schemas.inputSchema, args)).toBe(true);
      const response = await harness.client.callTool(
        { name: schemas.name, arguments: args },
        { toolDefinition: schemas.toolDefinition },
      );
      expect(response.isError).not.toBe(true);
      expect(
        schemas.ajv.validate(schemas.outputSchema, response.structuredContent),
      ).toBe(true);
      for (const raw of [output.json, response.structuredContent]) {
        const evidence = parseEvidence(
          toolContract("inspect_adb_window").outputSchema.parse(raw),
        );
        expect(evidence.normalized_result).toMatchObject({
          focused_window: focused ? "Window{current}" : null,
          focused_app: focused ? "ActivityRecord{current}" : null,
          observed_lines: missing
            ? []
            : [
                `  mCurrentFocus=${focused ? "Window{current}" : "null"}`,
                `  mFocusedApp=${focused ? "ActivityRecord{current}" : "null"}`,
              ],
        });
        expect(evidence.limitations).toContainEqual(
          missing
            ? expect.stringContaining("focus is unknown, not absent")
            : `Focus declarations were read from \`dumpsys window ${section}\``,
        );
      }
      const sections =
        section === "windows" ? ["windows"] : ["windows", "displays"];
      expect(
        (await readFile(`${binary}.calls`, "utf8")).trim().split("\n"),
      ).toEqual([...sections, ...sections]);
    },
  );
}
