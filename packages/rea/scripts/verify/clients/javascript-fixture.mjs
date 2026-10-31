import assert from "node:assert/strict";
import { toolContract } from "../../../dist/contracts/toolContracts.js";
import { assertJavaScriptApplicationInputPaths } from "../../lib/javascript-application-paths.mjs";

export const CLIENT_JAVASCRIPT_FIXTURE_SOURCE =
  'export function result() { return { clientCompatibility: "REA_CLIENT_FIXTURE", count: 7 }; }\n';

/** Validate the same analyst result across native client transports. */
export const assertClientJavaScriptFixtureEvidence = async (
  value,
  inputPath,
) => {
  const evidence = toolContract(
    "analyze_javascript_application",
  ).outputSchema.parse(value);
  assert(
    Array.isArray(evidence.normalized_result.graph?.nodes),
    "Client must return the full application graph",
  );
  await assertJavaScriptApplicationInputPaths(evidence, inputPath);
  const shapes = evidence.normalized_result.graph.nodes
    .flatMap((node) => node.observations)
    .map((observation) => observation.properties)
    .filter(
      (properties) =>
        properties.semantic_role === "export-return-shapes" &&
        properties.exported_name === "result",
    );
  assert(shapes.length > 0, "Client must return the fixture's result export");
  assert(
    shapes.every((shape) => shape.return_shape_coverage?.projection_complete),
    "Every fixture result observation must have complete return-shape coverage",
  );
  for (const shape of shapes) {
    const fields = shape.static_return_shapes.flatMap((item) => item.fields);
    assert(
      fields.some(
        (field) =>
          field.path === "/clientCompatibility" &&
          field.state === "literal" &&
          field.value === "REA_CLIENT_FIXTURE",
      ),
      "Client must return the fixture's compatibility literal",
    );
    assert(
      fields.some(
        (field) =>
          field.path === "/count" &&
          field.state === "literal" &&
          field.value === 7,
      ),
      "Client must return the fixture's count literal",
    );
  }
  return { evidence, shapes };
};
