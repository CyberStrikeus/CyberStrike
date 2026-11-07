import { z } from "zod";
import { nativeAddressObservationSchema } from "../domain/native/nativeAddress.js";
import {
  availableNativeApiBoundarySchema,
  unavailableNativeApiBoundarySchema,
} from "../domain/native/nativeApiBoundary.js";
import {
  availableNativeValueFlowSchema,
  unavailableNativeValueFlowSchema,
  nativePcodeOperationSchema,
  nativeVarnodeSchema,
} from "../domain/native/nativeValueFlow.js";

const jumpTable = availableNativeApiBoundarySchema.shape.jump_tables.element;
const ghidraJumpTable = jumpTable.extend({
  dispatch_address: nativeAddressObservationSchema,
  data_sources: z.array(
    jumpTable.shape.data_sources.element.extend({
      address: nativeAddressObservationSchema,
    }),
  ),
  mappings: z.array(
    jumpTable.shape.mappings.element.extend({
      target_address: nativeAddressObservationSchema,
    }),
  ),
  default_targets: z.array(
    jumpTable.shape.default_targets.element.extend({
      target_address: nativeAddressObservationSchema,
    }),
  ),
});

/** Ghidra API facts carry canonical coordinates and HighFunction provenance. */
export const ghidraNativeApiBoundary = z.discriminatedUnion("available", [
  unavailableNativeApiBoundarySchema,
  availableNativeApiBoundarySchema.extend({
    provenance: z.literal("ghidra-high-function"),
    jump_tables: z.array(ghidraJumpTable),
  }),
]);

const ghidraVarnode = nativeVarnodeSchema.extend({
  location: nativeAddressObservationSchema.nullable(),
});
const ghidraPcodeOperation = nativePcodeOperationSchema.extend({
  address: nativeAddressObservationSchema,
  inputs: z.array(ghidraVarnode),
  output: ghidraVarnode.nullable(),
});

/** Validate relationships only after each p-code observation has been admitted. */
export const ghidraNativeValueFlow = z.discriminatedUnion("available", [
  unavailableNativeValueFlowSchema,
  availableNativeValueFlowSchema
    .extend({ operations: z.array(ghidraPcodeOperation) })
    .superRefine((value, context) => {
      const { operations } = value;
      const operationIds = new Set(operations.map(({ id }) => id));
      if (operationIds.size !== operations.length)
        context.addIssue({
          code: "custom",
          message: "Ghidra p-code operation identifiers are not unique",
        });
      if (
        value.def_use.some(
          ({ definition, use }) =>
            !operationIds.has(definition) || !operationIds.has(use),
        ) ||
        value.effects.some(({ operation }) => !operationIds.has(operation))
      )
        context.addIssue({
          code: "custom",
          message: "Ghidra p-code relationship references a missing operation",
        });
      if (
        value.truncated !==
        (value.omitted_operations_lower_bound > 0 ||
          value.known_omitted_inputs > 0 ||
          value.known_omitted_edges > 0)
      )
        context.addIssue({
          code: "custom",
          message: "Ghidra p-code truncation flag contradicts omitted counts",
        });
    }),
]);
