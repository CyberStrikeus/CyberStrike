import { expect, it } from "vitest";
import { withAdmittedAnalysis } from "../../../src/server/analysisAdmission.js";
import { executeFunctionAnalysisEvidence } from "../../../src/application/FunctionAnalysisEvidence.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { ghidraFunctionDossier } from "../../../src/domain/ghidraValues.fixture.js";
import { ok } from "../../../src/domain/result.js";

it("retains the caller reason when fixed MCP admission prevents function work", async () => {
  const reason = { request: "cancelled before provider admission" };
  const signal = AbortSignal.abort(reason);
  let calls = 0;
  const analysis = {
    execute: async () => {
      calls++;
      return ok(
        createAnalysisExecution(ghidraFunctionDossier(), {
          id: "fixture",
          name: "Synthetic dossier",
          version: "1",
        }),
      );
    },
  };
  const admitted = await withAdmittedAnalysis({ kind: "fixed", analysis })(
    "analyze_function",
    signal,
    () =>
      executeFunctionAnalysisEvidence(
        analysis,
        { procedure: "fixture" },
        undefined,
        { signal },
      ),
  );
  const result = admitted.ok ? admitted.value : admitted;
  if (result.ok) throw new Error("Expected pre-admission cancellation");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(calls).toBe(0);
});
