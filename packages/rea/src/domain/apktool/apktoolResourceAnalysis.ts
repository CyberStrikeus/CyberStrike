import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";
import { digestSchema } from "../digests.js";

export const MAX_STRINGS = 2_000;
export const MAX_SELECTED_LOCALES = 20;
export const MAX_AGGREGATE_STRINGS = 10_000;
export const AGGREGATE_STRINGS_XML_MAX_BYTES = 32 * 1024 * 1024;
/** Decode wall clock used when decode_timeout_ms is omitted. */
export const DEFAULT_APKTOOL_DECODE_TIMEOUT_MS = 600_000;
/** Largest delay supported without overflowing Node timers. */
export const MAX_APKTOOL_DECODE_TIMEOUT_MS = 2_147_483_647;
const ANDROID_NON_LOCALE_QUALIFIERS = new Set([
  "car",
  "desk",
  "television",
  "appliance",
  "watch",
  "vrheadset",
  "night",
  "notnight",
]);

// Apktool emits b+language[+script][+region][+variant] from ARSC fields:
// language/region expand to at most 3 ASCII characters, script has 4 bytes,
// and variant has 8 bytes (BinaryResourceParser / ResConfig).
const MAX_ANDROID_LOCALE_SUFFIX = 2 + 3 + (1 + 4) + (1 + 3) + (1 + 8);

/** Locale language tags admitted by Android resource table selection. */
export const androidLocaleQualifierSchema = z
  .string()
  .min(2)
  .max(MAX_ANDROID_LOCALE_SUFFIX)
  // Legacy -r regions use two letters; numeric aliases select b+ tables.
  .regex(
    /^(?:[a-z]{2,3}(?:-(?:r?[A-Z]{2}|[0-9]{3}))?|b\+[a-z]{2,3}(?:\+[A-Za-z0-9]{2,8})*)$/u,
    "Locale must look like de, pt-BR, pt-rBR, es-419, or b+zh+Hans+CN",
  )
  .refine(
    (value) => !ANDROID_NON_LOCALE_QUALIFIERS.has(value.toLowerCase()),
    "Android resource configuration qualifiers are not locales",
  );

/** Normalize an admitted request alias at the locale-selection owner. */
export const androidLocaleDirectorySuffix = (locale: string): string =>
  locale
    .replace(/^([a-z]{2,3})-([A-Z]{2})$/u, "$1-r$2")
    .replace(/^([a-z]{2,3})-([0-9]{3})$/u, "b+$1+$2");

/** Exact selectable table names are distinct from whole resource configurations. */
export const classifyAndroidStringsTable = (
  suffix: string,
):
  | { readonly kind: "locale"; readonly locale: string }
  | { readonly kind: "other"; readonly suffix: string } => {
  const parsed = androidLocaleQualifierSchema.safeParse(suffix);
  return parsed.success && androidLocaleDirectorySuffix(parsed.data) === suffix
    ? { kind: "locale", locale: parsed.data }
    : { kind: "other", suffix };
};

/**
 * Caller intent for Apktool-backed resource decoding. Apktool is
 * bring-your-own: REA never installs it, and decoding happens in a
 * provider-owned workspace that is removed after the facts are projected.
 */
export const apktoolInputSchemas = {
  inspect_apktool_client: z.strictObject({}),
  decode_android_resources: z.strictObject({
    path: localPathStringSchema.describe("Local APK file to decode"),
    include_strings: z
      .boolean()
      .default(true)
      .describe(
        `Project res/values/strings.xml entries (bounded to ${String(MAX_STRINGS)} entries)`,
      ),
    string_tables_only: z
      .boolean()
      .optional()
      .describe(
        "Return selected strings only in string_tables, leaving top-level strings empty. Omit to preserve the primary strings field.",
      ),
    locale: androidLocaleQualifierSchema
      .optional()
      .describe(
        "Project strings from res/values-<locale>/strings.xml instead of the default table",
      ),
    locales: z
      .array(androidLocaleQualifierSchema)
      .min(1)
      .max(MAX_SELECTED_LOCALES)
      .optional()
      .describe(
        `Project multiple localized string tables from res/values-<locale>/strings.xml alongside the default table (bounded to ${String(MAX_SELECTED_LOCALES)} locales)`,
      ),
    decode_timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(MAX_APKTOOL_DECODE_TIMEOUT_MS)
      .exactOptional()
      .describe(
        `Decode wall-clock budget in milliseconds (default ${String(DEFAULT_APKTOOL_DECODE_TIMEOUT_MS)}), from apktool d start through process exit. Omitted means ${String(DEFAULT_APKTOOL_DECODE_TIMEOUT_MS)}. Applies on the next decode. Does not raise the fixed output capture allowance or the version probe.`,
      ),
  }),
} as const;

/** Supported Apktool-backed operations. */
export type ApktoolOperation = keyof typeof apktoolInputSchemas;
/** Validated Apktool requests carry their selected operation. */
export type ApktoolRequest = {
  [Name in ApktoolOperation]: {
    operation: Name;
    input: z.infer<(typeof apktoolInputSchemas)[Name]>;
  };
}[ApktoolOperation];

/** Validate operation and input together so their types remain correlated. */
export const apktoolRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_apktool_client"),
    input: apktoolInputSchemas.inspect_apktool_client,
  }),
  z.strictObject({
    operation: z.literal("decode_android_resources"),
    input: apktoolInputSchemas.decode_android_resources,
  }),
]);

const client = z.strictObject({
  command: z.string().min(1),
  command_source: z.enum(["environment", "path"]),
  apktool_version: z.string().min(1).nullable(),
});

/** An individual projected Android string table from an Apktool decode. */
export const stringTableSchema = z.strictObject({
  locale: z
    .string()
    .nullable()
    .describe(
      "null for default res/values/strings.xml, or the locale qualifier",
    ),
  status: z
    .enum(["present", "missing", "oversized", "malformed", "skipped"])
    .describe(
      "Table availability: present, missing from APK, oversized, malformed XML, or skipped due to limits",
    ),
  strings: z.array(
    z.strictObject({
      name: z.string().min(1),
      value: z.string(),
    }),
  ),
  total_count: z
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "Total valid string entries before output limits, or null if the table was not examined or was malformed",
    ),
  unparsed_count: z
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "Entries skipped due to nested markup or missing attributes, or null if the table was not examined or was malformed",
    ),
  coverage: z.enum(["complete", "partial"]),
});

export type StringTable = z.infer<typeof stringTableSchema>;

/** Portable Apktool observations with explicit coverage limitations. */
export const apktoolResultSchemas = {
  inspect_apktool_client: z.strictObject({
    client,
  }),
  decode_android_resources: z.strictObject({
    client,
    target: z.strictObject({
      path: localPathStringSchema,
      bytes: z.int().nonnegative(),
      sha256: digestSchema,
    }),
    metadata: z.strictObject({
      version_name: z.string().nullable(),
      version_code: z
        .string()
        .nullable()
        .describe(
          "Version code exactly as apktool.yml prints it, e.g. '45' or '45.1'",
        ),
      min_sdk_version: z.string().nullable(),
      target_sdk_version: z.string().nullable(),
      package_name: z.string().nullable(),
    }),
    manifest: z.string().nullable(),
    strings: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          value: z.string(),
        }),
      )
      .describe(
        "Primary string entries; empty when include_strings is false or string_tables_only is true. An unrequested field does not establish an empty table.",
      ),
    locale: z.string().nullable(),
    locales: z.array(z.string().min(1)),
    string_tables: z
      .array(stringTableSchema)
      .optional()
      .describe(
        "Selected table facts, included when locales is supplied or string_tables_only is true",
      ),
    decoded_file_count: z.int().nonnegative(),
    coverage: z.enum(["complete", "partial"]),
  }),
} as const;

export type ApktoolDecodeResult = z.infer<
  typeof apktoolResultSchemas.decode_android_resources
>;
