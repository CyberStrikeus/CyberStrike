import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect } from "vitest";
import { createMcpSchemaValidation } from "../../fixtures/mcpSchemaValidation.js";
import { z } from "zod";

import { inspectMachoSchema } from "../../../src/domain/native/nativeInspection.js";
import { createServer } from "../../../src/server/createServer.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { ok } from "../../../src/domain/result.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";
import { openProductionTarget } from "../../support/mcp/productionSession.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { advertisedMcpToolSchemas } from "../../fixtures/advertisedMcpTool.js";

const schemaValidation = createMcpSchemaValidation();
afterAll(() => schemaValidation.clear());

const evidenceOf = <Schema extends z.ZodType>(schema: Schema) =>
  z.object({
    evidence_id: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    normalized_result: schema,
  });
const countSchema = z.object({
  returned: z.number(),
  total: z.number().nullable(),
  exhaustive: z.boolean(),
});
const summarySchema = z.object({
  kind: z.literal("summary"),
  parent_evidence_id: z.string(),
  summary: z.object({
    uuid: z.string().nullable(),
    collections: z.record(z.string(), countSchema),
    provenance_count: z.number(),
  }),
});
const pageSchema = z.object({
  kind: z.literal("macho"),
  item: z.array(z.unknown()),
  coverage: z.object({ next_offset: z.number().nullable() }),
});

const binaryUncertainFixture = () => {
  const empty = { items: [], total: 0, exhaustive: true, limitations: [] };
  const incomplete = <T>(item: T) => ({
    items: [item],
    total: null,
    exhaustive: false,
    limitations: ["Some binary command fields are not decoded."],
  });
  const segment = {
    name: null,
    name_bytes_hex: "ff",
    vm_address: "0x0",
    vm_size: null,
    vm_size_hex: "0x20000000000000",
    file_offset: null,
    file_offset_hex: "0x20000000000001",
    file_size: null,
    file_size_hex: "0x20000000000002",
    maximum_permissions: {
      read: true,
      write: false,
      execute: false,
      raw: "1",
    },
    initial_permissions: {
      read: true,
      write: false,
      execute: false,
      raw: "1",
    },
    sections: {
      items: [
        {
          segment: null,
          segment_bytes_hex: "ff",
          name: null,
          name_bytes_hex: "fe",
          address: "0x1",
          size: null,
          size_hex: "0x20000000000000",
          file_offset: 0,
          alignment: null,
          alignment_exponent: 53,
          flags: [],
        },
      ],
      total: 1,
      exhaustive: true,
      limitations: [],
    },
  };
  const dependency = {
    path: null,
    path_bytes_hex: "fd",
    kind: "LC_LOAD_DYLIB",
    current_version: null,
    compatibility_version: null,
  };
  const command = {
    index: 0,
    kind: "LC_UNKNOWN_0x7fff",
    fields: {
      command_code: 32767,
      command_offset: 184,
      cmdsize: 8,
      command_sha256: "a".repeat(64),
    },
  };
  const report = inspectMachoSchema.parse({
    format: "mach-o",
    selected_architecture: { name: "arm64", container_file_offset: 0 },
    endian: "little",
    word_size: 64,
    file_type: "2",
    flags: [],
    uuid: null,
    entrypoints: empty,
    architectures: empty,
    build_metadata: empty,
    load_commands: {
      items: [command],
      total: 1,
      exhaustive: true,
      limitations: ["Some binary command fields are not decoded."],
    },
    dependencies: incomplete(dependency),
    imports: empty,
    exports: empty,
    segments: incomplete(segment),
    encryption: empty,
    provenance: [],
    limitations: [],
  });
  return { empty, segment, dependency, command, report };
};

mcpTest(
  "advertises binary names and partially decoded command fields through SDK schemas",
  async ({ mcp, onTestFinished }) => {
    const { empty, segment, dependency, command, report } =
      binaryUncertainFixture();
    const source = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_macho",
        parameters: {},
        result: report,
      },
    );
    const session = createTestBinarySession(() => {
      throw new Error("No provider expected");
    });
    onTestFinished(async () => {
      const closed = await session.close();
      if (!closed.ok) throw closed.error;
    });
    const client = await mcp.connect(
      createServer(
        { kind: "session", session },
        {
          environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
        },
      ),
      undefined,
      schemaValidation,
    );
    const tool = await advertisedMcpToolSchemas(
      client,
      "inspect_macho",
      schemaValidation.assertions,
    );
    expect(
      tool.ajv.validate(tool.outputSchema, source),
      JSON.stringify(tool.ajv.errors),
    ).toBe(true);
    const view = await advertisedMcpToolSchemas(
      client,
      "inspect_analysis_view",
      schemaValidation.assertions,
    );
    for (const [facet, expected] of [
      ["segments", segment],
      ["dependencies", dependency],
      ["load_commands", command],
    ] as const) {
      const request = {
        source: { kind: "inline", evidence: source },
        view: { kind: "macho", facet },
      };
      expect(
        view.ajv.validate(view.inputSchema, request),
        JSON.stringify(view.ajv.errors),
      ).toBe(true);
      const reply = await client.callTool({
        name: "inspect_analysis_view",
        arguments: request,
      });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      expect(
        view.ajv.validate(view.outputSchema, reply.structuredContent),
        JSON.stringify(view.ajv.errors),
      ).toBe(true);
      const result = parseEvidence(reply.structuredContent).normalized_result;
      expect(result).toMatchObject({
        item: [expected],
        source_exhaustive: facet === "load_commands",
      });
      if (facet === "load_commands")
        expect(result).toMatchObject({
          limitations: expect.arrayContaining([
            "Some binary command fields are not decoded.",
          ]),
        });
    }
    // A historical record can omit all fields introduced for exact byte names.
    const historicalSegment = {
      name: "__TEXT",
      vm_address: "0x0",
      vm_size: 64,
      file_offset: 0,
      file_size: 64,
      maximum_permissions: segment.maximum_permissions,
      initial_permissions: segment.initial_permissions,
      sections: empty,
    };
    const historical = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_macho",
        parameters: {},
        result: {
          ...report,
          segments: {
            items: [historicalSegment],
            total: 1,
            exhaustive: true,
            limitations: [],
          },
        },
      },
    );
    expect(
      tool.ajv.validate(tool.outputSchema, historical),
      JSON.stringify(tool.ajv.errors),
    ).toBe(true);
    const oldView = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "inline", evidence: historical },
        view: { kind: "macho", facet: "segments" },
      },
    });
    expect(oldView.isError, JSON.stringify(oldView.content)).not.toBe(true);
    expect(
      view.ajv.validate(view.outputSchema, oldView.structuredContent),
      JSON.stringify(view.ajv.errors),
    ).toBe(true);
    expect(
      parseEvidence(oldView.structuredContent).normalized_result,
    ).toMatchObject({ item: [historicalSegment], source_exhaustive: true });
  },
);

mcpTest(
  "pages ambiguous imports and exact exports under the advertised MCP schema",
  async ({ mcp, onTestFinished }) => {
    const empty = { items: [], total: 0, exhaustive: true, limitations: [] };
    const imported = {
      name: null,
      runtime_name: null,
      raw_name: "_value+0x4",
      name_status: "ambiguous",
      addend: null,
      address: null,
      weak: null,
      reexport: null,
      source: "libFixture",
    };
    const exported = {
      name: "_value",
      runtime_name: "value",
      address: "0x1000",
      weak: null,
      reexport: null,
      source: null,
    };
    const report = inspectMachoSchema.parse({
      format: "mach-o",
      selected_architecture: { name: "arm64", container_file_offset: 0 },
      endian: "little",
      word_size: 64,
      file_type: "MH_DYLIB",
      flags: [],
      uuid: null,
      entrypoints: empty,
      architectures: empty,
      build_metadata: empty,
      load_commands: empty,
      dependencies: empty,
      imports: { ...empty, items: [imported], total: 1 },
      exports: { ...empty, items: [exported], total: 1 },
      segments: empty,
      encryption: empty,
      provenance: [],
      limitations: [],
    });
    const source = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_macho",
        parameters: {},
        result: report,
      },
    );
    const session = createTestBinarySession(() => {
      throw new Error("Imported views must not start a provider");
    });
    onTestFinished(async () => {
      const closed = await session.close();
      if (!closed.ok) throw closed.error;
    });
    const client = await mcp.connect(
      createServer(
        { kind: "session", session },
        {
          environment: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: "full" },
        },
      ),
      undefined,
      schemaValidation,
    );
    const schemas = await advertisedMcpToolSchemas(
      client,
      "inspect_analysis_view",
      schemaValidation.assertions,
    );
    for (const [facet, expected] of [
      ["imports", imported],
      ["exports", exported],
    ] as const) {
      const request = {
        source: { kind: "inline", evidence: source },
        view: { kind: "macho", facet },
      };
      expect(
        schemas.ajv.validate(schemas.inputSchema, request),
        JSON.stringify(schemas.ajv.errors),
      ).toBe(true);
      const reply = await client.callTool({
        name: "inspect_analysis_view",
        arguments: request,
      });
      expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true);
      expect(
        schemas.ajv.validate(schemas.outputSchema, reply.structuredContent),
        JSON.stringify(schemas.ajv.errors),
      ).toBe(true);
      expect(
        pageSchema.parse(
          parseEvidence(reply.structuredContent).normalized_result,
        ).item,
      ).toEqual([expected]);
    }
  },
);

describe.skipIf(process.platform !== "darwin")(
  "Mach-O summary delivery through MCP",
  () => {
    mcpTest(
      "retains complete inspect_macho Evidence and pages its exact rows",
      async ({ mcp, onTestFinished }) => {
        const target = join(
          await createTestTempDirectory("rea-macho-summary-mcp-"),
          "ls",
        );
        await copyFile("/bin/ls", target);
        const client = await openProductionTarget(mcp, onTestFinished, target);

        const complete = await client.callTool({
          name: "inspect_macho",
          arguments: {},
        });
        expect(complete.isError, JSON.stringify(complete.content)).not.toBe(
          true,
        );
        const full = evidenceOf(inspectMachoSchema).parse(
          complete.structuredContent,
        );
        // Omitted detail keeps the default Evidence parameters unchanged.
        expect(full.parameters).toEqual({});

        const summarized = await client.callTool({
          name: "inspect_macho",
          arguments: { detail: "summary" },
        });
        expect(summarized.isError, JSON.stringify(summarized.content)).not.toBe(
          true,
        );
        const summary = evidenceOf(summarySchema).parse(
          summarized.structuredContent,
        ).normalized_result;
        // Delivery detail never reaches the tools or the source Evidence ID.
        expect(summary.parent_evidence_id).toBe(full.evidence_id);
        const report = full.normalized_result;
        expect(summary.summary.uuid).toBe(report.uuid);
        expect(summary.summary.provenance_count).toBe(report.provenance.length);
        for (const name of [
          "imports",
          "exports",
          "dependencies",
          "encryption",
        ] as const)
          expect(summary.summary.collections[name]).toEqual({
            returned: report[name].items.length,
            total: report[name].total,
            exhaustive: report[name].exhaustive,
          });
        expect(JSON.stringify(summarized.structuredContent)).not.toContain(
          report.imports.items[0]?.name ?? "_",
        );

        // Every facet must reassemble the unparsed complete rows exactly.
        const raw = z
          .object({ normalized_result: z.record(z.string(), z.unknown()) })
          .parse(complete.structuredContent).normalized_result;
        const facets = [
          "entrypoints",
          "architectures",
          "build_metadata",
          "load_commands",
          "dependencies",
          "imports",
          "exports",
          "segments",
          "encryption",
          "provenance",
        ] as const;
        for (const facet of facets) {
          const rows: unknown[] = [];
          let offset: number | null = 0;
          while (offset !== null) {
            const paged = await client.callTool({
              name: "inspect_analysis_view",
              arguments: {
                source: {
                  kind: "retained-evidence",
                  evidence_id: summary.parent_evidence_id,
                },
                view: { kind: "macho", facet, offset, limit: 16 },
              },
            });
            expect(paged.isError, JSON.stringify(paged.content)).not.toBe(true);
            const page = evidenceOf(pageSchema).parse(
              paged.structuredContent,
            ).normalized_result;
            rows.push(...page.item);
            offset = page.coverage.next_offset;
          }
          expect(rows, facet).toEqual(
            facet === "provenance"
              ? raw.provenance
              : z.object({ items: z.array(z.unknown()) }).parse(raw[facet])
                  .items,
          );
        }

        const wrongKind = await client.callTool({
          name: "inspect_analysis_view",
          arguments: {
            source: {
              kind: "retained-evidence",
              evidence_id: summary.parent_evidence_id,
            },
            view: { kind: "wasm", facet: "exports" },
          },
        });
        expect(wrongKind.isError).toBe(true);
        expect(JSON.stringify(wrongKind.content)).toContain(
          "Mach-O inspection supports summary and macho views.",
        );
      },
    );
  },
);

mcpTest(
  "refuses summary delivery before analysis when the server retains no Evidence",
  async ({ mcp, onTestFinished }) => {
    const target = join(
      await createTestTempDirectory("rea-summary-preflight-"),
      "tool",
    );
    await writeFile(target, thinMach(0xfeedfacf, 0x0100000c));
    const executed: string[] = [];
    const session = createTestBinarySession(() => ({
      execute: (operation) => {
        executed.push(operation);
        return Promise.resolve(observed(null));
      },
      close: () => Promise.resolve(ok(null)),
    }));
    onTestFinished(async () => {
      const closed = await session.close();
      if (!closed.ok) throw closed.error;
    });
    const opened = await session.open(target);
    if (!opened.ok) throw opened.error;
    const client = await mcp.connect(
      createServer({ kind: "fixed", analysis: session }),
    );
    const refused = [];
    for (const name of ["inspect_macho", "inspect_artifact"])
      refused.push(
        await client.callTool({ name, arguments: { detail: "summary" } }),
      );
    // Neither analysis ran only to be discarded by the delivery refusal.
    expect(executed.filter((operation) => operation !== "health")).toEqual([]);
    for (const result of refused)
      expect(parseMcpToolError(result)).toMatchObject({
        error: {
          code: "capability_unavailable",
          message: expect.stringContaining("does not retain Evidence"),
        },
      });
  },
);
