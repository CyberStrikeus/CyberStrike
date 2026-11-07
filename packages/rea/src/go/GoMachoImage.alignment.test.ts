import { expect, it } from "vitest";
import { machoImageWithUnknownCommand } from "../artifacts/apple/MachoImage.fixture.js";
import { readGoBinaryImage } from "./GoBinaryImage.js";

it("rejects a 12-byte load command in a 64-bit Go Mach-O image", () => {
  expect(() =>
    readGoBinaryImage(Buffer.from(machoImageWithUnknownCommand(true, 12))),
  ).toThrow(
    expect.objectContaining({
      name: "BinaryFormatFailure",
      kind: "malformed",
    }),
  );
});

it.each([
  { wide: true, size: 16, bits: 64 },
  { wide: false, size: 12, bits: 32 },
])(
  "accepts $bits-bit Mach-O load commands of size $size",
  ({ wide, size, bits }) => {
    expect(
      readGoBinaryImage(Buffer.from(machoImageWithUnknownCommand(wide, size))),
    ).toMatchObject({
      format: "macho",
      bits,
      build_info: null,
    });
  },
);
