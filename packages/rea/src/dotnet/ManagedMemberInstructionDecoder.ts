import {
  metadataTokenFact,
  type MetadataTokenFact,
} from "./ManagedMetadataHeaps.js";
import type { ManagedDecodeBudget } from "./ManagedDecodeBudget.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";
import type {
  ManagedExceptionRegion,
  ManagedInstructionAnchor,
  ParsedInstruction,
} from "./ManagedMemberInspectorCore.js";

const PREFIX_OPCODES = new Set([
  "unaligned.",
  "volatile.",
  "tail.",
  "constrained.",
  "readonly.",
  "no.",
]);

const OPCODES = new Map<
  number,
  { readonly name: string; readonly operand: string }
>([
  [0x00, { name: "nop", operand: "none" }],
  [0x01, { name: "break", operand: "none" }],
  [0x02, { name: "ldarg.0", operand: "none" }],
  [0x03, { name: "ldarg.1", operand: "none" }],
  [0x04, { name: "ldarg.2", operand: "none" }],
  [0x05, { name: "ldarg.3", operand: "none" }],
  [0x06, { name: "ldloc.0", operand: "none" }],
  [0x07, { name: "ldloc.1", operand: "none" }],
  [0x08, { name: "ldloc.2", operand: "none" }],
  [0x09, { name: "ldloc.3", operand: "none" }],
  [0x0a, { name: "stloc.0", operand: "none" }],
  [0x0b, { name: "stloc.1", operand: "none" }],
  [0x0c, { name: "stloc.2", operand: "none" }],
  [0x0d, { name: "stloc.3", operand: "none" }],
  [0x0e, { name: "ldarg.s", operand: "short-var" }],
  [0x0f, { name: "ldarga.s", operand: "short-var" }],
  [0x10, { name: "starg.s", operand: "short-var" }],
  [0x11, { name: "ldloc.s", operand: "short-var" }],
  [0x12, { name: "ldloca.s", operand: "short-var" }],
  [0x13, { name: "stloc.s", operand: "short-var" }],
  [0x14, { name: "ldnull", operand: "none" }],
  [0x15, { name: "ldc.i4.m1", operand: "none" }],
  [0x16, { name: "ldc.i4.0", operand: "none" }],
  [0x17, { name: "ldc.i4.1", operand: "none" }],
  [0x18, { name: "ldc.i4.2", operand: "none" }],
  [0x19, { name: "ldc.i4.3", operand: "none" }],
  [0x1a, { name: "ldc.i4.4", operand: "none" }],
  [0x1b, { name: "ldc.i4.5", operand: "none" }],
  [0x1c, { name: "ldc.i4.6", operand: "none" }],
  [0x1d, { name: "ldc.i4.7", operand: "none" }],
  [0x1e, { name: "ldc.i4.8", operand: "none" }],
  [0x1f, { name: "ldc.i4.s", operand: "short-i" }],
  [0x20, { name: "ldc.i4", operand: "i" }],
  [0x21, { name: "ldc.i8", operand: "i8" }],
  [0x22, { name: "ldc.r4", operand: "r4" }],
  [0x23, { name: "ldc.r8", operand: "r8" }],
  [0x25, { name: "dup", operand: "none" }],
  [0x26, { name: "pop", operand: "none" }],
  [0x27, { name: "jmp", operand: "method" }],
  [0x28, { name: "call", operand: "method" }],
  [0x29, { name: "calli", operand: "signature" }],
  [0x2a, { name: "ret", operand: "none" }],
  [0x2b, { name: "br.s", operand: "short-branch" }],
  [0x2c, { name: "brfalse.s", operand: "short-branch" }],
  [0x2d, { name: "brtrue.s", operand: "short-branch" }],
  [0x2e, { name: "beq.s", operand: "short-branch" }],
  [0x2f, { name: "bge.s", operand: "short-branch" }],
  [0x30, { name: "bgt.s", operand: "short-branch" }],
  [0x31, { name: "ble.s", operand: "short-branch" }],
  [0x32, { name: "blt.s", operand: "short-branch" }],
  [0x33, { name: "bne.un.s", operand: "short-branch" }],
  [0x34, { name: "bge.un.s", operand: "short-branch" }],
  [0x35, { name: "bgt.un.s", operand: "short-branch" }],
  [0x36, { name: "ble.un.s", operand: "short-branch" }],
  [0x37, { name: "blt.un.s", operand: "short-branch" }],
  [0x38, { name: "br", operand: "branch" }],
  [0x39, { name: "brfalse", operand: "branch" }],
  [0x3a, { name: "brtrue", operand: "branch" }],
  [0x3b, { name: "beq", operand: "branch" }],
  [0x3c, { name: "bge", operand: "branch" }],
  [0x3d, { name: "bgt", operand: "branch" }],
  [0x3e, { name: "ble", operand: "branch" }],
  [0x3f, { name: "blt", operand: "branch" }],
  [0x40, { name: "bne.un", operand: "branch" }],
  [0x41, { name: "bge.un", operand: "branch" }],
  [0x42, { name: "bgt.un", operand: "branch" }],
  [0x43, { name: "ble.un", operand: "branch" }],
  [0x44, { name: "blt.un", operand: "branch" }],
  [0x45, { name: "switch", operand: "switch" }],
  [0x46, { name: "ldind.i1", operand: "none" }],
  [0x47, { name: "ldind.u1", operand: "none" }],
  [0x48, { name: "ldind.i2", operand: "none" }],
  [0x49, { name: "ldind.u2", operand: "none" }],
  [0x4a, { name: "ldind.i4", operand: "none" }],
  [0x4b, { name: "ldind.u4", operand: "none" }],
  [0x4c, { name: "ldind.i8", operand: "none" }],
  [0x4d, { name: "ldind.i", operand: "none" }],
  [0x4e, { name: "ldind.r4", operand: "none" }],
  [0x4f, { name: "ldind.r8", operand: "none" }],
  [0x50, { name: "ldind.ref", operand: "none" }],
  [0x51, { name: "stind.ref", operand: "none" }],
  [0x52, { name: "stind.i1", operand: "none" }],
  [0x53, { name: "stind.i2", operand: "none" }],
  [0x54, { name: "stind.i4", operand: "none" }],
  [0x55, { name: "stind.i8", operand: "none" }],
  [0x56, { name: "stind.r4", operand: "none" }],
  [0x57, { name: "stind.r8", operand: "none" }],
  [0x58, { name: "add", operand: "none" }],
  [0x59, { name: "sub", operand: "none" }],
  [0x5a, { name: "mul", operand: "none" }],
  [0x5b, { name: "div", operand: "none" }],
  [0x5c, { name: "div.un", operand: "none" }],
  [0x5d, { name: "rem", operand: "none" }],
  [0x5e, { name: "rem.un", operand: "none" }],
  [0x5f, { name: "and", operand: "none" }],
  [0x60, { name: "or", operand: "none" }],
  [0x61, { name: "xor", operand: "none" }],
  [0x62, { name: "shl", operand: "none" }],
  [0x63, { name: "shr", operand: "none" }],
  [0x64, { name: "shr.un", operand: "none" }],
  [0x65, { name: "neg", operand: "none" }],
  [0x66, { name: "not", operand: "none" }],
  [0x67, { name: "conv.i1", operand: "none" }],
  [0x68, { name: "conv.i2", operand: "none" }],
  [0x69, { name: "conv.i4", operand: "none" }],
  [0x6a, { name: "conv.i8", operand: "none" }],
  [0x6b, { name: "conv.r4", operand: "none" }],
  [0x6c, { name: "conv.r8", operand: "none" }],
  [0x6d, { name: "conv.u4", operand: "none" }],
  [0x6e, { name: "conv.u8", operand: "none" }],
  [0x6f, { name: "callvirt", operand: "method" }],
  [0x70, { name: "cpobj", operand: "type" }],
  [0x71, { name: "ldobj", operand: "type" }],
  [0x72, { name: "ldstr", operand: "string" }],
  [0x73, { name: "newobj", operand: "method" }],
  [0x74, { name: "castclass", operand: "type" }],
  [0x75, { name: "isinst", operand: "type" }],
  [0x76, { name: "conv.r.un", operand: "none" }],
  [0x79, { name: "unbox", operand: "type" }],
  [0x7a, { name: "throw", operand: "none" }],
  [0x7b, { name: "ldfld", operand: "field" }],
  [0x7c, { name: "ldflda", operand: "field" }],
  [0x7d, { name: "stfld", operand: "field" }],
  [0x7e, { name: "ldsfld", operand: "field" }],
  [0x7f, { name: "ldsflda", operand: "field" }],
  [0x80, { name: "stsfld", operand: "field" }],
  [0x81, { name: "stobj", operand: "type" }],
  [0x82, { name: "conv.ovf.i1.un", operand: "none" }],
  [0x83, { name: "conv.ovf.i2.un", operand: "none" }],
  [0x84, { name: "conv.ovf.i4.un", operand: "none" }],
  [0x85, { name: "conv.ovf.i8.un", operand: "none" }],
  [0x86, { name: "conv.ovf.u1.un", operand: "none" }],
  [0x87, { name: "conv.ovf.u2.un", operand: "none" }],
  [0x88, { name: "conv.ovf.u4.un", operand: "none" }],
  [0x89, { name: "conv.ovf.u8.un", operand: "none" }],
  [0x8a, { name: "conv.ovf.i.un", operand: "none" }],
  [0x8b, { name: "conv.ovf.u.un", operand: "none" }],
  [0x8c, { name: "box", operand: "type" }],
  [0x8d, { name: "newarr", operand: "type" }],
  [0x8e, { name: "ldlen", operand: "none" }],
  [0x8f, { name: "ldelema", operand: "type" }],
  [0x90, { name: "ldelem.i1", operand: "none" }],
  [0x91, { name: "ldelem.u1", operand: "none" }],
  [0x92, { name: "ldelem.i2", operand: "none" }],
  [0x93, { name: "ldelem.u2", operand: "none" }],
  [0x94, { name: "ldelem.i4", operand: "none" }],
  [0x95, { name: "ldelem.u4", operand: "none" }],
  [0x96, { name: "ldelem.i8", operand: "none" }],
  [0x97, { name: "ldelem.i", operand: "none" }],
  [0x98, { name: "ldelem.r4", operand: "none" }],
  [0x99, { name: "ldelem.r8", operand: "none" }],
  [0x9a, { name: "ldelem.ref", operand: "none" }],
  [0x9b, { name: "stelem.i", operand: "none" }],
  [0x9c, { name: "stelem.i1", operand: "none" }],
  [0x9d, { name: "stelem.i2", operand: "none" }],
  [0x9e, { name: "stelem.i4", operand: "none" }],
  [0x9f, { name: "stelem.i8", operand: "none" }],
  [0xa0, { name: "stelem.r4", operand: "none" }],
  [0xa1, { name: "stelem.r8", operand: "none" }],
  [0xa2, { name: "stelem.ref", operand: "none" }],
  [0xa3, { name: "ldelem", operand: "type" }],
  [0xa4, { name: "stelem", operand: "type" }],
  [0xa5, { name: "unbox.any", operand: "type" }],
  [0xb3, { name: "conv.ovf.i1", operand: "none" }],
  [0xb4, { name: "conv.ovf.u1", operand: "none" }],
  [0xb5, { name: "conv.ovf.i2", operand: "none" }],
  [0xb6, { name: "conv.ovf.u2", operand: "none" }],
  [0xb7, { name: "conv.ovf.i4", operand: "none" }],
  [0xb8, { name: "conv.ovf.u4", operand: "none" }],
  [0xb9, { name: "conv.ovf.i8", operand: "none" }],
  [0xba, { name: "conv.ovf.u8", operand: "none" }],
  [0xc2, { name: "refanyval", operand: "type" }],
  [0xc3, { name: "ckfinite", operand: "none" }],
  [0xc6, { name: "mkrefany", operand: "type" }],
  [0xd0, { name: "ldtoken", operand: "token" }],
  [0xd1, { name: "conv.u2", operand: "none" }],
  [0xd2, { name: "conv.u1", operand: "none" }],
  [0xd3, { name: "conv.i", operand: "none" }],
  [0xd4, { name: "conv.ovf.i", operand: "none" }],
  [0xd5, { name: "conv.ovf.u", operand: "none" }],
  [0xd6, { name: "add.ovf", operand: "none" }],
  [0xd7, { name: "add.ovf.un", operand: "none" }],
  [0xd8, { name: "mul.ovf", operand: "none" }],
  [0xd9, { name: "mul.ovf.un", operand: "none" }],
  [0xda, { name: "sub.ovf", operand: "none" }],
  [0xdb, { name: "sub.ovf.un", operand: "none" }],
  [0xdc, { name: "endfinally", operand: "none" }],
  [0xdd, { name: "leave", operand: "branch" }],
  [0xde, { name: "leave.s", operand: "short-branch" }],
  [0xdf, { name: "stind.i", operand: "none" }],
  [0xe0, { name: "conv.u", operand: "none" }],
  [0xfe00, { name: "arglist", operand: "none" }],
  [0xfe01, { name: "ceq", operand: "none" }],
  [0xfe02, { name: "cgt", operand: "none" }],
  [0xfe03, { name: "cgt.un", operand: "none" }],
  [0xfe04, { name: "clt", operand: "none" }],
  [0xfe05, { name: "clt.un", operand: "none" }],
  [0xfe06, { name: "ldftn", operand: "method" }],
  [0xfe07, { name: "ldvirtftn", operand: "method" }],
  [0xfe09, { name: "ldarg", operand: "var" }],
  [0xfe0a, { name: "ldarga", operand: "var" }],
  [0xfe0b, { name: "starg", operand: "var" }],
  [0xfe0c, { name: "ldloc", operand: "var" }],
  [0xfe0d, { name: "ldloca", operand: "var" }],
  [0xfe0e, { name: "stloc", operand: "var" }],
  [0xfe0f, { name: "localloc", operand: "none" }],
  [0xfe11, { name: "endfilter", operand: "none" }],
  [0xfe12, { name: "unaligned.", operand: "short-i" }],
  [0xfe13, { name: "volatile.", operand: "none" }],
  [0xfe14, { name: "tail.", operand: "none" }],
  [0xfe15, { name: "initobj", operand: "type" }],
  [0xfe16, { name: "constrained.", operand: "type" }],
  [0xfe17, { name: "cpblk", operand: "none" }],
  [0xfe18, { name: "initblk", operand: "none" }],
  [0xfe19, { name: "no.", operand: "short-i" }],
  [0xfe1a, { name: "rethrow", operand: "none" }],
  [0xfe1c, { name: "sizeof", operand: "type" }],
  [0xfe1d, { name: "refanytype", operand: "none" }],
  [0xfe1e, { name: "readonly.", operand: "none" }],
]);

const tokenKind = (table: number): ManagedInstructionAnchor["operand_kind"] => {
  if (table === 6 || table === 0x2b) return "method";
  if (table === 4) return "field";
  if (table === 0x70) return "string";
  if (table === 0x11) return "signature";
  // MemberRefs need their signature to distinguish methods from fields.
  if (table === 0x0a) return "token";
  if (table === 1 || table === 2 || table === 0x1b) return "type";
  return "token";
};

type OperandResult = {
  readonly next: number;
  readonly anchorKind: ManagedInstructionAnchor["operand_kind"];
  readonly value: string | null;
  readonly reference?: MetadataTokenFact;
};

type OperandReader = (il: Buffer, offset: number) => OperandResult;

// String(-0) loses a CIL constant's sign in both anchors and normalized hashes.
const floatingPointOperand = (value: number): string =>
  Object.is(value, -0) ? "-0" : String(value);

/**
 * A fixed-width operand declares its byte width next to its reader so the
 * extent check can bound the read before any value is consumed. Keeping both
 * facts in one entry is what stops the width and the reader from drifting.
 */
type FixedOperand = {
  readonly width: number;
  readonly read: OperandReader;
};

const fixed = (width: number, read: OperandReader): FixedOperand => ({
  width,
  read,
});

const FIXED_OPERAND_READERS = new Map<string, FixedOperand>([
  [
    "none",
    fixed(0, (_il, offset) => ({
      next: offset,
      anchorKind: "none",
      value: null,
    })),
  ],
  [
    "short-var",
    fixed(1, (il, offset) => ({
      next: offset + 1,
      anchorKind: "variable",
      value: String(il.readUInt8(offset)),
    })),
  ],
  [
    "var",
    fixed(2, (il, offset) => ({
      next: offset + 2,
      anchorKind: "variable",
      value: String(il.readUInt16LE(offset)),
    })),
  ],
  [
    "short-i",
    fixed(1, (il, offset) => ({
      next: offset + 1,
      anchorKind: "constant",
      value: String(il.readInt8(offset)),
    })),
  ],
  [
    "i",
    fixed(4, (il, offset) => ({
      next: offset + 4,
      anchorKind: "constant",
      value: String(il.readInt32LE(offset)),
    })),
  ],
  [
    "i8",
    fixed(8, (il, offset) => ({
      next: offset + 8,
      anchorKind: "constant",
      value: il.readBigInt64LE(offset).toString(),
    })),
  ],
  [
    "r4",
    fixed(4, (il, offset) => ({
      next: offset + 4,
      anchorKind: "constant",
      value: floatingPointOperand(il.readFloatLE(offset)),
    })),
  ],
  [
    "r8",
    fixed(8, (il, offset) => ({
      next: offset + 8,
      anchorKind: "constant",
      value: floatingPointOperand(il.readDoubleLE(offset)),
    })),
  ],
  [
    "short-branch",
    fixed(1, (il, offset) => ({
      next: offset + 1,
      anchorKind: "branch",
      value: String(offset + 1 + il.readInt8(offset)),
    })),
  ],
  [
    "branch",
    fixed(4, (il, offset) => ({
      next: offset + 4,
      anchorKind: "branch",
      value: String(offset + 4 + il.readInt32LE(offset)),
    })),
  ],
]);

const TOKEN_OPERAND_KINDS = new Map<
  string,
  ManagedInstructionAnchor["operand_kind"]
>([
  ["method", "method"],
  ["field", "field"],
  ["type", "type"],
  ["string", "string"],
  ["signature", "signature"],
]);

/** Every token operand is a 4-byte metadata token. */
const TOKEN_OPERAND_WIDTH = 4;

/**
 * Bytes the operand at `offset` occupies, or `null` when the extent itself
 * cannot be read from `il`. This is the single extent authority: `readOperand`
 * must never be called for an operand whose extent it cannot bound, so no
 * operand read can leave the method body.
 */
const operandExtent = (
  il: Buffer,
  offset: number,
  kind: string,
): number | null => {
  const fixedOperand = FIXED_OPERAND_READERS.get(kind);
  if (fixedOperand !== undefined) return fixedOperand.width;
  if (kind === "switch") {
    if (offset > il.length - 4) return null;
    return 4 + il.readUInt32LE(offset) * 4;
  }
  return TOKEN_OPERAND_KINDS.has(kind) || kind === "token"
    ? TOKEN_OPERAND_WIDTH
    : 0;
};

/**
 * Read an operand whose extent is already known to fit. `next` is always
 * `offset + operandExtent(il, offset, kind)`; callers bound the read first.
 */
const readOperand = (
  il: Buffer,
  offset: number,
  kind: string,
  memberRefKind?: (token: string) => "field" | "method" | undefined,
): OperandResult => {
  const fixedOperand = FIXED_OPERAND_READERS.get(kind);
  if (fixedOperand !== undefined) return fixedOperand.read(il, offset);
  if (kind === "switch") {
    const count = il.readUInt32LE(offset);
    return {
      next: offset + 4 + count * 4,
      anchorKind: "switch",
      value: String(count),
    };
  }
  if (!TOKEN_OPERAND_KINDS.has(kind) && kind !== "token")
    return { next: offset, anchorKind: "unknown", value: null };
  const reference = metadataTokenFact(il.readUInt32LE(offset));
  const { token } = reference;
  return {
    next: offset + TOKEN_OPERAND_WIDTH,
    anchorKind:
      TOKEN_OPERAND_KINDS.get(kind) ??
      (kind === "token" ? memberRefKind?.(token) : undefined) ??
      tokenKind(reference.table),
    value: token,
    reference,
  };
};

export const decodeInstructions = (
  il: Buffer,
  admitInstruction?: (offset: number, hasReference: boolean) => void,
  memberRefKind?: (token: string) => "field" | "method" | undefined,
): {
  readonly parsed: readonly ParsedInstruction[];
  readonly instructionStarts: readonly number[];
  readonly count: number;
  readonly truncated: number;
  readonly issue: string | null;
} => {
  const parsed: ParsedInstruction[] = [];
  const instructionStarts: number[] = [];
  let offset = 0;
  let prefixStart: number | null = null;
  let issue: string | null = null;
  try {
    while (offset < il.length) {
      const start = offset;
      const first = il.readUInt8(offset);
      offset += 1;
      if (first === 0xfe && offset >= il.length) {
        issue = `Two-byte CIL opcode at IL offset ${String(start)} leaves method body`;
        break;
      }
      const code = first === 0xfe ? 0xfe00 + il.readUInt8(offset++) : first;
      const descriptor = OPCODES.get(code);
      if (descriptor === undefined) {
        issue = `Unsupported CIL opcode 0x${code.toString(16)} at IL offset ${String(start)}`;
        break;
      }
      // Bound the operand extent before reading its value. Reading first would
      // throw a raw Buffer RangeError out of a truncated body and replace this
      // diagnostic with the runtime message, losing the instruction identity.
      const extent = operandExtent(il, offset, descriptor.operand);
      if (extent === null || offset + extent > il.length) {
        issue = `Instruction ${descriptor.name} at IL offset ${String(start)} leaves method body`;
        break;
      }
      // The extent is admitted; bound transient records before allocating token facts.
      admitInstruction?.(
        start,
        TOKEN_OPERAND_KINDS.has(descriptor.operand) ||
          descriptor.operand === "token",
      );
      const operand = readOperand(
        il,
        offset,
        descriptor.operand,
        memberRefKind,
      );
      offset = operand.next;
      if (PREFIX_OPCODES.has(descriptor.name)) {
        prefixStart ??= start;
      } else {
        instructionStarts.push(prefixStart ?? start);
        prefixStart = null;
      }
      parsed.push({
        offset: start,
        opcode: descriptor.name,
        operandKind: operand.anchorKind,
        operand: operand.value,
        reference: operand.reference ?? null,
      });
    }
  } catch (cause: unknown) {
    if (cause instanceof ManagedReaderFailure) throw cause;
    issue =
      cause instanceof Error ? cause.message : "Instruction decode failed";
  }
  if (issue === null && prefixStart !== null)
    issue = `CIL prefix chain at IL offset ${String(prefixStart)} has no following instruction`;
  const truncated = offset < il.length && issue === null ? 1 : 0;
  return { parsed, instructionStarts, count: parsed.length, truncated, issue };
};

export const parseExceptionRegions = (
  bytes: Buffer,
  offset: number,
  methodEnd: number,
  budget?: ManagedDecodeBudget,
): ExceptionRegionParseResult => {
  const regions: ManagedExceptionRegion[] = [];
  const catchTokens = new Map<number, MetadataTokenFact>();
  let sectionOffset = offset;
  let hasMoreSections = true;
  while (hasMoreSections) {
    if (
      !Number.isSafeInteger(sectionOffset) ||
      sectionOffset < 0 ||
      sectionOffset > methodEnd - 4 ||
      sectionOffset > bytes.length - 4
    )
      return malformedExceptionRegions(
        "Exception section header leaves artifact",
        regions,
        catchTokens,
      );

    const kind = bytes.readUInt8(sectionOffset);
    if ((kind & 0x3f) !== 1)
      return malformedExceptionRegions(
        `Unsupported method data section kind ${String(kind & 0x3f)}`,
        regions,
        catchTokens,
      );
    const fat = (kind & 0x40) !== 0;
    const size = fat
      ? bytes.readUInt8(sectionOffset + 1) |
        (bytes.readUInt8(sectionOffset + 2) << 8) |
        (bytes.readUInt8(sectionOffset + 3) << 16)
      : bytes.readUInt8(sectionOffset + 1);
    const clauseSize = fat ? 24 : 12;
    if (
      size < 4 ||
      sectionOffset > methodEnd - size ||
      sectionOffset > bytes.length - size
    )
      return malformedExceptionRegions(
        "Exception section size leaves artifact",
        regions,
        catchTokens,
      );
    let count: number;
    let sectionSize = size;
    if (fat) {
      if ((size - 4) % clauseSize !== 0)
        return malformedExceptionRegions(
          "Exception section size does not contain whole clauses",
          regions,
          catchTokens,
        );
      count = (size - 4) / clauseSize;
    } else if ((size - 4) % clauseSize === 0) {
      count = (size - 4) / clauseSize;
    } else if (size >= clauseSize && size % clauseSize === 0) {
      // CoreCLR accommodates legacy VB/MC++ sections whose DataSize omits the
      // four-byte section header. DataSize is still not the physical extent.
      count = size / clauseSize;
      sectionSize = 4 + count * clauseSize;
    } else {
      return malformedExceptionRegions(
        "Exception section size does not contain whole clauses",
        regions,
        catchTokens,
      );
    }
    if (
      sectionOffset > methodEnd - sectionSize ||
      sectionOffset > bytes.length - sectionSize
    )
      return malformedExceptionRegions(
        "Exception section size leaves artifact",
        regions,
        catchTokens,
      );
    if (
      !fat &&
      (bytes[sectionOffset + 2] !== 0 || bytes[sectionOffset + 3] !== 0)
    )
      return malformedExceptionRegions(
        "Small exception section reserved bytes are nonzero",
        regions,
        catchTokens,
      );

    // Accumulates with the method IL bound; the body reserves what it retains.
    budget?.admitTransient(count * 256, sectionOffset);
    for (const region of readExceptionClauses(
      bytes,
      { start: sectionOffset + 4, count, fat, budget },
      catchTokens,
      regions.length,
    ))
      regions.push(region);

    hasMoreSections = (kind & 0x80) !== 0;
    sectionOffset += sectionSize;
  }
  return { status: "complete", regions, catchTokens };
};

export type ExceptionRegionParseResult =
  | {
      readonly status: "complete";
      readonly regions: ManagedExceptionRegion[];
      readonly catchTokens: ReadonlyMap<number, MetadataTokenFact>;
    }
  | {
      readonly status: "malformed";
      readonly regions: ManagedExceptionRegion[];
      readonly catchTokens: ReadonlyMap<number, MetadataTokenFact>;
      readonly issue: string;
    };

const malformedExceptionRegions = (
  issue: string,
  regions: ManagedExceptionRegion[],
  catchTokens: ReadonlyMap<number, MetadataTokenFact>,
): ExceptionRegionParseResult => ({
  status: "malformed",
  regions,
  catchTokens,
  issue,
});

const readExceptionClauses = (
  bytes: Buffer,
  {
    start,
    count,
    fat,
    budget,
  }: {
    readonly start: number;
    readonly count: number;
    readonly fat: boolean;
    readonly budget: ManagedDecodeBudget | undefined;
  },
  catchTokens: Map<number, MetadataTokenFact>,
  firstOrdinal: number,
): ManagedExceptionRegion[] => {
  const regions: ManagedExceptionRegion[] = [];
  const clauseSize = fat ? 24 : 12;
  for (let index = 0; index < count; index += 1) {
    const clause = start + index * clauseSize;
    const flags = fat ? bytes.readUInt32LE(clause) : bytes.readUInt16LE(clause);
    const extra = bytes.readUInt32LE(clause + (fat ? 20 : 8));
    if (flags === 0) budget?.admitTransient(256, clause);
    const reference = flags === 0 ? metadataTokenFact(extra) : null;
    if (reference !== null) catchTokens.set(firstOrdinal + index, reference);
    regions.push({
      flags,
      try_offset: fat
        ? bytes.readUInt32LE(clause + 4)
        : bytes.readUInt16LE(clause + 2),
      try_length: fat
        ? bytes.readUInt32LE(clause + 8)
        : bytes.readUInt8(clause + 4),
      handler_offset: fat
        ? bytes.readUInt32LE(clause + 12)
        : bytes.readUInt16LE(clause + 5),
      handler_length: fat
        ? bytes.readUInt32LE(clause + 16)
        : bytes.readUInt8(clause + 7),
      class_token: reference?.token ?? null,
      class_type: null,
      class_type_name_sha256: null,
      class_type_identity_resolved: null,
      filter_offset: flags === 1 ? extra : null,
    });
  }
  return regions;
};
