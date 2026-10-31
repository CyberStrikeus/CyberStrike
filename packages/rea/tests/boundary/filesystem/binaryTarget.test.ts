import { execFile } from "node:child_process";
import {
  open,
  type FileHandle,
  chmod,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildBinary } from "plist";
import { describe, expect, it, vi } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import {
  resolveAppBundleExecutable,
  type AppBundleFileSystem,
} from "../../../src/application/AppBundleExecutable.js";
import {
  dosMz,
  elf,
  fat,
  pe,
  thinMach,
} from "../../../src/domain/binaryTarget.fixture.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { hasXmlPlistSignature } from "../../../src/domain/apple/appleArchiveFormat.js";
import { parseExecutableHeader } from "../../../src/domain/binaryTarget.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { ESP8266_REFUSAL } from "../../../src/domain/firmware/espImage.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  esp8266Image,
  espImage,
} from "../../fixtures/espImage.js";
import { espFlashDump } from "../../../src/domain/firmware/espFlash.fixture.js";
import { javaClassFile } from "../../fixtures/javaClassFile.js";
import { dfuseFile } from "../../../src/domain/firmware/dfuse.fixture.js";
import {
  patternBytes,
  uf2File,
  uf2Image,
} from "../../../src/domain/firmware/uf2.fixture.js";
import {
  MAX_JVM_CLASS_IDENTITY_BYTES,
  JVM_CLASS_IDENTITY_LIMIT_REASON,
} from "../../../src/domain/apple/jvmClassFile.js";
import {
  arArchive,
  CPU,
  fatImage,
  machoImage,
  rpathCommand,
  codeSignatureCommand,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import {
  FIT_EMBEDDED,
  FIT_EXTERNAL,
} from "../../../src/artifacts/fit/FitImage.fixture.js";
import { devicetreeFixture } from "../../../src/firmware/devicetree/Devicetree.fixture.js";

it.each([
  [4000, false],
  [9000, false],
  [4000, true],
  [9000, true],
] as const)(
  "refuses a JVM class with %i unused constant bytes and CPU lookalike %s without claiming FAT identity",
  async (constantBytes, fatCpuLookalike) => {
    const directory = await createTestTempDirectory("rea-class-target-");
    const path = join(directory, "input.class");
    const bytes = javaClassFile(constantBytes, fatCpuLookalike);
    expect(parseExecutableHeader(bytes, "arm64")).toEqual({
      ok: false,
      error: "unsupported binary format",
    });
    await writeFile(path, bytes);
    const resolved = await parseBinaryTarget(path);
    expect(resolved).toMatchObject({
      ok: false,
      error: { reason: "unsupported binary format" },
    });
    if (resolved.ok) throw new Error("JVM class was admitted as executable");
    expect(projectAnalysisError(resolved.error)).toMatchObject({
      code: "target_unavailable",
      category: "unsupported_target",
      details: { reason: "unsupported binary format" },
    });
  },
);

it.each([MAX_JVM_CLASS_IDENTITY_BYTES, MAX_JVM_CLASS_IDENTITY_BYTES + 1])(
  "preserves JVM identity uncertainty at the class scan boundary for %i bytes",
  async (size) => {
    const directory = await createTestTempDirectory("rea-class-boundary-");
    const path = join(directory, "input.class");
    const classPrefix = javaClassFile(4000, true);
    classPrefix.writeUInt16BE(1, classPrefix.length - 2);
    const attribute = Buffer.alloc(6);
    attribute.writeUInt16BE(5, 0);
    attribute.writeUInt32BE(size - classPrefix.length - attribute.length, 2);
    const handle = await open(path, "w");
    try {
      await handle.write(Buffer.concat([classPrefix, attribute]));
      await handle.truncate(size);
    } finally {
      await handle.close();
    }
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: {
        reason:
          size === MAX_JVM_CLASS_IDENTITY_BYTES
            ? "unsupported binary format"
            : JVM_CLASS_IDENTITY_LIMIT_REASON,
      },
    });
  },
);

it.each([0x01c0, 0x01c2, 0x01c4, 0xaa64])(
  "retains original PE COFF machine %i through file-backed target resolution",
  async (peMachine) => {
    const directory = await createTestTempDirectory("rea-pe-machine-");
    const path = join(directory, "image.exe");
    const bytes = pe(peMachine === 0xaa64 ? 0xaa64 : 0x01c0);
    bytes.writeUInt16LE(peMachine, bytes.readUInt32LE(0x3c) + 4);
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path);
    expect(target).toMatchObject({
      ok: true,
      value: {
        format: "pe",
        architecture: peMachine === 0xaa64 ? "arm64" : "arm",
        peMachine,
      },
    });
  },
);

it.each([{ cpus: [0x0100000c] }, { cpus: [0x01000007, 0x0100000c] }])(
  "preserves a FAT container's format in the resolved target and Evidence ($cpus)",
  async ({ cpus }) => {
    const directory = await createTestTempDirectory("rea-universal-target-");
    const path = join(directory, "image");
    await writeFile(path, fat(cpus));
    const resolved = await parseBinaryTarget(path, {
      hostArchitecture: "arm64",
    });
    if (!resolved.ok) throw resolved.error;
    expect(resolved.value).toMatchObject({
      kind: "executable",
      format: "mach-o-universal",
      architecture: "arm64",
    });
    const evidence = createEvidence(
      resolved.value,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "inspect_macho",
        parameters: {},
        result: null,
      },
    );
    expect(
      parseEvidence(JSON.parse(JSON.stringify(evidence))).subject,
    ).toMatchObject({
      format: "mach-o-universal",
      architecture: "arm64",
    });
  },
);

it("reads a sparse FAT slice header beyond the bounded prefix", async () => {
  const directory = await createTestTempDirectory("rea-sparse-fat-target-");
  const path = join(directory, "image");
  const sliceOffset = 64 * 1024;
  const file = await open(path, "w+");
  try {
    const fatHeader = Buffer.alloc(28);
    fatHeader.writeUInt32BE(0xcafebabe, 0);
    fatHeader.writeUInt32BE(1, 4);
    fatHeader.writeUInt32BE(CPU.arm64.type, 8);
    fatHeader.writeUInt32BE(CPU.arm64.subtype, 12);
    fatHeader.writeUInt32BE(sliceOffset, 16);
    fatHeader.writeUInt32BE(32, 20);
    await file.write(fatHeader, 0, fatHeader.length, 0);
    const sliceHeader = machoImage({ cpu: CPU.arm64 }).subarray(0, 12);
    await file.write(sliceHeader, 0, sliceHeader.length, sliceOffset);
    await file.truncate(sliceOffset + 32);
  } finally {
    await file.close();
  }
  expect(
    await parseBinaryTarget(path, { hostArchitecture: "arm64" }),
  ).toMatchObject({
    ok: true,
    value: { format: "mach-o-universal", architecture: "arm64" },
  });
});

it("reads the complete bounded 128-entry FAT64 table beyond the prefix", async () => {
  const directory = await createTestTempDirectory("rea-fat64-max-table-");
  const path = join(directory, "image");
  const entryCount = 128;
  const tableEnd = 8 + entryCount * 32;
  const sliceSize = 32;
  const file = await open(path, "w+");
  try {
    const table = Buffer.alloc(tableEnd);
    table.writeUInt32BE(0xcafebabf, 0);
    table.writeUInt32BE(entryCount, 4);
    const thinHeader = machoImage({ cpu: CPU.arm64 }).subarray(0, 12);
    for (let index = 0; index < entryCount; index += 1) {
      const entry = 8 + index * 32;
      const sliceOffset = tableEnd + index * sliceSize;
      table.writeUInt32BE(CPU.arm64.type, entry);
      table.writeUInt32BE(CPU.arm64.subtype, entry + 4);
      table.writeBigUInt64BE(BigInt(sliceOffset), entry + 8);
      table.writeBigUInt64BE(BigInt(sliceSize), entry + 16);
      await file.write(thinHeader, 0, thinHeader.length, sliceOffset);
    }
    await file.write(table, 0, table.length, 0);
    await file.truncate(tableEnd + entryCount * sliceSize);
  } finally {
    await file.close();
  }
  expect(
    await parseBinaryTarget(path, { hostArchitecture: "arm64" }),
  ).toMatchObject({
    ok: true,
    value: { format: "mach-o-universal", architecture: "arm64" },
  });
});

it.each([0, 1])(
  "rejects a file-backed FAT CPU mismatch in slice %i before host selection",
  async (wrongIndex) => {
    const directory = await createTestTempDirectory("rea-fat-cpu-mismatch-");
    const path = join(directory, "image");
    const bytes = fatImage([
      { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
      { cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) },
    ]);
    const entry = 8 + wrongIndex * 20;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      entry,
      wrongIndex === 0 ? CPU.arm64.type : CPU.x86_64.type,
      false,
    );
    await writeFile(path, Buffer.from(bytes));
    expect(
      await parseBinaryTarget(path, { hostArchitecture: "arm64" }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        reason: `FAT architecture ${wrongIndex} CPU type/subtype disagrees with its Mach-O header`,
        constraint: "file_format_rejected",
      },
    });
  },
);

it.each([
  {
    name: "archive slices",
    slices: [
      { cpu: CPU.x86_64, bytes: arArchive() },
      { cpu: CPU.arm64, bytes: arArchive("second.o") },
    ],
  },
  {
    name: "mixed Mach-O and archive slices",
    slices: [
      { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
      { cpu: CPU.arm64, bytes: arArchive() },
    ],
  },
])("refuses FAT $name before provider selection", async ({ slices }) => {
  const directory = await createTestTempDirectory("rea-fat-archive-target-");
  const path = join(directory, "image");
  await writeFile(path, fatImage(slices));
  expect(
    await parseBinaryTarget(path, { hostArchitecture: "arm64" }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
    },
  });
});

describe("binary target I/O: app plist permissions and decoding", () => {
  it.each([
    ["EACCES", "permission denied reading app Info.plist"],
    ["EPERM", "permission denied reading app Info.plist"],
  ])("preserves %s while reading an app plist", async (code, message) => {
    const directory = await createTestTempDirectory("rea-app-permission-");
    const app = join(directory, "Permission.app");
    await mkdir(join(app, "Contents"), { recursive: true });
    await writeFile(join(app, "Contents", "Info.plist"), "placeholder");
    const denied = Object.assign(new Error("denied"), { code });
    const fileSystem: AppBundleFileSystem = {
      readFile: async () => {
        throw denied;
      },
      realpath,
    };
    const result = await resolveAppBundleExecutable(app, fileSystem);
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        path: join(app, "Contents", "Info.plist"),
        reason: expect.stringContaining(message),
        cause: denied,
        systemCode: code,
      },
    });
  });

  it("preserves non-permission plist read failures as read failures", async () => {
    const directory = await createTestTempDirectory("rea-app-read-error-");
    const app = join(directory, "ReadError.app");
    await mkdir(join(app, "Contents"), { recursive: true });
    await writeFile(join(app, "Contents", "Info.plist"), "placeholder");
    const readError = Object.assign(new Error("I/O failure"), { code: "EIO" });
    const result = await resolveAppBundleExecutable(app, {
      readFile: async () => {
        throw readError;
      },
      realpath,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        path: join(app, "Contents", "Info.plist"),
        reason: expect.stringContaining("could not read app Info.plist"),
        cause: readError,
      },
    });
  });

  it("does not label binary plist decoder I/O failures as malformed data", async () => {
    const directory = await createTestTempDirectory("rea-app-decode-error-");
    const app = join(directory, "DecodeError.app");
    await mkdir(join(app, "Contents"), { recursive: true });
    await writeFile(join(app, "Contents", "Info.plist"), "bplist00");
    const decodeError = Object.assign(new Error("I/O failure"), {
      code: "EIO",
    });
    const result = await resolveAppBundleExecutable(app, {
      readFile: async () => Buffer.from("bplist00"),
      realpath,
      decodeBinaryPlist: async () => {
        throw decodeError;
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        path: join(app, "Contents", "Info.plist"),
        reason: expect.stringContaining("could not decode app Info.plist"),
        cause: decodeError,
      },
    });
  });

  it.each(["EACCES", "EPERM", "ENOENT", "ENOTDIR"])(
    "preserves %s while resolving an app executable",
    async (code) => {
      const directory = await createTestTempDirectory("rea-app-permission-");
      const app = join(directory, "Permission.app");
      const programs = join(app, "Contents", "MacOS");
      await mkdir(programs, { recursive: true });
      await writeFile(
        join(app, "Contents", "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
      );
      const denied = Object.assign(new Error("denied"), { code });
      const fileSystem: AppBundleFileSystem = {
        readFile,
        realpath: async (path) => {
          if (String(path) === join(programs, "App")) throw denied;
          return realpath(path);
        },
      };
      const result = await resolveAppBundleExecutable(app, fileSystem);
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "BinaryTargetError",
          path: join(programs, "App"),
          reason: expect.stringContaining(
            code === "EACCES" || code === "EPERM"
              ? "permission denied"
              : "missing",
          ),
          cause: denied,
        },
      });
    },
  );

  it("keeps missing and malformed plist diagnostics distinct", async () => {
    const directory = await createTestTempDirectory("rea-app-diagnostics-");
    const missing = join(directory, "Missing.app");
    await mkdir(join(missing, "Contents"), { recursive: true });
    const missingResult = await resolveAppBundleExecutable(missing);
    expect(missingResult).toMatchObject({
      ok: false,
      error: { reason: expect.stringContaining("missing") },
    });

    const notDirectory = join(directory, "NotDirectory.app");
    await mkdir(notDirectory, { recursive: true });
    await writeFile(join(notDirectory, "Contents"), "not a directory");
    const notDirectoryResult = await resolveAppBundleExecutable(notDirectory);
    expect(notDirectoryResult).toMatchObject({
      ok: false,
      error: { reason: expect.stringContaining("missing") },
    });

    const malformed = join(directory, "Malformed.app");
    await mkdir(join(malformed, "Contents", "MacOS"), { recursive: true });
    await writeFile(
      join(malformed, "Contents", "Info.plist"),
      "<plist><dict></dict></plist>",
    );
    const malformedResult = await resolveAppBundleExecutable(malformed);
    expect(malformedResult).toMatchObject({
      ok: false,
      error: {
        path: join(malformed, "Contents", "Info.plist"),
        reason: expect.stringContaining("malformed"),
      },
    });
  });
});

describe("binary target I/O: package classification", () => {
  it("classifies ZIP package families and text artifacts without Hopper", async () => {
    const directory = await createTestTempDirectory("rea-artifact-target-");
    const zip = join(directory, "fixture.apk");
    const msix = join(directory, "fixture.msixbundle");
    const appx = join(directory, "fixture.appx");
    const script = join(directory, "bundle.js");
    const emptyZip = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    await Promise.all([
      writeFile(zip, emptyZip),
      writeFile(msix, emptyZip),
      writeFile(appx, emptyZip),
    ]);
    await writeFile(script, "export default 1;\n");
    const archive = await parseBinaryTarget(zip);
    const msixArchive = await parseBinaryTarget(msix);
    const appxArchive = await parseBinaryTarget(appx);
    const javascript = await parseBinaryTarget(script);
    expect(archive.ok && archive.value).toMatchObject({
      kind: "archive",
      format: "apk",
    });
    expect(msixArchive.ok && msixArchive.value).toMatchObject({
      kind: "archive",
      format: "msix",
    });
    expect(appxArchive.ok && appxArchive.value).toMatchObject({
      kind: "archive",
      format: "appx",
    });
    expect(javascript.ok && javascript.value).toMatchObject({
      kind: "artifact",
      format: "javascript",
    });
  });

  it.each(["archive", "hop"])(
    "classifies binary plist magic under a .%s extension",
    async (suffix) => {
      const directory = await createTestTempDirectory("rea-bplist-target-");
      const path = join(directory, `Model.${suffix}`);
      await writeFile(path, buildBinary({ $archiver: "NSKeyedArchiver" }));
      const result = await parseBinaryTarget(path);
      expect(result.ok && result.value).toMatchObject({
        kind: "artifact",
        format: "plist",
      });
    },
  );

  it("classifies XML plists by content while preserving named formats", async () => {
    const directory = await createTestTempDirectory("rea-xml-plist-target-");
    const xml = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>$archiver</key><string>NSKeyedArchiver</string></dict></plist>',
    );
    const archivePath = join(directory, "Model.archive");
    const javascriptPath = join(directory, "Model.js");
    await writeFile(archivePath, xml);
    await writeFile(javascriptPath, xml);

    const archive = await parseBinaryTarget(archivePath);
    const javascript = await parseBinaryTarget(javascriptPath);
    expect(archive.ok && archive.value).toMatchObject({
      kind: "artifact",
      format: "plist",
    });
    expect(javascript.ok && javascript.value).toMatchObject({
      kind: "artifact",
      format: "javascript",
    });
  });

  it("continues a bounded XML plist probe beyond the initial file window", async () => {
    const directory = await createTestTempDirectory("rea-xml-long-prolog-");
    const path = join(directory, "Model.archive");
    await writeFile(
      path,
      `<?xml version="1.0"?>${" ".repeat(8192)}<plist><dict/></plist>`,
    );

    const result = await parseBinaryTarget(path);
    expect(result.ok && result.value).toMatchObject({
      kind: "artifact",
      format: "plist",
    });
    expect(hasXmlPlistSignature(Buffer.from(`<root><plist/></root>`))).toBe(
      false,
    );
  });

  it("classifies Intel HEX and S-records by a valid first record", async () => {
    const directory = await createTestTempDirectory("rea-hex-target-");
    const hex = join(directory, "firmware.hex");
    const text = join(directory, "firmware.txt");
    const srec = join(directory, "firmware.mot");
    const bad = join(directory, "bad.hex");
    await Promise.all([
      writeFile(hex, ":0300300002337A1E\n:00000001FF\n"),
      writeFile(text, ":00000001FF\n"),
      writeFile(srec, "S9030000FC\n"),
      writeFile(bad, ":0300300002337A1F\n:00000001FF\n"),
    ]);
    for (const [path, format] of [
      [hex, "intel-hex"],
      [text, "intel-hex"],
      [srec, "srec"],
    ] as const)
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: true,
        value: { kind: "archive", format },
      });
    expect(await parseBinaryTarget(bad)).toMatchObject({
      ok: false,
      error: { _tag: "BinaryTargetError" },
    });
  });
});

describe("binary target I/O: image classification", () => {
  it("classifies ESP images by bytes and refuses ESP8266 v1 images", async () => {
    const directory = await createTestTempDirectory("rea-esp-target-");
    const app = join(directory, "firmware.ota");
    const truncated = join(directory, "download.bin");
    const esp8266 = join(directory, "esp8266.bin");
    const encrypted = join(directory, "encrypted.bin");
    const image = espImage({ segments: ESP32C3_APP_SEGMENTS });
    await Promise.all([
      writeFile(app, image),
      writeFile(truncated, image.subarray(0, 40)),
      writeFile(esp8266, esp8266Image()),
      writeFile(encrypted, Buffer.alloc(4096, 0x5a)),
    ]);
    for (const path of [app, truncated])
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: true,
        value: { kind: "archive", format: "esp-image" },
      });
    expect(await parseBinaryTarget(esp8266)).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        constraint: "file_format_rejected",
        reason: ESP8266_REFUSAL,
      },
    });
    // Flash-encrypted bytes carry no magic; they stay unrecognized, not ESP.
    const unrecognized = await parseBinaryTarget(encrypted);
    expect(unrecognized.ok).toBe(false);
    expect(JSON.stringify(unrecognized)).not.toContain("ESP");
  });

  it("does not trust a ZIP-family extension without ZIP magic", async () => {
    const directory = await createTestTempDirectory("rea-fake-archive-");
    const path = join(directory, "fake.zip");
    await writeFile(path, "not a zip");
    const result = await parseBinaryTarget(path);
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "BinaryTargetError" },
    });
  });
});

describe("binary target I/O: firmware containers", () => {
  it("classifies UF2 by block magics and DfuSe by its prefix and suffix", async () => {
    const directory = await createTestTempDirectory("rea-firmware-target-");
    const uf2 = uf2File(uf2Image(0xe48b_ff56, 0x1000_0000, patternBytes(300)));
    const dfu = dfuseFile({
      targets: [{ alternateSetting: 0, elements: [{ address: 0, data: [1] }] }],
    });
    const paths = {
      uf2: join(directory, "firmware.bin"),
      dfuse: join(directory, "firmware.img"),
      badCrc: join(directory, "bad-crc.dfu"),
      shortUf2: join(directory, "short.uf2"),
      noSuffix: join(directory, "no-suffix.dfu"),
    };
    // The suffix CRC is checked by inventory, not by recognition.
    const badCrc = Buffer.from(dfu);
    badCrc.writeUInt32LE(0x1234_5678, badCrc.length - 4);
    await Promise.all([
      writeFile(paths.uf2, uf2),
      writeFile(paths.dfuse, dfu),
      writeFile(paths.badCrc, badCrc),
      writeFile(paths.shortUf2, uf2.subarray(0, 511)),
      writeFile(paths.noSuffix, dfu.subarray(0, dfu.length - 16)),
    ]);
    for (const [path, format] of [
      [paths.uf2, "uf2"],
      [paths.dfuse, "dfuse"],
      [paths.badCrc, "dfuse"],
    ] as const)
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: true,
        value: { kind: "archive", format },
      });
    for (const path of [paths.shortUf2, paths.noSuffix])
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: false,
        error: { _tag: "BinaryTargetError" },
      });
  });
});

describe("binary target I/O: ESP flash layouts", () => {
  it("detects a flash layout before the bootloader it begins with", async () => {
    const directory = await createTestTempDirectory("rea-esp-flash-target-");
    const dump = join(directory, "flash.bin");
    const bootloader = join(directory, "bootloader.bin");
    const image = espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS });
    await Promise.all([
      writeFile(dump, espFlashDump({ bootloader: { at: 0, bytes: image } })),
      writeFile(bootloader, image),
    ]);
    expect(await parseBinaryTarget(dump)).toMatchObject({
      ok: true,
      value: {
        kind: "archive",
        format: "esp-flash-image",
        espFlash: {
          selected: false,
          flashOffset: null,
          partitionTableOffset: null,
        },
      },
    });
    expect(await parseBinaryTarget(bootloader)).toMatchObject({
      ok: true,
      value: { kind: "archive", format: "esp-image" },
    });
  });

  it("keeps refusing an ESP8266 dump that has an ESP-IDF-style table", async () => {
    const directory = await createTestTempDirectory("rea-esp8266-flash-");
    const dump = join(directory, "esp8266-flash.bin");
    await writeFile(
      dump,
      espFlashDump({ bootloader: { at: 0, bytes: esp8266Image() } }),
    );
    expect(await parseBinaryTarget(dump)).toMatchObject({
      ok: false,
      error: {
        constraint: "file_format_rejected",
        reason: ESP8266_REFUSAL,
      },
    });
  });

  it("reads a selected flash dump with caller inputs and refuses bad pairings", async () => {
    const directory = await createTestTempDirectory("rea-esp-flash-select-");
    const esp32 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0,
    });
    const partial = join(directory, "from-0x1000.bin");
    const noise = join(directory, "noise.bin");
    await Promise.all([
      writeFile(
        partial,
        espFlashDump({ bootloader: { at: 0x1000, bytes: esp32 } }).subarray(
          0x1000,
        ),
      ),
      writeFile(noise, Buffer.alloc(0x1_0000, 0x5a)),
    ]);
    expect(
      await parseBinaryTarget(partial, {
        formatHint: "esp-flash-image",
        espFlash: { flashOffset: 0x1000 },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "archive",
        format: "esp-flash-image",
        espFlash: {
          selected: true,
          flashOffset: 0x1000,
          partitionTableOffset: null,
        },
      },
    });
    for (const [options, reason] of [
      [
        { espFlash: { flashOffset: 0x1000 } },
        "flash_offset and partition_table_offset apply only with format=esp-flash-image",
      ],
      [
        {
          formatHint: "esp-flash-image",
          espFlash: { partitionTableOffset: 0x8800 },
        },
        "partition_table_offset must be a multiple of 0x1000, as ESP-IDF requires",
      ],
    ] as const)
      expect(await parseBinaryTarget(partial, options)).toMatchObject({
        ok: false,
        error: {
          _tag: "BinaryTargetError",
          constraint: "load_selection_rejected",
          reason,
        },
      });
    // Ciphertext is not recognized as a layout: unknown, not malformed.
    expect(
      await parseBinaryTarget(noise, { formatHint: "esp-flash-image" }),
    ).toMatchObject({
      ok: false,
      error: {
        constraint: "file_format_rejected",
        reason: expect.stringContaining(
          "ESP flash image layout is not recognized",
        ),
      },
    });
  });
});

it("classifies a FIT by its /images node and leaves a plain DTB rejected", async () => {
  const directory = await createTestTempDirectory("rea-fit-target-");
  const itb = join(directory, "boot.itb");
  const extensionless = join(directory, "boot");
  const dtb = join(directory, "board.dtb");
  await Promise.all([
    writeFile(itb, FIT_EMBEDDED),
    writeFile(extensionless, FIT_EXTERNAL),
    writeFile(dtb, devicetreeFixture()),
  ]);
  for (const path of [itb, extensionless])
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { kind: "archive", format: "fit" },
    });
  expect(await parseBinaryTarget(dtb)).toMatchObject({
    ok: false,
    error: {
      _tag: "BinaryTargetError",
      constraint: "file_format_rejected",
    },
  });
});

describe("binary target I/O: filesystem and app bundle target resolution", () => {
  it("resolves relative Hopper databases and rejects unknown or unreadable paths", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    await writeFile(join(directory, "sample.hop"), "database");
    await writeFile(join(directory, "text"), "hello");
    const database = await parseBinaryTarget("sample.hop", { cwd: directory });
    expect(database).toMatchObject({
      ok: true,
      value: { kind: "database", format: "analysis-database" },
    });
    expect(database.ok && database.value.sha256).toBe(
      "3549b0028b75d981cdda2e573e9cb49dedc200185876df299f912b79f69dabd8",
    );
    expect((await parseBinaryTarget("text", { cwd: directory })).ok).toBe(
      false,
    );
    expect((await parseBinaryTarget("missing", { cwd: directory })).ok).toBe(
      false,
    );
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an unreadable target as a host read denial",
    async () => {
      const directory = await createTestTempDirectory("rea-target-denied-");
      const path = join(directory, "unreadable");
      await writeFile(path, thinMach(0xcffaedfe, 0x0100000c));
      await chmod(path, 0);
      try {
        const result = await parseBinaryTarget(path, {
          cwd: directory,
          hostArchitecture: "arm64",
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatchObject({ path, systemCode: "EACCES" });
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "access_denied",
          details: { path, system_code: "EACCES" },
        });
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  it("rejects non-regular targets before reading them", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    expect((await parseBinaryTarget(directory)).ok).toBe(false);
  });

  it("resolves a macOS app bundle to its declared program file", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const app = join(directory, "Example App.app");
    const contents = join(app, "Contents");
    const programs = join(contents, "MacOS");
    await mkdir(programs, { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      '<?xml version="1.0"?><plist><dict><key>CFBundleExecutable</key><string>Example &amp; Tool</string></dict></plist>',
    );
    await writeFile(
      join(programs, "Example & Tool"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    const result = await parseBinaryTarget(app, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok && result.value).toMatchObject({
      path: await realpath(join(programs, "Example & Tool")),
      format: "mach-o",
    });
  });

  it.skipIf(process.platform === "win32")(
    "preserves a literal backslash in a POSIX app executable name",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Back.app");
      const programs = join(app, "Contents", "MacOS");
      const executable = join(programs, "App\\Name");
      await mkdir(programs, { recursive: true });
      await writeFile(
        join(app, "Contents", "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>App\\Name</string></dict></plist>",
      );
      await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(executable),
        format: "mach-o",
      });
    },
  );

  it.skipIf(process.platform !== "win32")(
    "rejects a Windows separator in an app executable declaration",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Broken.app");
      await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
      await writeFile(
        join(app, "Contents", "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>..\\escape</string></dict></plist>",
      );
      const result = await parseBinaryTarget(app, { cwd: directory });
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "app has an unsafe CFBundleExecutable" },
      });
    },
  );

  it.each([
    ["missing plist", undefined],
    ["missing executable name", "<plist><dict></dict></plist>"],
    [
      "unsafe executable name",
      "<plist><dict><key>CFBundleExecutable</key><string>../escape</string></dict></plist>",
    ],
    [
      "missing program file",
      "<plist><dict><key>CFBundleExecutable</key><string>Missing</string></dict></plist>",
    ],
  ])("rejects an app bundle with %s", async (_case, plist) => {
    const directory = await createTestTempDirectory("rea-target-");
    const app = join(directory, "Broken.app");
    const contents = join(app, "Contents");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    if (plist !== undefined)
      await writeFile(join(contents, "Info.plist"), plist);
    expect(
      (
        await parseBinaryTarget(app, {
          cwd: directory,
          hostArchitecture: "arm64",
        })
      ).ok,
    ).toBe(false);
  });
});

describe("app bundle canonical containment", () => {
  it.skipIf(process.platform === "win32")(
    "rejects an app program symlink that leaves the bundle",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Escaping.app");
      const contents = join(app, "Contents");
      const programs = join(contents, "MacOS");
      const outside = join(directory, "outside");
      await mkdir(programs, { recursive: true });
      await writeFile(outside, thinMach(0xfeedfacf, 0x0100000c));
      await writeFile(
        join(contents, "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>Escaping</string></dict></plist>",
      );
      await symlink(outside, join(programs, "Escaping"));
      expect(
        (
          await parseBinaryTarget(app, {
            cwd: directory,
            hostArchitecture: "arm64",
          })
        ).ok,
      ).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a Contents/MacOS directory symlink that leaves the bundle",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Escaping.app");
      const contents = join(app, "Contents");
      const programs = join(contents, "MacOS");
      const outside = join(directory, "outside");
      await mkdir(contents, { recursive: true });
      await mkdir(outside);
      await writeFile(
        join(contents, "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>Escaping</string></dict></plist>",
      );
      await writeFile(
        join(outside, "Escaping"),
        thinMach(0xfeedfacf, 0x0100000c),
      );
      await symlink(outside, programs, "dir");

      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          path: app,
          reason: "app program directory leaves Contents/MacOS",
        },
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "allows bundle and program directory aliases within the canonical bundle",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Canonical.app");
      const alias = join(directory, "Alias.app");
      const contents = join(app, "Contents");
      const programs = join(contents, "Programs");
      const executable = join(programs, "Example");
      await mkdir(programs, { recursive: true });
      await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
      await writeFile(
        join(contents, "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>Example</string></dict></plist>",
      );
      await symlink(programs, join(contents, "MacOS"), "dir");
      await symlink(app, alias, "dir");
      const result = await parseBinaryTarget(alias, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result).toMatchObject({
        ok: true,
        value: { path: await realpath(executable), format: "mach-o" },
      });
    },
  );
});

describe("binary target I/O: explicit kinds and executable headers", () => {
  it("honors an explicit database kind without relying on the file suffix", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    await writeFile(join(directory, "saved-analysis"), "database");
    const result = await parseBinaryTarget("saved-analysis", {
      cwd: directory,
      hostArchitecture: "arm64",
      targetKind: "database",
    });
    expect(result.ok && result.value).toMatchObject({
      kind: "database",
      format: "analysis-database",
    });
  });

  it("reads a PE header beyond the initial probe", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const path = join(directory, "delayed.exe");
    await writeFile(path, pe(0x8664, 8192));
    const result = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "x64",
    });
    expect(result.ok && result.value).toMatchObject({
      format: "pe",
      architecture: "x86_64",
    });
  });

  it("extracts CodeView RSDS debug metadata from a PE target", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const path = join(directory, "symbols.exe");
    await writeFile(
      path,
      pe(0x8664, 64, 0x0002, false, {
        type: "RSDS",
        pdbPath: "C:\\build\\test.pdb",
        guid: "12345678-abcd-ef01-2345-6789abcdef01",
        age: 3,
      }),
    );
    const result = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "x64",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      format: "pe",
      architecture: "x86_64",
      codeView: {
        pdbPath: "C:\\build\\test.pdb",
        pdbFileName: "test.pdb",
        guid: "12345678-abcd-ef01-2345-6789abcdef01",
        age: 3,
      },
    });
  });

  it("extracts CodeView NB10 debug metadata from a PE target", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const path = join(directory, "legacy.exe");
    await writeFile(
      path,
      pe(0x014c, 64, 0x0002, false, {
        type: "NB10",
        pdbPath: "D:\\old\\legacy.pdb",
        age: 1,
      }),
    );
    const result = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "ia32",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      format: "pe",
      architecture: "x86",
      codeView: {
        pdbPath: "D:\\old\\legacy.pdb",
        pdbFileName: "legacy.pdb",
        guid: null,
        age: 1,
      },
    });
  });

  it("refuses a truncated Mach-O header before any provider sees it", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const path = join(directory, "truncated");
    await writeFile(path, thinMach(0xcffaedfe, 0x0100000c).subarray(0, 12));
    const result = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      path,
      reason:
        "truncated Mach-O header: a 64-bit header needs 32 bytes; the file has 12",
    });
  });

  it("checks Mach-O load commands against the whole file beyond the probe", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const path = join(directory, "large-commands");
    const firstCommand = rpathCommand("@loader_path/" + "a".repeat(8192));
    const bytes = Buffer.from(
      machoImage({ commands: [firstCommand, codeSignatureCommand()] }),
    );
    await writeFile(path, bytes);
    const result = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok && result.value).toMatchObject({
      format: "mach-o",
      architecture: "arm64",
    });

    // The second command's header lies beyond the initial 4096-byte probe.
    // Corrupting it must fail admission even though the prefix is unchanged.
    bytes.writeUInt32LE(0, 32 + firstCommand.length + 4);
    await writeFile(path, bytes);
    const malformed = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(malformed).toMatchObject({
      ok: false,
      error: {
        path,
        reason: `load command 1 at offset ${firstCommand.length} has invalid cmdsize 0`,
      },
    });
  });
});

describe("app executable filename fidelity", () => {
  it.each([" leading", "trailing ", " both "])(
    "preserves executable filename whitespace in an XML plist: %j",
    async (name) => {
      const directory = await createTestTempDirectory("rea-app-name-");
      const app = join(directory, "Whitespace.app");
      const contents = join(app, "Contents");
      const executable = join(contents, "MacOS", name);
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(
        join(contents, "Info.plist"),
        `<plist><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`,
      );
      await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(executable),
        format: "mach-o",
      });
    },
  );

  it.each([
    ["an escaped entity reference", "a&amp;lt;b", "a&lt;b"],
    ["a numeric character reference", "a&#32;b", "a b"],
    ["a CDATA section", "<![CDATA[a&b]]>", "a&b"],
  ])(
    "decodes an XML plist executable name containing %s",
    async (_case, encoded, name) => {
      const directory = await createTestTempDirectory("rea-app-xml-name-");
      const app = join(directory, "Encoded.app");
      const contents = join(app, "Contents");
      const executable = join(contents, "MacOS", name);
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(
        join(contents, "Info.plist"),
        `<plist><dict><key>CFBundleExecutable</key><string>${encoded}</string></dict></plist>`,
      );
      await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(executable),
        format: "mach-o",
      });
    },
  );

  it("reads the top-level executable key rather than commented or nested text", async () => {
    const directory = await createTestTempDirectory("rea-app-xml-key-");
    const app = join(directory, "Nested.app");
    const contents = join(app, "Contents");
    const executable = join(contents, "MacOS", "App");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      [
        "<plist><dict>",
        "<!-- <key>CFBundleExecutable</key><string>Old</string> -->",
        "<key>NSExtension</key><dict><key>CFBundleExecutable</key><string>Inner</string></dict>",
        "<key>CFBundleExecutable</key><string>App</string>",
        "</dict></plist>",
      ].join(""),
    );
    await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
    await writeFile(
      join(contents, "MacOS", "Old"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "MacOS", "Inner"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    const result = await parseBinaryTarget(app, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok && result.value).toMatchObject({
      path: await realpath(executable),
    });
  });

  it.each([
    "<key>__proto__</key><dict><key>CFBundleExecutable</key><string>Forged</string></dict>",
    "<key>&#95;_proto__</key><string>x</string>",
  ])("opens an app whose XML plist also holds %s", async (entry) => {
    const directory = await createTestTempDirectory("rea-app-xml-proto-");
    const app = join(directory, "Proto.app");
    const contents = join(app, "Contents");
    const executable = join(contents, "MacOS", "App");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      `<plist><dict>${entry}<key>CFBundleExecutable</key><string>App</string></dict></plist>`,
    );
    await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
    const result = await parseBinaryTarget(app, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok && result.value).toMatchObject({
      path: await realpath(executable),
    });
  });

  it.skipIf(process.platform !== "darwin")(
    "preserves executable filename whitespace from native binary plists",
    async () => {
      const directory = await createTestTempDirectory("rea-app-binary-name-");
      for (const name of ["Ordinary", " App ", "Tab\t"]) {
        const app = join(directory, `${name}.app`);
        const contents = join(app, "Contents");
        const executable = join(contents, "MacOS", name);
        const plist = join(contents, "Info.plist");
        await mkdir(join(contents, "MacOS"), { recursive: true });
        await writeFile(
          plist,
          `<plist><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`,
        );
        await promisify(execFile)("/usr/bin/plutil", [
          "-convert",
          "binary1",
          plist,
        ]);
        await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
        const result = await parseBinaryTarget(app, {
          cwd: directory,
          hostArchitecture: "arm64",
        });
        expect(result.ok && result.value).toMatchObject({
          path: await realpath(executable),
          format: "mach-o",
        });
      }
    },
  );
});

describe("iOS-style app bundle targets", () => {
  const plist = (name: string) =>
    `<plist><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`;

  it("resolves a flat bundle's program file beside its Info.plist", async () => {
    const directory = await createTestTempDirectory("rea-target-");
    const app = join(directory, "Flat.app");
    await mkdir(app);
    await writeFile(join(app, "Info.plist"), plist("Flat"));
    await writeFile(join(app, "Flat"), thinMach(0xfeedfacf, 0x0100000c));
    const result = await parseBinaryTarget(app, {
      cwd: directory,
      hostArchitecture: "arm64",
    });
    expect(result.ok && result.value).toMatchObject({
      path: await realpath(join(app, "Flat")),
      bundleInfoPlist: join(await realpath(app), "Info.plist"),
      format: "mach-o",
    });
  });

  it.skipIf(process.platform === "win32")(
    "keeps the declaring Info.plist for a symlinked program file",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Linked.app");
      await mkdir(join(app, "bin"), { recursive: true });
      await writeFile(join(app, "Info.plist"), plist("Linked"));
      await writeFile(
        join(app, "bin", "real"),
        thinMach(0xfeedfacf, 0x0100000c),
      );
      await symlink("bin/real", join(app, "Linked"));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(join(app, "bin", "real")),
        bundleInfoPlist: join(await realpath(app), "Info.plist"),
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "follows a readable Contents/Info.plist symlink",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Linked.app");
      const contents = join(app, "Contents");
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await writeFile(join(contents, "Real.plist"), plist("Linked"));
      await symlink("Real.plist", join(contents, "Info.plist"));
      await writeFile(
        join(contents, "MacOS", "Linked"),
        thinMach(0xfeedfacf, 0x0100000c),
      );
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(join(contents, "MacOS", "Linked")),
      });
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a wrapper it cannot read as a permission denial",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Locked.app");
      const wrapper = join(app, "Wrapper");
      await mkdir(join(wrapper, "Locked.app"), { recursive: true });
      await chmod(wrapper, 0o000);
      try {
        const result = await parseBinaryTarget(app, {
          cwd: directory,
          hostArchitecture: "arm64",
        });
        if (result.ok) throw new Error("Expected a permission denial");
        expect(result.error.message).toContain("permission denied");
      } finally {
        await chmod(wrapper, 0o755);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "resolves an iOS-on-Mac wrapper through its single Wrapper bundle",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Phone.app");
      const wrapped = join(app, "Wrapper", "Phone.app");
      await mkdir(wrapped, { recursive: true });
      await writeFile(join(wrapped, "Info.plist"), plist("Phone"));
      await writeFile(join(wrapped, "Phone"), thinMach(0xfeedfacf, 0x0100000c));
      await symlink("Wrapper/Phone.app", join(app, "WrappedBundle"));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      expect(result.ok && result.value).toMatchObject({
        path: await realpath(join(wrapped, "Phone")),
        format: "mach-o",
      });

      await mkdir(join(app, "Wrapper", "Second.app"));
      expect(
        (
          await parseBinaryTarget(app, {
            cwd: directory,
            hostArchitecture: "arm64",
          })
        ).ok,
      ).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a flat bundle program symlink that leaves the bundle",
    async () => {
      const directory = await createTestTempDirectory("rea-target-");
      const app = join(directory, "Escaping.app");
      const outside = join(directory, "outside");
      await mkdir(app);
      await writeFile(outside, thinMach(0xfeedfacf, 0x0100000c));
      await writeFile(join(app, "Info.plist"), plist("Escaping"));
      await symlink(outside, join(app, "Escaping"));
      const result = await parseBinaryTarget(app, {
        cwd: directory,
        hostArchitecture: "arm64",
      });
      if (result.ok) throw new Error("Expected an escaping program file");
      expect(result.error.message).toContain("leaves the bundle root");
    },
  );
});

describe("binary Info.plist app bundle targets", () => {
  it.each([
    ["Mac.app", ["Contents", "MacOS"], ["Contents", "Info.plist"]],
    ["Phone.app", [], ["Info.plist"]],
  ])(
    "resolves %s from a binary Info.plist on every host",
    async (bundle, programs, plist) => {
      const directory = await createTestTempDirectory("rea-app-bplist-");
      // Windows file names cannot hold a tab or end in a space.
      const names =
        process.platform === "win32"
          ? ["Ordinary"]
          : ["Ordinary", " App ", "Tab\t"];
      for (const name of names) {
        const app = join(directory, name, bundle);
        const executable = join(app, ...programs, name);
        await mkdir(join(app, ...programs), { recursive: true });
        await mkdir(join(app, ...plist.slice(0, -1)), { recursive: true });
        await writeFile(
          join(app, ...plist),
          buildBinary({ CFBundleExecutable: name, CFBundleVersion: "1" }),
        );
        await writeFile(executable, thinMach(0xfeedfacf, 0x0100000c));
        const result = await parseBinaryTarget(app, {
          cwd: directory,
          hostArchitecture: "arm64",
        });
        expect(result.ok && result.value).toMatchObject({
          path: await realpath(executable),
          format: "mach-o",
        });
      }
    },
  );

  it.each([
    [
      "XML",
      "<plist><dict><key>__proto__</key><dict><key>CFBundleExecutable</key><string>Forged</string></dict></dict></plist>",
    ],
    [
      "binary",
      buildBinary(JSON.parse('{"__proto__":{"CFBundleExecutable":"Forged"}}')),
    ],
  ])(
    "ignores CFBundleExecutable nested under __proto__ in %s Info.plist files",
    async (_encoding, contents) => {
      const directory = await createTestTempDirectory("rea-app-proto-only-");
      const app = join(directory, "Proto.app");
      await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
      await writeFile(join(app, "Contents", "Info.plist"), contents);
      await writeFile(
        join(app, "Contents", "MacOS", "Forged"),
        thinMach(0xfeedfacf, 0x0100000c),
      );
      expect(await resolveAppBundleExecutable(app)).toMatchObject({
        ok: false,
        error: {
          reason: expect.stringContaining("CFBundleExecutable is missing"),
        },
      });
    },
  );
});

describe("DOS binary target I/O", () => {
  it("retains the declared PE signature when its overlapping layout is unsupported", async () => {
    const directory = await createTestTempDirectory("rea-overlapping-pe-");
    const path = join(directory, "overlap.exe");
    await writeFile(path, pe(0x014c, 4));
    const result = await parseBinaryTarget(path);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: expect.stringContaining("Unsupported overlapping PE header"),
        diagnostics: {
          unsupported_layout: true,
          mz_windows_header: { state: "declared", offset: 4, signature: "PE" },
        },
      },
    });
  });

  it("admits original DOS header padding after a relocation table", async () => {
    const directory = await createTestTempDirectory("rea-dos-header-padding-");
    const path = join(directory, "legacy.exe");
    const bytes = Buffer.alloc(128);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(128, 2);
    bytes.writeUInt16LE(1, 4);
    bytes.writeUInt16LE(2, 6);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(28, 24);
    bytes.write("ABCD", 60, "ascii");
    await writeFile(path, bytes);

    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86", kind: "executable" },
    });
  });

  it("resolves a PE signature beyond the prefix when DOS padding follows a relocation table", async () => {
    const directory = await createTestTempDirectory(
      "rea-padded-stub-pe-target-",
    );
    const path = join(directory, "padded-stub.dll");
    const offset = 8192;
    const stub = Buffer.alloc(offset);
    stub.write("MZ", 0, "ascii");
    stub.writeUInt16LE(offset % 512, 2);
    stub.writeUInt16LE(Math.ceil(offset / 512), 4);
    stub.writeUInt16LE(2, 6);
    stub.writeUInt16LE(4, 8);
    stub.writeUInt16LE(28, 24);
    stub.writeUInt32LE(offset, 60);
    const peRecord = pe(0x8664, offset, 0x2002).subarray(offset);
    const bytes = Buffer.concat([stub, peRecord]);
    await writeFile(path, bytes);

    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: {
        format: "pe",
        architecture: "x86_64",
        executableRole: "shared-library",
      },
    });
  });

  it("validates ambiguous DOS facts after extending the bounded prefix for relocations", async () => {
    const directory = await createTestTempDirectory(
      "rea-ambiguous-mz-relocations-",
    );
    const path = join(directory, "legacy.exe");
    const bytes = Buffer.alloc(8192);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(16, 4);
    bytes.writeUInt16LE(1010, 6);
    bytes.writeUInt16LE(257, 8);
    bytes.writeUInt16LE(64, 24);
    bytes.write("ABCD", 60, "ascii");
    await writeFile(path, bytes);

    const result = await parseBinaryTarget(path);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "MZ Windows new-header candidate is unresolved",
        diagnostics: {
          mz_dos: {
            state: "valid",
            header_bytes: 4112,
            image_bytes: 8192,
            module_bytes: 4080,
            relocation_count: 1010,
            relocation_table_offset: 64,
          },
        },
      },
    });
  });

  it("resolves a short-header PE signature beyond the bounded prefix", async () => {
    const directory = await createTestTempDirectory(
      "rea-short-stub-pe-target-",
    );
    const path = join(directory, "short-stub.dll");
    const offset = 8192;
    const stub = dosMz(64);
    stub.writeUInt32LE(offset, 60);
    const peRecord = pe(0x8664, offset, 0x2002).subarray(offset);
    const bytes = Buffer.concat([
      stub,
      Buffer.alloc(offset - stub.length),
      peRecord,
    ]);
    await writeFile(path, bytes);

    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: {
        format: "pe",
        architecture: "x86_64",
        executableRole: "shared-library",
      },
    });
  });

  it("validates a complete DOS file beyond the initial metadata probe", async () => {
    const directory = await createTestTempDirectory("rea-dos-target-");
    const path = join(directory, "legacy.exe");
    const bytes = dosMz(8192);
    await writeFile(path, bytes);
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86", kind: "executable" },
    });
    await writeFile(path, bytes.subarray(0, bytes.length - 1));
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: { message: "Cannot open artifact: truncated DOS MZ load module" },
    });
  });
});

it.each([
  [
    "EI_VERSION",
    (bytes: Buffer) => {
      bytes[6] = 0;
    },
  ],
  [
    "e_version",
    (bytes: Buffer) => {
      bytes.writeUInt32LE(0, 20);
    },
  ],
  [
    "e_ehsize",
    (bytes: Buffer) => {
      bytes.writeUInt16LE(51, 40);
    },
  ],
])(
  "rejects an ELF with malformed %s during public target opening",
  async (_name, corrupt) => {
    const directory = await createTestTempDirectory("rea-invalid-elf-header-");
    const path = join(directory, "invalid.elf");
    const bytes = elf(1, 1, 3);
    corrupt(bytes);
    await writeFile(path, bytes);
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        constraint: "file_format_rejected",
      },
    });
  },
);

describe("binary target I/O: PE CodeView header ranges", () => {
  it.each(["RSDS", "NB10"] as const)(
    "reads bounded %s header debug records and rejects unfinished names",
    async (type) => {
      const directory = await createTestTempDirectory("rea-target-");
      const path = join(directory, "header-symbols.exe");
      const bytes = pe(0x8664, 64, 0x0002, false, {
        type,
        pdbPath: "header.pdb",
      });
      const optionalHeader = 64 + 24;
      bytes.writeUInt32LE(512, optionalHeader + 60);
      bytes.copy(bytes, 384, 512);
      bytes.writeUInt32LE(384, optionalHeader + 112 + 6 * 8);
      bytes.writeUInt32LE(412, 384 + 20);
      bytes.writeUInt32LE(0, 384 + 24);
      for (const complete of [true, false]) {
        if (!complete) {
          const dataSize = bytes.readUInt32LE(384 + 16);
          bytes[412 + dataSize - 1] = 0x61;
        }
        await writeFile(path, bytes);
        const resolved = await parseBinaryTarget(path, {
          hostArchitecture: "x64",
        });
        const buffered = parseExecutableHeader(bytes, "x64");
        if (!resolved.ok) throw resolved.error;
        if (!buffered.ok) throw new Error(buffered.error);
        for (const value of [resolved.value, buffered.value]) {
          if (complete)
            expect(value).toMatchObject({
              codeView: { pdbPath: "header.pdb" },
            });
          else expect(value).not.toHaveProperty("codeView");
        }
      }
    },
  );
});

it("does not read a relocation table offset when DOS declares zero records", async () => {
  const directory = await createTestTempDirectory("rea-empty-dos-relocations-");
  const path = join(directory, "legacy.exe");
  const bytes = dosMz(8192);
  bytes.writeUInt16LE(257, 8);
  bytes.writeUInt16LE(4104, 24);
  bytes.writeUInt32LE(0, 60);
  await writeFile(path, bytes);
  const probe = await open(path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const reads = vi.spyOn(prototype, "read");
  try {
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86" },
    });
    const lengths = reads.mock.calls.map(
      (args) => (args as readonly unknown[])[2],
    );
    expect(lengths).toContain(4096);
    expect(lengths).not.toContain(4104);
  } finally {
    reads.mockRestore();
  }
});

it("recognizes Windows metadata independently of invalid DOS load declarations", async () => {
  const directory = await createTestTempDirectory("rea-invalid-dos-valid-pe-");
  const path = join(directory, "windows.exe");
  const bytes = pe(0x8664, 8192);
  bytes.writeUInt16LE(0, 4);
  bytes.writeUInt16LE(1010, 6);
  bytes.writeUInt16LE(257, 8);
  bytes.writeUInt16LE(64, 24);
  await writeFile(path, bytes);
  expect(await parseBinaryTarget(path)).toMatchObject({
    ok: true,
    value: { format: "pe", architecture: "x86_64" },
  });
});

it("refuses a declared DOS relocation header that is not present in the file", async () => {
  const directory = await createTestTempDirectory(
    "rea-truncated-dos-relocations-",
  );
  const path = join(directory, "legacy.exe");
  const bytes = dosMz(8192);
  bytes.writeUInt16LE(1010, 6);
  bytes.writeUInt16LE(257, 8);
  bytes.writeUInt16LE(64, 24);
  bytes.writeUInt32LE(0, 60);
  await writeFile(path, bytes.subarray(0, 4096));
  expect(await parseBinaryTarget(path)).toMatchObject({
    ok: false,
    error: { reason: "truncated DOS MZ load module" },
  });
});
