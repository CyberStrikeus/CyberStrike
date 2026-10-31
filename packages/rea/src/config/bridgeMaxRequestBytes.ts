import { positiveDecimalIntegerSchema } from "./positiveDecimalInteger.js";

import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const BRIDGE_MAX_REQUEST_BYTES_SETTING = "REA_BRIDGE_MAX_REQUEST_BYTES";

/** Request payload ceiling used when the setting is unset. Today's fixed constant. */
export const DEFAULT_BRIDGE_MAX_REQUEST_BYTES = 16 * 1024 * 1024;

/**
 * Smallest ceiling that still admits the largest bounded bridge request.
 * Hopper symbol names stop at 1024 UTF-16 units. A name of U+0001 repeated
 * that many times JSON-escapes to six bytes per character. The Hopper
 * `set_address_name` request for that name, a max-safe id, and a 64-hex token
 * is 6322 bytes. The authenticated Cutter frame of a command carrying the same
 * name is 7464 bytes. The required Cutter recovery status, 64 receipts with
 * an unknown path, is smaller. A status path that fits is kept. A path that
 * does not fit is null, so the client does not reuse the descriptor path with
 * the new generation. Hello and a minimal command frame are smaller.
 * Comments, search text, and Cutter command text are unbounded; this ceiling
 * is what limits them. The floor stays below the 16 MiB default so a caller
 * can lower the ceiling.
 */
export const MINIMUM_BRIDGE_MAX_REQUEST_BYTES = 7464;

/**
 * Largest configurable request, in encoded payload bytes.
 *
 * The ceiling is the final JSON payload, not the raw command. Callers measure
 * escaped JSON against it before `JSON.stringify`, so a U+0001 expansion is
 * counted once. Node's single-string ceiling is 536870888 UTF-16 code units.
 * The payload budget excludes the terminating LF, and that LF is the one code
 * unit appended after the check. The maximum leaves room for it. Cutter signs
 * that payload from bounded JSON pieces and writes it in 64 KiB chunks. The
 * bridge looks for the framing LF only in the bytes just read. The client
 * unescapes each socket chunk into one response string, checks the proof, and
 * then parses that string. A fitting response does not keep the paged wire
 * frame, a second concatenated copy, and an outer JSON string.
 */
const NODE_MAX_STRING_LENGTH = 536_870_888;
const FRAMING_LF_CODE_UNITS = 1;
export const MAXIMUM_BRIDGE_MAX_REQUEST_BYTES =
  NODE_MAX_STRING_LENGTH - FRAMING_LF_CODE_UNITS;

/** Effective bridge request ceiling and where its value came from. */
export interface BridgeMaxRequestBytes {
  readonly maximumBytes: number;
  readonly source: "default" | "setting";
}

export const DEFAULT_BRIDGE_MAX_REQUEST: BridgeMaxRequestBytes = {
  maximumBytes: DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
  source: "default",
};

/**
 * Peer a ceiling refusal is reported for. Ghidra differs from the other two:
 * its Java bridge reads no request ceiling, so only the REA client enforces
 * this setting for Ghidra and recovery must not ask for a bridge restart.
 */
export type BridgePeer = "Hopper" | "Cutter" | "Ghidra";

export const bridgeMaxRequestBytesConstraint = `${BRIDGE_MAX_REQUEST_BYTES_SETTING} must be a positive decimal integer from ${String(MINIMUM_BRIDGE_MAX_REQUEST_BYTES)} to ${String(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES)} bytes; the default is ${String(DEFAULT_BRIDGE_MAX_REQUEST_BYTES)} bytes (16 MiB). A value below ${String(MINIMUM_BRIDGE_MAX_REQUEST_BYTES)} bytes cannot carry the largest admitted symbol-name command, and a larger value is refused so the encoded payload plus its framing LF stays one string under Node's single-string ceiling.`;

/** Optional decimal byte count for the Hopper and Cutter request payload ceiling. */
export const bridgeMaxRequestBytesSchema = positiveDecimalIntegerSchema(
  MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
  MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
  bridgeMaxRequestBytesConstraint,
);

/** Resolve the effective ceiling from one environment value. */
export const parseBridgeMaxRequestBytes = (
  value: string | undefined,
): Result<BridgeMaxRequestBytes, ConfigurationError> => {
  if (value === undefined) return ok(DEFAULT_BRIDGE_MAX_REQUEST);
  const parsed = bridgeMaxRequestBytesSchema.safeParse(value);
  return parsed.success
    ? ok({ maximumBytes: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(bridgeMaxRequestBytesConstraint, {
          settings: [
            {
              setting: BRIDGE_MAX_REQUEST_BYTES_SETTING,
              constraint: bridgeMaxRequestBytesConstraint,
            },
          ],
        }),
      );
};

/**
 * Resolve the ceiling from a composition root's selected environment. An
 * invalid setting is refused, not ignored. Callers that already resolved it
 * at startup pass that value through instead of reading the environment again.
 */
export const resolveBridgeMaxRequestBytes = (
  environment: Readonly<Record<string, string | undefined>>,
): BridgeMaxRequestBytes => {
  const parsed = parseBridgeMaxRequestBytes(
    environment[BRIDGE_MAX_REQUEST_BYTES_SETTING],
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** How to read and change the effective bridge request ceiling. */
export const bridgeMaxRequestBytesRecovery = (
  limit: BridgeMaxRequestBytes,
  peer: BridgePeer = "Hopper",
): string =>
  [
    `The effective ${BRIDGE_MAX_REQUEST_BYTES_SETTING} value is ${String(limit.maximumBytes)} bytes (source ${limit.source}; default ${String(DEFAULT_BRIDGE_MAX_REQUEST_BYTES)}, floor ${String(MINIMUM_BRIDGE_MAX_REQUEST_BYTES)}, maximum ${String(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES)}).`,
    `Set ${BRIDGE_MAX_REQUEST_BYTES_SETTING} in the environment that starts REA to a decimal integer from ${String(MINIMUM_BRIDGE_MAX_REQUEST_BYTES)} to ${String(MAXIMUM_BRIDGE_MAX_REQUEST_BYTES)}, then restart REA.`,
    peer === "Ghidra"
      ? `The Ghidra bridge enforces no request ceiling of its own, so only the REA client applies ${BRIDGE_MAX_REQUEST_BYTES_SETTING} to Ghidra requests.`
      : "Restart Hopper or Cutter from that same environment so the bridge uses this ceiling.",
  ].join(" ");

const limitFacts = (
  limit: BridgeMaxRequestBytes,
): { readonly max_request_bytes: number } => ({
  max_request_bytes: limit.maximumBytes,
});

/** Refuse one request whose payload is above the effective ceiling. */
export const bridgeRequestOversizeError = (
  operation: string,
  limit: BridgeMaxRequestBytes,
  payloadBytes: number,
  peer: BridgePeer,
): AnalysisResourceConstraintError => {
  const recovery = bridgeMaxRequestBytesRecovery(limit, peer);
  const refusal =
    peer === "Cutter"
      ? `Cutter request exceeds its authenticated frame limit of ${String(limit.maximumBytes)} bytes; no command was sent.`
      : `${peer} request exceeds its ${String(limit.maximumBytes)}-byte payload limit; no request was sent.`;
  return new AnalysisResourceConstraintError(
    operation,
    "transport",
    `${refusal} ${recovery}`,
    { ...limitFacts(limit), payload_bytes: payloadBytes },
    { remediationAction: recovery, retryable: false },
  );
};

/** Refuse a command when the bridge advertisement and the client ceiling differ. */
export const bridgeRequestLimitMismatchError = (
  operation: string,
  limit: BridgeMaxRequestBytes,
  bridgeBytes: number,
  peer: BridgePeer,
  sent = peer === "Cutter" ? "No command was sent." : "No request was sent.",
): AnalysisResourceConstraintError => {
  const recovery = bridgeMaxRequestBytesRecovery(limit, peer);
  return new AnalysisResourceConstraintError(
    operation,
    "transport",
    `The ${peer} bridge ceiling is ${String(bridgeBytes)} bytes and the REA client ceiling is ${String(limit.maximumBytes)} bytes. ${sent} An out-of-band ${peer} process defaults to ${String(DEFAULT_BRIDGE_MAX_REQUEST_BYTES)} bytes when ${BRIDGE_MAX_REQUEST_BYTES_SETTING} is unset. ${recovery}`,
    {
      bridge_max_request_bytes: bridgeBytes,
      client_max_request_bytes: limit.maximumBytes,
    },
    { remediationAction: recovery, retryable: false },
  );
};

/** Refuse a Cutter response that exceeds the same configured frame ceiling. */
export const bridgeResponseOversizeError = (
  limit: BridgeMaxRequestBytes,
): AnalysisResourceConstraintError => {
  const recovery = bridgeMaxRequestBytesRecovery(limit, "Cutter");
  return new AnalysisResourceConstraintError(
    "cutter_command",
    "transport",
    `Cutter bridge response exceeded its framed transport limit of ${String(limit.maximumBytes)} bytes. ${recovery}`,
    limitFacts(limit),
    { remediationAction: recovery, retryable: false },
  );
};
