import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { readEvidenceBundle } from "../../../src/application/EvidenceBundleFiles.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { evidenceSchema } from "../../../src/domain/evidence.js";
import { pythonPycSchema } from "../../../src/domain/python/pythonPyc.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { analysisViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import {
  marshalCode,
  pythonPycHeader,
} from "../../../src/python/PythonPyc.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, type SharedMcpCall } from "../../support/cli/cliFixture.js";

const pycContract = toolContract("inspect_python_pyc");
const viewContract = toolContract("inspect_analysis_view");

const writeSameNamePyc = async (path: string): Promise<void> => {
  await writeFile(
    path,
    Buffer.concat([
      pythonPycHeader(3531),
      marshalCode("py311", {
        consts: [
          marshalCode("py311", {
            name: "same",
            qualname: "First.same",
            firstlineno: 11,
          }),
          marshalCode("py311", {
            name: "same",
            qualname: "Second.same",
            firstlineno: 22,
          }),
        ],
      }),
    ]),
  );
};

const assertSparseSelectors = async (
  call: SharedMcpCall,
  source: { readonly kind: "retained-evidence"; readonly evidence_id: string },
): Promise<void> => {
  for (const [selector, items] of [
    [{ indices: [2], fields: [] }, [{ source_index: 2 }]],
    [{ names: [], fields: [] }, []],
    [{ names: ["missing"], fields: [] }, []],
    [{ indices: [], fields: [] }, []],
    [{ names: ["same"], indices: [0], fields: [] }, []],
    [
      { indices: [0], fields: ["nested_code"] },
      [{ source_index: 0, nested_code: [1, 2] }],
    ],
  ] as const) {
    const result = await call("inspect_analysis_view", {
      source,
      view: { kind: "python-pyc", collection: "code_objects", ...selector },
    });
    expect(result.isError).not.toBe(true);
    expect(
      viewContract.outputSchema.parse(result.structuredContent)
        .normalized_result,
    ).toHaveProperty("items", items);
  }
};

cliTest(
  "queries same-name pyc objects through CLI/MCP after deleting the source",
  { timeout: 60_000 },
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pyc-views-");
    const path = join(root, "module.pyc");
    await writeSameNamePyc(path);
    const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
    const complete = await run({
      arguments: ["inspect-python-pyc", path, "--json"],
    });
    expect(complete.exitCode, complete.stderr).toBe(0);
    const parent = pycContract.outputSchema.parse(complete.json);
    const completeReport = pythonPycSchema.parse(parent.normalized_result);
    const bundle = join(root, "complete.bundle.json");
    const summarized = await run({
      arguments: [
        "inspect-python-pyc",
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
    expect(delivered.normalized_result).toMatchObject({
      parent_evidence_id: parent.evidence_id,
      summary: {
        header: completeReport.header,
        coverage: { status: "complete", code_objects: 3 },
      },
    });
    expect(delivered.normalized_result).not.toHaveProperty(
      "summary.code_objects",
    );
    const loaded = await readEvidenceBundle(bundle);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.value.records).toEqual([parent]);
    const call = await cli.sharedMcpCall?.();
    if (call === undefined)
      throw new Error("Expected shared stdio MCP session");
    const response = await call("inspect_python_pyc", {
      path,
      detail: "summary",
    });
    expect(response.isError).not.toBe(true);
    expect(
      pycContract.outputSchema.parse(response.structuredContent)
        .normalized_result,
    ).toEqual(delivered.normalized_result);
    const view = {
      kind: "python-pyc",
      collection: "code_objects",
      names: ["same"],
      fields: ["name", "qualname", "nested_code"],
      offset: 0,
      limit: 1,
    };
    const directBundle = join(root, "selected.bundle.json");
    const directCli = await run({
      arguments: [
        "inspect-python-pyc",
        path,
        "--detail",
        "summary",
        "--view",
        JSON.stringify(view),
        "--evidence_output",
        directBundle,
        "--json",
      ],
    });
    expect(directCli.exitCode, directCli.stderr).toBe(0);
    const directCliEvidence = z
      .object({ summary: evidenceSchema })
      .parse(directCli.json).summary;
    const direct = await call("inspect_python_pyc", {
      path,
      detail: "summary",
      view,
    });
    expect(direct.isError).not.toBe(true);
    const directEvidence = pycContract.outputSchema.parse(
      direct.structuredContent,
    );
    expect(directEvidence.normalized_result).toEqual(
      directCliEvidence.normalized_result,
    );
    const directSaved = await readEvidenceBundle(directBundle);
    if (!directSaved.ok) throw directSaved.error;
    expect(directSaved.value.records).toEqual([parent]);
    await rm(path);
    const source = {
      kind: "retained-evidence" as const,
      evidence_id: parent.evidence_id,
    };
    const first = await call("inspect_analysis_view", { source, view });
    expect(first.isError).not.toBe(true);
    const firstPage = viewContract.outputSchema.parse(first.structuredContent);
    expect(firstPage.normalized_result).toEqual(
      directEvidence.normalized_result,
    );
    expect(firstPage.evidence_links).toContain(parent.evidence_id);
    expect(firstPage.normalized_result).toMatchObject({
      items: [
        {
          source_index: 1,
          name: "same",
          qualname: "First.same",
          nested_code: [],
        },
      ],
      coverage: { examined: 1, total: 2, next_offset: 1, exhausted: false },
      pyc: { coverage: { status: "complete", code_objects: 3 } },
    });
    const request = { source, view: { ...view, offset: 1 } };
    const second = await call("inspect_analysis_view", request);
    expect(second.isError).not.toBe(true);
    const page = viewContract.outputSchema.parse(second.structuredContent);
    const projected = analysisViewResultSchema.parse(page.normalized_result);
    expect(projected).toHaveProperty("items", [
      {
        source_index: 2,
        name: "same",
        qualname: "Second.same",
        nested_code: [],
      },
    ]);
    const { view_digest, ...content } = projected;
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
    expect(viewContract.outputSchema.parse(offline.json)).toEqual(page);
    await assertSparseSelectors(call, source);
  },
);

cliTest(
  "rejects invalid pyc delivery before reading the target",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pyc-invalid-delivery-");
    const output = join(root, "unused.json");
    const run = cli.sharedCliRun?.bind(cli) ?? cli.run.bind(cli);
    const view = JSON.stringify({
      kind: "python-pyc",
      collection: "code_objects",
    });
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
          "inspect-python-pyc",
          "/rea-missing/module.pyc",
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
