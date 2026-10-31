import { readBinaryPlistLayout } from "./BinaryPlistLayout.js";
import { parseBinary } from "plist";
import { markPlistDictionary } from "../../domain/apple/plistUid.js";
import {
  decodeBinaryPlistScalars,
  scanBinaryPlistScalars,
  type BinaryPlistScalarMetadata,
} from "./PlistScalars.js";
import type { PlistDecodePreflight } from "./PropertyListDecodeBudget.js";

/** Build one array of source scalar references; upstream never constructs a dictionary. */
const scalarArrayInput = (
  bytes: Buffer,
  objects: readonly number[],
): Buffer => {
  // Normalization may relocate objects and change both widths. These facts
  // belong to the compatible decoder copy, not the original source plan.
  const compatibleLayoutResult = readBinaryPlistLayout(bytes);
  if (!compatibleLayoutResult.ok)
    throw new RangeError("binary plist trailer is truncated");
  const compatibleLayout = compatibleLayoutResult.value;
  const referenceWidth = compatibleLayout.referenceWidth;
  const objectCount = Number(compatibleLayout.objectCount);
  const rootOffset = bytes.length;
  const rootLength = 10 + objects.length * referenceWidth;
  const tableOffset = rootOffset + rootLength;
  const output = Buffer.alloc(tableOffset + (objectCount + 1) * 8 + 32);
  bytes.copy(output);
  output[rootOffset] = 0xaf;
  output[rootOffset + 1] = 0x13;
  output.writeBigUInt64BE(BigInt(objects.length), rootOffset + 2);
  for (const [index, object] of objects.entries()) {
    let reference = BigInt(object);
    const offset = rootOffset + 10 + index * referenceWidth;
    for (let byte = referenceWidth - 1; byte >= 0; byte -= 1) {
      output[offset + byte] = Number(reference & 0xffn);
      reference >>= 8n;
    }
  }
  let object = 0;
  for (const offset of compatibleLayout.objectOffsets()) {
    output.writeBigUInt64BE(offset, tableOffset + object * 8);
    object += 1;
  }
  output.writeBigUInt64BE(BigInt(rootOffset), tableOffset + objectCount * 8);
  const nextTrailer = output.length - 32;
  output[nextTrailer + 6] = 8;
  output[nextTrailer + 7] = referenceWidth;
  output.writeBigUInt64BE(BigInt(objectCount + 1), nextTrailer + 8);
  output.writeBigUInt64BE(BigInt(objectCount), nextTrailer + 16);
  output.writeBigUInt64BE(BigInt(tableOffset), nextTrailer + 24);
  return output;
};

/** Preserve each source reference's scalar identity while retaining upstream scalar semantics. */
const scalarOccurrence = (
  value: unknown,
  uid: boolean,
  identity: boolean,
): unknown => {
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Uint8Array)
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (uid && value !== null && typeof value === "object") {
    const copy = { ...value };
    if (identity) markPlistDictionary(copy, (value as { UID: number }).UID);
    return copy;
  }
  return value;
};

/** Decode validated source containers without losing dictionary keys or alias occurrence identity. */
export const decodeBinaryPlistValue = (
  bytes: Buffer,
  plan: PlistDecodePreflight,
  metadata: BinaryPlistScalarMetadata = scanBinaryPlistScalars(bytes, plan),
): unknown => {
  const source = plan.binaryValuePlan;
  if (source === undefined)
    throw new TypeError("Binary plist source plan is missing");
  const compatible = decodeBinaryPlistScalars(bytes, metadata, plan);
  const scalars = parseBinary(
    scalarArrayInput(
      compatible,
      source.scalars.map(({ object }) => object),
    ),
  ) as unknown[];
  const scalarIndex = new Map(
    source.scalars.map((scalar, index) => [scalar.object, index]),
  );
  const containers = new Map(
    source.containers.map((container) => [container.object, container]),
  );
  const root: { value?: unknown } = {};
  const pending: { object: number; parent: object; key: string | number }[] = [
    { object: source.topObject, parent: root, key: "value" },
  ];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const container = containers.get(entry.object);
    let value: unknown;
    if (container === undefined) {
      const index = scalarIndex.get(entry.object);
      if (index === undefined)
        throw new TypeError("Binary plist scalar source is missing");
      value = scalarOccurrence(
        scalars[index],
        source.scalars[index]!.uid,
        source.uidIdentity,
      );
    } else {
      value = container.kind === "array" ? [] : {};
      if (container.kind === "dictionary" && source.uidIdentity)
        markPlistDictionary(value as object);
      for (let index = container.references.length - 1; index >= 0; index -= 1)
        pending.push({
          object: container.references[index]!,
          parent: value as object,
          key: container.keys?.[index] ?? index,
        });
    }
    Object.defineProperty(entry.parent, entry.key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return root.value;
};
