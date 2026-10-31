import type { Il2cppMethodAddress } from "../domain/il2cpp/il2cppMetadata.js";
import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";
import { openImageSteps, readSlot, isExecutable } from "./Il2cppBinaryImage.js";
import {
  findModules,
  findCodeRegistration,
  findMetadataRegistration,
} from "./Il2cppBinaryRegistration.js";
import { createTypeNamer } from "./Il2cppBinaryTypes.js";
import {
  genericMethodLayouts,
  linkGenericMethodsSteps,
  type Il2cppGenericMethodLink,
} from "./Il2cppBinaryGenerics.js";
import type {
  Il2cppMetadataDecoded,
  Il2cppMetadataLinkFacts,
  Il2cppMetadataReadOptions,
} from "./Il2cppMetadataFile.js";
/** One linked code-generation module; its name matches a metadata image. */
export interface Il2cppCodeGenModule {
  readonly image: number;
  readonly address: bigint;
  readonly method_pointer_count: number;
  readonly method_pointers: bigint;
}

type Il2cppMethodCode = bigint | "no-body" | "unknown";

export interface Il2cppBinaryLink {
  readonly format: "elf" | "macho" | "pe";
  readonly architecture: string;
  readonly image_base: bigint;
  /**
   * Address of the CodeRegistration codeGenModulesCount field, or null when the
   * static registration pair was unresolved and an executable byte-pattern
   * candidate identified the array; instruction boundaries remain unverified.
   */
  readonly code_gen_modules_field: bigint | null;
  /** Address of the code-generation module pointer array. */
  readonly code_gen_modules_array: bigint;
  readonly code_gen_modules: readonly Il2cppCodeGenModule[];
  /**
   * Native code address per metadata method index; "no-body" when its module
   * slot is zero, "unknown" when its owner or relocated pointer is unresolved.
   */
  readonly method_addresses: Il2cppMethodAddress[];
  /**
   * Address of MetadataRegistration's typesCount field, or null when no static
   * registration matched and an executable byte-pattern candidate identified
   * the type table; types_count is then the inferred run length, at least
   * every referenced type index but not an observed typesCount.
   */
  readonly types_field: bigint | null;
  readonly types_count: number;
  /** Il2CppType table index and display name per method return, field and parameter. */
  readonly return_types: Il2cppTypeReference[];
  readonly field_types: Il2cppTypeReference[];
  readonly parameter_types: Il2cppTypeReference[];
  /** Null unless generic instances were requested. */
  readonly generic_methods: Il2cppGenericMethodLink | null;
}

export type Il2cppTypeReference = {
  readonly type: number;
  readonly name: string | null;
};

export type Il2cppBinaryReadOptions = Pick<
  Il2cppMetadataReadOptions,
  "beforeText" | "onRow"
> & {
  /** Also link genericMethodTable rows; unrequested paths read no generic table. */
  readonly genericInstances?: boolean;
};

/**
 * Link metadata methods to native code addresses without executing the image.
 * A method token's row id selects its module's methodPointers slot.
 */
export function* linkIl2cppBinarySteps(
  bytes: Buffer,
  metadata: Il2cppMetadataDecoded,
  facts: Il2cppMetadataLinkFacts,
  architecture?: string,
  options: Il2cppBinaryReadOptions = {},
): Generator<void, Il2cppBinaryLink> {
  const version = metadata.metadata_version;
  // Refuse an undecoded version before any table is read.
  if (options.genericInstances === true) genericMethodLayouts(version);
  yield;
  const image = yield* openImageSteps(bytes, architecture);
  const modules = yield* findModules(image, metadata);
  const registration_ = yield* findCodeRegistration(image, modules);
  const methodImage = new Int32Array(metadata.methods.length).fill(-1);
  for (const [index, entry] of metadata.images.entries())
    for (let offset = 0; offset < entry.type_count; offset++) {
      const type = metadata.types[entry.type_start + offset]!;
      if (offset % LINK_BATCH === 0) yield;
      for (let method = 0; method < type.method_count; method++) {
        if (method % LINK_BATCH === 0) yield;
        methodImage[type.method_start + method] = index;
      }
    }
  const methodByImageAndRow = metadata.images.map(
    () => new Map<number, number>(),
  );
  for (let index = 0; index < methodImage.length; index++) {
    if (index % LINK_BATCH === 0) yield;
    const owner = methodImage[index]!;
    if (owner === -1) continue;
    const token = facts.methodTokens[index]!;
    const row = token & 0xffffff;
    if (token >>> 24 !== 0x06 || row === 0) continue;
    const methodsByRow = methodByImageAndRow[owner]!;
    const earlier = methodsByRow.get(row);
    if (earlier !== undefined)
      throw new Il2cppBinaryFormatFailure(
        "invalid-method-token",
        `methods ${earlier} and ${index} in image ${metadata.images[owner]!.name} share MethodDef token 0x${token.toString(16)}`,
      );
    methodsByRow.set(row, index);
  }
  yield;
  const methodAddress = (index: number): Il2cppMethodCode => {
    const owner = methodImage[index]!;
    // No image range holds this method, so no module slot describes it.
    if (owner === -1) return "unknown";
    const module = modules[owner]!;
    const token = facts.methodTokens[index]!;
    const row = token & 0xffffff;
    if (token >>> 24 !== 0x06 || row === 0 || row > module.method_pointer_count)
      throw new Il2cppBinaryFormatFailure(
        "invalid-method-token",
        `method ${index} token 0x${token.toString(16)} is outside module ${metadata.images[owner]!.name}'s ${module.method_pointer_count} method pointers`,
      );
    const address = readSlot(
      image,
      module.method_pointers + BigInt((row - 1) * 8),
    );
    if (address === null || address === undefined)
      throw new Il2cppBinaryFormatFailure(
        "invalid-method-pointer",
        `module ${metadata.images[owner]!.name} method pointer ${row - 1} is not file mapped`,
      );
    if (address === "unknown") return "unknown";
    if (address === 0n) return "no-body";
    if (!isExecutable(image, address))
      throw new Il2cppBinaryFormatFailure(
        "invalid-method-pointer",
        `method ${index} points outside unambiguous executable file data at 0x${address.toString(16)}`,
      );
    return address;
  };
  const method_addresses: Il2cppMethodAddress[] = [];
  for (let index = 0; index < metadata.methods.length; index++) {
    if (index % LINK_BATCH === 0) yield;
    const code = methodAddress(index);
    if (typeof code === "bigint" && code < image.imageBase)
      throw new Il2cppBinaryFormatFailure(
        "invalid-method-pointer",
        "method address precedes the link image base",
      );
    const row: Il2cppMethodAddress =
      typeof code === "bigint"
        ? {
            state: "code",
            address: `0x${code.toString(16)}`,
            rva: `0x${(code - image.imageBase).toString(16)}`,
          }
        : { state: code, address: null, rva: null };
    options.onRow?.(row);
    method_addresses.push(row);
  }
  const registration = yield* findMetadataRegistration(
    image,
    metadata.types.length,
    yield* referencedTypeCount(facts),
  );
  const typeName = createTypeNamer(
    image,
    metadata,
    facts,
    version,
    options.beforeText,
  );
  function* reference(type: number): Generator<void, Il2cppTypeReference> {
    if (type === -1) return { type, name: null };
    if (type < 0 || type >= registration.count)
      throw new Il2cppBinaryFormatFailure(
        "invalid-type",
        `type index ${type} is outside the ${registration.count} binary types`,
      );
    // 27.0/27.1 and 27.2 share header version 27 but place byref differently.
    if (version === 27) return { type, name: null };
    const address = readSlot(image, registration.types + BigInt(type * 8));
    if (address === "unknown") return { type, name: null };
    if (address === null)
      throw new Il2cppBinaryFormatFailure(
        "invalid-type",
        `type ${type} has no mapped type-table slot`,
      );
    if (address === 0n)
      throw new Il2cppBinaryFormatFailure(
        "invalid-type",
        `type ${type} has no Il2CppType record`,
      );
    return { type, name: yield* typeName(address, 0) };
  }
  function* column(types: Int32Array) {
    const rows: Il2cppTypeReference[] = [];
    for (let index = 0; index < types.length; index++) {
      if (index % LINK_BATCH === 0) yield;
      const row = yield* reference(types[index]!);
      options.onRow?.(row);
      rows.push(row);
    }
    return rows;
  }
  const return_types = yield* column(facts.returnTypes);
  const field_types = yield* column(facts.fieldTypes);
  const parameter_types = yield* column(facts.parameterTypes);
  const generic_methods =
    options.genericInstances === true
      ? yield* linkGenericMethodsSteps(
          image,
          metadata,
          facts,
          registration_.field,
          // findMetadataRegistration reports typesCount, word 6.
          registration.field === null ? null : registration.field - 48n,
          options,
        )
      : null;
  return {
    format: image.container.format,
    architecture: image.container.architecture,
    image_base: image.imageBase,
    code_gen_modules_field: registration_.field,
    code_gen_modules_array: registration_.array,
    code_gen_modules: modules,
    method_addresses,
    types_field: registration.field,
    types_count: registration.count,
    return_types,
    field_types,
    parameter_types,
    generic_methods,
  };
}

/** One past the highest type index any return, field or parameter references. */
function* referencedTypeCount(
  facts: Il2cppMetadataLinkFacts,
): Generator<void, number> {
  let count = 0;
  for (const types of [
    facts.returnTypes,
    facts.fieldTypes,
    facts.parameterTypes,
  ])
    for (let index = 0; index < types.length; index++) {
      if (index % LINK_BATCH === 0) yield;
      count = Math.max(count, types[index]! + 1);
    }
  return count;
}

/** Rows between cooperative yields while linking. */
const LINK_BATCH = 256;
