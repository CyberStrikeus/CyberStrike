import { describe, expect, it } from "vitest";

import { dosMz, pe } from "./binaryTarget.fixture.js";
import { parseExecutableHeader } from "./binaryTarget.js";
import {
  observeMzWindowsHeader,
  readDosMzDeclarations,
  dosMzDeclaredImageByteLength,
  parseDeclaredMzHeaderEvidence,
  withMzWindowsHeaderSignature,
  parseDosMzHeader,
  parseMzHeaderEvidence,
} from "./dosMz.js";

describe("DOS MZ load-module validation", () => {
  it("separates initialized module and appended overlay bytes", () => {
    const image = dosMz(480);
    const bytes = Buffer.concat([image, Buffer.from("overlay")]);
    expect(parseDosMzHeader(bytes)).toEqual({
      ok: true,
      value: {
        headerBytes: 32,
        imageBytes: 512,
        moduleBytes: 480,
        overlayBytes: 7,
        relocationCount: 0,
        relocationTableOffset: 28,
        relocations: [],
        entrySegment: 0,
        entryOffset: 0,
      },
    });
  });

  it("accepts relocation records overlapping the Windows new-header field", () => {
    const bytes = Buffer.alloc(224);
    dosMz().copy(bytes, 0, 0, 28);
    bytes.writeUInt16LE(bytes.length, 2);
    bytes.writeUInt16LE(6, 8);
    bytes.writeUInt16LE(2, 6);
    bytes.writeUInt16LE(62, 24);
    bytes.writeUInt16LE(1, 62);
    bytes.writeUInt16LE(8, 66);
    expect(bytes.readUInt32LE(60)).toBe(65536);
    expect(observeMzWindowsHeader(bytes)).toEqual({ state: "absent" });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "dos-mz" },
    });
    expect(parseDosMzHeader(bytes)).toMatchObject({
      ok: true,
      value: { headerBytes: 96, relocationCount: 2, moduleBytes: 128 },
    });
  });

  it("uses the actual file length rather than the bounded prefix length", () => {
    const bytes = dosMz(8192);
    expect(parseDosMzHeader(bytes.subarray(0, 64), bytes.length).ok).toBe(true);
    expect(parseDosMzHeader(bytes.subarray(0, 64))).toMatchObject({
      ok: false,
      error: "truncated DOS MZ load module",
    });
  });

  it("keeps a partial DOS prefix unknown until the Windows pointer is examined", () => {
    const bytes = dosMz(64);

    expect(observeMzWindowsHeader(bytes.subarray(0, 32), bytes.length)).toEqual(
      {
        state: "header-needed",
      },
    );
    expect(
      parseExecutableHeader(bytes.subarray(0, 32), "x64", bytes.length),
    ).toMatchObject({ ok: false });
    expect(observeMzWindowsHeader(bytes.subarray(0, 32))).toEqual({
      state: "absent",
    });
  });

  it("parses a tiny known-length DOS module without requiring an impossible pointer", () => {
    const bytes = Buffer.alloc(33);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(bytes.length, 2);
    bytes.writeUInt16LE(1, 4);
    bytes.writeUInt16LE(2, 8);
    bytes.writeUInt16LE(28, 24);
    bytes[32] = 0xc3;

    expect(observeMzWindowsHeader(bytes.subarray(0, 28), bytes.length)).toEqual(
      {
        state: "absent",
      },
    );
    expect(
      parseExecutableHeader(bytes.subarray(0, 28), "x64", bytes.length),
    ).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86" },
    });
  });

  it("preserves PE classification when low relocation records do not overlap e_lfanew", () => {
    const bytes = pe(0x8664);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(1, 6);
    bytes.writeUInt16LE(28, 24);
    expect(observeMzWindowsHeader(bytes)).toEqual({
      state: "declared",
      offset: 64,
      signature: "PE",
    });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "pe", architecture: "x86_64" },
    });
    expect(parseDosMzHeader(bytes).ok).toBe(false);
  });

  it.each([
    [
      "page count",
      (bytes: Buffer) => bytes.writeUInt16LE(0, 4),
      "invalid DOS MZ page count or final-page size",
    ],
    [
      "final-page size",
      (bytes: Buffer) => bytes.writeUInt16LE(512, 2),
      "invalid DOS MZ page count or final-page size",
    ],
    [
      "header size",
      (bytes: Buffer) => bytes.writeUInt16LE(1, 8),
      "invalid DOS MZ header size or empty load module",
    ],
    [
      "entry point",
      (bytes: Buffer) => bytes.writeUInt16LE(128, 20),
      "DOS MZ entry point lies outside its initialized load module",
    ],
    [
      "relocation-table bounds",
      (bytes: Buffer) => {
        bytes.writeUInt16LE(2, 6);
      },
      "DOS MZ relocation table lies outside its header",
    ],
    [
      "relocation target",
      (bytes: Buffer) => {
        bytes.writeUInt16LE(1, 6);
        bytes.writeUInt16LE(127, 28);
      },
      "DOS MZ relocation 0 points outside its load module",
    ],
  ] as const)("rejects invalid %s", (_name, damage, error) => {
    const bytes = dosMz();
    damage(bytes);
    expect(parseDosMzHeader(bytes)).toEqual({ ok: false, error });
  });

  it("rejects a truncated relocation table even when the file size is known", () => {
    const bytes = dosMz();
    bytes.writeUInt16LE(1, 6);
    expect(parseDosMzHeader(bytes.subarray(0, 30), bytes.length)).toMatchObject(
      {
        ok: false,
        error: "truncated DOS MZ relocation table",
      },
    );
  });
});

describe("MZ Windows header observations", () => {
  it("keeps a confirmed overlapping PE distinct from malformed header offsets", () => {
    const bytes = pe(0x014c, 4);
    expect(observeMzWindowsHeader(bytes)).toEqual({
      state: "declared",
      offset: 4,
      signature: "PE",
    });
    expect(parseExecutableHeader(bytes, "x64")).toEqual({
      ok: false,
      error:
        "Unsupported overlapping PE header at file offset 4; this reader requires the Windows header outside the 64-byte DOS header",
    });
  });

  it.each(["NE", "LE", "LX"])(
    "distinguishes unsupported %s from DOS",
    (signature) => {
      const bytes = pe(0x8664);
      bytes.writeUInt16LE(4, 8);
      bytes.writeUInt16LE(64, 24);
      bytes.write(signature, 64, "ascii");
      expect(parseExecutableHeader(bytes, "x64")).toEqual({
        ok: false,
        error: `unsupported ${signature} executable in MZ image`,
      });
    },
  );

  it("keeps a short-header nonzero module value as DOS without a signature", () => {
    const bytes = dosMz(64);
    bytes.writeUInt32LE(bytes.length, 60);

    expect(observeMzWindowsHeader(bytes)).toEqual({ state: "absent" });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86" },
    });
  });

  it.each(["PEZZ", "NE", "LE", "LX", "PE"])(
    "keeps a non-Windows %s signature candidate as DOS",
    (signature) => {
      const bytes = dosMz(64);
      const offset = 32;
      bytes.writeUInt32LE(offset, 60);
      const candidate = Buffer.from(
        [...Buffer.from(signature)].map((byte) =>
          signature === "PEZZ" ? byte : byte | 0x80,
        ),
      );
      bytes.set(candidate, offset);

      expect(observeMzWindowsHeader(bytes)).toEqual({ state: "absent" });
      expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
        ok: true,
        value: { format: "dos-mz", architecture: "x86" },
      });
    },
  );

  it("accepts a short-header candidate only when it points at a Windows signature", () => {
    const stub = dosMz(64);
    const offset = stub.length;
    stub.writeUInt32LE(offset, 60);
    const record = pe(0x8664).subarray(64);
    const bytes = Buffer.concat([stub, record]);

    expect(observeMzWindowsHeader(bytes)).toMatchObject({
      state: "declared",
      offset,
      signature: "PE",
    });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "pe", architecture: "x86_64" },
    });
  });

  it.each(["NE", "LE", "LX"])(
    "recognizes short-header %s signatures as Windows declarations",
    (signature) => {
      const stub = dosMz(64);
      const offset = stub.length;
      stub.writeUInt32LE(offset, 60);
      const bytes = Buffer.concat([stub, Buffer.alloc(24)]);
      bytes.write(signature, offset, "ascii");

      expect(observeMzWindowsHeader(bytes)).toMatchObject({
        state: "declared",
        offset,
        signature,
      });
      expect(parseExecutableHeader(bytes, "x64")).toEqual({
        ok: false,
        error: `unsupported ${signature} executable in MZ image`,
      });
    },
  );

  it("requests the signature when a short-header candidate is outside its prefix", () => {
    const offset = 8192;
    const bytes = dosMz(64);
    bytes.writeUInt32LE(offset, 60);
    const prefix = Buffer.alloc(4096);
    bytes.copy(prefix);

    expect(observeMzWindowsHeader(prefix, offset + 512)).toEqual({
      state: "signature-needed",
      offset,
    });
    expect(
      observeMzWindowsHeader(prefix, offset + 512, {
        offset,
        bytes: Buffer.from("PE\0\0", "binary"),
      }),
    ).toEqual({ state: "declared", offset, signature: "PE" });
  });
});

describe("MZ header padding observations", () => {
  it("treats a complete header after the relocation table as DOS padding", () => {
    const bytes = Buffer.alloc(128);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(128, 2);
    bytes.writeUInt16LE(1, 4);
    bytes.writeUInt16LE(2, 6);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(28, 24);
    bytes.writeUInt32LE(0, 28);
    bytes.writeUInt32LE(0, 32);
    bytes.write("ABCD", 60, "ascii");

    const evidence = parseMzHeaderEvidence(bytes);
    expect(evidence.dos).toMatchObject({
      ok: true,
      value: {
        headerBytes: 64,
        imageBytes: 128,
        moduleBytes: 64,
        relocationCount: 2,
        relocationTableOffset: 28,
      },
    });
    expect(evidence.windowsHeader).toEqual({ state: "absent" });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86" },
    });

    bytes.writeUInt32LE(0xfffffff0, 60);
    expect(parseMzHeaderEvidence(bytes).windowsHeader).toEqual({
      state: "absent",
    });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({
      ok: true,
      value: { format: "dos-mz", architecture: "x86" },
    });
  });

  it("requests an unread signature before treating padding as DOS data", () => {
    const offset = 8192;
    const bytes = Buffer.alloc(offset + 512);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt16LE(128, 2);
    bytes.writeUInt16LE(1, 4);
    bytes.writeUInt16LE(2, 6);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(28, 24);
    bytes.writeUInt32LE(offset, 60);
    const prefix = bytes.subarray(0, 4096);

    expect(observeMzWindowsHeader(prefix, bytes.length)).toEqual({
      state: "signature-needed",
      offset,
    });
    expect(
      observeMzWindowsHeader(prefix, bytes.length, {
        offset,
        bytes: Buffer.from("PE\0\0", "binary"),
      }),
    ).toEqual({ state: "declared", offset, signature: "PE" });
    expect(
      observeMzWindowsHeader(prefix, bytes.length, {
        offset,
        bytes: Buffer.from("ZZZZ", "ascii"),
      }),
    ).toEqual({ state: "absent" });
  });

  it("keeps an unconfirmed pointer outside a relocation table unresolved", () => {
    const bytes = Buffer.alloc(256);
    dosMz().copy(bytes, 0, 0, 28);
    bytes.writeUInt16LE(256, 2);
    bytes.writeUInt16LE(4, 8);
    bytes.writeUInt16LE(64, 24);
    bytes.writeUInt32LE(192, 60);

    expect(parseMzHeaderEvidence(bytes).windowsHeader).toEqual({
      state: "candidate",
      offset: 192,
      signature: "other",
    });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({ ok: false });

    bytes.writeUInt32LE(0xfffffff0, 60);
    expect(parseMzHeaderEvidence(bytes).windowsHeader).toEqual({
      state: "candidate",
      offset: 0xfffffff0,
      signature: "unobserved",
    });
    expect(parseExecutableHeader(bytes, "x64")).toMatchObject({ ok: false });
  });
});

it("retains ordered DOS relocation aliases and their source/module target coordinates", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt16LE(128, 2);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(4, 6);
  bytes.writeUInt16LE(4, 8);
  bytes.writeUInt16LE(28, 24);
  bytes.writeUInt16LE(0, 28);
  bytes.writeUInt16LE(1, 30);
  bytes.writeUInt16LE(16, 32);
  bytes.writeUInt16LE(0, 34);
  bytes.writeUInt16LE(16, 36);
  bytes.writeUInt16LE(0, 38);
  bytes.writeUInt16LE(17, 40);
  bytes.writeUInt16LE(0, 42);
  const parsed = parseDosMzHeader(bytes);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.relocations).toEqual([
    { segment: 1, offset: 0, moduleOffset: 16, fileOffset: 80 },
    { segment: 0, offset: 16, moduleOffset: 16, fileOffset: 80 },
    { segment: 0, offset: 16, moduleOffset: 16, fileOffset: 80 },
    { segment: 0, offset: 17, moduleOffset: 17, fileOffset: 81 },
  ]);
  // Parsed facts are snapshots, independent of later source-buffer edits.
  bytes.writeUInt16LE(63, 32);
  expect(parsed.value.relocations[1]).toEqual({
    segment: 0,
    offset: 16,
    moduleOffset: 16,
    fileOffset: 80,
  });
  expect(parseDosMzHeader(bytes)).toEqual({
    ok: false,
    error: "DOS MZ relocation 1 points outside its load module",
  });
});

const extendedRelocationImage = (): Buffer => {
  const bytes = dosMz(8192);
  bytes.writeUInt16LE(257, 8); // 4112-byte header.
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt16LE(4096, 24);
  return bytes;
};

it("retains fixed declarations while requesting only a source-bounded relocation prefix", () => {
  const bytes = extendedRelocationImage();
  const prefix = bytes.subarray(0, 64);
  const evidence = parseMzHeaderEvidence(prefix, bytes.length);
  expect(evidence.declarations).toEqual(readDosMzDeclarations(prefix));
  expect(evidence.declarations).toMatchObject({
    ok: true,
    value: {
      headerBytes: 4112,
      relocationCount: 2,
      relocationTableOffset: 4096,
      relocationTableEnd: 4104,
      entryOffset: 0,
      entrySegment: 0,
    },
  });
  expect(evidence.relocationTableRead).toEqual({ offset: 0, byteLength: 4104 });
  expect(evidence.dos).toEqual({
    ok: false,
    error: "truncated DOS MZ relocation table",
  });
  const observed = parseMzHeaderEvidence(bytes.subarray(0, 4104), bytes.length);
  expect(observed.relocationTableRead).toBeUndefined();
  expect(observed.dos).toMatchObject({
    ok: true,
    value: { relocationCount: 2, headerBytes: 4112 },
  });
});

it("does not request absent or out-of-bounds relocation records", () => {
  const zero = extendedRelocationImage();
  zero.writeUInt16LE(512, 8);
  zero.writeUInt16LE(0, 6);
  zero.writeUInt16LE(6000, 24);
  expect(
    parseMzHeaderEvidence(zero.subarray(0, 64), zero.length)
      .relocationTableRead,
  ).toBeUndefined();
  expect(parseDosMzHeader(zero).ok).toBe(true);
  const outsideHeader = extendedRelocationImage();
  outsideHeader.writeUInt16LE(5000, 24);
  const headerEvidence = parseMzHeaderEvidence(
    outsideHeader.subarray(0, 64),
    outsideHeader.length,
  );
  expect(headerEvidence.relocationTableRead).toBeUndefined();
  expect(headerEvidence.dos).toEqual({
    ok: false,
    error: "DOS MZ relocation table lies outside its header",
  });
  const outsideFile = extendedRelocationImage();
  outsideFile.writeUInt16LE(1024, 8);
  outsideFile.writeUInt16LE(9000, 24);
  expect(
    parseMzHeaderEvidence(outsideFile.subarray(0, 64), outsideFile.length)
      .relocationTableRead,
  ).toBeUndefined();
});

it("keeps independent malformed declarations and the established DOS error precedence", () => {
  const bytes = extendedRelocationImage();
  bytes.writeUInt16LE(0, 4);
  bytes.writeUInt16LE(65535, 20);
  const evidence = parseMzHeaderEvidence(bytes.subarray(0, 64), bytes.length);
  expect(evidence.declarations).toMatchObject({
    ok: true,
    value: { pages: 0, entryOffset: 65535 },
  });
  expect(evidence.relocationTableRead?.byteLength).toBe(4104);
  expect(evidence.dos).toEqual({
    ok: false,
    error: "invalid DOS MZ page count or final-page size",
  });
  expect(parseDosMzHeader(bytes, bytes.length - 1)).toEqual({
    ok: false,
    error: "invalid DOS MZ file length",
  });
  bytes.writeUInt16LE(17, 4);
  expect(parseDosMzHeader(bytes.subarray(0, 64), bytes.length)).toEqual({
    ok: false,
    error: "truncated DOS MZ relocation table",
  });
  expect(parseDosMzHeader(bytes)).toEqual({
    ok: false,
    error: "DOS MZ entry point lies outside its initialized load module",
  });
});

it("keeps declared Windows signatures independent of incomplete DOS relocations", () => {
  const bytes = extendedRelocationImage();
  bytes.writeUInt32LE(128, 60);
  const evidence = parseMzHeaderEvidence(bytes.subarray(0, 64), bytes.length, {
    offset: 128,
    bytes: Buffer.from("PE\0\0"),
  });
  expect(evidence.windowsHeader).toEqual({
    state: "declared",
    signature: "PE",
    offset: 128,
  });
  expect(evidence.dos).toEqual({
    ok: false,
    error: "truncated DOS MZ relocation table",
  });
  expect(evidence.relocationTableRead?.byteLength).toBe(4104);
});

it("completes captured evidence from the original admitted fixed declarations", () => {
  const bytes = extendedRelocationImage();
  const declarations = readDosMzDeclarations(bytes.subarray(0, 64));
  if (!declarations.ok) throw new Error(declarations.error);
  expect(dosMzDeclaredImageByteLength(declarations.value)).toEqual({
    ok: true,
    value: bytes.length,
  });
  const evidence = parseDeclaredMzHeaderEvidence(
    bytes.subarray(0, 4104),
    bytes.length,
    declarations,
  );
  expect(evidence.declarations).toBe(declarations);
  expect(evidence).toEqual(
    parseMzHeaderEvidence(bytes.subarray(0, 4104), bytes.length),
  );
  expect(evidence.dos.ok).toBe(true);
});

it("adds distant Windows signatures while retaining prior DOS observations", () => {
  const bytes = extendedRelocationImage();
  bytes.writeUInt32LE(6000, 60);
  const prefix = bytes.subarray(0, 4104);
  const evidence = parseMzHeaderEvidence(prefix, bytes.length);
  expect(evidence.windowsHeader).toEqual({
    state: "signature-needed",
    offset: 6000,
  });
  const signature = { offset: 6000, bytes: Buffer.from("PE\0\0") };
  const completed = withMzWindowsHeaderSignature(
    prefix,
    bytes.length,
    evidence,
    signature,
  );
  expect(completed.dos).toBe(evidence.dos);
  expect(completed.declarations).toBe(evidence.declarations);
  expect(completed.windowsHeader).toEqual({
    state: "declared",
    signature: "PE",
    offset: 6000,
  });
  expect(completed).toEqual(
    parseMzHeaderEvidence(prefix, bytes.length, signature),
  );
});
