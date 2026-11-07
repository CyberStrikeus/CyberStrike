import {
  DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
  CAPTURE_DECODER_SEMI_SPACE_MIB,
  MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB,
} from "../domain/analysisResourceLimits.js";
import { positiveDecimalIntegerSchema } from "./positiveDecimalInteger.js";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const CAPTURE_DECODER_OLD_GENERATION_SETTING =
  "REA_CAPTURE_DECODER_OLD_GENERATION_MIB";

/** Effective HAR/SAZ/qlog old-generation heap and where its value came from. */
export interface CaptureDecoderHeap {
  readonly oldGenerationMiB: number;
  readonly source: "default" | "setting" | "runtime";
}

export const DEFAULT_CAPTURE_DECODER_HEAP: CaptureDecoderHeap = {
  oldGenerationMiB: DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB,
  source: "default",
};

export const captureDecoderHeapConstraint = `${CAPTURE_DECODER_OLD_GENERATION_SETTING} must be a decimal integer from ${String(CAPTURE_DECODER_SEMI_SPACE_MIB)} to ${String(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB)} MiB; the default is ${String(DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB)} MiB. An old generation below the decoder's ${String(CAPTURE_DECODER_SEMI_SPACE_MIB)} MiB semi-space aborts Node during startup instead of enforcing a limit, and a larger value is refused.`;

/** Optional decimal mebibyte count for the HAR/SAZ/qlog old-generation heap. */
export const captureDecoderOldGenerationMiBSchema =
  positiveDecimalIntegerSchema(
    CAPTURE_DECODER_SEMI_SPACE_MIB,
    MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB,
    captureDecoderHeapConstraint,
  );

/** Resolve the effective heap from one environment value. */
export const parseCaptureDecoderHeap = (
  value: string | undefined,
): Result<CaptureDecoderHeap, ConfigurationError> => {
  if (value === undefined) return ok(DEFAULT_CAPTURE_DECODER_HEAP);
  const parsed = captureDecoderOldGenerationMiBSchema.safeParse(value);
  return parsed.success
    ? ok({ oldGenerationMiB: parsed.data, source: "setting" })
    : err(
        new ConfigurationError(captureDecoderHeapConstraint, {
          settings: [
            {
              setting: CAPTURE_DECODER_OLD_GENERATION_SETTING,
              constraint: captureDecoderHeapConstraint,
            },
          ],
        }),
      );
};

/**
 * Resolve the heap from a composition root's selected environment. An invalid
 * setting is refused, not ignored. Callers that already resolved it at startup
 * pass that value through instead of reading the environment again.
 */
export const resolveCaptureDecoderHeap = (
  environment: Readonly<Record<string, string | undefined>>,
): CaptureDecoderHeap => {
  const parsed = parseCaptureDecoderHeap(
    environment[CAPTURE_DECODER_OLD_GENERATION_SETTING],
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** How to read and change the effective HAR/SAZ/qlog old-generation heap. */
export const captureDecoderHeapRecovery = (heap: CaptureDecoderHeap): string =>
  [
    `The effective ${CAPTURE_DECODER_OLD_GENERATION_SETTING} value is ${String(heap.oldGenerationMiB)} MiB (source ${heap.source}; default ${String(DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB)} MiB, floor ${String(CAPTURE_DECODER_SEMI_SPACE_MIB)} MiB, maximum ${String(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB)} MiB).`,
    `Set ${CAPTURE_DECODER_OLD_GENERATION_SETTING} in the environment that starts REA to a decimal integer from ${String(CAPTURE_DECODER_SEMI_SPACE_MIB)} to ${String(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB)}, then restart REA. In a running MCP server, use update_analysis_settings with setting capture.decoder_old_generation_mib and action set instead; the new value applies to new work without a REA restart.`,
    `On Node.js the decoder passes --max-old-space-size=${String(heap.oldGenerationMiB)} and removes inherited NODE_OPTIONS, so additional host memory and NODE_OPTIONS do not raise this heap. The ${String(CAPTURE_DECODER_SEMI_SPACE_MIB)} MiB semi-space stays fixed.`,
    "On Bun the V8 flags are ignored. Windows limits the decoder's committed memory to this value plus a 512 MiB reserve. Other Bun hosts enforce no decoder heap limit.",
  ].join(" ");
