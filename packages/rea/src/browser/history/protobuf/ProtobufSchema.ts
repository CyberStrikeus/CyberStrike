import { err, ok, type Result } from "../../../domain/result.js";
import {
  createFileRegistry,
  createRegistry,
  equals,
  fromBinary,
  ScalarType,
  type DescField,
  type DescEnum,
  type DescMessage,
} from "@bufbuild/protobuf";
import {
  FileDescriptorSetSchema,
  FileDescriptorProtoSchema,
  type FileDescriptorProto,
  type DescriptorProto,
  type FileDescriptorSet,
} from "@bufbuild/protobuf/wkt";
import { BinaryReader } from "@bufbuild/protobuf/wire";
import type { ProtobufField } from "../../../domain/protobufWire.js";
import { WEB_NETWORK_CAPTURE_LIMITS } from "../../../domain/webNetworkCapture.js";
import { CaptureFormatError } from "../CaptureFormatError.js";
import {
  decodeProtobufWire,
  readProtobufVarint,
  type ProtobufBudget,
  type WireSchema,
} from "./ProtobufWire.js";

export type ProtobufSchemaAdmissionFailure =
  | {
      readonly kind: "malformed-descriptor";
      readonly field: "descriptor_set_path";
      readonly message: string;
    }
  | {
      readonly kind: "missing-message";
      readonly field: "message_type";
      readonly message: string;
    };

const scalarWire = (scalar: ScalarType): ProtobufField["wire_type"] => {
  if (scalar === ScalarType.STRING || scalar === ScalarType.BYTES) return "len";
  if (
    [ScalarType.DOUBLE, ScalarType.FIXED64, ScalarType.SFIXED64].includes(
      scalar,
    )
  )
    return "i64";
  if (
    [ScalarType.FLOAT, ScalarType.FIXED32, ScalarType.SFIXED32].includes(scalar)
  )
    return "i32";
  return "varint";
};

const floatingValue = (value: number): string =>
  Object.is(value, -0) ? "-0" : String(value);

// Descriptor custom options and future fields remain opaque identity facts.
const descriptorEquality = { registry: createRegistry(), unknown: true };

const chargeQualifiedName = (
  budget: ProtobufBudget,
  name: string,
  prefix: string,
) => budget.charge((prefix.length + 1 + name.length) * 8 + 128);

const admitMessageFields = (
  message: DescriptorProto,
  qualified: string,
  budget: ProtobufBudget,
): Result<undefined, ProtobufSchemaAdmissionFailure> => {
  budget.charge(message.field.length * 64);
  const fieldNumbers = new Set<number>();
  const fieldNames = new Set<string>();
  for (const field of message.field) {
    chargeQualifiedName(budget, field.name, qualified);
    if (
      field.number < 1 ||
      field.number > 0x1fffffff ||
      (field.number >= 19000 && field.number <= 19999)
    )
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Invalid field number ${field.number} in descriptor message ${message.name}`,
      });
    if (fieldNames.has(field.name))
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Duplicate field name ${field.name} in descriptor message ${message.name}`,
      });
    if (fieldNumbers.has(field.number))
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Duplicate field number ${field.number} in descriptor message ${message.name}`,
      });
    fieldNumbers.add(field.number);
    fieldNames.add(field.name);
  }
  return ok(undefined);
};

/** Admit descriptor identities and bound qualified names before registry construction. */
const admitRegistryDescriptor = async (
  descriptor: FileDescriptorSet,
  budget: ProtobufBudget,
): Promise<Result<FileDescriptorSet, ProtobufSchemaAdmissionFailure>> => {
  const files = new Map<string, FileDescriptorProto>();
  const registryNames = new Set<string>();
  const duplicateType: ProtobufSchemaAdmissionFailure = {
    kind: "malformed-descriptor",
    field: "descriptor_set_path",
    message: "Duplicate fully qualified type name in FileDescriptorSet",
  };
  const admitTypeName = (name: string, prefix: string): string | null => {
    chargeQualifiedName(budget, name, prefix);
    budget.charge(32);
    const qualified = prefix === "" ? name : `${prefix}.${name}`;
    if (registryNames.has(qualified)) return null;
    registryNames.add(qualified);
    return qualified;
  };
  for (const file of descriptor.file) {
    await budget.checkpoint();
    budget.charge(file.name.length * 8 + 128);
    const previous = files.get(file.name);
    if (previous !== undefined) {
      if (
        !equals(FileDescriptorProtoSchema, previous, file, descriptorEquality)
      )
        return err({
          kind: "malformed-descriptor",
          field: "descriptor_set_path",
          message: "Conflicting file identity in FileDescriptorSet",
        });
      continue;
    }
    files.set(file.name, file);
    const stack = file.messageType.map((message) => ({
      message,
      prefix: file.package,
    }));
    for (const enumeration of file.enumType)
      if (admitTypeName(enumeration.name, file.package) === null)
        return err(duplicateType);
    for (const extension of file.extension)
      if (admitTypeName(extension.name, file.package) === null)
        return err(duplicateType);
    for (const service of file.service) {
      const qualified = admitTypeName(service.name, file.package);
      if (qualified === null) return err(duplicateType);
      for (const method of service.method)
        chargeQualifiedName(budget, method.name, qualified);
    }
    while (stack.length > 0) {
      await budget.checkpoint();
      const { message, prefix } = stack.pop()!;
      const qualified = admitTypeName(message.name, prefix);
      if (qualified === null) return err(duplicateType);
      const fields = admitMessageFields(message, qualified, budget);
      if (!fields.ok) return fields;
      for (const extension of message.extension)
        if (admitTypeName(extension.name, qualified) === null)
          return err(duplicateType);
      for (const enumeration of message.enumType)
        if (admitTypeName(enumeration.name, qualified) === null)
          return err(duplicateType);
      for (const nested of message.nestedType)
        stack.push({ message: nested, prefix: qualified });
    }
  }
  return ok({ ...descriptor, file: [...files.values()] });
};

const scalarValue = (reader: BinaryReader, scalar: ScalarType): string => {
  switch (scalar) {
    case ScalarType.DOUBLE:
      return floatingValue(reader.double());
    case ScalarType.FLOAT:
      return floatingValue(reader.float());
    case ScalarType.INT64:
      return String(reader.int64());
    case ScalarType.UINT64:
      return String(reader.uint64());
    case ScalarType.INT32:
      return String(reader.int32());
    case ScalarType.FIXED64:
      return String(reader.fixed64());
    case ScalarType.FIXED32:
      return String(reader.fixed32());
    case ScalarType.BOOL:
      return String(reader.bool());
    case ScalarType.UINT32:
      return String(reader.uint32());
    case ScalarType.SFIXED32:
      return String(reader.sfixed32());
    case ScalarType.SFIXED64:
      return String(reader.sfixed64());
    case ScalarType.SINT32:
      return String(reader.sint32());
    case ScalarType.SINT64:
      return String(reader.sint64());
    default:
      throw new Error("Not a numeric protobuf scalar");
  }
};

/** The supplied schema interprets occurrences; it never overwrites raw wire facts. */
export class ProtobufSchema implements WireSchema {
  readonly #fields = new Map<DescMessage, ReadonlyMap<number, DescField>>();
  readonly #messages = new Map<number, DescMessage>();
  readonly #enums = new WeakMap<
    DescEnum,
    ReadonlyMap<string, readonly string[]>
  >();
  constructor(
    readonly message: DescMessage,
    readonly budget: ProtobufBudget,
    readonly redact: (text: string) => string,
  ) {}

  static async read(
    bytes: Uint8Array,
    typeName: string,
    budget: ProtobufBudget,
    redact: (text: string) => string,
  ): Promise<Result<ProtobufSchema, ProtobufSchemaAdmissionFailure>> {
    // Bound the object expansion of the descriptor before the SDK allocates its message tree.
    const checked = await decodeProtobufWire(
      bytes,
      0,
      bytes.length,
      0,
      budget,
      redact,
      new ProtobufSchema(FileDescriptorSetSchema, budget, redact),
    );
    const invalidField = checked.fields.find(
      (field) => field.schema_status === "invalid-message",
    );
    const wireError =
      checked.error ??
      (invalidField === undefined
        ? undefined
        : (invalidField.schema_error ?? {
            offset: invalidField.offset,
            reason: "Invalid descriptor message",
          }));
    if (wireError !== undefined)
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Malformed FileDescriptorSet wire format at byte ${wireError.offset}: ${wireError.reason}`,
      });
    let descriptor: FileDescriptorSet;
    try {
      descriptor = fromBinary(FileDescriptorSetSchema, bytes, {
        readUnknownFields: true,
        recursionLimit: WEB_NETWORK_CAPTURE_LIMITS.depth,
      });
    } catch (cause) {
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Malformed FileDescriptorSet: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    const admitted = await admitRegistryDescriptor(descriptor, budget);
    if (!admitted.ok) return admitted;
    let message: DescMessage | undefined;
    try {
      message = createFileRegistry(admitted.value).getMessage(
        typeName.replace(/^\./, ""),
      );
    } catch (cause) {
      return err({
        kind: "malformed-descriptor",
        field: "descriptor_set_path",
        message: `Invalid FileDescriptorSet declaration: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
    if (message === undefined)
      return err({
        kind: "missing-message",
        field: "message_type",
        message: `The supplied descriptor set does not define the selected message type ${typeName}`,
      });
    return ok(new ProtobufSchema(message, budget, redact));
  }

  reset(): void {
    this.#messages.clear();
  }

  nested(field: ProtobufField): boolean {
    return this.#messages.has(field.index);
  }

  async annotate(
    field: ProtobufField,
    bytes: Uint8Array,
    parent: ProtobufField | undefined,
  ): Promise<void> {
    const message =
      parent === undefined ? this.message : this.#messages.get(parent.index);
    if (message === undefined) return;
    let fields = this.#fields.get(message);
    if (fields === undefined) {
      fields = new Map(message.fields.map((item) => [item.number, item]));
      this.#fields.set(message, fields);
    }
    const desc = fields.get(field.number);
    if (desc === undefined) {
      field.schema_status = "unknown-field";
      return;
    }
    this.budget.charge(
      8 *
        (desc.name.length +
          (desc.message?.typeName.length ?? 0) +
          (desc.enum?.typeName.length ?? 0)),
    );
    field.schema_name = this.redact(desc.name);
    field.schema_status = "decoded";
    if (desc.fieldKind === "map") {
      field.schema_type = "map";
      field.schema_status = "unsupported";
      return;
    }
    if (desc.message !== undefined) {
      field.schema_type = this.redact(desc.message.typeName);
      const expected = desc.delimitedEncoding ? "group" : "len";
      if (field.wire_type !== expected)
        field.schema_status = "wire-type-mismatch";
      else this.#messages.set(field.index, desc.message);
      return;
    }
    const scalar = desc.enum === undefined ? desc.scalar : ScalarType.INT32;
    if (scalar === undefined) {
      field.schema_status = "unsupported";
      return;
    }
    field.schema_type =
      desc.enum === undefined
        ? ScalarType[scalar].toLowerCase()
        : this.redact(desc.enum.typeName);
    const packed =
      desc.fieldKind === "list" &&
      field.wire_type === "len" &&
      scalar !== ScalarType.STRING &&
      scalar !== ScalarType.BYTES;
    if (!packed && field.wire_type !== scalarWire(scalar)) {
      field.schema_status = "wire-type-mismatch";
      return;
    }
    const payload = bytes.subarray(
      field.payload_offset,
      field.payload_offset + field.payload_bytes,
    );
    try {
      if (scalar === ScalarType.BYTES) return; // Exact bytes already have an accessible source range.
      if (scalar === ScalarType.STRING) {
        // Wire decoding owns UTF-8 (including BOM) and literal exclusions.
        // Reuse that fact; charge only its additional serialized representation.
        this.budget.charge(payload.length * 6);
        if (field.text === undefined)
          field.schema_status = "wire-type-mismatch";
        else field.schema_value = field.text;
        return;
      }
      const reader = new BinaryReader(payload);
      const enumValues = new Map<string, readonly string[]>();
      const read = () => {
        if (
          scalarWire(scalar) === "varint" &&
          readProtobufVarint(payload, reader.pos) === undefined
        )
          throw new Error("Invalid packed varint");
        const value = scalarValue(reader, scalar);
        if (desc.enum !== undefined) {
          let names = this.#enums.get(desc.enum);
          if (names === undefined) {
            this.budget.charge(desc.enum.values.length * 256);
            const indexed = new Map<string, string[]>();
            for (const item of desc.enum.values) {
              const number = String(item.number);
              const aliases = indexed.get(number) ?? [];
              aliases.push(item.name);
              indexed.set(number, aliases);
            }
            names = indexed;
            this.#enums.set(desc.enum, names);
          }
          const aliases = names.get(value);
          if (aliases !== undefined && !enumValues.has(value)) {
            this.budget.charge(
              256 + aliases.reduce((sum, name) => sum + name.length * 8, 0),
            );
            enumValues.set(value, aliases.map(this.redact));
          }
        }
        return value;
      };
      if (packed) {
        const values: string[] = [];
        while (reader.pos < reader.len) {
          await this.budget.checkpoint();
          this.budget.charge(192);
          values.push(this.redact(read()));
        }
        field.schema_value = JSON.stringify(values);
      } else field.schema_value = this.redact(read());
      if (enumValues.size > 0)
        field.schema_enum_values = [...enumValues].map(([number, names]) => ({
          number: this.redact(number),
          names: [...names],
        }));
    } catch (cause) {
      if (cause instanceof CaptureFormatError) throw cause;
      if (this.budget.signal?.aborted && cause === this.budget.signal.reason)
        throw cause;
      field.schema_status = "wire-type-mismatch";
    }
  }
}
