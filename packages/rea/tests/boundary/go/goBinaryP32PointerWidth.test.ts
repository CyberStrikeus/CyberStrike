import { expect, it } from "vitest";
import { readGoBinaryImage } from "../../../src/go/GoBinaryImage.js";
import {
  createGoBinaryFixture,
  GO_MODULE_TEXT,
} from "../../fixtures/go/image.js";

it("decodes legacy ELF64 Go strings at the record's four-byte pointer width", () => {
  const fixture = createGoBinaryFixture({
    format: "elf",
    bits: 64,
    encoding: "pointer",
    pointerSize: 4,
    goVersion: "go1.13.15",
  });

  expect(readGoBinaryImage(fixture.bytes)).toMatchObject({
    format: "elf",
    architecture: "amd64",
    bits: 64,
    build_info: {
      encoding: "pointer",
      go_version: "go1.13.15",
      module_text: GO_MODULE_TEXT,
      version_location: { offset: fixture.versionOffset, bytes: 9 },
      module_location: {
        offset: fixture.moduleOffset,
        bytes: fixture.moduleBytes.length,
      },
    },
  });
});
