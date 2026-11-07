import { setImmediate } from "node:timers/promises";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import {
  BUN_RECORD_BYTES_1_3_3,
  BUN_RECORD_BYTES_1_3_9,
  MAX_BUN_MODULE_COUNT,
  MAX_BUN_RETAINED_BYTES,
  bunMetadataBytesLimit,
  bunFormatFailure,
  bunModuleCountLimit,
  readPointer,
  type BunLayoutRevision,
  type BunStringPointer,
  type LocatedBunGraph,
  type BunGraphData,
} from "./BunModuleGraphLayout.js";

/**
 * Loader discriminants are append-only in Bun 1.4.4 `src/ast/loader.rs`.
 * Unknown ids stay raw. The stale C header value for TOML is not used.
 */
const LOADERS = [
  "jsx",
  "js",
  "ts",
  "tsx",
  "css",
  "file",
  "json",
  "jsonc",
  "toml",
  "wasm",
  "napi",
  "base64",
  "dataurl",
  "text",
  "bunsh",
  "sqlite",
  "sqlite-embedded",
  "html",
  "yaml",
  "json5",
  "md",
  "xml",
] as const;

const MODULE_FORMATS = ["none", "esm", "cjs"] as const;
const SIDES = ["server", "client"] as const;

export interface BunTextFact {
  readonly text: string | null;
  readonly hex: string | null;
}

export interface BunByteRange {
  readonly offset: number;
  readonly length: number;
}

export interface BunDecodedModule {
  readonly index: number;
  readonly nameText: BunTextFact;
  readonly contents: BunByteRange;
  readonly sourcemap: BunByteRange | null;
  readonly bytecode: BunByteRange | null;
  readonly moduleInfo: BunByteRange | null;
  readonly bytecodeOrigin: BunTextFact | null;
  readonly encoding: number;
  readonly encodingName: "binary" | "latin1" | "utf8" | null;
  readonly loader: number;
  readonly loaderName: string | null;
  readonly moduleFormat: number;
  readonly moduleFormatName: (typeof MODULE_FORMATS)[number] | null;
  readonly side: number;
  readonly sideName: (typeof SIDES)[number] | null;
}

export interface BunDecodedGraph {
  readonly revision: BunLayoutRevision;
  readonly entryPointId: number;
  readonly flags: number;
  readonly compileExecArgv: BunTextFact;
  readonly modules: readonly BunDecodedModule[];
}

/**
 * Decode one located payload. Record size is selected by which known layout
 * is structurally valid. An unknown or ambiguous size is unsupported, not a
 * malformed graph. Flag bits stay raw: Bun 1.3 and 1.4 reuse the low bits.
 */
export const decodeBunModuleGraph = async (
  graph: LocatedBunGraph,
): Promise<BunDecodedGraph> => {
  const { data } = graph;
  const table = graph.modules;
  if (!pointerFits(data, table))
    throw bunFormatFailure("modules pointer exceeds the Bun module graph");
  if (table.length === 0) throw unsupported("the module table is empty");
  const candidates = recordSizes(table.length);
  if (candidates.length === 0)
    throw unsupported(
      `record table length ${String(table.length)} matches no known revision`,
    );
  // Count admission precedes table allocation, independently of payload size.
  if (candidates.every((size) => table.length / size > MAX_BUN_MODULE_COUNT))
    throw bunModuleCountLimit(table.length / Math.max(...candidates));
  const records = await data.read(table.offset, table.length);
  let recordBytes = candidates[0]!;
  if (candidates.length > 1) {
    const assessments = [];
    for (const recordBytes of candidates)
      assessments.push({
        recordBytes,
        failure: await assessLayout(
          data,
          records,
          recordBytes,
          graph.entryPointId,
        ),
      });
    const valid = assessments.filter((item) => item.failure === null);
    if (valid.length > 1)
      throw unsupported(
        `record table length ${String(table.length)} matches more than one known revision`,
      );
    const selected = valid[0] ?? assessments[0];
    if (selected === undefined || selected.failure !== null)
      throw (
        selected?.failure ??
        unsupported(
          `record table length ${String(table.length)} matches no known revision`,
        )
      );
    recordBytes = selected.recordBytes;
  }
  const count = table.length / recordBytes;
  if (graph.entryPointId >= count)
    throw bunFormatFailure(
      `entry_point_id ${String(graph.entryPointId)} is outside the module table`,
    );
  const revision: BunLayoutRevision =
    recordBytes === BUN_RECORD_BYTES_1_3_9 ? "bun-1.3.9" : "bun-1.3.3";
  if (!pointerFits(data, graph.compileExecArgv))
    throw bunFormatFailure(
      "compile_exec_argv pointer exceeds the Bun module graph",
    );
  const modules: BunDecodedModule[] = [];
  // Bound repeated pointer expansion before decoding strings. JSON escaping and
  // UTF-16 strings can expand each source byte; aliased names count per record.
  let retained = graph.compileExecArgv.length * 6;
  if (retained > MAX_BUN_RETAINED_BYTES) throw bunMetadataBytesLimit(retained);
  for (let index = 0; index < count; index += 1) {
    const record = records.subarray(
      index * recordBytes,
      (index + 1) * recordBytes,
    );
    retained += 512 + readPointer(record, 0).length * 6;
    if (recordBytes === BUN_RECORD_BYTES_1_3_9)
      retained += readPointer(record, 40).length * 6;
    if (retained > MAX_BUN_RETAINED_BYTES)
      throw bunMetadataBytesLimit(retained);
    if (index % 256 === 0) await setImmediate();
    if (candidates.length === 1) {
      const failure = await recordPointerFailure(
        data,
        record,
        recordBytes,
        false,
      );
      if (failure !== null) throw failure;
    }
    modules.push(await decodeRecord(data, record, index, revision));
  }
  return {
    revision,
    entryPointId: graph.entryPointId,
    flags: graph.flags,
    compileExecArgv: textFact(
      await readNul(data, graph.compileExecArgv, "compile_exec_argv"),
      true,
    ),
    modules,
  };
};

const recordSizes = (length: number): readonly number[] => {
  const sizes: number[] = [];
  if (length % BUN_RECORD_BYTES_1_3_3 === 0) sizes.push(BUN_RECORD_BYTES_1_3_3);
  if (length % BUN_RECORD_BYTES_1_3_9 === 0) sizes.push(BUN_RECORD_BYTES_1_3_9);
  return sizes;
};

const assessLayout = async (
  data: BunGraphData,
  records: Buffer,
  recordBytes: number,
  entryPointId: number,
): Promise<ArtifactReaderFailure | null> => {
  const count = records.length / recordBytes;
  if (count > MAX_BUN_MODULE_COUNT) return bunModuleCountLimit(count);
  for (let index = 0; index < count; index += 1) {
    const record = records.subarray(
      index * recordBytes,
      (index + 1) * recordBytes,
    );
    if (index % 256 === 0) await setImmediate();
    const failure = await recordPointerFailure(data, record, recordBytes);
    if (failure !== null) return failure;
  }
  if (entryPointId >= count)
    return bunFormatFailure(
      `entry_point_id ${String(entryPointId)} is outside the module table`,
    );
  return null;
};

const recordPointerFailure = async (
  data: BunGraphData,
  record: Buffer,
  recordBytes: number,
  verifyTextNuls = true,
): Promise<ArtifactReaderFailure | null> => {
  const fields: readonly (readonly [number, boolean, string])[] =
    recordBytes === BUN_RECORD_BYTES_1_3_9
      ? [
          [0, true, "name"],
          [8, true, "contents"],
          [16, false, "sourcemap"],
          [24, false, "bytecode"],
          [32, false, "module_info"],
          [40, true, "bytecode_origin"],
        ]
      : [
          [0, true, "name"],
          [8, true, "contents"],
          [16, false, "sourcemap"],
          [24, false, "bytecode"],
        ];
  for (const [offset, nul, label] of fields) {
    const failure = await pointerFailure(
      data,
      readPointer(record, offset),
      nul && (verifyTextNuls || offset === 8),
      label,
    );
    if (failure !== null) return failure;
  }
  return null;
};

const decodeRecord = async (
  data: BunGraphData,
  record: Buffer,
  index: number,
  revision: BunLayoutRevision,
): Promise<BunDecodedModule> => {
  const wide = revision === "bun-1.3.9";
  const metadataAt = wide ? 48 : 32;
  const encoding = record[metadataAt] ?? 0;
  const loader = record[metadataAt + 1] ?? 0;
  const moduleFormat = record[metadataAt + 2] ?? 0;
  const side = record[metadataAt + 3] ?? 0;
  const name = await readNul(data, readPointer(record, 0), "name");
  const contents = readPointer(record, 8);
  const sourcemap = optionalRange(readPointer(record, 16));
  const bytecode = optionalRange(readPointer(record, 24));
  const moduleInfo = wide ? optionalRange(readPointer(record, 32)) : null;
  const origin = wide
    ? textFact(
        await readNul(data, readPointer(record, 40), "bytecode_origin"),
        false,
      )
    : null;
  // Discriminant 2 was an unused Utf8 slot. Bun 1.4.4 reuses it, on the
  // 52-byte record only, for little-endian UTF-16. No version discriminator
  // distinguishes these meanings, so keep the wide layout value unnamed.
  const encodingName =
    encoding === 2
      ? wide
        ? null
        : "utf8"
      : named(["binary", "latin1"] as const, encoding);
  return {
    index,
    nameText: textFact(name, true),
    contents: { offset: contents.offset, length: contents.length },
    sourcemap,
    bytecode,
    moduleInfo,
    bytecodeOrigin:
      origin === null || (origin.text === null && origin.hex === null)
        ? null
        : origin,
    encoding,
    encodingName,
    loader,
    loaderName: named(LOADERS, loader),
    moduleFormat,
    moduleFormatName: named(MODULE_FORMATS, moduleFormat),
    side,
    sideName: named(SIDES, side),
  };
};

const optionalRange = (pointer: BunStringPointer): BunByteRange | null =>
  pointer.length === 0
    ? null
    : { offset: pointer.offset, length: pointer.length };

const named = <Names extends readonly string[]>(
  table: Names,
  value: number,
): Names[number] | null => table[value] ?? null;

const textFact = (bytes: Buffer, emptyIsText: boolean): BunTextFact => {
  if (bytes.length === 0)
    return emptyIsText ? { text: "", hex: null } : { text: null, hex: null };
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").equals(bytes)) return { text, hex: null };
  return { text: null, hex: bytes.toString("hex") };
};

const readNul = async (
  data: BunGraphData,
  pointer: BunStringPointer,
  label: string,
): Promise<Buffer> => {
  const end = pointer.offset + pointer.length;
  if (!pointerFits(data, pointer) || (pointer.length > 0 && end >= data.length))
    throw bunFormatFailure(`${label} pointer exceeds the Bun module graph`);
  const bytes = await data.read(
    pointer.offset,
    pointer.length + (pointer.length > 0 ? 1 : 0),
  );
  if (pointer.length > 0 && bytes[pointer.length] !== 0)
    throw bunFormatFailure(`${label} is missing its terminating NUL`);
  return bytes.subarray(0, pointer.length);
};

const pointerFits = (data: BunGraphData, pointer: BunStringPointer): boolean =>
  pointer.offset <= data.length &&
  pointer.offset + pointer.length <= data.length;

const pointerFailure = async (
  data: BunGraphData,
  pointer: BunStringPointer,
  nul: boolean,
  label: string,
): Promise<ArtifactReaderFailure | null> => {
  const end = pointer.offset + pointer.length;
  if (pointer.offset > data.length || end > data.length)
    return bunFormatFailure(`${label} pointer exceeds the Bun module graph`);
  if (!nul || pointer.length === 0) return null;
  if (end >= data.length)
    return bunFormatFailure(`${label} pointer exceeds the Bun module graph`);
  if ((await data.read(end, 1))[0] !== 0)
    return bunFormatFailure(`${label} is missing its terminating NUL`);
  return null;
};

const unsupported = (detail: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure(
    "unavailable",
    `Bun standalone module graph layout is unsupported: ${detail}`,
  );
