import { z } from "zod";
import { unavailableNativeFactSchema } from "./nativeFactAvailability.js";

/** Typed string evidence shared by inventories and referenced function literals. */
export const analysisStringSchema = z.object({
  address: z.string(),
  value: z.string(),
  provider_value: z
    .string()
    .exactOptional()
    .describe(
      "Original provider display text, which may shorten the typed object.",
    ),
  decoding: unavailableNativeFactSchema
    .exactOptional()
    .describe(
      "When present, value retains native display text because typed bytes could not be decoded.",
    ),
  string: z
    .object({
      encoding: z.string().min(1),
      encoding_status: z
        .enum(["observed", "inferred"])
        .exactOptional()
        .describe(
          "Whether the provider declares the encoding or REA infers it from the typed bytes and native display. This does not establish the original source's intended encoding.",
        ),
      termination: z.enum(["missing", "present_or_not_required"]),
      byte_length: z.int().min(0),
    })
    .exactOptional(),
});
