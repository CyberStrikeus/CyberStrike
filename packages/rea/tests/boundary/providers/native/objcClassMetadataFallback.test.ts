import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  AnalysisOperation,
  AnalysisOperationPort,
} from "../../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../../src/application/AnalysisProvider.js";
import { EnhancedTools } from "../../../../src/application/EnhancedTools.js";
import {
  UnsupportedMachoMetadataFormatError,
  parseMachoLayout,
} from "../../../../src/native/AppleMachoSelection.js";
import { NativeMacOSProvider } from "../../../../src/native/NativeMacOSProvider.js";
import { BinaryFormatFailure } from "../../../../src/native/metadata/BinaryContainer.js";
import { NativeFixtureRunner } from "../../../fixtures/nativeCommands.js";
import { ok } from "../../../../src/domain/result.js";

const thin32MachOHeader = (cpuType: number): Buffer => {
  const bytes = Buffer.alloc(84);
  bytes.writeUInt32LE(0xfeedface, 0);
  bytes.writeUInt32LE(cpuType, 4);
  bytes.writeUInt32LE(cpuType === 7 ? 3 : 0, 8);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(56, 20);
  bytes.writeUInt32LE(1, 28); // LC_SEGMENT
  bytes.writeUInt32LE(56, 32);
  bytes.write("__TEXT", 36);
  bytes.writeUInt32LE(0x1000, 52); // vmaddr
  bytes.writeUInt32LE(0x1000, 56); // vmsize
  bytes.writeUInt32LE(0, 60); // fileoff
  bytes.writeUInt32LE(bytes.length, 64); // filesize
  bytes.writeUInt32LE(7, 68); // maxprot
  bytes.writeUInt32LE(5, 72); // initprot
  return bytes;
};

const inspect = async (
  bytes: Buffer,
  architecture: "x86" | "arm" | "x86_64",
) => {
  const directory = await mkdtemp(join(tmpdir(), "rea-objc-macho-fallback-"));
  const path = join(directory, "fixture");
  await writeFile(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const target = {
    path,
    sha256,
    kind: "executable" as const,
    format: "mach-o" as const,
    architecture,
    availableArchitectures: [architecture],
  };
  const nativeClient = new NativeMacOSProvider(
    {},
    new NativeFixtureRunner(),
    "darwin",
  ).createClient(target);
  try {
    const hopper = { id: "hopper", name: "Hopper", version: "1" };
    const analysis: AnalysisOperationPort = {
      execute: async (operation: AnalysisOperation, parameters, options) => {
        if (operation === "list_names")
          return ok(
            createAnalysisExecution(
              [{ address: "0x1000", value: "OBJC_CLASS_$_Known" }],
              hopper,
              { subject: target },
            ),
          );
        return nativeClient.execute(operation, parameters, options);
      },
    };
    return await new EnhancedTools(analysis).execute("get_objc_classes", {});
  } finally {
    let closeResult: Awaited<ReturnType<typeof nativeClient.close>> | undefined;
    let closeError: unknown;
    try {
      closeResult = await nativeClient.close();
    } catch (cause: unknown) {
      closeError = cause;
    }
    await rm(directory, { recursive: true, force: true });
    if (closeError !== undefined) throw closeError;
    expect(closeResult).toMatchObject({ ok: true });
  }
};

describe("native Objective-C class metadata capability fallback", () => {
  it.each([
    { architecture: "x86" as const, cpuType: 7 },
    { architecture: "arm" as const, cpuType: 12 },
  ])(
    "keeps $architecture names when a valid 32-bit executable is unsupported",
    async ({ architecture, cpuType }) => {
      const result = await inspect(thin32MachOHeader(cpuType), architecture);
      expect(result).toMatchObject({
        ok: true,
        value: {
          count: 1,
          classes: [{ address: "0x1000", name: "OBJC_CLASS_$_Known" }],
          identity_coverage: { status: "unknown" },
        },
      });
    },
  );

  it("classifies exactly the complete 28-byte 32-bit header as unsupported", () => {
    const bytes = Buffer.alloc(28);
    bytes.writeUInt32LE(0xfeedface, 0);
    bytes.writeUInt32LE(7, 4);
    bytes.writeUInt32LE(3, 8);
    bytes.writeUInt32LE(2, 12);
    let failure: unknown;
    try {
      parseMachoLayout(bytes, "x86");
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(UnsupportedMachoMetadataFormatError);
  });

  it("keeps truncated 32-bit and 64-bit headers as errors", async () => {
    const truncated32 = Buffer.alloc(27);
    truncated32.writeUInt32LE(0xfeedface, 0);
    const truncated32Result = await inspect(truncated32, "x86");
    expect(truncated32Result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });

    const truncated64 = Buffer.alloc(31);
    truncated64.writeUInt32LE(0xfeedfacf, 0);
    truncated64.writeUInt32LE(0x01000007, 4);
    const truncated64Result = await inspect(truncated64, "x86_64");
    expect(truncated64Result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
  });

  it("does not treat an unknown header as a supported-format capability limit", async () => {
    const result = await inspect(Buffer.alloc(32), "x86_64");
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "ProviderAdapterError" },
    });
  });

  it("classifies a complete big-endian PowerPC64 Mach-O header as unsupported", () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(0xfeedfacf, 0);
    bytes.writeUInt32BE(0x01000012, 4); // CPU_TYPE_POWERPC64
    bytes.writeUInt32BE(0, 8);
    bytes.writeUInt32BE(2, 12);
    let failure: unknown;
    try {
      parseMachoLayout(bytes, "powerpc");
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(UnsupportedMachoMetadataFormatError);

    bytes.writeUInt32BE(0x01000007, 4);
    let mismatchedCpuFailure: unknown;
    try {
      parseMachoLayout(bytes, "powerpc");
    } catch (cause: unknown) {
      mismatchedCpuFailure = cause;
    }
    expect(mismatchedCpuFailure).toBeInstanceOf(BinaryFormatFailure);
    expect(mismatchedCpuFailure).toMatchObject({ kind: "unsupported" });
    expect(mismatchedCpuFailure).not.toBeInstanceOf(
      UnsupportedMachoMetadataFormatError,
    );
  });
});
