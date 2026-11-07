import type { RiscvIsaDeclaration } from "./binaryTargetTypes.js";
import {
  readElfTableDeclarations,
  type ElfDeclarationRead,
} from "./elfDeclaredRanges.js";
import { readElfSectionHeader } from "./elfSectionHeader.js";
import { err, ok, type Result } from "./result.js";

/** `EF_RISCV_FLOAT_ABI` declarations in `e_flags`, named as the psABI names them. */
export const RISCV_FLOAT_ABIS = ["soft", "single", "double", "quad"] as const;
export type RiscvFloatAbi = (typeof RISCV_FLOAT_ABIS)[number];

const EF_RISCV_FLOAT_ABI = 0x0006;

/** The float ABI that bits 1–2 of an ELF `e_flags` word declare. */
export const riscvFloatAbi = (flags: number): RiscvFloatAbi =>
  RISCV_FLOAT_ABIS[(flags & EF_RISCV_FLOAT_ABI) >>> 1]!;

/** The psABI name of a class and float ABI; RV32 has no named quad-float ABI. */
export const riscvAbiName = (
  elfClass: 32 | 64,
  floatAbi: RiscvFloatAbi,
): string | null =>
  elfClass === 32 && floatAbi === "quad"
    ? null
    : `${elfClass === 32 ? "ilp32" : "lp64"}${
        { soft: "", single: "f", double: "d", quad: "q" }[floatAbi]
      }`;

/** `SHT_RISCV_ATTRIBUTES`, the psABI's build-attributes section type. */
export const SHT_RISCV_ATTRIBUTES = 0x70000003;
/** Bound the section read before its declared size can drive allocation. */
export const RISCV_ATTRIBUTES_MAX_BYTES = 4096;

const FORMAT_VERSION = 0x41;
const TAG_FILE = 1;
const TAG_RISCV_ARCH = 5;

/**
 * Read `Tag_RISCV_arch` from a `.riscv.attributes` section; null means the
 * section declares no ISA string. The psABI gives odd tags string values and
 * even tags integer values, so tags REA does not use are skipped by that rule.
 * Other vendors and section or symbol scopes fail closed: their declarations
 * are not skipped.
 */
export const parseRiscvAttributes = (
  bytes: Uint8Array,
  littleEndian: boolean,
): Result<string | null, string> => {
  if (bytes.length === 0 || bytes[0] !== FORMAT_VERSION)
    return err("unsupported RISC-V attribute section format version");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readU32 = (offset: number): number =>
    view.getUint32(offset, littleEndian);
  const readUleb = (
    offset: number,
    end: number,
  ): { readonly value: number; readonly next: number } | undefined => {
    let value = 0;
    for (let index = 0; index < 5 && offset + index < end; index += 1) {
      const byte = bytes[offset + index]!;
      value += (byte & 0x7f) * 2 ** (7 * index);
      if ((byte & 0x80) === 0)
        return value <= 0xffffffff
          ? { value, next: offset + index + 1 }
          : undefined;
    }
    return undefined;
  };
  const readString = (
    offset: number,
    end: number,
  ): { readonly value: string; readonly next: number } | undefined => {
    const stop = bytes.indexOf(0, offset);
    return stop < 0 || stop >= end
      ? undefined
      : {
          value: Buffer.from(bytes.subarray(offset, stop)).toString("latin1"),
          next: stop + 1,
        };
  };

  let arch: string | null = null;
  let vendorSeen = false;
  let position = 1;
  while (position < bytes.length) {
    if (bytes.length - position < 4)
      return err("truncated RISC-V attribute subsection length");
    const length = readU32(position);
    if (length < 4 || length > bytes.length - position)
      return err("RISC-V attribute subsection length does not fit the section");
    const end = position + length;
    const vendor = readString(position + 4, end);
    if (vendor === undefined)
      return err("unterminated RISC-V attribute vendor name");
    if (vendor.value !== "riscv")
      return err(
        "RISC-V ELF declares non-riscv vendor attributes that REA does not inspect",
      );
    if (vendorSeen) return err("duplicate riscv vendor attribute subsections");
    vendorSeen = true;

    let cursor = vendor.next;
    while (cursor < end) {
      const scopeStart = cursor;
      const scope = readUleb(cursor, end);
      if (scope === undefined)
        return err("malformed RISC-V attribute scope tag");
      if (scope.value !== TAG_FILE)
        return err(
          "RISC-V attributes scoped to sections or symbols are not inspected by REA",
        );
      if (end - scope.next < 4)
        return err("truncated RISC-V attribute scope length");
      const scopeLength = readU32(scope.next);
      if (
        scopeLength < scope.next + 4 - scopeStart ||
        scopeLength > end - scopeStart
      )
        return err("RISC-V attribute scope length does not fit its subsection");
      const scopeEnd = scopeStart + scopeLength;
      cursor = scope.next + 4;
      while (cursor < scopeEnd) {
        const tag = readUleb(cursor, scopeEnd);
        if (tag === undefined) return err("malformed RISC-V attribute tag");
        if (tag.value % 2 === 1) {
          const value = readString(tag.next, scopeEnd);
          if (value === undefined)
            return err(
              `unterminated string value for RISC-V attribute tag ${tag.value}`,
            );
          if (tag.value === TAG_RISCV_ARCH) {
            if (arch !== null)
              return err("duplicate RISC-V Tag_RISCV_arch attributes");
            arch = value.value;
          }
          cursor = value.next;
        } else {
          const value = readUleb(tag.next, scopeEnd);
          if (value === undefined)
            return err(
              `malformed integer value for RISC-V attribute tag ${tag.value}`,
            );
          cursor = value.next;
        }
      }
    }
    position = end;
  }
  return ok(arch);
};

const ISA_BASE = /^rv(32|64)([ie])(?:\d+p\d+)?$/u;
const ISA_EXTENSION = /^([a-z][a-z0-9]*?)(?:\d+p\d+)?$/u;

/**
 * Interpret a `Tag_RISCV_arch` string in the psABI's canonical form, such as
 * `rv32i2p1_m2p0_c2p0_zicsr2p0`: a base, then one underscore before each
 * extension, each with an optional `<major>p<minor>` version. A string in
 * another form keeps its raw value and stays unavailable.
 */
export const riscvIsaDeclaration = (arch: string): RiscvIsaDeclaration => {
  const unavailable = (reason: string): RiscvIsaDeclaration => ({
    status: "unavailable",
    reason,
    arch,
  });
  const [first = "", ...rest] = arch.split("_");
  const base = ISA_BASE.exec(first);
  if (base === null)
    return unavailable(
      "Tag_RISCV_arch does not begin with a canonical rv32/rv64 I or E base",
    );
  const extensions: string[] = [];
  for (const token of rest) {
    const name = ISA_EXTENSION.exec(token)?.[1];
    if (name === undefined)
      return unavailable(
        `Tag_RISCV_arch contains a non-canonical extension token "${token}"`,
      );
    if (extensions.includes(name))
      return unavailable(`Tag_RISCV_arch declares extension ${name} twice`);
    extensions.push(name);
  }
  return {
    status: "declared",
    arch,
    xlen: base[1] === "32" ? 32 : 64,
    base: base[2] === "e" ? "e" : "i",
    extensions,
  };
};

/**
 * Find and interpret the image's `SHT_RISCV_ATTRIBUTES` section. Every section
 * header is examined, so an absent declaration is observed, not assumed; two
 * attribute sections leave the declaration unavailable. The caller satisfies
 * each read from its own descriptor.
 */
export function* readRiscvIsaDeclaration(
  prefix: Buffer,
  fileSize: number,
): Generator<ElfDeclarationRead, RiscvIsaDeclaration, Buffer> {
  const unavailable = (reason: string): RiscvIsaDeclaration => ({
    status: "unavailable",
    reason,
  });
  const declarations = yield* readElfTableDeclarations(prefix, fileSize);
  if (!declarations.ok) return unavailable(declarations.error);
  const { header, sections } = declarations.value;
  const little = header.byteOrder === "little";
  let attributes:
    | { readonly offset: bigint; readonly size: bigint }
    | undefined;
  const perRead = Math.max(1, Math.floor((64 * 1024) / sections.width));
  for (let index = 0; index < sections.count; index += perRead) {
    const count = Math.min(perRead, sections.count - index);
    const size = count * sections.width;
    const bytes = yield {
      offset: Number(sections.offset) + index * sections.width,
      size,
    };
    if (bytes.length !== size)
      return unavailable("truncated ELF section header table");
    for (let item = 0; item < count; item += 1) {
      const at = item * sections.width;
      const parsed = readElfSectionHeader(
        bytes.subarray(at, at + sections.width),
        header.elfClass,
        little,
      );
      if (!parsed.ok) return unavailable(parsed.error.message);
      if (parsed.value.type !== SHT_RISCV_ATTRIBUTES) continue;
      if (attributes !== undefined)
        return unavailable(
          "the image has more than one RISC-V attribute section",
        );
      attributes = { offset: parsed.value.offset, size: parsed.value.size };
    }
  }
  if (attributes === undefined) return { status: "absent" };
  if (
    attributes.size === 0n ||
    attributes.size > BigInt(RISCV_ATTRIBUTES_MAX_BYTES)
  )
    return unavailable(
      `RISC-V attribute section size ${String(attributes.size)} is outside REA's inspected bound of ${RISCV_ATTRIBUTES_MAX_BYTES} bytes`,
    );
  if (attributes.offset > BigInt(fileSize) - attributes.size)
    return unavailable("RISC-V attribute section lies outside the file");
  const size = Number(attributes.size);
  const bytes = yield { offset: Number(attributes.offset), size };
  if (bytes.length !== size)
    return unavailable("truncated RISC-V attribute section");
  const arch = parseRiscvAttributes(bytes, little);
  if (!arch.ok) return unavailable(arch.error);
  return arch.value === null
    ? { status: "absent" }
    : riscvIsaDeclaration(arch.value);
}
