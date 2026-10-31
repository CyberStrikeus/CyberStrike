import { err, ok, type Result } from "../domain/result.js";
import {
  projectObjcClassMethods,
  type ObjcSwiftMetadata,
} from "../domain/native/objcSwiftMetadata.js";
import type { Segment, Section } from "./AppleMachoSelection.js";
import { boundClassName, decodeObjcCategories } from "./AppleObjcCategories.js";
import { readObjcPropertiesOf } from "./AppleObjcProperties.js";
import { BinaryFormatFailure } from "./metadata/BinaryContainer.js";
import type { DecodeIssue } from "./AppleDispatchDecodeFacts.js";
import { createObjcProtocolReader } from "./AppleObjcProtocols.js";
import type {
  BinaryMetadataEvidence,
  DispatchRecordBudget,
  ResolvedMetadataLocation,
} from "./AppleSwiftDispatchFacets.js";

/** Byte readers shared by Objective-C class/method/ivar decode facets. */
export interface ObjcDispatchReaders {
  u32(address: bigint): number;
  /** Plain 64-bit data, never a fixup. */
  u64(address: bigint): bigint;
  i32(address: bigint): number;
  pointer(address: bigint): bigint;
  /** The symbol a pointer at `address` is bound to, when it is a bind fixup. */
  bound(
    address: bigint,
  ): { readonly symbol: string; readonly library: string | null } | undefined;
  string(address: bigint): string;
  location(address: bigint): ResolvedMetadataLocation;
  evidence(address: bigint, description: string): BinaryMetadataEvidence;
  offset(address: bigint, size?: number): number;
}

const hex = (value: bigint) => `0x${value.toString(16)}`;
const decoded = { status: "decoded" as const, reason: null };

/** Admit the local class identity once for classes, superclasses and categories. */
const readLocalClass = (read: ObjcDispatchReaders, address: bigint) => {
  const ro = read.pointer(address + 32n) & ~7n;
  const name = read.string(read.pointer(ro + 24n));
  if (name.length === 0)
    throw new TypeError(
      `Objective-C class at ${hex(address)} has an empty name`,
    );
  return { ro, name };
};

/**
 * Resolve a class's superclass: a bind to `_OBJC_CLASS_$_Name` names a class
 * in another image; otherwise the pointer is a class_t in this image.
 */
const resolveSuperclass = (
  read: ObjcDispatchReaders,
  address: bigint,
  className: string,
  failures: string[],
): { name: string | null; address: string | null } => {
  const external = boundClassName(read, address + 8n);
  if (external !== undefined) return { name: external, address: null };
  const superclass = read.pointer(address + 8n);
  if (superclass === 0n) return { name: null, address: null };
  try {
    return {
      name: readLocalClass(read, superclass).name,
      address: hex(superclass),
    };
  } catch (cause: unknown) {
    failures.push(
      `Superclass pointer ${hex(superclass)} of ${className} could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return { name: null, address: hex(superclass) };
  }
};

/** Decode Objective-C protocol lists, classlists, methods, and ivars into `result`. */
export const decodeObjcDispatchFacets = (input: {
  bytes: Buffer;
  sections: readonly Section[];
  segments: readonly Segment[];
  readers: ObjcDispatchReaders;
  budget: DispatchRecordBudget;
  maxListSlots: number;
  result: ObjcSwiftMetadata;
}): {
  failures: string[];
  categoryIssues: DecodeIssue[];
  examined: number;
  categoriesExamined: number;
  objcListScanTruncated: boolean;
  objcClassListScanTruncated: boolean;
} => {
  const {
    bytes,
    sections,
    segments,
    readers: read,
    budget,
    maxListSlots,
    result,
  } = input;
  const failures: string[] = [];
  const categoryIssues: DecodeIssue[] = [];
  let classObjectsExamined = 0;
  const methods = (
    list: bigint,
    className: string,
    methodType: "instance" | "class",
    category?: string,
    onTruncated?: () => void,
  ): string[] => {
    const selectors: string[] = [];
    if (list === 0n) return selectors;
    const flags = read.u32(list),
      count = read.u32(list + 4n),
      relative = (flags & 0x80000000) !== 0;
    const stride = flags & 0xfffc;
    if (stride !== (relative ? 12 : 24))
      throw new TypeError(`Unsupported method stride/flags at ${hex(list)}`);
    for (let index = 0; index < count; index++) {
      if (!budget.admit()) {
        onTruncated?.();
        break;
      }
      const entry = list + 8n + BigInt(index * stride);
      const rel = (field: bigint) => {
        const displacement = bytes.readInt32LE(read.offset(field, 4));
        const target = field + BigInt(displacement);
        let fileOffset: number | null = null;
        try {
          fileOffset = read.offset(target);
        } catch (cause: unknown) {
          // best-effort cleanup: serialized target remains unresolved.
          void cause;
        }
        if (budget.admit())
          result.relative_pointers.push({
            field: read.location(field),
            target: { address: hex(target), file_offset: fileOffset },
            displacement,
            indirectable: false,
            indirect: false,
            decode:
              fileOffset === null
                ? { status: "partial", reason: "relative_target_unmapped" }
                : decoded,
            evidence: read.evidence(
              field,
              "Signed-relative Objective-C method-list pointer",
            ),
          });
        return target;
      };
      let selectorAddress = relative ? rel(entry) : read.pointer(entry);
      if (relative && (flags & 0x40000000) === 0)
        selectorAddress = read.pointer(selectorAddress);
      const implementation = relative
        ? rel(entry + 8n)
        : read.pointer(entry + 16n);
      let implementationLocation: {
        address: string;
        file_offset: number;
      } | null = null;
      try {
        if (
          !segments.some(
            (segment) =>
              segment.executable &&
              implementation >= segment.address &&
              implementation < segment.address + segment.size,
          )
        )
          throw new RangeError(
            "Method implementation is not in an executable segment",
          );
        implementationLocation = read.location(implementation);
      } catch (cause: unknown) {
        // best-effort cleanup: external/chained pointers remain unresolved.
        void cause;
      }
      const selector = read.string(selectorAddress);
      if (selector.length === 0)
        throw new TypeError("Objective-C method has an empty selector");
      selectors.push(selector);
      result.objc_dispatch_implementations.push({
        class_name: className,
        selector,
        method_type: methodType,
        ...(category === undefined ? {} : { category }),
        implementation_address: implementationLocation?.address ?? null,
        location: read.location(entry),
        decode:
          implementationLocation === null
            ? {
                status: "partial",
                reason: "implementation_pointer_unmapped_or_encoded",
              }
            : decoded,
        evidence: read.evidence(
          entry,
          relative
            ? "Encoded relative Objective-C method entry"
            : "Encoded absolute Objective-C method entry",
        ),
      });
    }
    return selectors;
  };
  const protocolReader = createObjcProtocolReader({
    readers: {
      u32: read.u32,
      pointer: read.pointer,
      string: read.string,
      location: read.location,
      evidence: read.evidence,
      admit: () => budget.admit(),
      i32: read.i32,
      u64: read.u64,
    },
    result,
    failures,
  });
  // Each list scan has its own slot bound: zero and duplicate pointers do
  // not produce records, but still consume pointer-reading work. The bound
  // is per list so one list's slots cannot starve the other list's scan.
  // Record decoders retain their existing admission ownership.
  let objcListScanTruncated = false;
  let objcClassListScanTruncated = false;
  const createListSlotReader = () => {
    let listSlotsExamined = 0;
    return (field: bigint): Result<bigint, "unmapped" | "exhausted"> => {
      if (listSlotsExamined >= maxListSlots) {
        objcListScanTruncated = true;
        return err("exhausted");
      }
      listSlotsExamined++;
      try {
        return ok(read.pointer(field));
      } catch (cause: unknown) {
        const admitted = budget.admit();
        failures.push(
          `${hex(field)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return err(admitted ? "unmapped" : "exhausted");
      }
    };
  };
  const readProtocolListSlot = createListSlotReader();
  const readClassListSlot = createListSlotReader();
  for (const section of sections.filter(
    ({ name }) => name === "__objc_protolist",
  )) {
    if (section.size % 8 !== 0)
      throw new BinaryFormatFailure(
        "malformed",
        "Misaligned Objective-C protocol list",
      );
    for (let index = 0; index < section.size / 8; index++) {
      if (budget.isFull()) {
        budget.markTruncated();
        break;
      }
      const field = section.address + BigInt(index * 8);
      const pointer = readProtocolListSlot(field);
      if (!pointer.ok) {
        if (pointer.error === "exhausted") break;
        continue;
      }
      try {
        protocolReader.record(pointer.value);
      } catch (cause) {
        // record() admits the slot itself before decoding, so admitting
        // again here would count one protocol twice.
        failures.push(
          `${hex(field)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }
  const visited = new Set<string>();
  const readClass = (address: bigint, meta = false) => {
    if (address === 0n || visited.has(hex(address)) || !budget.admit()) return;
    // Coverage counts admitted class objects, including recursively visited
    // metaclasses, in the same units as the decoded objc_classes rows.
    classObjectsExamined++;
    visited.add(hex(address));
    const { ro, name } = readLocalClass(read, address);
    const root = (read.u32(ro) & 2) !== 0;
    const superclass = resolveSuperclass(read, address, name, failures);
    if (superclass.name === null && superclass.address === null && !root)
      failures.push(
        `Superclass of ${name} requires external binding resolution`,
      );
    const ivarList = read.pointer(ro + 48n);
    let ivarCount: number | null = meta ? null : 0;
    let classListTruncated = false;
    const onTruncated = () => {
      classListTruncated = true;
    };
    if (ivarList !== 0n && !meta) {
      const stride = read.u32(ivarList),
        count = read.u32(ivarList + 4n);
      if (stride !== 32)
        throw new TypeError("Unsupported Objective-C ivar entry size");
      ivarCount = count;
      for (let index = 0; index < count; index++) {
        if (!budget.admit()) {
          classListTruncated = true;
          break;
        }
        const entry = ivarList + 8n + BigInt(index * stride);
        const encodedOffset = read.pointer(entry);
        let value: number | null = null;
        try {
          value = read.u32(encodedOffset);
        } catch (cause: unknown) {
          // Unresolved offsets are recorded; the cause adds no identity.
          void cause;
          failures.push(`Unresolved ivar offset pointer ${hex(encodedOffset)}`);
        }
        const ivarName = read.string(read.pointer(entry + 8n));
        if (ivarName.length === 0)
          throw new TypeError("Objective-C ivar has an empty name");
        const alignment = read.u32(entry + 24n);
        result.objc_ivars.push({
          class_name: name,
          name: ivarName,
          type_encoding: read.string(read.pointer(entry + 16n)),
          offset: value,
          size: read.u32(entry + 28n),
          // objc4 ivar_t::alignment(): ~0 means word alignment (8 for 32-byte entries).
          alignment:
            alignment === 0xffffffff
              ? 8
              : alignment < 31
                ? 2 ** alignment
                : null,
          location: read.location(entry),
          decode:
            value === null
              ? { status: "partial", reason: "ivar_offset_pointer_unresolved" }
              : decoded,
          evidence: read.evidence(
            entry,
            "Objective-C ivar entry and encoded offset storage",
          ),
        });
      }
    }
    methods(
      read.pointer(ro + 32n),
      name,
      meta ? "class" : "instance",
      undefined,
      onTruncated,
    );
    const properties = readObjcPropertiesOf(read, read.pointer(ro + 64n), {
      owner: name,
      admit: () => budget.admit(),
      issues: categoryIssues,
      location: hex(read.pointer(ro + 64n)),
      onTruncated,
    });
    const protocols = protocolReader.list(read.pointer(ro + 40n), onTruncated);
    const classDecodeReasons = [
      ...(superclass.name === null && !root
        ? ["superclass_binding_unresolved"]
        : []),
      ...(classListTruncated ? ["max_records_reached"] : []),
    ];
    result.objc_classes.push({
      name,
      super_class: superclass.name,
      is_meta_class: meta,
      is_root_class: root,
      methods: projectObjcClassMethods(
        result.objc_dispatch_implementations.filter(
          (item) =>
            item.class_name === name &&
            item.method_type === (meta ? "class" : "instance"),
        ),
      ),
      properties,
      protocols,
      ivar_count: ivarCount,
      instance_size: read.u32(ro + 8n),
      location: read.location(address),
      superclass_address: superclass.address,
      metaclass_address: meta ? null : hex(read.pointer(address)),
      decode:
        classDecodeReasons.length === 0
          ? decoded
          : { status: "partial", reason: classDecodeReasons.join("; ") },
      evidence: read.evidence(
        address,
        "Objective-C class and class_ro_t records",
      ),
    });
    if (!meta) {
      try {
        readClass(read.pointer(address), true);
      } catch (cause) {
        failures.push(
          `Metaclass of ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  };
  for (const section of sections.filter(
    ({ name }) => name === "__objc_classlist",
  )) {
    if (section.size % 8 !== 0)
      throw new BinaryFormatFailure(
        "malformed",
        "Misaligned Objective-C class-list size",
      );
    for (let index = 0; index < section.size / 8; index++) {
      if (budget.isFull()) {
        budget.markTruncated();
        break;
      }
      const field = section.address + BigInt(index * 8);
      const pointer = readClassListSlot(field);
      if (!pointer.ok) {
        if (pointer.error === "exhausted") {
          objcClassListScanTruncated = true;
          break;
        }
        continue;
      }
      try {
        readClass(pointer.value);
      } catch (cause) {
        // The slot was already admitted inside readClass before anything
        // could throw (its admit runs before the first pointer read), so
        // admitting again here would count one class twice: at the budget
        // boundary it would break before appending the failure reason, and
        // with larger limits malformed classes would starve valid ones.
        failures.push(
          `${hex(field)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  }
  const categoriesExamined = decodeObjcCategories({
    sections,
    read,
    result,
    issues: categoryIssues,
    admit: () => budget.admit(),
    methods,
    protocols: (list, onTruncated) => protocolReader.list(list, onTruncated),
    localClassName: (address) => readLocalClass(read, address).name,
  });
  return {
    failures,
    categoryIssues,
    examined: classObjectsExamined,
    categoriesExamined,
    objcListScanTruncated,
    objcClassListScanTruncated,
  };
};
