import { z } from "zod";

/** Exact inventoried paths selected for text acquisition and static analysis. */
export const javaScriptSourcePathsSchema = z
  .array(z.string().min(1))
  .min(1)
  .describe(
    "Exact relevant file paths from the artifact inventory, relative to the application root, analyzed in first-request order before unselected scopes; no globs or implicit dependencies. Omit to analyze all sources.",
  );

/** Caller scope retained independently of analysis success or completeness. */
export const javaScriptSourceSelectionSchema = z.strictObject({
  requested_paths: javaScriptSourcePathsSchema,
  unselected_files: z.int().min(0),
});

/** Explicit selected-source boundary for an otherwise complete inventory. */
export type JavaScriptSourceSelection = z.infer<
  typeof javaScriptSourceSelectionSchema
>;
