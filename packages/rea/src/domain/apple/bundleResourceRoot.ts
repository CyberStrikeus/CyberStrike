import { z } from "zod";

/** Provenance for app resources, independent of executable file identity. */
export const bundleResourceRootSchema = z.strictObject({
  caller_path: z.string().min(1),
  canonical_path: z.string().min(1),
  info_plist_path: z.string().min(1),
  layout: z.enum([
    "contents",
    "root",
    "versioned-framework",
    "flattened-framework",
  ]),
  executable_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
});

export type BundleResourceRoot = z.infer<typeof bundleResourceRootSchema>;

/** Output identity: executable-bound, or explicitly rooted resource-only. */
export const bundleResourceBoundResultSchema = <Fields extends z.ZodRawShape>(
  executableSha256: z.ZodType<string>,
  fields: Fields,
) =>
  z.union([
    z.strictObject({
      target_sha256: executableSha256,
      resource_root: bundleResourceRootSchema.optional(),
      ...fields,
    }),
    z.strictObject({
      target_sha256: z.null(),
      resource_root: bundleResourceRootSchema,
      ...fields,
    }),
  ]);
