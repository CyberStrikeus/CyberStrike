import { Buffer } from "node:buffer";

const textEncoder = new TextEncoder();

const DEFAULT_MVID = Buffer.from([
  0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
  0xdd, 0xee, 0xff,
]);

const align4 = (value) => (value + 3) & ~3;
const cString = (value) => Buffer.from(`${value}\0`, "utf8");

class StringHeap {
  #chunks = [Buffer.from([0])];
  #size = 1;

  add(value) {
    if (value.length === 0) return 0;
    const index = this.#size;
    const chunk = cString(value);
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    return index;
  }

  toBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

class BlobHeap {
  #chunks = [Buffer.from([0])];
  #size = 1;

  add(value) {
    if (value.length === 0) return 0;
    if (value.length > 0x7f)
      throw new RangeError("Managed PE fixture blob is too large");
    const index = this.#size;
    this.#chunks.push(Buffer.from([value.length]), value);
    this.#size += value.length + 1;
    return index;
  }

  toBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

const u16 = (value) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
};

const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
};

const guidHeap = (mvid = DEFAULT_MVID) => {
  if (mvid.length !== 16)
    throw new RangeError("Managed PE fixture MVID must be 16 bytes");
  return Buffer.from(mvid);
};

const moduleRow = (name) =>
  Buffer.concat([u16(0), u16(name), u16(1), u16(0), u16(0)]);

const typeRefRow = (name, namespace) =>
  Buffer.concat([u16(0), u16(name), u16(namespace)]);

const typeDefRow = (name, namespace, fieldList, methodList) =>
  Buffer.concat([
    u32(0x0010_0001),
    u16(name),
    u16(namespace),
    u16((1 << 2) | 1),
    u16(fieldList),
    u16(methodList),
  ]);

const fieldRow = (name, signature, flags = 0x0001) =>
  Buffer.concat([u16(flags), u16(name), u16(signature)]);

const methodDefRow = ({
  flags = 0x0016,
  implFlags = 0,
  name,
  rva,
  signature,
}) =>
  Buffer.concat([
    u32(rva),
    u16(implFlags),
    u16(flags),
    u16(name),
    u16(signature),
    u16(0),
  ]);

const memberRefRow = (name, signature) =>
  Buffer.concat([u16((1 << 3) | 1), u16(name), u16(signature)]);

const moduleRefRow = (name) => Buffer.concat([u16(name)]);

const implMapRow = (importName, importScope, mappingFlags, memberRow = 1) =>
  Buffer.concat([
    u16(mappingFlags),
    u16((memberRow << 1) | 1),
    u16(importName),
    u16(importScope),
  ]);

const assemblyRow = (name) =>
  Buffer.concat([
    u32(0x0000_8004),
    u16(1),
    u16(2),
    u16(3),
    u16(4),
    u32(0),
    u16(0),
    u16(name),
    u16(0),
  ]);

const assemblyRefRow = (name, keyOrToken) =>
  Buffer.concat([
    u16(8),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u16(keyOrToken),
    u16(name),
    u16(0),
    u16(0),
  ]);

const customAttributeRow = (value) =>
  Buffer.concat([u16((1 << 5) | 14), u16((1 << 3) | 3), u16(value)]);

const manifestResourceRow = (name) =>
  Buffer.concat([u32(0), u32(2), u16(name), u16(0)]);

const fixedStringAttributeBlob = (value) => {
  const bytes = Buffer.from(textEncoder.encode(value));
  if (bytes.length > 0x7f)
    throw new RangeError("Managed PE fixture target framework is too long");
  return Buffer.concat([Buffer.from([1, 0, bytes.length]), bytes, u16(0)]);
};

const metadataStreamHeader = (relativeOffset, size, name) => {
  const named = cString(name);
  const paddedName = Buffer.alloc(align4(named.length));
  named.copy(paddedName);
  return Buffer.concat([u32(relativeOffset), u32(size), paddedName]);
};

const metadataRoot = (tables, strings, guid, blob) => {
  const version = Buffer.from("v4.0.30319\0\0", "utf8");
  const header = Buffer.concat([
    u32(0x424a_5342),
    u16(1),
    u16(1),
    u32(0),
    u32(version.length),
    version,
    u16(0),
    u16(4),
  ]);
  const streamHeaderSize =
    metadataStreamHeader(0, 0, "#~").length +
    metadataStreamHeader(0, 0, "#Strings").length +
    metadataStreamHeader(0, 0, "#GUID").length +
    metadataStreamHeader(0, 0, "#Blob").length;
  let offset = align4(header.length + streamHeaderSize);
  const tablesOffset = offset;
  offset = align4(offset + tables.length);
  const stringsOffset = offset;
  offset = align4(offset + strings.length);
  const guidOffset = offset;
  offset = align4(offset + guid.length);
  const blobOffset = offset;
  const headers = Buffer.concat([
    metadataStreamHeader(tablesOffset, tables.length, "#~"),
    metadataStreamHeader(stringsOffset, strings.length, "#Strings"),
    metadataStreamHeader(guidOffset, guid.length, "#GUID"),
    metadataStreamHeader(blobOffset, blob.length, "#Blob"),
  ]);
  const root = Buffer.alloc(align4(blobOffset + blob.length));
  header.copy(root, 0);
  headers.copy(root, header.length);
  tables.copy(root, tablesOffset);
  strings.copy(root, stringsOffset);
  guid.copy(root, guidOffset);
  blob.copy(root, blobOffset);
  return root;
};

const tablesStream = (rows, extraValidMask = 0n) => {
  let valid = extraValidMask;
  for (const table of rows.keys()) valid |= 1n << BigInt(table);
  const header = Buffer.alloc(24);
  header.writeUInt8(2, 4);
  header.writeUInt8(1, 7);
  header.writeBigUInt64LE(valid, 8);
  const counts = [];
  for (let index = 0; index <= 44; index += 1) {
    const tableRows = rows.get(index);
    if (tableRows !== undefined) counts.push(u32(tableRows.length));
  }
  const data = [];
  for (let index = 0; index <= 44; index += 1) {
    const tableRows = rows.get(index);
    if (tableRows !== undefined) data.push(...tableRows);
  }
  return Buffer.concat([header, ...counts, ...data]);
};

const defaultIlBody = Buffer.from([
  0x32, 0x02, 0x7b, 0x01, 0x00, 0x00, 0x04, 0x28, 0x01, 0x00, 0x00, 0x0a, 0x2a,
]);

const retOnlyIlBody = Buffer.from([0x2a]);

export const alternateMvid = Buffer.from([
  0xde, 0xad, 0xbe, 0xef, 0x44, 0x33, 0x66, 0x55, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
  0xff, 0x11, 0x22,
]);

/** Build a source-owned PE/CLI fixture without committing compiled binaries. */
const managedFixtureMethods = (options) =>
  options.methods ?? [
    {
      name: options.methodName ?? "Main",
      body: options.ilBody ?? defaultIlBody,
      flags: options.pinvoke === undefined ? 0x0016 : 0x2016,
      implFlags: options.methodImplFlags ?? 0,
    },
  ];

const buildManagedMetadata = (options, methods) => {
  const strings = new StringHeap();
  const blobs = new BlobHeap();
  const stringsForMethods = methods.map((method) => strings.add(method.name));
  const moduleName = strings.add("Fixture.dll");
  const assemblyName = strings.add("Fixture.Managed");
  const attributeName = strings.add("TargetFrameworkAttribute");
  const attributeNamespace = strings.add("System.Runtime.Versioning");
  const constructorName = strings.add(".ctor");
  const typeName = strings.add(options.typeName ?? "Program");
  const typeNamespace = strings.add(options.typeNamespace ?? "Fixture");
  const fields = options.fields ?? [{ name: options.fieldName ?? "counter" }];
  const fieldNames = fields.map((field) => strings.add(field.name));
  const pinvokeModuleName =
    options.pinvoke === undefined
      ? null
      : strings.add(options.pinvoke.moduleName ?? "user32.dll");
  const pinvokeImportName =
    options.pinvoke === undefined
      ? null
      : strings.add(options.pinvoke.importName ?? "MessageBoxW");
  const resourceName = strings.add("Fixture.resources");
  const referenceNames = options.references ?? ["System.Runtime"];
  const referenceStringIndexes = referenceNames.map((name) =>
    strings.add(name),
  );
  const tokenBlob = blobs.add(Buffer.from("b77a5c561934e089", "hex"));
  const fieldRows = fields.map((field, index) =>
    fieldRow(
      fieldNames[index],
      blobs.add(field.signature ?? Buffer.from([0x06, 0x08])),
      field.flags,
    ),
  );
  const constantRows = (options.constants ?? []).map((constant) =>
    Buffer.concat([
      Buffer.from([constant.typeCode, constant.padding ?? 0]),
      u16(constant.parentRaw ?? 4),
      u16(blobs.add(constant.value)),
    ]),
  );
  const methodSignature = blobs.add(Buffer.from([0x00, 0x00, 0x01]));
  const constructorSignature = blobs.add(Buffer.from([0x20, 0x01, 0x01, 0x0e]));
  const attributeBlob = blobs.add(
    fixedStringAttributeBlob(
      options.targetFramework ?? ".NETCoreApp,Version=v8.0",
    ),
  );
  const methodRows = methods.map((method, index) =>
    methodDefRow({
      name: stringsForMethods[index],
      signature: methodSignature,
      rva: method.rva,
      flags: method.flags ?? 0x0016,
      implFlags: method.implFlags ?? 0,
    }),
  );
  const rows = new Map([
    [0, [moduleRow(moduleName)]],
    [1, [typeRefRow(attributeName, attributeNamespace)]],
    [2, [typeDefRow(typeName, typeNamespace, 1, 1)]],
    [4, fieldRows],
    [6, methodRows],
    [10, [memberRefRow(constructorName, constructorSignature)]],
    ...(constantRows.length === 0 ? [] : [[11, constantRows]]),
    [12, [customAttributeRow(attributeBlob)]],
    ...(pinvokeModuleName === null
      ? []
      : [[26, [moduleRefRow(pinvokeModuleName)]]]),
    ...(pinvokeImportName === null
      ? []
      : [
          [
            28,
            [
              implMapRow(
                pinvokeImportName,
                1,
                options.pinvoke?.mappingFlags ?? 0x0344,
                options.pinvoke?.memberRow ?? 1,
              ),
            ],
          ],
        ]),
    [32, [assemblyRow(assemblyName)]],
    [35, referenceStringIndexes.map((name) => assemblyRefRow(name, tokenBlob))],
    [40, [manifestResourceRow(resourceName)]],
  ]);
  const metadata = metadataRoot(
    tablesStream(rows, options.metadataValidMaskExtra ?? 0n),
    strings.toBuffer(),
    guidHeap(options.mvid),
    blobs.toBuffer(),
  );
  if (options.corruptMetadataSignature === true) metadata.writeUInt32LE(0, 0);
  return metadata;
};

const align = (value, boundary) => Math.ceil(value / boundary) * boundary;

const managedFixtureLayout = (options, methods, metadataLength) => {
  const resourceLength =
    4 + (options.resourceData ?? Buffer.from("resource-data")).length;
  const metadataOffset = 0x0300;
  const resourceOffset = Math.max(
    0x0800,
    align(metadataOffset + metadataLength, 0x200),
  );
  const readyToRunOffset = Math.max(
    0x0900,
    align(resourceOffset + resourceLength, 0x200),
  );
  const methodOffsets = [];
  let nextMethodOffset = Math.max(
    0x0a00,
    align(readyToRunOffset + (options.readyToRun === true ? 4 : 0), 0x200),
  );
  for (const method of methods) {
    // RVA zero denotes a method without a mapped IL body, such as P/Invoke.
    if (method.rva === 0) {
      methodOffsets.push(null);
      continue;
    }
    const offset =
      method.rva === undefined
        ? nextMethodOffset
        : 0x0200 + (method.rva - 0x2000);
    methodOffsets.push(offset);
    nextMethodOffset =
      Math.max(offset, nextMethodOffset) +
      align(Math.max(0x20, (method.body ?? retOnlyIlBody).length), 0x20);
  }
  return { metadataOffset, resourceOffset, readyToRunOffset, methodOffsets };
};

const buildManagedImage = (options, methods, metadata) => {
  const resourceData = options.resourceData ?? Buffer.from("resource-data");
  const resourceDirectory = Buffer.concat([
    u32(resourceData.length),
    resourceData,
  ]);
  const { metadataOffset, resourceOffset, readyToRunOffset, methodOffsets } =
    managedFixtureLayout(options, methods, metadata.length);
  const contentEnd = Math.max(
    metadataOffset + metadata.length,
    resourceOffset + resourceDirectory.length,
    readyToRunOffset + (options.readyToRun === true ? 4 : 0),
    ...methodOffsets.flatMap((offset, index) =>
      offset === null
        ? []
        : [offset + (methods[index].body ?? retOnlyIlBody).length],
    ),
    0x1000,
  );
  const imageSize = align(contentEnd, 0x200);
  const image = Buffer.alloc(imageSize);
  image.write("MZ", 0, "ascii");
  image.writeUInt32LE(0x80, 0x3c);
  image.writeUInt32LE(0x0000_4550, 0x80);
  const coff = 0x84;
  const machine = options.machine ?? 0x014c;
  const pe32Plus = machine === 0x8664 || machine === 0xaa64;
  const optionalSize = pe32Plus ? 0x00f0 : 0x00e0;
  const directoryOffset = pe32Plus ? 112 : 96;
  image.writeUInt16LE(machine, coff);
  image.writeUInt16LE(1, coff + 2);
  image.writeUInt16LE(optionalSize, coff + 16);
  image.writeUInt16LE(0x0102, coff + 18);
  const optional = coff + 20;
  image.writeUInt16LE(pe32Plus ? 0x020b : 0x010b, optional);
  image.writeUInt32LE(0x2000, optional + 20);
  if (pe32Plus) image.writeBigUInt64LE(0x0040_0000n, optional + 24);
  else image.writeUInt32LE(0x0040_0000, optional + 28);
  image.writeUInt32LE(0x1000, optional + 32);
  image.writeUInt32LE(0x200, optional + 36);
  image.writeUInt32LE(align(0x2000 + imageSize - 0x200, 0x1000), optional + 56);
  image.writeUInt32LE(0x200, optional + 60);
  image.writeUInt32LE(16, optional + directoryOffset - 4);
  image.writeUInt32LE(0x2000, optional + directoryOffset + 14 * 8);
  image.writeUInt32LE(72, optional + directoryOffset + 14 * 8 + 4);
  const section = optional + optionalSize;
  image.write(".text\0\0\0", section, "ascii");
  image.writeUInt32LE(imageSize - 0x200, section + 8);
  image.writeUInt32LE(0x2000, section + 12);
  image.writeUInt32LE(imageSize - 0x200, section + 16);
  image.writeUInt32LE(0x0200, section + 20);
  image.writeUInt32LE(0x6000_0020, section + 36);
  const cli = 0x0200;
  image.writeUInt32LE(72, cli);
  image.writeUInt16LE(2, cli + 4);
  image.writeUInt16LE(5, cli + 6);
  image.writeUInt32LE(0x2100, cli + 8);
  image.writeUInt32LE(metadata.length, cli + 12);
  image.writeUInt32LE(options.cliFlags ?? 1, cli + 16);
  image.writeUInt32LE(0x0600_0001, cli + 20);
  image.writeUInt32LE(0x2000 + (resourceOffset - 0x0200), cli + 24);
  image.writeUInt32LE(resourceDirectory.length, cli + 28);
  if (options.readyToRun === true) {
    image.writeUInt32LE(0x2000 + (readyToRunOffset - 0x0200), cli + 64);
    image.writeUInt32LE(4, cli + 68);
    image.write("RTR\0", readyToRunOffset, "ascii");
  }
  methods.forEach((method, index) => {
    const offset = methodOffsets[index];
    if (offset === null) return;
    (method.body ?? retOnlyIlBody).copy(image, offset);
  });
  metadata.copy(image, metadataOffset);
  resourceDirectory.copy(image, resourceOffset);
  return image;
};

/** Build a source-owned PE/CLI fixture without committing compiled binaries. */
export const buildManagedPeFixture = (options = {}) => {
  const methods = managedFixtureMethods(options);
  const provisionalMetadata = buildManagedMetadata(
    options,
    methods.map((method) => ({ ...method, rva: method.rva ?? 0x2800 })),
  );
  const layout = managedFixtureLayout(
    options,
    methods,
    provisionalMetadata.length,
  );
  const methodsWithRvas = methods.map((method, index) => ({
    ...method,
    rva: method.rva ?? 0x2000 + (layout.methodOffsets[index] - 0x0200),
  }));
  const metadata = buildManagedMetadata(options, methodsWithRvas);
  return buildManagedImage(options, methodsWithRvas, metadata);
};
export const buildNativePeFixture = () => {
  const image = buildManagedPeFixture();
  const cliDirectory = 0x84 + 20 + 96 + 14 * 8;
  image.writeUInt32LE(0, cliDirectory);
  image.writeUInt32LE(0, cliDirectory + 4);
  return image;
};
