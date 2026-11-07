import { z } from "zod";
import { dexDescriptorSchema } from "./dexTypes.js";

const count = z.int().nonnegative().safe();

/** One original ACC_NATIVE declaration, before decompiler class deduplication. */
export const androidNativeDeclarationSchema = z.strictObject({
  source_index: count,
  class_name: z.string().min(1),
  method_name: z.string().min(1),
  descriptor: dexDescriptorSchema,
  dex_entry: z.string().min(1),
  /** Central-directory ordinal; duplicate names are explicitly unsupported. */
  dex_entry_index: count,
  /** Class-definition ordinal within this DEX. */
  class_index: count,
  /** Method-reference index in the originating DEX. */
  method_index: count,
});

/** Scope is standard root classes*.dex members, never runtime-loaded code. */
export const androidNativeDeclarationsSchema = z.strictObject({
  scope: z.literal("apk-root-dex-declarations"),
  methods: z.array(androidNativeDeclarationSchema),
  coverage: z.strictObject({
    status: z.enum(["complete", "partial", "unknown"]),
    dex_entries: count,
    examined_dex_entries: count,
    examined_classes: count,
    examined_methods: count,
  }),
  unknowns: z.array(z.string()),
});

export type AndroidNativeDeclaration = z.infer<
  typeof androidNativeDeclarationSchema
>;
export type AndroidNativeDeclarations = z.infer<
  typeof androidNativeDeclarationsSchema
>;
