type NibFixtureValue =
  | number
  | string
  | boolean
  | null
  | { ref: number }
  | { data: Uint8Array }
  | { float32: number }
  | { float64: number };
type NibFixtureFields =
  | Readonly<Record<string, NibFixtureValue>>
  | readonly (readonly [string, NibFixtureValue])[];
const fieldEntries = (
  values: NibFixtureFields,
): readonly (readonly [string, NibFixtureValue])[] =>
  Array.isArray(values) ? values : Object.entries(values);

/** Encode a minimal NIBArchive object table for decoder and projection tests. */
export const encodeNibArchiveFixture = (input: {
  readonly classes: readonly string[];
  readonly objects: readonly {
    readonly classIndex: number;
    readonly values: NibFixtureFields;
  }[];
}): Buffer => {
  const keys = [
    ...new Set(
      input.objects.flatMap(({ values }) =>
        fieldEntries(values).map(([key]) => key),
      ),
    ),
  ];
  const keyIndex = new Map(keys.map((key, index) => [key, index]));
  const valueRecords = input.objects.flatMap(({ values }) =>
    fieldEntries(values).map(([key, value]) =>
      Buffer.concat([varint(keyIndex.get(key) ?? 0), encodeValue(value)]),
    ),
  );
  let valueStart = 0;
  const records = input.objects.map(({ classIndex, values }) => {
    const count = fieldEntries(values).length;
    const result = Buffer.concat([
      varint(classIndex),
      varint(valueStart),
      varint(count),
    ]);
    valueStart += count;
    return result;
  });
  const objects = Buffer.concat(records);
  const encodedKeys = Buffer.concat(
    keys.map((key) =>
      Buffer.concat([varint(Buffer.byteLength(key)), Buffer.from(key)]),
    ),
  );
  const values = Buffer.concat(valueRecords);
  const classes = Buffer.concat(
    input.classes.map((name) => {
      const bytes = Buffer.from(name);
      return Buffer.concat([varint(bytes.length), varint(0), bytes]);
    }),
  );
  const objectsOffset = 50;
  const keysOffset = objectsOffset + objects.length;
  const valuesOffset = keysOffset + encodedKeys.length;
  const classesOffset = valuesOffset + values.length;
  const header = Buffer.alloc(50);
  header.write("NIBArchive", 0, "ascii");
  header.writeUInt32LE(1, 10);
  header.writeUInt32LE(10, 14);
  header.writeUInt32LE(input.objects.length, 18);
  header.writeUInt32LE(objectsOffset, 22);
  header.writeUInt32LE(keys.length, 26);
  header.writeUInt32LE(keysOffset, 30);
  header.writeUInt32LE(valueStart, 34);
  header.writeUInt32LE(valuesOffset, 38);
  header.writeUInt32LE(input.classes.length, 42);
  header.writeUInt32LE(classesOffset, 46);
  return Buffer.concat([header, objects, encodedKeys, values, classes]);
};

const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining === 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
};

const encodeValue = (
  value:
    | number
    | string
    | boolean
    | null
    | { ref: number }
    | { data: Uint8Array }
    | { float32: number }
    | { float64: number },
): Buffer => {
  // Tags as written by ibtool and read by AppKit: 4 is NO, 5 is YES.
  if (typeof value === "boolean") return Buffer.from([value ? 5 : 4]);
  if (value === null) return Buffer.from([9]);
  if (typeof value === "number") {
    const bytes = Buffer.alloc(5);
    bytes[0] = 2;
    bytes.writeInt32LE(value, 1);
    return bytes;
  }
  if (typeof value === "object") {
    if ("data" in value)
      return Buffer.concat([
        Buffer.from([8]),
        varint(value.data.length),
        value.data,
      ]);
    if ("float32" in value) {
      const bytes = Buffer.alloc(5);
      bytes[0] = 6;
      bytes.writeFloatLE(value.float32, 1);
      return bytes;
    }
    if ("float64" in value) {
      const bytes = Buffer.alloc(9);
      bytes[0] = 7;
      bytes.writeDoubleLE(value.float64, 1);
      return bytes;
    }
    const bytes = Buffer.alloc(5);
    bytes[0] = 10;
    bytes.writeUInt32LE(value.ref, 1);
    return bytes;
  }
  const data = Buffer.from(value);
  return Buffer.concat([Buffer.from([8]), varint(data.length), data]);
};
