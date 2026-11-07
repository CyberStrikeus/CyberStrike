import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { erlangBeamSchema } from "../../../src/domain/erlang/beam.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import {
  erlangBeamFixture,
  erlangBeamChunksFixture,
} from "../../../src/erlang/Beam.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type SharedMcpCall } from "../../support/cli/cliFixture.js";

const contract = toolContract("inspect_erlang_beam");
const completeSchema = contract.outputSchema.safeExtend({
  normalized_result: erlangBeamSchema,
});
const viewContract = toolContract("inspect_analysis_view");
const deliveredSchema = z.object({ summary: evidenceSchema });

const checkSelectors = async (
  call: SharedMcpCall,
  evidence_id: string,
): Promise<void> => {
  for (const [view, items] of [
    [
      { collection: "exports", indices: [0], fields: [] },
      [{ source_index: 0 }],
    ],
    [{ collection: "exports", indices: [], fields: [] }, []],
    [{ collection: "exports", names: [], fields: [] }, []],
    [{ collection: "exports", names: ["missing"], fields: [] }, []],
    [
      {
        collection: "exports",
        names: ["module_info"],
        indices: [0],
        fields: [],
      },
      [],
    ],
    [{ collection: "exports", offset: 999, fields: [] }, []],
    [
      {
        collection: "atoms",
        names: ["module_info"],
        fields: ["index", "name"],
      },
      [{ source_index: 1, index: 2, name: "module_info" }],
    ],
    [
      {
        collection: "imports",
        names: ["get_module_info"],
        modules: ["erlang"],
      },
      [
        {
          source_index: 0,
          module_index: 4,
          module: "erlang",
          function_index: 5,
          function: "get_module_info",
          arity: 1,
        },
      ],
    ],
    [{ collection: "imports", modules: [], fields: [] }, []],
    [
      { collection: "lambdas", fields: ["index", "old_unique"] },
      [{ source_index: 0, index: 0, old_unique: 42 }],
    ],
    [
      {
        collection: "lambdas",
        names: ["start"],
        fields: ["function", "arity", "old_unique"],
      },
      [{ source_index: 0, function: "start", arity: 1, old_unique: 42 }],
    ],
    [{ collection: "lambdas", names: ["missing"], fields: [] }, []],
    [
      { collection: "chunks", names: ["Code"], fields: ["index", "name"] },
      [{ source_index: 1, index: 1, name: "Code" }],
    ],
    [{ collection: "chunks", names: ["Xyzz"], fields: [] }, []],
  ] as const) {
    const result = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id },
      view: { kind: "beam", ...view },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(
      viewContract.outputSchema.parse(result.structuredContent)
        .normalized_result,
    ).toHaveProperty("page.items", items);
  }
};

cliTest(
  "queries same-name BEAM export arities through CLI/MCP after deleting the source",
  { timeout: 60_000 },
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-views-");
    const path = join(root, "app.beam");
    await writeFile(path, erlangBeamFixture("views"));
    const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
    const complete = await run({
      arguments: ["inspect-erlang-beam", path, "--json"],
    });
    expect(complete.exitCode, complete.stderr).toBe(0);
    const parent = completeSchema.parse(complete.json);
    const bundle = join(root, "source.bundle.json");
    const view = {
      kind: "beam",
      collection: "exports",
      names: ["module_info"],
      fields: ["function_index", "function", "arity", "label"],
      offset: 0,
      limit: 1,
    };
    const directCli = await run({
      arguments: [
        "inspect-erlang-beam",
        path,
        "--detail",
        "summary",
        "--view",
        JSON.stringify(view),
        "--evidence_output",
        bundle,
        "--json",
      ],
    });
    expect(directCli.exitCode, directCli.stderr).toBe(0);
    const delivered = deliveredSchema.parse(directCli.json).summary;
    const saved = await readEvidenceBundle(bundle);
    if (!saved.ok) throw saved.error;
    expect(saved.value.records).toEqual([parent]);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined)
      throw new Error("Expected production stdio MCP session");
    const direct = await call("inspect_erlang_beam", {
      path,
      detail: "summary",
      view,
    });
    expect(direct.isError).not.toBe(true);
    const selected = contract.outputSchema.parse(direct.structuredContent);
    expect(selected.normalized_result).toEqual(delivered.normalized_result);
    expect(selected.evidence_links).toContain(parent.evidence_id);
    expect(selected.normalized_result).toMatchObject({
      page: {
        collection: "exports",
        items: [
          {
            source_index: 1,
            function_index: 2,
            function: "module_info",
            arity: 0,
            label: 1,
          },
        ],
      },
      beam: {
        counts: { atoms: 5, exports: 3, imports: 1, lambdas: 1, chunks: 5 },
        coverage: { status: "complete", examined_chunks: 5 },
      },
      coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
    });
    await rm(path);
    const source = {
      kind: "retained-evidence",
      evidence_id: parent.evidence_id,
    };
    const request = { source, view: { ...view, offset: 1 } };
    const second = await call("inspect_analysis_view", request);
    expect(second.isError).not.toBe(true);
    const secondEvidence = viewContract.outputSchema.parse(
      second.structuredContent,
    );
    const page = analysisViewResultSchema.parse(
      secondEvidence.normalized_result,
    );
    expect(page).toHaveProperty("page.items", [
      {
        source_index: 2,
        function_index: 2,
        function: "module_info",
        arity: 1,
        label: 3,
      },
    ]);
    const { view_digest, ...content } = page;
    expect(view_digest).toBe(digestCanonicalValue(content, "Analysis view"));
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
    expect(viewContract.outputSchema.parse(offline.json)).toEqual(
      secondEvidence,
    );
    const fromFile = await call("inspect_analysis_view", {
      ...request,
      source: {
        kind: "evidence-file",
        path: bundle,
        evidence_id: parent.evidence_id,
      },
    });
    expect(fromFile.isError).not.toBe(true);
    expect(
      viewContract.outputSchema.parse(fromFile.structuredContent)
        .normalized_result,
    ).toEqual(page);
    await checkSelectors(call, parent.evidence_id);
  },
);

cliTest(
  "preserves missing tables, empty exports and unresolved atom references in BEAM views",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-missing-tables-");
    const path = join(root, "app.beam");
    const imports = Buffer.alloc(16);
    [1, 999, 998, 2].forEach((value, i) => imports.writeUInt32BE(value, i * 4));
    await writeFile(
      path,
      erlangBeamChunksFixture([
        ["ExpT", Buffer.alloc(4)],
        ["ImpT", imports],
        ["FunT", Buffer.alloc(0)],
      ]),
    );
    const call = await cli.sharedMcpCall?.();
    if (call === undefined)
      throw new Error("Expected production stdio MCP session");
    const response = await call("inspect_erlang_beam", {
      path,
      detail: "summary",
    });
    expect(response.isError).not.toBe(true);
    const summary = contract.outputSchema.parse(
      response.structuredContent,
    ).normalized_result;
    expect(summary).toMatchObject({
      summary: {
        counts: {
          atoms: null,
          exports: 0,
          imports: 1,
          lambdas: null,
          chunks: 3,
        },
        module: null,
        atom_encoding: null,
        code: null,
      },
    });
    if (!("parent_evidence_id" in summary))
      throw new Error("Expected summary view");
    await rm(path);
    for (const [collection, items, count] of [
      [
        "imports",
        [
          {
            source_index: 0,
            module_index: 999,
            module: null,
            function_index: 998,
            function: null,
            arity: 2,
          },
        ],
        1,
      ],
      ["exports", [], 0],
      ["lambdas", [], null],
    ] as const) {
      const result = await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: { kind: "beam", collection },
      });
      expect(result.isError).not.toBe(true);
      const projected = viewContract.outputSchema.parse(
        result.structuredContent,
      ).normalized_result;
      expect(projected).toHaveProperty("page.items", items);
      expect(projected).toHaveProperty(`beam.counts.${collection}`, count);
      expect(projected.unknowns).toContain(
        "No atoms table was decoded; runtime absence is not established.",
      );
    }
  },
);

cliTest(
  "rejects invalid BEAM delivery before reading the target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-beam-invalid-view-");
    const output = join(root, "unused.json");
    const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
    const view = JSON.stringify({ kind: "beam", collection: "exports" });
    for (const [flags, key] of [
      [["--detail", "summary"], "evidence_output"],
      [
        ["--detail", "complete", "--view", view, "--evidence_output", output],
        "view",
      ],
      [
        ["--detail", "summary", "--view", "{", "--evidence_output", output],
        "view",
      ],
    ] as const) {
      const result = await run({
        arguments: [
          "inspect-erlang-beam",
          "/rea-missing/app.beam",
          ...flags,
          "--json",
        ],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: [key] }] },
      });
    }
  },
);
