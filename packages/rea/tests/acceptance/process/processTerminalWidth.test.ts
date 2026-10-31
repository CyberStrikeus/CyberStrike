import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { CAPTURE_SKIP_REASON } from "../../boundary/process/processCaptureCapability.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "rejects one-column capture and resize before starting the target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-process-width-");
    const marker = join(root, "launched");
    const base = {
      executable: process.execPath,
      arguments: [
        "-e",
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started')`,
      ],
      terminal: { columns: 2, rows: 2, scrollback: 0 },
    };
    const scenarios = [
      { ...base, terminal: { ...base.terminal, columns: 1 } },
      { ...base, events: [{ type: "resize", at_ms: 0, columns: 1, rows: 2 }] },
    ];
    const { client, call } = await connectLocalToolsMcp();
    const definition = (await client.listTools()).tools.find(
      ({ name }) => name === "capture_process_scenario",
    );
    expect(definition).toBeDefined();
    const validate = new Ajv2020({ strict: false }).compile(
      definition!.inputSchema,
    );
    for (const [index, scenario] of scenarios.entries()) {
      expect(validate(scenario)).toBe(false);
      expect((await call("capture_process_scenario", scenario)).isError).toBe(
        true,
      );
      const path = join(root, `scenario-${String(index)}.json`);
      await writeFile(path, JSON.stringify(scenario));
      const result = await cli.run({
        arguments: ["capture-process", path, "--json"],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({ code: "invalid_request" });
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(validate(base)).toBe(true);
  },
);

cliTest.skipIf(CAPTURE_SKIP_REASON)(
  "retains the requested initial two-column screen",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-process-width-control-");
    const path = join(root, "scenario.json");
    await writeFile(
      path,
      JSON.stringify({
        executable: process.execPath,
        arguments: ["-e", "process.stdout.write('ab');setTimeout(()=>{}, 100)"],
        terminal: { columns: 2, rows: 2, scrollback: 0 },
        timeout_ms: 5_000,
      }),
    );
    const result = await cli.run({
      arguments: ["capture-process", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = parseProcessCapture(
      parseEvidence(result.json).normalized_result,
    );
    expect(capture.rendered_frames.length).toBeGreaterThan(0);
    expect(capture.rendered_frames.every((frame) => frame.columns === 2)).toBe(
      true,
    );
  },
);

cliTest.skipIf(CAPTURE_SKIP_REASON)(
  "resizes a wider screen to two columns",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-process-width-resize-");
    const path = join(root, "scenario.json");
    await writeFile(
      path,
      JSON.stringify({
        executable: process.execPath,
        arguments: [
          "-e",
          `
            const keepAlive = setInterval(() => {}, 1000);
            const resized = () => {
              if (process.stdout.columns === 2) {
                clearInterval(keepAlive);
                process.stdout.write('ab');
              }
            };
            process.stdout.on('resize', resized);
            resized();
          `,
        ],
        terminal: { columns: 3, rows: 2, scrollback: 0 },
        events: [{ type: "resize", at_ms: 1_000, columns: 2, rows: 2 }],
        timeout_ms: 5_000,
      }),
    );
    const result = await cli.run({
      arguments: ["capture-process", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = parseProcessCapture(
      parseEvidence(result.json).normalized_result,
    );
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(capture.rendered_frames.some((frame) => frame.columns === 2)).toBe(
      true,
    );
  },
);
