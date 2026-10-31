import { expect, it } from "vitest";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import { projectJavaScriptModuleSemantics } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  javaScriptForwardedTransferRemediation,
  javaScriptTransferByteBudget,
  javaScriptTransferCeilingRemediation,
  measureJavaScriptModuleTransfer,
} from "./JavaScriptAnalysisTransfer.js";

it("distinguishes the adjustable transfer file ceiling from the fixed record and maximum ceilings", () => {
  const ir = analyzeJavaScriptSemantics(
    "export function add(value) { return value + 1; }",
  );
  const module = projectJavaScriptModuleSemantics(ir);
  const measured = measureJavaScriptModuleTransfer(module);
  let caught: unknown;
  try {
    measureJavaScriptModuleTransfer(module, measured.bytes - 1);
  } catch (cause) {
    caught = cause;
  }
  if (!(caught instanceof AnalysisResourceConstraintError))
    throw new Error("Expected a transfer ceiling refusal");
  const projected = projectAnalysisError(caught);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "transport",
      reported_limits: {
        transfer_record_bytes: 8388608,
        transfer_file_bytes: measured.bytes - 1,
      },
    },
  });
  expect(projected.remediation.action).toBe(
    javaScriptTransferCeilingRemediation(measured.bytes - 1),
  );
  const forwarded = javaScriptForwardedTransferRemediation(
    caught.reportedLimits,
  );
  expect(forwarded).toBe(projected.remediation.action);
  const recordOnly = javaScriptForwardedTransferRemediation({
    transfer_record_bytes: 8_388_608,
  });
  expect(recordOnly).toBe(javaScriptTransferCeilingRemediation(undefined));
  expect(javaScriptForwardedTransferRemediation(null)).toBeUndefined();
});

it("keeps the 2 GiB transfer file maximum fixed", () => {
  const maximum = 2_147_483_648;
  expect(javaScriptTransferByteBudget(maximum * 8)).toBe(maximum);
  expect(javaScriptTransferByteBudget(maximum * 16)).toBe(maximum);
  expect(
    javaScriptForwardedTransferRemediation({ transfer_file_bytes: maximum }),
  ).toBe(javaScriptTransferCeilingRemediation(maximum));
});
