interface Resource {
  readonly type: number | string;
  readonly name: number | string;
  readonly language: number | string;
  readonly payload: Buffer;
}
interface EmptyBranch {
  readonly type: number | string;
  readonly name?: number | string;
}
interface Tree {
  readonly children: Map<
    string,
    { identity: number | string; value: Tree | Resource }
  >;
}

const iconGroup = (): Buffer => {
  const bytes = Buffer.alloc(34);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(2, 4);
  for (const [index, id] of [1, 99].entries()) {
    const at = 6 + index * 14;
    bytes[at] = 16;
    bytes[at + 1] = 16;
    bytes.writeUInt16LE(1, at + 4);
    bytes.writeUInt16LE(32, at + 6);
    bytes.writeUInt32LE(4, at + 8);
    bytes.writeUInt16LE(id, at + 12);
  }
  return bytes;
};

/** Hand-authored PE resource bytes, independent of the production decoder. */
export const peResourceFixture = (
  plus = false,
  resources: readonly (Resource | EmptyBranch)[] = [
    { type: 3, name: 1, language: 1033, payload: Buffer.from("ICON") },
    { type: 3, name: 1, language: 1041, payload: Buffer.from("JAPN") },
    { type: 10, name: "7", language: 1033, payload: Buffer.from("Hello") },
    { type: 10, name: 7, language: 1041, payload: Buffer.from("World") },
    { type: 14, name: 42, language: 1033, payload: iconGroup() },
  ],
  sectionBytes = 65536,
  recordAlignment: 2 | 4 = 4,
) => {
  const tree: Tree = { children: new Map() };
  for (const resource of resources) {
    let parent = tree;
    const path =
      "payload" in resource
        ? [resource.type, resource.name, resource.language]
        : resource.name === undefined
          ? [resource.type]
          : [resource.type, resource.name];
    for (const [depth, identity] of path.entries()) {
      const key = `${typeof identity}:${String(identity)}`;
      let child = parent.children.get(key);
      if (child === undefined) {
        child = {
          identity,
          value:
            depth === 2 && "payload" in resource
              ? resource
              : { children: new Map() },
        };
        parent.children.set(key, child);
      }
      if ("children" in child.value) parent = child.value;
    }
  }
  const section = Buffer.alloc(sectionBytes);
  let cursor = 0;
  const allocate = (size: number, alignment = recordAlignment): number => {
    cursor = Math.ceil(cursor / alignment) * alignment;
    const at = cursor;
    cursor += size;
    return at;
  };
  const leaves: { dataAt: number; resource: Resource }[] = [];
  const entryOffsets: number[] = [];
  const directories: number[] = [];
  const emit = (node: Tree): number => {
    const children = [...node.children.values()].sort((left, right) =>
      typeof left.identity === typeof right.identity
        ? typeof left.identity === "number" &&
          typeof right.identity === "number"
          ? left.identity - right.identity
          : String(left.identity).localeCompare(String(right.identity))
        : typeof left.identity === "string"
          ? -1
          : 1,
    );
    const at = allocate(16 + children.length * 8);
    directories.push(at);
    const named = children.filter(
      ({ identity }) => typeof identity === "string",
    ).length;
    section.writeUInt16LE(named, at + 12);
    section.writeUInt16LE(children.length - named, at + 14);
    children.forEach(({ identity, value }, index) => {
      const entry = at + 16 + index * 8;
      entryOffsets.push(entry);
      if (typeof identity === "string") {
        const encoded = Buffer.from(identity, "utf16le");
        const nameAt = allocate(encoded.length + 2, 2);
        section.writeUInt16LE(encoded.length / 2, nameAt);
        encoded.copy(section, nameAt + 2);
        section.writeUInt32LE(0x80000000 + nameAt, entry);
      } else section.writeUInt32LE(identity, entry);
      if ("children" in value)
        section.writeUInt32LE(0x80000000 + emit(value), entry + 4);
      else {
        const dataAt = allocate(16);
        section.writeUInt32LE(dataAt, entry + 4);
        leaves.push({ dataAt, resource: value });
      }
    });
    return at;
  };
  emit(tree);
  for (const { dataAt, resource } of leaves) {
    const payloadAt = allocate(resource.payload.length, 4);
    resource.payload.copy(section, payloadAt);
    section.writeUInt32LE(0x2000 + payloadAt, dataAt);
    section.writeUInt32LE(resource.payload.length, dataAt + 4);
    section.writeUInt32LE(65001, dataAt + 8);
  }
  const rawSize = Math.ceil(cursor / 512) * 512;
  const bytes = Buffer.alloc(0x400 + rawSize);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x80, 60);
  bytes.writeUInt32LE(0x4550, 0x80);
  bytes.writeUInt16LE(plus ? 0x8664 : 0x14c, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  const optionalSize = plus ? 240 : 224;
  bytes.writeUInt16LE(optionalSize, 0x94);
  bytes.writeUInt16LE(plus ? 0x20b : 0x10b, 0x98);
  bytes.writeUInt32LE(0x400, 0x98 + 60);
  bytes.writeUInt32LE(16, 0x98 + (plus ? 108 : 92));
  const directoryAt = 0x98 + (plus ? 112 : 96) + 16;
  bytes.writeUInt32LE(0x2000, directoryAt);
  bytes.writeUInt32LE(cursor, directoryAt + 4);
  const sectionAt = 0x98 + optionalSize;
  bytes.write(".rsrc", sectionAt, "ascii");
  bytes.writeUInt32LE(cursor, sectionAt + 8);
  bytes.writeUInt32LE(0x2000, sectionAt + 12);
  bytes.writeUInt32LE(rawSize, sectionAt + 16);
  bytes.writeUInt32LE(0x400, sectionAt + 20);
  section.copy(bytes, 0x400, 0, rawSize);
  return {
    bytes,
    directoryAt,
    sectionAt,
    entryOffsets: entryOffsets.map((at) => at + 0x400),
    directoryOffsets: directories.map((at) => at + 0x400),
    dataOffsets: leaves.map(({ dataAt }) => dataAt + 0x400),
  };
};
