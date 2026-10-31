import { z } from "zod";

/** Provider-owned bytes and exact coverage of one requested memory interval. */
export const nativeByteReadSchema = z
  .object({
    address: z.string(),
    requested_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    returned_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    bytes_hex: z.string().regex(/^(?:[a-f0-9]{2})*$/u),
    complete: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.returned_bytes * 2 !== value.bytes_hex.length ||
      value.returned_bytes > value.requested_bytes ||
      value.complete !== (value.returned_bytes === value.requested_bytes)
    )
      context.addIssue({
        code: "custom",
        message: "Read-byte length and completeness disagree",
      });
  });
