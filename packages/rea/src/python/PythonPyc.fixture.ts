import type { PythonPycCodeLayout } from "../domain/python/pythonPyc.js";

const FLAG_REF = 0x80;

const u8 = (value: number): Buffer => Buffer.from([value]);
const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const i32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
};
const concat = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

/** 16-byte CPython 3.7+ pyc header. Hash-based pycs store an 8-byte source hash. */
export const pythonPycHeader = (
  magic: number,
  fields: {
    flags?: number;
    mtime?: number;
    sourceSize?: number;
    sourceHash?: Buffer;
  } = {},
): Buffer => {
  const header = Buffer.alloc(16);
  header.writeUInt16LE(magic, 0);
  header[2] = 0x0d;
  header[3] = 0x0a;
  const flags = fields.flags ?? 0;
  header.writeUInt32LE(flags, 4);
  if ((flags & 1) !== 0) {
    const hash = fields.sourceHash ?? Buffer.alloc(8);
    if (hash.length !== 8)
      throw new Error("Hash-based pyc header requires 8 source-hash bytes.");
    hash.copy(header, 8);
    return header;
  }
  header.writeUInt32LE(fields.mtime ?? 0, 8);
  header.writeUInt32LE(fields.sourceSize ?? 0, 12);
  return header;
};

const marshalNone = (): Buffer => u8(0x4e);
const marshalBytes = (value: Buffer, flagged = false): Buffer =>
  concat(u8(0x73 | (flagged ? FLAG_REF : 0)), u32(value.length), value);
const marshalShortAscii = (value: string, interned = false): Buffer =>
  concat(
    u8(interned ? 0x5a : 0x7a),
    u8(Buffer.byteLength(value, "utf8")),
    Buffer.from(value, "utf8"),
  );
const marshalSmallTuple = (items: Buffer[]): Buffer =>
  concat(u8(0x29), u8(items.length), ...items);

export type FixtureCodeFields = {
  argcount?: number;
  posonlyargcount?: number;
  kwonlyargcount?: number;
  nlocals?: number;
  stacksize?: number;
  flags?: number;
  bytecode?: Buffer;
  consts?: Buffer[];
  names?: string[];
  varnames?: string[];
  freevars?: string[];
  cellvars?: string[];
  localsplusnames?: string[];
  localspluskinds?: Buffer;
  /** Raw marshal object in place of the co_consts tuple. */
  constsObject?: Buffer;
  filename?: string;
  name?: string;
  qualname?: string;
  /** Raw marshal object in place of co_name. */
  nameObject?: Buffer;
  /** Raw marshal object in place of co_qualname. */
  qualnameObject?: Buffer;
  firstlineno?: number;
  linetable?: Buffer;
  exceptiontable?: Buffer;
  /** Raw marshal object in place of the co_names tuple. */
  namesObject?: Buffer;
  /** Raw marshal object in place of the co_exceptiontable bytes. */
  exceptiontableObject?: Buffer;
  flagged?: boolean;
};

/** Marshal TYPE_CODE matching CPython 3.7, 3.8–3.10, or 3.11+ field order. */
export const marshalCode = (
  layout: PythonPycCodeLayout,
  fields: FixtureCodeFields = {},
): Buffer => {
  const parts: Buffer[] = [
    u8(0x63 | (fields.flagged === true ? FLAG_REF : 0)),
    u32(fields.argcount ?? 0),
  ];
  if (layout !== "py37") parts.push(u32(fields.posonlyargcount ?? 0));
  parts.push(u32(fields.kwonlyargcount ?? 0));
  if (layout !== "py311") parts.push(u32(fields.nlocals ?? 0));
  parts.push(
    u32(fields.stacksize ?? 1),
    u32(fields.flags ?? 0),
    marshalBytes(fields.bytecode ?? Buffer.from([0x53, 0x00])),
    fields.constsObject ?? marshalSmallTuple(fields.consts ?? [marshalNone()]),
    fields.namesObject ??
      marshalSmallTuple(
        (fields.names ?? []).map((name) => marshalShortAscii(name)),
      ),
  );
  if (layout === "py311") {
    parts.push(
      marshalSmallTuple(
        (fields.localsplusnames ?? []).map((name) => marshalShortAscii(name)),
      ),
      marshalBytes(fields.localspluskinds ?? Buffer.alloc(0)),
    );
  } else {
    parts.push(
      marshalSmallTuple(
        (fields.varnames ?? []).map((name) => marshalShortAscii(name)),
      ),
      marshalSmallTuple(
        (fields.freevars ?? []).map((name) => marshalShortAscii(name)),
      ),
      marshalSmallTuple(
        (fields.cellvars ?? []).map((name) => marshalShortAscii(name)),
      ),
    );
  }
  parts.push(
    marshalShortAscii(fields.filename ?? "sample.py"),
    fields.nameObject ?? marshalShortAscii(fields.name ?? "<module>"),
  );
  if (layout === "py311")
    parts.push(
      fields.qualnameObject ??
        marshalShortAscii(fields.qualname ?? fields.name ?? "<module>"),
    );
  parts.push(
    i32(fields.firstlineno ?? 1),
    marshalBytes(fields.linetable ?? Buffer.alloc(0)),
  );
  if (layout === "py311")
    parts.push(
      fields.exceptiontableObject ??
        marshalBytes(fields.exceptiontable ?? Buffer.alloc(0)),
    );
  return concat(...parts);
};

/** Complete pyc with a module code object and optional nested function. */
export const pythonPycFixture = (
  layout: PythonPycCodeLayout = "py311",
  options: {
    magic?: number;
    header?: Parameters<typeof pythonPycHeader>[1];
    nested?: boolean;
    flaggedCode?: boolean;
  } = {},
): Buffer => {
  const magic =
    options.magic ??
    (layout === "py37" ? 3394 : layout === "py38" ? 3439 : 3531);
  const nested =
    options.nested === true
      ? marshalCode(layout, {
          name: "inner",
          qualname: "inner",
          filename: "sample.py",
          firstlineno: 2,
          bytecode: Buffer.from([0x53, 0x00]),
        })
      : undefined;
  const module = marshalCode(layout, {
    name: "<module>",
    qualname: "<module>",
    filename: "sample.py",
    firstlineno: 1,
    names: nested === undefined ? [] : ["inner"],
    consts: nested === undefined ? [marshalNone()] : [nested, marshalNone()],
    bytecode: Buffer.from([0x64, 0x00, 0x53, 0x00]),
    ...(options.flaggedCode === true ? { flagged: true } : {}),
  });
  return concat(pythonPycHeader(magic, options.header), module);
};
