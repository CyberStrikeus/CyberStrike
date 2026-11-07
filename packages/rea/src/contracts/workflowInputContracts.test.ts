import { describe, expect, it } from "vitest";

import { managedNativeVerificationInputSchema } from "../domain/managed/managedNativeVerificationSchemas.js";
import { toolContract } from "./toolContracts.js";
import { toolInputSchemaWithMetadata } from "./toolSchemaMetadata.js";

import { traceJavaScriptSemanticsRequestSchema } from "./javascript/applicationWorkflowInputContracts.js";
import { JAVASCRIPT_FEATURE_TRACE_EXAMPLE } from "./javascript/javascriptApplicationWorkflowExamples.js";
import {
  MANAGED_APPLICATION_GRAPH_EXAMPLE,
  MANAGED_MEMBER_COMPARISON_EXAMPLE,
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
} from "./managed/managedWorkflowExamples.js";
import { managedApplicationGraphReferenceInputSchema } from "../domain/managed/managedApplicationGraph.js";

describe("workflow input contracts", () => {
  it("rejects application Evidence ID references and duplicate inline records", () => {
    const query = {
      seed: { kind: "literal" as const, value: "renderer" },
      direction: "callers" as const,
    };
    expect(
      traceJavaScriptSemanticsRequestSchema.safeParse({ query }).success,
    ).toBe(false);

    const evidence = JAVASCRIPT_FEATURE_TRACE_EXAMPLE.application;
    expect(
      traceJavaScriptSemanticsRequestSchema.safeParse({
        application: evidence,
        application_evidence_id: evidence.evidence_id,
        query,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate inline managed Evidence records", () => {
    expect(
      toolContract("compare_managed_members").inputSchema.safeParse({
        left: MANAGED_MEMBER_COMPARISON_EXAMPLE.left,
        right: MANAGED_MEMBER_COMPARISON_EXAMPLE.left,
      }).success,
    ).toBe(false);

    expect(
      managedApplicationGraphReferenceInputSchema.safeParse({
        managed_artifact: MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members,
        managed_members: MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members,
      }).success,
    ).toBe(false);
    expect(
      managedApplicationGraphReferenceInputSchema.safeParse({}).success,
    ).toBe(false);
  });

  it.each([
    {
      name: "one observation reusing the boundary",
      observations: [MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries],
      issues: [
        {
          path: ["native_observations", 0],
          message:
            "Native observation Evidence must be distinct from managed boundary Evidence",
        },
      ],
    },
    {
      name: "repeated native observations",
      observations: [
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations[0],
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations[0],
      ],
      issues: [
        {
          path: ["native_observations", 1],
          message: "Native observation Evidence IDs must be unique",
        },
      ],
    },
    {
      name: "repeated observations reusing the boundary",
      observations: [
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      ],
      issues: [
        {
          path: ["native_observations", 0],
          message:
            "Native observation Evidence must be distinct from managed boundary Evidence",
        },
        {
          path: ["native_observations", 1],
          message:
            "Native observation Evidence must be distinct from managed boundary Evidence",
        },
        {
          path: ["native_observations", 1],
          message: "Native observation Evidence IDs must be unique",
        },
      ],
    },
    {
      name: "distinct native observations",
      observations: MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations,
      issues: [],
    },
  ])(
    "preserves managed/native diagnostics for $name",
    async ({ observations, issues }) => {
      const input = {
        managed_boundaries:
          MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
        native_observations: observations,
      };
      const contract = toolContract("verify_managed_native_boundaries");
      for (const schema of [
        managedNativeVerificationInputSchema,
        contract.inputSchema,
        toolInputSchemaWithMetadata(contract),
      ]) {
        const result = await schema["~standard"].validate(input);
        expect(
          result.issues?.map(({ path, message }) => ({ path, message })) ?? [],
        ).toEqual(issues);
        if (issues.length === 0) expect(result).toEqual({ value: input });
      }
    },
  );
});
