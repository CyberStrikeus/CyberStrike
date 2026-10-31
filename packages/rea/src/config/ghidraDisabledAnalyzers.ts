import { z } from "zod";

export const MAX_GHIDRA_DISABLED_ANALYZER_NAMES = 32;
export const MAX_GHIDRA_DISABLED_ANALYZER_NAME_LENGTH = 120;

// Ghidra's headless parser consumes `-`-prefixed arguments after a script path
// as its own options, and REA joins the names with commas into one pre-script
// argument, so a name can neither start with `-` nor contain a comma. The
// remaining admitted characters keep the argument a single quotable token on
// every supported launcher, including the Windows batch invocation.
const ghidraAnalyzerNamePattern = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u;

/**
 * Parse `REA_GHIDRA_DISABLED_ANALYZERS` into the Ghidra auto-analyzer names to
 * disable before default auto-analysis, such as
 * `Objective-C Message Analyzer`. Empty and blank entries are dropped; a list
 * without names selects no override.
 */
export const ghidraDisabledAnalyzersSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  )
  .refine(
    (names) => names.length <= MAX_GHIDRA_DISABLED_ANALYZER_NAMES,
    `must list at most ${MAX_GHIDRA_DISABLED_ANALYZER_NAMES} analyzer names`,
  )
  .refine(
    (names) =>
      names.every(
        (name) => name.length <= MAX_GHIDRA_DISABLED_ANALYZER_NAME_LENGTH,
      ),
    `must keep every analyzer name at most ${MAX_GHIDRA_DISABLED_ANALYZER_NAME_LENGTH} characters`,
  )
  .refine(
    (names) => names.every((name) => ghidraAnalyzerNamePattern.test(name)),
    "must be Ghidra analyzer names starting with a letter or digit and containing only letters, digits, spaces, periods, underscores, and hyphens",
  )
  .transform((names) => (names.length === 0 ? undefined : names));
