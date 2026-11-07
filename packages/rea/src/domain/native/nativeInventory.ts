import { z } from "zod";
import { nativeSymbolMetadataSchema } from "./nativeSymbol.js";
import { analysisStringSchema } from "./nativeString.js";
import { ok, type Result } from "../result.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import { invalidNativeOutput } from "./nativeProviderOutput.js";

/** Canonical named native observations; same-address alternatives stay separate. */
export const addressedValueSchema = z.object({
  address: z.string(),
  value: z.string(),
  symbol: nativeSymbolMetadataSchema.exactOptional(),
  objc_class_label: z.literal("hopper_legacy_class_object").exactOptional(),
  procedure: z
    .object({
      external: z.boolean(),
      thunk: z.boolean(),
      thunk_target: z.string().nullable(),
    })
    .exactOptional(),
  string: z
    .object({
      encoding: z.string(),
      termination: z.enum(["missing", "present_or_not_required"]),
      byte_length: z.number().int().min(0),
    })
    .exactOptional(),
});

/** Canonical row arrays shared by complete delivery and retained source validation. */
export const nativeInventoryRowsSchemas = {
  names: z.array(addressedValueSchema),
  strings: z.array(analysisStringSchema),
};

export const NATIVE_INVENTORY_OPERATIONS = [
  "list_procedures",
  "search_procedures",
  "list_strings",
  "search_strings",
  "list_names",
] as const;

export const nativeInventoryOperationSchema = z.enum(
  NATIVE_INVENTORY_OPERATIONS,
);
export type NativeInventoryOperation = z.infer<
  typeof nativeInventoryOperationSchema
>;

export const isNativeInventoryOperation = (
  operation: string,
): operation is NativeInventoryOperation =>
  NATIVE_INVENTORY_OPERATIONS.some((supported) => supported === operation);

export interface AddressedName {
  readonly address: string;
  readonly name: string;
  readonly objc_class_label?: "hopper_legacy_class_object";
}

/** An analyzed bookmark retains a missing provider label as null. */
export const analysisBookmarkSchema = z.strictObject({
  address: z.string(),
  name: z.string().nullable(),
});
/** Count only complete canonical inventories, using the advertised row contracts. */
export const parseNativeInventoryCount = (
  value: JsonValue,
  operation: "list_procedures" | "list_strings",
): Result<number, AnalysisOutputError> => {
  const schema =
    operation === "list_procedures"
      ? nativeInventoryRowsSchemas.names
      : nativeInventoryRowsSchemas.strings;
  const parsed = schema.safeParse(value);
  return parsed.success
    ? ok(parsed.data.length)
    : invalidNativeOutput(operation, "inventory rows", parsed.error);
};
