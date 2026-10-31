import { describe, expect, it } from "vitest";
import { z } from "zod";

import { analysisViewSourceSchema } from "../domain/analysisView/analysisViewRequest.js";
import { evidenceSchema } from "../domain/evidence.js";
import { evidenceBundleSchema } from "../domain/evidenceBundle.js";
import {
  getEvidenceInputContract,
  isDeclaredEvidenceInput,
} from "../domain/evidenceInputContract.js";
import {
  evidenceFileReferenceSchema,
  evidenceInputSchema,
  evidenceSourceInputSchema,
  retainedEvidenceReferenceSchema,
} from "../domain/evidenceReference.js";
import { exportEnvironmentBundleInputSchema } from "../domain/environmentBundleExport.js";
import { TOOL_CONTRACTS } from "./toolContracts.js";

type Owner = "record" | "reference" | "source-or-bundle";
const owners = z.registry<{ readonly owner: Owner }>();
owners.add(evidenceSchema, { owner: "record" });
owners.add(retainedEvidenceReferenceSchema, { owner: "reference" });
for (const schema of [
  evidenceBundleSchema,
  evidenceSourceInputSchema,
  evidenceFileReferenceSchema,
  analysisViewSourceSchema,
  exportEnvironmentBundleInputSchema.shape.source,
])
  owners.add(schema, { owner: "source-or-bundle" });

type SchemaChild = readonly [
  location: string,
  schema: z.ZodType,
  uncompiledEdge?: string,
];

/** Walk schema declarations only, including containers unsupported by the compiler. */
const children = (schema: z.ZodType): readonly SchemaChild[] => {
  if (schema instanceof z.ZodObject)
    return [
      ...Object.entries(schema.shape).map(([key, child]): SchemaChild => [
        key,
        child as z.ZodType,
      ]),
      ...(schema.def.catchall === undefined
        ? []
        : [
            [
              "catchall",
              schema.def.catchall as z.ZodType,
              "object catchall",
            ] as const,
          ]),
    ];
  if (schema instanceof z.ZodArray)
    return [["[]", schema.element as z.ZodType]];
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodXor)
    return schema.options.map((option, index) => [
      `union[${index}]`,
      option as z.ZodType,
    ]);
  if (schema instanceof z.ZodIntersection)
    return [
      ["intersection.left", schema.def.left as z.ZodType],
      ["intersection.right", schema.def.right as z.ZodType],
    ];
  if (schema instanceof z.ZodTuple)
    return [
      ...schema.def.items.map((item, index): SchemaChild => [
        `tuple[${index}]`,
        item as z.ZodType,
      ]),
      ...(schema.def.rest === null
        ? []
        : [["tuple.rest", schema.def.rest as z.ZodType] as const]),
    ];
  if (schema instanceof z.ZodRecord || schema instanceof z.ZodMap)
    return [
      ["keys", schema.keyType as z.ZodType],
      ["values", schema.valueType as z.ZodType],
    ];
  if (schema instanceof z.ZodSet)
    return [["set.values", schema.def.valueType as z.ZodType]];
  if (schema instanceof z.ZodPipe)
    return [
      ["pipe.input", schema.in as z.ZodType],
      ["pipe.output", schema.out as z.ZodType],
    ];
  if (schema instanceof z.ZodLazy)
    return [["lazy", schema.unwrap() as z.ZodType]];
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodExactOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodPromise ||
    schema instanceof z.ZodSuccess
  )
    return [[schema.type, schema.unwrap() as z.ZodType]];
  return [];
};

const declarationIssues = (root: z.ZodType): string[] => {
  const problems = new Set<string>();
  const walk = (
    schema: z.ZodType,
    path: readonly string[],
    ancestors: readonly z.ZodType[],
    active: ReadonlySet<z.ZodType>,
    uncompiledEdges: readonly string[],
  ): void => {
    if (isDeclaredEvidenceInput(schema)) {
      // A root may compile one supported field while losing a second field
      // inside an unsupported container. Check the complete path, not just it.
      for (const owner of [...ancestors, schema])
        if (!getEvidenceInputContract(owner).hasEvidence)
          problems.add(
            `${path.join(".")}: declared Evidence hidden by unsupported ${owner.type}`,
          );
      // A skipping default never records which borrowing union branch won.
      // Use prefault when an authored default must enter source selection.
      const skippedDefault = ancestors.findIndex(
        (owner) => owner instanceof z.ZodDefault,
      );
      if (
        skippedDefault !== -1 &&
        ancestors
          .slice(skippedDefault + 1)
          .some((owner) => owner instanceof z.ZodUnion)
      )
        problems.add(
          `${path.join(".")}: Evidence union selection requires prefault instead of a skipping default`,
        );
      for (const edge of uncompiledEdges)
        problems.add(
          `${path.join(".")}: declared Evidence hidden by unsupported ${edge}`,
        );
      return;
    }
    const owner = owners.get(schema)?.owner;
    if (owner === "source-or-bundle") return;
    if (owner === "record" || owner === "reference") {
      problems.add(
        `${path.join(".")}: bare ${owner} requires the shared Evidence input declaration`,
      );
      return;
    }
    if (active.has(schema)) return;
    const next = new Set(active);
    next.add(schema);
    for (const [location, child, edge] of children(schema))
      walk(
        child,
        [...path, location],
        [...ancestors, schema],
        next,
        edge === undefined ? uncompiledEdges : [...uncompiledEdges, edge],
      );
  };
  walk(root, ["input"], [], new Set(), []);
  return [...problems].sort();
};

describe("public Evidence input declarations", () => {
  it("requires all catalog consumers to use the shared logical input owner", () => {
    const problems = TOOL_CONTRACTS.flatMap((contract) =>
      declarationIssues(contract.inputSchema).map(
        (issue) => `${contract.name}: ${issue}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it("detects bare/described records and independently declared references", () => {
    expect(
      declarationIssues(
        z.strictObject({
          left: evidenceSchema.describe("Complete source"),
          right: retainedEvidenceReferenceSchema.describe("Retained source"),
        }),
      ),
    ).toEqual([
      "input.left: bare record requires the shared Evidence input declaration",
      "input.right: bare reference requires the shared Evidence input declaration",
    ]);
  });

  it("does not let a supported sibling conceal an unsupported marked input path", () => {
    const schema = z.strictObject({
      supported: evidenceInputSchema,
      records: z.record(z.string(), evidenceInputSchema),
    });
    expect(getEvidenceInputContract(schema).hasEvidence).toBe(true);
    expect(declarationIssues(schema)).toEqual([
      "input.records.values: declared Evidence hidden by unsupported record",
    ]);
    const dynamic = z
      .object({ supported: evidenceInputSchema })
      .catchall(evidenceInputSchema);
    expect(declarationIssues(dynamic)).toEqual([
      "input.catchall: declared Evidence hidden by unsupported object catchall",
    ]);
  });

  it("follows nested optional/default/union declarations and stops at collection owners", () => {
    const schema = z.strictObject({
      layers: z
        .array(
          z.strictObject({
            source: evidenceInputSchema.describe("Selected source").optional(),
          }),
        )
        .default([]),
      choice: z.union([
        z.strictObject({
          kind: z.literal("source"),
          source: evidenceInputSchema,
        }),
        z.strictObject({ kind: z.literal("none") }),
      ]),
      bundle: evidenceBundleSchema,
      fileSource: evidenceSourceInputSchema.describe("Explicit file authority"),
    });
    expect(declarationIssues(schema)).toEqual([]);
  });

  it("rejects skipping defaults above Evidence-bearing request unions", () => {
    const choice = z.union([
      z.strictObject({
        kind: z.literal("source"),
        source: evidenceInputSchema,
      }),
      z.strictObject({ kind: z.literal("none") }),
    ]);
    const fallback = {
      kind: "source" as const,
      source: {
        kind: "retained-evidence" as const,
        evidence_id: `ev_${"a".repeat(64)}`,
      },
    };
    expect(declarationIssues(choice.default(fallback))).toEqual([
      "input.default.union[0].source: Evidence union selection requires prefault instead of a skipping default",
    ]);
    expect(declarationIssues(choice.prefault(fallback))).toEqual([]);
  });
});
