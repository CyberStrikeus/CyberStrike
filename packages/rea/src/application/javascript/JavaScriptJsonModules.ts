import type { JavaScriptJsonModuleObservation } from "./JavaScriptArtifactAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";

/** Parse one approved JSON module without evaluating JavaScript or resolving imports. */
export const analyzeJavaScriptJsonModule = (
  file: JavaScriptArtifactFile,
  documents: JavaScriptJsonDocuments,
): JavaScriptJsonModuleObservation => {
  const document = documents.read(file);
  if (document.status === "unavailable")
    return {
      path: file.path,
      sha256: file.sha256,
      status: "unavailable",
      top_level_keys: [],
      omitted_top_level_keys: null,
      limitation: `JSON module text was unavailable: ${document.reason}.`,
    };
  if (document.status === "invalid")
    return {
      path: file.path,
      sha256: file.sha256,
      status: "invalid",
      top_level_keys: [],
      omitted_top_level_keys: 0,
      limitation: "JSON module is not valid JSON.",
    };
  return {
    path: file.path,
    sha256: file.sha256,
    status: "included",
    top_level_keys: document.topLevelKeys,
    omitted_top_level_keys: 0,
    limitation: null,
  };
};
