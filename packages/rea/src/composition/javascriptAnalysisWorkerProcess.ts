import { moduleResolutionModeForJavaScriptReference } from "../domain/javascript/javascriptModuleResolutionMode.js";
import { parseJavaScriptSource } from "../domain/javascript/javascriptSourceParser.js";
import { analyzeParsedJavaScriptStaticSourceSteps } from "../domain/javascript/javascriptStaticAnalysis.js";
import { analyzeParsedJavaScriptSemanticsSteps } from "../domain/javascript/javascriptSemanticAnalysis.js";
import { failedJavaScriptStaticAnalysis } from "../domain/javascript/javascriptStaticAnalysisHelpers.js";
import { projectJavaScriptModuleSemantics } from "../domain/javascript/javascriptModuleSemanticIr.js";
import {
  javaScriptTransferByteBudget,
  measureJavaScriptModuleTransfer,
} from "../javascript/analysis/JavaScriptAnalysisTransfer.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { projectJavaScriptSemanticFileSteps } from "../application/javascript/JavaScriptSemanticGraphBuilder.js";
import { completeJavaScriptAnalysisSteps } from "../application/javascript/JavaScriptAnalysisControl.js";
import {
  serveJavaScriptAnalysisWorker,
  type JavaScriptSourceWorkerAnalyzer,
} from "../javascript/analysis/JavaScriptAnalysisWorkerServer.js";

const analyze: JavaScriptSourceWorkerAnalyzer = async (
  file,
  capacity,
  callbacks,
) => {
  if (!file.text.included)
    throw new TypeError("JavaScript worker requires decoded source text");
  await callbacks.phase("parse");
  let parsed = parseJavaScriptSource(file.text.value, file.path);
  if (parsed === null) {
    await callbacks.checkpoint(failedJavaScriptStaticAnalysis());
    return null;
  }
  await callbacks.phase("static");
  const facts = await completeJavaScriptAnalysisSteps(
    analyzeParsedJavaScriptStaticSourceSteps(file.text.value, parsed),
  );
  const resultBudgetBytes = await callbacks.checkpoint(facts);
  if (facts.parse_status === "failed") return null;
  if (resultBudgetBytes === 0)
    throw new AnalysisResourceConstraintError(
      "analyze_javascript_application",
      "memory",
      `The parent reserved its remaining result capacity for static observations; semantic analysis of ${file.path} was not started`,
      { semantic_result_budget_bytes: 0 },
    );
  await callbacks.phase("semantic");
  const ir = await completeJavaScriptAnalysisSteps(
    analyzeParsedJavaScriptSemanticsSteps(
      parsed,
      moduleResolutionModeForJavaScriptReference(file.path, "static-import"),
      capacity.nodes,
    ),
  );
  parsed = null;
  const module = projectJavaScriptModuleSemantics(ir);
  const measured = measureJavaScriptModuleTransfer(
    module,
    javaScriptTransferByteBudget(resultBudgetBytes),
  );
  if (measured.retentionBytes > resultBudgetBytes)
    throw new AnalysisResourceConstraintError(
      "analyze_javascript_application",
      "memory",
      `Completed module facts for ${file.path} exceed the parent's offered result budget; static facts were retained`,
      {
        semantic_result_budget_bytes: resultBudgetBytes,
        module_transfer_bytes: measured.bytes,
      },
    );
  await callbacks.phase("projection");
  const projection = await completeJavaScriptAnalysisSteps(
    projectJavaScriptSemanticFileSteps(
      file,
      ir,
      capacity,
      facts.electron.call_paths,
    ),
  );
  return { module, projection };
};

try {
  await serveJavaScriptAnalysisWorker(analyze);
} catch (cause: unknown) {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exitCode = 1;
}
