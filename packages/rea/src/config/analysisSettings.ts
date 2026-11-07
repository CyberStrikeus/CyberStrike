import { err, ok } from "../domain/result.js";
import type { z } from "zod";
import type { AnalysisSettingId } from "../domain/analysisSettings.js";
import { analysisSettingDefinition } from "../domain/analysisSettingDefinitions.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { asarMaxHeaderBytesSchema } from "./asarHeaderAdmission.js";
import {
  providerStartupTimeoutSchema,
  ghidraDecompileTimeoutSchema,
} from "./providerStartupTimeout.js";
import { regexMatchingDeadlineMsSchema } from "./regexMatchingDeadline.js";
import { regexWorkerHeapRequestMiBSchema } from "./regexWorkerHeapRequest.js";
import { captureDecoderOldGenerationMiBSchema } from "./captureDecoderHeap.js";
import { parseNativeMatchingAllowance } from "./nativeMatchingAllowance.js";
const environmentSchemas: Readonly<Record<string, z.ZodType<number, string>>> =
  {
    REA_ASAR_MAX_HEADER_BYTES: asarMaxHeaderBytesSchema,
    REA_GHIDRA_STARTUP_TIMEOUT_MS: providerStartupTimeoutSchema,
    REA_HOPPER_STARTUP_TIMEOUT_MS: providerStartupTimeoutSchema,
    REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: ghidraDecompileTimeoutSchema,
    REA_JADX_OPERATION_TIMEOUT_MS: providerStartupTimeoutSchema,
    REA_REGEX_MATCHING_DEADLINE_MS: regexMatchingDeadlineMsSchema,
    REA_REGEX_WORKER_HEAP_REQUEST_MIB: regexWorkerHeapRequestMiBSchema,
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB:
      captureDecoderOldGenerationMiBSchema,
  };
export const launchAnalysisSetting = (
  id: AnalysisSettingId,
  environment: Readonly<Record<string, string | undefined>>,
) => {
  if (id === "native.matching_representation_bytes") {
    const parsed = parseNativeMatchingAllowance(environment);
    return parsed.ok
      ? ok({ value: parsed.value.maximumBytes, source: parsed.value.source })
      : parsed;
  }
  const definition = analysisSettingDefinition(id);
  const raw =
    definition.environment === undefined
      ? undefined
      : environment[definition.environment];
  if (raw === undefined)
    return ok({ value: definition.defaultValue, source: "default" as const });
  const parsed = environmentSchemas[definition.environment!]?.safeParse(raw);
  if (parsed?.success !== true)
    return err(
      new ConfigurationError(`Invalid ${definition.environment}`, {
        settings: [
          {
            setting: definition.environment!,
            constraint: `Expected an integer from ${definition.minimum} to ${definition.maximum} ${definition.unit}`,
          },
        ],
      }),
    );
  return ok({ value: parsed.data, source: "setting" as const });
};
