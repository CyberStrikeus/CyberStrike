import type { WebPageInspection } from "../../domain/browserObservationSchemas.js";
import type { CapturedWebScript } from "../../domain/webScriptExport.js";

/** Project verified Debugger sources without fetching resource URLs. */
export const pageScripts = (
  capture: Pick<WebPageInspection, "scripts">,
): CapturedWebScript[] =>
  capture.scripts.items.map((script) => ({
    source: {
      kind: "page-script",
      script_key: script.script_key,
      frame_id: script.frame_id,
      is_module: script.is_module,
      language: script.language,
      source_map_url: script.source_map_url,
    },
    url: script.url,
    content: !script.source.included
      ? {
          state: "unavailable",
          reason: "source-not-included",
          message: script.source.reason || "Debugger source was not included.",
        }
      : script.language !== null && script.language !== "JavaScript"
        ? {
            state: "unavailable",
            reason: "unsupported-language",
            message: `Debugger reported language ${script.language}; JavaScript export was not inferred.`,
          }
        : {
            state: "captured",
            bytes: Buffer.from(script.source.artifact.text, "utf8"),
            sha256: script.source.artifact.sha256,
            media_type: script.source.artifact.media_type,
            redacted: null,
            representation: "debugger-source-utf8",
          },
  }));
