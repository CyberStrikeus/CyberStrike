import { z } from "zod";
import {
  borrowEvidenceInput,
  borrowEvidenceArray,
} from "../../domain/evidenceReference.js";

// Borrow inline payloads until application admission; advertise the exact public
// Evidence/reference union without a pre-admission recursive SDK clone.
const input = borrowEvidenceInput();
// Borrow the outer selections too: admission must account for their width before
// any array traversal/copy. The owner authenticates each selected carrier later.
const observations = borrowEvidenceArray();

/** Inventories stay portable; optional observations avoid all-function decompilation. */
export const matchNativeFunctionsInputSchema = z.strictObject({
  left: input.describe(
    "Left list_procedures Evidence or exact retained reference",
  ),
  right: input.describe(
    "Right list_procedures Evidence or exact retained reference",
  ),
  left_observations: observations
    .default([])
    .describe(
      "Optional same-context list_names, procedure_info, read_bytes or analyze_function Evidence",
    ),
  right_observations: observations
    .default([])
    .describe(
      "Optional same-context list_names, procedure_info, read_bytes or analyze_function Evidence",
    ),
  detail: z.enum(["summary", "complete"]).default("summary"),
});

export type MatchNativeFunctionsInput = z.output<
  typeof matchNativeFunctionsInputSchema
>;
