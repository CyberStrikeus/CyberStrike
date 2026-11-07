import { expect, it } from "vitest";
import { z } from "zod";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  binaryLayoutSummaryViewResultSchema,
  javascriptApplicationSummaryViewResultSchema,
  projectAnalysisView,
  analysisViewRequestSchema,
} from "../domain/analysisView/analysisView.js";
import {
  analysisViewCaptureEvidence,
  analysisViewJavaScriptEvidence,
  analysisViewLayoutEvidence,
  environmentStateCaptureFixture,
} from "../../tests/fixtures/analysisView.js";
import { toolContract } from "./toolContracts.js";

const projectSummary = (parent: {
  readonly evidence_id: string;
  readonly operation: string;
  readonly normalized_result: unknown;
  readonly limitations: readonly string[];
}) =>
  projectAnalysisView(
    {
      evidenceId: parent.evidence_id,
      operation: parent.operation,
      normalizedResult: parent.normalized_result,
      limitations: parent.limitations,
    },
    { kind: "summary" },
  );

it("advertises only that operation's summary from analysis detail outputs", () => {
  const layout = projectSummary(analysisViewLayoutEvidence());
  const javascript = projectSummary(analysisViewJavaScriptEvidence());
  if (!layout.ok || !javascript.ok) throw new Error("Expected summaries");
  expect(
    binaryLayoutSummaryViewResultSchema.safeParse(layout.value).success,
  ).toBe(true);
  expect(
    javascriptApplicationSummaryViewResultSchema.safeParse(javascript.value)
      .success,
  ).toBe(true);
  expect(
    binaryLayoutSummaryViewResultSchema.safeParse(javascript.value).success,
  ).toBe(false);

  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validators = Object.fromEntries(
    (
      [
        "inspect_binary_layout",
        "analyze_javascript_application",
        "inspect_analysis_view",
      ] as const
    ).map((name) => [
      name,
      ajv.compile(z.toJSONSchema(toolContract(name).outputSchema)),
    ]),
  );
  const layoutReceipt = {
    ...analysisViewLayoutEvidence(),
    normalized_result: layout.value,
  };
  const javascriptReceipt = {
    ...analysisViewJavaScriptEvidence(),
    normalized_result: javascript.value,
  };
  expect(validators.inspect_binary_layout!(layoutReceipt)).toBe(true);
  expect(validators.analyze_javascript_application!(javascriptReceipt)).toBe(
    true,
  );
  const parent = analysisViewCaptureEvidence(environmentStateCaptureFixture());
  const captureParent = {
    evidenceId: parent.evidence_id,
    operation: parent.operation,
    normalizedResult: parent.normalized_result,
    parameters: parent.parameters,
    subject: parent.subject,
    limitations: parent.limitations,
  };
  const captureSummary = projectAnalysisView(captureParent, {
    kind: "summary",
  });
  if (!captureSummary.ok) throw captureSummary.error;
  const captureReceipt = { ...parent, normalized_result: captureSummary.value };
  expect(validators.inspect_analysis_view!(captureReceipt)).toBe(true);
  expect(
    validators.inspect_binary_layout!({
      ...layoutReceipt,
      normalized_result: captureSummary.value,
    }),
  ).toBe(false);
  expect(
    validators.analyze_javascript_application!({
      ...javascriptReceipt,
      normalized_result: captureSummary.value,
    }),
  ).toBe(false);
  for (const kind of [
    "api-surface",
    "environment-manifest",
    "environment-state",
  ] as const) {
    const projected = projectAnalysisView(
      captureParent,
      analysisViewRequestSchema.parse({ kind }),
    );
    if (!projected.ok) throw projected.error;
    const receipt = { ...parent, normalized_result: projected.value };
    expect(validators.inspect_analysis_view!(receipt), kind).toBe(true);
    expect(
      validators.inspect_binary_layout!({
        ...layoutReceipt,
        normalized_result: projected.value,
      }),
      kind,
    ).toBe(false);
    expect(
      validators.analyze_javascript_application!({
        ...javascriptReceipt,
        normalized_result: projected.value,
      }),
      kind,
    ).toBe(false);
  }
});
