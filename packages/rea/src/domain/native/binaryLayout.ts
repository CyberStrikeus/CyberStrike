import { z } from "zod";
import { canBorrowParsedJsonSnapshot } from "../immutableJson.js";

import { pwntoolsTimeoutField } from "./nativeDeadlines.js";
import { absoluteLocalPathStringSchema } from "../localPath.js";
import { canonicalBase64Schema } from "../stringPatterns.js";

const unsignedHex = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/);
const index = z.int().nonnegative();
const scalar = z.union([z.string(), z.int()]);
const range = z.strictObject({ offset: unsignedHex, bytes: unsignedHex });
const canonicalBase64 = canonicalBase64Schema;
const name = z.strictObject({
  display: z.string(),
  bytes_base64: canonicalBase64.nullable(),
  location: range.nullable(),
  unknown_reason: z.string().nullable(),
});

/** Explicit local object selection, independent of an active disassembler target. */
export const inspectBinaryLayoutInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute filesystem path to the selected binary",
  ),
  pwntools_timeout_ms: pwntoolsTimeoutField,
});

/** File and linked-image evidence; numeric ELF values never pass through unsafe JSON numbers. */
const binaryLayoutObjectSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: index,
  }),
  format: z.literal("elf"),
  architecture: z.union([
    z.strictObject({
      machine: z.literal("EM_X86_64"),
      bits: z.literal(64),
      byte_order: z.literal("little"),
    }),
    z.strictObject({
      machine: z.enum(["EM_386", "EM_ARM"]),
      bits: z.literal(32),
      byte_order: z.literal("little"),
    }),
    z.strictObject({
      machine: z.literal("EM_MIPS"),
      bits: z.literal(32),
      byte_order: z.enum(["little", "big"]),
    }),
  ]),
  image_type: z.enum(["ET_EXEC", "ET_DYN", "ET_REL"]),
  entry_point: z.strictObject({
    reported_value: unsignedHex,
    meaning: z.enum(["linked-virtual-address", "not-applicable", "absent"]),
    execution_status: z.literal("unknown"),
  }),
  runtime_load_base: z.null(),
  sections: z.array(
    z.strictObject({
      index,
      name,
      name_offset: unsignedHex,
      type: scalar,
      header_location: range,
      address: unsignedHex,
      offset: unsignedHex,
      size: unsignedHex,
      alignment: unsignedHex,
      flags: unsignedHex,
      link: index,
      info: index,
      entry_size: unsignedHex,
      file_backing: z.enum(["file", "none"]),
    }),
  ),
  segments: z.array(
    z.strictObject({
      index,
      type: scalar,
      header_location: range,
      offset: unsignedHex,
      file_size: unsignedHex,
      memory_size: unsignedHex,
      virtual_address: unsignedHex,
      physical_address: unsignedHex,
      alignment: unsignedHex,
      flags: unsignedHex,
      file_backing: z.enum(["file", "none"]),
      permissions: z
        .strictObject({
          read: z.boolean(),
          write: z.boolean(),
          execute: z.boolean(),
        })
        .nullable(),
    }),
  ),
  symbols: z.array(
    z.strictObject({
      table_index: index,
      entry_index: index,
      name,
      name_offset: unsignedHex,
      location: range,
      value: unsignedHex,
      value_meaning: z.enum([
        "undefined",
        "alignment",
        "absolute-value",
        "no-address",
        "unknown-section-index",
        "section-offset",
        "tls-offset",
        "linked-virtual-address",
      ]),
      size: unsignedHex,
      binding: scalar,
      type: scalar,
      visibility: scalar,
      section_index: scalar,
    }),
  ),
  relocations: z.array(
    z.strictObject({
      section_index: index,
      entry_index: index,
      reported_offset: unsignedHex,
      target: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("section-offset"),
          section_index: index,
          offset: unsignedHex,
        }),
        z.strictObject({
          kind: z.literal("linked-virtual-address"),
          address: unsignedHex,
        }),
        z.strictObject({
          kind: z.literal("unknown-section"),
          reported_section_index: index,
          offset: unsignedHex,
          unknown_reason: z.enum([
            "undefined-section-reference",
            "inactive-section-header",
          ]),
        }),
      ]),
      location: range,
      type: index,
      symbol_table_index: index,
      symbol_index: index,
      symbol_reference_meaning: z.enum([
        "zero-symbol-value",
        "symbol-table-entry",
      ]),
      addend: z
        .string()
        .regex(/^-?(?:0|[1-9][0-9]{0,18})$/)
        .nullable(),
    }),
  ),
  packed_relative_relocations: z.array(
    z.strictObject({
      section_index: index,
      location: range,
      encoded_bytes_base64: canonicalBase64,
      entries: z.array(
        z.strictObject({ decoded_index: index, reported_offset: unsignedHex }),
      ),
      offset_meaning: z.enum(["linked-virtual-address", "unknown"]),
      evidence_kind: z.literal("derived"),
      entry_source_locations: z.null(),
      addends: z.null(),
    }),
  ),
  relocation_inventory_completeness: z.literal("unknown"),
  linkage: z.strictObject({
    needed_libraries: z.array(name),
    interpreters: z.array(name),
    got: z.array(
      z.strictObject({ display_name: z.string(), address: unsignedHex }),
    ),
    plt: z.array(
      z.strictObject({ display_name: z.string(), address: unsignedHex }),
    ),
    convenience_maps_completeness: z.literal("unknown"),
    runtime_library_paths: z.null(),
  }),
  mitigations: z.strictObject({
    evidence_kind: z.literal("inferred"),
    position_independent: z.boolean(),
    nx_indicator: z.boolean().nullable(),
    executable_stack_indicator: z.boolean(),
    stack_canary_indicator: z.boolean(),
    relro: z.enum(["Partial", "Full"]).nullable(),
  }),
  diagnostics: z.strictObject({
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
  }),
  limitations: z.array(z.string()),
});

/** Decoder payload excludes the artifact identity observed by the owning process boundary. */
export const binaryLayoutPayloadSchema = binaryLayoutObjectSchema.omit({
  artifact: true,
  diagnostics: true,
});

/** Check source ranges again at the public boundary, independently of upstream parsing. */
export const binaryLayoutSchema = binaryLayoutObjectSchema.superRefine(
  (value, context) => {
    const size = BigInt(value.artifact.bytes);
    const check = (
      offset: string,
      length: string,
      path: (string | number)[],
    ): void => {
      const start = BigInt(offset);
      const bytes = BigInt(length);
      if (start > size || bytes > size - start)
        context.addIssue({
          code: "custom",
          path,
          message:
            "Reported file-backed range lies outside the selected artifact.",
        });
    };
    const checkLocation = (
      where: z.infer<typeof range>,
      path: (string | number)[],
    ): void => check(where.offset, where.bytes, path);
    const checkName = (
      reported: z.infer<typeof name>,
      path: (string | number)[],
    ): void => {
      if (reported.location !== null)
        checkLocation(reported.location, [...path, "location"]);
    };
    const expectedEntryMeaning =
      value.image_type === "ET_REL"
        ? "not-applicable"
        : value.entry_point.reported_value === "0x0"
          ? "absent"
          : "linked-virtual-address";
    if (value.entry_point.meaning !== expectedEntryMeaning)
      context.addIssue({
        code: "custom",
        path: ["entry_point", "meaning"],
        message:
          "Entry meaning must distinguish zero/unused fields from an actual linked address.",
      });
    for (const [index, section] of value.sections.entries()) {
      if (
        (section.type === "SHT_SYMTAB" || section.type === "SHT_DYNSYM") &&
        value.sections[section.link]?.type !== "SHT_STRTAB"
      )
        context.addIssue({
          code: "custom",
          path: ["sections", index, "link"],
          message:
            "Symbol tables must link to an existing string-table section.",
        });
      if (section.index !== index)
        context.addIssue({
          code: "custom",
          path: ["sections", index, "index"],
          message:
            "Complete section order must preserve original producer indices.",
        });
      checkLocation(section.header_location, [
        "sections",
        index,
        "header_location",
      ]);
      checkName(section.name, ["sections", index, "name"]);
      if (section.file_backing === "file")
        check(section.offset, section.size, ["sections", index]);
    }
    for (const [index, segment] of value.segments.entries()) {
      if (segment.index !== index)
        context.addIssue({
          code: "custom",
          path: ["segments", index, "index"],
          message:
            "Complete segment order must preserve original producer indices.",
        });
      checkLocation(segment.header_location, [
        "segments",
        index,
        "header_location",
      ]);
      const hasFileBytes =
        segment.type !== "PT_NULL" && BigInt(segment.file_size) !== 0n;
      if (segment.file_backing !== (hasFileBytes ? "file" : "none"))
        context.addIssue({
          code: "custom",
          path: ["segments", index, "file_backing"],
          message:
            "File backing must follow the reported segment type and file size.",
        });
      if ((segment.type === "PT_NULL") !== (segment.permissions === null))
        context.addIssue({
          code: "custom",
          path: ["segments", index, "permissions"],
          message:
            "Unused PT_NULL flags have no permission meaning; other segment flags retain their interpretation.",
        });
      if (hasFileBytes)
        check(segment.offset, segment.file_size, ["segments", index]);
    }
    for (const [index, symbol] of value.symbols.entries()) {
      checkLocation(symbol.location, ["symbols", index, "location"]);
      checkName(symbol.name, ["symbols", index, "name"]);
    }
    for (const [index, relocation] of value.relocations.entries())
      checkLocation(relocation.location, ["relocations", index, "location"]);
    validateRelocationReferences(value, context);
    validatePackedRelativeTables(value, context, checkLocation);
    for (const facet of ["needed_libraries", "interpreters"] as const)
      for (const [index, reported] of value.linkage[facet].entries())
        checkName(reported, ["linkage", facet, index]);
  },
);

export type InspectBinaryLayoutInput = z.infer<
  typeof inspectBinaryLayoutInputSchema
>;
export type BinaryLayout = z.infer<typeof binaryLayoutSchema>;

const validatedImmutableLayouts = new WeakSet<object>();

/** Validate once per exact immutable source; mutable inputs always revalidate. */
export const safeParseOwnedBinaryLayout = (
  input: unknown,
): z.ZodSafeParseResult<BinaryLayout> => {
  if (
    typeof input === "object" &&
    input !== null &&
    validatedImmutableLayouts.has(input)
  )
    return { success: true, data: input as BinaryLayout };
  const parsed = binaryLayoutSchema.safeParse(input);
  if (parsed.success && canBorrowParsedJsonSnapshot(input, parsed.data)) {
    // Preserve normalization if the schema changes: only unchanged, completely
    // validated data can be borrowed without retaining a duplicate layout.
    validatedImmutableLayouts.add(input);
    return { success: true, data: input };
  }
  return parsed;
};

const validateRelocationReferences = (
  value: z.output<typeof binaryLayoutObjectSchema>,
  context: z.RefinementCtx,
): void => {
  const symbols = new Set(
    value.symbols.map(
      (symbol) => `${symbol.table_index}:${symbol.entry_index}`,
    ),
  );
  for (const [index, relocation] of value.relocations.entries()) {
    const owner = value.sections[relocation.section_index];
    const target = relocation.target;
    const targetMatches =
      value.image_type === "ET_REL"
        ? target.kind === "section-offset"
          ? target.section_index !== 0 &&
            target.section_index === owner?.info &&
            value.sections[target.section_index] !== undefined &&
            value.sections[target.section_index]?.type !== "SHT_NULL" &&
            target.offset === relocation.reported_offset
          : target.kind === "unknown-section" &&
            target.reported_section_index === owner?.info &&
            target.offset === relocation.reported_offset &&
            (target.reported_section_index === 0
              ? target.unknown_reason === "undefined-section-reference"
              : value.sections[target.reported_section_index]?.type ===
                  "SHT_NULL" &&
                target.unknown_reason === "inactive-section-header")
        : target.kind === "linked-virtual-address" &&
          target.address === relocation.reported_offset;
    if (!targetMatches)
      context.addIssue({
        code: "custom",
        path: ["relocations", index, "target"],
        message:
          "Relocation target must preserve its reported offset and owner reference; SHN_UNDEF and inactive headers remain unknown rather than resolved sections.",
      });
    const table = value.sections[relocation.symbol_table_index];
    const tableExists =
      relocation.symbol_table_index !== 0 &&
      (table?.type === "SHT_SYMTAB" || table?.type === "SHT_DYNSYM");
    const positiveReferenceExists =
      tableExists &&
      // Elf32_Sym is 16 bytes; Elf64_Sym is 24.
      BigInt(table.entry_size) >=
        (value.architecture.bits === 32 ? 16n : 24n) &&
      BigInt(relocation.symbol_index) <
        BigInt(table.size) / BigInt(table.entry_size) &&
      symbols.has(
        `${relocation.symbol_table_index}:${relocation.symbol_index}`,
      );
    if (
      (owner?.type !== "SHT_REL" && owner?.type !== "SHT_RELA") ||
      owner.link !== relocation.symbol_table_index ||
      (relocation.symbol_table_index !== 0 && !tableExists) ||
      (relocation.symbol_index !== 0 && !positiveReferenceExists) ||
      relocation.symbol_reference_meaning !==
        (relocation.symbol_index === 0
          ? "zero-symbol-value"
          : "symbol-table-entry")
    )
      context.addIssue({
        code: "custom",
        path: ["relocations", index],
        message:
          "Relocation must preserve its REL/RELA owner and resolve positive symbol indices through the linked symbol table; index zero uses a zero symbol value.",
      });
  }
};

const validatePackedRelativeTables = (
  value: z.output<typeof binaryLayoutObjectSchema>,
  context: z.RefinementCtx,
  checkLocation: (
    location: z.output<typeof range>,
    path: (string | number)[],
  ) => void,
): void => {
  for (const [
    tableIndex,
    table,
  ] of value.packed_relative_relocations.entries()) {
    checkLocation(table.location, [
      "packed_relative_relocations",
      tableIndex,
      "location",
    ]);
    const encodedBytes = Buffer.byteLength(
      table.encoded_bytes_base64,
      "base64",
    );
    if (BigInt(encodedBytes) !== BigInt(table.location.bytes))
      context.addIssue({
        code: "custom",
        path: ["packed_relative_relocations", tableIndex],
        message:
          "Complete packed table bytes must match its original file range.",
      });
    const section = value.sections[table.section_index];
    if (
      section?.type !== "SHT_RELR" ||
      section.offset !== table.location.offset ||
      section.size !== table.location.bytes
    )
      context.addIssue({
        code: "custom",
        path: ["packed_relative_relocations", tableIndex, "section_index"],
        message:
          "Packed relative evidence must retain its original RELR section identity and range.",
      });
    for (const [decoded, entry] of table.entries.entries())
      if (entry.decoded_index !== decoded)
        context.addIssue({
          code: "custom",
          path: ["packed_relative_relocations", tableIndex, "entries", decoded],
          message: "Decoded offsets must preserve upstream iterator order.",
        });
  }
};
