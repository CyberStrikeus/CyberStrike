import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { silentLogger } from "../../../src/logger.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerWebScriptTool } from "../../../src/server/registerWebScriptTool.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { readWithoutFifoWriter } from "../../fixtures/fifoInput.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { scriptScenarioFixture } from "../../fixtures/webScriptCapture.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { webScriptExportResultSchema } from "../../../src/domain/webScriptExport.js";

it.skipIf(process.platform === "win32")(
  "returns a capture_path invalid_request for a named pipe without waiting or publishing output",
  async () => {
    const root = await createTestTempDirectory("rea-script-selection-mcp-");
    const capturePath = join(root, "capture.pipe");
    const outputDirectory = join(root, "export");
    await promisify(execFile)("mkfifo", [capturePath]);

    const server = new EvidenceMcpServer(
      { name: "script-selection", version: "1" },
      {},
      undefined,
      createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    );
    const artifactResources = new ArtifactResourceScope();
    registerWebScriptTool(server, {
      logger: silentLogger,
      recordEvidence: undefined,
      artifactResources: artifactResources,
    });
    const mcp = createTestMcp();
    onTestFinished(() =>
      closeVerifierResources([
        () => mcp.close(),
        () => artifactResources.close(),
      ]),
    );
    const client = await mcp.connect(server, {
      name: "script-selection-test",
      version: "1",
    });

    const outcome = await readWithoutFifoWriter(capturePath, () =>
      client.callTool({
        name: "export_web_scripts",
        arguments: {
          capture_path: capturePath,
          output_directory: outputDirectory,
        },
      }),
    );
    expect(outcome.state).toBe("completed");
    if (outcome.state !== "completed")
      throw new Error("MCP capture selection waited for a FIFO writer");
    expect(parseMcpToolError(outcome.result)).toMatchObject({
      error: {
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
      },
    });
    expect(JSON.stringify(outcome.result)).toContain(capturePath);
    await expect(access(outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("refuses an existing output directory as invalid output_directory input", async () => {
  const root = await createTestTempDirectory("rea-script-export-existing-mcp-");
  const capturePath = join(root, "capture.json");
  await writeFile(capturePath, JSON.stringify(scriptScenarioFixture()));
  const outputDirectory = join(root, "retained");
  await mkdir(outputDirectory);
  await writeFile(join(outputDirectory, "marker.txt"), "keep");
  const server = new EvidenceMcpServer(
    { name: "script-export-existing", version: "1" },
    {},
    undefined,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  const artifactResources = new ArtifactResourceScope();
  registerWebScriptTool(server, {
    logger: silentLogger,
    recordEvidence: undefined,
    artifactResources,
  });
  const mcp = createTestMcp();
  onTestFinished(() =>
    closeVerifierResources([
      () => mcp.close(),
      () => artifactResources.close(),
    ]),
  );
  const client = await mcp.connect(server, {
    name: "script-export-existing",
    version: "1",
  });

  const result = await client.callTool({
    name: "export_web_scripts",
    arguments: { capture_path: capturePath, output_directory: outputDirectory },
  });
  expect(parseMcpToolError(result).error).toMatchObject({
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
  expect(await readdir(outputDirectory)).toEqual(["marker.txt"]);
});

it("publishes script bytes and retains the returned Evidence without starting an analysis provider", async () => {
  const root = await createTestTempDirectory("rea-script-export-retained-mcp-");
  const capturePath = join(root, "capture.json");
  const outputDirectory = join(root, "export");
  const bytes = Buffer.from("export const callerValue = 'retained';\n");
  await writeFile(
    capturePath,
    JSON.stringify(
      scriptScenarioFixture([
        { url: "https://caller.test/app/main.js", bytes },
      ]),
    ),
  );
  const session = createTestBinarySession(() => {
    throw new Error("local script export must not start an analysis provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "script-export-retention", version: "1" },
  });
  const response = await client.callTool({
    name: "export_web_scripts",
    arguments: { capture_path: capturePath, output_directory: outputDirectory },
  });
  expect(response.isError).not.toBe(true);
  const evidence = parseEvidence(response.structuredContent);
  expect(evidence.operation).toBe("export_web_scripts");
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
  expect(session.exportEvidenceBundle().records).toEqual([evidence]);
  const exported = webScriptExportResultSchema.parse(
    evidence.normalized_result,
  );
  expect(exported.output_directory).toBe(outputDirectory);
  expect(exported.scripts).toHaveLength(1);
  const content = exported.scripts[0]?.content;
  expect(content?.state).toBe("exported");
  if (content?.state !== "exported")
    throw new Error("script bytes were not published");
  if (exported.analysis_input === null)
    throw new Error("published script bytes have no analysis input root");
  expect(
    Buffer.compare(
      await readFile(
        join(exported.analysis_input.input_path, content.relative_path),
      ),
      bytes,
    ),
  ).toBe(0);
  expect(
    JSON.parse(await readFile(exported.manifest.path, "utf8")),
  ).toMatchObject({
    capture_path: capturePath,
    output_directory: outputDirectory,
    scripts: exported.scripts,
  });
});
