import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { assertClientJavaScriptFixtureEvidence } from "../../../scripts/verify/clients/javascript-fixture.mjs";
import {
  createJavaScriptApplicationGraph,
  createJavaScriptApplicationNode,
} from "../../../src/domain/javascript/javascriptApplicationGraph.js";
import { createJavaScriptSemanticGraph } from "../../../src/domain/javascript/javascriptSemanticGraph.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { analyzeJavaScriptApplication } from "../../support/javascriptApplicationScope.js";

it("checks native client fixture Evidence, provenance, and every result observation", async () => {
  const target = await createTestTempDirectory("rea-client-evidence-");
  // Independent source exercises the verifier's expectations through production
  // analysis instead of manufacturing a copy of its graph representation.
  await writeFile(
    join(target, "result.js"),
    'export function result() { return { count: 7, clientCompatibility: "REA_CLIENT_FIXTURE" }; }',
  );
  const result = await analyzeJavaScriptApplication({
    input_path: target,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const validated = await assertClientJavaScriptFixtureEvidence(
    result.value,
    target,
  );
  const evidence = validated.evidence;
  expect(evidence.evidence_id).toBe(result.value.evidence_id);
  expect(validated.shapes.length).toBeGreaterThan(0);

  await expect(
    assertClientJavaScriptFixtureEvidence({}, target),
  ).rejects.toThrow();
  await expect(
    assertClientJavaScriptFixtureEvidence(
      {
        ...evidence,
        parameters: { ...evidence.parameters, input_path: target + "/other" },
      },
      target,
    ),
  ).rejects.toThrow("caller's input_path");
  await expect(
    assertClientJavaScriptFixtureEvidence(
      {
        ...evidence,
        subject: { ...evidence.subject, local_path: target + "/other" },
      },
      target,
    ),
  ).rejects.toThrow("resolved artifact");
  await expect(
    assertClientJavaScriptFixtureEvidence(
      {
        ...evidence,
        normalized_result: {
          ...evidence.normalized_result,
          input_path: target + "/other",
        },
      },
      target,
    ),
  ).rejects.toThrow("resolved artifact");

  const withDuplicate = (properties: Record<string, unknown>) => {
    const { graph_id: _graphId, ...originalGraph } =
      evidence.normalized_result.graph;
    const graph = createJavaScriptApplicationGraph({
      ...originalGraph,
      nodes: originalGraph.nodes.map((node) => {
        const observation = node.observations.find(
          (item) =>
            item.properties.semantic_role === "export-return-shapes" &&
            item.properties.exported_name === "result",
        );
        if (observation === undefined) return node;
        const observations = node.observations.map(
          ({ observation_id: _id, identifier_strategy: _strategy, ...value }) =>
            value,
        );
        return createJavaScriptApplicationNode({
          kind: node.kind,
          identity: node.identity,
          observations: [
            ...observations,
            {
              label: observation.label,
              source_map_reference: observation.source_map_reference,
              properties,
              evidence: observation.evidence,
            },
          ],
        });
      }),
    });
    const { graph_id: _semanticGraphId, ...semantic } =
      evidence.normalized_result.semantic_graph;
    return {
      ...evidence,
      normalized_result: {
        ...evidence.normalized_result,
        graph,
        semantic_graph: createJavaScriptSemanticGraph({
          ...semantic,
          application_graph_id: graph.graph_id,
        }),
      },
    };
  };
  const shape = validated.shapes[0]!;
  const coverage = shape.return_shape_coverage;
  assert(coverage !== null && typeof coverage === "object");
  const incomplete = withDuplicate({
    ...shape,
    return_shape_coverage: {
      ...coverage,
      projection_complete: false,
    },
  });
  // Establish schema-valid fixtures so rejection proves the client assertion.
  toolContract("analyze_javascript_application").outputSchema.parse(incomplete);
  await expect(
    assertClientJavaScriptFixtureEvidence(incomplete, target),
  ).rejects.toThrow("complete return-shape coverage");

  const missingLiteral = withDuplicate({ ...shape, static_return_shapes: [] });
  toolContract("analyze_javascript_application").outputSchema.parse(
    missingLiteral,
  );
  await expect(
    assertClientJavaScriptFixtureEvidence(missingLiteral, target),
  ).rejects.toThrow("compatibility literal");
});
