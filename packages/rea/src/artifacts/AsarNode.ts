import { z } from "zod";

/** Shared ASAR node declarations; consumers select only the fields they interpret. */
export const asarNodeSchema = z.looseObject({
  files: z
    .custom<Record<string, unknown>>(
      (value) =>
        value !== null && typeof value === "object" && !Array.isArray(value),
    )
    .optional(),
  link: z.string().optional(),
  size: z.number().nonnegative().safe().optional(),
  offset: z.string().optional(),
  unpacked: z.boolean().optional(),
  executable: z.boolean().optional(),
  integrity: z
    .looseObject({ algorithm: z.string(), hash: z.string() })
    .optional(),
});
