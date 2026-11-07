import { expect, it } from "vitest";

import { createResidualUnknown } from "./residualUnknown.js";
import { reconstructionClaimUnknowns } from "./reconstructionUnknowns.js";

const ev = (digit: string) => `ev_${digit.repeat(64)}`;
const base = {
  severity: "high" as const,
  domain: "function-comparison",
  supporting_evidence_ids: [ev("a"), ev("b")],
  contradicting_evidence_ids: [],
  required_authority: null,
  required_confidence: "derived" as const,
  required_environment: null,
  recommended_probes: [],
};

it("keeps explicit dependencies while excluding unrelated scoped unknowns", () => {
  const comparisonId = ev("a");
  const other = createResidualUnknown(
    {
      ...base,
      question: "Other dimension",
      comparison_conclusion_scope: {
        comparison_evidence_id: comparisonId,
        dimensions: ["pseudocode"],
      },
      relationships: [],
    },
    ev("c"),
    null,
  );
  const calls = createResidualUnknown(
    {
      ...base,
      question: "Call dimension",
      comparison_conclusion_scope: {
        comparison_evidence_id: comparisonId,
        dimensions: ["calls"],
      },
      relationships: [{ type: "depends-on", unknown_id: other.unknown_id }],
    },
    ev("d"),
    null,
  );
  const unrelated = createResidualUnknown(
    {
      ...base,
      question: "Unrelated dimension",
      comparison_conclusion_scope: {
        comparison_evidence_id: comparisonId,
        dimensions: ["pseudocode"],
      },
      relationships: [],
    },
    ev("e"),
    null,
  );
  const selected = reconstructionClaimUnknowns(
    new Map([
      [calls.unknown_id, calls],
      [other.unknown_id, other],
      [unrelated.unknown_id, unrelated],
    ]),
    comparisonId,
    [ev("b")],
    ["calls"],
  );
  expect(selected.map(({ unknown_id }) => unknown_id)).toEqual([
    calls.unknown_id,
    other.unknown_id,
  ]);
});

it("aggregates constituent unknowns without importing another comparison's scope", () => {
  const scoped = (comparisonId: string) =>
    createResidualUnknown(
      {
        ...base,
        question: "Unresolved pseudocode",
        comparison_conclusion_scope: {
          comparison_evidence_id: comparisonId,
          dimensions: ["pseudocode"],
        },
        relationships: [],
      },
      ev("c"),
      null,
    );
  const own = scoped(ev("a"));
  const foreign = scoped(ev("b"));
  const heads = new Map([
    [own.unknown_id, own],
    [foreign.unknown_id, foreign],
  ]);
  expect(
    reconstructionClaimUnknowns(heads, ev("a"), [ev("b")], ["overall"]),
  ).toEqual([own]);
  expect(
    reconstructionClaimUnknowns(heads, ev("a"), [ev("b")], ["assembly"]),
  ).toEqual([]);
});
