import { describe, expect, it } from "vitest";
import { z } from "zod";

import { advertisedInputExamples } from "./advertisedInputExamples.js";
import { evidenceInputSchema } from "../domain/evidenceReference.js";
import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "./javascript/javascriptApplicationWorkflowExamples.js";
import { TOOL_CONTRACTS } from "./toolContracts.js";
import { evidenceSchema } from "../domain/evidence.js";
import type { JsonValue } from "../domain/jsonValue.js";

const evidence = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
const retained = {
  kind: "retained-evidence",
  evidence_id: evidence.evidence_id,
} as const;

const embedsEvidence = (value: JsonValue): boolean => {
  if (Array.isArray(value)) return value.some(embedsEvidence);
  if (value === null || typeof value !== "object") return false;
  return (
    evidenceSchema.safeParse(value).success ||
    Object.values(value).some(embedsEvidence)
  );
};

describe("advertised input examples", () => {
  it("shows embedded Evidence as its exact retained reference", () => {
    const inputSchema = z.strictObject({
      left: evidenceInputSchema,
      right: z.array(evidenceInputSchema),
      label: z.string(),
    });
    expect(
      advertisedInputExamples({
        inputSchema,
        examples: [
          {
            title: "Inline",
            input: { left: evidence, right: [evidence], label: "a" },
          },
          {
            title: "Retained",
            input: { left: retained, right: [retained], label: "a" },
          },
          { title: "Other", input: { left: retained, right: [], label: "b" } },
        ],
      }),
    ).toEqual([
      { left: retained, right: [retained], label: "a" },
      { left: retained, right: [], label: "b" },
    ]);
  });

  it("leaves the advertisement when only inline Evidence is accepted", () => {
    const inputSchema = z.strictObject({
      left: z.union([evidenceSchema, z.string()]),
    });
    expect(
      advertisedInputExamples({
        inputSchema,
        examples: [
          { title: "Inline", input: { left: evidence } },
          { title: "Literal", input: { left: "value" } },
        ],
      }),
    ).toEqual([{ left: "value" }]);
  });

  it("advertises only distinct canonical inputs without complete Evidence", () => {
    for (const contract of TOOL_CONTRACTS) {
      const examples = advertisedInputExamples(contract);
      const serialized = examples.map((example) => JSON.stringify(example));
      expect(new Set(serialized).size, contract.name).toBe(examples.length);
      for (const example of examples) {
        expect(contract.inputSchema.safeParse(example).success).toBe(true);
        expect(embedsEvidence(example), contract.name).toBe(false);
      }
    }
  });
});
