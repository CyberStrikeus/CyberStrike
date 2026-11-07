import { expect, it } from "vitest";

import { readPlistJson } from "../../../../src/native/parsers/plist.js";
import { parseLipoOutput } from "../../../../src/native/parsers/lipo.js";

it.each([
  "line\nbreak",
  "line\r\nbreak",
  "name is architecture: x86_64\ncontinued",
])(
  "retains the reported thin architecture when lipo echoes filename %j",
  (filename) => {
    const output = `input file /owned/${filename} is not a fat file\nNon-fat file: /owned/${filename} is architecture: arm64\n`;
    expect(parseLipoOutput(output)).toMatchObject({
      format: "thin",
      architectures: [{ name: "arm64" }],
    });
  },
);

it("does not mistake fat slice output for a thin Non-fat file record", () => {
  const output = [
    "Fat header in: /owned/universal.dylib",
    "fat_magic 0xcafebab2",
    "nfat_arch 2",
    "architecture arm64",
    "    cputype CPU_TYPE_ARM64",
    "    cpusubtype CPU_SUBTYPE_ARM64E",
    "    offset 16384",
    "    size 16777216",
    "    align 2^14 (16384)",
    "architecture x86_64",
    "    cputype CPU_TYPE_X86_64",
    "    cpusubtype CPU_SUBTYPE_X86_64_ALL",
    "    offset 16793600",
    "    size 16777216",
    "    align 2^12 (4096)",
    "",
  ].join("\n");
  expect(parseLipoOutput(output)).toMatchObject({
    format: "fat",
    architectures: [
      { name: "arm64", file_offset: 16384 },
      { name: "x86_64", file_offset: 16793600 },
    ],
  });
});

it("accepts a byte-order mark before plist JSON", () => {
  const parsed = readPlistJson(
    '\uFEFF{"CFBundleIdentifier":"com.owned.fixture"}',
  ).project();
  if (!parsed.ok) throw new Error("expected plist JSON to parse");
  expect(parsed.value.bundle.identifier).toBe("com.owned.fixture");
});
