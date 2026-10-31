import {
  DEFAULT_ASAR_HEADER_ADMISSION,
  type AsarHeaderAdmission,
} from "../config/asarHeaderAdmission.js";
import { pathToFileURL } from "node:url";

import {
  browserOriginSchema,
  sanitizeBrowserUrl,
} from "../domain/browserObservation.js";
import type { BrowserExclusionReason } from "../domain/browserCompleteness.js";
import type {
  JavaScriptRuntimeLocation,
  JavaScriptRuntimeTargetLocation,
} from "../domain/javascript/javascriptRuntimeObservation.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  authorizedElectronFile,
  type ElectronFileScope,
} from "../browser/ElectronFileScope.js";

export type RuntimeLocationDecision =
  | { readonly allowed: true; readonly location: JavaScriptRuntimeLocation }
  | {
      readonly allowed: false;
      readonly reason: BrowserExclusionReason;
    };

/** Throw the operation's typed cancellation error whenever its signal is aborted. */
export const throwIfRuntimeObservationCancelled = (
  signal?: AbortSignal,
  operation:
    | "observe_javascript_runtime"
    | "list_javascript_runtime_targets" = "observe_javascript_runtime",
): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError(operation, { cause: signal.reason });
};

/**
 * Wire bucket for inspector script exclusions. The V8 observation schemas
 * fix the `unsupported_location` key, so every canonical denial reason maps
 * onto it; the reason itself stays available on the decision for logs and
 * limitations text.
 */
export const inspectorExclusionKey = (
  reason: BrowserExclusionReason,
): "unsupported_location" => {
  // Every canonical denial collapses onto the fixed V8 wire bucket.
  void reason;
  return "unsupported_location";
};

/** Resolve a protocol location exposed by the explicitly selected Inspector endpoint. */
export const authorizeRuntimeLocation = async (
  value: string,
  signal?: AbortSignal,
  operation:
    | "observe_javascript_runtime"
    | "list_javascript_runtime_targets" = "observe_javascript_runtime",
  asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
  files?: ElectronFileScope,
): Promise<RuntimeLocationDecision> => {
  throwIfRuntimeObservationCancelled(signal, operation);
  if (URL.parse(value)?.protocol === "file:") {
    const filePath = await authorizedElectronFile(
      value,
      signal,
      operation,
      asarHeaderAdmission,
      files,
    );
    throwIfRuntimeObservationCancelled(signal, operation);
    return filePath === undefined
      ? { allowed: false, reason: "not_approved" }
      : { allowed: true, location: { kind: "file", file_path: filePath } };
  }
  return projectReportedRuntimeUrl(value);
};

/** Project non-file Inspector URLs without filesystem access. */
export const projectReportedRuntimeUrl = (
  value: string,
): RuntimeLocationDecision => {
  if (value.startsWith("node:") && value.length > 0)
    return {
      allowed: true,
      location: { kind: "builtin", specifier: value },
    };
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    // Non-URL input is outside the authorized runtime scope.
    void cause;
    return { allowed: false, reason: "unsupported_url" };
  }
  if (!["http:", "https:"].includes(url.protocol))
    return { allowed: false, reason: "unsupported_url" };
  const parsedOrigin = browserOriginSchema.safeParse(url.origin);
  if (!parsedOrigin.success)
    return { allowed: false, reason: "unsupported_url" };
  return {
    allowed: true,
    location: {
      kind: "url",
      origin: parsedOrigin.data,
      sanitized_url: sanitizeBrowserUrl(value).url,
    },
  };
};

/** Interpret Node's lossy discovery metadata separately from scriptParsed URLs. */
export const authorizeRuntimeTargetLocation = async (
  value: string,
  context: { readonly type: string; readonly product: string },
  signal?: AbortSignal,
  operation:
    | "observe_javascript_runtime"
    | "list_javascript_runtime_targets" = "list_javascript_runtime_targets",
  asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
  files?: ElectronFileScope,
): Promise<
  | {
      readonly allowed: true;
      readonly location: JavaScriptRuntimeTargetLocation;
    }
  | { readonly allowed: false; readonly reason: BrowserExclusionReason }
> => {
  throwIfRuntimeObservationCancelled(signal, operation);
  if (
    context.type !== "node" ||
    !/^node\.js\/v/iu.test(context.product) ||
    !value.startsWith("file://")
  )
    return authorizeRuntimeLocation(
      value,
      signal,
      operation,
      asarHeaderAdmission,
      files,
    );
  const reportedPath = value.slice("file://".length);
  if (!reportedPath.startsWith("/") && !/^[a-z]:[/\\_]/iu.test(reportedPath))
    return authorizeRuntimeLocation(
      value,
      signal,
      operation,
      asarHeaderAdmission,
      files,
    );

  // Node concatenates the pathname, then replaces quotes and backslashes with
  // underscores. A remaining underscore cannot prove which pathname was used.
  if (process.platform !== "win32" && !/[_"\\]/u.test(reportedPath)) {
    if (reportedPath.startsWith("/")) {
      const decision = await authorizeRuntimeLocation(
        pathToFileURL(reportedPath).href,
        signal,
        operation,
        asarHeaderAdmission,
        files,
      );
      if (decision.allowed) return decision;
    }
  }
  return {
    allowed: true,
    location: {
      kind: "unresolved",
      reported_url: value,
      reason: "unverifiable-file-location",
    },
  };
};
