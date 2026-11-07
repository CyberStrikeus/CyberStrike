import { z } from "zod";
import { digestSchema } from "../digests.js";
import {
  absoluteLocalPathStringSchema,
  localPathStringSchema,
} from "../localPath.js";
import { canonicalBase64Schema } from "../stringPatterns.js";
import { firstDeclaringTypeCycle } from "./il2cppDeclaringTypes.js";

/** Unsigned little-endian signature observed at file offset zero. */
export const IL2CPP_METADATA_MAGIC = 0xfab11baf;

/** Header section order shared by global-metadata.dat versions 29, 31 and 39. */
export const IL2CPP_METADATA_SECTION_NAMES = [
  "stringLiterals",
  "stringLiteralData",
  "strings",
  "events",
  "properties",
  "methods",
  "parameterDefaultValues",
  "fieldDefaultValues",
  "fieldAndParameterDefaultValueData",
  "fieldMarshaledSizes",
  "parameters",
  "fields",
  "genericParameters",
  "genericParameterConstraints",
  "genericContainers",
  "nestedTypes",
  "interfaces",
  "vtableMethods",
  "interfaceOffsets",
  "typeDefinitions",
  "images",
  "assemblies",
  "fieldRefs",
  "referencedAssemblies",
  "attributeData",
  "attributeDataRanges",
  "unresolvedIndirectCallParameterTypes",
  "unresolvedIndirectCallParameterRanges",
  "windowsRuntimeTypeNames",
  "windowsRuntimeStrings",
  "exportedTypeDefinitions",
] as const;

/** Version 27 names for the four custom-attribute and indirect-call sections. */
export const IL2CPP_METADATA_V27_SECTION_NAMES = [
  ...IL2CPP_METADATA_SECTION_NAMES.slice(0, 24),
  "attributesInfo",
  "attributeTypes",
  "unresolvedVirtualCallParameterTypes",
  "unresolvedVirtualCallParameterRanges",
  ...IL2CPP_METADATA_SECTION_NAMES.slice(28),
] as const;

/** Version 24 header: 32 (offset, byte size) pairs in this order. */
export const IL2CPP_METADATA_V24_SECTION_NAMES = [
  ...IL2CPP_METADATA_SECTION_NAMES.slice(0, 22),
  "metadataUsageLists",
  "metadataUsagePairs",
  "fieldRefs",
  "referencedAssemblies",
  "attributesInfo",
  "attributeTypes",
  "unresolvedVirtualCallParameterTypes",
  "unresolvedVirtualCallParameterRanges",
  "windowsRuntimeTypeNames",
  "exportedTypeDefinitions",
] as const;

/** Decoded metadata versions; all but 39 use fixed 4-byte indices. */
export const IL2CPP_METADATA_VERSIONS = [24, 27, 29, 31, 39] as const;

/** Header section names in order for one metadata version. */
export const il2cppMetadataSectionNames = (
  version: number,
): readonly IL2cppMetadataSectionName[] =>
  version === 24
    ? IL2CPP_METADATA_V24_SECTION_NAMES
    : version === 27
      ? IL2CPP_METADATA_V27_SECTION_NAMES
      : IL2CPP_METADATA_SECTION_NAMES;

const count = z.number().int().nonnegative();
/** Serialized metadata indices use -1 for an absent reference. */
const optionalIndex = z.number().int().min(-1);
const indexWidth = z.union([z.literal(1), z.literal(2), z.literal(4)]);

/** One explicit local file; detail selects delivery, never decoding coverage. */
export const inspectIl2cppMetadataInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to a Unity IL2CPP global-metadata.dat file",
  ),
  detail: z
    .enum(["complete", "summary"])
    .default("summary")
    .describe(
      "summary (default) retains complete Evidence and returns identity and collection counts; complete returns every image, type, method, member, parameter and string-literal row inline",
    ),
  binary_path: absoluteLocalPathStringSchema
    .optional()
    .describe(
      "Absolute path to the caller-selected matching 64-bit IL2CPP binary (Mach-O GameAssembly.dylib, PE GameAssembly.dll or ELF libil2cpp.so); static reading, never executed",
    ),
  binary_architecture: z
    .enum(["arm64", "amd64"])
    .optional()
    .describe(
      "Slice to read from a universal Mach-O binary_path; required for universal binaries and rejected otherwise",
    ),
  generic_instances: z
    .boolean()
    .optional()
    .describe(
      "Also link generic method instances (genericMethodTable rows) to code addresses with Il2CppDumper-style Type<Args>$$Method<Args> names; needs binary_path",
    ),
});

export type IL2cppMetadataSectionName = z.infer<
  typeof il2cppMetadataSectionSchema
>["name"];

export const il2cppMetadataSectionSchema = z.strictObject({
  name: z.enum([
    ...IL2CPP_METADATA_SECTION_NAMES,
    "attributesInfo",
    "attributeTypes",
    "unresolvedVirtualCallParameterTypes",
    "unresolvedVirtualCallParameterRanges",
    "metadataUsageLists",
    "metadataUsagePairs",
  ]),
  offset: count,
  size: count,
  /** Header-recorded entry count; versions 29 and 31 record none. */
  count: count.nullable(),
});

/** Assembly image and its contiguous type-definition range. */
export const il2cppMetadataImageSchema = z.strictObject({
  name: z.string(),
  type_start: optionalIndex,
  type_count: count,
});

/** Type definition; row position is its TypeDefinitionIndex. */
export const il2cppMetadataTypeSchema = z.strictObject({
  name: z.string(),
  namespace: z.string(),
  method_start: optionalIndex,
  method_count: count,
  nested_type_start: optionalIndex,
  nested_type_count: count,
  /** Enclosing type derived from the nestedTypes section. */
  declaring_type: optionalIndex.describe(
    "Enclosing TypeDefinitionIndex derived from nestedTypes; -1 means no enclosing metadata type was recorded",
  ),
});

/** Method definition; row position is its MethodIndex. */
export const il2cppMetadataMethodSchema = z.strictObject({
  name: z.string(),
  declaring_type: optionalIndex.describe(
    "Declared TypeDefinitionIndex from this MethodDefinition; -1 is an absent reference",
  ),
});

/** Field, property or event name and the type whose member range holds it. */
export const il2cppMetadataMemberSchema = z.strictObject({
  name: z.string(),
  /** -1 when no type range claims the row. */
  declaring_type: optionalIndex,
});

/** Parameter name and the method whose parameter range holds it. */
export const il2cppMetadataParameterSchema = z.strictObject({
  name: z.string(),
  /** -1 when no method range claims the row. */
  method: optionalIndex,
});

/** Managed string literal; undecodable UTF-8 keeps its exact bytes instead. */
export const il2cppMetadataStringLiteralSchema = z.strictObject({
  value: z.string().nullable(),
  value_base64: canonicalBase64Schema.nullable(),
});

/** Hexadecimal virtual address or offset, such as 0x153584. */
const addressPattern = /^0x[0-9a-f]{1,16}$/u;
export const il2cppAddressSchema = z.string().regex(addressPattern);

/**
 * How the binary answered for one method: `code` has an address, `no-body` is a
 * module slot that records no code (abstract, extern or generic methods), and
 * `unknown` means no code-generation module claims the method, so the binary
 * was not asked, or a relocation cannot resolve its slot; code remains unknown.
 */
export const IL2CPP_METHOD_ADDRESS_STATES = [
  "code",
  "no-body",
  "unknown",
] as const;

/** Native code of one method: virtual address and image-base-relative RVA. */
export const il2cppMethodAddressSchema = z.strictObject({
  state: z.enum(IL2CPP_METHOD_ADDRESS_STATES),
  /** Null unless state is code. */
  address: il2cppAddressSchema.nullable(),
  rva: il2cppAddressSchema.nullable(),
});

/** Index into the binary Il2CppType table and its C#-like display name. */
export const il2cppTypeReferenceSchema = z.strictObject({
  type: optionalIndex,
  /** Null for type index -1, unresolved native type-table slots, and version 27. */
  name: z.string().nullable(),
});

/** Code-generation module record located for one metadata image. */
export const il2cppCodeGenModuleSchema = z.strictObject({
  image: count,
  address: il2cppAddressSchema,
  method_pointer_count: count,
});

/** A genericMethodTable, method spec or pointer record that contradicts another table. */
export const il2cppGenericMethodIssueSchema = z.strictObject({
  /** genericMethodTable index of the row this issue leaves unknown. */
  row: count,
  /** Address of the contradicting record: the row, its method spec or its pointer slot. */
  address: il2cppAddressSchema,
  message: z.string(),
});

/** Registration facts behind the generic method instance rows. */
export const il2cppGenericMethodLinkSchema = z.strictObject({
  /**
   * CodeRegistration's genericMethodPointersCount, followed by the array
   * pointer; null with the count and stride when the table is empty, because
   * no row then selects one CodeRegistration layout.
   */
  generic_method_pointers_field: il2cppAddressSchema.nullable(),
  generic_method_pointers_count: count.nullable(),
  /** MetadataRegistration's genericMethodTable array. */
  generic_method_table: il2cppAddressSchema,
  generic_method_table_count: count,
  /** 16 when rows carry an adjustor thunk index (27.1 and later), else 12. */
  generic_method_table_stride: z
    .union([z.literal(12), z.literal(16)])
    .nullable(),
  method_specs_count: count,
  generic_insts_count: count,
  issues: z.array(il2cppGenericMethodIssueSchema),
});

/**
 * One generic method instance; row position is its genericMethodTable index.
 * state is `code`, `no-body` for a zero pointer slot, or `unknown` exactly
 * when an issue names the row; an issued row keeps no address.
 */
export const il2cppGenericMethodInstanceSchema =
  il2cppMethodAddressSchema.extend({
    /** Il2CppMethodSpec index. */
    method_spec: count,
    /** Recorded definition index, including invalid values; null when unreadable. */
    method: z.number().int().nullable(),
    /** Il2CppDumper-style name; null only on an unknown row whose method spec an issue names. */
    name: z.string().nullable(),
  });

/** Identity and registration facts of the linked native binary. */
export const il2cppBinaryLinkSchema = z.strictObject({
  artifact: z.strictObject({
    path: localPathStringSchema,
    sha256: digestSchema,
    bytes: count,
  }),
  format: z.enum(["elf", "macho", "pe"]),
  architecture: z.string(),
  image_base: il2cppAddressSchema,
  /**
   * CodeRegistration's codeGenModulesCount field, followed by the module array
   * pointer; null when no static pair was resolved and executable byte-pattern
   * candidates identified the array without verified instruction boundaries.
   */
  code_gen_modules_field: il2cppAddressSchema.nullable(),
  /** The code-generation module pointer array. */
  code_gen_modules_array: il2cppAddressSchema,
  code_gen_modules: z.array(il2cppCodeGenModuleSchema),
  /**
   * MetadataRegistration's typesCount field, followed by the types pointer;
   * null when no static registration had the counts and executable byte-pattern
   * candidates identified the type table, whose run length is then types_count.
   */
  types_field: il2cppAddressSchema.nullable(),
  types_count: count,
  /** Null unless generic_instances was requested. */
  generic_methods: il2cppGenericMethodLinkSchema.nullable(),
});

/** Unrefined report fields, shared with projections that omit row collections. */
export const il2cppMetadataObjectSchema = z.strictObject({
  artifact: z.strictObject({
    path: localPathStringSchema,
    sha256: digestSchema,
    bytes: count,
  }),
  magic: z.literal(IL2CPP_METADATA_MAGIC),
  metadata_version: z.union(
    IL2CPP_METADATA_VERSIONS.map((version) => z.literal(version)),
  ),
  index_widths: z.strictObject({
    type_definition: indexWidth,
    generic_container: indexWidth,
    parameter: indexWidth,
    type: indexWidth,
    type_width_source: z.enum([
      "interface-offsets-record",
      "type-definition-record",
      "fixed-width-version",
    ]),
  }),
  sections: z.array(il2cppMetadataSectionSchema),
  images: z.array(il2cppMetadataImageSchema),
  types: z.array(il2cppMetadataTypeSchema),
  methods: z.array(il2cppMetadataMethodSchema),
  fields: z.array(il2cppMetadataMemberSchema),
  properties: z.array(il2cppMetadataMemberSchema),
  events: z.array(il2cppMetadataMemberSchema),
  parameters: z.array(il2cppMetadataParameterSchema),
  string_literals: z.array(il2cppMetadataStringLiteralSchema),
  /** Null unless binary_path was selected. */
  binary: il2cppBinaryLinkSchema.nullable(),
  /** One row per method index when binary is linked, otherwise empty. */
  method_addresses: z.array(il2cppMethodAddressSchema),
  /** Per method, field and parameter index when binary is linked, otherwise empty. */
  return_types: z.array(il2cppTypeReferenceSchema),
  field_types: z.array(il2cppTypeReferenceSchema),
  parameter_types: z.array(il2cppTypeReferenceSchema),
  /** Null unless generic_instances was requested; one row per genericMethodTable entry. */
  generic_method_instances: z
    .array(il2cppGenericMethodInstanceSchema)
    .nullable(),
  limitations: z.array(z.string()),
});

/** Complete name and count inventory of one decoded global-metadata.dat file. */
export const il2cppMetadataMemberCollections = [
  "fields",
  "properties",
  "events",
  "parameters",
  "string_literals",
] as const;

/** Collections a report linked to a native binary adds; absent before linking existed. */
export const il2cppMetadataBinaryCollections = [
  "method_addresses",
  "return_types",
  "field_types",
  "parameter_types",
] as const;

/** Historical reports retain omission instead of inventing empty member or binary inventories. */
const il2cppMetadataParentObjectSchema = il2cppMetadataObjectSchema
  .partial({
    fields: true,
    properties: true,
    events: true,
    parameters: true,
    string_literals: true,
    binary: true,
    method_addresses: true,
    return_types: true,
    field_types: true,
    parameter_types: true,
    generic_method_instances: true,
  })
  .extend({
    // A link retained before generic instances existed omits generic_methods.
    binary: il2cppBinaryLinkSchema
      .partial({ generic_methods: true })
      .nullable()
      .optional(),
  });

/** code rows carry both an address and an RVA that agree with the image base; other rows neither. */
const codeRowContradicts = (
  row: { state: string; address: string | null; rva: string | null },
  imageBase: string | undefined,
) =>
  row.state === "code"
    ? row.address === null ||
      row.rva === null ||
      imageBase === undefined ||
      (addressPattern.test(row.address) &&
        addressPattern.test(row.rva) &&
        addressPattern.test(imageBase) &&
        BigInt(row.address) !== BigInt(imageBase) + BigInt(row.rva))
    : row.address !== null || row.rva !== null;

const validateMetadataFacts = (
  report: z.infer<typeof il2cppMetadataParentObjectSchema>,
  context: z.RefinementCtx,
): void => {
  const names = il2cppMetadataSectionNames(report.metadata_version);
  if (report.sections.length !== names.length)
    context.addIssue({
      code: "custom",
      path: ["sections"],
      message: `Version ${report.metadata_version} headers have ${names.length} sections.`,
    });
  report.sections.forEach((section, index) => {
    if (section.name !== names[index])
      context.addIssue({
        code: "custom",
        path: ["sections", index, "name"],
        message: "Sections must follow header order.",
      });
    if (section.offset + section.size > report.artifact.bytes)
      context.addIssue({
        code: "custom",
        path: ["sections", index],
        message: "Section range is outside the selected artifact.",
      });
  });
  if (report.binary != null)
    for (const collection of [
      "return_types",
      "field_types",
      "parameter_types",
    ] as const)
      report[collection]?.forEach((row, index) => {
        if (
          row.type >= report.binary!.types_count ||
          (row.type === -1 && row.name !== null)
        )
          context.addIssue({
            code: "custom",
            path: [collection, index],
            message:
              "Type reference is outside the linked type table or names an unavailable type.",
          });
      });
  report.method_addresses?.forEach((row, index) => {
    if (codeRowContradicts(row, report.binary?.image_base))
      context.addIssue({
        code: "custom",
        path: ["method_addresses", index],
        message:
          "Only a code row carries an address and RVA; both are then present.",
      });
  });
  report.types.forEach((row, index) => {
    if (row.declaring_type >= report.types.length)
      context.addIssue({
        code: "custom",
        path: ["types", index, "declaring_type"],
        message: "Enclosing type is outside the retained type definitions.",
      });
  });
  const cycleWalk = firstDeclaringTypeCycle(report.types);
  let cycle = cycleWalk.next();
  while (!cycle.done) cycle = cycleWalk.next();
  if (cycle.value !== null)
    context.addIssue({
      code: "custom",
      path: ["types", cycle.value, "declaring_type"],
      message: "Enclosing type relationships contain a cycle.",
    });
  for (const collection of [
    "methods",
    "fields",
    "properties",
    "events",
  ] as const)
    report[collection]?.forEach((row, index) => {
      if (row.declaring_type >= report.types.length)
        context.addIssue({
          code: "custom",
          path: [collection, index, "declaring_type"],
          message: "Member owner is outside the retained type definitions.",
        });
    });
  report.parameters?.forEach((row, index) => {
    if (row.method >= report.methods.length)
      context.addIssue({
        code: "custom",
        path: ["parameters", index, "method"],
        message: "Parameter owner is outside the retained method definitions.",
      });
  });
  const linkedRows = {
    method_addresses: report.methods,
    return_types: report.methods,
    field_types: report.fields,
    parameter_types: report.parameters,
  };
  for (const collection of il2cppMetadataBinaryCollections) {
    const rows = report[collection];
    if ((report.binary === undefined) !== (rows === undefined)) {
      context.addIssue({
        code: "custom",
        path: [collection],
        message: `${collection} is retained exactly when the binary link field is.`,
      });
      continue;
    }
    const owners = linkedRows[collection];
    if (rows === undefined) continue;
    const expected = report.binary === null ? 0 : owners?.length;
    if (expected === undefined || rows.length !== expected)
      context.addIssue({
        code: "custom",
        path: [collection],
        message: `A linked binary needs one ${collection} row per metadata row; none without one.`,
      });
  }
  // Evidence retained before generic instances existed omits the collection.
  if (report.generic_method_instances !== undefined) {
    const generic = report.binary?.generic_methods ?? null;
    if (
      (generic === null) !== (report.generic_method_instances === null) ||
      (generic !== null &&
        report.generic_method_instances!.length !==
          generic.generic_method_table_count)
    )
      context.addIssue({
        code: "custom",
        path: ["generic_method_instances"],
        message:
          "Generic method instances need one row per genericMethodTable entry and its registration facts; neither without the other.",
      });
    if (
      generic !== null &&
      [
        generic.generic_method_pointers_field,
        generic.generic_method_pointers_count,
        generic.generic_method_table_stride,
      ].some(
        (value) =>
          (value === null) !== (generic.generic_method_table_count === 0),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["binary", "generic_methods"],
        message:
          "Only an empty genericMethodTable leaves the pointer field, pointer count and stride unselected; a nonempty one selects all three.",
      });
  } else if (report.binary?.generic_methods != null)
    context.addIssue({
      code: "custom",
      path: ["generic_method_instances"],
      message: "Generic registration facts need their instance rows.",
    });
  // Exactly the rows an issue names are unknown, and only they lose a name.
  const issued = new Set(
    report.binary?.generic_methods?.issues.map((issue) => issue.row),
  );
  const unmatched = new Set(issued);
  report.generic_method_instances?.forEach((row, index) => {
    unmatched.delete(index);
    if (codeRowContradicts(row, report.binary?.image_base))
      context.addIssue({
        code: "custom",
        path: ["generic_method_instances", index],
        message:
          "Only a code row carries an address and RVA; both are then present.",
      });
    if (
      (row.state === "unknown") !== issued.has(index) ||
      (row.name === null && row.state !== "unknown")
    )
      context.addIssue({
        code: "custom",
        path: ["generic_method_instances", index, "state"],
        message:
          "A row is unknown exactly when an issue names it, and only then may its name be null.",
      });
    if (
      row.name !== null &&
      (row.method === null ||
        row.method < 0 ||
        row.method >= report.methods.length)
    )
      context.addIssue({
        code: "custom",
        path: ["generic_method_instances", index, "method"],
        message:
          "A named generic instance needs a definition inside the retained methods.",
      });
  });
  if (unmatched.size > 0)
    context.addIssue({
      code: "custom",
      path: ["binary", "generic_methods", "issues"],
      message: "Every generic method issue names an existing instance row.",
    });
  report.string_literals?.forEach((row, index) => {
    if ((row.value === null) === (row.value_base64 === null))
      context.addIssue({
        code: "custom",
        path: ["string_literals", index],
        message:
          "A literal must retain exactly one UTF-8 or byte-exact base64 representation.",
      });
  });
};

export const il2cppMetadataSchema = il2cppMetadataObjectSchema.superRefine(
  validateMetadataFacts,
);
export const il2cppMetadataParentSchema =
  il2cppMetadataParentObjectSchema.superRefine(validateMetadataFacts);

export type InspectIl2cppMetadataInput = z.infer<
  typeof inspectIl2cppMetadataInputSchema
>;
export type Il2cppMetadataProviderInput = Omit<
  InspectIl2cppMetadataInput,
  "detail"
>;
export type Il2cppMetadataSection = z.infer<typeof il2cppMetadataSectionSchema>;
export type Il2cppMetadata = z.infer<typeof il2cppMetadataSchema>;

export type Il2cppMethodAddress = z.infer<typeof il2cppMethodAddressSchema>;
export type Il2cppGenericMethodInstance = z.infer<
  typeof il2cppGenericMethodInstanceSchema
>;
