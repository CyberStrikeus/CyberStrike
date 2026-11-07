import { toolFamilyId } from "../contracts/toolFamilies.js";
import { UNTRUSTED_CONTENT_INSTRUCTIONS } from "./toolResultEncoding.js";
import { recoveryInstructions } from "./recoveryInstructions.js";

const TARGET_FREE_INSTRUCTIONS =
  "REA provides reverse-engineering tools for local artifacts, native binaries, managed code, browser pages, and runtimes. Use the tool that directly answers the question; discover targets or inspect inventory only when needed. Tool results include inline Evidence and report their coverage and limitations.";

// Only advertise the lifecycle when `session` is in scope: otherwise
// `open_binary` and `close_binary` are disabled and the guidance would direct
// initialization to a call that always fails.
const SESSION_LIFECYCLE_INSTRUCTIONS =
  "An opened target persists across turns. When finished, export needed Evidence and call close_binary; its snapshot_path can retain analysis.";

const ACTIVE_TARGET_INSTRUCTIONS =
  "REA analyzes the active reverse-engineering target. Use the analysis tool that answers the question directly. Search or list symbols when discovery is needed.";

// Only name the enhanced-family dossier tool when that family is in scope:
// otherwise `analyze_function` is disabled and the recommendation always fails.
const FUNCTION_DOSSIER_INSTRUCTIONS =
  "analyze_function provides a function dossier, and focused procedure tools return individual facets.";

/** Whether the scope advertises the family that owns a named tool. */
const advertisesToolFamily = (
  advertisedToolFamilies: ReadonlySet<string> | undefined,
  tool: string,
): boolean => {
  if (advertisedToolFamilies === undefined) return true;
  const family = toolFamilyId(tool);
  return family !== undefined && advertisedToolFamilies.has(family);
};

export const serverInstructions = (
  hasSession: boolean,
  advertisedToolFamilies: ReadonlySet<string> | undefined,
): string => {
  const guidance = (tool: string, text: string): string =>
    advertisesToolFamily(advertisedToolFamilies, tool) ? ` ${text}` : "";
  const recovery = recoveryInstructions(
    advertisesToolFamily(advertisedToolFamilies, "update_analysis_settings"),
  );
  if (!hasSession)
    return `${ACTIVE_TARGET_INSTRUCTIONS}${guidance("analyze_function", FUNCTION_DOSSIER_INSTRUCTIONS)} ${recovery} ${UNTRUSTED_CONTENT_INSTRUCTIONS}`;
  return `${TARGET_FREE_INSTRUCTIONS}${guidance("close_binary", SESSION_LIFECYCLE_INSTRUCTIONS)} ${recovery} ${UNTRUSTED_CONTENT_INSTRUCTIONS}`;
};
