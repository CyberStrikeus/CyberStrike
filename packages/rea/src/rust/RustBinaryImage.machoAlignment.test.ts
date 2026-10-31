import { expect, it } from "vitest";
import { machoImageWithUnknownCommand } from "../artifacts/apple/MachoImage.fixture.js";
import { readRustBinaryImage } from "./RustBinaryImage.js";
import { RustAuditableFormatFailure } from "./RustAuditableReader.js";

it("maps malformed 64-bit Mach-O load-command alignment to Rust input failure", () => {
  expect(() =>
    readRustBinaryImage(Buffer.from(machoImageWithUnknownCommand(true, 12))),
  ).toThrow(RustAuditableFormatFailure);
  expect(() =>
    readRustBinaryImage(Buffer.from(machoImageWithUnknownCommand(true, 12))),
  ).toThrow(expect.objectContaining({ kind: "malformed" }));
});

it.each([
  { wide: true, size: 16 },
  { wide: false, size: 12 },
])(
  "accepts $size-byte Rust Mach-O command for wide=$wide",
  ({ wide, size }) => {
    expect(
      readRustBinaryImage(Buffer.from(machoImageWithUnknownCommand(wide, size)))
        .format,
    ).toBe("macho");
  },
);
