import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  CAPTURE_SKIP_REASON,
  itWithCaptureCapability,
} from "../../boundary/process/processCaptureCapability.js";

const literal = "SYNTHETIC_PRIVATE_STDIN_720F";
const scenarioFor = (root: string) => ({
  executable: process.execPath,
  arguments: [
    fileURLToPath(
      new URL("../../fixtures/processSensitiveEcho.mjs", import.meta.url),
    ),
  ],
  working_directory: root,
  terminal: { columns: 120, rows: 8, scrollback: 20 },
  events: [
    { type: "input", at_ms: 350, data: `${literal}\r`, sensitive: true },
  ],
  timeout_ms: 3000,
  idle_timeout_ms: 3000,
  limits: { output_bytes: 16384, processes: 16 },
});
const verify = (document: unknown) => {
  expect(JSON.stringify(document)).not.toContain(literal);
  expect(JSON.stringify(document)).not.toContain(literal.slice(0, 13));
  const evidence = parseEvidence(document);
  const capture = parseProcessCapture(evidence.normalized_result);
  expect(capture.frames.map(({ data }) => data).join("")).toContain(
    "PUBLIC_TAIL",
  );
  expect(capture.interaction_events[0]).toMatchObject({
    outcome: "dispatched",
    data: "",
    sensitive: true,
    input_bytes: Buffer.byteLength(`${literal}\r`),
  });
  expect(capture.rendered_frames.length).toBeGreaterThan(0);
  expect(
    capture.truncation_details.raw_terminal.redacted_bytes,
  ).toBeGreaterThan(0);
  expect(capture.cleanup).toMatchObject({
    owned_process_group: "verified",
    temporary_root: "removed",
  });
};

cliTest.skipIf(CAPTURE_SKIP_REASON)(
  "withholds private stdin echoes in public CLI Evidence",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-private-cli-");
    const path = join(root, "scenario.json");
    await writeFile(path, JSON.stringify(scenarioFor(root)));
    const result = await cli.run({
      arguments: ["capture-process", path, "--format", "json"],
      environment: process.env,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).not.toContain(literal);
    verify(result.json);
  },
  30_000,
);

itWithCaptureCapability(
  "withholds private stdin echoes in advertised MCP Evidence",
  async () => {
    const root = await createTestTempDirectory("rea-private-mcp-");
    const { call } = await connectLocalToolsMcp();
    const result = await call("capture_process_scenario", scenarioFor(root));
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain(literal);
    verify(
      toolContract("capture_process_scenario").outputSchema.parse(
        result.structuredContent,
      ),
    );
  },
  30_000,
);
