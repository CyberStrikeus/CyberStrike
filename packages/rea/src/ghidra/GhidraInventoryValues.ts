import { nativeSearchFields } from "../domain/native/nativeSearch.js";
import { nativeSymbolMetadataSchema } from "../domain/native/nativeSymbol.js";
import { nativeAddressObservationSchema } from "../domain/native/nativeAddress.js";
import { nativeByteReadSchema } from "../domain/native/nativeByteRead.js";
import { z } from "zod";
import { jsonRecordSchema } from "../domain/jsonRecord.js";
import {
  MAX_BYTE_SEARCH_MATCHES,
  bytePatternFields,
  validateBytePattern,
  byteSearchResultSchema,
} from "../domain/native/bytePattern.js";
import {
  normalizeNativeLoadImageObservation,
  nativeLoadImageObservationSchema,
  type NativeLoadImageObservation,
} from "../domain/native/nativeLoadImage.js";

import {
  type AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { projectBinaryOverview } from "../domain/native/nativeSegments.js";
import {
  availableFunctionBodySchema,
  functionBodyEntryAgrees,
} from "../domain/native/functionBody.js";
import { procedureIdentitySchema } from "../domain/native/procedureInfo.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";

/**
 * Direct inventory operations admitted by the Ghidra adapter. All are reads
 * except the naming operations, which edit the ephemeral session database.
 */
export const GHIDRA_INVENTORY_OPERATIONS = [
  "read_binary_inventory_summary",
  "inspect_native_load_image",
  "read_bytes",
  "search_bytes",
  "address_to_file_offset",
  "address_name",
  "list_documents",
  "list_names",
  "list_procedures",
  "list_segments",
  "list_strings",
  "procedure_address",
  "resolve_containing_procedure",
  "search_procedures",
  "search_strings",
  "set_address_name",
  "set_addresses_names",
] as const;

/** Inventory operations that write analyst names into the session database. */
export const GHIDRA_NAMING_OPERATIONS = [
  "set_address_name",
  "set_addresses_names",
] as const satisfies readonly GhidraInventoryOperation[];

type GhidraNamingOperation = (typeof GHIDRA_NAMING_OPERATIONS)[number];

/** One direct inventory operation implemented by the packaged Java bridge. */
export type GhidraInventoryOperation =
  (typeof GHIDRA_INVENTORY_OPERATIONS)[number];

const operationSet: ReadonlySet<string> = new Set(GHIDRA_INVENTORY_OPERATIONS);

/** Narrow an application operation to the Ghidra inventory surface. */
export const isGhidraInventoryOperation = (
  operation: string,
): operation is GhidraInventoryOperation => operationSet.has(operation);

export const ghidraIdentifierSchema = z.string().min(1);
const identifier = ghidraIdentifierSchema;
const document = identifier.nullable().default(null);
/** Caller address spelling; the bridge resolves its space and emits canonical output. */
export const ghidraInputAddressSchema = z
  .string()
  .regex(
    /^(?:(?:0[xX])?[0-9a-fA-F]+|(?:[A-Za-z0-9._~-]|%[0-9a-fA-F]{2})+:0[xX][0-9a-fA-F]+)$/u,
    "Use hexadecimal digits, optionally prefixed with 0x, or an encoded address-space name followed by :0x and hexadecimal digits",
  );
const explicitAddress = ghidraInputAddressSchema;
const filteredAddress = explicitAddress.nullable().default(null);
const searchInput = {
  ...nativeSearchFields,
  document,
};

const inputSchemas = {
  read_binary_inventory_summary: z.strictObject({}),
  search_bytes: z
    .strictObject({
      ...bytePatternFields,
      document,
      start: explicitAddress.optional(),
      end: explicitAddress.optional(),
      limit: z.int().min(1).max(MAX_BYTE_SEARCH_MATCHES).default(100),
      cursor: z.string().min(1).optional(),
    })
    .superRefine(validateBytePattern),
  inspect_native_load_image: z.strictObject({}),
  read_bytes: z.strictObject({
    document,
    address: explicitAddress,
    length: z.int().min(1).max(Number.MAX_SAFE_INTEGER).default(256),
  }),
  address_to_file_offset: z.strictObject({
    document,
    address: explicitAddress,
  }),
  address_name: z.object({ document, address: explicitAddress }).strict(),
  list_documents: z.object({}).strict(),
  list_names: z.object({ document, address: filteredAddress }).strict(),
  list_procedures: z.object({ document }).strict(),
  list_segments: z.object({ document }).strict(),
  list_strings: z.object({ document, address: filteredAddress }).strict(),
  procedure_address: z.object({ document, procedure: identifier }).strict(),
  resolve_containing_procedure: z
    .object({ document, address: explicitAddress })
    .strict(),
  search_procedures: z.object(searchInput).strict(),
  search_strings: z.object(searchInput).strict(),
  set_address_name: z
    .object({ document, address: explicitAddress, name: z.string().min(1) })
    .strict(),
  set_addresses_names: z
    .object({
      document,
      names: jsonRecordSchema(z.string().min(1), explicitAddress),
    })
    .strict()
    .refine(
      (value) => Object.keys(value.names).length > 0,
      "Supply at least one address name",
    ),
} satisfies Readonly<Record<GhidraInventoryOperation, z.ZodType>>;

/** Validate and default one provider request before it crosses the socket. */
export const parseGhidraInventoryInput = (
  operation: GhidraInventoryOperation,
  value: Readonly<Record<string, JsonValue>>,
): Result<Readonly<Record<string, JsonValue>>, AnalysisInputError> => {
  const parsed = inputSchemas[operation].safeParse(value);
  if (!parsed.success)
    return err(
      analysisInputErrorFromIssues(operation, parsed.error.issues, value, {
        cause: parsed.error,
      }),
    );
  return ok(parsed.data);
};

const symbolFacts = z
  .object({
    primary: z.boolean(),
    dynamic: z.boolean(),
    external: z.boolean(),
    type: z.string().min(1),
    source: z.enum(["default", "analysis", "ai", "imported", "user_defined"]),
  })
  .strict();
const procedureFacts = z
  .object({
    external: z.boolean(),
    thunk: z.boolean(),
    thunk_target: nativeAddressObservationSchema.nullable(),
  })
  .strict();
/** Ghidra FunctionManager classification, independent of body ownership inference. */
export const ghidraFunctionClassificationSchema = procedureFacts
  .extend({ provenance: z.literal("ghidra-function-manager") })
  .strict();
/** Require complete canonical AddressSet evidence on every Ghidra function identity. */
export const ghidraFunctionBodySchema = availableFunctionBodySchema.safeExtend({
  provenance: z.literal("ghidra-function-body-address-set"),
  ranges: z.array(
    availableFunctionBodySchema.shape.ranges.element.extend({
      start: nativeAddressObservationSchema,
      end: nativeAddressObservationSchema,
    }),
  ),
});

/** Canonical Ghidra identity, retaining the generic dossier's name and symbol admission. */
export const ghidraFunctionIdentitySchema = procedureIdentitySchema
  .safeExtend({
    address: nativeAddressObservationSchema,
    classification: ghidraFunctionClassificationSchema,
    body: ghidraFunctionBodySchema,
  })
  .superRefine((value, context) => {
    if (!value.classification.external && !value.body.contains_entry)
      context.addIssue({
        code: "custom",
        message: "Ghidra function body disagrees with its entry point",
      });
  });

/** Inventory identities require a nonempty name and an explicit symbol observation. */
export const ghidraProcedureIdentitySchema =
  ghidraFunctionIdentitySchema.safeExtend({
    name: z.string().min(1),
    symbol: nativeSymbolMetadataSchema.nullable(),
  });

const stringFacts = z
  .object({
    encoding: z.string().min(1),
    termination: z.enum(["missing", "present_or_not_required"]),
    byte_length: z.int().min(0),
  })
  .strict();
const baseItem = {
  address: nativeAddressObservationSchema,
  value: z.string(),
};
const symbolItem = z.object({ ...baseItem, symbol: symbolFacts }).strict();
const addressedItem = z
  .object({ ...baseItem, symbol: symbolFacts.exactOptional() })
  .strict();
const procedureItem = addressedItem.extend({ procedure: procedureFacts });
const stringItem = z.object({ ...baseItem, string: stringFacts }).strict();

const availablePermissions = z
  .object({
    available: z.literal(true),
    source: z.literal("ghidra-memory-block"),
  })
  .strict();
const memoryRegion = z
  .object({
    name: z.string(),
    start: nativeAddressObservationSchema,
    end: nativeAddressObservationSchema,
    readable: z.boolean(),
    writable: z.boolean(),
    executable: z.boolean(),
    permissions: availablePermissions,
    provenance: z.literal("ghidra-memory-block"),
    address_space: z.string().min(1),
    image_base: nativeAddressObservationSchema,
    initialized: z.boolean(),
    overlay: z.boolean(),
  })
  .strict();
const segment = memoryRegion
  .extend({ sections: z.array(memoryRegion) })
  .strict();
const containingProcedure = z.discriminatedUnion("found", [
  z
    .object({
      query_address: nativeAddressObservationSchema,
      found: z.literal(true),
      procedure: ghidraProcedureIdentitySchema,
    })
    .strict()
    .superRefine((value, context) => {
      const body = value.procedure.body;
      const exactExternalEntry =
        value.procedure.classification.external &&
        value.query_address === value.procedure.address;
      if (
        !exactExternalEntry &&
        body.available &&
        !functionBodyEntryAgrees(
          { ...body, contains_entry: true },
          value.query_address,
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Found containing procedure body does not contain the query address",
        });
    }),
  z
    .object({
      query_address: nativeAddressObservationSchema,
      found: z.literal(false),
      procedure: z.null(),
      reason: z.enum(["outside_segments", "not_in_procedure"]),
    })
    .strict(),
]);

/**
 * Bridge-owned reasons why Ghidra did not apply one requested analyst name.
 * Batch reasons are decided from the names held before the batch.
 */
const ADDRESS_NAME_FAILURE_REASONS = [
  "invalid_address",
  "unmapped_address",
  "invalid_name",
  "conflicting_alias_names",
  "duplicate_requested_name",
  "name_held_by_selected_address",
  "name_held_by_unselected_address",
  "duplicate_name",
  "readback_mismatch",
] as const;
type AddressNameFailureReason = (typeof ADDRESS_NAME_FAILURE_REASONS)[number];
/** Reasons explained by one shared contested-destination record. */
const conflictReasons: ReadonlySet<AddressNameFailureReason> = new Set([
  "duplicate_requested_name",
  "name_held_by_selected_address",
  "name_held_by_unselected_address",
]);
/** Reasons a single-address edit can report; selection conflicts need a batch. */
const singleAddressNameReasons: ReadonlySet<AddressNameFailureReason> = new Set(
  [
    "invalid_name",
    "name_held_by_unselected_address",
    "duplicate_name",
    "readback_mismatch",
  ],
);
const distinct = (values: readonly string[]) =>
  new Set(values).size === values.length;
const addressNameFailure = z
  .strictObject({
    address: nativeAddressObservationSchema.nullable(),
    reason: z.enum(ADDRESS_NAME_FAILURE_REASONS),
    conflict: z.int().min(0).nullable(),
  })
  .superRefine((failure, context) => {
    if ((failure.address === null) !== (failure.reason === "invalid_address"))
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "Only an unresolved address lacks its canonical address",
      });
    if ((failure.conflict === null) === conflictReasons.has(failure.reason))
      context.addIssue({
        code: "custom",
        path: ["conflict"],
        message:
          "Exactly the conflict reasons refer to a contested destination",
      });
  });
/** One contested destination, shared by every address that requested it. */
const addressNameConflict = z.strictObject({
  namespace: z.string().min(1).nullable(),
  name: z.string().min(1),
  requested_by: z
    .array(nativeAddressObservationSchema)
    .min(1)
    .refine(distinct, "Requesting addresses are distinct"),
  held_by: z
    .array(nativeAddressObservationSchema)
    .refine(distinct, "Holding addresses are distinct"),
});
/**
 * Per-key booleans, reasons for failed keys and each contested destination
 * once, so reply size grows linearly with the request and its holders.
 */
const addressNameOutcomes = z
  .strictObject({
    results: jsonRecordSchema(z.boolean()),
    failures: jsonRecordSchema(addressNameFailure),
    conflicts: z.array(addressNameConflict),
  })
  .superRefine(({ results, failures, conflicts }, context) => {
    for (const [key, applied] of Object.entries(results))
      if (applied === Object.hasOwn(failures, key))
        context.addIssue({
          code: "custom",
          path: ["failures", key],
          message:
            "Exactly the addresses that were not applied report a reason",
        });
    // Index each destination once so validation stays linear in reply size.
    const contested = conflicts.map((conflict) => ({
      members: new Set(conflict.requested_by),
      reasons:
        conflict.requested_by.length > 1
          ? ["duplicate_requested_name"]
          : conflict.held_by.some(
                (holder) => holder !== conflict.requested_by[0],
              )
            ? [
                "name_held_by_selected_address",
                "name_held_by_unselected_address",
              ]
            : [],
      referenced: new Set<string>(),
    }));
    for (const [key, failure] of Object.entries(failures)) {
      if (!Object.hasOwn(results, key))
        context.addIssue({
          code: "custom",
          path: ["failures", key],
          message: "A failure reason names an address outside the batch result",
        });
      if (failure.conflict === null) continue;
      const conflict = contested[failure.conflict];
      if (
        conflict === undefined ||
        failure.address === null ||
        !conflict.members.has(failure.address) ||
        !conflict.reasons.includes(failure.reason)
      )
        context.addIssue({
          code: "custom",
          path: ["failures", key, "conflict"],
          message: "A conflict reason must match its contested destination",
        });
      else conflict.referenced.add(failure.address);
    }
    contested.forEach(({ members, referenced }, index) => {
      if (referenced.size !== members.size)
        context.addIssue({
          code: "custom",
          path: ["conflicts", index],
          message: "Every requesting address fails with this conflict",
        });
    });
  });
/** A single edit reports one key and only reasons one address can produce. */
const singleAddressNameOutcome = addressNameOutcomes.superRefine(
  ({ results, failures }, context) => {
    if (
      Object.keys(results).length !== 1 ||
      Object.values(failures).some(
        ({ reason }) => !singleAddressNameReasons.has(reason),
      )
    )
      context.addIssue({
        code: "custom",
        message: "A single name edit reports one supported outcome",
      });
  },
);

const byteMatch = byteSearchResultSchema.shape.matches.element;
const canonicalByteMatch = byteMatch.safeExtend({
  address: nativeAddressObservationSchema,
  procedure: byteMatch.shape.procedure
    .unwrap()
    .safeExtend({ address: nativeAddressObservationSchema })
    .nullable(),
});
const byteCoverage = byteSearchResultSchema.shape.searched.shape;
const canonicalByteCoverage = byteCoverage.blocks.element.safeExtend({
  start: nativeAddressObservationSchema,
  end: nativeAddressObservationSchema,
});

const resultSchemas = {
  read_binary_inventory_summary: z
    .strictObject({
      document: identifier,
      segments: z.array(segment),
      procedure_count: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
      string_count: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .transform(projectBinaryOverview),
  search_bytes: byteSearchResultSchema.safeExtend({
    matches: z.array(canonicalByteMatch).max(MAX_BYTE_SEARCH_MATCHES),
    searched: byteSearchResultSchema.shape.searched.safeExtend({
      blocks: z.array(canonicalByteCoverage),
      skipped_uninitialized: z.array(canonicalByteCoverage),
      skipped_not_loaded: z.array(canonicalByteCoverage),
    }),
  }),
  inspect_native_load_image: nativeLoadImageObservationSchema,
  read_bytes: nativeByteReadSchema
    .safeExtend({ address: nativeAddressObservationSchema })
    .strict(),
  address_to_file_offset: z.strictObject({
    address: nativeAddressObservationSchema,
    file_offset: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  address_name: z.string().nullable(),
  list_documents: z.array(z.string().min(1)).length(1),
  list_names: z.array(symbolItem),
  list_procedures: z.array(procedureItem),
  list_segments: z.array(segment),
  list_strings: z.array(stringItem),
  procedure_address: nativeAddressObservationSchema,
  resolve_containing_procedure: containingProcedure,
  search_procedures: z.array(addressedItem),
  search_strings: z.array(addressedItem),
} satisfies Readonly<
  Record<Exclude<GhidraInventoryOperation, GhidraNamingOperation>, z.ZodType>
>;

/** The format owner retains raw output only when projection omits reported facts. */
export interface ParsedGhidraInventoryResult<Value = JsonValue> {
  readonly value: Value;
  readonly rawResult?: JsonValue;
}

/** Validate exact Java-bridge output and own its Evidence representation. */
export function parseGhidraInventoryResult(
  operation: "inspect_native_load_image",
  value: JsonValue,
): Result<
  ParsedGhidraInventoryResult<NativeLoadImageObservation>,
  AnalysisOutputError
>;
export function parseGhidraInventoryResult(
  operation: GhidraInventoryOperation,
  value: JsonValue,
): Result<ParsedGhidraInventoryResult, AnalysisOutputError>;
export function parseGhidraInventoryResult(
  operation: GhidraInventoryOperation,
  value: JsonValue,
): Result<
  ParsedGhidraInventoryResult<JsonValue | NativeLoadImageObservation>,
  AnalysisOutputError
> {
  if (operation === "inspect_native_load_image") {
    const parsed = resultSchemas.inspect_native_load_image.safeParse(value);
    return parsed.success
      ? ok({ value: normalizeNativeLoadImageObservation(parsed.data) })
      : err(inventoryOutputFailure(operation, parsed.error));
  }
  if (operation === "set_address_name" || operation === "set_addresses_names") {
    const parsed = (
      operation === "set_address_name"
        ? singleAddressNameOutcome
        : addressNameOutcomes
    ).safeParse(value);
    if (!parsed.success)
      return err(inventoryOutputFailure(operation, parsed.error));
    const { results, failures, conflicts } = parsed.data;
    const outcomes = Object.values(results);
    // Booleans answer the caller. Failure facts stay in raw_result without a
    // second copy of those booleans.
    return ok({
      value: operation === "set_address_name" ? outcomes[0]! : results,
      ...(outcomes.every(Boolean)
        ? {}
        : { rawResult: { failures, conflicts } }),
    });
  }
  const parsed = resultSchemas[operation].safeParse(value);
  return parsed.success
    ? ok({
        value: jsonValueSchema.parse(parsed.data),
        // The overview omits detailed segment permissions, sections and provenance.
        // Load-image observations above undergo separate local attestation.
        ...(operation === "read_binary_inventory_summary"
          ? { rawResult: value }
          : {}),
      })
    : err(inventoryOutputFailure(operation, parsed.error));
}

const inventoryOutputFailure = (
  operation: GhidraInventoryOperation,
  cause: unknown,
): AnalysisOutputError =>
  new AnalysisOutputError(
    operation,
    "Ghidra bridge output did not match the inventory contract",
    { cause },
  );
