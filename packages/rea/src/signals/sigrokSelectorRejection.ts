import type { AnalysisInputIssue } from "../domain/analysisErrorCore.js";
import type { InspectSignalDecodersInput } from "../domain/signals/signalDecoders.js";
import type { DecodeSignalRecordingInput } from "../domain/signals/signalRecording.js";

export type SigrokSelectorRejection = AnalysisInputIssue & {
  readonly message: string;
};

/** Caller selectors that a sigrok command loads, keyed by their input field. */
export type SigrokSelection =
  | Pick<
      DecodeSignalRecordingInput,
      "decoders" | "annotations" | "input_format"
    >
  | Pick<InspectSignalDecodersInput, "decoder">;

type SigrokDiagnosticMatcher = (message: string) => boolean;

const rejectedSelector = (
  field: "decoder" | "decoders" | "annotations" | "input_format",
  producerMessage: string,
  recovery: string,
): SigrokSelectorRejection => ({
  path: [field],
  reason: "invalid_value",
  message: `sigrok-cli rejected the ${field} selector: ${producerMessage} ${recovery}`,
});

const DECODE_RECOVERY =
  "Use inspect_signal_decoders to list installed decoder IDs, or pass a decoder ID to show its options and annotation classes.";
const HELP_RECOVERY =
  "Omit decoder to list installed decoder IDs, optionally filtered by query, then request help for one of those IDs.";
const CHANNEL_RECOVERY =
  "Set each decoder channel target to a channel present in the recording; inspect_signal_decoders shows the selected decoder's channel IDs.";
const INPUT_FORMAT_RECOVERY =
  "Use a supported sigrok input format name, or omit input_format to let sigrok-cli autodetect the recording.";
const INPUT_OPTION_RECOVERY =
  "Use options supported by the selected sigrok input format, or remove the rejected option.";

/**
 * sigrok-cli loads selected decoders before decoding or showing help, so an
 * unknown ID yields the same refusal for both commands. A missing module named
 * exactly after the decoder separates an unknown ID from an installed decoder
 * whose own imports or code fail to load.
 */
const unknownDecoderRefusal = (
  hasDiagnostic: SigrokDiagnosticMatcher,
  id: string,
): string | undefined => {
  const producerMessage = `Failed to load protocol decoder ${id}.`;
  return id !== "" &&
    hasDiagnostic(producerMessage) &&
    hasDiagnostic(
      `srd: ModuleNotFoundError: Failed to load decoder ${id}: import by name failed: No module named '${id}'`,
    )
    ? producerMessage
    : undefined;
};

/**
 * The sigrok-cli 0.7.2 channel mapper reports missing and unknown targets as
 * plain stderr diagnostics, even though it continues with the other mappings. Match
 * the exact selected channel key or target value rather than searching the
 * selector text for a substring.
 */
const missingSelectedChannelRefusal = (
  hasDiagnostic: SigrokDiagnosticMatcher,
  decoders: string,
): string | undefined => {
  const selectedValues = new Set<string>();
  for (const decoder of decoders.split(",")) {
    for (const assignment of decoder.split(":").slice(1)) {
      const separator = assignment.indexOf("=");
      if (separator < 0 && assignment !== "") {
        const producerMessage = `Channel name for "${assignment}" missing.`;
        if (hasDiagnostic(`cli: ${producerMessage}`)) return producerMessage;
      }
      if (separator > 0) selectedValues.add(assignment.slice(separator + 1));
    }
  }
  for (const channel of selectedValues) {
    const producerMessage = `No channel with name "${channel}" found.`;
    if (hasDiagnostic(`cli: ${producerMessage}`)) return producerMessage;
  }
  return undefined;
};

/**
 * Recognize only observed sigrok-cli 0.7.2 selector refusals whose rejected
 * name equals a caller-supplied selector; other failures stay unclassified.
 */
export const parseSigrokSelectorRejection = (
  stderr: string,
  selection: SigrokSelection,
): SigrokSelectorRejection | undefined => {
  // Selected option keys may contain LF, which the tagged producer prints verbatim.
  // Match the complete caption at diagnostic boundaries without splitting it.
  const hasDiagnostic: SigrokDiagnosticMatcher = (message) =>
    stderr === message ||
    stderr.startsWith(`${message}\n`) ||
    stderr.endsWith(`\n${message}`) ||
    stderr.includes(`\n${message}\n`);
  if ("decoder" in selection) {
    const refusal =
      selection.decoder === null
        ? undefined
        : unknownDecoderRefusal(hasDiagnostic, selection.decoder);
    return refusal === undefined
      ? undefined
      : rejectedSelector("decoder", refusal, HELP_RECOVERY);
  }
  const [inputFormat = "", ...inputOptions] =
    selection.input_format?.split(":") ?? [];
  const inputFormatRefusal = `Error: unknown input module '${inputFormat}'.`;
  if (inputFormat !== "" && hasDiagnostic(`cli: ${inputFormatRefusal}`))
    return rejectedSelector(
      "input_format",
      inputFormatRefusal,
      INPUT_FORMAT_RECOVERY,
    );
  // sigrok-cli 0.7.2 parses format:option=value with colon separators and
  // warns on unknown option keys, then continues with the supported options.
  for (const option of inputOptions) {
    const key = option.split("=", 1)[0] ?? "";
    const producerMessage = `Unknown keyword: ${key}.`;
    if (key !== "" && hasDiagnostic(producerMessage))
      return rejectedSelector(
        "input_format",
        producerMessage,
        INPUT_OPTION_RECOVERY,
      );
  }
  // sigrok-cli stacks decoders with "," and appends options with ":".
  for (const entry of selection.decoders.split(",")) {
    const refusal = unknownDecoderRefusal(
      hasDiagnostic,
      entry.split(":")[0] ?? "",
    );
    if (refusal !== undefined)
      return rejectedSelector("decoders", refusal, DECODE_RECOVERY);
  }
  const missingChannel = missingSelectedChannelRefusal(
    hasDiagnostic,
    selection.decoders,
  );
  if (missingChannel !== undefined)
    return rejectedSelector("decoders", missingChannel, CHANNEL_RECOVERY);
  // Annotation selections are "decoder=class:class,decoder".
  for (const entry of selection.annotations?.split(",") ?? []) {
    const [decoder = "", classes, ...rest] = entry.split("=");
    if (decoder === "" || classes === undefined || rest.length > 0) continue;
    for (const annotation of classes.split(":")) {
      const producerMessage = `Annotation '${annotation}' not found for protocol decoder '${decoder}'.`;
      if (annotation !== "" && hasDiagnostic(producerMessage))
        return rejectedSelector(
          "annotations",
          producerMessage,
          DECODE_RECOVERY,
        );
    }
  }
  return undefined;
};
