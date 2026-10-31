import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { inspectPlistSchema } from "../../../../src/domain/native/nativeInspection.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { ok } from "../../../../src/domain/result.js";
import {
  NativeFixtureRunner,
  nativeMachoTarget,
} from "../../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

const xml =
  "<plist><dict><key>Data</key><data>AAE=</data><key>Count</key><integer>9007199254740993</integer></dict></plist>";
const xmlValue = {
  Data: { $plist_type: "data", base64: "AAE=" },
  Count: { $plist_type: "integer", decimal: "9007199254740993" },
};

const utf32Xml =
  "<plist><dict><key>name</key><string>UTF32 control</string></dict></plist>";
const utf32Bytes = Buffer.alloc(4 + utf32Xml.length * 4);
utf32Bytes.writeUInt32LE(0xfeff, 0);
for (let index = 0; index < utf32Xml.length; index += 1)
  utf32Bytes.writeUInt32LE(utf32Xml.charCodeAt(index), 4 + index * 4);

interface TextSourceCase {
  readonly name: string;
  readonly bytes: Buffer;
  readonly description: string;
  readonly format: string;
  readonly value: unknown;
  readonly limitations?: readonly unknown[];
  readonly conversions: readonly {
    readonly format: string;
    readonly output: string;
    readonly exitCode?: number;
  }[];
}

it.for<TextSourceCase>([
  {
    name: "UTF-8 XML",
    bytes: Buffer.from(xml),
    description: "XML 1.0 document text",
    format: "xml",
    value: xmlValue,
    conversions: [],
  },
  {
    name: "UTF-16LE XML",
    bytes: Buffer.from("\uFEFF" + xml, "utf16le"),
    description: "Unicode text, UTF-16, little-endian text",
    format: "xml",
    value: xmlValue,
    conversions: [],
  },
  {
    name: "UTF-16BE XML",
    bytes: Buffer.from("\uFEFF" + xml, "utf16le").swap16(),
    description: "Unicode text, UTF-16, big-endian text",
    format: "xml",
    value: xmlValue,
    conversions: [],
  },
  {
    name: "unknown XML scalar",
    bytes: Buffer.from("<plist><real>1e999</real></plist>"),
    description: "XML 1.0 document text",
    format: "xml",
    value: {
      $plist_type: "unknown",
      element: "real",
      literal: "1e999",
      reason: "unrepresentable",
    },
    limitations: [
      expect.stringContaining("1 XML scalar value(s) could not be established"),
    ],
    conversions: [],
  },
  {
    name: "unknown OpenStep primitive",
    bytes: Buffer.from("123"),
    description: "ASCII text",
    format: "unknown",
    value: "123",
    conversions: [
      { format: "json", output: "", exitCode: 1 },
      { format: "xml1", output: "<plist><string>123</string></plist>" },
    ],
  },
  {
    name: "unknown JSON container",
    bytes: Buffer.from('{"count":123}'),
    description: "ASCII text",
    format: "unknown",
    value: { count: 123 },
    conversions: [],
  },
  {
    name: "explicit JSON primitive",
    bytes: Buffer.from("123"),
    description: "JSON text data",
    format: "json",
    value: 123,
    conversions: [],
  },
  {
    name: "unsafe JSON container",
    bytes: Buffer.from('{"count":9007199254740993}'),
    description: "ASCII text",
    format: "unknown",
    value: { count: { $plist_type: "integer", decimal: "9007199254740993" } },
    conversions: [
      { format: "json", output: '{"count":9007199254740993}' },
      {
        format: "xml1",
        output:
          "<plist><dict><key>count</key><integer>9007199254740993</integer></dict></plist>",
      },
    ],
  },
  {
    name: "legacy XML encoding",
    bytes: Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?><plist><dict><key>name</key><string>caf\xe9</string></dict></plist>',
      "latin1",
    ),
    description: "XML 1.0 document text",
    format: "xml",
    value: { name: "café" },
    conversions: [{ format: "json", output: '{"name":"café"}' }],
  },
  {
    name: "uncertain XML encoding",
    bytes: utf32Bytes,
    description: "Unicode text, UTF-32, little-endian",
    format: "unknown",
    value: { name: "UTF32 control" },
    conversions: [{ format: "json", output: '{"name":"UTF32 control"}' }],
  },
])("owns $name interpretation before optional conversion", async (fixture) => {
  const root = await createTestTempDirectory("rea-plist-text-source-");
  const path = join(root, "selected.plist");
  await writeFile(path, fixture.bytes);
  const replay = new NativeFixtureRunner({ file: fixture.description });
  const tools: string[] = [];
  let conversionIndex = 0;
  let validations = 0;
  const client = new NativeMacOSProvider(
    {},
    {
      async run(tool, args) {
        tools.push(tool);
        const result = await replay.run(tool, args);
        if (tool !== "plutil" || !result.ok) return result;
        if (args[0] === "-lint") {
          expect(args).toEqual(["-lint", "--", path]);
          validations += 1;
          return result;
        }
        const conversion = fixture.conversions[conversionIndex++];
        if (conversion === undefined)
          throw new Error("Unexpected conversion of directly supported source");
        expect(args).toEqual([
          "-convert",
          conversion.format,
          "-o",
          "-",
          "--",
          path,
        ]);
        return ok({
          ...result.value,
          stdout: conversion.output,
          stdoutBytes: Buffer.byteLength(conversion.output),
          exitCode: conversion.exitCode ?? 0,
        });
      },
    },
    "darwin",
  ).createClient(nativeMachoTarget(join(root, "target")));
  onTestFinished(async () => {
    await client.close();
  });
  const inspected = await client.execute("inspect_plist", { path });
  if (!inspected.ok) throw inspected.error;
  const result = inspectPlistSchema.parse(inspected.value.result);
  expect(result).toMatchObject({
    format: fixture.format,
    value: fixture.value,
    source_path: path,
  });
  expect(result.provenance.map((item) => item.tool)).toEqual(tools);
  const directXml =
    fixture.format === "xml" && fixture.conversions.length === 0;
  expect(validations).toBe(directXml ? 1 : 0);
  expect(tools).toEqual([
    "file",
    ...(directXml ? ["plutil"] : []),
    ...fixture.conversions.map(() => "plutil"),
  ]);
  expect(conversionIndex).toBe(fixture.conversions.length);
  if (fixture.limitations !== undefined)
    expect(result.limitations).toEqual(fixture.limitations);
  expect(
    result.limitations.some((item) => item.includes("XML conversion")),
  ).toBe(
    fixture.conversions.some(
      (item) => item.format === "json" && item.exitCode === 1,
    ),
  );
  expect(Buffer.compare(await readFile(path), fixture.bytes)).toBe(0);
});
