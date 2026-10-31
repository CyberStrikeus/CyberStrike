import { expect, it } from "vitest";
import { completeApplicationCoverage } from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import { createJavaScriptApplicationNode } from "../../domain/javascript/javascriptApplicationGraph.js";
import { JavaScriptArtifactGraphAccumulator } from "./JavaScriptArtifactGraphAccumulator.js";
import { artifactObservationEvidence } from "./JavaScriptArtifactGraphEvidence.js";

const nodeInput = (value: string, sha256 = "a".repeat(64)) => ({
  kind: "javascript-asset",
  identity: {
    strategy: "content-digest",
    stability: "global-exact",
    sha256,
  },
  observations: [
    {
      label: value,
      properties: { value },
      evidence: artifactObservationEvidence({
        sha256,
        path: "main.js",
        operation: "accumulator-test",
        coverage: completeApplicationCoverage(),
      }),
    },
  ],
});

it("retains live references, exact deduplication and canonical output across later additions", () => {
  const accumulator = new JavaScriptArtifactGraphAccumulator();
  const inputs = ["雪😀", "alpha", "beta"].map((value) => nodeInput(value));
  const firstInput = inputs[0];
  if (firstInput === undefined) throw new Error("Missing first input");
  const node = accumulator.addNode(firstInput);
  const observations = node.observations;
  const firstObservation = observations[0];
  expect(accumulator.addNode(firstInput)).toBe(node);
  expect(node.observations).toBe(observations);
  expect(observations).toHaveLength(1);
  expect(observations[0]).not.toBe(firstObservation);
  for (const input of inputs.slice(1))
    expect(accumulator.addNode(input)).toBe(node);
  const secondNode = accumulator.addNode(nodeInput("other", "b".repeat(64)));
  const firstSnapshot = accumulator.nodes();
  const expectedNode = createJavaScriptApplicationNode({
    ...firstInput,
    observations: inputs.flatMap((input) => input.observations),
  });
  expect(firstSnapshot).toEqual([expectedNode, secondNode]);
  expect(firstSnapshot[0]).toBe(node);
  expect(node.observations).toBe(observations);
  const finalizedObservations = [...observations];
  expect(accumulator.nodes()).not.toBe(firstSnapshot);
  expect(accumulator.nodes()).toEqual(firstSnapshot);
  for (const [index, observation] of finalizedObservations.entries())
    expect(node.observations[index]).toBe(observation);

  const later = nodeInput("later");
  expect(accumulator.addNode(later)).toBe(node);
  // Updating a duplicate after final sorting must use its new array index.
  expect(accumulator.addNode(firstInput)).toBe(node);
  expect(accumulator.nodes()).toEqual([
    createJavaScriptApplicationNode({
      ...firstInput,
      observations: [...inputs, later].flatMap((input) => input.observations),
    }),
    secondNode,
  ]);
  expect(node.observations).toBe(observations);
});

it("preserves first-input duplicates and retains the last occurrence when later merged", () => {
  const accumulator = new JavaScriptArtifactGraphAccumulator();
  const first = nodeInput("same");
  const distinct = nodeInput("distinct");
  const node = accumulator.addNode({
    ...first,
    observations: [...first.observations, ...first.observations],
  });
  const observations = node.observations;
  const lastInitial = observations[1];
  expect(accumulator.nodes()[0]?.observations).toHaveLength(2);
  expect(accumulator.addNode(distinct)).toBe(node);
  expect(accumulator.nodes()).toEqual([
    createJavaScriptApplicationNode({
      ...first,
      observations: [...first.observations, ...distinct.observations],
    }),
  ]);
  expect(node.observations).toBe(observations);
  expect(observations).toContain(lastInitial);
  // A repeated observation inside an incoming batch also collapses to one.
  accumulator.addNode({
    ...distinct,
    observations: [...distinct.observations, ...distinct.observations],
  });
  expect(accumulator.nodes()[0]?.observations).toHaveLength(2);
});
