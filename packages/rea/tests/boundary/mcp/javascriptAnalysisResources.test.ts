import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { recoveryInstructions } from "../../../src/server/recoveryInstructions.js";
import { UNTRUSTED_CONTENT_INSTRUCTIONS } from "../../../src/server/toolResultEncoding.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { retainedEvidenceReferenceSchema } from "../../../src/domain/evidenceReference.js";

it("delivers deadline recovery guidance at initialization before any tool call", async () => {
  const { client, transport } = createResourceClient();
  try {
    await client.connect(transport);
    // Verify delivery from the owning contracts, not a second copy of their prose.
    // Recovery behavior is exercised below and in analysisSettingsMcp.test.ts;
    // these assertions do not claim that an agent follows the guidance.
    const instructions = client.getInstructions();
    expect(instructions).toContain(recoveryInstructions(true));
    expect(instructions).toContain(UNTRUSTED_CONTENT_INSTRUCTIONS);
    const catalog = await client.listTools();
    const analysis = catalog.tools.find(
      (tool) => tool.name === "analyze_javascript_application",
    );
    expect(analysis?.description).toBe(
      toolContract("analyze_javascript_application").description,
    );
  } finally {
    await client.close();
    await transport.close();
  }
});

it("accepts more work after application expansion exceeds memory and retains every static finding", async () => {
  const root = await createTestTempDirectory("rea-js-resource-boundary-");
  const nextRoot = await createTestTempDirectory("rea-js-resource-recovery-");
  await writeFile(join(nextRoot, "main.js"), "export const recovered = 9;\n");
  const source = Array.from(
    { length: 4000 },
    (_, index) =>
      `import { observed as binding${String(index)} } from "./target.js";`,
  ).join("\n");
  const path = join(root, "main.js");
  await writeFile(path, source);
  await writeFile(join(root, "target.js"), "export const observed = 7;\n");
  const digest = createHash("sha256").update(source).digest("hex");
  const { client, transport, diagnostics } = createResourceClient();
  try {
    await client.connect(transport);
    const response = await client.callTool(
      {
        name: "analyze_javascript_application",
        arguments: {
          input_path: root,
          format: "directory",
          max_heap_mb: 128,
          detail: "summary",
        },
      },
      { timeout: 60000 },
    );
    expect(response.isError).not.toBe(true);
    const summary = z
      .object({
        normalized_result: z.object({
          parent_evidence_id: z.string(),
          summary: z.object({
            coverage: z.object({
              application: z.object({ status: z.string() }),
            }),
          }),
        }),
      })
      .parse(response.structuredContent).normalized_result;
    expect(summary.summary.coverage.application.status).toBe("partial");
    await verifyRecovery(client, nextRoot, diagnostics);
    const retained = {
      kind: "retained-evidence",
      evidence_id: summary.parent_evidence_id,
    };
    const pageResponse = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: retained,
        view: { kind: "page", collection: "modules", offset: 0, limit: 100 },
      },
    });
    expect(pageResponse.isError).not.toBe(true);
    const page = z
      .object({
        normalized_result: z.object({
          items: z.array(
            z.object({
              node_id: z.string(),
              kind: z.string(),
              path: z.string().nullable(),
            }),
          ),
        }),
      })
      .parse(pageResponse.structuredContent).normalized_result;
    const module = page.items.find(
      (item) => item.kind === "javascript-asset" && item.path === "main.js",
    );
    if (module === undefined)
      throw new Error("The analyzed file disappeared from public module views");
    const itemResponse = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: retained,
        view: {
          kind: "item",
          collection: "modules",
          selector: { node_id: module.node_id },
        },
      },
    });
    expect(itemResponse.isError).not.toBe(true);
    const item = z
      .object({
        normalized_result: z.object({
          item: z.object({
            identity: z.object({ sha256: z.string() }),
            observations: z.array(
              z.object({
                properties: z.object({
                  static_analysis: z
                    .object({
                      parse_status: z.string(),
                      references: z.array(
                        z.object({
                          specifier: z.string(),
                          location: z.object({
                            start: z.object({ line: z.number() }),
                          }),
                        }),
                      ),
                    })
                    .optional(),
                }),
              }),
            ),
          }),
        }),
      })
      .parse(itemResponse.structuredContent).normalized_result.item;
    expect(item.identity.sha256).toBe(digest);
    const facts = item.observations.find(
      (observation) => observation.properties.static_analysis !== undefined,
    )?.properties.static_analysis;
    if (facts === undefined)
      throw new Error("Completed static observations were discarded");
    expect(facts.parse_status).toBe("complete");
    expect(
      facts.references.map((reference) => [
        reference.specifier,
        reference.location.start.line,
      ]),
    ).toEqual(
      Array.from({ length: 4000 }, (_, index) => ["./target.js", index + 1]),
    );
    expect(
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ).toBe(digest);
    expect(diagnostics()).not.toMatch(/FATAL ERROR:.*heap/iu);
  } finally {
    await client.close();
    await transport.close();
  }
}, 90000);

const repeatedSourceCount = 1500;
const repeatedSourceText = "export const observed = 7;\n";

it("returns a directly usable partial analysis reference for an oversized timeout observation", async () => {
  const root = await createTestTempDirectory("rea-js-large-timeout-");
  for (let offset = 0; offset < repeatedSourceCount; offset += 50)
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(
          join(root, `file-${String(offset + index)}.js`),
          repeatedSourceText,
        ),
      ),
    );
  const nextRoot = await createTestTempDirectory("rea-js-timeout-recovery-");
  await writeFile(join(nextRoot, "main.js"), "export const recovered = 9;\n");
  const { client, transport, diagnostics } = createResourceClient();
  try {
    await client.connect(transport);
    const response = await client.callTool(
      {
        name: "analyze_javascript_application",
        arguments: {
          input_path: root,
          format: "directory",
          max_heap_mb: 128,
          analysis_timeout_ms: 1,
        },
      },
      { timeout: 60000 },
    );
    const { error } = parseMcpToolError(response);
    expect(error.code).toBe("provider_timeout");
    const partial = retainedEvidenceReferenceSchema.parse(
      error.details?.partial_observation,
    );
    expect(error.details).toMatchObject({
      limit: {
        setting: "javascript.analysis_timeout_ms",
        effective_value: 1,
        parameter: "analysis_timeout_ms",
        unit: "ms",
        minimum: 1,
        maximum: 2_147_483_647,
        applies_at: "next_operation",
        agent_editable: true,
        rea_restart_required: false,
      },
    });
    expect(error.recovery).toEqual({
      kind: "inspect_timeout_state",
      operation: "analyze_javascript_application",
      timeout_ms: 1,
    });
    // Check worker recovery before materializing retained views: those views
    // independently consume parent capacity. Then prove the old Evidence is
    // still usable after the server has completed a different analysis.
    await verifyRecovery(client, nextRoot, diagnostics);
    const summaryResponse = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: partial,
        view: { kind: "summary" },
      },
    });
    expect(summaryResponse.isError).not.toBe(true);
    const summary = z
      .object({
        normalized_result: z.object({
          summary: z.object({
            statistics: z.object({
              relevant_files: z.number(),
              parsed_javascript_files: z.number(),
              parse_failures: z.number(),
            }),
            coverage: z.object({ semantic_unknowns: z.number() }),
          }),
        }),
      })
      .parse(summaryResponse.structuredContent).normalized_result.summary;
    expect(summary.statistics).toEqual({
      relevant_files: repeatedSourceCount,
      parsed_javascript_files: 0,
      parse_failures: 0,
    });
    expect(summary.coverage.semantic_unknowns).toBeGreaterThan(
      repeatedSourceCount,
    );
    await verifyRepeatedSourcePaths(client, partial);
    expect(diagnostics()).not.toMatch(/FATAL ERROR:.*heap/iu);
  } finally {
    await client.close();
    await transport.close();
  }
}, 90000);

const verifyRecovery = async (
  client: Client,
  nextRoot: string,
  diagnostics: () => string,
): Promise<void> => {
  await client.ping();
  const next = await client.callTool({
    name: "analyze_javascript_application",
    arguments: {
      input_path: nextRoot,
      format: "directory",
      max_heap_mb: 128,
      detail: "summary",
    },
  });
  expect(
    next.isError,
    JSON.stringify({ next, diagnostics: diagnostics() }),
  ).not.toBe(true);
  expect(next.structuredContent).toMatchObject({
    normalized_result: {
      summary: {
        input_path: nextRoot,
        statistics: {
          relevant_files: 1,
          parsed_javascript_files: 1,
          parse_failures: 0,
        },
      },
    },
  });
  await client.ping();
};

const createResourceClient = () => {
  const client = new Client({ name: "javascript-resources", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_OPTIONS: "--max-old-space-size=512 --max-semi-space-size=8",
    },
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    if (diagnostics.length < 262144) diagnostics += chunk.toString();
  });
  return { client, transport, diagnostics: () => diagnostics };
};

const verifyRepeatedSourcePaths = async (
  client: Client,
  source: { readonly kind: "retained-evidence"; readonly evidence_id: string },
): Promise<void> => {
  const response = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source,
      view: {
        kind: "javascript-facts",
        where: { kinds: ["javascript-asset"] },
        property_keys: [],
        limit: repeatedSourceCount,
      },
    },
  });
  expect(response.isError).not.toBe(true);
  // Every occurrence is independently identified and sourced. No module
  // properties are needed, and a full item would retain unrelated data in
  // the same deliberately heap-constrained server used for recovery.
  const digest = createHash("sha256").update(repeatedSourceText).digest("hex");
  const facts = z
    .object({
      normalized_result: z.object({
        rows: z.array(
          z.object({
            node_id: z.string(),
            observation_id: z.string(),
            identity: z.object({
              strategy: z.literal("content-digest"),
              sha256: z.literal(digest),
            }),
            properties: z.strictObject({}),
            evidence: z.object({
              location: z.object({
                available: z.literal(true),
                value: z.object({
                  kind: z.literal("artifact-path"),
                  path: z.string(),
                }),
              }),
            }),
          }),
        ),
        coverage: z.object({
          examined: z.literal(repeatedSourceCount),
          total: z.literal(repeatedSourceCount),
          exhausted: z.literal(true),
          next_offset: z.null(),
        }),
      }),
    })
    .parse(response.structuredContent).normalized_result;
  expect(facts.rows).toHaveLength(repeatedSourceCount);
  expect(new Set(facts.rows.map(({ node_id }) => node_id)).size).toBe(1);
  expect(
    new Set(facts.rows.map(({ observation_id }) => observation_id)).size,
  ).toBe(repeatedSourceCount);
  expect(
    facts.rows.map(({ evidence }) => evidence.location.value.path).sort(),
  ).toEqual(
    Array.from(
      { length: repeatedSourceCount },
      (_, index) => `file-${String(index)}.js`,
    ).sort(),
  );
};
