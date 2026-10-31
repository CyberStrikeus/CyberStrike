import type { AsarHeaderAdmission } from "../config/asarHeaderAdmission.js";
import type {
  ElectronPageInspection,
  InspectElectronPageInput,
} from "../domain/javascript/electronObservation.js";
import { digestCanonicalValue } from "../domain/canonicalDigest.js";
import type { CdpConnection } from "./CdpConnection.js";
import { CdpCaptureCompleteness } from "./CdpCaptureCompleteness.js";
import { capturePassiveCdpScriptSource } from "./CdpScriptSourceCapture.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { CDP_CAPTURE_SCRIPT_METADATA_LIMITS } from "./CdpCaptureEventTypes.js";
import type {
  ElectronScriptDraft,
  ElectronScriptFrameScope,
} from "./CdpElectronScriptEvents.js";
import { authorizedElectronFile } from "./ElectronFileScope.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { selectedCdpCommandTimeoutMs } from "../domain/browserDeadline.js";
import { CdpScriptSourceBudget } from "./CdpScriptSourceBudget.js";

interface ElectronScriptCaptureInput {
  readonly connection: CdpConnection;
  readonly sessionId: string | undefined;
  readonly signal?: AbortSignal;
  readonly request: InspectElectronPageInput;
  readonly scripts: readonly ElectronScriptDraft[];
  readonly frameScopeForScript: (
    script: ElectronScriptDraft,
  ) => ElectronScriptFrameScope;
  readonly completeness: CdpCaptureCompleteness;
  readonly asarHeaderAdmission: AsarHeaderAdmission;
}

/** Normalize local script metadata and optionally approved source. */
export const captureElectronScripts = async (
  input: ElectronScriptCaptureInput,
): Promise<ElectronPageInspection["scripts"]> => {
  let total = 0;
  const items: ElectronPageInspection["scripts"]["items"] = [];
  const seen = new Set<string>();
  let metadataBytes = 2;
  const commandTimeoutMs = selectedCdpCommandTimeoutMs(
    input.request.command_timeout_ms,
  );
  const sourceBudget =
    input.request.include_script_sources && input.scripts.length > 0
      ? new CdpScriptSourceBudget(input.signal, commandTimeoutMs)
      : undefined;
  try {
    for (const script of input.scripts) {
      throwIfCallerCancelled(input.signal);
      const frame = input.frameScopeForScript(script);
      if (frame.state === "excluded") {
        input.completeness.exclude("scripts", "out_of_target_scope");
        continue;
      }
      const path = await authorizedElectronFile(
        script.rawUrl,
        input.signal,
        "inspect_electron_page",
        input.asarHeaderAdmission,
      );
      if (path === undefined) {
        input.completeness.exclude("scripts", "out_of_target_scope");
        continue;
      }
      if (frame.state === "unknown")
        input.completeness.attachLimited("scripts");
      const identity = {
        frame_id: frame.frameId,
        frame_scope: frame.state,
        frame_claims: script.frameClaims,
        file_path: path,
        reported_url: script.rawUrl,
        has_source_url: script.hasSourceUrl,
        cdp_hash: script.hash,
        length: script.length,
        is_module: script.isModule,
        language: script.language,
      };
      // Digest text has fixed ASCII width; count the final metadata shape
      // before canonical hashing or retaining the expanded public projection.
      const remaining =
        CDP_CAPTURE_SCRIPT_METADATA_LIMITS.retainedBytes - metadataBytes;
      const retainedBytes =
        jsonValueByteLength(
          { script_key: `electron_script_${"0".repeat(64)}`, ...identity },
          remaining,
        ) + (items.length > 0 ? 1 : 0);
      if (retainedBytes > remaining) {
        input.completeness.exclude("scripts", "resource_budget_exhausted");
        continue;
      }
      const scriptKey = `electron_script_${digestCanonicalValue(identity, "CDP capture")}`;
      if (seen.has(scriptKey)) continue;
      seen.add(scriptKey);
      metadataBytes += retainedBytes;
      total += 1;
      const source =
        sourceBudget === undefined
          ? {
              included: false as const,
              reason: "source capture was not selected",
            }
          : await capturePassiveCdpScriptSource({
              connection: input.connection,
              sessionId: input.sessionId,
              signal: input.signal,
              operation: "inspect_electron_page",
              scriptId: script.scriptId,
              sourceBudget,
              completeness: input.completeness,
            });
      items.push({ script_key: scriptKey, ...identity, source });
    }
  } finally {
    sourceBudget?.dispose();
  }
  if (!input.request.include_script_sources)
    input.completeness.exclude("script_sources", "not_approved", total);
  return {
    total,
    items: items.sort((left, right) =>
      compareUnicodeCodePoints(left.script_key, right.script_key),
    ),
  };
};

const throwIfCallerCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError("inspect_electron_page", {
      cause: signal.reason,
    });
};
