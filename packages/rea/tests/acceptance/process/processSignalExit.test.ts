import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  CAPTURE_SKIP_REASON,
  itWithCaptureCapability as captureTest,
} from "../../boundary/process/processCaptureCapability.js";

const hang = ["-e", "setTimeout(() => {}, 5000)"];
const cliCaptureTest = cliTest.skipIf(CAPTURE_SKIP_REASON);

cliCaptureTest(
  "records no normal exit code for a target a scenario signal terminated",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-process-signal-exit-");
    for (const [name, additions, expected] of [
      [
        "SIGKILL",
        { events: [{ type: "signal", at_ms: 200, signal: "SIGKILL" }] },
        { code: null, signal: 9, reason: "exited" },
      ],
      [
        "SIGTERM",
        { events: [{ type: "signal", at_ms: 200, signal: "SIGTERM" }] },
        { code: null, signal: 15, reason: "exited" },
      ],
      [
        "exit 3",
        { arguments: ["-e", "process.exit(3)"] },
        { code: 3, signal: 0, reason: "exited" },
      ],
      [
        "exit 0",
        { arguments: ["-e", "process.exit(0)"] },
        { code: 0, signal: 0, reason: "exited" },
      ],
      ["deadline", { timeout_ms: 300 }, { code: null, reason: "timeout" }],
    ] as const) {
      const scenarioPath = join(root, `${name.replace(" ", "-")}.json`);
      await writeFile(
        scenarioPath,
        JSON.stringify({
          executable: process.execPath,
          arguments: hang,
          timeout_ms: 5_000,
          settle_ms: 300,
          ...additions,
        }),
      );
      const result = await cli.run({
        arguments: ["capture-process", scenarioPath, "--format", "json"],
        environment: process.env,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.signal, result.stderr).toBeNull();
      const capture = parseProcessCapture(
        parseEvidence(result.json).normalized_result,
      );
      expect(capture.exit, name).toMatchObject(expected);
    }
  },
  60_000,
);

captureTest(
  "records no normal exit code for a signal-terminated target through MCP",
  async () => {
    const { call } = await connectLocalToolsMcp();
    const response = await call("capture_process_scenario", {
      executable: process.execPath,
      arguments: hang,
      timeout_ms: 5_000,
      settle_ms: 300,
      events: [{ type: "signal", at_ms: 200, signal: "SIGKILL" }],
    });
    expect(response.isError).not.toBe(true);
    const capture = parseProcessCapture(
      parseEvidence(
        toolContract("capture_process_scenario").outputSchema.parse(
          response.structuredContent,
        ),
      ).normalized_result,
    );
    expect(capture.exit).toMatchObject({
      code: null,
      signal: 9,
      reason: "exited",
    });
  },
  30_000,
);
