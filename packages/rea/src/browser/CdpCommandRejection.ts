import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";

/** Preserve a producer's command rejection independently from fatal transport parsing errors. */
export class CdpCommandRejection extends BrowserObservationError {
  constructor(
    operation: BrowserObservationOperation,
    readonly command: string,
    readonly code: number | null,
    readonly reportedMessage: string | null,
  ) {
    super(operation, "protocol_error", {
      detail:
        reportedMessage === null
          ? "CDP returned a malformed command error."
          : `CDP ${command} failed (${code === null ? "unknown code" : String(code)}): ${reportedMessage}`,
    });
  }
}
