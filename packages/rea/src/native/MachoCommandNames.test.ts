import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readMachoCommandNames } from "./MachoCommandNames.js";
import { projectMachoBinary } from "./MachoBinaryProjection.js";

it("owns retained command bytes independently of Buffer-backed read windows", async () => {
  const paddedSize = 256 * 1024;
  const image = Buffer.alloc(32 + paddedSize * 2 + 24);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(3, 16);
  image.writeUInt32LE(paddedSize * 2 + 24, 20);
  const rpath = 32;
  image.writeUInt32LE(0x8000001c, rpath);
  image.writeUInt32LE(paddedSize, rpath + 4);
  image.writeUInt32LE(12, rpath + 8);
  const fileset = rpath + paddedSize;
  image.writeUInt32LE(0x80000035, fileset);
  image.writeUInt32LE(paddedSize, fileset + 4);
  image.writeUInt32LE(32, fileset + 24);
  image.write("x", fileset + 32);
  const uuid = fileset + paddedSize;
  image.writeUInt32LE(0x1b, uuid);
  image.writeUInt32LE(24, uuid + 4);
  image.fill(0x42, uuid + 8, uuid + 24);

  // Buffer.subarray and Buffer.slice both share the caller's backing store.
  const result = await readMachoCommandNames(
    async (offset, size) => image.subarray(offset, offset + size),
    image.length,
    paddedSize,
    3,
  );
  const path = result.commands[0]!.commandString!;
  const entry = result.commands[1]!.fileset!.entryId;
  const id = result.commands[2]!.uuid!;
  expect(path).toHaveLength(0);
  expect([...entry]).toEqual([0x78]);
  expect([...id]).toEqual(Array<number>(16).fill(0x42));
  for (const retained of [path, entry, id]) {
    expect(retained.buffer).not.toBe(image.buffer);
    expect(retained.buffer.byteLength).toBe(retained.byteLength);
  }
  image.fill(0);
  expect([...entry]).toEqual([0x78]);
  expect([...id]).toEqual(Array<number>(16).fill(0x42));
});

it("retains newline and misleading field names from binary segment, section and dylib strings", async () => {
  const name = Buffer.from("x\naddr 0x1");
  const dylib = Buffer.from("lib\nLoad command 2\ncmd LC_SEGMENT_64\0");
  const segmentSize = 152;
  const dylibSize = (24 + dylib.length + 7) & ~7;
  const image = Buffer.alloc(32 + segmentSize + dylibSize);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(2, 8);
  image.writeUInt32LE(2, 12);
  image.writeUInt32LE(2, 16);
  image.writeUInt32LE(segmentSize + dylibSize, 20);
  image.writeUInt32LE(0x200085, 24);
  image.writeUInt32LE(0x19, 32);
  image.writeUInt32LE(segmentSize, 36);
  name.copy(image, 40);
  image.writeBigUInt64LE(0x100002000n, 56);
  image.writeBigUInt64LE(0x3000n, 64);
  image.writeBigUInt64LE(0x4000n, 72);
  image.writeBigUInt64LE(0x2000n, 80);
  image.writeUInt32LE(7, 88);
  image.writeUInt32LE(5, 92);
  image.writeUInt32LE(1, 96);
  image.writeUInt32LE(2, 100);
  name.copy(image, 104);
  Buffer.from("__DATA").copy(image, 120);
  image.writeBigUInt64LE(0x100002100n, 136);
  image.writeBigUInt64LE(0x88n, 144);
  image.writeUInt32LE(0x4100, 152);
  image.writeUInt32LE(4, 156);
  image.writeUInt32LE(0x80000400, 168);
  const dylibAt = 32 + segmentSize;
  image.writeUInt32LE(0xc, dylibAt);
  image.writeUInt32LE(dylibSize, dylibAt + 4);
  image.writeUInt32LE(24, dylibAt + 8);
  image.writeUInt32LE(123, dylibAt + 12);
  image.writeUInt32LE(0x10002, dylibAt + 16);
  image.writeUInt32LE(0x30004, dylibAt + 20);
  dylib.copy(image, dylibAt + 24);
  const reads: number[] = [];
  const read = async (offset: number, size: number) => {
    reads.push(size);
    return image.subarray(offset, offset + size);
  };
  const result = await readMachoCommandNames(read, image.length, 128, 3);
  expect(result.header).toEqual({
    wide: true,
    littleEndian: true,
    cpuType: 0x0100000c,
    cpuSubtype: 2,
    fileType: 2,
    flags: 0x200085,
  });
  expect(
    Buffer.from(result.commands[0]!.segmentName!)
      .subarray(0, name.length)
      .equals(name),
  ).toBe(true);
  expect(
    Buffer.from(result.commands[0]!.sections![0]!.name)
      .subarray(0, name.length)
      .equals(name),
  ).toBe(true);
  expect(Buffer.from(result.commands[1]!.commandString!).toString()).toBe(
    "lib\nLoad command 2\ncmd LC_SEGMENT_64",
  );
  expect(result.commands[1]!.dylib).toEqual({
    nameOffset: 24,
    currentVersion: 0x10002,
    compatibilityVersion: 0x30004,
    encoding: { kind: "timestamp", timestamp: 123 },
  });
  expect(result.commands[1]!.rawSha256).toBe(
    createHash("sha256")
      .update(image.subarray(dylibAt, dylibAt + dylibSize))
      .digest("hex"),
  );
  expect(result.commands[0]!.segment).toEqual({
    address: 0x100002000n,
    memorySize: 0x3000n,
    fileOffset: 0x4000n,
    fileSize: 0x2000n,
    maxProtection: 7,
    protection: 5,
    flags: 2,
  });
  expect(result.commands[0]!.sections![0]).toMatchObject({
    address: 0x100002100n,
    size: 0x88n,
    fileOffset: 0x4100,
    alignmentExponent: 4,
    flags: 0x80000400,
  });
  const projected = projectMachoBinary(result);
  expect(projected.segments[0]?.sections[0]?.name).toBe(name.toString());
  expect(projected.dependencies[0]?.path).toBe(
    "lib\nLoad command 2\ncmd LC_SEGMENT_64",
  );
  expect(projected.commands).toHaveLength(2);
  expect(Math.max(...reads)).toBeLessThan(image.length);
  await expect(readMachoCommandNames(read, image.length, 4, 3)).rejects.toThrow(
    "budget",
  );
  await expect(
    readMachoCommandNames(read, image.length, 128, 2),
  ).rejects.toThrow("records exceed");
});

it("retains alternate dylib flags and legacy platform versions", async () => {
  const image = Buffer.alloc(32 + 32 + 16);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(2, 16);
  image.writeUInt32LE(48, 20);
  image.writeUInt32LE(0xc, 32);
  image.writeUInt32LE(32, 36);
  image.writeUInt32LE(28, 40);
  image.writeUInt32LE(0x1a741800, 44);
  image.writeUInt32LE(0x10002, 48);
  image.writeUInt32LE(0x20003, 52);
  image.writeUInt32LE(0x9, 56);
  image.write("lib", 60, "ascii");
  image.writeUInt32LE(0x24, 64);
  image.writeUInt32LE(16, 68);
  image.writeUInt32LE(0x000d0102, 72);
  image.writeUInt32LE(0x000f0000, 76);
  const result = await readMachoCommandNames(
    async (offset, size) => image.subarray(offset, offset + size),
    image.length,
    32,
    2,
  );
  expect(result.commands[0]?.dylib).toEqual({
    nameOffset: 28,
    currentVersion: 0x10002,
    compatibilityVersion: 0x20003,
    encoding: { kind: "use", flags: 9 },
  });
  expect(result.commands[1]?.legacyBuild).toEqual({
    version: 0x000d0102,
    sdk: 0x000f0000,
  });
});

it("retains bounded linker options and dylinker strings with embedded framing", async () => {
  const strings = Buffer.from("-lone\0\nLoad command 1\0");
  const optionSize = (12 + strings.length + 7) & ~7;
  const name = Buffer.from("dyld\nSection\0");
  const nameSize = (12 + name.length + 7) & ~7;
  const image = Buffer.alloc(32 + optionSize + nameSize);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(2, 16);
  image.writeUInt32LE(optionSize + nameSize, 20);
  image.writeUInt32LE(0x2d, 32);
  image.writeUInt32LE(optionSize, 36);
  image.writeUInt32LE(2, 40);
  strings.copy(image, 44);
  const at = 32 + optionSize;
  image.writeUInt32LE(0xe, at);
  image.writeUInt32LE(nameSize, at + 4);
  image.writeUInt32LE(12, at + 8);
  name.copy(image, at + 12);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const result = await readMachoCommandNames(read, image.length, 64, 4);
  expect(
    result.commands[0]?.linkerOptions?.map((value) =>
      Buffer.from(value).toString(),
    ),
  ).toEqual(["-lone", "\nLoad command 1"]);
  expect(Buffer.from(result.commands[1]!.commandString!).toString()).toBe(
    "dyld\nSection",
  );
  await expect(readMachoCommandNames(read, image.length, 4, 4)).rejects.toThrow(
    "bytes exceed",
  );
  await expect(
    readMachoCommandNames(read, image.length, 64, 3),
  ).rejects.toThrow("records exceed");
});

it("bounds aggregate linker option bytes across read windows", async () => {
  const options = Buffer.from(`first\0${"x".repeat(4097)}\0`);
  const size = (12 + options.length + 7) & ~7;
  const image = Buffer.alloc(32 + size);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(1, 16);
  image.writeUInt32LE(size, 20);
  image.writeUInt32LE(0x2d, 32);
  image.writeUInt32LE(size, 36);
  image.writeUInt32LE(2, 40);
  options.copy(image, 44);
  const read = async (offset: number, length: number) =>
    image.subarray(offset, offset + length);
  const exact = await readMachoCommandNames(read, image.length, 4102, 3);
  expect(
    exact.commands[0]?.linkerOptions?.map((value) => value.byteLength),
  ).toEqual([5, 4097]);
  await expect(
    readMachoCommandNames(read, image.length, 4101, 3),
  ).rejects.toThrow("bytes exceed the retained output budget");
});

it("reads many small linker options with linear source traffic", async () => {
  const count = 10_000;
  const commandSize = (12 + count * 2 + 7) & ~7;
  const image = Buffer.alloc(32 + commandSize);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(1, 16);
  image.writeUInt32LE(commandSize, 20);
  image.writeUInt32LE(0x2d, 32);
  image.writeUInt32LE(commandSize, 36);
  image.writeUInt32LE(count, 40);
  for (let index = 0; index < count; index++) image[44 + index * 2] = 65;
  let requested = 0;
  const result = await readMachoCommandNames(
    async (offset, size) => {
      requested += size;
      return image.subarray(offset, offset + size);
    },
    image.length,
    count,
    count + 1,
  );
  expect(result.commands[0]?.linkerOptions).toHaveLength(count);
  expect(requested).toBeLessThanOrEqual(image.length * 2 + 16);
});

it("retains note and fileset records without treating names as framing", async () => {
  const image = Buffer.alloc(32 + 40 + 48);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(2, 16);
  image.writeUInt32LE(88, 20);
  image.writeUInt32LE(0x31, 32);
  image.writeUInt32LE(40, 36);
  image.write("x\nLoad command", 40);
  image.writeBigUInt64LE(0x1234n, 56);
  image.writeBigUInt64LE(0x55n, 64);
  image.writeUInt32LE(0x80000035, 72);
  image.writeUInt32LE(48, 76);
  image.writeBigUInt64LE(0x1000n, 80);
  image.writeBigUInt64LE(0x2000n, 88);
  image.writeUInt32LE(32, 96);
  image.writeUInt32LE(7, 100);
  image.write("id\nSection", 104);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const result = await readMachoCommandNames(read, image.length, 32, 2);
  expect(result.commands[0]?.note).toMatchObject({
    offset: 0x1234n,
    size: 0x55n,
  });
  expect(
    Buffer.from(result.commands[0]!.note!.owner)
      .toString("utf8")
      .replace(/\0+$/u, ""),
  ).toBe("x\nLoad command");
  expect(result.commands[1]?.fileset).toMatchObject({
    address: 0x1000n,
    fileOffset: 0x2000n,
    reserved: 7,
  });
  expect(Buffer.from(result.commands[1]!.fileset!.entryId).toString()).toBe(
    "id\nSection",
  );
  image.writeUInt32LE(31, 96);
  await expect(
    readMachoCommandNames(read, image.length, 32, 2),
  ).rejects.toThrow("offset is invalid");
});

it("reads fixed command words in the selected slice byte order", async () => {
  const image = Buffer.alloc(28 + 24 + 16);
  image.writeUInt32BE(0xfeedface, 0);
  image.writeUInt32BE(18, 4);
  image.writeUInt32BE(2, 16);
  image.writeUInt32BE(40, 20);
  image.writeUInt32BE(2, 28);
  image.writeUInt32BE(24, 32);
  image.writeUInt32BE(128, 36);
  image.writeUInt32BE(4, 40);
  image.writeUInt32BE(256, 44);
  image.writeUInt32BE(64, 48);
  image.writeUInt32BE(0x1d, 52);
  image.writeUInt32BE(16, 56);
  image.writeUInt32BE(0x400, 60);
  image.writeUInt32BE(0x80, 64);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const result = await readMachoCommandNames(read, image.length, 32, 2);
  expect(result.commands[0]?.fixedFields).toEqual({
    symoff: 128,
    nsyms: 4,
    stroff: 256,
    strsize: 64,
  });
  expect(result.commands[1]?.fixedFields).toEqual({
    dataoff: 0x400,
    datasize: 0x80,
  });
  image.writeUInt32BE(20, 32);
  await expect(
    readMachoCommandNames(read, image.length, 32, 2),
  ).rejects.toThrow("fixed command fields are truncated");
});

it("decodes 32-bit big-endian segment and section facts without reading payloads", async () => {
  const image = Buffer.alloc(28 + 56 + 68);
  image.writeUInt32BE(0xfeedface, 0);
  image.writeUInt32BE(18, 4);
  image.writeUInt32BE(1, 16);
  image.writeUInt32BE(124, 20);
  image.writeUInt32BE(1, 28);
  image.writeUInt32BE(124, 32);
  Buffer.from("__DATA").copy(image, 36);
  image.writeUInt32BE(0x1000, 52);
  image.writeUInt32BE(0x2000, 56);
  image.writeUInt32BE(0x300, 60);
  image.writeUInt32BE(0x400, 64);
  image.writeUInt32BE(7, 68);
  image.writeUInt32BE(3, 72);
  image.writeUInt32BE(1, 76);
  image.writeUInt32BE(4, 80);
  Buffer.from("section\nname").copy(image, 84);
  Buffer.from("__DATA").copy(image, 100);
  image.writeUInt32BE(0x1100, 116);
  image.writeUInt32BE(0x20, 120);
  image.writeUInt32BE(0x310, 124);
  image.writeUInt32BE(3, 128);
  image.writeUInt32BE(0x80000000, 140);
  const sizes: number[] = [];
  const result = await readMachoCommandNames(
    async (offset, size) => {
      sizes.push(size);
      return image.subarray(offset, offset + size);
    },
    image.length,
    128,
    2,
  );
  expect(result.commands[0]?.segment).toEqual({
    address: 0x1000n,
    memorySize: 0x2000n,
    fileOffset: 0x300n,
    fileSize: 0x400n,
    maxProtection: 7,
    protection: 3,
    flags: 4,
  });
  expect(result.commands[0]?.sections?.[0]).toMatchObject({
    address: 0x1100n,
    size: 0x20n,
    fileOffset: 0x310,
    alignmentExponent: 3,
    flags: 0x80000000,
  });
  expect(Math.max(...sizes)).toBeLessThan(image.length);
});

it("retains UUID, entrypoint and bounded build tool records", async () => {
  const image = Buffer.alloc(32 + 24 + 24 + 32);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(3, 16);
  image.writeUInt32LE(80, 20);
  image.writeUInt32LE(0x1b, 32);
  image.writeUInt32LE(24, 36);
  Buffer.from("00112233445566778899aabbccddeeff", "hex").copy(image, 40);
  image.writeUInt32LE(0x80000028, 56);
  image.writeUInt32LE(24, 60);
  image.writeBigUInt64LE(0x1234n, 64);
  image.writeBigUInt64LE(0x4000n, 72);
  image.writeUInt32LE(0x32, 80);
  image.writeUInt32LE(32, 84);
  image.writeUInt32LE(1, 88);
  image.writeUInt32LE(0x000e0100, 92);
  image.writeUInt32LE(0x000f0000, 96);
  image.writeUInt32LE(1, 100);
  image.writeUInt32LE(3, 104);
  image.writeUInt32LE(0x01020300, 108);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const result = await readMachoCommandNames(read, image.length, 128, 4);
  expect(Buffer.from(result.commands[0]!.uuid!).toString("hex")).toBe(
    "00112233445566778899aabbccddeeff",
  );
  expect(result.commands[1]?.entrypoint).toEqual({
    offset: 0x1234n,
    stackSize: 0x4000n,
  });
  expect(result.commands[2]?.build).toEqual({
    platform: 1,
    minimumOs: 0x000e0100,
    sdk: 0x000f0000,
    tools: [{ tool: 3, version: 0x01020300 }],
  });
  await expect(
    readMachoCommandNames(read, image.length, 128, 3),
  ).rejects.toThrow("records exceed");
  image.writeUInt32LE(2, 100);
  await expect(
    readMachoCommandNames(read, image.length, 128, 4),
  ).rejects.toThrow("build tool table is truncated");
});

it.skipIf(process.platform !== "darwin")(
  "reads an Apple linker generated multiline section from bounded ranges",
  async () => {
    const { mkdtemp, writeFile, rm, open } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const root = await mkdtemp(join(tmpdir(), "rea-macho-names-"));
    try {
      const code = join(root, "main.c");
      const payload = join(root, "payload");
      const image = join(root, "target");
      await writeFile(code, "int main(void) { return 0; }\n");
      await writeFile(payload, "data");
      execFileSync("/usr/bin/clang", [
        "-arch",
        "arm64",
        "-o",
        image,
        code,
        `-Wl,-sectcreate,__DATA,x\naddr 0x1,${payload}`,
      ]);
      const handle = await open(image, "r");
      try {
        const stat = await handle.stat();
        const result = await readMachoCommandNames(
          async (offset, size) => {
            const bytes = Buffer.alloc(size);
            const read = await handle.read(bytes, 0, size, offset);
            return bytes.subarray(0, read.bytesRead);
          },
          stat.size,
          1024,
          10000,
        );
        expect(
          result.commands
            .flatMap((command) => command.sections ?? [])
            .some(
              (section) =>
                Buffer.from(section.name).subarray(0, 10).toString() ===
                "x\naddr 0x1",
            ),
        ).toBe(true);
        const parsed = projectMachoBinary(result);
        expect(
          parsed.segments
            .flatMap((segment) => segment.sections)
            .some((section) => section.name === "x\naddr 0x1"),
        ).toBe(true);
      } finally {
        await handle.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("retains legacy on-disk dylib and fixed-library identities", async () => {
  const commands: Buffer[] = [];
  for (const id of [0x6, 0x7]) {
    const command = Buffer.alloc(32);
    command.writeUInt32LE(id, 0);
    command.writeUInt32LE(command.length, 4);
    command.writeUInt32LE(20, 8);
    command.writeUInt32LE(7, 12);
    command.writeUInt32LE(0x1000, 16);
    command.write("lib\nX", 20);
    commands.push(command);
  }
  const fvm = Buffer.alloc(24);
  fvm.writeUInt32LE(9, 0);
  fvm.writeUInt32LE(fvm.length, 4);
  fvm.writeUInt32LE(16, 8);
  fvm.writeUInt32LE(0x2000, 12);
  fvm.write("file", 16);
  commands.push(fvm);
  const prebound = Buffer.alloc(32);
  prebound.writeUInt32LE(0x10, 0);
  prebound.writeUInt32LE(prebound.length, 4);
  prebound.writeUInt32LE(20, 8);
  prebound.writeUInt32LE(2, 12);
  prebound.writeUInt32LE(28, 16);
  prebound.write("lib", 20);
  prebound[28] = 1;
  commands.push(prebound);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(
    commands.reduce((size, command) => size + command.length, 0),
    20,
  );
  const image = Buffer.concat([header, ...commands]);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const parsed = await readMachoCommandNames(read, image.length, 256, 4);
  expect(Buffer.from(parsed.commands[0]!.commandString!).toString()).toBe(
    "lib\nX",
  );
  expect(parsed.commands[0]!.fvmlib).toEqual({
    minorVersion: 7,
    headerAddress: 0x1000,
  });
  expect(parsed.commands[2]!.fvmfile).toEqual({ headerAddress: 0x2000 });
  expect(parsed.commands[3]!.prebound).toMatchObject({
    moduleCount: 2,
    linkedModulesOffset: 28,
  });
  expect([...parsed.commands[3]!.prebound!.linkedModules]).toEqual([1]);
  prebound.writeUInt32LE(33, 16);
  const invalid = Buffer.concat([header, ...commands]);
  await expect(
    readMachoCommandNames(
      async (offset, size) => invalid.subarray(offset, offset + size),
      invalid.length,
      256,
      4,
    ),
  ).rejects.toThrow("bitmap exceeds");
});
