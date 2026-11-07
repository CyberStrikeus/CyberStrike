import { artifactMcpCall } from "../../scripts/lib/artifact-e2e.mjs";
import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { managedMemberInspectionSchema } from "../../src/domain/managed/managedArtifact.js";
import {
  analysisViewResultSchema,
  managedMemberSummaryViewResultSchema,
} from "../../src/domain/analysisView/analysisView.js";
import { buildManagedMemberCapacityFixture } from "../fixtures/managedMemberCapacity.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const createTransport = () =>
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve("scripts/rea.mjs"), "mcp"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      REA_LOG_LEVEL: "silent",
      ...(process.platform === "win32"
        ? {
            SystemRoot: process.env.SystemRoot ?? "",
            TEMP: tmpdir(),
            TMP: tmpdir(),
          }
        : {}),
    },
    stderr: "pipe",
  });

cliTest(
  "CLI and stdio MCP recover type discovery and preserve partial retained pages",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-member-recovery-");
    const path = join(root, "large-method.dll");
    const bytes = buildManagedMemberCapacityFixture();
    await writeFile(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const transport = createTransport();
    transport.stderr?.on("data", () => undefined);
    const client = new Client({ name: "managed-type-recovery", version: "1" });
    try {
      await client.connect(transport);
      const definition = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_managed_members",
      );
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      if (definition?.outputSchema === undefined)
        throw new Error("Managed member schema is absent");
      const outputSchema: Record<string, unknown> = definition.outputSchema;
      expect(ajv.validateSchema(definition.inputSchema)).toBe(true);
      expect(ajv.validateSchema(outputSchema)).toBe(true);
      const output = await cli.run({
        arguments: ["inspect-managed-members", path, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const cliEvidence = parseEvidence(output.json);
      const response = await artifactMcpCall(client, {
        name: "inspect_managed_members",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      expect(
        ajv.validate(outputSchema, response.structuredContent),
        JSON.stringify(ajv.errors),
      ).toBe(true);
      const mcpEvidence = parseEvidence(response.structuredContent);
      expect(mcpEvidence.normalized_result).toEqual(
        cliEvidence.normalized_result,
      );
      expect(mcpEvidence.subject?.digest.sha256).toBe(sha256);
      expect(cliEvidence.subject?.digest.sha256).toBe(sha256);
      const report = managedMemberInspectionSchema.parse(
        mcpEvidence.normalized_result,
      );
      expect(report.coverage.state).toBe("partial");
      expect(report.types).toHaveLength(3);
      expect(report.methods).toEqual([]);
      const empty = report.types.find((type) => type.method_list.count === 0);
      if (empty === undefined) throw new Error("Missing empty fixture type");
      const selectedCli = await cli.run({
        arguments: [
          "inspect-managed-members",
          path,
          "--type",
          empty.full_name,
          "--json",
        ],
      });
      expect(selectedCli.exitCode, selectedCli.stderr).toBe(0);
      const selected = await artifactMcpCall(client, {
        name: "inspect_managed_members",
        arguments: { path, type_names: [empty.full_name] },
      });
      expect(selected.isError).not.toBe(true);
      const selectedEvidence = parseEvidence(selected.structuredContent);
      expect(selectedEvidence.normalized_result).toEqual(
        parseEvidence(selectedCli.json).normalized_result,
      );
      const selectedReport = managedMemberInspectionSchema.parse(
        selectedEvidence.normalized_result,
      );
      expect(selectedReport).toMatchObject({
        coverage: { state: "complete", issues: [] },
        selection: { type_names: [empty.full_name], unmatched_type_names: [] },
        types: [{ token: empty.token, full_name: empty.full_name }],
        methods: [],
      });

      const summaryReply = await artifactMcpCall(client, {
        name: "inspect_managed_members",
        arguments: { path, detail: "summary" },
      });
      expect(summaryReply.isError).not.toBe(true);
      const summary = managedMemberSummaryViewResultSchema.parse(
        parseEvidence(summaryReply.structuredContent).normalized_result,
      );
      expect(summary.summary).toMatchObject({
        coverage: { state: "partial" },
        reported_counts: {
          types: 3,
          methods: 0,
          exported_types: null,
          user_strings: null,
        },
      });
      await unlink(path);
      for (const collection of ["types", "methods"] as const) {
        const reply = await artifactMcpCall(client, {
          name: "inspect_analysis_view",
          arguments: {
            source: {
              kind: "retained-evidence",
              evidence_id: summary.parent_evidence_id,
            },
            view: { kind: "managed-members", collection, offset: 0, limit: 10 },
          },
        });
        expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
        const page = analysisViewResultSchema.parse(
          parseEvidence(reply.structuredContent).normalized_result,
        );
        if (page.kind !== "managed-members")
          throw new Error("Expected managed member page");
        expect(page.source_coverage.state).toBe("partial");
        expect(page.page.rows).toEqual(
          collection === "types" ? report.types : [],
        );
      }
      const unknown = await artifactMcpCall(client, {
        name: "inspect_analysis_view",
        arguments: {
          source: {
            kind: "retained-evidence",
            evidence_id: summary.parent_evidence_id,
          },
          view: {
            kind: "managed-members",
            collection: "exported_types",
            offset: 0,
            limit: 10,
          },
        },
      });
      expect(unknown.isError).toBe(true);
      expect(JSON.stringify(unknown)).toContain(
        "did not examine exported_types",
      );
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  },
);
