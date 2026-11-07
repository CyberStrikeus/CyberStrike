import { z } from "zod";
import { analysisStringSchema } from "../native/nativeString.js";
import { addressedValueSchema } from "./nativeInventory.js";

/** Tracing reuses the search row's qualifications without reinterpreting them. */
export const literalFeatureMatchSchema = z.discriminatedUnion("type", [
  analysisStringSchema.extend({ type: z.literal("string") }),
  addressedValueSchema.extend({ type: z.literal("procedure") }),
]);
export type LiteralFeatureMatch = z.infer<typeof literalFeatureMatchSchema>;
