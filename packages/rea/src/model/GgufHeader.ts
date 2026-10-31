import { isUtf8 } from "node:buffer";
import { TextDecoder } from "node:util";
import { setImmediate } from "node:timers/promises";
import type { JsonValue } from "../domain/jsonValue.js";
import type {
  ModelMetadata,
  ModelTensor,
  ModelArtifactPartialTensor,
} from "../domain/model/modelArtifact.js";
import { ModelHeaderReader } from "./ModelHeaderReader.js";
import {
  MODEL_ARRAY_PREVIEW,
  MODEL_METADATA_NESTING,
  ModelFormatFailure,
  ModelReportBudget,
  rejectModel,
} from "./ModelFormat.js";
import { ggmlType } from "./ModelTensorTypes.js";

const NAMES = [
  "UINT8",
  "INT8",
  "UINT16",
  "INT16",
  "UINT32",
  "INT32",
  "FLOAT32",
  "BOOL",
  "STRING",
  "ARRAY",
  "UINT64",
  "INT64",
  "FLOAT64",
] as const;
const WIDTHS = [1, 1, 2, 2, 4, 4, 4, 1, 8, 12, 8, 8, 8];

export interface GgufProgress {
  onHeader(info: {
    version: number;
    byte_order: "little" | "big";
    declared_metadata_count: number;
    declared_tensor_count: number;
  }): void;
  onMetadata(row: ModelMetadata): void;
  onAlignment(alignment: number): void;
  onMetadataComplete(): void;
  onTensorsStarted(): void;
  onTensorDeclaration(row: ModelArtifactPartialTensor): void;
  onLimitation(message: string): void;
}

/** Explicit-endian GGUF v2/v3 metadata and tensor-directory parser. */
export class GgufHeader {
  #little = true;
  readonly #budget = new ModelReportBudget();
  constructor(readonly reader: ModelHeaderReader) {}

  async #unsigned(width: 4 | 8): Promise<number> {
    const b = await this.reader.take(width);
    const value =
      width === 4
        ? BigInt(this.#little ? b.readUInt32LE() : b.readUInt32BE())
        : this.#little
          ? b.readBigUInt64LE()
          : b.readBigUInt64BE();
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new ModelFormatFailure(
        "capacity",
        "Header length/count exceeds exact host offset precision",
        "exact-offset",
      );
    return Number(value);
  }

  async #text(retain: boolean, maximum?: number): Promise<string> {
    const length = await this.#unsigned(8);
    if (maximum !== undefined && length > maximum)
      rejectModel("GGUF name exceeds its format byte limit");
    if (retain) this.#budget.charge(6 * length + 2);
    this.reader.guarantee(length);
    // Omitted preview entries still need validation, but not decoded strings.
    // Keep the streaming decoder for values spanning multiple read chunks.
    if (!retain && length <= 65536) {
      if (!isUtf8(await this.reader.take(length)))
        rejectModel("GGUF string is not valid UTF-8");
      return "";
    }
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let result = "";
    try {
      for (let left = length; left > 0;) {
        const n = Math.min(left, 65536);
        const text = decoder.decode(await this.reader.take(n), {
          stream: true,
        });
        if (retain) result += text;
        left -= n;
      }
      const tail = decoder.decode();
      if (retain) result += tail;
    } catch (cause) {
      if (cause instanceof TypeError)
        rejectModel("GGUF string is not valid UTF-8");
      throw cause;
    }
    return result;
  }

  async #value(
    type: number,
    retain: boolean,
    depth = 0,
  ): Promise<{
    value: JsonValue;
    element_type: string | null;
    element_count: number | null;
    complete: boolean;
  }> {
    if (NAMES[type] === undefined)
      rejectModel(`Unknown GGUF metadata type ${String(type)}`);
    if (depth > MODEL_METADATA_NESTING)
      throw new ModelFormatFailure(
        "capacity",
        `GGUF metadata nesting exceeds ${String(MODEL_METADATA_NESTING)} array frames`,
        "metadata-nesting",
      );
    if (type === 8)
      return {
        value: await this.#text(retain),
        element_type: null,
        element_count: null,
        complete: true,
      };
    if (type === 9) {
      const element = await this.#unsigned(4);
      const count = await this.#unsigned(8);
      const minimum = WIDTHS[element];
      if (minimum === undefined)
        rejectModel(`Unknown GGUF array element type ${String(element)}`);
      this.reader.guarantee(count * minimum);
      const preview: JsonValue[] = [];
      if (retain)
        this.#budget.charge(128 + Math.min(count, MODEL_ARRAY_PREVIEW) * 64);
      let complete = count <= MODEL_ARRAY_PREVIEW;
      for (let index = 0; index < count; index++) {
        if (index % 4096 === 4095) await setImmediate();
        this.reader.guarantee((count - index) * minimum);
        if (
          element !== 8 &&
          element !== 9 &&
          (!retain || index >= MODEL_ARRAY_PREVIEW)
        ) {
          let left = (count - index) * minimum;
          while (left > 0) {
            const size = Math.min(left, 65536);
            const bytes = await this.reader.take(size);
            if (element === 7 && bytes.some((byte) => byte !== 0 && byte !== 1))
              rejectModel("GGUF boolean must be 0 or 1");
            left -= size;
          }
          break;
        }
        const keep = retain && index < MODEL_ARRAY_PREVIEW;
        const value = await this.#value(element, keep, depth + 1);
        if (keep)
          preview.push(
            element === 9
              ? {
                  type: "ARRAY",
                  element_type: value.element_type,
                  element_count: value.element_count,
                  preview: value.value,
                  preview_complete: value.complete,
                }
              : value.value,
          );
        complete &&= value.complete;
      }
      return {
        value: preview,
        element_type: NAMES[element] ?? null,
        element_count: count,
        complete,
      };
    }
    const b = await this.reader.take(WIDTHS[type] ?? 0);
    let value: JsonValue;
    switch (type) {
      case 0:
        value = b.readUInt8();
        break;
      case 1:
        value = b.readInt8();
        break;
      case 2:
        value = this.#little ? b.readUInt16LE() : b.readUInt16BE();
        break;
      case 3:
        value = this.#little ? b.readInt16LE() : b.readInt16BE();
        break;
      case 4:
        value = this.#little ? b.readUInt32LE() : b.readUInt32BE();
        break;
      case 5:
        value = this.#little ? b.readInt32LE() : b.readInt32BE();
        break;
      case 6:
        value = this.#little ? b.readFloatLE() : b.readFloatBE();
        break;
      case 7:
        if (b[0] !== 0 && b[0] !== 1)
          rejectModel("GGUF boolean must be 0 or 1");
        value = b[0] === 1;
        break;
      case 10:
        value = (
          this.#little ? b.readBigUInt64LE() : b.readBigUInt64BE()
        ).toString();
        break;
      case 11:
        value = (
          this.#little ? b.readBigInt64LE() : b.readBigInt64BE()
        ).toString();
        break;
      case 12:
        value = this.#little ? b.readDoubleLE() : b.readDoubleBE();
        break;
      default:
        return rejectModel("Unsupported GGUF scalar");
    }
    if (Object.is(value, -0)) value = "-0";
    if (typeof value === "number" && !Number.isFinite(value))
      value = Number.isNaN(value)
        ? "NaN"
        : value > 0
          ? "+Infinity"
          : "-Infinity";
    return {
      value: retain ? value : null,
      element_type: null,
      element_count: null,
      complete: true,
    };
  }

  async read(progress?: GgufProgress): Promise<{
    version: number;
    byte_order: "little" | "big";
    alignment: number;
    tensor_data_offset: number;
    metadata: ModelMetadata[];
    tensors: ModelTensor[];
    limitations: string[];
  }> {
    const versionBytes = await this.reader.take(4);
    const littleVersion = versionBytes.readUInt32LE();
    const bigVersion = versionBytes.readUInt32BE();
    let version: number;
    if (littleVersion === 2 || littleVersion === 3) {
      this.#little = true;
      version = littleVersion;
    } else if (bigVersion === 2 || bigVersion === 3) {
      this.#little = false;
      version = bigVersion;
    } else {
      throw new ModelFormatFailure(
        "unsupported",
        `GGUF version bytes ${versionBytes.toString("hex")} are unsupported (little-endian ${String(littleVersion)}, big-endian ${String(bigVersion)}; byte order unknown); supported versions are 2 and 3`,
      );
    }
    if (!this.#little && version !== 3)
      rejectModel("Big-endian GGUF requires version 3");
    const tensorCount = await this.#unsigned(8);
    const metadataCount = await this.#unsigned(8);
    progress?.onHeader({
      version,
      byte_order: this.#little ? "little" : "big",
      declared_metadata_count: metadataCount,
      declared_tensor_count: tensorCount,
    });
    this.#budget.charge((tensorCount + metadataCount) * 512);
    this.reader.guarantee(tensorCount * 20 + metadataCount * 13);
    const metadata: ModelMetadata[] = [];
    const keys = new Set<string>();
    let alignment = 32;
    for (let index = 0; index < metadataCount; index++) {
      this.reader.guarantee((metadataCount - index) * 13 + tensorCount * 20);
      const start = this.reader.position;
      const key = await this.#text(true, 65535);
      // Numeric hierarchy components occur in standardized base_model.{id} keys.
      if (
        !/^[a-z0-9]+(?:[_-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[_-][a-z0-9]+)*)*$/u.test(
          key,
        )
      )
        rejectModel(
          "GGUF metadata keys require lowercase ASCII hierarchy components",
        );
      if (keys.has(key)) rejectModel(`Duplicate GGUF metadata key ${key}`);
      keys.add(key);
      const type = await this.#unsigned(4);
      const parsed = await this.#value(type, true);
      const row = {
        index,
        key,
        type: NAMES[type] ?? String(type),
        value: parsed.value,
        element_type: parsed.element_type,
        element_count: parsed.element_count,
        preview_complete: parsed.complete,
        source_offset: start,
        source_length: this.reader.position - start,
        json_pointer: null,
      } satisfies ModelMetadata;
      if (key === "general.alignment") {
        if (
          type !== 4 ||
          typeof parsed.value !== "number" ||
          parsed.value === 0 ||
          parsed.value % 8 !== 0
        )
          rejectModel(
            "GGUF general.alignment must be a positive UINT32 multiple of eight",
          );
        alignment = parsed.value;
        progress?.onAlignment(alignment);
      }
      metadata.push(row);
      progress?.onMetadata(row);
    }
    if (!keys.has("general.alignment")) progress?.onAlignment(alignment);
    progress?.onMetadataComplete();
    progress?.onTensorsStarted();
    const tensors: ModelArtifactPartialTensor[] = [];
    const names = new Set<string>();
    const limitations = new Set<string>();
    const note = (message: string): void => {
      if (limitations.has(message)) return;
      limitations.add(message);
      progress?.onLimitation(message);
    };
    for (let index = 0; index < tensorCount; index++) {
      this.reader.guarantee((tensorCount - index) * 20);
      const start = this.reader.position;
      const name = await this.#text(true, 64);
      if (names.has(name)) rejectModel(`Duplicate GGUF tensor name ${name}`);
      names.add(name);
      const dimensions = await this.#unsigned(4);
      if (dimensions > 4)
        rejectModel("GGUF tensor dimension count must be at most 4");
      const shape: string[] = [];
      let parameters = 1n;
      for (let d = 0; d < dimensions; d++) {
        const b = await this.reader.take(8);
        const value = this.#little ? b.readBigUInt64LE() : b.readBigUInt64BE();
        shape.push(value.toString());
        parameters *= value;
      }
      const id = await this.#unsigned(4);
      const offset = await this.#unsigned(8);
      if (offset % alignment !== 0)
        rejectModel(`GGUF tensor ${name} offset is not aligned`);
      const type = ggmlType(id);
      let length: number | null = null;
      if (type !== undefined) {
        const [, rowElementMultiple, blockBytes, limitation] = type;
        if (BigInt(shape[0] ?? "1") % BigInt(rowElementMultiple) !== 0n)
          rejectModel(
            `GGUF tensor ${name} first dimension must be a multiple of ${String(rowElementMultiple)} elements`,
          );
        if (
          limitation !== undefined &&
          (parameters !== 0n || limitation.kind === "type-identity")
        )
          note(limitation.reason);
        if (parameters === 0n) length = 0;
        else if (blockBytes !== null) {
          const bytes =
            (parameters / BigInt(rowElementMultiple)) * BigInt(blockBytes);
          if (bytes > BigInt(this.reader.size))
            rejectModel(
              `GGUF tensor ${name} declared byte length exceeds the file`,
            );
          length = Number(bytes);
        }
      } else
        note(
          `Unknown tensor type UNKNOWN_${String(id)} prevents storage-size validation.`,
        );
      const tensor = {
        index,
        name,
        type: type?.[0] ?? `UNKNOWN_${String(id)}`,
        type_id: id,
        shape,
        data_offset: offset,
        file_offset: null,
        byte_length: length,
        parameter_count: parameters.toString(),
        byte_length_state: length === null ? "unknown" : "derived",
        storage_validation: "not-established",
        source_offset: start,
        source_length: this.reader.position - start,
        json_pointer: null,
      } satisfies ModelArtifactPartialTensor;
      tensors.push(tensor);
      progress?.onTensorDeclaration(tensor);
    }
    const directoryEnd = this.reader.position;
    const alignedDataOffset = Math.ceil(directoryEnd / alignment) * alignment;
    const tensor_data_offset =
      tensorCount === 0 && this.reader.size === directoryEnd
        ? directoryEnd
        : alignedDataOffset;
    if (tensor_data_offset > this.reader.size)
      rejectModel("GGUF tensor data section begins outside the file");
    for (const tensor of tensors) {
      const offset = BigInt(tensor_data_offset) + BigInt(tensor.data_offset);
      if (
        offset > BigInt(this.reader.size) ||
        offset + BigInt(tensor.byte_length ?? 0) > BigInt(this.reader.size)
      )
        rejectModel(`GGUF tensor ${tensor.name} range is outside the file`);
      tensor.file_offset = Number(offset);
    }
    const completeTensors: ModelTensor[] = tensors.map((tensor) => ({
      ...tensor,
      file_offset: tensor.file_offset!,
      storage_validation:
        tensor.byte_length === null ? "unknown" : "consistent",
    }));
    const intervals = completeTensors
      .filter((row) => row.byte_length !== null)
      .sort((a, b) => a.file_offset - b.file_offset);
    let end = tensor_data_offset;
    for (const row of intervals) {
      if (row.file_offset < end && row.byte_length !== 0)
        rejectModel(`Overlapping tensor byte ranges at ${row.name}`);
      end = Math.max(end, row.file_offset + (row.byte_length ?? 0));
    }
    return {
      version,
      byte_order: this.#little ? "little" : "big",
      alignment,
      tensor_data_offset,
      metadata,
      tensors: completeTensors,
      limitations: [...limitations],
    };
  }
}
