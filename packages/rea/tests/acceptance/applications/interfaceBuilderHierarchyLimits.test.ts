import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect, onTestFinished } from "vitest";

import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";
import { openBundleResourcesTarget } from "../../support/mcp/artifactSession.js";

const verifyMcpParity = async (
  app: string,
  expected: ReturnType<typeof interfaceBuilderAnalysisSchema.parse>,
): Promise<void> => {
  const mcp = createTestMcp();
  onTestFinished(async () => mcp.close());
  const client = await openBundleResourcesTarget(mcp, onTestFinished, app);
  const complete = await client.callTool({
    name: "decode_interface_builder",
    arguments: { max_objects: 2 },
  });
  expect(complete.isError, JSON.stringify(complete)).not.toBe(true);
  const evidence = parseEvidence(complete.structuredContent);
  expect(
    interfaceBuilderAnalysisSchema.parse(evidence.normalized_result),
  ).toEqual(expected);

  const summarized = await client.callTool({
    name: "decode_interface_builder",
    arguments: { max_objects: 2, detail: "summary" },
  });
  expect(summarized.isError, JSON.stringify(summarized)).not.toBe(true);
  expect(
    parseEvidence(summarized.structuredContent).normalized_result,
  ).toMatchObject({
    kind: "summary",
    parent_evidence_id: evidence.evidence_id,
    summary: {
      documents: expected.documents,
      truncated: true,
      coverage_statuses: { partial: expect.any(Number) },
    },
  });
};

const archive = (objects: readonly string[], hierarchy: readonly string[]) =>
  build({
    "com.apple.ibtool.document.objects": Object.fromEntries(
      objects.map((id) => [id, { class: "UIView" }]),
    ),
    "com.apple.ibtool.document.hierarchy": hierarchy.map((objectID) => ({
      objectID,
    })),
  });

const cases = [
  {
    name: "a later document's root is omitted",
    archives: [
      ["First.nib", archive(["first"], ["first"])],
      ["Second.nib", archive(["second"], ["second"])],
    ] as const,
    hierarchyComplete: [true, false],
    document: "Second.nib",
    omittedEdges: 1,
    unresolvedEdge: false,
  },
  {
    name: "a retained hierarchy edge has an omitted endpoint",
    archives: [
      ["Single.nib", archive(["kept", "omitted"], ["omitted"])],
    ] as const,
    hierarchyComplete: [false],
    document: "Single.nib",
    omittedEdges: 0,
    unresolvedEdge: true,
  },
  {
    name: "a marker-bearing connection source is omitted without losing hierarchy coverage",
    archives: [
      [
        "Connection.nib",
        build({
          "com.apple.ibtool.document.objects": {
            kept: { class: "UIView" },
          },
          "com.apple.ibtool.document.hierarchy": [{ objectID: "kept" }],
          "com.apple.ibtool.document.connections": {
            "missing:hierarchy:source": [
              { type: "outlet", label: "view", destinationId: "kept" },
            ],
          },
        }),
      ],
    ] as const,
    hierarchyComplete: [true],
    document: "Connection.nib",
    omittedEdges: 0,
    unresolvedEdge: false,
    omittedConnections: 2,
  },
];

cliTest.for(cases)(
  "preserves hierarchy and connection coverage through the CLI when $name",
  async (testCase, { cli }) => {
    const {
      archives,
      hierarchyComplete,
      document,
      omittedEdges,
      unresolvedEdge,
    } = testCase;
    const root = await createTestTempDirectory("rea-ib-hierarchy-limits-");
    const app = join(root, "Fixture.app");
    const contents = join(app, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"));
    await writeFile(
      join(contents, "MacOS", "Fixture"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      build({ CFBundleExecutable: "Fixture" }),
    );
    for (const [name, contents] of archives)
      await writeFile(join(resources, name), contents);

    const output = await cli.run({
      arguments: [
        "decode-interface-builder",
        app,
        "--max-objects",
        "2",
        "--json",
      ],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stdout + output.stderr).toBe(0);
    const evidence = parseEvidence(output.json);
    const report = interfaceBuilderAnalysisSchema.parse(
      evidence.normalized_result,
    );
    await verifyMcpParity(app, report);
    expect(
      report.documents.map(({ hierarchy_complete }) => hierarchy_complete),
    ).toEqual(hierarchyComplete);
    expect(report.graph.truncated).toBe(true);
    expect(report.graph.nodes).toHaveLength(2);
    expect(report.graph.edges).toHaveLength(1);
    expect(report.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: `hierarchy:Contents/Resources/${document}`,
        status: hierarchyComplete.every(Boolean) ? "complete" : "partial",
        reason: hierarchyComplete.every(Boolean) ? null : "graph_limit_reached",
        examined: 1,
        omitted: omittedEdges,
      }),
    );
    if ("omittedConnections" in testCase)
      expect(report.graph.coverage).toContainEqual({
        facet: `connections:Contents/Resources/${document}`,
        status: "partial",
        reason: "object_limit_reached",
        examined: 1,
        omitted: testCase.omittedConnections,
      });
    if (unresolvedEdge)
      expect(report.graph.edges[0]).toMatchObject({
        relation: "contains",
        resolution: "unresolved",
        to: null,
        reason: "endpoint_omitted_by_object_limit",
      });

    const viewPath = join(root, "summary.json");
    await writeFile(
      viewPath,
      JSON.stringify({
        source: { kind: "inline", evidence: output.json },
        view: { kind: "summary" },
      }),
    );
    const summaryOutput = await cli.run({
      arguments: ["inspect-analysis-view", viewPath, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(
      summaryOutput.exitCode,
      summaryOutput.stdout + summaryOutput.stderr,
    ).toBe(0);
    expect(parseEvidence(summaryOutput.json).normalized_result).toMatchObject({
      kind: "summary",
      parent_evidence_id: evidence.evidence_id,
      summary: {
        documents: report.documents,
        truncated: true,
        coverage_statuses: { partial: expect.any(Number) },
      },
    });
    for (const [name, contents] of archives)
      expect(await readFile(join(resources, name), "utf8")).toBe(contents);
  },
);
