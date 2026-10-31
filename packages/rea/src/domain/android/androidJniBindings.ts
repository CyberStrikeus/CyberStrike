import { createHash } from "node:crypto";
import { z } from "zod";
import {
  androidNativeDeclarationSchema,
  androidNativeDeclarationsSchema,
  type AndroidNativeDeclarations,
} from "./androidNativeDeclarations.js";
import {
  androidJniLibraryFactsSchema,
  androidJniTableEntrySchema,
} from "./androidJniLibraryFacts.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import { dexDescriptorSchema } from "./dexTypes.js";

const count = z.int().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const address = z.string().regex(/^0x[0-9a-f]+$/u);
const status = z.enum(["complete", "partial", "unknown"]);
const ABI_LAYOUTS = new Map<string, readonly [string, number]>([
  ["arm64-v8a", ["arm64", 64]],
  ["armeabi-v7a", ["arm", 32]],
  ["armeabi", ["arm", 32]],
  ["x86", ["386", 32]],
  ["x86_64", ["amd64", 64]],
]);
export const androidJniSelectionSchema = z.strictObject({
  class_name: z.string().min(1).exactOptional(),
  method_names: z.array(z.string().min(1)).exactOptional(),
  descriptors: z.array(dexDescriptorSchema).exactOptional(),
  abis: z.array(z.string().min(1)).exactOptional(),
  library_paths: z.array(z.string().min(1)).exactOptional(),
});
export type AndroidJniSelection = z.infer<typeof androidJniSelectionSchema>;
/** One selection owner supports early archive admission and in-memory composition. */
export const compileAndroidJniLibrarySelection = (
  selection: AndroidJniSelection,
): ((library: { readonly abi: string; readonly path: string }) => boolean) => {
  const abis =
    selection.abis === undefined ? undefined : new Set(selection.abis);
  const paths =
    selection.library_paths === undefined
      ? undefined
      : new Set(selection.library_paths);
  return (library) =>
    (abis === undefined || abis.has(library.abi)) &&
    (paths === undefined || paths.has(library.path));
};

/** Physical member occurrence and authenticated bytes; paths are never keys alone. */
export const androidJniLibraryIdentitySchema = z.strictObject({
  library_id: z.string(),
  source_index: count,
  source_key: z.string(),
  path: z.string(),
  source_path: z.string(),
  abi: z.string(),
  sha256: digest.nullable(),
  size: count.nullable(),
  declared_size: count.nullable(),
  compressed_size: count.nullable(),
});
export const androidJniLibrarySchema = androidJniLibraryIdentitySchema.extend({
  abi_compatibility: z.enum(["consistent", "mismatch", "unknown"]),
  byte_order: z.enum(["little", "big"]).nullable(),
  architecture: z.string().nullable(),
  bits: z.union([z.literal(32), z.literal(64)]).nullable(),
  jni_on_load: z.boolean().nullable(),
  coverage: androidJniLibraryFactsSchema.shape.coverage.nullable(),
  export_count: count,
  table_count: count,
  table_entry_count: count,
  unknowns: z.array(z.string()),
  failure: z.strictObject({ kind: z.string(), message: z.string() }).nullable(),
});
export const androidJniLibraryObservationSchema =
  androidJniLibraryIdentitySchema.extend({
    facts: androidJniLibraryFactsSchema.nullable(),
    failure: z
      .strictObject({ kind: z.string(), message: z.string() })
      .nullable(),
  });
export type AndroidJniLibraryObservation = z.infer<
  typeof androidJniLibraryObservationSchema
>;
export const androidJniLibraryInventorySchema = z.strictObject({
  status,
  examined_entries: count,
  selected_libraries: count,
  unknowns: z.array(z.string()),
});
/** Parsed, JSON-only checkpoint captured before a live ZIP reader is finalized. */
export const androidJniLibraryCheckpointSchema = z.strictObject({
  scan_state: z.enum(["completed", "interrupted"]),
  libraries: z.array(androidJniLibraryObservationSchema),
  inventory: androidJniLibraryInventorySchema,
});
export type AndroidJniLibraryCheckpoint = z.infer<
  typeof androidJniLibraryCheckpointSchema
>;
export const androidJniPartialFactsSchema = z.strictObject({
  selection: androidJniSelectionSchema,
  native_inventory: androidNativeDeclarationsSchema.nullable(),
  libraries: androidJniLibraryCheckpointSchema.nullable(),
});
export const androidJniDeclarationSchema =
  androidNativeDeclarationSchema.extend({
    declaration_id: z.string(),
  });
export const androidJniCandidateSchema = z.strictObject({
  candidate_id: z.string(),
  library_id: z.string(),
  basis: z.enum(["jni-export", "static-registration-table"]),
  name: z.string(),
  descriptor: z.string().nullable(),
  address,
  file_offset: count.nullable(),
  declaration_ids: z.array(z.string()),
  class_attribution: z.enum([
    "export-name",
    "unique-native-pair",
    "ambiguous-native-pair",
    "unknown-native-inventory",
    "no-native-declaration",
  ]),
  export_source_index: count.nullable(),
  table: z
    .strictObject({
      section_index: count,
      section_name: z.string().nullable(),
      table_address: address,
      entry: androidJniTableEntrySchema,
    })
    .nullable(),
});
export const androidJniBindingSchema = z.strictObject({
  declaration_id: z.string(),
  abi: z.string(),
  status: z.enum(["matched", "unmatched", "ambiguous", "unknown"]),
  /** Status describes observed candidates; partial coverage never establishes uniqueness or absence. */
  coverage: status,
  candidate_ids: z.array(z.string()),
  unknowns: z.array(z.string()),
});
export const androidJniReportSchema = z.strictObject({
  apk: z.strictObject({ path: z.string(), sha256: digest }),
  selection: androidJniSelectionSchema,
  native_inventory: androidNativeDeclarationsSchema.omit({ methods: true }),
  library_inventory: androidJniLibraryInventorySchema,
  declarations: z.array(androidJniDeclarationSchema),
  selected_declaration_ids: z.array(z.string()),
  libraries: z.array(androidJniLibrarySchema),
  candidates: z.array(androidJniCandidateSchema),
  bindings: z.array(androidJniBindingSchema),
  unknowns: z.array(z.string()),
});
export type AndroidJniReport = z.infer<typeof androidJniReportSchema>;
export const ANDROID_JNI_REPORT_BYTES = 16 * 1024 * 1024;
const id = (kind: string, parts: readonly unknown[]): string =>
  `${kind}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;

/** JNI escaping is over UTF-16 code units; it can fail for non-Java-source names. */
export const expectedJniNames = (
  className: string,
  method: string,
  descriptor: string,
): Result<
  { short: string; long: string },
  { kind: "escape-failure" | "capacity" }
> => {
  const precursor = [
    className.replaceAll(".", "/"),
    method,
    descriptor.slice(1, descriptor.indexOf(")")),
  ];
  let bytes = 16;
  for (const value of precursor) {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (
        code >= 48 &&
        code <= 51 &&
        (index === 0 || value.charCodeAt(index - 1) === 47)
      )
        return err({ kind: "escape-failure" });
      bytes +=
        code === 47 ||
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122)
          ? 2
          : code === 95 || code === 59 || code === 91
            ? 4
            : 12;
      if (bytes > ANDROID_JNI_REPORT_BYTES) return err({ kind: "capacity" });
    }
  }
  const escape = (value: string): string => {
    let result = "";
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      result +=
        code === 47
          ? "_"
          : code === 95
            ? "_1"
            : code === 59
              ? "_2"
              : code === 91
                ? "_3"
                : (code >= 48 && code <= 57) ||
                    (code >= 65 && code <= 90) ||
                    (code >= 97 && code <= 122)
                  ? value[index]
                  : `_0${code.toString(16).padStart(4, "0")}`;
    }
    return result;
  };
  const short = `Java_${escape(precursor[0]!)}_${escape(method)}`;
  return ok({ short, long: `${short}__${escape(precursor[2]!)}` });
};

type ProjectionFailure = { readonly kind: "capacity" };
/** Join once against the COMPLETE declaration inventory before applying selection. */
export const projectAndroidJniBindings = (input: {
  readonly apk: AndroidJniReport["apk"];
  readonly selection: AndroidJniSelection;
  readonly inventory: AndroidNativeDeclarations;
  readonly libraries: readonly AndroidJniLibraryObservation[];
  readonly libraryInventory: AndroidJniReport["library_inventory"];
}): Result<AndroidJniReport, ProjectionFailure> => {
  const declarations = input.inventory.methods.map((method) => ({
    ...method,
    declaration_id: id("jni_method", [
      input.apk.sha256,
      method.dex_entry_index,
      method.class_index,
      method.method_index,
      method.source_index,
    ]),
  }));
  const byPair = new Map<string, string[]>();
  const byExport = new Map<string, string[]>();
  const names = new Map<string, { short: string; long: string } | null>();
  let retained = jsonValueByteLength(
    declarations as unknown as JsonValue,
    ANDROID_JNI_REPORT_BYTES,
  );
  if (retained > ANDROID_JNI_REPORT_BYTES) return err({ kind: "capacity" });
  const charge = (value: unknown) => {
    retained += jsonValueByteLength(
      value as JsonValue,
      ANDROID_JNI_REPORT_BYTES,
    );
    return retained <= ANDROID_JNI_REPORT_BYTES;
  };
  const append = (map: Map<string, string[]>, key: string, value: string) => {
    const old = map.get(key);
    if (old === undefined) map.set(key, [value]);
    else old.push(value);
  };
  for (const method of declarations) {
    append(
      byPair,
      JSON.stringify([method.method_name, method.descriptor]),
      method.declaration_id,
    );
    const expected = expectedJniNames(
      method.class_name,
      method.method_name,
      method.descriptor,
    );
    if (!expected.ok && expected.error.kind === "capacity")
      return err({ kind: "capacity" });
    names.set(method.declaration_id, expected.ok ? expected.value : null);
    if (expected.ok) {
      if (!charge(expected.value)) return err({ kind: "capacity" });
      append(byExport, expected.value.short, method.declaration_id);
      append(byExport, expected.value.long, method.declaration_id);
    }
  }
  const libraries: AndroidJniReport["libraries"] = [];
  const selectLibrary = compileAndroidJniLibrarySelection(input.selection);
  const candidates: AndroidJniReport["candidates"] = [];
  const matches = new Map<string, AndroidJniReport["candidates"][number][]>();
  const addCandidate = (
    candidate: AndroidJniReport["candidates"][number],
  ): boolean => {
    if (!charge(candidate)) return false;
    candidates.push(candidate);
    for (const method of candidate.declaration_ids) {
      const key = JSON.stringify([method, candidate.library_id]);
      const previous = matches.get(key);
      if (previous === undefined) matches.set(key, [candidate]);
      else previous.push(candidate);
    }
    return true;
  };
  for (const observation of input.libraries) {
    if (!selectLibrary(observation)) continue;
    const { facts, failure, ...identity } = observation;
    const expected = ABI_LAYOUTS.get(identity.abi);
    const abiCompatibility =
      facts === null || expected === undefined
        ? "unknown"
        : facts.architecture === expected[0] &&
            facts.bits === expected[1] &&
            facts.byte_order === "little"
          ? "consistent"
          : "mismatch";
    const library: AndroidJniReport["libraries"][number] = {
      ...identity,
      abi_compatibility: abiCompatibility,
      byte_order: facts?.byte_order ?? null,
      architecture: facts?.architecture ?? null,
      bits: facts?.bits ?? null,
      jni_on_load: facts?.jni_on_load ?? null,
      coverage: facts?.coverage ?? null,
      export_count: facts?.exports.length ?? 0,
      table_count: facts?.tables.length ?? 0,
      table_entry_count:
        facts?.tables.reduce((sum, table) => sum + table.entries.length, 0) ??
        0,
      unknowns: facts?.unknowns ?? [],
      failure,
    };
    if (!charge(library)) return err({ kind: "capacity" });
    libraries.push(library);
    if (facts === null) continue;
    const shortNames = new Set(facts.exports.map((symbol) => symbol.name));
    for (const symbol of facts.exports) {
      if (!symbol.name.startsWith("Java_")) continue;
      const methods = (byExport.get(symbol.name) ?? []).filter((method) => {
        const expected = names.get(method);
        return (
          expected != null &&
          (symbol.name === expected.short || !shortNames.has(expected.short))
        );
      });
      if (
        !addCandidate({
          candidate_id: id("jni_candidate", [
            identity.library_id,
            "export",
            symbol.source_index,
          ]),
          library_id: identity.library_id,
          basis: "jni-export",
          name: symbol.name,
          descriptor: null,
          address: symbol.address,
          file_offset: symbol.file_offset,
          declaration_ids: methods,
          class_attribution: "export-name",
          export_source_index: symbol.source_index,
          table: null,
        })
      )
        return err({ kind: "capacity" });
    }
    for (const table of facts.tables)
      for (const entry of table.entries) {
        const methods =
          byPair.get(JSON.stringify([entry.name, entry.descriptor])) ?? [];
        const attribution =
          input.inventory.coverage.status !== "complete"
            ? "unknown-native-inventory"
            : methods.length === 0
              ? "no-native-declaration"
              : methods.length === 1
                ? "unique-native-pair"
                : "ambiguous-native-pair";
        if (
          !addCandidate({
            candidate_id: id("jni_candidate", [
              identity.library_id,
              "table",
              entry.slots[0]?.address,
              entry.slots[0]?.file_offset,
            ]),
            library_id: identity.library_id,
            basis: "static-registration-table",
            name: entry.name,
            descriptor: entry.descriptor,
            address: entry.function_address,
            file_offset: entry.function_file_offset,
            declaration_ids: methods,
            class_attribution: attribution,
            export_source_index: null,
            table: {
              section_index: table.section_index,
              section_name: table.section_name,
              table_address: table.table_address,
              entry,
            },
          })
        )
          return err({ kind: "capacity" });
      }
  }
  const methodNames =
    input.selection.method_names === undefined
      ? undefined
      : new Set(input.selection.method_names);
  const descriptors =
    input.selection.descriptors === undefined
      ? undefined
      : new Set(input.selection.descriptors);
  const selectedMethods = declarations.filter(
    (method) =>
      (input.selection.class_name === undefined ||
        method.class_name === input.selection.class_name) &&
      (methodNames === undefined || methodNames.has(method.method_name)) &&
      (descriptors === undefined || descriptors.has(method.descriptor)),
  );
  const selectedDeclarationIds = selectedMethods.map(
    (method) => method.declaration_id,
  );
  if (!charge(selectedDeclarationIds)) return err({ kind: "capacity" });
  const librariesByAbi = new Map<string, AndroidJniReport["libraries"]>();
  for (const library of libraries) {
    const previous = librariesByAbi.get(library.abi);
    if (previous === undefined) librariesByAbi.set(library.abi, [library]);
    else previous.push(library);
  }
  const abis = [...new Set(input.selection.abis ?? librariesByAbi.keys())];
  const bindings: AndroidJniReport["bindings"] = [];
  for (const method of selectedMethods)
    for (const abi of abis) {
      const abiLibraries = librariesByAbi.get(abi) ?? [];
      const selected = abiLibraries
        .filter((library) => library.abi_compatibility === "consistent")
        .flatMap(
          (library) =>
            matches.get(
              JSON.stringify([method.declaration_id, library.library_id]),
            ) ?? [],
        );
      const physical = new Set(
        selected.map((candidate) =>
          JSON.stringify([candidate.library_id, candidate.address]),
        ),
      );
      const ambiguous = selected.some(
        (candidate) => candidate.class_attribution === "ambiguous-native-pair",
      );
      const incomplete =
        input.libraryInventory.status !== "complete" ||
        abiLibraries.some(
          (library) =>
            library.failure !== null ||
            library.coverage?.status !== "complete" ||
            library.abi_compatibility !== "consistent",
        );
      const unknown = selected.some(
        (candidate) =>
          candidate.class_attribution === "unknown-native-inventory",
      );
      const binding: AndroidJniReport["bindings"][number] = {
        declaration_id: method.declaration_id,
        abi,
        status:
          physical.size > 1 || ambiguous
            ? "ambiguous"
            : unknown
              ? "unknown"
              : physical.size === 1
                ? "matched"
                : incomplete
                  ? "unknown"
                  : "unmatched",
        coverage: incomplete || unknown ? "partial" : "complete",
        candidate_ids: selected.map((candidate) => candidate.candidate_id),
        unknowns: [
          ...(incomplete
            ? [
                "Selected library coverage is incomplete; additional static candidates may exist. Matched means observed candidate presence, not complete uniqueness.",
              ]
            : []),
          ...(unknown
            ? [
                "The full native declaration inventory is incomplete; table class attribution is unknown.",
              ]
            : []),
          ...(names.get(method.declaration_id) === null
            ? [
                "JNI name escaping failed; no VM export lookup name is asserted. RegisterNatives candidates remain applicable.",
              ]
            : []),
        ],
      };
      if (!charge(binding)) return err({ kind: "capacity" });
      bindings.push(binding);
    }
  const native_inventory = {
    scope: input.inventory.scope,
    coverage: input.inventory.coverage,
    unknowns: input.inventory.unknowns,
  };
  const report: AndroidJniReport = {
    apk: input.apk,
    selection: input.selection,
    native_inventory,
    library_inventory: {
      ...input.libraryInventory,
      selected_libraries: libraries.length,
    },
    declarations,
    selected_declaration_ids: selectedDeclarationIds,
    libraries,
    candidates,
    bindings,
    unknowns: [
      "Static candidates do not establish library loading, RegisterNatives execution or method invocation.",
      "Runtime-built tables, encrypted/obfuscated strings and runtime-loaded code are not recovered.",
      "Uniqueness is scoped to the complete recorded root DEX native inventory and selected library occurrences.",
    ],
  };
  return jsonValueByteLength(
    report as unknown as JsonValue,
    ANDROID_JNI_REPORT_BYTES,
  ) > ANDROID_JNI_REPORT_BYTES
    ? err({ kind: "capacity" })
    : ok(report);
};
