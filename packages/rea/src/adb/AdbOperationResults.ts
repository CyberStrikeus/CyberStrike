import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import type { AdbUnparsedLines } from "./AdbUnparsedLines.js";
import type {
  AdbBinarySelection,
  AdbClientIdentity,
} from "./AdbConfiguration.js";

export const clientIdentityResult = (
  selection: AdbBinarySelection,
  identity: AdbClientIdentity,
) => ({
  binary_path: selection.binary,
  path_source: selection.pathSource,
  version: identity.version,
  installed_path: identity.installedPath,
});

export type AdbClientResult = ReturnType<typeof clientIdentityResult>;
export type AdbProviderIdentity = {
  id: string;
  name: string;
  version: string | null;
};

/**
 * Build a parsed-listing execution whose `unparsed_lines`, coverage, and
 * truncation limitation all derive from the parser's unrecognized-line facts,
 * so the limitation can never describe a field the result does not carry.
 */
export const parsedListingExecution = (
  result: Readonly<Record<string, unknown>>,
  unparsed: AdbUnparsedLines,
  provider: AdbProviderIdentity,
  limitations: readonly string[] = [],
) =>
  createAnalysisExecution(
    {
      ...result,
      unparsed_lines: unparsed.sample,
      coverage: unparsed.total > 0 ? "partial" : "complete",
    },
    provider,
    {
      limitations: [
        ...limitations,
        ...(unparsed.total > unparsed.sample.length
          ? [
              `unparsed_lines reports the first ${String(unparsed.sample.length)} of ${String(unparsed.total)} unrecognized lines`,
            ]
          : []),
      ],
    },
  );
