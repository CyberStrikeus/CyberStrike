import { z } from "zod";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { androidManifestComponentsSchema } from "./androidManifestComponents.js";
import {
  androidViewRequestSchema,
  validateAndroidPackageDelivery,
} from "./androidPackageQuery.js";
import { androidMappingReportSchema } from "./androidMapping.js";
import { dexDescriptorSchema } from "./dexTypes.js";
import {
  androidJniSelectionSchema,
  androidJniReportSchema,
} from "./androidJniBindings.js";
import { androidJniViewRequestSchema } from "./androidJniQuery.js";

const target = {
  path: localPathStringSchema.describe(
    "Local APK path; the target is never executed",
  ),
};
const classTarget = {
  ...target,
  class_name: z.string().min(1).describe("Exact fully qualified class name"),
};
const mappingPath = {
  mapping_path: absoluteLocalPathStringSchema
    .optional()
    .describe(
      "Absolute local R8/ProGuard mapping.txt; names are annotated, never replaced",
    ),
};

/** Caller intent for static Android inspection, independent of its engine. */
export const androidInputSchemas = {
  inspect_android_package: z.strictObject(target),
  inspect_android_jni_bindings: androidJniSelectionSchema.extend(target),
  search_android_classes: z.strictObject({
    ...target,
    query: z
      .string()
      .describe("Case-sensitive class-name substring; empty lists all classes"),
  }),
  inspect_android_class: z.strictObject({ ...classTarget, ...mappingPath }),
  inspect_android_method: z.strictObject({
    ...classTarget,
    ...mappingPath,
    method_name: z.string().min(1),
    overload_index: z
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Explicit index among same-name methods; required when ambiguous",
      ),
  }),
  trace_android_references: z.strictObject({
    ...classTarget,
    class_name: classTarget.class_name.describe(
      "Exact APK-defined class, or an externally referenced DEX class when method_name is selected",
    ),
    method_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Omit for class references; select ambiguous methods with overload_index",
      ),
    overload_index: z
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Index among same-name APK methods or observed external DEX prototypes; requires method_name",
      ),
  }),
} as const;

/** Optional retained delivery is separate from the engine's APK request. */
export const androidPackageInspectionInputSchema =
  androidInputSchemas.inspect_android_package
    .extend({
      detail: z.enum(["complete", "summary"]).optional(),
      view: androidViewRequestSchema.optional(),
    })
    .superRefine(validateAndroidPackageDelivery);

/** Delivery is an adapter/application choice, never a provider analysis option. */
export const androidSymbolInspectionInputSchemas = {
  inspect_android_class: androidInputSchemas.inspect_android_class.extend({
    detail: z.enum(["complete", "summary"]).optional(),
  }),
  inspect_android_method: androidInputSchemas.inspect_android_method.extend({
    detail: z.enum(["complete", "summary"]).optional(),
  }),
} as const;

/** JNI selection changes analysis; delivery only selects retained views. */
export const androidJniInspectionInputSchema =
  androidInputSchemas.inspect_android_jni_bindings
    .extend({
      detail: z.enum(["complete", "summary"]).default("summary"),
      view: androidJniViewRequestSchema.optional(),
    })
    .superRefine(validateAndroidPackageDelivery);

/** Supported static Android operations. */
export type AndroidOperation = keyof typeof androidInputSchemas;
/** Validated Android requests carry their selected operation. */
export type AndroidRequest = {
  [Name in AndroidOperation]: {
    operation: Name;
    input: z.infer<(typeof androidInputSchemas)[Name]>;
  };
}[AndroidOperation];

/** Validate operation and input together so their types remain correlated. */
export const androidRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_android_jni_bindings"),
    input: androidInputSchemas.inspect_android_jni_bindings,
  }),
  z.strictObject({
    operation: z.literal("inspect_android_package"),
    input: androidInputSchemas.inspect_android_package,
  }),
  z.strictObject({
    operation: z.literal("search_android_classes"),
    input: androidInputSchemas.search_android_classes,
  }),
  z.strictObject({
    operation: z.literal("inspect_android_class"),
    input: androidInputSchemas.inspect_android_class,
  }),
  z.strictObject({
    operation: z.literal("inspect_android_method"),
    input: androidInputSchemas.inspect_android_method,
  }),
  z.strictObject({
    operation: z.literal("trace_android_references"),
    input: androidInputSchemas.trace_android_references,
  }),
]);

const textCoverage = z.strictObject({
  status: z.enum(["complete", "partial"]),
  text: z.string(),
  reported_total_bytes: z.int().nonnegative().nullable(),
});

const integral = <Type extends string>(type: Type, min: number, max: number) =>
  z.strictObject({
    type: z.literal(type),
    value: z.int().min(min).max(max),
  });
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;
/** Finite text must name a value of the given width; only zero text may round to zero. */
const floating = <Type extends "float" | "double">(
  type: Type,
  round: (value: number) => number,
) =>
  z.strictObject({
    type: z.literal(type),
    value: z
      .string()
      .regex(/^(?:NaN|-?Infinity|-?\d+\.\d+(?:E-?\d+)?)$/u)
      .refine((text) => {
        if (/^(?:NaN|-?Infinity)$/u.test(text)) return true;
        const rounded = round(Number(text));
        return (
          Number.isFinite(rounded) &&
          (rounded !== 0 || /^-?0\.0+(?:E-?\d+)?$/u.test(text))
        );
      }),
  });
/** A static final field's DEX static value; wide and floating values keep Java text. */
export const dexStaticValueSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
  integral("byte", -128, 127),
  integral("short", -32_768, 32_767),
  integral("char", 0, 65_535),
  integral("int", -2_147_483_648, 2_147_483_647),
  z.strictObject({
    type: z.literal("long"),
    value: z
      .string()
      .regex(/^(?:0|-?[1-9]\d*)$/u)
      .refine((text) => BigInt(text) >= LONG_MIN && BigInt(text) <= LONG_MAX),
  }),
  floating("float", Math.fround),
  floating("double", (value) => value),
  z.strictObject({ type: z.literal("string"), value: z.string() }),
]);

const method = z.strictObject({
  name: z.string(),
  reported_signature: z.string(),
  overload_index: z.int().nonnegative(),
  is_constructor: z.boolean(),
  dex_descriptor: dexDescriptorSchema,
});
/** Exact member selector shared with follow-up APK method inspection. */
export const androidMethodSelectorSchema = z.strictObject({
  class_name: z.string().min(1),
  method_name: z.string().min(1),
  overload_index: z.int().nonnegative(),
});
const engine = z.strictObject({
  name: z.string().min(1),
  version: z.string().nullable(),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  source_revision: z.string().nullable(),
  worker_count: z.int().positive(),
  heap_limit_mib: z.int().positive().nullable(),
});
const common = { engine };

/** Portable observations with explicit decompiler and identity limitations. */
export const androidResultSchemas = {
  inspect_android_jni_bindings: androidJniReportSchema.extend(common),
  inspect_android_package: z.strictObject({
    ...common,
    package_name: z.string().nullable(),
    version_name: z.string().nullable(),
    version_code: z.string().nullable(),
    min_sdk: z.string().nullable(),
    target_sdk: z.string().nullable(),
    permissions: z.array(z.string()),
    manifest: textCoverage,
    // Evidence retained before the component projection existed re-parses
    // with an explicit unavailable inventory; current results always carry it.
    components: androidManifestComponentsSchema.default(() => ({
      status: "unavailable" as const,
      items: [],
      limitations: [
        "This Evidence predates the manifest component projection; run inspect_android_package again to obtain it.",
      ],
    })),
    class_count: z.int().nonnegative(),
    resource_count: z.int().nonnegative(),
    signature_verification: z.literal("not_performed"),
  }),
  search_android_classes: z.strictObject({
    ...common,
    query: z.string(),
    total_classes: z.int().nonnegative(),
    matches: z.array(z.string()),
    duplicate_names: z.array(
      z.strictObject({
        name: z.string(),
        occurrences: z.int().min(2),
      }),
    ),
    coverage: z.literal("complete"),
  }),
  inspect_android_class: z.strictObject({
    ...common,
    class_name: z.string(),
    methods: z.array(method),
    fields: z.array(
      z.strictObject({
        name: z.string(),
        reported_type: z.string(),
        /** Null unless a static final field encodes a supported non-null value; initializers are not applied. */
        dex_static_value: dexStaticValueSchema.nullable(),
      }),
    ),
    inner_classes: z.array(z.string()),
    mapping: androidMappingReportSchema.exactOptional(),
  }),
  inspect_android_method: z.strictObject({
    ...common,
    class_name: z.string(),
    method: method,
    overload_count: z.int().positive(),
    representation: z.enum(["java", "smali"]),
    body_status: z.enum(["available", "not_available"]),
    fell_back: z.boolean(),
    markers: z.array(z.string()),
    source: textCoverage,
    mapping: androidMappingReportSchema.exactOptional(),
  }),
  trace_android_references: z.strictObject({
    ...common,
    /** Older retained Evidence omits this fact; omission does not mean external. */
    target_definition: z.enum(["defined", "external"]).exactOptional(),
    /** External results inventory directly encoded invokes, not reflection or dispatch. */
    reference_scope: z.literal("direct_dex_invokes").exactOptional(),
    class_name: z.string(),
    method_name: z.string().nullable(),
    overload_index: z.int().nonnegative().nullable(),
    reported_signature: z.string().nullable(),
    dex_descriptor: dexDescriptorSchema.nullable(),
    total: z.int().nonnegative(),
    /** Position coverage is separate from the complete using-node inventory.
     * Historical Evidence may omit this aggregate; omission is unexamined. */
    direct_invokes_coverage: z
      .strictObject({
        complete_using_nodes: z.int().nonnegative(),
        partial_using_nodes: z.int().nonnegative(),
        unknown_using_nodes: z.int().nonnegative(),
        recorded_sites: z.int().nonnegative(),
      })
      .exactOptional(),
    references: z.array(
      z.strictObject({
        kind: z.string(),
        name: z.string(),
        reported_full_name: z.string(),
        containing_class: z.string(),
        top_class: z.string(),
        source_line: z.null(),
        dex_offset: z.null(),
        /** An explicit follow-up selector accepted by inspect_android_method. */
        source_selector: androidMethodSelectorSchema.exactOptional(),
        /** false means transport-bounded instruction evidence; null is unknown. */
        direct_invokes_exhaustive: z.boolean().nullable(),
        /** Raw direct invoke instructions inside this using node, when available. */
        direct_invokes: z
          .array(
            z.strictObject({
              dex_entry: z.string().min(1),
              source_raw_method_id: z.string().min(1),
              dex_code_unit_offset: z.int().nonnegative(),
              dex_method_index: z.int().nonnegative(),
              opcode: z.string().regex(/^INVOKE_/u),
            }),
          )
          .nullable(),
      }),
    ),
    coverage: z.literal("complete"),
    reference_unit: z.literal("using_node"),
  }),
} as const;
