import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import {
  elfExportImage,
  peExportImage,
} from "../../fixtures/binaryDiagnostics/nativeExports.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const exportsContract = toolContract("inspect_native_exports");
const viewContract = toolContract("inspect_analysis_view");

cliTest.for(["pe", "elf"] as const)(
  "queries retained %s exports through CLI and actual stdio MCP after the source is deleted",
  { timeout: 60_000 },
  async (format, { cli }) => {
    const root = await createTestTempDirectory("rea-export-views-");
    const path = join(root, `library.${format}`);
    const bytes =
      format === "pe"
        ? peExportImage({
            functions: [{ rva: 0x2000 }, { forwarder: "other.Target" }],
            names: [
              { name: "selected", index: 0 },
              { name: "selected", index: 1 },
            ],
          })
        : elfExportImage({
            symbols: [
              { name: "selected", version: 2 },
              { name: "selected", version: 0x8002 },
            ],
            versionDefinitions: ["fixture", "V1"],
          });
    await writeFile(path, bytes);
    const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
    const complete = await run({
      arguments: ["inspect-native-exports", path, "--json"],
    });
    expect(complete.exitCode, complete.stderr).toBe(0);
    const parent = exportsContract.outputSchema.parse(complete.json);
    const bundle = join(root, "complete.bundle.json");
    const summarized = await run({
      arguments: [
        "inspect-native-exports",
        path,
        "--detail",
        "summary",
        "--evidence_output",
        bundle,
        "--json",
      ],
    });
    expect(summarized.exitCode, summarized.stderr).toBe(0);
    const delivered = z
      .object({ summary: evidenceSchema })
      .parse(summarized.json).summary;
    expect(delivered.operation).toBe("inspect_analysis_view");
    expect(delivered.normalized_result).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      summary: { format, export_count: 2, coverage: { status: "complete" } },
    });
    const loaded = await readEvidenceBundle(bundle);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.records).toEqual([parent]);

    const call =
      cli.sharedMcpCall === undefined
        ? (await connectLocalToolsMcp()).call
        : await cli.sharedMcpCall();
    const response = await call("inspect_native_exports", {
      path,
      detail: "summary",
    });
    expect(response.isError).not.toBe(true);
    expect(
      exportsContract.outputSchema.parse(response.structuredContent)
        .normalized_result,
    ).toEqual(delivered.normalized_result);
    await rm(path);
    const source = {
      kind: "retained-evidence",
      evidence_id: parent.evidence_id,
    };
    const request = {
      source,
      view: {
        kind: "native-exports",
        collection: "exports",
        names: ["selected"],
        fields: ["name"],
        offset: 1,
        limit: 1,
      },
    };
    const viewed = await call("inspect_analysis_view", request);
    expect(viewed.isError).not.toBe(true);
    const page = viewContract.outputSchema.parse(viewed.structuredContent);
    expect(page.evidence_links).toContain(parent.evidence_id);
    expect(page.normalized_result).toMatchObject({
      kind: "native-exports",
      items: [{ source_index: 1, name: "selected" }],
      exports: { coverage: { status: "complete" } },
      coverage: { examined: 1, total: 2, next_offset: null, exhausted: true },
    });
    const offline = await run({
      arguments: [
        "inspect-analysis-view",
        JSON.stringify(request),
        "--evidence-bundle",
        bundle,
        "--json",
      ],
    });
    expect(offline.exitCode, offline.stderr).toBe(0);
    expect(viewContract.outputSchema.parse(offline.json)).toEqual(page);
    const projected = await call("inspect_analysis_view", {
      ...request,
      view: {
        ...request.view,
        fields: [format === "elf" ? "value" : "ordinal"],
      },
    });
    expect(projected.isError).not.toBe(true);
    const projectedView = analysisViewResultSchema.parse(
      viewContract.outputSchema.parse(projected.structuredContent)
        .normalized_result,
    );
    expect(projectedView).toHaveProperty("items", [
      {
        source_index: 1,
        ...(format === "elf"
          ? { value: expect.any(String) }
          : { ordinal: expect.any(Number) }),
      },
    ]);
    const { view_digest, ...content } = projectedView;
    expect(view_digest).toBe(digestCanonicalValue(content, "Analysis view"));
  },
);

cliTest(
  "refuses CLI summary without a durable Evidence destination before reading",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: [
        "inspect-native-exports",
        "/rea-nonexistent/export.so",
        "--detail",
        "summary",
        "--json",
      ],
    });
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["evidence_output"] }] },
    });
  },
);
