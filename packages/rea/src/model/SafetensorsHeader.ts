import { setImmediate } from "node:timers/promises";
import { assertArtifactReadActive } from "../artifacts/ArtifactFileOperation.js";
import { TextDecoder } from "node:util";
import type {
  ModelMetadata,
  ModelTensor,
} from "../domain/model/modelArtifact.js";
import { ModelHeaderReader } from "./ModelHeaderReader.js";
import {
  MODEL_HEADER_BYTES,
  MODEL_JSON_NESTING,
  ModelFormatFailure,
  ModelReportBudget,
  rejectModel,
  rejectPickle,
} from "./ModelFormat.js";
import { safetensorsBits } from "./ModelTensorTypes.js";

class JsonNumber {
  constructor(readonly raw: string) {}
}
type HeaderValue =
  | string
  | bigint
  | boolean
  | null
  | JsonNumber
  | HeaderValue[]
  | { [key: string]: HeaderValue };

/** The format's restricted JSON header, with duplicate keys and exact integer checks at its owner. */
class HeaderJson {
  #position = 0;
  #nodes = 0;
  constructor(
    readonly text: string,
    readonly budget: ModelReportBudget,
  ) {}
  #space(): void {
    while (" \t\r\n".includes(this.text[this.#position] ?? "x"))
      this.#position++;
  }
  #string(): string {
    const start = this.#position++;
    while (this.#position < this.text.length) {
      const c = this.text[this.#position++];
      if (c === "\\") this.#position++;
      else if (c === '"') {
        const raw = this.text.slice(start, this.#position);
        this.budget.charge(6 * raw.length + 2);
        try {
          const value: unknown = JSON.parse(raw);
          if (typeof value !== "string")
            return rejectModel("Invalid JSON string");
          for (const unit of value) {
            const code = unit.codePointAt(0) ?? 0;
            if (code >= 0xd800 && code <= 0xdfff)
              rejectModel("Safetensors JSON contains an unpaired surrogate");
          }
          return value;
        } catch (cause) {
          if (cause instanceof SyntaxError)
            rejectModel("Invalid safetensors JSON string");
          throw cause;
        }
      }
    }
    return rejectModel("Unterminated safetensors JSON string");
  }
  *#value(depth: number): Generator<void, HeaderValue> {
    if (++this.#nodes % 4096 === 0) yield;
    this.#space();
    this.budget.charge(64);
    if (depth > MODEL_JSON_NESTING)
      throw new ModelFormatFailure(
        "capacity",
        `Safetensors JSON nesting exceeds ${String(MODEL_JSON_NESTING)} levels`,
        "json-nesting",
      );
    const c = this.text[this.#position];
    if (c === '"') return this.#string();
    if (this.text.startsWith("null", this.#position)) {
      this.#position += 4;
      return null;
    }
    if (this.text.startsWith("true", this.#position)) {
      this.#position += 4;
      return true;
    }
    if (this.text.startsWith("false", this.#position)) {
      this.#position += 5;
      return false;
    }
    if (c === "{" || c === "[") {
      this.#position++;
      const object: { [key: string]: HeaderValue } = Object.create(null) as {
        [key: string]: HeaderValue;
      };
      const array: HeaderValue[] = [];
      const close = c === "{" ? "}" : "]";
      this.#space();
      if (this.text[this.#position] === close) {
        this.#position++;
        return c === "{" ? object : array;
      }
      while (true) {
        this.#space();
        if (c === "{") {
          if (this.text[this.#position] !== '"')
            rejectModel("Expected safetensors JSON object key");
          const key = this.#string();
          if (Object.hasOwn(object, key))
            rejectModel(`Duplicate safetensors JSON key ${key}`);
          this.#space();
          if (this.text[this.#position++] !== ":")
            rejectModel("Expected safetensors JSON colon");
          object[key] = yield* this.#value(depth + 1);
        } else array.push(yield* this.#value(depth + 1));
        this.#space();
        const next = this.text[this.#position++];
        if (next === close) return c === "{" ? object : array;
        if (next !== ",") rejectModel("Invalid safetensors JSON container");
      }
    }
    const start = this.#position;
    if (this.text[this.#position] === "-") this.#position++;
    const integerStart = this.#position;
    if (this.text[this.#position] === "0") this.#position++;
    else if (/^[1-9]$/u.test(this.text[this.#position] ?? "")) {
      this.#position++;
      while (/^[0-9]$/u.test(this.text[this.#position] ?? "")) this.#position++;
    }
    if (this.#position === integerStart)
      return rejectModel("Invalid safetensors JSON value");
    if (this.text[this.#position] === ".") {
      this.#position++;
      const fractionStart = this.#position;
      while (/^[0-9]$/u.test(this.text[this.#position] ?? "")) this.#position++;
      if (this.#position === fractionStart)
        return rejectModel("Invalid safetensors JSON value");
    }
    if (/[eE]/u.test(this.text[this.#position] ?? "")) {
      this.#position++;
      if (/[+-]/u.test(this.text[this.#position] ?? "")) this.#position++;
      const exponentStart = this.#position;
      while (/^[0-9]$/u.test(this.text[this.#position] ?? "")) this.#position++;
      if (this.#position === exponentStart)
        return rejectModel("Invalid safetensors JSON value");
    }
    const numeric = this.text.slice(start, this.#position);
    if (/^(?:0|[1-9][0-9]*)$/u.test(numeric)) {
      if (numeric.length > 20) return new JsonNumber(numeric);
      const integer = BigInt(numeric);
      if (integer <= 0xffffffffffffffffn) return integer;
    }
    return new JsonNumber(numeric);
  }
  *read(): Generator<void, HeaderValue> {
    if (this.text[0] !== "{")
      rejectModel("Safetensors header must begin with a JSON object");
    const value = yield* this.#value(0);
    this.#space();
    if (this.#position !== this.text.length)
      rejectModel("Trailing non-whitespace safetensors header bytes");
    return value;
  }
}

const objectOf = (
  value: HeaderValue | undefined,
): { [key: string]: HeaderValue } => {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof JsonNumber
  )
    return rejectModel("Expected safetensors header object");
  return value;
};
const integersOf = (value: HeaderValue | undefined): bigint[] => {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is bigint => typeof item === "bigint")
  )
    return rejectModel("Expected safetensors integer array");
  return value;
};
const exactOffset = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ModelFormatFailure(
      "capacity",
      "Safetensors data offset exceeds exact host offset precision",
      "exact-offset",
    );
  return Number(value);
};
const pointer = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

export const readSafetensorsHeader = async (
  reader: ModelHeaderReader,
  first: Buffer,
): Promise<{
  version: null;
  byte_order: "little";
  alignment: null;
  tensor_data_offset: number;
  metadata: ModelMetadata[];
  tensors: ModelTensor[];
  limitations: string[];
}> => {
  const budget = new ModelReportBudget();
  // Lengths such as 640 (80 02 ...) also begin like a pickle PROTO opcode.
  const protocol = first[1] ?? 0;
  const pickle = first[0] === 0x80 && protocol >= 2 && protocol <= 5;
  // ZIP's four-byte signature is also a valid little-endian header length.
  const zip = first.equals(Buffer.from([0x50, 0x4b, 3, 4]));
  if ((pickle || zip) && reader.size < 9) rejectPickle();
  const second = await reader.take(4);
  reader.excludeSafetensorsLengthPrefix();
  const length =
    BigInt(first.readUInt32LE()) + (BigInt(second.readUInt32LE()) << 32n);
  const brace = length === 0n ? undefined : (await reader.take(1))[0];
  // A brace after an admissible length is safetensors, even if truncated.
  if (
    (pickle || zip) &&
    (brace !== 0x7b || length > BigInt(MODEL_HEADER_BYTES))
  )
    rejectPickle();
  if (brace !== 0x7b)
    rejectModel("File does not contain a GGUF or safetensors header");
  if (length > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ModelFormatFailure(
      "capacity",
      "Safetensors header length exceeds exact host offset precision",
      "exact-offset",
    );
  const size = Number(length);
  reader.guarantee(size - 1);
  // Native UTF-8 decode and the bounded JSON parser both retain header text.
  budget.charge(2 * size);
  let text: string;
  try {
    text =
      "{" +
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await reader.take(size - 1),
      );
  } catch (cause) {
    if (cause instanceof TypeError)
      rejectModel("Safetensors header is not valid UTF-8");
    throw cause;
  }
  const steps = new HeaderJson(text, budget).read();
  let step = steps.next();
  while (!step.done) {
    await setImmediate();
    assertArtifactReadActive(reader.signal);
    step = steps.next();
  }
  const root = objectOf(step.value);
  const source = { source_offset: 8, source_length: size };
  const metadata: ModelMetadata[] = [];
  if (Object.hasOwn(root, "__metadata__") && root.__metadata__ !== null) {
    for (const [key, value] of Object.entries(objectOf(root.__metadata__))) {
      if (typeof value !== "string")
        rejectModel("Safetensors __metadata__ values must be strings");
      metadata.push({
        index: metadata.length,
        key,
        type: "STRING",
        value,
        element_type: null,
        element_count: null,
        preview_complete: true,
        ...source,
        json_pointer: `/__metadata__/${pointer(key)}`,
      });
    }
  }
  const tensors: ModelTensor[] = [];
  const unknownTypes = new Set<string>();
  const tensor_data_offset = 8 + size;
  const names = Object.keys(root)
    .filter((name) => name !== "__metadata__")
    .sort();
  budget.charge(names.length * 512);
  for (const name of names) {
    const entry = objectOf(root[name]);
    if (
      !Object.hasOwn(entry, "dtype") ||
      !Object.hasOwn(entry, "shape") ||
      !Object.hasOwn(entry, "data_offsets")
    )
      rejectModel(
        `Safetensors tensor ${name} must declare dtype, shape and data_offsets`,
      );
    const type = entry.dtype;
    if (typeof type !== "string")
      rejectModel(`Safetensors tensor ${name} dtype must be a string`);
    const shape = integersOf(entry.shape);
    const offsets = integersOf(entry.data_offsets);
    if (offsets.length !== 2)
      rejectModel(`Safetensors tensor ${name} requires two data offsets`);
    const start = exactOffset(offsets[0] ?? 0n);
    const end = exactOffset(offsets[1] ?? 0n);
    if (end < start || end > reader.size - tensor_data_offset)
      rejectModel(
        `Safetensors tensor ${name} range [${String(start)},${String(end)}) is outside the data buffer`,
      );
    let parameters = 1n;
    for (const dimension of shape) {
      parameters *= dimension;
      if (parameters > 0xffffffffffffffffn)
        rejectModel(
          `Safetensors tensor ${name} parameter count overflows uint64`,
        );
    }
    const bits = safetensorsBits(type);
    if (bits === undefined) unknownTypes.add(type);
    if (bits !== undefined) {
      const expected = parameters * BigInt(bits);
      if (expected % 8n !== 0n || expected / 8n !== BigInt(end - start))
        rejectModel(
          `Safetensors tensor ${name} byte length does not match dtype and shape`,
        );
    }
    tensors.push({
      index: tensors.length,
      name,
      type,
      type_id: null,
      shape: shape.map(String),
      data_offset: start,
      file_offset: tensor_data_offset + start,
      byte_length: end - start,
      parameter_count: parameters.toString(),
      byte_length_state: "declared",
      storage_validation: bits === undefined ? "unknown" : "consistent",
      ...source,
      json_pointer: `/${pointer(name)}`,
    });
  }
  const ordered = [...tensors].sort(
    (a, b) =>
      a.data_offset - b.data_offset ||
      (a.byte_length ?? 0) - (b.byte_length ?? 0),
  );
  let end = 0;
  for (const tensor of ordered) {
    if (tensor.data_offset !== end)
      rejectModel(
        `Safetensors data ${tensor.data_offset < end ? "overlap" : "gap"} before ${tensor.name}: expected ${String(end)}, observed ${String(tensor.data_offset)}`,
      );
    end = tensor.data_offset + (tensor.byte_length ?? 0);
  }
  if (end !== reader.size - tensor_data_offset)
    rejectModel(
      `Safetensors unindexed trailing data: ${String(reader.size - tensor_data_offset - end)} bytes`,
    );
  return {
    version: null,
    byte_order: "little",
    alignment: null,
    tensor_data_offset,
    metadata,
    tensors,
    limitations:
      unknownTypes.size === 0
        ? []
        : [
            `Unknown tensor types prevent storage-size validation: ${[...unknownTypes].join(", ")}`,
          ],
  };
};
