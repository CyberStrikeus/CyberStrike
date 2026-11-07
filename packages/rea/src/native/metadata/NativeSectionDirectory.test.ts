import { expect, it } from "vitest";
import { pe } from "../../domain/binaryTarget.fixture.js";
import { readPeSectionDirectory } from "./NativeSectionDirectory.js";

const readDirectory = (bytes: Buffer) => {
  const reader = readPeSectionDirectory(bytes.length);
  let next = reader.next();
  while (!next.done) {
    const { offset, size } = next.value;
    next = reader.next(bytes.subarray(offset, offset + size));
  }
  return next.value;
};

it("classifies a confirmed overlapping PE directory as an unsupported layout", () => {
  expect(() => readDirectory(pe(0x014c, 4))).toThrow(
    expect.objectContaining({
      kind: "unsupported",
      message: expect.stringContaining("overlapping PE header"),
    }),
  );
});

it.each([0x014c, 0x8664])(
  "reads a nonoverlapping PE directory for machine %s",
  (machine) => {
    expect(readDirectory(pe(machine))).toMatchObject({
      format: "pe",
      machine,
      bits: machine === 0x014c ? 32 : 64,
      sections: [],
    });
  },
);

it("does not classify an unconfirmed pointer overlapping DOS data as a PE layout", () => {
  const bytes = pe(0x014c);
  bytes.writeUInt32LE(4, 60);
  expect(() => readDirectory(bytes)).toThrow(
    expect.objectContaining({ kind: "malformed" }),
  );
});

it("retains a confirmed overlapping PE when the COFF record extends past EOF", () => {
  const bytes = Buffer.alloc(64);
  bytes.write("MZ", 0, "ascii");
  bytes.write("PE\0\0", 44, "ascii");
  bytes.writeUInt32LE(44, 60);
  expect(() => readDirectory(bytes)).toThrow(
    expect.objectContaining({
      kind: "unsupported",
      message: expect.stringContaining("overlapping PE header"),
    }),
  );
});
