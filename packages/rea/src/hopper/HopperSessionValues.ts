import { DEFAULT_BRIDGE_MAX_REQUEST_BYTES } from "../config/bridgeMaxRequestBytes.js";
import { HopperProtocolError } from "../domain/hopperErrors.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";

/** Bound cleanup handshakes and the bridge's idle reconnection wait. */
export const HOPPER_SHUTDOWN_TIMEOUT_MS = 30_000;

/** Authenticated identity returned by the Hopper bridge health handshake. */
export interface HopperServerInfo {
  readonly name: string;
  readonly version: string;
  readonly processId: number;
  /** Bridge request ceiling. An omitted health field means the 16 MiB default. */
  readonly maxRequestBytes: number;
}

/** Validate the bridge identity and exact per-launch run identifier. */
export const parseHopperServerInfo = (
  value: JsonValue,
  expectedRunId: string,
): Result<HopperServerInfo, HopperProtocolError> => {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    value.name === "REA Hopper bridge" &&
    typeof value.version === "string" &&
    typeof value.process_id === "number" &&
    Number.isSafeInteger(value.process_id) &&
    value.process_id > 0 &&
    value.run_id === expectedRunId
  ) {
    const advertised = value.max_request_bytes;
    const maxRequestBytes =
      advertised === undefined ? DEFAULT_BRIDGE_MAX_REQUEST_BYTES : advertised;
    if (
      typeof maxRequestBytes !== "number" ||
      !Number.isSafeInteger(maxRequestBytes) ||
      maxRequestBytes <= 0
    )
      return err(
        new HopperProtocolError("Hopper bridge health result is invalid"),
      );
    return ok({
      name: value.name,
      version: value.version,
      processId: value.process_id,
      maxRequestBytes,
    });
  }
  return err(new HopperProtocolError("Hopper bridge health result is invalid"));
};

/** Require confirmation that the REA bridge detached or its document closed. */
export const isHopperShutdownAcknowledgement = (value: JsonValue): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  if (value.shutdown !== true) return false;
  return (
    (value.analysis_stopped === true && value.document_closed === true) ||
    (value.document_closed === false && value.document_retained === true)
  );
};

/** Detect the verified Linux bridge response that requires group cleanup. */
export const isHopperCleanupRequired = (value: JsonValue): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  value.shutdown === true &&
  value.cleanup_required === true;
