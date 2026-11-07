import { expect, it } from "vitest";
import { readGoBinaryImage } from "./GoBinaryImage.js";
import { createGoBinaryFixture } from "../../tests/fixtures/go/image.js";

it.each(["content", "descriptor"])(
  "reads a Go pointer string %s from file-backed PE headers",
  (location) => {
    const { bytes } = createGoBinaryFixture({
      format: "pe",
      encoding: "pointer",
      moduleText: "path\tdemo\n",
    });
    bytes.writeUInt16LE(0x22, 150);
    bytes.writeUInt32LE(4096, 184);
    bytes.writeUInt32LE(512, 188);
    bytes.writeUInt32LE(8192, 208);
    bytes.writeUInt32LE(1024, 212);
    bytes.writeUInt32LE(4096, 276);
    bytes.writeBigUInt64LE(0x11200n, 1040);
    bytes.writeBigUInt64LE(0x11210n, 1048);
    bytes.writeBigUInt64LE(0x11400n, 1536);
    bytes.writeBigUInt64LE(0x11500n, 1552);
    const control = readGoBinaryImage(bytes).build_info;
    expect(control?.go_version).toBe("go1.26.0");
    if (location === "content") {
      bytes.copy(bytes, 512, 2048, 2056);
      bytes.writeBigUInt64LE(0x10200n, 1536);
    } else {
      bytes.copy(bytes, 528, 1536, 1552);
      bytes.writeBigUInt64LE(0x10210n, 1040);
    }
    expect(readGoBinaryImage(bytes).build_info).toMatchObject({
      go_version: "go1.26.0",
      module_text: control?.module_text,
      version_location: {
        offset: location === "content" ? 512 : 2048,
        bytes: 8,
      },
    });
  },
);

it("reads a pointer string spanning consistently adjacent ELF loads", () => {
  const fixture = createGoBinaryFixture({
    encoding: "pointer",
    moduleText: "path\tdemo\n",
  });
  const bytes = Buffer.alloc(8192);
  fixture.bytes.copy(bytes);
  bytes.writeBigUInt64LE(8192n, 160);
  bytes.writeBigUInt64LE(8192n, 168);
  bytes.writeBigUInt64LE(4096n, 176);
  bytes.writeBigUInt64LE(32n, 416);
  fixture.bytes.copy(bytes, 4092, 2048, 2056);
  fixture.moduleBytes.copy(bytes, 5000);
  bytes.writeBigUInt64LE(0x10ffcn, 1536);
  bytes.writeBigUInt64LE(0x11388n, 1552);
  expect(readGoBinaryImage(bytes).build_info?.go_version).toBe("go1.26.0");
  bytes.writeUInt16LE(2, 56);
  bytes.writeBigUInt64LE(4096n, 160);
  bytes.writeBigUInt64LE(4096n, 168);
  bytes.writeUInt32LE(1, 184);
  bytes.writeUInt32LE(6, 188);
  bytes.writeBigUInt64LE(4096n, 192);
  bytes.writeBigUInt64LE(0x11000n, 200);
  bytes.writeBigUInt64LE(4096n, 216);
  bytes.writeBigUInt64LE(4096n, 224);
  bytes.writeBigUInt64LE(4096n, 232);
  expect(readGoBinaryImage(bytes).build_info).toMatchObject({
    go_version: "go1.26.0",
    version_location: { offset: 4092, bytes: 8 },
  });
});
