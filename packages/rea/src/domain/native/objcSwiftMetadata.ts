import { objcClassSymbol } from "../objcClassSymbol.js";
import { z } from "zod";
import {
  BINARY_ARCHITECTURES,
  isMachOFormat,
  type BinaryTarget,
} from "../binaryTargetTypes.js";
import { providerSchema } from "../evidence.js";
import { isSwiftSymbolName } from "../swiftSymbolClassification.js";
import { nativeCallReferenceSchema } from "./nativeCallReference.js";
import { machoTargetSelectionSchema } from "../apple/machoTargetSelection.js";
import {
  nativeAddressCoordinateInputSchema,
  nativeAddressInputSchema,
} from "./nativeAddress.js";

import {
  compareUnicodeCodePoints,
  compositeKey,
} from "../unicodeCodePointOrder.js";

/** Targets admitted to the Apple byte reader; the reader validates slice support. */
export const isAppleDispatchMetadataTarget = (target: BinaryTarget): boolean =>
  target.kind === "executable" && isMachOFormat(target.format);

/** Objective-C method type. */
export const objcMethodTypeSchema = z.enum([
  "instance",
  "class",
  "ivar_getter",
  "ivar_setter",
]);

/** Objective-C property attribute. */
export const objcPropertyAttributeSchema = z.strictObject({
  name: z.string().min(1),
  value: z.string(),
});

/** Objective-C method metadata. */
export const objcMethodSchema = z.strictObject({
  selector: z.string().min(1),
  method_type: objcMethodTypeSchema,
  address: z
    .int()
    .nullable()
    .describe(
      "Unique unqualified implementation address; null if unknown, ambiguous, or not a safe integer.",
    ),
  is_required: z.boolean().nullable(),
  is_optional: z.boolean().nullable(),
});
type ObjcMethod = z.infer<typeof objcMethodSchema>;

/** Objective-C property metadata. */
export const objcPropertySchema = z.strictObject({
  name: z.string().min(1),
  type_encoding: z.string().nullable(),
  attributes: z.array(objcPropertyAttributeSchema),
  atomicity: z.enum(["atomic", "nonatomic"]).nullable(),
  is_readonly: z.boolean().nullable(),
  getter: z.string().nullable(),
  setter: z.string().nullable(),
});

/** Objective-C protocol metadata. */
export const objcProtocolSchema = z.strictObject({
  name: z.string().min(1),
  methods: z.array(objcMethodSchema).default([]),
  optional_methods: z.array(objcMethodSchema).default([]),
  properties: z.array(objcPropertySchema).default([]),
});

/** Objective-C class metadata. */
export const objcClassSchema = z.strictObject({
  name: z.string().min(1),
  super_class: z.string().nullable(),
  is_meta_class: z.boolean().nullable(),
  is_root_class: z.boolean().nullable(),
  methods: z.array(objcMethodSchema).default([]),
  properties: z.array(objcPropertySchema).default([]),
  protocols: z.array(z.string()).default([]),
  ivar_count: z.int().nonnegative().nullable(),
  instance_size: z.int().nonnegative().nullable(),
  location: z
    .object({
      address: z.string().nullable(),
      file_offset: z.int().nonnegative().nullable(),
    })
    .optional(),
  superclass_address: z.string().nullable().optional(),
  metaclass_address: z.string().nullable().optional(),
  decode: z
    .object({
      status: z.enum(["decoded", "partial", "unsupported", "invalid"]),
      reason: z.string().nullable(),
    })
    .optional(),
  evidence: z
    .array(
      z.object({
        kind: z.literal("binary_metadata"),
        description: z.string(),
        location: z.object({
          address: z.string().nullable(),
          file_offset: z.int().nonnegative().nullable(),
        }),
        artifact_path: z.string(),
        artifact_sha256: z.string(),
      }),
    )
    .optional(),
});
type ObjcClass = z.infer<typeof objcClassSchema>;

/** Exact location of a decoded native metadata value when the provider knows it. */
export const nativeMetadataLocationSchema = z.strictObject({
  address: z.string().nullable(),
  file_offset: z.int().nonnegative().nullable(),
});
export type NativeMetadataLocation = z.infer<
  typeof nativeMetadataLocationSchema
>;

/** Provider-neutral decode state; absence never silently means unsupported. */
export const nativeMetadataDecodeSchema = z.strictObject({
  status: z.enum(["decoded", "partial", "unsupported", "invalid"]),
  reason: z.string().nullable(),
});

/** Evidence attached to one dispatch edge or metadata record. */
export const nativeMetadataEvidenceSchema = z.strictObject({
  kind: z.enum([
    "binary_metadata",
    "interface_builder_resource",
    "symbol",
    "reference",
    "decompiler",
  ]),
  description: z.string().min(1),
  provider: providerSchema.optional(),
  location: nativeMetadataLocationSchema,
  /** Preserve a provider's source value when it does not establish a location. */
  reported_address: z.string().optional(),
  call_reference: nativeCallReferenceSchema.exactOptional(),
  artifact_path: z.string().min(1).nullable().default(null),
  artifact_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable()
    .default(null),
});
export type NativeMetadataEvidence = z.infer<
  typeof nativeMetadataEvidenceSchema
>;

/** Objective-C ivar layout, retaining encoded type and exact storage offset. */
export const objcIvarSchema = z.strictObject({
  class_name: z.string().min(1),
  name: z.string().min(1),
  type_encoding: z.string().nullable(),
  offset: z.int().nonnegative().nullable(),
  size: z.int().nonnegative().nullable().default(null),
  alignment: z.int().positive().nullable().default(null),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** Encoded Objective-C protocol declaration with required and optional method facts. */
export const objcProtocolRecordSchema = z.strictObject({
  name: z.string(),
  adopted_protocols: z.array(z.string()),
  methods: z.array(objcMethodSchema),
  optional_methods: z.array(objcMethodSchema),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** Selector implementation resolved from a class or metaclass method list. */
export const objcDispatchImplementationSchema = z.strictObject({
  class_name: z.string().min(1),
  selector: z.string().min(1),
  method_type: z.enum(["instance", "class"]),
  implementation_address: z.string().nullable(),
  /** Category that adds this method, when it is not defined by the class itself. */
  category: z.string().nullable().optional(),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});
type ObjcDispatchImplementation = z.infer<
  typeof objcDispatchImplementationSchema
>;

/** Interpret category qualification only within the Objective-C method-symbol grammar. */
const objcMethodSymbolOwner = (owner: string) => {
  const categoryOwner = /^([^()]+)\(([^()]+)\)$/u.exec(owner);
  return {
    class_name: categoryOwner?.[1] ?? owner,
    ...(categoryOwner?.[2] === undefined ? {} : { category: categoryOwner[2] }),
  };
};

/** The accepted provider spelling, shared by new and retained symbol records. */
const parseObjcMethodSymbol = (symbol: string) => {
  const match = /^([+-])\[([^\s\]]+)\s+([^\]]+)\]$/u.exec(symbol);
  if (match?.[1] === undefined || !match[2] || !match[3]) return undefined;
  return {
    ...objcMethodSymbolOwner(match[2]),
    reported_owner: match[2],
    selector: match[3],
    method_type: match[1] === "+" ? ("class" as const) : ("instance" as const),
  };
};

/** Retained symbol-only records predate separate category ownership. */
export const objcImplementationClassName = (
  implementation: ObjcDispatchImplementation,
): string => {
  if (
    implementation.category !== undefined ||
    implementation.decode.reason !== "symbol_name_only"
  )
    return implementation.class_name;
  const symbols = implementation.evidence.filter(
    ({ kind }) => kind === "symbol",
  );
  // Conflicting or absent source facts cannot establish category qualification.
  if (
    symbols.length === 0 ||
    symbols.some((item) => {
      const prefix = "Provider symbol ";
      if (!item.description.startsWith(prefix)) return true;
      const parsed = parseObjcMethodSymbol(
        item.description.slice(prefix.length),
      );
      return (
        parsed === undefined ||
        parsed.reported_owner !== implementation.class_name ||
        parsed.selector !== implementation.selector ||
        parsed.method_type !== implementation.method_type
      );
    })
  )
    return implementation.class_name;
  return objcMethodSymbolOwner(implementation.class_name).class_name;
};

/** Project class declarations without selecting an ambiguous or unrepresentable address. */
export const projectObjcClassMethods = (
  implementations: readonly ObjcDispatchImplementation[],
): ObjcMethod[] => {
  const methods = new Map<string, ObjcMethod>();
  for (const implementation of implementations) {
    const key = compositeKey([
      implementation.selector,
      implementation.method_type,
    ]);
    const address = parseMetadataAddress(implementation.implementation_address);
    const previous = methods.get(key);
    if (previous !== undefined) {
      if (previous.address !== address) previous.address = null;
      continue;
    }
    methods.set(key, {
      selector: implementation.selector,
      method_type: implementation.method_type,
      address,
      is_required: null,
      is_optional: null,
    });
  }
  return [...methods.values()];
};

/** Objective-C category: methods, protocols and properties added to a class. */
export const objcCategorySchema = z.strictObject({
  name: z.string().min(1),
  /** Extended class; external classes come from the category's bind symbol. */
  class_name: z.string().min(1).nullable(),
  class_source: z.enum(["local", "external", "unresolved"]),
  instance_methods: z.array(z.string()),
  class_methods: z.array(z.string()),
  protocols: z.array(z.string()),
  properties: z.array(objcPropertySchema),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** Exact Mach-O import binding observed at a pointer slot. */
export const machoImportBindingSchema = z.strictObject({
  requested_address: z.string().min(1),
  symbol: z.string().min(1),
  binding_source: z.enum(["chained", "bind", "weak", "lazy"]),
  library_ordinal: z.number().int().min(-3).max(Number.MAX_SAFE_INTEGER),
  library: z.string().nullable(),
  weak: z.boolean(),
  addend: z.string().regex(/^-?\d+$/u),
});
export type MachoImportBinding = z.infer<typeof machoImportBindingSchema>;

/** Swift protocol conformance and its associated witness-table location. */
export const swiftConformanceSchema = z.strictObject({
  type_name: z.string().min(1).nullable(),
  /** Raw three-bit Swift ABI type-reference kind; absent in older Evidence. */
  type_reference_kind: z.number().int().min(0).max(7).optional(),
  /** Address of the descriptor, class-name string, or resolved ObjC class reference. */
  type_reference_target: nativeMetadataLocationSchema.optional(),
  type_binding: machoImportBindingSchema.nullable().optional(),
  protocol_name: z.string().min(1).nullable(),
  /** Resolved protocol descriptor address, retained when its bytes are unavailable. */
  protocol_target: nativeMetadataLocationSchema.optional(),
  protocol_binding: machoImportBindingSchema.nullable().optional(),
  module: z.string().nullable(),
  witness_table: nativeMetadataLocationSchema,
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** A typed slot in a Swift protocol witness table or class vtable. */
export const swiftDispatchSlotSchema = z.strictObject({
  owner: z.string().min(1),
  table_kind: z.enum(["witness_table", "class_vtable"]),
  slot_index: z.int().nonnegative(),
  requirement: z.string().nullable(),
  implementation: z.string().nullable(),
  implementation_address: z.string().nullable(),
  implementation_binding: machoImportBindingSchema.nullable().optional(),
  thunk_address: z.string().nullable(),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** Signed-relative pointer as stored in an Apple binary metadata structure. */
export const relativePointerSchema = z.strictObject({
  field: nativeMetadataLocationSchema,
  target: nativeMetadataLocationSchema,
  displacement: z.int(),
  indirectable: z.boolean(),
  indirect: z.boolean().nullable(),
  encoding_tag: z.number().int().nonnegative().optional(),
  binding: machoImportBindingSchema.optional(),
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** A raw Swift-mangled symbol when a provider has not decoded its metadata. */
export const swiftSymbolSchema = z.strictObject({
  mangled_name: z.string().min(1),
  address: z.string().min(1).nullable(),
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});
type SwiftSymbol = z.infer<typeof swiftSymbolSchema>;

/** Per-facet coverage; empty arrays are meaningful only with this record. */
export const nativeMetadataCoverageSchema = z.strictObject({
  facet: z.string().min(1),
  status: z.enum(["complete", "partial", "unsupported", "not_requested"]),
  reason: z.string().nullable(),
  examined: z.int().nonnegative(),
  decoded: z.int().nonnegative(),
});

export const objcClassImportIdentitySchema = machoImportBindingSchema.omit({
  requested_address: true,
});
export const objcClassImportBindingCoverageSchema =
  nativeMetadataCoverageSchema.extend({
    facet: z.literal("objc_class_import_bindings"),
    examined: z.number().int().nonnegative(),
    decoded: z.number().int().nonnegative(),
  });

/** Discovery retains unknown or inapplicable import identity separately from scan coverage. */
export const objcClassDiscoveryCoverageSchema = nativeMetadataCoverageSchema
  .pick({ status: true, reason: true })
  .extend({
    status: z.enum([
      ...nativeMetadataCoverageSchema.shape.status.options,
      "unknown",
      "not_applicable",
    ]),
  });
export type ObjcClassDiscoveryCoverage = z.infer<
  typeof objcClassDiscoveryCoverageSchema
>;

/** Nominal Swift type kinds recorded by `__swift5_types` descriptors. */
export const swiftDeclKindSchema = z.enum(["class", "struct", "enum", "actor"]);

/**
 * One nominal type context descriptor. `location` is the descriptor itself;
 * evidence cites its `__swift5_types` record. `qualified_name` is null when a
 * parent context is unresolved, rather than a shortened guess.
 */
export const swiftDeclSchema = z.strictObject({
  kind: swiftDeclKindSchema,
  name: z.string().min(1),
  qualified_name: z.string().min(1).nullable(),
  module: z.string().min(1).nullable(),
  generic: z.boolean(),
  /** A private or local declaration context was omitted from `qualified_name`. */
  anonymous_context: z.boolean(),
  accessor_address: z.string().min(1).nullable(),
  location: nativeMetadataLocationSchema,
  decode: nativeMetadataDecodeSchema,
  evidence: z.array(nativeMetadataEvidenceSchema).min(1),
});

/** Database save/read operation type. */
export const dbOperationSchema = z.enum([
  "save",
  "readback",
  "open_database",
  "close_database",
  "export",
  "import",
]);
/** Database save operation result. */
export const dbSaveResultSchema = z.strictObject({
  operation: dbOperationSchema,
  succeeded: z.boolean(),
  preserved_names: z.int().nonnegative().default(0),
  preserved_comments: z.int().nonnegative().default(0),
  preserved_bookmarks: z.int().nonnegative().default(0),
  database_path: z.string().nullable(),
  error: z.string().nullable(),
});

/** Result of deeper ObjC/Swift metadata extraction. */
export const objcSwiftMetadataSchema = z.strictObject({
  objc_classes: z.array(objcClassSchema).default([]),
  objc_protocols: z.array(objcProtocolSchema).default([]),
  objc_categories: z.array(objcCategorySchema).default([]),
  swift_decls: z.array(swiftDeclSchema).default([]),
  objc_ivars: z.array(objcIvarSchema).default([]),
  objc_protocol_records: z.array(objcProtocolRecordSchema).default([]),
  objc_dispatch_implementations: z
    .array(objcDispatchImplementationSchema)
    .default([]),
  swift_conformances: z.array(swiftConformanceSchema).default([]),
  swift_dispatch_slots: z.array(swiftDispatchSlotSchema).default([]),
  swift_symbols: z.array(swiftSymbolSchema).default([]),
  objc_class_import_bindings: z.array(machoImportBindingSchema).optional(),
  objc_class_import_binding_coverage:
    objcClassImportBindingCoverageSchema.optional(),
  target_selection: machoTargetSelectionSchema.optional(),
  relative_pointers: z.array(relativePointerSchema).default([]),
  coverage: z.array(nativeMetadataCoverageSchema).default([]),
  db_save_result: dbSaveResultSchema.nullable(),
});
export type ObjcSwiftMetadata = z.infer<typeof objcSwiftMetadataSchema>;

/** Retained-image budget when the caller selects none. */
export const DEFAULT_DISPATCH_METADATA_INPUT_BYTES = 64 * 1024 * 1024;

/**
 * Largest caller-selected budget. The reader holds the whole selected file in
 * REA's own heap; larger images belong to a deep provider that loads them in
 * its own process.
 */
export const MAXIMUM_DISPATCH_METADATA_INPUT_BYTES = 1024 * 1024 * 1024;

/** Shared metadata row allowance for provider reads and class-import discovery. */
export const MAX_DISPATCH_METADATA_RECORDS = 20_000;
export const DEFAULT_DISPATCH_METADATA_RECORDS = 5_000;

/** Selected dispatch facts and retained-image budget, shared by providers and adapters. */
export const nativeDispatchMetadataInputSchema = z.strictObject({
  max_records: z
    .number()
    .int()
    .min(1)
    .max(MAX_DISPATCH_METADATA_RECORDS)
    .default(DEFAULT_DISPATCH_METADATA_RECORDS),
  objc_class_import_addresses: z
    .array(z.string())
    .max(MAX_DISPATCH_METADATA_RECORDS)
    .describe(
      "Optional exact pointer-slot addresses from the selected name inventory; used to report decoded Objective-C class import bindings.",
    )
    .optional(),
  objc_class_import_addresses_complete: z
    .boolean()
    .describe(
      "Whether the candidate addresses include every selected class-label row; false keeps binding coverage partial when the existing record budget truncates the scan.",
    )
    .optional(),
  max_input_bytes: z
    .number()
    .int()
    .min(1)
    .max(MAXIMUM_DISPATCH_METADATA_INPUT_BYTES)
    .optional()
    .describe(
      "Largest target file REA reads into memory for binary metadata, in bytes. Omitted: 67108864 (64 MiB). The whole file counts, including every slice of a universal Mach-O. At most 1073741824 (1 GiB).",
    ),
});

/** Effective input budget of one binary metadata read and the bytes it retained. */
export const dispatchMetadataInputAdmissionSchema = z.strictObject({
  maximum_bytes: z
    .number()
    .int()
    .min(1)
    .max(MAXIMUM_DISPATCH_METADATA_INPUT_BYTES),
  source: z.enum(["default", "caller"]),
  retained_bytes: z.number().int().nonnegative(),
});
export type DispatchMetadataInputAdmission = z.infer<
  typeof dispatchMetadataInputAdmissionSchema
>;

/** Provider and target identity for one normalized dispatch-metadata result. */
export const nativeDispatchMetadataResultSchema = z.strictObject({
  target_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  target_architecture: z.enum(BINARY_ARCHITECTURES).nullable().optional(),
  provider: z.strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().nullable(),
  }),
  analysis_profile_digest: z.string().min(1).nullable(),
  /** Present when REA read the target bytes itself; symbol-only inventories have none. */
  input_admission: dispatchMetadataInputAdmissionSchema.exactOptional(),
  result: objcSwiftMetadataSchema,
});

/** Decode only facts visible in a provider's existing name inventory. */
export const inspectNativeDispatchMetadata = (
  names: readonly { readonly address: string; readonly name: string }[],
  maxRecords: number,
): ObjcSwiftMetadata => {
  const symbolEvidence = (
    entry: (typeof names)[number],
    address: string | null,
  ) => [
    {
      kind: "symbol" as const,
      description: `Provider symbol ${entry.name}`,
      location: { address, file_offset: null },
      ...(address === null ? { reported_address: entry.address } : {}),
      artifact_path: null,
      artifact_sha256: null,
    },
  ];
  const classNames = new Set<string>();
  const implementations = new Map<
    string | symbol,
    ObjcDispatchImplementation
  >();
  const swiftSymbols: SwiftSymbol[] = [];

  const examinedNames = names.slice(0, maxRecords);
  for (const entry of examinedNames) {
    const parsedAddress = nativeAddressInputSchema.safeParse(entry.address);
    const address = parsedAddress.success ? parsedAddress.data : null;
    const sourceAddress = parsedAddress.success ? entry.address : null;
    const classSymbol = objcClassSymbol(entry.name);
    if (classSymbol !== undefined) classNames.add(classSymbol.name);

    const method = parseObjcMethodSymbol(entry.name);
    if (method !== undefined) {
      const {
        method_type: methodType,
        selector,
        class_name: className,
        category,
      } = method;
      // The provider's method-symbol grammar owns category qualification. Binary
      // class names and historical records are identities, not display strings
      // for downstream consumers to split. Keep the original symbol in Evidence.
      const key = parsedAddress.success
        ? compositeKey([
            className,
            category ?? null,
            selector,
            methodType,
            parsedAddress.data,
          ])
        : Symbol();
      const evidence = symbolEvidence(entry, sourceAddress);
      const previous = implementations.get(key);
      if (previous !== undefined) previous.evidence.push(...evidence);
      else
        implementations.set(key, {
          class_name: className,
          ...(category === undefined ? {} : { category }),
          selector,
          method_type: methodType,
          implementation_address: address,
          location: { address, file_offset: null },
          decode: { status: "partial", reason: "symbol_name_only" },
          evidence,
        });
      classNames.add(className);
    }

    if (isSwiftSymbolName(entry.name))
      swiftSymbols.push({
        mangled_name: entry.name,
        address,
        decode: { status: "partial", reason: "mangled_symbol_not_demangled" },
        evidence: symbolEvidence(entry, sourceAddress),
      });
  }

  const implementationsByClass = new Map<
    string,
    ObjcDispatchImplementation[]
  >();
  for (const implementation of implementations.values()) {
    const candidates =
      implementationsByClass.get(implementation.class_name) ?? [];
    candidates.push(implementation);
    implementationsByClass.set(implementation.class_name, candidates);
  }
  const classes: ObjcClass[] = [...classNames].sort().map((name) => ({
    name,
    super_class: null,
    is_meta_class: null,
    is_root_class: null,
    methods: projectObjcClassMethods(implementationsByClass.get(name) ?? []),
    properties: [],
    protocols: [],
    ivar_count: null,
    instance_size: null,
  }));
  const decodedImplementations = [...implementations.values()].sort(
    (left, right) =>
      compareUnicodeCodePoints(
        compositeKey([
          left.class_name,
          left.selector,
          left.method_type,
          left.implementation_address ?? "",
          left.category ?? null,
        ]),
        compositeKey([
          right.class_name,
          right.selector,
          right.method_type,
          right.implementation_address ?? "",
          right.category ?? null,
        ]),
      ),
  );
  const swift = swiftSymbols.length > 0;

  return objcSwiftMetadataSchema.parse({
    objc_classes: classes,
    objc_dispatch_implementations: decodedImplementations,
    swift_symbols: swiftSymbols,
    coverage: [
      {
        facet: "objc_class_symbols",
        status: "partial",
        reason:
          names.length > examinedNames.length
            ? "record_limit_reached_and_symbol_names_are_not_runtime_class_metadata"
            : "symbol_names_do_not_recover_all_runtime_class_metadata",
        examined: examinedNames.length,
        decoded: classes.length,
      },
      {
        facet: "objc_dispatch_implementations",
        status: decodedImplementations.length > 0 ? "partial" : "unsupported",
        reason:
          names.length > examinedNames.length
            ? "record_limit_reached_and_only_symbolized_methods_are_resolved"
            : decodedImplementations.length > 0
              ? "only_symbolized_methods_are_resolved"
              : "provider_name_inventory_has_no_supported_objc_method_symbols",
        examined: examinedNames.length,
        decoded: decodedImplementations.length,
      },
      {
        facet: "objc_class_definitions",
        status: "unsupported",
        reason:
          "symbol_inventory_does_not_establish_class_definitions_import_origins_or_namespace_declarations",
        examined: examinedNames.length,
        decoded: 0,
      },
      {
        facet: "objc_ivar_layouts",
        status: "unsupported",
        reason: "symbol_inventory_does_not_expose_runtime_ivar_layouts",
        examined: 0,
        decoded: 0,
      },
      {
        facet: "swift_declarations",
        status: swift ? "partial" : "unsupported",
        reason: swift
          ? "symbols_are_not_demangled_declarations"
          : "no_swift_symbols_observed",
        examined: swiftSymbols.length,
        decoded: 0,
      },
      {
        facet: "swift_dispatch_tables",
        status: "unsupported",
        reason:
          "provider_name_inventory_does_not_decode_witness_or_class_vtables",
        examined: 0,
        decoded: 0,
      },
      {
        facet: "relative_pointers",
        status: "unsupported",
        reason:
          "provider_name_inventory_does_not_decode_binary_relative_pointers",
        examined: 0,
        decoded: 0,
      },
    ],
    db_save_result: null,
  });
};

const parseMetadataAddress = (address: string | null): number | null => {
  const parsed = nativeAddressCoordinateInputSchema.safeParse(address);
  return parsed.success &&
    parsed.data.space === null &&
    parsed.data.offset <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(parsed.data.offset)
    : null;
};
