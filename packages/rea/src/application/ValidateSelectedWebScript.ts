import { createHash } from "node:crypto";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type {
  SelectedWebScriptArtifacts,
  SelectedWebScriptInput,
} from "../domain/webScriptArtifacts.js";
import type { ExportedWebScript } from "../domain/webScriptExport.js";

/** Bind actual source text to the selected manifest entry before analysis. */
export const validateSelectedWebScript = (
  input: SelectedWebScriptInput,
  data: SelectedWebScriptArtifacts,
  operation: string,
): Result<ExportedWebScript, AnalysisError> => {
  const selected = data.manifest.scripts[input.script_index];
  if (
    selected === undefined ||
    selected.content.state !== "exported" ||
    selected.content.sha256 !== data.sourceFile.sha256 ||
    selected.content.bytes !== data.sourceFile.bytes ||
    Buffer.byteLength(data.source) !== data.sourceFile.bytes ||
    createHash("sha256").update(data.source, "utf8").digest("hex") !==
      data.sourceFile.sha256 ||
    data.manifestFile.path !== input.manifest_path
  )
    return err(
      new AnalysisOutputError(
        operation,
        "Artifact port changed the selected script/source identity.",
      ),
    );
  return ok(selected);
};

/** Carry reported capture context alongside independently verified manifest bytes. */
export const capturedWebManifestIdentity = (
  data: SelectedWebScriptArtifacts,
) => ({
  ...data.manifestFile,
  reported_output_directory: data.manifest.output_directory,
  capture_sha256: data.manifest.capture_sha256,
  capture_path: data.manifest.capture_path,
  capture_kind: data.manifest.capture_kind,
  capture_completeness: data.manifest.capture_completeness,
  source_evidence_id: data.manifest.source_evidence_id,
});
