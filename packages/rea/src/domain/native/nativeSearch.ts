import { z } from "zod";

/** Provider-neutral native text search semantics, independent of document selection. */
export const nativeSearchFields = {
  pattern: z
    .string()
    .min(1)
    .describe("The literal text or regex pattern to search for"),
  mode: z.enum(["literal", "regex"]).default("literal"),
  case_sensitive: z
    .boolean()
    .default(false)
    .describe(
      "Whether to match case; case-insensitive literal matching uses Unicode simple case folding, one character at a time, except Hopper, which retains Python Unicode full case folding and can expand characters into sequences. Regex case handling follows the provider's advertised regex dialect",
    ),
};

/** Public native search inputs retain an omitted document selection. */
export const nativeSearchInput = {
  ...nativeSearchFields,
  document: z.string().optional().describe("The document name"),
};
