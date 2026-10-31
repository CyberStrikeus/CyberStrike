import type { Il2cppGenericMethodInstance } from "../domain/il2cpp/il2cppMetadata.js";
import { Il2cppBinaryFormatFailure } from "./Il2cppBinaryFormat.js";
import {
  hasPointerArrayCoverage,
  hexAddress as hex,
  isExecutable,
  readPointer,
  readSlot,
  readUInt32,
  type NativeImage,
} from "./Il2cppBinaryImage.js";
import { createMethodSpecNamer } from "./Il2cppBinaryTypes.js";
import type { Il2cppBinaryReadOptions } from "./Il2cppBinaryFile.js";
import { IL2CPP_GENERIC_INSTANCE_MINIMUM_BYTES } from "./Il2cppMetadataAdmission.js";
import type {
  Il2cppMetadataDecoded,
  Il2cppMetadataLinkFacts,
} from "./Il2cppMetadataFile.js";

/** A record that contradicts another table, located by the record's address. */
export interface Il2cppGenericMethodIssue {
  /** genericMethodTable index of the row the record leaves unknown. */
  readonly row: number;
  readonly address: string;
  readonly message: string;
}

/** Registration facts and rows of the linked genericMethodTable. */
export interface Il2cppGenericMethodLink {
  /**
   * Address of CodeRegistration's genericMethodPointersCount field; null with
   * its count and the row stride when the table is empty, since no row then
   * tells the candidate layouts apart.
   */
  readonly generic_method_pointers_field: bigint | null;
  readonly generic_method_pointers_count: number | null;
  readonly generic_method_table: bigint;
  readonly generic_method_table_count: number;
  /** Bytes per genericMethodTable row: 12, or 16 with adjustor thunk indices. */
  readonly generic_method_table_stride: 12 | 16 | null;
  readonly method_specs_count: number;
  readonly generic_insts_count: number;
  /** Report rows; position is the genericMethodTable index. */
  readonly instances: Il2cppGenericMethodInstance[];
  readonly issues: Il2cppGenericMethodIssue[];
}

/**
 * Distance from CodeRegistration's start to codeGenModulesCount, with the
 * genericMethodTable row size each layout implies (Il2CppDumper's
 * Il2CppCodeRegistration): 27.0 = 96, 27.1/27.2/29 = 104
 * (genericAdjustorThunks), 29.1/31 = 120 (unresolved call pointers). Header
 * versions do not separate these minor versions, so every listed layout is
 * tried and exactly one must agree with the tables. Version 24 is left out:
 * its type-definition container offset and generic class layout are unchecked
 * against a real build. Version 39 container records are not decoded.
 */
const CODE_REGISTRATION_LAYOUTS: Readonly<
  Record<
    number,
    readonly { readonly modules: number; readonly stride: 12 | 16 }[]
  >
> = {
  27: [
    { modules: 96, stride: 12 },
    { modules: 104, stride: 16 },
  ],
  29: [
    { modules: 104, stride: 16 },
    { modules: 120, stride: 16 },
  ],
  31: [
    { modules: 104, stride: 16 },
    { modules: 120, stride: 16 },
  ],
};

/** Refuse an undecoded version before any binary table is read. */
export const genericMethodLayouts = (version: number) => {
  const layouts = CODE_REGISTRATION_LAYOUTS[version];
  if (layouts === undefined)
    throw new Il2cppBinaryFormatFailure(
      "generic-methods-unsupported",
      `generic method instances are not decoded for metadata version ${version}`,
    );
  return layouts;
};

/** Bounds a count read from the image before the budget is checked for it. */
export const GENERIC_TABLE_LIMIT = 0x1000000;
const BATCH = 256;
const MAX_ADDRESS = 0xffffffffffffffffn;

/**
 * Resolve every genericMethodTable row the way Il2CppDumper does:
 * genericMethodIndex selects an Il2CppMethodSpec, whose method definition and
 * class/method Il2CppGenericInst give the name, and indices.methodIndex
 * selects the genericMethodPointers slot. The CodeRegistration layout is the
 * one candidate whose pointer, invoker and table counts bound every row.
 */
export function* linkGenericMethodsSteps(
  image: NativeImage,
  metadata: Il2cppMetadataDecoded,
  facts: Il2cppMetadataLinkFacts,
  modulesField: bigint | null,
  /** Null when the type table was inferred without a static MetadataRegistration. */
  metadataRegistration: bigint | null,
  options: Il2cppBinaryReadOptions,
): Generator<void, Il2cppGenericMethodLink> {
  const version = metadata.metadata_version;
  const layouts = genericMethodLayouts(version);
  if (modulesField === null)
    throw new Il2cppBinaryFormatFailure(
      "generic-methods-unsupported",
      "this binary keeps no static CodeRegistration, so genericMethodPointers cannot be located",
    );
  if (metadataRegistration === null)
    throw new Il2cppBinaryFormatFailure(
      "generic-methods-unsupported",
      "this binary keeps no static MetadataRegistration, so genericMethodTable cannot be located",
    );
  const word = (address: bigint) => readPointer(image, address);
  const count = (address: bigint) => {
    const value = word(address);
    return value === null || value > BigInt(GENERIC_TABLE_LIMIT)
      ? null
      : Number(value);
  };
  // Int32 record fields; null when not file backed or loader-unresolved.
  // readUInt32 refuses plain zero-fill, so a .bss record never reads as index
  // 0; only a relocated pointer written into zero-fill would read, as its low
  // 32 bits.
  const i32 = (address: bigint) => {
    const value = readUInt32(image, address);
    return typeof value === "number" ? value | 0 : null;
  };
  const genericInstsCount = count(metadataRegistration + 16n);
  const genericInsts = word(metadataRegistration + 24n);
  const tableCount = count(metadataRegistration + 32n);
  const table = word(metadataRegistration + 40n);
  const specsCount = count(metadataRegistration + 64n);
  const specs = word(metadataRegistration + 72n);
  if (
    genericInstsCount === null ||
    genericInsts === null ||
    tableCount === null ||
    table === null ||
    specsCount === null ||
    specs === null ||
    (genericInstsCount > 0 &&
      !hasPointerArrayCoverage(image, genericInsts, genericInstsCount))
  )
    throw new Il2cppBinaryFormatFailure(
      "generic-method-registration-not-found",
      `MetadataRegistration at 0x${metadataRegistration.toString(16)} holds no readable genericInsts, genericMethodTable and methodSpecs fields`,
    );
  // Check the smallest row for every table entry against the remaining budget
  // before resolving any; each row is then admitted as it is retained.
  options.beforeText?.(tableCount * IL2CPP_GENERIC_INSTANCE_MINIMUM_BYTES);
  if (tableCount === 0)
    return {
      generic_method_pointers_field: null,
      generic_method_pointers_count: null,
      generic_method_table: table,
      generic_method_table_count: 0,
      generic_method_table_stride: null,
      method_specs_count: specsCount,
      generic_insts_count: genericInstsCount,
      instances: [],
      issues: [],
    };
  const candidates: {
    field: bigint;
    pointers: bigint;
    pointersCount: number;
    stride: 12 | 16;
  }[] = [];
  for (const layout of layouts) {
    const start = modulesField - BigInt(layout.modules);
    const wrappers = count(start);
    const wrapperArray = word(start + 8n);
    const pointersCount = count(start + 16n);
    const pointers = word(start + 24n);
    // genericMethodPointers coverage is not part of the layout: each row
    // reads its own slot, so one unmapped slot leaves only that row unknown.
    // genericAdjustorThunks sits between the pointers and the invokers in
    // every layout whose table rows carry an adjustor thunk index.
    const invokers = count(start + (layout.stride === 16 ? 40n : 32n));
    if (
      wrappers === null ||
      wrapperArray === null ||
      pointersCount === null ||
      pointers === null ||
      invokers === null ||
      (wrappers > 0 && !hasPointerArrayCoverage(image, wrapperArray, wrappers))
    )
      continue;
    let agrees = true;
    for (let row = 0; row < tableCount && agrees; row++) {
      if (row % BATCH === 0) yield;
      const at = table + BigInt(row * layout.stride);
      const spec = i32(at);
      const slot = i32(at + 4n);
      const invoker = i32(at + 8n);
      agrees =
        spec !== null &&
        slot !== null &&
        invoker !== null &&
        spec >= 0 &&
        spec < specsCount &&
        slot >= 0 &&
        slot < pointersCount &&
        invoker >= -1 &&
        invoker < invokers;
    }
    if (agrees)
      candidates.push({
        field: start + 16n,
        pointers,
        pointersCount,
        stride: layout.stride,
      });
  }
  if (candidates.length === 0)
    throw new Il2cppBinaryFormatFailure(
      "generic-method-registration-not-found",
      `no CodeRegistration layout before 0x${modulesField.toString(16)} bounds the ${tableCount} genericMethodTable rows`,
    );
  if (candidates.length > 1)
    throw new Il2cppBinaryFormatFailure(
      "ambiguous-generic-method-registration",
      `${candidates.length} CodeRegistration layouts bound the ${tableCount} genericMethodTable rows`,
    );
  const chosen = candidates[0]!;
  const specTable = specs;
  const rowAt = (row: number) => table + BigInt(row * chosen.stride);
  // Il2CppDumper keys pointers by method spec and refuses a second row, so
  // a shared spec is a contradiction; find them before any row is admitted.
  const specRows = new Map<number, number[]>();
  for (let row = 0; row < tableCount; row++) {
    if (row % BATCH === 0) yield;
    const spec = i32(rowAt(row))!;
    const rows = specRows.get(spec);
    if (rows === undefined) specRows.set(spec, [row]);
    else rows.push(row);
  }
  const issues: Il2cppGenericMethodIssue[] = [];
  const issue = (row: number, address: bigint, message: string) => {
    const entry = { row, address: hex(address), message };
    options.onRow?.(entry);
    issues.push(entry);
  };
  const instance = (index: number): bigint | null | undefined => {
    if (index === -1) return null;
    if (index < 0 || index >= genericInstsCount) return undefined;
    return word(genericInsts + BigInt(index * 8)) ?? undefined;
  };
  const methodSpecName = createMethodSpecNamer(
    image,
    metadata,
    facts,
    version,
    options.beforeText,
  );
  // Arguments must fill the container their owner declares; a damaged spec
  // would otherwise name an instance that cannot exist. A null instance is
  // left to the namer, as Il2CppDumper names it. Null when consistent.
  const argumentMismatch = (
    kind: "type" | "method",
    owner: number,
    container: number | undefined,
    instance: bigint | null,
  ) => {
    if (instance === null || container === undefined) return null;
    const given = readUInt32(image, instance);
    const declared =
      container === -1 ? 0 : facts.genericContainer(container)?.count;
    // An unread or loader-unresolved count is left to the namer, which
    // refuses it with its own message.
    if (typeof given !== "number" || given === declared) return null;
    // Versions with generic linking decode every container record, so a miss
    // is a damaged index, not an unread layout.
    return declared === undefined
      ? `gives ${kind} ${owner} ${given} generic arguments, but its generic container ${container} is out of range`
      : `gives ${kind} ${owner} ${given} generic arguments, but it declares ${declared}`;
  };
  const unknown = { state: "unknown", address: null, rva: null } as const;
  // Index arithmetic on a damaged table pointer can leave the 64-bit address
  // space; such an entry is reported at its genericMethodTable row instead.
  const entryAt = (base: bigint, index: number, size: number) => {
    if (index < 0) return null;
    const address = base + BigInt(index * size);
    return address + BigInt(size) - 1n > MAX_ADDRESS ? null : address;
  };
  function* resolve(row: number): Generator<void, Il2cppGenericMethodInstance> {
    const at = rowAt(row);
    const spec = i32(at)!;
    const slot = i32(at + 4n)!;
    const shared = specRows.get(spec)!;
    const specAt = entryAt(specTable, spec, 12);
    const method = specAt === null ? null : i32(specAt);
    const classIndex = specAt === null ? null : i32(specAt + 4n);
    const methodIndex = specAt === null ? null : i32(specAt + 8n);
    if (shared.length > 1) {
      // Name one other row, not all of them, so k sharing rows cost O(k).
      issue(
        row,
        at,
        `method spec ${spec} is shared by ${shared.length} genericMethodTable rows, including row ${shared[0] === row ? shared[1] : shared[0]}`,
      );
      return {
        method_spec: spec,
        method,
        name: null,
        ...unknown,
      };
    }
    // A method spec that contradicts the metadata leaves the row unknown: its
    // slot address would be reported under a definition nothing confirms.
    const base = { method_spec: spec, method };
    let name: string | null = null;
    if (specAt === null)
      issue(
        row,
        at,
        `method spec ${spec} lies outside the 64-bit address space from methodSpecs at 0x${specTable.toString(16)}`,
      );
    else if (method === null || classIndex === null || methodIndex === null)
      issue(row, specAt, `method spec ${spec} is not file backed`);
    else if (method < 0 || method >= metadata.methods.length)
      issue(
        row,
        specAt,
        `method spec ${spec} names method ${method} outside the ${metadata.methods.length} metadata methods`,
      );
    else {
      const classInstance = instance(classIndex);
      const methodInstance = instance(methodIndex);
      if (classInstance === undefined || methodInstance === undefined)
        issue(
          row,
          specAt,
          `method spec ${spec} names generic instances ${classIndex} and ${methodIndex}, outside the ${genericInstsCount} readable genericInsts`,
        );
      else {
        const owner = metadata.methods[method]!.declaring_type;
        const mismatch =
          argumentMismatch(
            "type",
            owner,
            facts.typeGenericContainer(owner),
            classInstance,
          ) ??
          argumentMismatch(
            "method",
            method,
            facts.methodGenericContainer(method),
            methodInstance,
          );
        if (mismatch !== null)
          issue(row, specAt, `method spec ${spec} ${mismatch}`);
        else
          try {
            name = yield* methodSpecName(method, classInstance, methodInstance);
          } catch (cause) {
            // Capacity is a budget refusal, never a fact about this row.
            if (
              !(cause instanceof Il2cppBinaryFormatFailure) ||
              cause.kind === "capacity"
            )
              throw cause;
            issue(row, specAt, cause.message);
          }
      }
    }
    if (name === null) return { ...base, name, ...unknown };
    const named = { ...base, name };
    const slotAt = entryAt(chosen.pointers, slot, 8);
    if (slotAt === null) {
      issue(
        row,
        at + 4n,
        `genericMethodPointers slot ${slot} lies outside the 64-bit address space from genericMethodPointers at 0x${chosen.pointers.toString(16)}`,
      );
      return { ...named, ...unknown };
    }
    const pointer = readSlot(image, slotAt);
    if (pointer === null) {
      issue(
        row,
        slotAt,
        `genericMethodPointers slot ${slot} is not file mapped`,
      );
      return { ...named, ...unknown };
    }
    if (pointer === "unknown") {
      issue(
        row,
        slotAt,
        `genericMethodPointers slot ${slot} has an unresolved relocation`,
      );
      return { ...named, ...unknown };
    }
    if (pointer === 0n)
      return { ...named, state: "no-body", address: null, rva: null };
    if (pointer < image.imageBase || !isExecutable(image, pointer)) {
      issue(
        row,
        slotAt,
        `genericMethodPointers slot ${slot} points outside unambiguous executable file data at 0x${pointer.toString(16)}`,
      );
      return { ...named, ...unknown };
    }
    return {
      ...named,
      state: "code",
      address: hex(pointer),
      rva: hex(pointer - image.imageBase),
    };
  }
  const instances: Il2cppGenericMethodInstance[] = [];
  for (let row = 0; row < tableCount; row++) {
    if (row % BATCH === 0) yield;
    const resolved = yield* resolve(row);
    options.onRow?.(resolved);
    instances.push(resolved);
  }
  return {
    generic_method_pointers_field: chosen.field,
    generic_method_pointers_count: chosen.pointersCount,
    generic_method_table: table,
    generic_method_table_count: tableCount,
    generic_method_table_stride: chosen.stride,
    method_specs_count: specsCount,
    generic_insts_count: genericInstsCount,
    instances,
    issues,
  };
}
