import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";

/** Use only after a CDP document is known to be outside its HTTP(S) scope. */
export const cdpOriginScopeRefusal = (
  operation: BrowserObservationOperation,
  options?: { readonly cause?: unknown; readonly detail?: string },
): BrowserObservationError =>
  new BrowserObservationError(operation, "target_not_allowed", {
    ...options,
    detail:
      options?.detail ??
      "The current document is outside the permitted HTTP(S) origin scope.",
    remediationAction:
      "Select a document within allowed_origins, or explicitly adjust allowed_origins if that document is intended, then retry.",
  });
