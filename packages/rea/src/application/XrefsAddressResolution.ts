import { permitsCapabilityFallback } from "./CapabilityFallback.js";
import { addressedValueSchema } from "../domain/native/nativeInventory.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import type { AnalysisOperationPort } from "./AnalysisProvider.js";
import { resolveProcedureAddress } from "./ProcedureAddressResolution.js";

/** Resolve an exact symbol after the provider rejects the caller address format. */
export const resolveXrefsAddress = async (
  analysis: AnalysisOperationPort,
  selector: string,
  signal: AbortSignal,
): Promise<Result<string, AnalysisError>> => {
  const named = await resolveXrefsName(analysis, selector, signal);
  if (!named.ok) return named;
  return named.value !== null
    ? ok(named.value)
    : err(
        new AnalysisInputError("xrefs", undefined, [
          {
            path: ["address"],
            reason: "invalid_value",
            message: `Unknown analyzed symbol name ${JSON.stringify(selector)}. Use an exact analyzed name or a hexadecimal address.`,
          },
        ]),
      );
};

/** Exact name resolution has one ambiguity owner for enhanced tools and CLI fallback. */
export const resolveXrefsName = async (
  analysis: AnalysisOperationPort,
  selector: string,
  signal?: AbortSignal,
  operation: "xrefs" | "find_xrefs_to_name" = "xrefs",
): Promise<Result<string | null, AnalysisError>> => {
  if (signal?.aborted)
    return err(new AnalysisCancelledError(operation, { cause: signal.reason }));
  const inventory = await analysis.execute(
    "list_names",
    {},
    signal === undefined ? {} : { signal },
  );
  if (!inventory.ok) {
    if (
      operation === "xrefs" &&
      permitsCapabilityFallback(inventory.error) &&
      inventory.error.operation === "list_names"
    )
      return resolveProcedureAddress(
        async (operation, parameters, signal) => {
          const result = await analysis.execute(
            operation,
            parameters,
            signal === undefined ? {} : { signal },
          );
          return result.ok ? ok(result.value.result) : result;
        },
        selector,
        signal,
      );
    return inventory;
  }
  if (signal?.aborted)
    return err(new AnalysisCancelledError(operation, { cause: signal.reason }));
  if (!Array.isArray(inventory.value.result))
    return err(
      new AnalysisOutputError(
        "list_names",
        "Expected a symbol inventory array",
      ),
    );

  const addresses = new Set<string>();
  for (const [index, item] of inventory.value.result.entries()) {
    const parsed = addressedValueSchema.safeParse(item);
    if (!parsed.success || parsed.data.address.length === 0)
      return err(
        new AnalysisOutputError(
          "list_names",
          `Invalid symbol inventory entry at index ${index}`,
        ),
      );
    if (parsed.data.value === selector) addresses.add(parsed.data.address);
  }
  const [address] = addresses;
  if (addresses.size <= 1) return ok(address ?? null);
  return err(
    new AnalysisInputError(operation, undefined, [
      {
        path: [operation === "xrefs" ? "address" : "name"],
        reason: "invalid_value",
        message: `Analyzed symbol name ${JSON.stringify(selector)} is ambiguous at ${[...addresses].sort().join(", ")}. Select an exact address.`,
      },
    ]),
  );
};
