import { z } from "zod";
import { dexDescriptorSchema } from "./dexTypes.js";

const address = z.string().regex(/^0x[0-9a-f]+$/u);
const index = z.number().int().nonnegative();
const status = z.enum(["complete", "partial", "unknown"]);

/** The exact source record that established a link-time pointer value. */
export const androidJniRelocationSourceSchema = z.strictObject({
  encoding: z.enum(["rel", "rela", "relr"]),
  record_file_offset: index,
  kind: index.nullable(),
});

/** A file-backed JNINativeMethod word, before any runtime load bias. */
export const androidJniTableSlotSchema = z.strictObject({
  role: z.enum(["name", "signature", "function"]),
  address,
  file_offset: index,
  value: address,
  relocation: androidJniRelocationSourceSchema.nullable(),
});

/** Structural table evidence does not establish RegisterNatives execution. */
export const androidJniTableEntrySchema = z.strictObject({
  entry_index: index,
  name: z.string().min(1),
  descriptor: dexDescriptorSchema,
  function_address: address,
  /** ARM Thumb's low bit is retained above and cleared only for this code lookup. */
  code_address: address,
  function_file_offset: index.nullable(),
  slots: z.array(androidJniTableSlotSchema).length(3),
});

/** Facts from one immutable ELF library, before APK/DEX attribution. */
export const androidJniLibraryFactsSchema = z.strictObject({
  architecture: z.string(),
  bits: z.union([z.literal(32), z.literal(64)]),
  byte_order: z.enum(["little", "big"]),
  exports: z.array(
    z.strictObject({
      /** Index in the shared export parser's ordered defined-export inventory. */
      source_index: index,
      name: z.string(),
      address,
      file_offset: index.nullable(),
    }),
  ),
  jni_on_load: z.boolean(),
  tables: z.array(
    z.strictObject({
      section_index: index,
      section_name: z.string().nullable(),
      table_address: address,
      entries: z.array(androidJniTableEntrySchema).min(1),
    }),
  ),
  coverage: z.strictObject({
    status,
    exports_status: status,
    tables_status: status,
    relocations_status: status,
    examined_sections: index,
    examined_pointer_slots: index,
  }),
  unknowns: z.array(z.string()),
});

export type AndroidJniLibraryFacts = z.infer<
  typeof androidJniLibraryFactsSchema
>;
export type AndroidJniTableEntry = z.infer<typeof androidJniTableEntrySchema>;
export type AndroidJniTableSlot = z.infer<typeof androidJniTableSlotSchema>;
export type AndroidJniLibraryFailure = {
  readonly kind: "malformed" | "unsupported" | "capacity" | "cancelled";
  readonly message: string;
};
