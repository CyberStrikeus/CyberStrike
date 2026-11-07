import { z } from "zod";

/** Component declarations, not effective installation or runtime state. */
export const ANDROID_COMPONENT_KINDS = [
  "activity",
  "activity-alias",
  "service",
  "receiver",
  "provider",
] as const;
export type AndroidComponentKind = (typeof ANDROID_COMPONENT_KINDS)[number];

/** Positions in retained decoded manifest text; offset counts UTF-16 code units. */
export const androidManifestLocationSchema = z.strictObject({
  line: z.int().positive(),
  column: z.int().positive(),
  offset: z.int().nonnegative(),
});
export type AndroidManifestLocation = z.output<
  typeof androidManifestLocationSchema
>;

export const androidIntentDataSchema = z.strictObject({
  location: androidManifestLocationSchema.nullable(),
  scheme: z.string().nullable(),
  host: z.string().nullable(),
  port: z.string().nullable(),
  path: z.string().nullable(),
  path_prefix: z.string().nullable(),
  path_pattern: z.string().nullable(),
  path_advanced_pattern: z.string().nullable(),
  path_suffix: z.string().nullable(),
  mime_type: z.string().nullable(),
});
export const androidIntentFilterSchema = z.strictObject({
  source_index: z.int().nonnegative(),
  location: androidManifestLocationSchema.nullable(),
  /** Exact declaration, including resource references; no effective priority claim. */
  priority: z.string().nullable(),
  actions: z.array(z.string()),
  categories: z.array(z.string()),
  data: z.array(androidIntentDataSchema),
  coverage: z.enum(["complete", "partial"]),
});
export const androidComponentMetadataSchema = z.strictObject({
  name: z.string().nullable(),
  location: androidManifestLocationSchema.nullable(),
});

export const androidManifestComponentSchema = z.strictObject({
  kind: z.enum(ANDROID_COMPONENT_KINDS),
  declared_name: z.string(),
  name: z.string(),
  exported: z.boolean().nullable(),
  exported_default: z.boolean().nullable(),
  permission: z.string().nullable(),
  permission_source: z.enum(["component", "application", "none", "unknown"]),
  intent_filter_count: z.int().nonnegative(),
  actions: z.array(z.string()),
  categories: z.array(z.string()),
  foreground_service_type: z.string().nullable(),
  authorities: z.array(z.string()).nullable(),
  target_activity: z.string().nullable(),
  // Historical records never observed these facets. Omission stays omission;
  // the default describes unknown coverage, never an absent declaration.
  declaration_coverage: z
    .enum(["complete", "partial", "unknown"])
    .default("unknown"),
  declaration_index: z.int().nonnegative().optional(),
  location: androidManifestLocationSchema.nullable().optional(),
  enabled: z.boolean().nullable().optional(),
  enabled_declaration: z.string().nullable().optional(),
  process: z.string().nullable().optional(),
  grant_uri_permissions: z.boolean().nullable().optional(),
  grant_uri_permissions_declaration: z.string().nullable().optional(),
  intent_filters: z.array(androidIntentFilterSchema).optional(),
  meta_data: z.array(androidComponentMetadataSchema).optional(),
});
export type AndroidManifestComponent = Readonly<
  z.output<typeof androidManifestComponentSchema>
>;
export const androidManifestComponentsSchema = z.strictObject({
  status: z.enum(["complete", "partial", "unavailable"]),
  items: z.array(androidManifestComponentSchema),
  limitations: z.array(z.string()),
});

/** Current producers observe every declaration facet; historical readers accept omissions. */
export const observedAndroidManifestComponentSchema =
  androidManifestComponentSchema.required();
export type ObservedAndroidManifestComponent = Readonly<
  z.output<typeof observedAndroidManifestComponentSchema>
>;
export const observedAndroidManifestComponentsSchema =
  androidManifestComponentsSchema.extend({
    items: z.array(observedAndroidManifestComponentSchema),
  });
export type ObservedAndroidManifestComponentInventory = Readonly<
  z.output<typeof observedAndroidManifestComponentsSchema>
>;
