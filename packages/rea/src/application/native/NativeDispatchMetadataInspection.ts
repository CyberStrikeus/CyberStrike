import { createAnalysisExecutionEvidence } from "../../domain/analysisObservation.js";
import { permitsCapabilityFallback } from "../CapabilityFallback.js";
import { nativeInventoryRowsSchemas } from "../../domain/native/nativeInventory.js";
import {
  nativeDispatchMetadataResultSchema,
  inspectNativeDispatchMetadata,
} from "../../domain/native/objcSwiftMetadata.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { err, ok } from "../../domain/result.js";
import type { AnalysisOperationPort } from "../AnalysisProvider.js";
import type { EnhancedResult } from "../EnhancedToolTypes.js";

const dispatchNameInventorySchema = nativeInventoryRowsSchemas.names.element
  .strict()
  .array();

/** Source operations for this workflow, shared with capability discovery. */
export const NATIVE_DISPATCH_METADATA_SOURCES = {
  binary: "inspect_native_dispatch_metadata",
  symbols: "list_names",
} as const;

/** Prefer validated binary metadata, otherwise preserve the bound provider's symbol-only coverage. */
export const inspectNativeDispatch = async (
  analysis: AnalysisOperationPort,
  maxRecords: number,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly objcClassImportAddresses?: readonly string[] | undefined;
    readonly objcClassImportAddressesComplete?: boolean | undefined;
    /** Binary metadata input budget; symbol-only inventories ignore it. */
    readonly maxInputBytes?: number | undefined;
  } = {},
): EnhancedResult => {
  const {
    signal,
    objcClassImportAddresses,
    objcClassImportAddressesComplete,
    maxInputBytes,
  } = options;
  const input = {
    max_records: maxRecords,
    ...(maxInputBytes === undefined ? {} : { max_input_bytes: maxInputBytes }),
    ...(objcClassImportAddresses === undefined
      ? {}
      : {
          objc_class_import_addresses: [...objcClassImportAddresses],
          objc_class_import_addresses_complete:
            objcClassImportAddressesComplete ?? true,
        }),
  };
  const binaryMetadata = await analysis.execute(
    NATIVE_DISPATCH_METADATA_SOURCES.binary,
    input,
    signal === undefined ? {} : { signal },
  );
  if (binaryMetadata.ok) {
    const parsed = nativeDispatchMetadataResultSchema.safeParse(
      binaryMetadata.value.result,
    );
    if (!parsed.success)
      return err(
        new AnalysisOutputError(
          NATIVE_DISPATCH_METADATA_SOURCES.binary,
          "Invalid native dispatch metadata",
          { cause: parsed.error },
        ).retainPartialObservation(
          createAnalysisExecutionEvidence(
            NATIVE_DISPATCH_METADATA_SOURCES.binary,
            input,
            binaryMetadata.value,
            "observed",
          ),
        ),
      );
    return ok(jsonValueSchema.parse(parsed.data));
  }
  if (!permitsCapabilityFallback(binaryMetadata.error))
    return err(binaryMetadata.error);
  const execution = await analysis.execute(
    NATIVE_DISPATCH_METADATA_SOURCES.symbols,
    {},
    signal === undefined ? {} : { signal },
  );
  if (!execution.ok) return err(execution.error);
  const names = dispatchNameInventorySchema.safeParse(execution.value.result);
  if (!names.success)
    return err(
      new AnalysisOutputError(
        NATIVE_DISPATCH_METADATA_SOURCES.symbols,
        "provider returned an invalid inventory",
        { cause: names.error },
      ).retainPartialObservation(
        createAnalysisExecutionEvidence(
          NATIVE_DISPATCH_METADATA_SOURCES.symbols,
          {},
          execution.value,
          "observed",
        ),
      ),
    );
  const result = inspectNativeDispatchMetadata(
    names.data.map((entry) => ({
      address: entry.address,
      name: entry.value,
    })),
    maxRecords,
  );
  if (objcClassImportAddresses !== undefined) {
    result.objc_class_import_bindings = [];
    result.objc_class_import_binding_coverage = {
      facet: "objc_class_import_bindings",
      status: "unsupported",
      reason: "Native Mach-O pointer binding inspection is unavailable.",
      examined: 0,
      decoded: 0,
    };
  }
  return ok(
    jsonValueSchema.parse(
      nativeDispatchMetadataResultSchema.parse({
        target_sha256: execution.value.subject?.sha256 ?? null,
        target_architecture: execution.value.subject?.architecture ?? null,
        provider: execution.value.provider,
        analysis_profile_digest:
          execution.value.analysisProfile?.digest ?? null,
        result,
      }),
    ),
  );
};
