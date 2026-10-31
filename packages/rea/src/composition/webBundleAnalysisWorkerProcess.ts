import { analyzeCapturedWebScript } from "../domain/webBundleAnalyzer.js";
import {
  serveWebBundleAnalysisWorker,
  type WebBundleScriptAnalyzer,
} from "../browser/WebBundleAnalysisWorkerServer.js";

const analyze: WebBundleScriptAnalyzer = (script) =>
  analyzeCapturedWebScript(script);

try {
  await serveWebBundleAnalysisWorker(analyze);
} catch (cause: unknown) {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exitCode = 1;
}
