import { lstat, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  classifyAndHashRoot,
  inventoryArtifact,
} from "../../fixtures/artifactInventory.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { artifactOccurrenceAt } from "../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";

describe("ZIP signature detection", () => {
  it.each([
    { signature: [0x50, 0x4b, 0x05, 0x06], archive: true },
    { signature: [0x50, 0x4b, 0x03, 0x06], archive: false },
    { signature: [0x50, 0x4b, 0x03, 0x04], archive: true },
    { signature: [0x50, 0x4b, 0x07, 0x08], archive: true },
  ] as const)(
    "routes representative ZIP signature $signature through inventory and target parsing",
    async ({ signature, archive }) => {
      const root = await createTestTempDirectory("rea-zip-signature-");
      const path = join(root, "input");
      await writeFile(path, Buffer.from(signature));
      expect(
        (await classifyAndHashRoot(path, false, await lstat(path))).format,
      ).toBe(archive ? "zip" : "file");
      const target = await parseBinaryTarget(path);
      if (archive)
        expect(target).toMatchObject({ ok: true, value: { format: "zip" } });
      else
        expect(target).toMatchObject({
          ok: false,
          error: { _tag: "BinaryTargetError" },
        });
    },
  );

  it("uses ZIP magic before the filename suffix", async () => {
    const root = await createTestTempDirectory("rea-zip-suffix-");
    const apk = join(root, "renamed.apk");
    const program = join(root, "program.apk");
    await writeFile(apk, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await writeFile(program, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    expect(
      (await classifyAndHashRoot(apk, false, await lstat(apk))).format,
    ).toBe("apk");
    expect(
      (await classifyAndHashRoot(program, false, await lstat(program))).format,
    ).toBe("elf");
  });

  it("requires container magic for asar, pkg, and dmg suffixes", async () => {
    const root = await createTestTempDirectory("rea-container-magic-");
    const asar = join(root, "app.asar");
    const textAsar = join(root, "notes.asar");
    const pkg = join(root, "install.pkg");
    const textPkg = join(root, "notes.pkg");
    const dmg = join(root, "image.dmg");
    const textDmg = join(root, "notes.dmg");
    const asarBytes = asarHeaderBytes(JSON.stringify({ files: {} }));
    await writeFile(asar, asarBytes);
    await writeFile(textAsar, Buffer.from("not an asar"));
    await writeFile(pkg, Buffer.from("xar!"));
    await writeFile(textPkg, Buffer.from("not a pkg"));
    const image = Buffer.alloc(512);
    image.write("koly", 0, "ascii");
    await writeFile(dmg, image);
    await writeFile(textDmg, Buffer.from("not a dmg"));
    expect(
      (await classifyAndHashRoot(asar, false, await lstat(asar))).format,
    ).toBe("asar");
    expect(
      (await classifyAndHashRoot(textAsar, false, await lstat(textAsar)))
        .format,
    ).toBe("file");
    // A valid prefix cannot admit extents outside the observed container.
    await writeFile(asar, asarBytes.subarray(0, -1));
    expect(
      (await classifyAndHashRoot(asar, false, await lstat(asar))).format,
    ).toBe("file");
    expect(
      (await classifyAndHashRoot(pkg, false, await lstat(pkg))).format,
    ).toBe("pkg");
    expect(
      (await classifyAndHashRoot(textPkg, false, await lstat(textPkg))).format,
    ).toBe("file");
    expect(
      (await classifyAndHashRoot(dmg, false, await lstat(dmg))).format,
    ).toBe("dmg");
    expect(
      (await classifyAndHashRoot(textDmg, false, await lstat(textDmg))).format,
    ).toBe("file");
  });

  it.each([[], [0x50], [0x50, 0x4b], [0x50, 0x4b, 0x03]])(
    "rejects an incomplete signature %j",
    async (...bytes) => {
      const root = await createTestTempDirectory("rea-zip-short-");
      const path = join(root, "input");
      await writeFile(path, Buffer.from(bytes));
      expect(
        (await classifyAndHashRoot(path, false, await lstat(path))).format,
      ).toBe("file");
      expect((await parseBinaryTarget(path)).ok).toBe(false);
    },
  );
});

describe("nested container family", () => {
  const plainZip = async (): Promise<Uint8Array> => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("readme.txt", new TextReader("hello\n"));
    return writer.close();
  };

  it("takes ZIP families from member bytes, not member suffixes", async () => {
    const root = await createTestTempDirectory("rea-nested-zip-family-");
    const path = join(root, "outer.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("inner-text.apk", new TextReader("just some text\n"));
    await writer.add("inner-real.apk", new Uint8ArrayReader(await plainZip()));
    await writer.add("renamed.bin", new Uint8ArrayReader(await plainZip()));
    await writer.add("locked.ipa", new TextReader("encrypted bytes"), {
      password: "fixture-only",
    });
    await writeFile(path, await writer.close());
    const observed = await inventoryArtifact(path);
    expect(artifactOccurrenceAt(observed, "inner-text.apk")).toMatchObject({
      artifact_kind: "resource",
      artifact_format: "file",
      limitations: [],
    });
    expect(artifactOccurrenceAt(observed, "inner-real.apk")).toMatchObject({
      artifact_kind: "container",
      artifact_format: "apk",
    });
    expect(artifactOccurrenceAt(observed, "renamed.bin")).toMatchObject({
      artifact_kind: "container",
      artifact_format: "zip",
    });
    expect(artifactOccurrenceAt(observed, "locked.ipa")).toMatchObject({
      artifact_kind: "unknown",
      artifact_format: "unknown",
      hash_status: "unavailable",
      limitations: [
        "The path suffix suggests IPA, but these bytes were not read, so the container family is unknown.",
      ],
    });
  });

  it.skipIf(process.platform === "win32")(
    "does not name a container family for a symlink it did not follow",
    async () => {
      const root = await createTestTempDirectory("rea-nested-symlink-family-");
      const directory = join(root, "application");
      await mkdir(directory);
      await writeFile(join(directory, "real.apk"), await plainZip());
      await symlink("real.apk", join(directory, "link.apk"));
      const observed = await inventoryArtifact(directory);
      expect(artifactOccurrenceAt(observed, "link.apk")).toMatchObject({
        entry_kind: "symlink",
        artifact_kind: "unknown",
        artifact_format: "unknown",
        hash_status: "not-hashed",
        limitations: [
          "Symlink target was not followed or disclosed.",
          "The path suffix suggests APK, but these bytes were not read, so the container family is unknown.",
        ],
      });
      expect(artifactOccurrenceAt(observed, "real.apk")).toMatchObject({
        artifact_kind: "container",
        artifact_format: "apk",
      });
    },
  );
});

const SCRIPT_STUB = Buffer.from("#!/bin/sh\nexit 0\n");

const memberZip = async (): Promise<Buffer> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("a.txt", new TextReader("hello world\n"));
  await writer.add("d/b.txt", new TextReader("x\n"));
  return Buffer.from(await writer.close());
};

/** Prepend bytes; optionally shift stored offsets as `zip -A` does. */
const withLeadingBytes = (
  zip: Buffer,
  leading: Buffer,
  adjustOffsets: boolean,
): Buffer => {
  const bytes = Buffer.concat([leading, zip]);
  if (!adjustOffsets) return bytes;
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const directory = bytes.readUInt32LE(end + 16) + leading.length;
  bytes.writeUInt32LE(directory, end + 16);
  for (let at = directory; at < end;) {
    bytes.writeUInt32LE(bytes.readUInt32LE(at + 42) + leading.length, at + 42);
    at +=
      46 +
      bytes.readUInt16LE(at + 28) +
      bytes.readUInt16LE(at + 30) +
      bytes.readUInt16LE(at + 32);
  }
  return bytes;
};

/** Members by content-derived identity and verification state. */
const members = async (path: string) => {
  const inventory = await inventoryArtifact(path);
  return ["a.txt", "d/b.txt"].map((member) => {
    const occurrence = artifactOccurrenceAt(inventory, member);
    return [member, occurrence.hash_status, occurrence.artifact_id];
  });
};

describe("ZIP archives after leading bytes", () => {
  it.each([
    {
      style: "offsets that include the leading bytes",
      adjust: true,
      comment: false,
    },
    {
      style: "offsets written before the bytes were prepended",
      adjust: false,
      comment: false,
    },
    {
      style: "included leading bytes and an EOCD-like comment",
      adjust: true,
      comment: true,
    },
    {
      style: "prepended leading bytes and an EOCD-like comment",
      adjust: false,
      comment: true,
    },
  ])(
    "admits a ZIP after an unclaimed script stub with $style",
    async ({ adjust, comment }) => {
      const root = await createTestTempDirectory("rea-zip-leading-");
      const plain = join(root, "plain.zip");
      const prefixed = join(root, "installer.bin");
      const zip = await memberZip();
      let prefixedBytes = withLeadingBytes(zip, SCRIPT_STUB, adjust);
      if (comment) {
        const payload = Buffer.alloc(22);
        payload.writeUInt32LE(0x06054b50, 0);
        // A comment may contain an EOCD signature without declaring another archive.
        prefixedBytes.writeUInt16LE(payload.length, prefixedBytes.length - 2);
        prefixedBytes = Buffer.concat([prefixedBytes, payload]);
      }
      await writeFile(plain, zip);
      await writeFile(prefixed, prefixedBytes);

      expect(
        (await classifyAndHashRoot(prefixed, false, await lstat(prefixed)))
          .format,
      ).toBe("zip");
      expect(await parseBinaryTarget(prefixed)).toMatchObject({
        ok: true,
        value: { kind: "archive", format: "zip" },
      });
      // Members are the same verified bytes as in the plain archive.
      const expected = await members(plain);
      expect(expected.map(([, status]) => status)).toEqual([
        "verified",
        "verified",
      ]);
      expect(await members(prefixed)).toEqual(expected);
    },
  );

  it("keeps the root App Pack family for a ZIP after a script stub", async () => {
    const root = await createTestTempDirectory("rea-zip-leading-app-pack-");
    const path = join(root, "Example.app");
    await writeFile(
      path,
      withLeadingBytes(await memberZip(), SCRIPT_STUB, false),
    );
    expect(
      (await classifyAndHashRoot(path, false, await lstat(path))).format,
    ).toBe("app-pack");
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { kind: "archive", format: "app-pack" },
    });
  });

  it.each([
    { family: "ELF", leading: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]) },
    {
      family: "MZ",
      leading: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]),
    },
    {
      family: "Mach-O",
      leading: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]),
    },
  ])(
    "keeps a $family-led file with an appended ZIP out of the ZIP route",
    async ({ leading }) => {
      const root = await createTestTempDirectory("rea-zip-claimed-lead-");
      const path = join(root, "program");
      await writeFile(path, withLeadingBytes(await memberZip(), leading, true));
      expect(
        (await classifyAndHashRoot(path, false, await lstat(path))).format,
      ).not.toBe("zip");
      expect(await parseBinaryTarget(path)).not.toMatchObject({
        ok: true,
        value: { format: "zip" },
      });
    },
  );

  it.each([
    {
      shape: "bytes after the end record",
      mutate: (bytes: Buffer) => Buffer.concat([bytes, Buffer.from("junk")]),
    },
    {
      shape: "a corrupt central directory header",
      mutate: (bytes: Buffer) => {
        bytes.write("XXXX", bytes.indexOf(Buffer.from([0x50, 0x4b, 1, 2])));
        return bytes;
      },
    },
    {
      shape: "a Zip64 directory offset",
      mutate: (bytes: Buffer) => {
        const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
        bytes.writeUInt32LE(0xffffffff, end + 16);
        return bytes;
      },
    },
    {
      shape: "an empty archive record",
      mutate: (bytes: Buffer) => {
        const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
        bytes.writeUInt16LE(0, end + 8);
        bytes.writeUInt16LE(0, end + 10);
        return bytes;
      },
    },
  ])("does not locate a trailing ZIP with $shape", async ({ mutate }) => {
    const root = await createTestTempDirectory("rea-zip-leading-negative-");
    const path = join(root, "input.bin");
    await writeFile(
      path,
      mutate(withLeadingBytes(await memberZip(), SCRIPT_STUB, true)),
    );
    expect(
      (await classifyAndHashRoot(path, false, await lstat(path))).format,
    ).toBe("file");
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: false,
      error: { _tag: "BinaryTargetError" },
    });
  });
});

describe("package signature byte identity", () => {
  it.each([
    { extension: "pkg", signature: "xar!", offset: 0, size: 4 },
    { extension: "dmg", signature: "koly", offset: 0, size: 512 },
  ])(
    "rejects high-bit aliases of $extension magic at both admission boundaries",
    async ({ extension, signature, offset, size }) => {
      const root = await createTestTempDirectory("rea-package-magic-");
      const path = join(root, `input.${extension}`);
      const bytes = Buffer.alloc(size);
      bytes.write(signature, offset, "ascii");
      await writeFile(path, bytes);
      expect(
        (await classifyAndHashRoot(path, false, await lstat(path))).format,
      ).toBe(extension);
      expect(await parseBinaryTarget(path)).toMatchObject({
        ok: true,
        value: { format: extension },
      });
      for (let index = 0; index < signature.length; index += 1) {
        const changed = Buffer.from(bytes);
        changed[offset + index] = changed[offset + index]! | 0x80;
        await writeFile(path, changed);
        expect(
          (await classifyAndHashRoot(path, false, await lstat(path))).format,
        ).toBe("file");
        expect(await parseBinaryTarget(path)).toMatchObject({
          ok: false,
          error: { _tag: "BinaryTargetError" },
        });
      }
    },
  );
});

describe("raw disk image signatures", () => {
  // Raw (UDRW, UDTO) images have no UDIF trailer; hdiutil writes these
  // structures at fixed device offsets of 512-byte sectors.
  const rawImage = (write: (bytes: Buffer) => void, size = 4096): Buffer => {
    const bytes = Buffer.alloc(size);
    write(bytes);
    return bytes;
  };
  const mbrEntry = (bytes: Buffer, status: number, type: number): void => {
    bytes[446] = status;
    bytes[450] = type;
    bytes.writeUInt32LE(1, 454);
    bytes.writeUInt32LE(2048, 458);
    bytes[510] = 0x55;
    bytes[511] = 0xaa;
  };
  const gptHeader = (bytes: Buffer, revision: number, size: number): void => {
    bytes.write("EFI PART", 512, "ascii");
    bytes.writeUInt32LE(revision, 520);
    bytes.writeUInt32LE(size, 524);
  };
  const volumeHeader = (bytes: Buffer, signature: string, version: number) => {
    bytes.write(signature, 1024, "ascii");
    bytes.writeUInt16BE(version, 1026);
  };

  const expectDmgAtBothBoundaries = async (
    path: string,
    admitted: boolean,
  ): Promise<void> => {
    expect(
      (await classifyAndHashRoot(path, false, await lstat(path))).format,
    ).toBe(admitted ? "dmg" : "file");
    expect(await parseBinaryTarget(path)).toMatchObject(
      admitted
        ? { ok: true, value: { kind: "archive", format: "dmg" } }
        : { ok: false, error: { _tag: "BinaryTargetError" } },
    );
  };

  it.each([
    {
      layout: "a GUID partition table without a protective MBR",
      bytes: rawImage((bytes) => gptHeader(bytes, 0x0001_0000, 92)),
    },
    {
      layout: "an Apple partition map",
      bytes: rawImage((bytes) => {
        bytes.write("ER", 0, "ascii");
        bytes.write("PM", 512, "ascii");
      }),
    },
    {
      layout: "an MBR partition table",
      bytes: rawImage((bytes) => mbrEntry(bytes, 0x80, 0x0b)),
    },
    {
      layout: "an unpartitioned HFS+ volume",
      bytes: rawImage((bytes) => volumeHeader(bytes, "H+", 4)),
    },
    {
      layout: "an unpartitioned HFSX volume",
      bytes: rawImage((bytes) => volumeHeader(bytes, "HX", 5)),
    },
  ])("admits $layout as a DMG at both boundaries", async ({ bytes }) => {
    const root = await createTestTempDirectory("rea-raw-dmg-");
    const path = join(root, "image.dmg");
    await writeFile(path, bytes);
    await expectDmgAtBothBoundaries(path, true);
    // Structure alone never overrides the caller-visible suffix rule.
    const renamed = join(root, "image.img");
    await writeFile(renamed, bytes);
    expect(
      (await classifyAndHashRoot(renamed, false, await lstat(renamed))).format,
    ).not.toBe("dmg");
    expect(await parseBinaryTarget(renamed)).not.toMatchObject({
      ok: true,
      value: { format: "dmg" },
    });
  });

  it.each([
    { blob: "zero-filled bytes", bytes: rawImage(() => {}, 1024 * 1024) },
    {
      blob: "a boot signature over an empty table",
      bytes: rawImage((bytes) => {
        bytes[510] = 0x55;
        bytes[511] = 0xaa;
      }),
    },
    {
      blob: "an MBR entry with an invalid status byte",
      bytes: rawImage((bytes) => mbrEntry(bytes, 0x01, 0x0b)),
    },
    {
      blob: "a GPT header with an unknown revision",
      bytes: rawImage((bytes) => gptHeader(bytes, 0x0002_0000, 92)),
    },
    {
      blob: "a GPT header shorter than its defined fields",
      bytes: rawImage((bytes) => gptHeader(bytes, 0x0001_0000, 91)),
    },
    {
      blob: "a driver descriptor without a partition map entry",
      bytes: rawImage((bytes) => bytes.write("ER", 0, "ascii")),
    },
    {
      blob: "an HFS+ signature with the HFSX version",
      bytes: rawImage((bytes) => volumeHeader(bytes, "H+", 5)),
    },
    {
      blob: "an HFS+ signature cut off before its version",
      bytes: rawImage((bytes) => bytes.write("H+", 1024, "ascii"), 1026),
    },
    {
      blob: "text",
      bytes: Buffer.from("This is not a disk image.\n".repeat(64)),
    },
  ])("refuses $blob named as a DMG at both boundaries", async ({ bytes }) => {
    const root = await createTestTempDirectory("rea-raw-dmg-negative-");
    const path = join(root, "image.dmg");
    await writeFile(path, bytes);
    await expectDmgAtBothBoundaries(path, false);
  });
});
