import { expect, it } from "vitest";
import { analyzeAndAdoptJavaScriptArtifactFiles } from "./JavaScriptArtifactAnalysis.js";
import { createJavaScriptSemanticGraphProjection } from "./JavaScriptSemanticGraphBuilder.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { err, ok } from "../../domain/result.js";

const source = (path: string): JavaScriptArtifactFile => ({
  path,
  container_sha256: "a".repeat(64),
  sha256: "b".repeat(64),
  bytes: 20,
  inventory_artifact_id: path,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: "export const x = 1;" },
});

it.each([false, true])(
  "marks only the earlier omitted projection when a later source %s is cancelled",
  async (cancelled) => {
    const files = [source("first.js"), source("second.js")];
    const javascript = analyzeJavaScriptStaticSource("export const x = 1;");
    const error = new AnalysisResourceConstraintError(
      "analyze_javascript_application",
      "memory",
      "earlier projection omitted",
      {},
      {},
    );
    let call = 0;
    const worker = {
      analyze: async () => {
        call++;
        const value = { javascript, module: null, projection: null };
        if (call === 1) return ok(value);
        const revokedStaticProjections = [{ sourceIndex: 0, error }];
        return cancelled
          ? err({
              ...value,
              error: new AnalysisCancelledError(
                "analyze_javascript_application",
              ),
              revokedStaticProjections,
            })
          : ok({ ...value, revokedStaticProjections });
      },
    };
    const outcome = await analyzeAndAdoptJavaScriptArtifactFiles(
      {
        files,
        unavailable_relevant_files: [],
        containers: [],
        text_bytes_read: 40,
        invalid_utf8_files: 0,
      },
      worker,
      createJavaScriptSemanticGraphProjection(),
      async () => {},
    );
    expect(outcome.analysis.files[0]).toMatchObject({
      file: { path: "first.js" },
      javascript: { parse_status: "complete" },
      application_projection_failure: {
        reason: expect.stringContaining("earlier projection omitted"),
      },
    });
    expect(outcome.analysis.files[1]).not.toHaveProperty(
      "application_projection_failure",
    );
    expect(outcome.interruption === null).toBe(!cancelled);
  },
);
