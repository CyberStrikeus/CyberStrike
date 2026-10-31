import { z } from "zod";

/** File-backed Constant-table declaration, not a runtime field observation. */
export const managedFieldConstantSchema = z.object({
  state: z.enum(["decoded", "unavailable"]),
  element_type: z
    .enum([
      "boolean",
      "char",
      "i1",
      "u1",
      "i2",
      "u2",
      "i4",
      "u4",
      "i8",
      "u8",
      "r4",
      "r8",
      "string",
      "class",
    ])
    .nullable(),
  declarations: z.array(
    z.object({
      row_offset: z.int().nonnegative(),
      type_code: z.int().min(0).max(255),
      padding: z.int().min(0).max(255),
      blob_index: z.int().nonnegative(),
    }),
  ),
  raw_hex: z
    .string()
    .regex(/^(?:[0-9a-f]{2})*$/u)
    .nullable(),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .describe(
      "Encoded scalar, not runtime state. i8/u8 are decimal strings; negative zero and nonfinite floats are -0/NaN/Infinity/-Infinity strings. Null is a decoded class null only when state is decoded.",
    ),
  limitation: z.string().nullable(),
});

export type ManagedFieldConstant = z.infer<typeof managedFieldConstantSchema>;
