import { createHash } from "node:crypto";
import { setImmediate as immediate } from "node:timers/promises";
import { err, ok, type Result } from "../../domain/result.js";
import { dexDescriptorSchema } from "../../domain/android/dexTypes.js";
import type {
  AndroidJniLibraryFacts,
  AndroidJniLibraryFailure,
  AndroidJniTableEntry,
  AndroidJniTableSlot,
} from "../../domain/android/androidJniLibraryFacts.js";
import { parseNativeExportsSteps } from "../exports/NativeExportParser.js";
import { readElfDirectoryFromBuffer } from "../metadata/NativeSectionDirectory.js";
import { readElfImage } from "../metadata/ElfImage.js";
import {
  BinaryFormatFailure,
  BinaryMappingFailure,
  BinaryResourceFailure,
  BinaryStringReadLimitFailure,
  createFileMappingIndex,
} from "../metadata/BinaryContainer.js";
import {
  readElfPointerRelocationsSteps,
  ElfPointerRelocationFailure,
  type ElfPointerOverlay,
} from "../metadata/ElfPointerRelocations.js";

const MAXIMUM_STRING_BYTES = 65_535;
const MAXIMUM_STRING_WORK = 64 * 1024 * 1024;
const MAXIMUM_RETAINED_BYTES = 16 * 1024 * 1024;
const MAXIMUM_SCAN_BYTES = 64 * 1024 * 1024;
const MAXIMUM_TABLE_ENTRIES = 65_536;
const hex = (value: bigint): string => `0x${value.toString(16)}`;

/** Strict Modified UTF-8: no four-byte UTF-8, overlong forms or replacements. */
export const decodeJniModifiedUtf8 = (
  bytes: Uint8Array,
): string | undefined => {
  const chunks: string[] = [];
  let units: number[] = [];
  for (let at = 0; at < bytes.length;) {
    const first = bytes[at++] ?? 0;
    let unit: number;
    if (first >= 1 && first <= 0x7f) unit = first;
    else if (first >= 0xc0 && first <= 0xdf) {
      const second = bytes[at++];
      if (second === undefined || (second & 0xc0) !== 0x80) return undefined;
      unit = ((first & 0x1f) << 6) | (second & 0x3f);
      if (unit < 0x80 && !(first === 0xc0 && second === 0x80)) return undefined;
    } else if (first >= 0xe0 && first <= 0xef) {
      const second = bytes[at++],
        third = bytes[at++];
      if (
        second === undefined ||
        third === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80
      )
        return undefined;
      unit = ((first & 0xf) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (unit < 0x800) return undefined;
    } else return undefined;
    units.push(unit);
    if (units.length === 4096) {
      chunks.push(String.fromCharCode(...units));
      units = [];
    }
  }
  if (units.length !== 0) chunks.push(String.fromCharCode(...units));
  return chunks.join("");
};

const methodName = (name: string): boolean =>
  name !== "" && !/[.;\[/<>\0]/u.test(name);
const methodDescriptor = (descriptor: string): boolean => {
  if (
    !dexDescriptorSchema.safeParse(descriptor).success ||
    /[.\s\0]/u.test(descriptor)
  )
    return false;
  for (const match of descriptor.matchAll(/L([^;]+);/gu)) {
    const name = match[1];
    if (
      name === undefined ||
      name.includes("[") ||
      name.split("/").some((part) => part === "")
    )
      return false;
  }
  return true;
};

/** Parse borrowed immutable ELF bytes; no filesystem, process or target execution. */
export const inspectAndroidJniLibrary = async (
  bytes: Buffer,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Result<AndroidJniLibraryFacts, AndroidJniLibraryFailure>> => {
  const active = (): void => {
    if (options.signal?.aborted === true) throw options.signal;
  };
  try {
    active();
    if (!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
      return err({
        kind: "unsupported",
        message: "JNI library inspection requires an ELF image",
      });
    const directory = readElfDirectoryFromBuffer(bytes);
    const image = readElfImage(bytes);
    const mappings = createFileMappingIndex(image.mappings, image.zero_fills);
    if (image.executable_mappings === undefined)
      return err({
        kind: "unsupported",
        message: "ELF executable PT_LOAD inventory is unavailable",
      });
    const executable = createFileMappingIndex(
      image.executable_mappings,
      image.zero_fills,
    );
    const unknowns = new Set<string>();
    let retained = 0,
      stringWork = 0;
    const retain = (amount: number): void => {
      retained += amount;
      if (retained > MAXIMUM_RETAINED_BYTES)
        throw new BinaryResourceFailure(
          "structure",
          MAXIMUM_RETAINED_BYTES,
          "JNI library facts exceed the 16 MiB retained representation allowance",
        );
    };
    const exportSteps = parseNativeExportsSteps(bytes, {
      path: "[admitted immutable ELF bytes]",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
    let exportStep = exportSteps.next();
    while (!exportStep.done) {
      await immediate();
      active();
      exportStep = exportSteps.next();
    }
    const rawExports = exportStep.value;
    if (rawExports.format !== "elf")
      return err({
        kind: "unsupported",
        message: "JNI library inspection requires ELF exports",
      });
    const exportRows: AndroidJniLibraryFacts["exports"] = [];
    let exportsStatus: AndroidJniLibraryFacts["coverage"]["exports_status"] =
      rawExports.coverage.status === "complete"
        ? "complete"
        : rawExports.coverage.status === "unsupported"
          ? "unknown"
          : "partial";
    if (exportsStatus !== "complete")
      unknowns.add(
        rawExports.coverage.reason ?? "Dynamic export inventory is incomplete",
      );
    for (const [sourceIndex, row] of rawExports.exports.entries()) {
      if (row.name !== "JNI_OnLoad" && !row.name.startsWith("Java_")) continue;
      if (row.type !== "function") {
        exportsStatus = "partial";
        unknowns.add(
          "JNI-named non-function or IFUNC exports are not direct implementation addresses",
        );
        continue;
      }
      if (
        row.version !== null &&
        row.version !== "unknown" &&
        row.version.hidden
      )
        continue;
      if (row.version === "unknown") {
        exportsStatus = "partial";
        unknowns.add(
          "JNI export version applicability is unknown; unresolved versions are not emitted as available bindings",
        );
        continue;
      }
      const address = BigInt(row.value);
      const code = directory.machine === 40 ? address & ~1n : address;
      let offset: number | null = null;
      try {
        offset = executable.offset(code, 1);
      } catch (cause) {
        if (
          cause instanceof BinaryMappingFailure &&
          cause.reason === "unmapped"
        ) {
          exportsStatus = "partial";
          unknowns.add(
            "Some JNI function exports are outside executable file-backed PT_LOAD ranges",
          );
          continue;
        } else throw cause;
      }
      retain(192 + row.name.length * 2);
      exportRows.push({
        source_index: sourceIndex,
        name: row.name,
        address: row.value,
        file_offset: offset,
      });
    }
    await immediate();
    active();
    let overlay: ElfPointerOverlay;
    try {
      const steps = readElfPointerRelocationsSteps(
        bytes,
        {
          bits: directory.bits,
          little: directory.little,
          machine: directory.machine,
          dynamicSegments: image.elf.dynamicSegments,
          mappings: image.mappings,
          zeroFills: image.zero_fills,
        },
        { unsupported: "record" },
      );
      let next = steps.next();
      while (!next.done) {
        await immediate();
        active();
        next = steps.next();
      }
      overlay = next.value;
    } catch (cause) {
      if (
        !(cause instanceof ElfPointerRelocationFailure) ||
        cause.reason !== "unsupported-container"
      )
        throw cause;
      return ok({
        architecture: image.architecture,
        bits: directory.bits,
        byte_order: image.byte_order,
        exports: exportRows,
        jni_on_load: rawExports.exports.some(
          (row) => row.name === "JNI_OnLoad",
        ),
        tables: [],
        coverage: {
          status: "partial",
          exports_status: exportsStatus,
          tables_status: "unknown",
          relocations_status: "unknown",
          examined_sections: 0,
          examined_pointer_slots: 0,
        },
        unknowns: [
          ...unknowns,
          cause.message,
          "Runtime-built tables and obfuscated strings are not recovered; no loading or invocation is established",
        ],
      });
    }
    for (const issue of overlay.issues) unknowns.add(issue);
    if (overlay.unresolved.size !== 0)
      unknowns.add(
        `${overlay.unresolved.size} unresolved, conflicting or indirect relocation destinations have unknown values`,
      );
    const relocationStatus = !overlay.pointer_coverage_known
      ? "unknown"
      : overlay.unresolved.size !== 0
        ? "partial"
        : "complete";
    let tablesStatus: AndroidJniLibraryFacts["coverage"]["tables_status"] =
      !overlay.pointer_coverage_known ? "unknown" : "complete";
    const tables: AndroidJniLibraryFacts["tables"] = [];
    const word = directory.bits / 8;
    const strings = new Map<bigint, string | null>();
    const stringAt = (address: bigint): string | undefined => {
      const cached = strings.get(address);
      if (cached !== undefined) return cached ?? undefined;
      let value: string | undefined;
      const remaining = MAXIMUM_STRING_WORK - stringWork;
      if (remaining <= 0)
        throw new BinaryResourceFailure(
          "search",
          MAXIMUM_STRING_WORK,
          "JNI string decoding exceeds the 64 MiB work allowance",
        );
      const allowance = Math.min(MAXIMUM_STRING_BYTES, remaining - 1);
      let scanned = false;
      try {
        mappings.offset(address, 1);
        scanned = true;
        const raw = mappings.readCString(bytes, address, allowance);
        stringWork += raw.length + 1;
        if (stringWork > MAXIMUM_STRING_WORK)
          throw new BinaryResourceFailure(
            "search",
            MAXIMUM_STRING_WORK,
            "JNI string decoding exceeds the 64 MiB work allowance",
          );
        if (overlay.hasWrites(address, raw.length + 1)) {
          tablesStatus = "partial";
          unknowns.add(
            "Some candidate strings overlap relocation writes; their text is not established by stored bytes",
          );
        } else value = decodeJniModifiedUtf8(raw);
      } catch (cause) {
        if (cause instanceof BinaryMappingFailure) {
          if (cause.reason !== "unmapped") throw cause;
          stringWork += scanned ? allowance + 1 : 1;
        } else if (cause instanceof BinaryStringReadLimitFailure) {
          stringWork += allowance + 1;
          tablesStatus = "partial";
          unknowns.add(
            `Some JNI candidate strings exceeded the ${cause.maximumBytes}-byte NUL-termination read allowance; omitted entries remain unknown`,
          );
        } else if (cause instanceof BinaryFormatFailure) {
          // Unterminated source bytes also consume their actual scan allowance.
          stringWork += allowance + 1;
        } else throw cause;
      }
      if (strings.size >= MAXIMUM_TABLE_ENTRIES)
        throw new BinaryResourceFailure(
          "structure",
          MAXIMUM_RETAINED_BYTES,
          "JNI string lookup index exceeds its 65536-entry allowance",
        );
      retain(96 + (value?.length ?? 0) * 2);
      strings.set(address, value ?? null);
      return value;
    };
    let scannedBytes = 0,
      examinedSections = 0,
      examinedSlots = 0,
      entries = 0;
    if (overlay.pointer_coverage_known) {
      if (directory.sections.length === 0) {
        tablesStatus = "unknown";
        unknowns.add(
          "ELF section inventory is unavailable; writable-section table coverage is unknown",
        );
      }
      for (const section of directory.sections) {
        if ((section.flags & 3n) !== 3n || section.size === 0n) continue;
        active();
        if (
          (section.flags & 0x800n) !== 0n ||
          !section.file_backed ||
          section.type === 8
        ) {
          tablesStatus = "partial";
          unknowns.add(
            "Allocated writable sections without ordinary file bytes were not scanned; runtime-built tables remain unknown",
          );
          continue;
        }
        if (section.size > BigInt(MAXIMUM_SCAN_BYTES - scannedBytes))
          throw new BinaryResourceFailure(
            "search",
            MAXIMUM_SCAN_BYTES,
            "JNI writable-section scan exceeds the 64 MiB work allowance",
          );
        try {
          mappings.offset(section.address, Number(section.size));
        } catch (cause) {
          if (
            cause instanceof BinaryMappingFailure &&
            cause.reason === "unmapped"
          ) {
            tablesStatus = "partial";
            unknowns.add(
              "Some allocated writable section bytes are not file-backed in PT_LOAD; table coverage there is unknown",
            );
            continue;
          }
          throw cause;
        }
        scannedBytes += Number(section.size);
        examinedSections++;
        let table: AndroidJniLibraryFacts["tables"][number] | undefined;
        let previousEntry: bigint | undefined;
        // C pointers have word alignment in virtual memory, including unnamed sections.
        const padding =
          (BigInt(word) - (section.address % BigInt(word))) % BigInt(word);
        for (
          let offset = padding;
          offset + BigInt(3 * word) <= section.size;
          offset += BigInt(word)
        ) {
          if (examinedSlots % 4096 === 0) {
            await immediate();
            active();
          }
          examinedSlots++;
          const address = section.address + offset;
          const fn = overlay.pointerAt(address + BigInt(2 * word));
          if (fn === undefined || fn.value === 0n) continue;
          const code = directory.machine === 40 ? fn.value & ~1n : fn.value;
          let codeOffset: number;
          try {
            codeOffset = executable.offset(code, 1);
          } catch (cause) {
            if (
              cause instanceof BinaryMappingFailure &&
              cause.reason === "unmapped"
            )
              continue;
            throw cause;
          }
          const name = overlay.pointerAt(address),
            signature = overlay.pointerAt(address + BigInt(word));
          if (
            name === undefined ||
            signature === undefined ||
            name.value === 0n ||
            signature.value === 0n
          )
            continue;
          const decodedName = stringAt(name.value);
          if (decodedName === undefined || !methodName(decodedName)) continue;
          const descriptor = stringAt(signature.value);
          if (descriptor === undefined || !methodDescriptor(descriptor))
            continue;
          if (++entries > MAXIMUM_TABLE_ENTRIES)
            throw new BinaryResourceFailure(
              "structure",
              MAXIMUM_RETAINED_BYTES,
              "JNI table inventory exceeds its 65536-entry allowance",
            );
          retain(1024 + 2 * (decodedName.length + descriptor.length));
          if (
            table === undefined ||
            previousEntry === undefined ||
            address !== previousEntry + BigInt(3 * word)
          ) {
            table = {
              section_index: section.index,
              section_name: section.name,
              table_address: hex(address),
              entries: [],
            };
            retain(256 + (section.name?.length ?? 0) * 2);
            tables.push(table);
          }
          const slots: AndroidJniTableSlot[] = [name, signature, fn].map(
            (pointer, index) => ({
              role:
                index === 0 ? "name" : index === 1 ? "signature" : "function",
              address: hex(address + BigInt(index * word)),
              file_offset: mappings.offset(
                address + BigInt(index * word),
                word,
              ),
              value: hex(pointer.value),
              relocation: pointer.relocation,
            }),
          );
          const entry: AndroidJniTableEntry = {
            entry_index: table.entries.length,
            name: decodedName,
            descriptor,
            function_address: hex(fn.value),
            code_address: hex(code),
            function_file_offset: codeOffset,
            slots,
          };
          table.entries.push(entry);
          previousEntry = address;
        }
      }
    }
    if (overlay.unresolved.size !== 0 && tablesStatus === "complete")
      tablesStatus = "partial";
    const onLoad = rawExports.exports.some((row) => row.name === "JNI_OnLoad");
    if (onLoad && tables.length === 0)
      unknowns.add(
        "JNI_OnLoad is exported but no static JNINativeMethod candidate was decoded",
      );
    unknowns.add(
      "Runtime-built tables and obfuscated strings are not recovered; no loading, registration or invocation is established",
    );
    active();
    return ok({
      architecture: image.architecture,
      bits: directory.bits,
      byte_order: image.byte_order,
      exports: exportRows,
      jni_on_load: onLoad,
      tables,
      coverage: {
        status:
          exportsStatus === "complete" &&
          tablesStatus === "complete" &&
          relocationStatus === "complete"
            ? "complete"
            : "partial",
        exports_status: exportsStatus,
        tables_status: tablesStatus,
        relocations_status: relocationStatus,
        examined_sections: examinedSections,
        examined_pointer_slots: examinedSlots,
      },
      unknowns: [...unknowns],
    });
  } catch (cause) {
    if (cause === options.signal)
      return err({
        kind: "cancelled",
        message: "JNI library inspection was cancelled",
      });
    if (
      cause instanceof BinaryResourceFailure ||
      (cause instanceof ElfPointerRelocationFailure &&
        cause.reason === "native-index-capacity")
    )
      return err({ kind: "capacity", message: cause.message });
    if (cause instanceof BinaryFormatFailure)
      return err({ kind: cause.kind, message: cause.message });
    if (cause instanceof ElfPointerRelocationFailure)
      return err({
        kind:
          cause.reason === "malformed-container" ? "malformed" : "unsupported",
        message: cause.message,
      });
    throw cause;
  }
};
