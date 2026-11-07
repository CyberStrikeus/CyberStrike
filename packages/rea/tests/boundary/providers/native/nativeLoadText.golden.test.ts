import { expect, it } from "vitest";
import { readMachoCommandNames } from "../../../../src/native/MachoCommandNames.js";
import { projectMachoBinary } from "../../../../src/native/MachoBinaryProjection.js";

it.each([
  "123 library.dylib",
  "0x123 library.dylib",
  "123",
  "0x123",
  "ordinary.dylib",
  "/tmp/Load command 12/plugin.dylib",
  "@rpath/plugin-Load command 34.dylib",
  "  leading and trailing  ",
  "lib\nLoad command 2\ncmd LC_SEGMENT_64",
])(
  "preserves binary install-name identity %j without interpreting it as framing",
  async (name) => {
    const encoded = Buffer.from(`${name}\0`);
    const size = (24 + encoded.length + 7) & ~7;
    const image = Buffer.alloc(32 + size * 2);
    image.writeUInt32LE(0xfeedfacf, 0);
    image.writeUInt32LE(0x0100000c, 4);
    image.writeUInt32LE(2, 16);
    image.writeUInt32LE(size * 2, 20);
    for (const [index, command] of [0xd, 0xc].entries()) {
      const offset = 32 + index * size;
      image.writeUInt32LE(command, offset);
      image.writeUInt32LE(size, offset + 4);
      image.writeUInt32LE(24, offset + 8);
      encoded.copy(image, offset + 24);
    }
    const binary = await readMachoCommandNames(
      async (offset, length) => image.subarray(offset, offset + length),
      image.length,
      1024,
      2,
    );
    const result = projectMachoBinary(binary);
    expect(result.commands.map((command) => command.kind)).toEqual([
      "LC_ID_DYLIB",
      "LC_LOAD_DYLIB",
    ]);
    expect(result.commands[0]?.fields.name).toBe(`${name} (offset 24)`);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toMatchObject({
      kind: "LC_LOAD_DYLIB",
      path: name,
    });
  },
);

it.each([
  [1, "MACOS"],
  [2, "IOS"],
  [3, "TVOS"],
  [4, "WATCHOS"],
  [5, "BRIDGEOS"],
  [6, "MACCATALYST"],
  [7, "IOSSIMULATOR"],
  [8, "TVOSSIMULATOR"],
  [9, "WATCHOSSIMULATOR"],
  [10, "DRIVERKIT"],
  [11, "VISIONOS"],
  [12, "VISIONOSSIMULATOR"],
  [13, "FIRMWARE"],
  [14, "SEPOS"],
  [15, "MACOS_EXCLAVECORE"],
  [16, "MACOS_EXCLAVEKIT"],
  [17, "IOS_EXCLAVECORE"],
  [18, "IOS_EXCLAVEKIT"],
  [19, "TVOS_EXCLAVECORE"],
  [20, "TVOS_EXCLAVEKIT"],
  [21, "WATCHOS_EXCLAVECORE"],
  [22, "WATCHOS_EXCLAVEKIT"],
  [23, "VISIONOS_EXCLAVECORE"],
  [24, "VISIONOS_EXCLAVEKIT"],
  [999, "999"],
])("projects binary build platform %i as %s", async (platform, expected) => {
  const image = Buffer.alloc(64);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(1, 16);
  image.writeUInt32LE(32, 20);
  image.writeUInt32LE(0x32, 32);
  image.writeUInt32LE(32, 36);
  image.writeUInt32LE(platform, 40);
  image.writeUInt32LE(0x000d0102, 44);
  image.writeUInt32LE(0x000f0000, 48);
  image.writeUInt32LE(1, 52);
  image.writeUInt32LE(3, 56);
  image.writeUInt32LE(0x01020300, 60);
  const binary = await readMachoCommandNames(
    async (offset, length) => image.subarray(offset, offset + length),
    image.length,
    1024,
    2,
  );
  expect(projectMachoBinary(binary).builds).toEqual([
    {
      platform: expected,
      minimum_os: "13.1.2",
      sdk: "15.0",
      tools: [{ name: "LD", version: "258.3" }],
    },
  ]);
  image.writeUInt32LE(2, 52);
  await expect(
    readMachoCommandNames(
      async (offset, length) => image.subarray(offset, offset + length),
      image.length,
      1024,
      3,
    ),
  ).rejects.toThrow("build tool table is truncated");
});

it("separates lazy dylib dependencies from dylinker and retains binary fields", async () => {
  const lazy = Buffer.alloc(56);
  lazy.writeUInt32LE(0x20, 0);
  lazy.writeUInt32LE(lazy.length, 4);
  lazy.writeUInt32LE(28, 8);
  lazy.writeUInt32LE(0x1a741800, 12);
  lazy.writeUInt32LE(0x10002, 16);
  lazy.writeUInt32LE(0x20003, 20);
  lazy.writeUInt32LE(9, 24);
  lazy.write("/usr/lib/libLazy.dylib", 28);
  const linker = Buffer.alloc(32);
  linker.writeUInt32LE(0xe, 0);
  linker.writeUInt32LE(linker.length, 4);
  linker.writeUInt32LE(12, 8);
  linker.write("/usr/lib/dyld", 12);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(2, 16);
  header.writeUInt32LE(lazy.length + linker.length, 20);
  const image = Buffer.concat([header, lazy, linker]);
  const binary = await readMachoCommandNames(
    async (offset, length) => image.subarray(offset, offset + length),
    image.length,
    1024,
    2,
  );
  const result = projectMachoBinary(binary);
  expect(result.dependencies).toEqual([
    {
      kind: "LC_LAZY_LOAD_DYLIB",
      path: "/usr/lib/libLazy.dylib",
      current_version: "1.0.2",
      compatibility_version: "2.0.3",
    },
  ]);
  expect(result.commands[0]?.fields["time stamp"]).toBe(0x1a741800);
  expect(result.commands[1]?.kind).toBe("LC_LOAD_DYLINKER");
});

it.each([
  ["0001", "0002"],
  [" seg ", " sec "],
  ["", ""],
])(
  "preserves exact binary segment %j and section %j identities",
  async (segment, section) => {
    const image = Buffer.alloc(32 + 152);
    image.writeUInt32LE(0xfeedfacf, 0);
    image.writeUInt32LE(0x0100000c, 4);
    image.writeUInt32LE(1, 16);
    image.writeUInt32LE(152, 20);
    image.writeUInt32LE(0x19, 32);
    image.writeUInt32LE(152, 36);
    image.write(segment, 40);
    image.writeBigUInt64LE(0x4000n, 56);
    image.writeBigUInt64LE(0x4000n, 64);
    image.writeBigUInt64LE(0x4000n, 72);
    image.writeBigUInt64LE(0x4000n, 80);
    image.writeUInt32LE(3, 88);
    image.writeUInt32LE(3, 92);
    image.writeUInt32LE(1, 96);
    image.write(section, 104);
    image.write(segment, 120);
    image.writeBigUInt64LE(0x4000n, 136);
    image.writeBigUInt64LE(8n, 144);
    image.writeUInt32LE(0x4000, 152);
    const binary = await readMachoCommandNames(
      async (offset, length) => image.subarray(offset, offset + length),
      image.length,
      1024,
      2,
    );
    expect(projectMachoBinary(binary).segments[0]).toMatchObject({
      name: segment,
      file_offset: 16384,
      sections: [{ segment, name: section, size: 8 }],
    });
  },
);
