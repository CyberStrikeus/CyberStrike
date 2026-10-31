import { expect, it } from "vitest";
import { readManagedCliHeaderPrefix } from "./managedCliHeaderPrefix.js";

it("requires only the fixed prefix and leaves full-header admission to consumers", () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(0xffffffff, 0);
  bytes.writeUInt16LE(0xffff, 4);
  bytes.writeUInt16LE(0x8000, 6);
  bytes.writeUInt32LE(0x80000000, 8);
  bytes.writeUInt32LE(0xffffffff, 12);
  expect(readManagedCliHeaderPrefix(bytes)).toEqual({
    ok: true,
    value: {
      headerSize: 0xffffffff,
      runtimeMajor: 0xffff,
      runtimeMinor: 0x8000,
      metadata: { rva: 0x80000000, size: 0xffffffff },
    },
  });
  for (let length = 0; length < 16; length++)
    expect(readManagedCliHeaderPrefix(bytes.subarray(0, length))).toMatchObject(
      {
        ok: false,
        error: { kind: "malformed" },
      },
    );
});
