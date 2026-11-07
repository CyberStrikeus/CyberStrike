import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "../domain/analysisErrorProjection.js";
import type {
  AnalysisError,
  AnalysisErrorOptions,
  AnalysisCleanupObservation,
} from "../domain/analysisErrorBase.js";
import type { ReferenceSourcePolicy } from "../domain/referenceSourcePolicy.js";
import type { ReferenceSourceRead } from "../reference/ReferenceSourceReaderTypes.js";

/** Typed expected failure returned by historical-source imports. */
export interface ReferenceSourceImportError {
  readonly tag: "reference-source-import";
  readonly code: "cancelled" | "invalid-root" | "unsupported" | "io" | "parse";
  readonly message: string;
  readonly remediationAction?: string;
  readonly cleanup?: AnalysisCleanupObservation;
  readonly partial?: ReferenceSourceRead;
  readonly cause?: unknown;
}

const IMPORT_FAILURE_GUIDANCE = {
  cancelled:
    "Reference source import was cancelled. Start it again when ready.",
  "invalid-root":
    "Reference source directory could not be opened. Check that the path exists, is readable, and points to a directory.",
  unsupported:
    "Safe no-follow file opens are unavailable on this host. Import the source tree with REA on Linux (including WSL) or macOS.",
  io: "Reference source files could not be read. Check directory permissions and try again.",
  parse:
    "Reference source could not be indexed. Check that the source tree is readable, then try again.",
} satisfies Record<ReferenceSourceImportError["code"], string>;

/** Canonical CLI/MCP projection, retaining source facts under diagnostic details. */
export const projectReferenceSourceImportError = (
  error: ReferenceSourceImportError,
): AnalysisErrorProjection => {
  const guidance =
    error.remediationAction ?? IMPORT_FAILURE_GUIDANCE[error.code];
  const message = `${error.message} ${guidance}`;
  const partial = error.partial;
  const options: AnalysisErrorOptions = {
    cause: error.cause,
    ...(error.cleanup === undefined ? {} : { cleanup: error.cleanup }),
    diagnostics: {
      reference_source_code: error.code,
      ...(partial === undefined
        ? {}
        : {
            partial: {
              root: partial.root,
              ...(partial.rootFailure === undefined
                ? {}
                : { rootFailure: { ...partial.rootFailure } }),
              entries: partial.entries.map((entry) =>
                entry.status === "read" && entry.kind === "file"
                  ? { ...entry, bytes: Array.from(entry.bytes) }
                  : { ...entry },
              ),
              bytesRead: partial.bytesRead,
              limitations: [...partial.limitations],
            },
          }),
    },
  };
  let primary: AnalysisError;
  switch (error.code) {
    case "cancelled":
      primary = new AnalysisCancelledError("import_reference_source", options);
      break;
    case "invalid-root":
      primary = new AnalysisInputError(
        "import_reference_source",
        {
          ...options,
          userMessage: message,
          ...(error.remediationAction === undefined
            ? {}
            : { remediationAction: error.remediationAction }),
        },
        [{ path: ["root"], reason: "invalid_value", message: error.message }],
      );
      break;
    case "unsupported":
      primary = new AnalysisCapabilityUnavailableError(
        "filesystem",
        "import_reference_source",
        error.message,
        { ...options, userMessage: message, remediationAction: guidance },
      );
      break;
    case "io":
    case "parse":
      primary = new AnalysisOutputError(
        "import_reference_source",
        error.message,
        { ...options, userMessage: message, remediationAction: guidance },
      );
      break;
  }
  // Cancellation uses a shared fixed message; the producing boundary's reason
  // is caller evidence and remains useful for every category.
  return { ...projectAnalysisError(primary), message };
};

/** Import a caller-selected local source tree as historical reference. */
export interface ReferenceSourceImportOptions {
  readonly root: string;
  readonly signal?: AbortSignal;
  readonly caller: string;
  readonly policy: ReferenceSourcePolicy;
  readonly importer?: string;
  readonly importerVersion?: string | null;
  readonly excludePaths?: readonly string[];
}

export const DEFAULT_REFERENCE_SOURCE_IGNORE_PATTERNS = [
  ".git/",
  ".git/hooks/",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "htmlcov/",
  ".coverage",
  "*.log",
] as const;
