import { observePythonBytecodePrefix } from "../domain/python/pythonBytecodeIdentity.js";
import { createHash } from "node:crypto";
import { decodeMarshalUtf8 } from "../domain/python/marshalUtf8.js";
import {
  PYTHON_PYC_CHECK_SOURCE,
  PYTHON_PYC_CONST_PREVIEW_LIMIT,
  PYTHON_PYC_HASH_BASED,
  PYTHON_PYC_HEADER_BYTES,
  PYTHON_PYC_INT_PREVIEW_BITS,
  pythonPycMarshalProfile,
  type InspectPythonPycInput,
  type PythonPyc,
  type PythonPycCodeLayout,
  type PythonPycCodeObject,
  type PythonPycConst,
} from "../domain/python/pythonPyc.js";
import {
  PythonPycFormatFailure,
  PythonPycResourceFailure,
} from "./PythonPyc.errors.js";
import { pythonPycBytecodeIdentity } from "./PythonPycBytecodeEquality.js";

const FLAG_REF = 0x80;
const TYPE_NULL = 0x30;
const TYPE_NONE = 0x4e;
const TYPE_FALSE = 0x46;
const TYPE_TRUE = 0x54;
const TYPE_STOPITER = 0x53;
const TYPE_ELLIPSIS = 0x2e;
const TYPE_INT = 0x69;
const TYPE_INT64 = 0x49;
const TYPE_FLOAT_TEXT = 0x66;
const TYPE_FLOAT = 0x67;
const TYPE_COMPLEX_TEXT = 0x78;
const TYPE_COMPLEX = 0x79;
const TYPE_LONG = 0x6c;
const TYPE_BYTES = 0x73;
const TYPE_INTERNED = 0x74;
const TYPE_REF = 0x72;
const TYPE_TUPLE = 0x28;
const TYPE_LIST = 0x5b;
const TYPE_DICT = 0x7b;
const TYPE_CODE = 0x63;
const TYPE_UNICODE = 0x75;
const TYPE_SET = 0x3c;
const TYPE_FROZENSET = 0x3e;
const TYPE_ASCII = 0x61;
const TYPE_ASCII_INTERNED = 0x41;
const TYPE_SMALL_TUPLE = 0x29;
const TYPE_SHORT_ASCII = 0x7a;
const TYPE_SHORT_ASCII_INTERNED = 0x5a;
const TYPES_WITHOUT_REFERENCE_SLOTS = new Set([
  TYPE_NULL,
  TYPE_NONE,
  TYPE_FALSE,
  TYPE_TRUE,
  TYPE_STOPITER,
  TYPE_ELLIPSIS,
]);
/** CPython `CO_VARARGS` / `CO_VARKEYWORDS`. Each consumes one local name. */
const CO_VARARGS = 0x04;
const CO_VARKEYWORDS = 0x08;
/** CPython 3.7–3.10 derives this bit from the free/cell variable tables. */
const CO_NOFREE = 0x40;
/** CPython `_PyLocals_Kind` bit counted by `_PyCode_Validate` as a local. */
const CO_FAST_LOCAL = 0x20;

type MarshalValue =
  | { readonly kind: "null" }
  | { readonly kind: "none" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "ellipsis" }
  | { readonly kind: "stopiter" }
  | { readonly kind: "int"; readonly value: bigint; readonly bits: number }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "complex"; readonly real: number; readonly imag: number }
  | { readonly kind: "bytes"; readonly value: Buffer }
  | {
      readonly kind: "str";
      readonly value: string;
      readonly bytes: number;
      /** Marshal bytes. JavaScript strings merge lone surrogates with pairs. */
      readonly raw: Buffer;
      readonly previewEnd: number;
    }
  | { readonly kind: "tuple"; readonly items: MarshalValue[] }
  | { readonly kind: "list"; readonly items: MarshalValue[] }
  | { readonly kind: "set"; readonly items: MarshalValue[] }
  | { readonly kind: "frozenset"; readonly items: MarshalValue[] }
  | {
      readonly kind: "dict";
      readonly items: [MarshalValue, MarshalValue][];
    }
  | { readonly kind: "code"; readonly value: CodeNode };

/**
 * A decoded code object. `consts` and `nested` stay empty until the marshal
 * graph is complete: a container can refer to itself before its items exist.
 * TYPE_REF children are the same node, not copies.
 */
type CodeNode = Omit<PythonPycCodeObject, "nested_code" | "consts"> & {
  consts: PythonPycConst[];
  nested: CodeNode[];
};

const EMPTY_CODES: readonly CodeNode[] = [];

type KeyMode = "hash" | "const";

/**
 * Equality token plus the size of the expanded CPython-style key.
 * Container tokens are interned so a reference chain does not copy every
 * ancestor into the next string. `expanded` is still the size that string
 * would have, so a repeated child cannot double without bound.
 */
type ResolvedKey = {
  readonly token: string;
  readonly expanded: number;
};

type KeyFrame = {
  value: MarshalValue;
  index: number;
  parts: string[];
  expanded: number[];
  failed: boolean;
};

const isContainer = (value: MarshalValue): boolean =>
  value.kind === "tuple" ||
  value.kind === "list" ||
  value.kind === "set" ||
  value.kind === "frozenset" ||
  value.kind === "dict";

const containerChildren = (value: MarshalValue): readonly MarshalValue[] => {
  if (value.kind === "dict") {
    const children: MarshalValue[] = [];
    for (const [key, mapped] of value.items) children.push(key, mapped);
    return children;
  }
  if (
    value.kind === "tuple" ||
    value.kind === "list" ||
    value.kind === "set" ||
    value.kind === "frozenset"
  )
    return value.items;
  return [];
};

/**
 * Fields CPython uses for code equality that the public report does not keep.
 * `consts` stays the decoded graph so a code key can follow Python's rules
 * without rebuilding marshal text.
 */
type CodeEquality = {
  readonly consts: readonly MarshalValue[];
  /** The co_consts tuple itself, which may be a reference to an unfinished tuple. */
  readonly constsTuple: MarshalValue;
  readonly effectiveFlags: number;
  readonly bytecode: Buffer;
  readonly name: Buffer;
  readonly nameTables: readonly (readonly Buffer[])[];
  readonly linetable: string;
  readonly exceptiontable: string;
};

type NameTable = {
  readonly display: string[];
  readonly equality: Buffer[];
};

const malformed = (message: string): never => {
  throw new PythonPycFormatFailure("malformed", message);
};

/** Locals CPython's 3.11+ validator counts toward `co_varnames`. */
const fastLocalCount = (kinds: Buffer): number => {
  let count = 0;
  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index] ?? 0;
    if ((kind & CO_FAST_LOCAL) !== 0) count += 1;
  }
  return count;
};

const unsupported = (message: string): never => {
  throw new PythonPycFormatFailure("unsupported", message);
};

const digests = new WeakMap<Buffer, string>();
const sha256 = (bytes: Buffer): string => {
  const cached = digests.get(bytes);
  if (cached !== undefined) return cached;
  const digest = createHash("sha256").update(bytes).digest("hex");
  digests.set(bytes, digest);
  return digest;
};

/** Decode one bounded CPython 3.7–3.13 pyc without executing bytecode. */
export const parsePythonPyc = (
  bytes: Buffer,
  artifact: { path: string; sha256: string; bytes: number },
  input: InspectPythonPycInput,
): PythonPyc => {
  if (bytes.length !== artifact.bytes)
    malformed("Selected artifact length disagrees with the retained bytes.");
  const prefix = observePythonBytecodePrefix(bytes);
  if (prefix.state === "incomplete")
    return malformed("Selected file is shorter than a pyc magic.");
  if (prefix.state === "invalid-crlf")
    return malformed(
      "Pyc magic is not a little-endian integer followed by CR LF.",
    );
  const { magic, identity } = prefix;
  const mapped = pythonPycMarshalProfile(magic);
  if (identity !== null && identity.headerBytes !== PYTHON_PYC_HEADER_BYTES)
    return unsupported(
      `Pyc magic ${magic} uses an unsupported ${identity.headerBytes}-byte CPython header.`,
    );
  if (bytes.length < PYTHON_PYC_HEADER_BYTES)
    malformed(
      "Selected file is shorter than a 16-byte CPython 3.7+ pyc header.",
    );
  if (mapped === null || identity === null)
    return unsupported(
      `Pyc magic ${magic} is outside the pinned CPython 3.7–3.13 table.`,
    );
  const flags = bytes.readUInt32LE(4);
  const hashBased = (flags & PYTHON_PYC_HASH_BASED) !== 0;
  const header = {
    magic,
    python_version: identity.pythonVersion,
    code_layout: mapped.code_layout,
    flags,
    hash_based: hashBased,
    check_source: (flags & PYTHON_PYC_CHECK_SOURCE) !== 0,
    source_hash_hex: hashBased ? bytes.subarray(8, 16).toString("hex") : null,
    source_mtime: hashBased ? null : bytes.readUInt32LE(8),
    source_size: hashBased ? null : bytes.readUInt32LE(12),
  };
  const marshal = bytes.subarray(PYTHON_PYC_HEADER_BYTES);
  const reader = new MarshalReader(
    marshal,
    mapped.code_layout,
    magic,
    input,
    mapped.negative_code_fields === "rejected",
  );
  const root = reader.readObject(0);
  if (reader.offset !== marshal.length)
    malformed("Marshal stream has trailing bytes after the top-level object.");
  if (root.kind !== "code")
    return malformed("Top-level marshal object is not a code object.");
  reader.finishCodes();
  const codeObjects = flattenCode(root.value);
  const unknownFlags =
    flags & ~(PYTHON_PYC_HASH_BASED | PYTHON_PYC_CHECK_SOURCE);
  return {
    artifact: {
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    },
    header,
    code_objects: codeObjects,
    coverage: {
      status: "complete",
      objects: reader.objects,
      code_objects: codeObjects.length,
      marshal_bytes: marshal.length,
      marshal_depth: reader.depthReached,
    },
    limitations: [
      "Bytecode is retained as length and SHA-256 only; this workflow does not decompile, disassemble, or recover source.",
      "The selected file is not executed and CPython is not invoked.",
      hashBased
        ? "source_hash_hex is the PEP 552 header field; the original .py is not read."
        : "source_mtime and source_size are header fields; they do not prove a matching .py is present.",
      "python_version is the pinned CPython magic table for this header, not a runtime interpreter.",
      ...(mapped.negative_code_fields === "revision-dependent" &&
      codeObjects.some((code) => code.stacksize < 0 || code.flags < 0)
        ? [
            "Magic 3410 is shared by CPython revisions with different negative co_stacksize/co_flags constructor checks; these raw values are preserved, but this header cannot establish constructor acceptance.",
          ]
        : []),
      ...(unknownFlags === 0
        ? []
        : [
            `Header flags ${flags} include unrecognized bits; only hash-based and check-source bits are decoded.`,
          ]),
    ],
  };
};

class MarshalReader {
  offset = 0;
  objects = 0;
  depthReached = 0;
  readonly #intern: (MarshalValue | undefined)[] = [];
  /** Name and identifier bytes the report carries across all code objects. */
  #reportedStringBytes = 0;
  /** Const summaries the report copies, including tables shared by TYPE_REF. */
  #reportedConsts = 0;
  /** Bytes of hash-key descriptors materialized for set and dict rules. */
  #keyBytes = 0;
  /** Identity keys for NaN values, which are not equal to themselves. */
  readonly #identities = new WeakMap<MarshalValue, number>();
  #identityNext = 0;
  /** One Python equality key per object. Null means the value is unhashable. */
  readonly #keyCache = new WeakMap<MarshalValue, ResolvedKey | null>();
  /** Constant keys keep signed zeroes distinct and give cycles an identity. */
  readonly #constCache = new WeakMap<MarshalValue, ResolvedKey>();
  /** Interned descriptors so equal values share one token within this walk. */
  readonly #keyTokens = new Map<string, string>();
  #keyTokenNext = 0;
  /** Explicit key-walk steps. Stream `max_depth` does not bound reference chains. */
  #keySteps = 0;
  /** One code-equality key per code object. Empty while that key is in progress. */
  readonly #codeKeys = new WeakMap<CodeNode, string>();
  readonly #codeIdentities = new WeakMap<CodeNode, number>();
  readonly #codeEquality = new WeakMap<CodeNode, CodeEquality>();
  /** Python hashability per code object. False while that check is in progress. */
  readonly #codeHashable = new WeakMap<CodeNode, boolean>();
  /** Tuples whose items are still being read; CPython cannot hash them yet. */
  readonly #readingTuples = new WeakSet<MarshalValue>();
  /** Code objects whose const summaries wait until the graph is fully decoded. */
  readonly #codes: CodeNode[] = [];
  /**
   * Nested code objects reached from one container. Pure wrappers store the
   * child's array; fresh arrays are counted so copies cannot grow without a
   * bound. Absent while a container is still on the explicit walk stack.
   */
  readonly #nestedCache = new WeakMap<MarshalValue, readonly CodeNode[]>();
  #nestedSteps = 0;
  #nestedRetained = 0;

  constructor(
    readonly bytes: Buffer,
    readonly layout: PythonPycCodeLayout,
    readonly magic: number,
    readonly input: InspectPythonPycInput,
    readonly rejectNegativeCodeFields: boolean,
  ) {}

  readObject(depth: number): MarshalValue {
    this.objects += 1;
    if (this.objects > this.input.max_objects)
      throw new PythonPycResourceFailure(
        "objects",
        { max_objects: this.input.max_objects },
        `Marshal object count exceeds max_objects ${this.input.max_objects}.`,
      );
    if (depth > this.input.max_depth)
      throw new PythonPycResourceFailure(
        "depth",
        { max_depth: this.input.max_depth },
        `Marshal nesting exceeds max_depth ${this.input.max_depth}.`,
      );
    this.depthReached = Math.max(this.depthReached, depth);
    const raw = this.u8();
    const flagged = (raw & FLAG_REF) !== 0;
    const type = raw & ~FLAG_REF;
    // CPython masks FLAG_REF before dispatch; TYPE_REF returns its existing
    // slot directly, and singleton tags bypass reference registration.
    if (type === TYPE_REF) return this.readRef();
    const slot =
      flagged && !TYPES_WITHOUT_REFERENCE_SLOTS.has(type)
        ? this.#intern.length
        : undefined;
    if (slot !== undefined) this.#intern.push(undefined);
    const value = this.readTyped(type, depth, slot);
    if (slot !== undefined && this.#intern[slot] === undefined)
      this.#intern[slot] = value;
    return value;
  }

  readTyped(
    type: number,
    depth: number,
    slot: number | undefined,
  ): MarshalValue {
    switch (type) {
      case TYPE_NULL:
        return { kind: "null" };
      case TYPE_NONE:
        return { kind: "none" };
      case TYPE_FALSE:
        return { kind: "bool", value: false };
      case TYPE_TRUE:
        return { kind: "bool", value: true };
      case TYPE_STOPITER:
        return { kind: "stopiter" };
      case TYPE_ELLIPSIS:
        return { kind: "ellipsis" };
      case TYPE_INT: {
        const value = BigInt(this.i32());
        return { kind: "int", value, bits: smallBitLength(value) };
      }
      case TYPE_INT64: {
        const value = this.i64();
        return { kind: "int", value, bits: smallBitLength(value) };
      }
      case TYPE_FLOAT_TEXT:
        return { kind: "float", value: this.textFloat() };
      case TYPE_FLOAT:
        return { kind: "float", value: this.f64() };
      case TYPE_COMPLEX_TEXT:
        return {
          kind: "complex",
          real: this.textFloat(),
          imag: this.textFloat(),
        };
      case TYPE_COMPLEX:
        return { kind: "complex", real: this.f64(), imag: this.f64() };
      case TYPE_LONG: {
        const decoded = this.long();
        return { kind: "int", value: decoded.value, bits: decoded.bits };
      }
      case TYPE_BYTES:
        return {
          kind: "bytes",
          value: this.blob(this.nonNegativeInt32("Marshal string length")),
        };
      case TYPE_INTERNED:
      case TYPE_UNICODE:
        return this.utf8(this.nonNegativeInt32("Marshal string length"), false);
      case TYPE_ASCII:
      case TYPE_ASCII_INTERNED:
        return this.utf8(this.nonNegativeInt32("Marshal string length"), true);
      case TYPE_SHORT_ASCII:
      case TYPE_SHORT_ASCII_INTERNED:
        return this.utf8(this.u8(), true);
      case TYPE_TUPLE:
        return this.sequenceValue(
          "tuple",
          this.nonNegativeInt32("Marshal tuple length"),
          depth,
          slot,
        );
      case TYPE_SMALL_TUPLE:
        return this.sequenceValue("tuple", this.u8(), depth, slot);
      case TYPE_LIST:
        return this.sequenceValue(
          "list",
          this.nonNegativeInt32("Marshal list length"),
          depth,
          slot,
        );
      case TYPE_SET:
        return this.setValue(
          "set",
          this.nonNegativeInt32("Marshal set length"),
          depth,
          slot,
        );
      case TYPE_FROZENSET:
        return this.setValue(
          "frozenset",
          this.nonNegativeInt32("Marshal frozenset length"),
          depth,
          slot,
        );
      case TYPE_DICT:
        return this.dict(depth, slot);
      case TYPE_CODE:
        return { kind: "code", value: this.code(depth) };
      default:
        return malformed(`Unsupported marshal type 0x${type.toString(16)}.`);
    }
  }

  code(depth: number): CodeNode {
    const argcount = this.nonNegativeInt32("co_argcount");
    const posonlyargcount =
      this.layout === "py37"
        ? null
        : this.nonNegativeInt32("co_posonlyargcount");
    if (posonlyargcount !== null && argcount < posonlyargcount)
      malformed("co_argcount is smaller than co_posonlyargcount.");
    const kwonlyargcount = this.nonNegativeInt32("co_kwonlyargcount");
    const nlocals =
      this.layout === "py311" ? null : this.nonNegativeInt32("co_nlocals");
    const stacksize = this.i32();
    if (this.rejectNegativeCodeFields && stacksize < 0)
      malformed("co_stacksize is negative.");
    const flags = this.i32();
    if (this.rejectNegativeCodeFields && flags < 0)
      malformed("co_flags is negative.");
    const bytecode = asBytes(this.readObject(depth + 1), "co_code");
    // 3.11+ `_PyCode_Validate` rejects a length that is not a whole code unit.
    // 3.7–3.10 constructors do not, so an odd `co_code` stays readable there.
    if (this.layout === "py311" && bytecode.length % 2 !== 0)
      malformed("co_code is malformed.");
    const constsTuple = this.readObject(depth + 1);
    const consts = asTuple(constsTuple, "co_consts");
    this.#chargeConsts(consts.length);
    const names = this.#nameTable(
      asTuple(this.readObject(depth + 1), "co_names"),
    );
    let varnames: NameTable | null = null;
    let freevars: NameTable | null = null;
    let cellvars: NameTable | null = null;
    let localsplusnames: NameTable | null = null;
    let localspluskinds_hex: string | null = null;
    if (this.layout === "py311") {
      localsplusnames = this.#nameTable(
        asTuple(this.readObject(depth + 1), "co_localsplusnames"),
      );
      const localspluskinds = asBytes(
        this.readObject(depth + 1),
        "co_localspluskinds",
      );
      if (localspluskinds.length !== localsplusnames.display.length)
        malformed(
          "co_localspluskinds length does not match co_localsplusnames.",
        );
      localspluskinds_hex = localspluskinds.toString("hex");
      this.#rejectUndersizedLocals(
        argcount,
        kwonlyargcount,
        flags,
        fastLocalCount(localspluskinds),
      );
    } else {
      varnames = this.#nameTable(
        asTuple(this.readObject(depth + 1), "co_varnames"),
      );
      freevars = this.#nameTable(
        asTuple(this.readObject(depth + 1), "co_freevars"),
      );
      cellvars = this.#nameTable(
        asTuple(this.readObject(depth + 1), "co_cellvars"),
      );
      this.#rejectUndersizedLocals(
        argcount,
        kwonlyargcount,
        flags,
        varnames.display.length,
      );
    }
    const filename = asString(this.readObject(depth + 1), "co_filename");
    const nameObject = this.readObject(depth + 1);
    const codeName = asStringWithRaw(nameObject, "co_name");
    const name = codeName.value;
    const qualname =
      this.layout === "py311"
        ? asString(this.readObject(depth + 1), "co_qualname")
        : null;
    const firstlineno = this.i32();
    const linetable = asBytes(this.readObject(depth + 1), "co_linetable");
    const exceptiontable =
      this.layout === "py311"
        ? asBytes(this.readObject(depth + 1), "co_exceptiontable")
        : Buffer.alloc(0);
    this.#reportStrings([
      name,
      qualname ?? "",
      filename,
      ...names.display,
      ...(varnames?.display ?? []),
      ...(freevars?.display ?? []),
      ...(cellvars?.display ?? []),
      ...(localsplusnames?.display ?? []),
      localspluskinds_hex ?? "",
    ]);
    const node: CodeNode = {
      name,
      qualname,
      filename,
      firstlineno,
      argcount,
      posonlyargcount,
      kwonlyargcount,
      nlocals,
      stacksize,
      flags,
      names: names.display,
      varnames: varnames?.display ?? null,
      freevars: freevars?.display ?? null,
      cellvars: cellvars?.display ?? null,
      localsplusnames: localsplusnames?.display ?? null,
      localspluskinds_hex,
      bytecode: { bytes: bytecode.length, sha256: sha256(bytecode) },
      consts: [],
      nested: [],
    };
    const effectiveFlags =
      this.layout === "py311"
        ? flags
        : (freevars?.display.length ?? 0) === 0 &&
            (cellvars?.display.length ?? 0) === 0
          ? flags | CO_NOFREE
          : flags & ~CO_NOFREE;
    this.#codeEquality.set(node, {
      consts,
      constsTuple,
      effectiveFlags,
      bytecode,
      name: codeName.raw,
      nameTables:
        localsplusnames !== null
          ? [names.equality, localsplusnames.equality]
          : [
              names.equality,
              varnames?.equality ?? [],
              freevars?.equality ?? [],
              cellvars?.equality ?? [],
            ],
      linetable: `${linetable.length}:${sha256(linetable)}`,
      exceptiontable: `${exceptiontable.length}:${sha256(exceptiontable)}`,
    });
    this.#codes.push(node);
    return node;
  }

  /**
   * Const summaries and nested relationships follow Python's object graph.
   * Building them while `code()` is still inside an ancestor container caches
   * that container before its items exist.
   */
  finishCodes(): void {
    for (const node of this.#codes) {
      const material =
        this.#codeEquality.get(node) ??
        malformed("Code object is missing decoded constants.");
      node.consts = this.#summarizeConsts(material.consts);
      node.nested = this.#nestedCodeObjects(material.consts);
    }
  }

  /**
   * A code-constant summary copies the child's name. Charge every copy the
   * report will carry before that summary is built.
   */
  #summarizeConsts(items: readonly MarshalValue[]): PythonPycConst[] {
    const summaries: PythonPycConst[] = [];
    for (const item of items) {
      if (item.kind === "code") this.#reportStrings([item.value.name]);
      summaries.push(summarizeConst(item));
    }
    return summaries;
  }

  /**
   * Strings reached through TYPE_REF are one marshal object but a full copy
   * in the report, so bound what the report carries, not the stream.
   */
  #reportStrings(values: readonly string[]): void {
    for (const value of values)
      this.#reportedStringBytes += Buffer.byteLength(value, "utf8");
    if (this.#reportedStringBytes > this.input.max_file_bytes)
      throw new PythonPycResourceFailure(
        "string",
        { max_file_bytes: this.input.max_file_bytes },
        `Reported code-object strings exceed max_file_bytes ${this.input.max_file_bytes}.`,
      );
  }

  /**
   * A consts tuple shared through TYPE_REF is one decode but a full copy in
   * every code object. Stop before those copies are built.
   */
  #chargeConsts(count: number): void {
    this.#chargeReported(count, "constants");
  }

  /**
   * A name table shared through TYPE_REF is one marshal object and a full
   * copy in every code object. Empty strings add no report bytes, so charge
   * each copied entry before building the report and equality arrays.
   */
  #nameTable(items: readonly MarshalValue[]): NameTable {
    this.#chargeReported(items.length, "names");
    const display: string[] = [];
    const equality: Buffer[] = [];
    for (const [index, item] of items.entries()) {
      const string = asStringWithRaw(item, `Tuple item ${index}`);
      display.push(string.value);
      equality.push(string.raw);
    }
    return { display, equality };
  }

  /**
   * Charge copies the report will carry. Nested relationships are separate
   * from the immediate const tuple, which misses a shared container repeated
   * by many owners. Name-table copies are separate from the byte budget,
   * which misses an empty string repeated by many owners.
   */
  #chargeReported(
    count: number,
    what: "constants" | "names" | "nested code relationships",
  ): void {
    this.#reportedConsts += count;
    if (this.#reportedConsts > this.input.max_objects)
      throw new PythonPycResourceFailure(
        "objects",
        { max_objects: this.input.max_objects },
        `Reported ${what} exceed max_objects ${this.input.max_objects}.`,
      );
  }

  /**
   * Distinct code objects reachable from this constant tuple. Containers are
   * walked iteratively, and a wrapper keeps the child's array instead of
   * copying every descendant. Charge the owner's reported relationships
   * before the array the report keeps is built.
   */
  #nestedCodeObjects(items: readonly MarshalValue[]): CodeNode[] {
    const seen = new Set<CodeNode>();
    const ordered: CodeNode[] = [];
    const add = (code: CodeNode): void => {
      if (seen.has(code)) return;
      seen.add(code);
      ordered.push(code);
    };
    for (const item of items) {
      if (item.kind === "code") {
        add(item.value);
        continue;
      }
      for (const code of this.#reachableCodes(item)) add(code);
    }
    this.#chargeReported(ordered.length, "nested code relationships");
    return ordered;
  }

  #reachableCodes(value: MarshalValue): readonly CodeNode[] {
    if (value.kind === "code") return [value.value];
    if (!isContainer(value)) return EMPTY_CODES;
    const cached = this.#nestedCache.get(value);
    if (cached !== undefined) return cached;
    const added: { value: MarshalValue; retained: number }[] = [];
    if (this.#memoizeNested(value, added)) {
      for (const entry of added) {
        this.#nestedCache.delete(entry.value);
        this.#nestedRetained -= entry.retained;
      }
      const walked = this.#walkNested(value);
      this.#nestedCache.set(value, walked);
      return walked;
    }
    return this.#nestedCache.get(value) ?? EMPTY_CODES;
  }

  /**
   * Post-order walk on an explicit stack. Each frame keeps its child list,
   * so a dictionary is not copied once per entry. A back edge returns before
   * any cyclic container is cached; the caller then scans that component once.
   */
  #memoizeNested(
    root: MarshalValue,
    added: { value: MarshalValue; retained: number }[],
  ): boolean {
    const gray = new Set<MarshalValue>();
    const frames: {
      value: MarshalValue;
      index: number;
      /** Built once. A dictionary child list is not copied on every step. */
      children: readonly MarshalValue[];
    }[] = [{ value: root, index: 0, children: containerChildren(root) }];
    gray.add(root);
    while (frames.length > 0) {
      this.#takeNestedStep();
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const children = frame.children;
      if (frame.index < children.length) {
        const child = children[frame.index];
        frame.index += 1;
        if (child === undefined || !isContainer(child)) continue;
        if (this.#nestedCache.has(child)) continue;
        if (gray.has(child)) return true;
        gray.add(child);
        frames.push({
          value: child,
          index: 0,
          children: containerChildren(child),
        });
        continue;
      }
      const retainedBefore = this.#nestedRetained;
      const codes = this.#combineNested(frame.children);
      this.#nestedCache.set(frame.value, codes);
      added.push({
        value: frame.value,
        retained: this.#nestedRetained - retainedBefore,
      });
      gray.delete(frame.value);
      frames.pop();
    }
    return false;
  }

  /** One scan of a container cycle. Cached containers outside the cycle are reused. */
  #walkNested(root: MarshalValue): readonly CodeNode[] {
    const seen = new Set<CodeNode>();
    const visited = new Set<MarshalValue>();
    const stack: MarshalValue[] = [root];
    while (stack.length > 0) {
      this.#takeNestedStep();
      const current = stack.pop();
      if (current === undefined) break;
      if (current.kind === "code") {
        seen.add(current.value);
        continue;
      }
      if (!isContainer(current) || visited.has(current)) continue;
      const known =
        current === root ? undefined : this.#nestedCache.get(current);
      if (known !== undefined) {
        for (const code of known) seen.add(code);
        continue;
      }
      visited.add(current);
      const children = containerChildren(current);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) stack.push(child);
      }
    }
    const codes = [...seen];
    this.#retainNested(codes);
    return codes;
  }

  /**
   * Share a child's array when this container adds no further code object.
   * Otherwise retain one new list and count its slots against the walk budget.
   * `children` is the list the frame already built.
   */
  #combineNested(children: readonly MarshalValue[]): readonly CodeNode[] {
    let shared: readonly CodeNode[] | undefined;
    let onlyShared = true;
    const codes: CodeNode[] = [];
    const seen = new Set<CodeNode>();
    const add = (code: CodeNode): void => {
      if (seen.has(code)) return;
      seen.add(code);
      codes.push(code);
    };
    for (const child of children) {
      if (child.kind === "code") {
        if (shared !== undefined || codes.length > 0) onlyShared = false;
        add(child.value);
        continue;
      }
      if (!isContainer(child)) continue;
      const part = this.#nestedCache.get(child);
      if (part === undefined || part.length === 0) continue;
      if (shared === undefined && codes.length === 0) shared = part;
      else onlyShared = false;
      for (const code of part) add(code);
    }
    if (codes.length === 0) return EMPTY_CODES;
    if (onlyShared && shared !== undefined && shared.length === codes.length)
      return shared;
    this.#retainNested(codes);
    return codes;
  }

  #takeNestedStep(): void {
    this.#nestedSteps += 1;
    const limit = this.input.max_objects * this.input.max_depth;
    if (this.#nestedSteps > limit)
      throw new PythonPycResourceFailure(
        "objects",
        {
          max_objects: this.input.max_objects,
          max_depth: this.input.max_depth,
        },
        `Nested code walk exceeds ${limit} steps (max_objects * max_depth).`,
      );
  }

  #retainNested(codes: readonly CodeNode[]): void {
    this.#nestedRetained += codes.length;
    const limit = this.input.max_objects * this.input.max_depth;
    if (this.#nestedRetained > limit)
      throw new PythonPycResourceFailure(
        "objects",
        {
          max_objects: this.input.max_objects,
          max_depth: this.input.max_depth,
        },
        `Nested code walk retains more than ${limit} code references.`,
      );
  }

  readRef(): MarshalValue {
    const index = this.u32();
    const value = this.#intern[index];
    if (value === undefined)
      return malformed(
        `TYPE_REF index ${index} is missing or still being constructed.`,
      );
    return value;
  }

  #publish(slot: number | undefined, value: MarshalValue): void {
    if (slot !== undefined) this.#intern[slot] = value;
  }

  /**
   * CPython registers tuples and lists before reading items, so a container
   * can refer to itself. The same object is what later TYPE_REF entries see.
   */
  sequenceValue(
    kind: "tuple" | "list",
    count: number,
    depth: number,
    slot: number | undefined,
  ): MarshalValue {
    const items: MarshalValue[] = [];
    const value: MarshalValue =
      kind === "tuple" ? { kind: "tuple", items } : { kind: "list", items };
    this.#publish(slot, value);
    if (kind === "tuple") this.#readingTuples.add(value);
    for (let index = 0; index < count; index += 1) {
      const item = this.readObject(depth + 1);
      if (item.kind === "null")
        malformed("NULL object in marshal data for sequence.");
      items.push(item);
    }
    this.#readingTuples.delete(value);
    return value;
  }

  /**
   * Sets are registered before their members. Frozensets are registered after,
   * matching CPython, so a reference inside a frozenset body is still invalid.
   * Equal members count once; unhashable members fail the walk.
   */
  setValue(
    kind: "set" | "frozenset",
    count: number,
    depth: number,
    slot: number | undefined,
  ): MarshalValue {
    const items: MarshalValue[] = [];
    const value: MarshalValue =
      kind === "set" ? { kind: "set", items } : { kind: "frozenset", items };
    if (kind === "set") this.#publish(slot, value);
    for (let index = 0; index < count; index += 1) {
      const item = this.readObject(depth + 1);
      if (item.kind === "null")
        malformed("NULL object in marshal data for set.");
      items.push(item);
    }
    const unique = this.#unique(items, "set member");
    items.length = 0;
    for (const item of unique) items.push(item);
    return value;
  }

  /**
   * Dictionaries are registered before their pairs. A null key or a null value
   * ends the dict; a null value does not become an entry. Equal keys keep the
   * first key object and replace only its value. An unhashable key fails the
   * walk.
   */
  dict(depth: number, slot: number | undefined): MarshalValue {
    const items: [MarshalValue, MarshalValue][] = [];
    const value: MarshalValue = { kind: "dict", items };
    this.#publish(slot, value);
    const indexes = new Map<string, number>();
    for (;;) {
      const key = this.readObject(depth + 1);
      if (key.kind === "null") return value;
      const mapped = this.readObject(depth + 1);
      if (mapped.kind === "null") return value;
      const hash = this.#hashKey(key, "dictionary key");
      const existing = indexes.get(hash);
      if (existing === undefined) {
        indexes.set(hash, items.length);
        items.push([key, mapped]);
      } else {
        const kept =
          items[existing] ?? malformed("Dictionary entry is missing.");
        kept[1] = mapped;
      }
    }
  }

  #unique(items: readonly MarshalValue[], role: string): MarshalValue[] {
    const seen = new Map<string, MarshalValue>();
    for (const item of items) {
      const key = this.#hashKey(item, role);
      if (!seen.has(key)) seen.set(key, item);
    }
    return [...seen.values()];
  }

  /**
   * CPython rejects code whose argument counts do not fit the local table.
   * 3.11+ counts `CO_FAST_LOCAL` entries (`co_varnames is too small`).
   * 3.7–3.10 count `co_varnames` the same way, including `*args` and `**kwargs`.
   */
  #rejectUndersizedLocals(
    argcount: number,
    kwonlyargcount: number,
    flags: number,
    locals: number,
  ): void {
    let plain = locals - argcount - kwonlyargcount;
    if ((flags & CO_VARARGS) !== 0) plain -= 1;
    if ((flags & CO_VARKEYWORDS) !== 0) plain -= 1;
    if (plain < 0) malformed("co_varnames is too small.");
  }

  #hashKey(value: MarshalValue, role: string): string {
    return this.#equalityKey(value, "hash") ?? malformed(`Unhashable ${role}.`);
  }

  /**
   * Python equality for hash-based containers and for code-constant identity.
   * Tuple and frozenset chains use an explicit stack: a `TYPE_REF` chain is
   * not stream nesting, and `max_depth` must not turn a loadable file into
   * a stack overflow. Expanded size is checked per container so a shared
   * child that is stored twice still cannot double without bound.
   */
  #equalityKey(value: MarshalValue, mode: KeyMode): string | null {
    const resolved = this.#resolveKey(value, mode);
    return resolved === null ? null : resolved.token;
  }

  #resolveKey(value: MarshalValue, mode: KeyMode): ResolvedKey | null {
    const cached = this.#cachedKey(value, mode);
    if (cached !== undefined) return cached;
    const frames: KeyFrame[] = [
      { value, index: 0, parts: [], expanded: [], failed: false },
    ];
    const gray = new Set<MarshalValue>();
    gray.add(value);
    while (frames.length > 0) {
      this.#takeKeyStep();
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      // A tuple still being read has missing items; CPython cannot hash it.
      if (mode === "hash" && this.#readingTuples.has(frame.value))
        frame.failed = true;
      const items =
        frame.value.kind === "tuple" || frame.value.kind === "frozenset"
          ? frame.value.items
          : undefined;
      if (items === undefined) {
        const key = this.#leafKey(frame.value, mode);
        this.#storeKey(frame.value, mode, key, gray);
        frames.pop();
        this.#recordChild(frames, key);
        continue;
      }
      if (frame.failed || frame.index >= items.length) {
        const key = frame.failed
          ? null
          : this.#containerKey(frame.value, frame.parts, frame.expanded);
        this.#storeKey(frame.value, mode, key, gray);
        frames.pop();
        this.#recordChild(frames, key);
        continue;
      }
      const child = items[frame.index];
      frame.index += 1;
      if (child === undefined) continue;
      const known = this.#cachedKey(child, mode);
      if (known !== undefined) {
        if (known === null) frame.failed = true;
        else this.#pushPart(frame, known);
        continue;
      }
      if (gray.has(child)) {
        if (mode === "hash") frame.failed = true;
        else this.#pushPart(frame, this.#identityKey(child));
        continue;
      }
      gray.add(child);
      frames.push({
        value: child,
        index: 0,
        parts: [],
        expanded: [],
        failed: false,
      });
    }
    const resolved = this.#cachedKey(value, mode);
    return resolved === undefined ? null : resolved;
  }

  #cachedKey(
    value: MarshalValue,
    mode: KeyMode,
  ): ResolvedKey | null | undefined {
    return mode === "hash"
      ? this.#keyCache.get(value)
      : this.#constCache.get(value);
  }

  #storeKey(
    value: MarshalValue,
    mode: KeyMode,
    key: ResolvedKey | null,
    gray: Set<MarshalValue>,
  ): void {
    if (mode === "hash") this.#keyCache.set(value, key);
    else if (key !== null) this.#constCache.set(value, key);
    gray.delete(value);
  }

  #recordChild(frames: KeyFrame[], key: ResolvedKey | null): void {
    const parent = frames[frames.length - 1];
    if (parent === undefined) return;
    if (key === null) {
      parent.failed = true;
      return;
    }
    this.#pushPart(parent, key);
  }

  #pushPart(frame: KeyFrame, key: ResolvedKey): void {
    frame.parts.push(key.token);
    frame.expanded.push(key.expanded);
  }

  /**
   * One step per explicit-stack iteration. The cap follows decoded objects,
   * not `max_depth`, because a reference chain is shallow in the stream.
   */
  #takeKeyStep(): void {
    this.#keySteps += 1;
    const limit = this.input.max_objects * 8;
    if (this.#keySteps > limit)
      throw new PythonPycResourceFailure(
        "objects",
        { max_objects: this.input.max_objects },
        `Marshal key walk exceeds ${limit} steps (max_objects * 8).`,
      );
  }

  #leafKey(value: MarshalValue, mode: KeyMode): ResolvedKey | null {
    const descriptor = this.#leafDescriptor(value, mode);
    if (descriptor === null) return null;
    return {
      token: this.#internToken(descriptor),
      expanded: descriptor.length,
    };
  }

  #leafDescriptor(value: MarshalValue, mode: KeyMode): string | null {
    switch (value.kind) {
      case "none":
        return "N";
      case "ellipsis":
        return "E";
      case "stopiter":
        return "S";
      case "bool":
        if (mode === "hash") return value.value ? "i1" : "i0";
        return value.value ? "B1" : "B0";
      case "int":
        if (value.bits > this.input.max_string_bytes * 3)
          this.#keyTooLarge(value.bits);
        return this.#boundedJoin("i", [value.value.toString()], "");
      case "float":
        if (Number.isNaN(value.value)) return this.#identity(value);
        if (mode === "const") return this.#constFloat(value.value);
        return this.#numberKey(value.value);
      case "complex":
        if (Number.isNaN(value.real) || Number.isNaN(value.imag))
          return this.#identity(value);
        if (mode === "hash" && value.imag === 0)
          return this.#numberKey(value.real);
        if (mode === "hash")
          return this.#boundedJoin(
            "c",
            [this.#numberKey(value.real), this.#numberKey(value.imag)],
            ":",
          );
        return this.#boundedJoin(
          "c",
          [
            this.#signedZero(value.real),
            this.#signedZero(value.imag),
            this.#numberKey(value.real),
            this.#numberKey(value.imag),
          ],
          ":",
        );
      case "str":
        return this.#marshalStringKey(value.raw);
      case "bytes": {
        this.#reserveKey(value.value.length * 2 + 8);
        const prefix = mode === "hash" ? "b" : "y";
        return `${prefix}${value.value.length}:${value.value.toString("hex")}`;
      }
      case "code":
        if (mode === "hash" && !this.#isCodeHashable(value.value)) return null;
        return this.#codeKey(value.value);
      default:
        return mode === "const" ? this.#identity(value) : null;
    }
  }

  #constFloat(value: number): string {
    if (Object.is(value, -0)) return "z-0";
    if (Object.is(value, 0)) return "z0";
    return `z${this.#numberKey(value)}`;
  }

  #containerKey(
    value: MarshalValue,
    parts: readonly string[],
    childExpanded: readonly number[],
  ): ResolvedKey {
    const expanded = this.#expandedContainerSize(childExpanded);
    if (expanded > this.input.max_string_bytes) this.#keyTooLarge(expanded);
    const ordered = value.kind === "frozenset" ? [...parts].sort() : parts;
    const kind = value.kind === "tuple" ? "T" : "F";
    const descriptor = `${kind}:${ordered.join(",")}`;
    // Charge the descriptor that is stored, not the unmaterialized expansion.
    // A linear reference chain stays within the file budget; repeating one
    // child still fails above when `expanded` passes max_string_bytes.
    this.#reserveKey(descriptor.length);
    return { token: this.#internToken(descriptor), expanded };
  }

  /** Size of the old length-prefixed container key, without building it. */
  #expandedContainerSize(childExpanded: readonly number[]): number {
    let size = 1;
    if (childExpanded.length > 0) size += childExpanded.length - 1;
    for (const child of childExpanded) size += String(child).length + 1 + child;
    return size;
  }

  #internToken(descriptor: string): string {
    const existing = this.#keyTokens.get(descriptor);
    if (existing !== undefined) return existing;
    this.#keyTokenNext += 1;
    const token = `k${this.#keyTokenNext.toString(36)}`;
    this.#keyTokens.set(descriptor, token);
    return token;
  }

  #identityKey(value: MarshalValue): ResolvedKey {
    const token = this.#identity(value);
    return { token, expanded: token.length };
  }

  /**
   * CPython code equality ignores filename, qualname, and stack size. Consts
   * use the constant-key rules, which keep -0 distinct from 0.
   */
  #codeKey(node: CodeNode): string {
    const existing = this.#codeKeys.get(node);
    if (existing !== undefined && existing !== "") return existing;
    if (existing === "") return `cycle${this.#codeIdentity(node)}`;
    this.#codeKeys.set(node, "");
    const material =
      this.#codeEquality.get(node) ??
      malformed("Code object is missing equality material.");
    const fields = [
      this.#marshalStringKey(material.name),
      String(node.argcount),
      String(node.posonlyargcount ?? 0),
      String(node.kwonlyargcount),
      node.nlocals === null ? "" : String(node.nlocals),
      String(material.effectiveFlags),
      String(node.firstlineno),
      pythonPycBytecodeIdentity(
        material.bytecode,
        this.magic,
        node.bytecode.sha256,
      ),
      this.#constKeyItems(material.consts),
      ...material.nameTables.map((items) => this.#nameTableKey(items)),
      // CPython started including line and exception tables in code equality
      // with the 3.11 code layout; earlier layouts still retain their digests
      // in CodeEquality, but those fields do not affect container identity.
      ...(this.layout === "py311"
        ? [material.linetable, material.exceptiontable]
        : []),
    ];
    const key = this.#boundedJoin(
      "",
      fields.map((field) => `${field.length}:${field}`),
      ",",
    );
    this.#codeKeys.set(node, key);
    return key;
  }

  /**
   * CPython hashes the consts tuple itself, so one unhashable const makes the
   * code unhashable. A const that leads back to the same code counts as
   * unhashable instead of recursing.
   */
  #isCodeHashable(node: CodeNode): boolean {
    const known = this.#codeHashable.get(node);
    if (known !== undefined) return known;
    this.#codeHashable.set(node, false);
    const material =
      this.#codeEquality.get(node) ??
      malformed("Code object is missing equality material.");
    const hashable = this.#equalityKey(material.constsTuple, "hash") !== null;
    this.#codeHashable.set(node, hashable);
    return hashable;
  }

  #codeIdentity(node: CodeNode): number {
    const existing = this.#codeIdentities.get(node);
    if (existing !== undefined) return existing;
    this.#identityNext += 1;
    this.#codeIdentities.set(node, this.#identityNext);
    return this.#identityNext;
  }

  /**
   * One name table, with its length and each entry's boundary. Joining on a
   * bare NUL makes `()` and `("",)` the same key, and the same join hides
   * which of `co_varnames`, `co_freevars`, and `co_cellvars` held each name.
   */
  #nameTableKey(items: readonly Buffer[]): string {
    let size = `${items.length}[]`.length;
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index];
      if (raw === undefined) continue;
      const keyLength = this.#marshalStringKeyLength(raw.length);
      size += String(keyLength).length + 1 + keyLength;
      if (index > 0) size += 1;
    }
    this.#reserveKey(size);
    const entries = items
      .map((item) => {
        const key = this.#marshalStringKey(item);
        return `${key.length}:${key}`;
      })
      .join(",");
    return `${items.length}[${entries}]`;
  }

  /** Constant key used when two code objects compare their co_consts. */
  #constKeyItems(items: readonly MarshalValue[]): string {
    const parts: string[] = [];
    for (const item of items) {
      const key = this.#resolveKey(item, "const");
      const token = key === null ? this.#identity(item) : key.token;
      parts.push(`${token.length}:${token}`);
    }
    return this.#boundedJoin("k", parts, ",");
  }

  /** Python string identity is the marshal bytes, not the JavaScript string. */
  #marshalStringKey(raw: Buffer): string {
    this.#reserveKey(this.#marshalStringKeyLength(raw.length));
    return `s${raw.length}:${raw.toString("hex")}`;
  }

  #marshalStringKeyLength(bytes: number): number {
    return String(bytes).length + bytes * 2 + 2;
  }

  #signedZero(value: number): string {
    if (Object.is(value, -0)) return "-";
    if (Object.is(value, 0)) return "+";
    return "n";
  }

  /**
   * Join a key only after its size fits the string budget and the running
   * key-byte budget. Caching the result does not make an oversized key safe.
   */
  #boundedJoin(
    prefix: string,
    parts: readonly string[],
    separator: string,
  ): string {
    let size = prefix.length;
    if (parts.length > 0) size += (parts.length - 1) * separator.length;
    for (const part of parts) size += part.length;
    this.#reserveKey(size);
    return prefix + parts.join(separator);
  }

  #reserveKey(size: number): void {
    if (size > this.input.max_string_bytes) this.#keyTooLarge(size);
    this.#keyBytes += size;
    if (this.#keyBytes > this.input.max_file_bytes)
      throw new PythonPycResourceFailure(
        "string",
        { max_file_bytes: this.input.max_file_bytes },
        `Marshal key expansion exceeds max_file_bytes ${this.input.max_file_bytes}.`,
      );
  }

  #keyTooLarge(size: number): never {
    throw new PythonPycResourceFailure(
      "string",
      { max_string_bytes: this.input.max_string_bytes },
      `Marshal key of ${size} bytes exceeds max_string_bytes ${this.input.max_string_bytes}.`,
    );
  }

  #numberKey(value: number): string {
    if (value === 0) return "i0";
    if (Number.isFinite(value) && Number.isInteger(value))
      return `i${BigInt(value).toString()}`;
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(value);
    return `d${bytes.toString("hex")}`;
  }

  #identity(value: MarshalValue): string {
    const existing = this.#identities.get(value);
    if (existing !== undefined) return `u${existing}`;
    this.#identityNext += 1;
    this.#identities.set(value, this.#identityNext);
    return `u${this.#identityNext}`;
  }

  /**
   * CPython stores a long as 15-bit digits, least significant first. Charge
   * the digits against the string budget (they never use another one), reject
   * the digits CPython rejects, and build the value in one linear pass.
   */
  long(): { value: bigint; bits: number } {
    const count = this.i32();
    const size = Math.abs(count);
    if (size * 2 > this.input.max_string_bytes)
      throw new PythonPycResourceFailure(
        "string",
        { max_string_bytes: this.input.max_string_bytes },
        `Marshal long of ${size * 2} digit bytes exceeds max_string_bytes ${this.input.max_string_bytes}.`,
      );
    if (this.offset > this.bytes.length - size * 2)
      malformed("Marshal long overruns the selected file.");
    const nibbles: number[] = [];
    let carry = 0;
    let carryBits = 0;
    let digit = 0;
    for (let index = 0; index < size; index += 1) {
      digit = this.u16();
      if (digit >= 0x8000) malformed("Marshal long digit is out of range.");
      carry |= digit << carryBits;
      carryBits += 15;
      while (carryBits >= 4) {
        nibbles.push(carry & 0xf);
        carry >>>= 4;
        carryBits -= 4;
      }
    }
    if (size > 0 && digit === 0) malformed("Marshal long is not normalized.");
    if (carryBits > 0) nibbles.push(carry);
    let bits = 0;
    if (size > 0) {
      let top = digit;
      while (top > 0) {
        top >>>= 1;
        bits += 1;
      }
      bits += (size - 1) * 15;
    }
    if (nibbles.length === 0) return { value: 0n, bits: 0 };
    const magnitude = BigInt(
      `0x${nibbles
        .reverse()
        .map((nibble) => nibble.toString(16))
        .join("")}`,
    );
    return { value: count < 0 ? -magnitude : magnitude, bits };
  }

  /** Marshal version 0 writes a one-byte length and a CPython float literal. */
  textFloat(): number {
    const bytes = this.blob(this.u8());
    if (bytes.some((byte) => byte > 0x7f))
      malformed("Marshal float text is not ASCII.");
    return (
      parseMarshalFloat(bytes.toString("latin1")) ??
      malformed("Marshal float text is not a CPython float.")
    );
  }

  utf8(length: number, ascii: boolean): MarshalValue {
    const bytes = this.blob(length);
    if (ascii) {
      if (bytes.some((byte) => byte > 0x7f))
        malformed("Marshal ASCII string contains a non-ASCII byte.");
      return {
        kind: "str",
        value: bytes.toString("latin1"),
        previewEnd: Math.min(length, PYTHON_PYC_CONST_PREVIEW_LIMIT),
        bytes: length,
        raw: bytes,
      };
    }
    const decoded = decodeMarshalUtf8(bytes, PYTHON_PYC_CONST_PREVIEW_LIMIT);
    if (!decoded.ok) return malformed("Marshal string is not valid UTF-8.");
    return {
      kind: "str",
      value: decoded.value.text,
      previewEnd: decoded.value.prefixEnd,
      bytes: length,
      raw: bytes,
    };
  }

  blob(length: number): Buffer {
    if (length > this.input.max_string_bytes)
      throw new PythonPycResourceFailure(
        "string",
        { max_string_bytes: this.input.max_string_bytes },
        `Marshal string of ${length} bytes exceeds max_string_bytes ${this.input.max_string_bytes}.`,
      );
    if (this.offset > this.bytes.length - length)
      malformed("Marshal string overruns the selected file.");
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(value);
  }

  u8(): number {
    if (this.offset >= this.bytes.length)
      malformed("Marshal stream ended inside an object.");
    const value = this.bytes[this.offset];
    this.offset += 1;
    if (value === undefined)
      return malformed("Marshal stream ended inside an object.");
    return value;
  }

  u16(): number {
    if (this.offset > this.bytes.length - 2)
      malformed("Marshal stream ended inside a 16-bit field.");
    const value = this.bytes.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(): number {
    if (this.offset > this.bytes.length - 4)
      malformed("Marshal stream ended inside a 32-bit field.");
    const value = this.bytes.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    if (this.offset > this.bytes.length - 4)
      malformed("Marshal stream ended inside a 32-bit field.");
    const value = this.bytes.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i64(): bigint {
    if (this.offset > this.bytes.length - 8)
      malformed("Marshal stream ended inside a 64-bit integer.");
    const value = this.bytes.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  /** CPython `r_long` count fields that its constructors require non-negative. */
  nonNegativeInt32(field: string): number {
    const value = this.i32();
    if (value < 0) malformed(`${field} is negative.`);
    return value;
  }

  f64(): number {
    if (this.offset > this.bytes.length - 8)
      malformed("Marshal stream ended inside a float.");
    const value = this.bytes.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }
}

/** Keep values whose identity JSON numbers cannot preserve as Python repr. */
const jsonFloat = (value: number): number | "inf" | "-inf" | "nan" | "-0.0" =>
  Number.isNaN(value)
    ? "nan"
    : value === Infinity
      ? "inf"
      : value === -Infinity
        ? "-inf"
        : Object.is(value, -0)
          ? "-0.0"
          : value;

/**
 * Emit each distinct code object once, the top-level object first. A child
 * shared through TYPE_REF is listed once and referenced by index, so the
 * report never repeats a subtree.
 */
const flattenCode = (root: CodeNode): PythonPycCodeObject[] => {
  const indexes = new Map<CodeNode, number>();
  const order: CodeNode[] = [];
  const visit = (node: CodeNode): void => {
    if (indexes.has(node)) return;
    indexes.set(node, order.length);
    order.push(node);
    for (const child of node.nested) visit(child);
  };
  visit(root);
  return order.map(({ nested, ...code }) => ({
    ...code,
    nested_code: nested.map(
      (child) =>
        indexes.get(child) ?? malformed("Nested code object was not listed."),
    ),
  }));
};

const asBytes = (value: MarshalValue, field: string): Buffer => {
  if (value.kind !== "bytes")
    return malformed(`${field} is not marshal bytes.`);
  return value.value;
};

const asString = (value: MarshalValue, field: string): string => {
  if (value.kind !== "str")
    return malformed(`${field} is not a marshal string.`);
  return value.value;
};

const asStringWithRaw = (
  value: MarshalValue,
  field: string,
): { readonly value: string; readonly raw: Buffer } => {
  if (value.kind !== "str")
    return malformed(`${field} is not a marshal string.`);
  return value;
};

const asTuple = (
  value: MarshalValue,
  field: string,
): readonly MarshalValue[] => {
  if (value.kind !== "tuple")
    return malformed(`${field} is not a marshal tuple.`);
  return value.items;
};

const constSummaries = new WeakMap<MarshalValue, PythonPycConst>();

/** One summary per decoded object, so TYPE_REF does not repeat the work. */
const summarizeConst = (value: MarshalValue): PythonPycConst => {
  const cached = constSummaries.get(value);
  if (cached !== undefined) return cached;
  const summary = buildConstSummary(value);
  constSummaries.set(value, summary);
  return summary;
};

const buildConstSummary = (value: MarshalValue): PythonPycConst => {
  switch (value.kind) {
    case "none":
      return { kind: "none" };
    case "bool":
      return { kind: "bool", value: value.value };
    case "int":
      return {
        kind: "int",
        bits: value.bits,
        value:
          value.bits <= PYTHON_PYC_INT_PREVIEW_BITS
            ? value.value.toString()
            : null,
      };
    case "float":
      return { kind: "float", value: jsonFloat(value.value) };
    case "str": {
      const truncated = value.value.length > PYTHON_PYC_CONST_PREVIEW_LIMIT;
      return {
        kind: "str",
        bytes: value.bytes,
        truncated,
        value: truncated ? value.value.slice(0, value.previewEnd) : value.value,
      };
    }
    case "bytes":
      return {
        kind: "bytes",
        bytes: value.value.length,
        sha256: sha256(value.value),
      };
    case "code":
      return {
        kind: "code",
        name: value.value.name,
        firstlineno: value.value.firstlineno,
      };
    case "tuple":
      return { kind: "tuple", length: value.items.length };
    case "list":
      return { kind: "list", length: value.items.length };
    case "set":
      return { kind: "set", length: value.items.length };
    case "frozenset":
      return { kind: "frozenset", length: value.items.length };
    case "dict":
      return { kind: "dict", length: value.items.length };
    case "ellipsis":
      return { kind: "ellipsis" };
    case "complex":
      return {
        kind: "complex",
        real: jsonFloat(value.real),
        imag: jsonFloat(value.imag),
      };
    default:
      return { kind: "other", type: value.kind };
  }
};

const smallBitLength = (value: bigint): number => {
  if (value === 0n) return 0;
  const magnitude = value < 0n ? -value : value;
  return magnitude.toString(2).length;
};

/**
 * CPython's `PyOS_string_to_double` grammar for marshal version 0: an optional
 * sign, then `inf`/`infinity`, `nan`, or a decimal literal. No hex floats and
 * no surrounding whitespace.
 */
const MARSHAL_FLOAT =
  /^([+-]?)(?:(inf(?:inity)?)|(nan)|((?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?))$/i;

const parseMarshalFloat = (text: string): number | undefined => {
  const match = MARSHAL_FLOAT.exec(text);
  if (match === null) return undefined;
  if (match[2] !== undefined) return match[1] === "-" ? -Infinity : Infinity;
  if (match[3] !== undefined) return Number.NaN;
  const value = Number(text);
  return Number.isNaN(value) ? undefined : value;
};
