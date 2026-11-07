import { Client } from "@modelcontextprotocol/client";
import { createPackageWithOptions } from "@electron/asar";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { writeJavaScriptSourceSelectionFixture } from "../../fixtures/javascriptSourceSelection.js";
import {
  asarHeaderBytes,
  prependAsarJsonWhitespace,
} from "../../fixtures/asarHeader.js";
import { createStrippedAsarAddon } from "../../fixtures/strippedAsarAddon.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const createSelectionClient = () => {
  const client = new Client({
    name: "javascript-source-selection",
    version: "1",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_OPTIONS: "--max-old-space-size=512 --max-semi-space-size=8",
      // Exact advertised constraints require the complete schema profile.
      REA_MCP_INPUT_SCHEMA_PROFILE: "full",
    },
    stderr: "pipe",
  });
  return { client, transport };
};

it("resolves ESM whitespace specifiers through the public application tool", async () => {
  const root = await createTestTempDirectory("rea-esm-whitespace-mcp-");
  const rawSpecifier = "./feature\tname.js";
  const encodedSpecifier = "./feature%09name.js";
  await writeFixtureFiles(root, {
    "main.mjs": `import ${JSON.stringify(rawSpecifier)};\nimport ${JSON.stringify(encodedSpecifier)};\n`,
    "featurename.js": "export const plain = 1;\n",
    "feature\tname.js": "export const value = 1;\n",
  });
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const output = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: root },
    });
    expect(output.isError, JSON.stringify(output.content)).not.toBe(true);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.structuredContent).normalized_result,
    );
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            specifier: rawSpecifier,
            resolved_path: "featurename.js",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            specifier: encodedSpecifier,
            resolved_path: "feature\tname.js",
          }),
        }),
      ]),
    );
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);

it("retains missing ASAR native-addon inventory through the public application tool", async () => {
  const { archive, addon } = await createStrippedAsarAddon();
  await rm(join(`${archive}.unpacked`, addon));
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const output = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: archive },
    });
    expect(output.isError, JSON.stringify(output.content)).not.toBe(true);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.structuredContent).normalized_result,
    );
    expect(result.graph.coverage.status).toBe("partial");
    expect(
      result.graph.nodes.some(
        (node) =>
          node.kind === "native-addon" &&
          node.observations.some(
            ({ label, properties }) =>
              label === addon && properties.availability === "unavailable",
          ),
      ),
    ).toBe(true);
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);

it("advertises exact source selection and retains its scope through summary, Evidence retrieval and invalid-input recovery", async () => {
  const root = await createTestTempDirectory("rea-js-selected-mcp-");
  await writeJavaScriptSourceSelectionFixture(root);
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const definition = tools.tools.find(
      ({ name }) => name === "analyze_javascript_application",
    );
    const schema = definition?.inputSchema;
    if (schema === undefined)
      throw new Error("Missing advertised application contract");
    expect(schema.properties?.source_paths).toBeDefined();
    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(schema);
    expect(validate({ input_path: root, source_paths: ["main.mjs"] })).toBe(
      true,
    );
    for (const source_paths of [[], [""], [1]])
      expect(validate({ input_path: root, source_paths })).toBe(false);
    const selected = await client.callTool({
      name: "analyze_javascript_application",
      arguments: {
        input_path: root,
        source_paths: ["main.mjs", "package.json"],
        detail: "summary",
      },
    });
    expect(selected.isError, JSON.stringify(selected.content)).not.toBe(true);
    if (definition?.outputSchema === undefined)
      throw new Error("Missing advertised application output contract");
    const validateOutput = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(
      z.record(z.string(), z.unknown()).parse(definition.outputSchema),
    );
    expect(
      validateOutput(selected.structuredContent),
      JSON.stringify(validateOutput.errors),
    ).toBe(true);
    const summary = z
      .object({
        normalized_result: z.object({
          parent_evidence_id: z.string(),
          summary: z.object({
            source_selection: z.object({
              requested_paths: z.array(z.string()),
              unselected_files: z.number(),
            }),
            coverage: z.object({
              application: z.object({ status: z.string() }),
            }),
          }),
        }),
      })
      .parse(selected.structuredContent).normalized_result;
    expect(summary.summary.source_selection).toEqual({
      requested_paths: ["main.mjs", "package.json"],
      unselected_files: 4,
    });
    expect(summary.summary.coverage.application.status).toBe("partial");
    const bundle = await client.callTool({
      name: "get_evidence_bundle",
      arguments: { detail: "complete" },
    });
    expect(bundle.isError).not.toBe(true);
    const retained = z
      .object({ result: z.object({ records: z.array(z.unknown()) }) })
      .parse(bundle.structuredContent)
      .result.records.map(parseEvidence)
      .find(({ evidence_id }) => evidence_id === summary.parent_evidence_id);
    expect(retained).toBeDefined();
    const result = javascriptApplicationAnalysisResultSchema.parse(
      retained!.normalized_result,
    );
    expect(result.statistics.parsed_javascript_files).toBe(1);
    expect(result.source_selection).toEqual(summary.summary.source_selection);
    expect(
      result.semantic_graph.nodes.some(
        ({ kind, label }) => kind === "function" && label === "selected",
      ),
    ).toBe(true);
    for (const source_paths of [
      ["missing.mjs"],
      ["./main.mjs"],
      ["../main.mjs"],
      ["*.mjs"],
    ]) {
      const invalid = await client.callTool({
        name: "analyze_javascript_application",
        arguments: { input_path: root, source_paths },
      });
      expect(invalid.isError).toBe(true);
      const text = invalid.content.find((item) => item.type === "text");
      if (text?.type !== "text")
        throw new Error("Missing source-selection correction");
      expect(JSON.parse(text.text)).toMatchObject({
        error: {
          code: "invalid_request",
          details: {
            issues: [{ path: ["source_paths", 0], reason: "invalid_value" }],
          },
        },
      });
      await client.ping();
    }
    const next = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: root, source_paths: ["main.mjs"] },
    });
    expect(next.isError).not.toBe(true);
    expect(
      javascriptApplicationAnalysisResultSchema.parse(
        parseEvidence(next.structuredContent).normalized_result,
      ).statistics.parsed_javascript_files,
    ).toBe(1);
    await client.ping();
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);

it("selects nested ASAR paths and distinguishes missing inventoried bytes from invalid paths", async () => {
  const root = await createTestTempDirectory("rea-js-selected-containers-");
  await writeJavaScriptSourceSelectionFixture(root);
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const nestedRoot = await createTestTempDirectory(
      "rea-js-nested-selection-",
    );
    const nestedArchive = join(nestedRoot, "nested.asar");
    await createPackageWithOptions(root, nestedArchive, {});
    await prependAsarJsonWhitespace(nestedArchive, " \t\r\n".repeat(3_001));
    const nested = await client.callTool({
      name: "analyze_javascript_application",
      arguments: {
        input_path: nestedRoot,
        source_paths: ["nested.asar/main.mjs"],
      },
    });
    expect(nested.isError).not.toBe(true);
    const nestedResult = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(nested.structuredContent).normalized_result,
    );
    expect(nestedResult.source_selection).toEqual({
      requested_paths: ["nested.asar/main.mjs"],
      unselected_files: 5,
    });
    expect(nestedResult.statistics).toMatchObject({
      nested_asar_containers: 1,
      parsed_javascript_files: 1,
      parse_failures: 0,
    });
    expect(
      nestedResult.semantic_graph.nodes.some(
        ({ identity, kind, label }) =>
          identity.module_path === "nested.asar/main.mjs" &&
          kind === "function" &&
          label === "selected",
      ),
    ).toBe(true);
    const unpacked = join(
      await createTestTempDirectory("rea-js-unavailable-selection-"),
      "app.asar",
    );
    await createPackageWithOptions(root, unpacked, { unpack: "main.mjs" });
    await rm(join(unpacked + ".unpacked", "main.mjs"));
    const unavailable = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: unpacked, source_paths: ["main.mjs"] },
    });
    expect(unavailable.isError).toBe(true);
    const unavailableText = unavailable.content.find(
      (item) => item.type === "text",
    );
    if (unavailableText?.type !== "text")
      throw new Error("Missing selected-source availability reason");
    expect(JSON.parse(unavailableText.text)).toMatchObject({
      error: {
        code: "artifact_operation_failed",
        details: { reason: "unavailable" },
      },
    });
    await client.ping();
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);

it("accepts ASAR headers with long legal JSON whitespace through the public application tool", async () => {
  const root = await createTestTempDirectory("rea-js-asar-whitespace-mcp-");
  await writeJavaScriptSourceSelectionFixture(root);
  const archive = join(
    await createTestTempDirectory("rea-js-asar-whitespace-mcp-output-"),
    "app.asar",
  );
  await createPackageWithOptions(root, archive, {});
  await prependAsarJsonWhitespace(archive, `${" ".repeat(9_001)}\r\n\t`);
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const output = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: archive, source_paths: ["main.mjs"] },
    });
    expect(output.isError, JSON.stringify(output.content)).not.toBe(true);
    const result = javascriptApplicationAnalysisResultSchema.parse(
      parseEvidence(output.structuredContent).normalized_result,
    );
    expect(result.statistics).toMatchObject({
      nested_asar_containers: 0,
      parsed_javascript_files: 1,
      parse_failures: 0,
    });
    expect(
      result.semantic_graph.nodes.some(
        ({ kind, label }) => kind === "function" && label === "selected",
      ),
    ).toBe(true);
    expect(result.root_artifact_sha256).toBe(
      createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    );
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);

it("does not parse ASAR-looking JSON beyond the declared JSON extent through MCP", async () => {
  const archive = join(
    await createTestTempDirectory("rea-js-asar-padding-mcp-"),
    "opaque.asar",
  );
  await writeFile(
    archive,
    asarHeaderBytes("  ", {
      padding: Buffer.from('{"files":{"main.mjs":{"size":0,"offset":"0"}}}'),
    }),
  );
  const { client, transport } = createSelectionClient();
  try {
    await client.connect(transport);
    const output = await client.callTool({
      name: "analyze_javascript_application",
      arguments: { input_path: archive },
    });
    expect(output.isError).toBe(true);
    const message = output.content.find((item) => item.type === "text");
    if (message?.type !== "text")
      throw new Error("Missing invalid ASAR response");
    expect(JSON.parse(message.text)).toMatchObject({
      error: {
        code: "artifact_operation_failed",
        details: { reason: "format" },
      },
    });
    await client.ping();
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
    ]);
  }
}, 60_000);
