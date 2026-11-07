import { describe, expect, it } from "vitest";

import { CPU, fatImage, machoImage, readerOf } from "./MachoImage.fixture.js";
import { readMachoEncryption } from "./MachoEncryptionReader.js";
import {
  MAX_LOAD_COMMAND_BYTES,
  readMachoImage,
} from "./MachoLoadCommandReader.js";

const LC_SEGMENT = 0x1;
const LC_SEGMENT_64 = 0x19;
const LC_ENCRYPTION_INFO = 0x21;
const LC_ENCRYPTION_INFO_64 = 0x2c;
const S_ZEROFILL = 0x1;

const read = (bytes: Uint8Array, maximumMappingRecords = 4096) =>
  readMachoEncryption(readerOf(bytes), bytes.length, maximumMappingRecords);

const encryption = (
  fields: {
    readonly cryptoff: number;
    readonly cryptsize: number;
    readonly cryptid: number;
  },
  wide = true,
  size = wide ? 24 : 20,
): Uint8Array => {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, wide ? LC_ENCRYPTION_INFO_64 : LC_ENCRYPTION_INFO, true);
  view.setUint32(4, size, true);
  if (size >= 20) {
    view.setUint32(8, fields.cryptoff, true);
    view.setUint32(12, fields.cryptsize, true);
    view.setUint32(16, fields.cryptid, true);
  }
  return bytes;
};

const segment = (
  name: string,
  fields: {
    readonly vmAddress: bigint;
    /** Defaults to the file size, as linkers emit for file-backed segments. */
    readonly vmSize?: bigint;
    readonly fileOffset: number;
    readonly fileSize: number;
    readonly sections?: readonly {
      readonly name: string;
      readonly offset: number;
      readonly size: number;
      readonly flags?: number;
    }[];
  },
  wide = true,
): Uint8Array => {
  const sections = fields.sections ?? [];
  const header = wide ? 72 : 56;
  const record = wide ? 80 : 68;
  const bytes = new Uint8Array(header + sections.length * record);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  view.setUint32(0, wide ? LC_SEGMENT_64 : LC_SEGMENT, true);
  view.setUint32(4, bytes.length, true);
  bytes.set(encoder.encode(name), 8);
  if (wide) {
    view.setBigUint64(24, fields.vmAddress, true);
    view.setBigUint64(32, fields.vmSize ?? BigInt(fields.fileSize), true);
    view.setBigUint64(40, BigInt(fields.fileOffset), true);
    view.setBigUint64(48, BigInt(fields.fileSize), true);
    view.setUint32(64, sections.length, true);
  } else {
    view.setUint32(24, Number(fields.vmAddress), true);
    view.setUint32(28, Number(fields.vmSize ?? BigInt(fields.fileSize)), true);
    view.setUint32(32, fields.fileOffset, true);
    view.setUint32(36, fields.fileSize, true);
    view.setUint32(48, sections.length, true);
  }
  sections.forEach((section, index) => {
    const at = header + index * record;
    bytes.set(encoder.encode(section.name), at);
    bytes.set(encoder.encode(name), at + 16);
    if (wide) {
      view.setBigUint64(at + 40, BigInt(section.size), true);
      view.setUint32(at + 48, section.offset, true);
      view.setUint32(at + 64, section.flags ?? 0, true);
    } else {
      view.setUint32(at + 36, section.size, true);
      view.setUint32(at + 40, section.offset, true);
      view.setUint32(at + 56, section.flags ?? 0, true);
    }
  });
  return bytes;
};

/** A thin image padded so that commands can name ranges past its header. */
const padded = (image: Uint8Array, size = 0x10000): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(image);
  return bytes;
};

const text = (wide = true) =>
  segment(
    "__TEXT",
    {
      vmAddress: wide ? 0x100000000n : 0x1000n,
      fileOffset: 0,
      fileSize: 0x8000,
      sections: [
        { name: "__text", offset: 0x4000, size: 0x100 },
        { name: "__cstring", offset: 0x7f00, size: 0x100 },
        { name: "__bss", offset: 0, size: 0x100, flags: S_ZEROFILL },
      ],
    },
    wide,
  );

const onlySlice = async (bytes: Uint8Array) => {
  const facts = await read(bytes);
  if (facts.status !== "parsed" || facts.slices.length !== 1)
    throw new Error(`expected one parsed slice, got ${JSON.stringify(facts)}`);
  return facts.slices[0]!;
};

describe("Mach-O encryption reader: thin images", () => {
  it("reports absent only after reading every load command", async () => {
    expect(await onlySlice(machoImage({ commands: [text()] }))).toEqual({
      architecture: null,
      cpu_type: CPU.arm64.type,
      cpu_subtype: CPU.arm64.subtype,
      container_file_offset: 0,
      size: expect.any(Number),
      status: "absent",
      reason: null,
      commands: [],
      range: null,
    });
  });

  it("maps a plaintext range to segments, sections and VM addresses", async () => {
    const slice = await onlySlice(
      padded(
        machoImage({
          commands: [
            text(),
            encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 0 }),
          ],
        }),
      ),
    );
    expect(slice).toMatchObject({
      status: "not-encrypted",
      reason: null,
      commands: [
        {
          kind: "LC_ENCRYPTION_INFO_64",
          index: 1,
          cmdsize: 24,
          cryptoff: 0x4000,
          cryptsize: 0x4000,
          cryptid: 0,
          pad: 0,
        },
      ],
      range: {
        content: "plaintext",
        slice_start: 0x4000,
        slice_end: 0x8000,
        container_start: 0x4000,
        container_end: 0x8000,
        mapping: {
          status: "mapped",
          fragments: [
            {
              slice_start: 0x4000,
              slice_end: 0x8000,
              segment: "__TEXT",
              vm_start: "0x100004000",
              vm_end: "0x100008000",
            },
          ],
          // Zero-fill sections occupy no file bytes, whatever their offset.
          sections: [
            { segment: "__TEXT", section: "__text" },
            { segment: "__TEXT", section: "__cstring" },
          ],
        },
      },
    });
  });

  it("marks a nonzero cryptid as ciphertext and keeps unmapped bytes explicit", async () => {
    const slice = await onlySlice(
      padded(
        machoImage({
          commands: [
            text(),
            encryption({ cryptoff: 0x7000, cryptsize: 0x2000, cryptid: 1 }),
          ],
        }),
      ),
    );
    expect(slice.status).toBe("encrypted");
    expect(slice.range).toMatchObject({
      content: "ciphertext",
      mapping: {
        fragments: [
          { slice_start: 0x7000, slice_end: 0x8000, segment: "__TEXT" },
          {
            slice_start: 0x8000,
            slice_end: 0x9000,
            segment: null,
            vm_start: null,
            vm_end: null,
          },
        ],
        sections: [{ segment: "__TEXT", section: "__cstring" }],
      },
    });
  });
});

describe("Mach-O encryption reader: thin image edge cases", () => {
  it("keeps an encrypted empty range without claiming any bytes", async () => {
    const slice = await onlySlice(
      padded(
        machoImage({
          commands: [
            text(),
            encryption({ cryptoff: 0x4000, cryptsize: 0, cryptid: 1 }),
          ],
        }),
      ),
    );
    expect(slice).toMatchObject({
      status: "encrypted",
      range: {
        slice_start: 0x4000,
        slice_end: 0x4000,
        mapping: { status: "mapped", fragments: [], sections: [] },
      },
    });
  });

  it("reads the 32-bit command form in a 32-bit image", async () => {
    const slice = await onlySlice(
      padded(
        machoImage({
          cpu: CPU.i386,
          wide: false,
          commands: [
            text(false),
            encryption(
              { cryptoff: 0x1000, cryptsize: 0x1000, cryptid: 1 },
              false,
            ),
          ],
        }),
      ),
    );
    expect(slice).toMatchObject({
      status: "encrypted",
      commands: [{ kind: "LC_ENCRYPTION_INFO", cmdsize: 20, pad: null }],
      range: {
        mapping: {
          fragments: [{ vm_start: "0x2000", vm_end: "0x3000" }],
        },
      },
    });
  });

  it("reports an unreadable segment mapping as unknown, not unmapped", async () => {
    const broken = text();
    new DataView(broken.buffer).setUint32(64, 9, true);
    const slice = await onlySlice(
      padded(
        machoImage({
          commands: [
            broken,
            encryption({ cryptoff: 0x4000, cryptsize: 0x100, cryptid: 1 }),
          ],
        }),
      ),
    );
    expect(slice).toMatchObject({
      status: "encrypted",
      range: {
        mapping: {
          status: "unknown",
          reason: "load command 0 section records exceed cmdsize",
        },
      },
    });
  });
});

describe("Mach-O encryption reader: segment mapping", () => {
  const ciphertext = encryption({
    cryptoff: 0x4000,
    cryptsize: 0x2000,
    cryptid: 1,
  });

  it("never reports a byte twice when segment file ranges overlap", async () => {
    const first = segment("__A", {
      vmAddress: 0x1000n,
      fileOffset: 0x4000,
      fileSize: 0x1800,
    });
    const second = segment("__B", {
      vmAddress: 0x9000n,
      fileOffset: 0x5000,
      fileSize: 0x1000,
    });
    const slice = await onlySlice(
      padded(machoImage({ commands: [first, second, ciphertext] })),
    );
    expect(slice.range?.mapping).toMatchObject({
      status: "mapped",
      fragments: [
        { slice_start: 0x4000, slice_end: 0x5800, segment: "__A" },
        {
          slice_start: 0x5800,
          slice_end: 0x6000,
          segment: "__B",
          vm_start: "0x9800",
          vm_end: "0xa000",
        },
      ],
    });
  });

  it("reports a segment command of the other width as an unknown mapping", async () => {
    const slice = await onlySlice(
      padded(
        machoImage({
          cpu: CPU.i386,
          wide: false,
          commands: [
            text(true),
            encryption(
              { cryptoff: 0x4000, cryptsize: 0x100, cryptid: 1 },
              false,
            ),
          ],
        }),
      ),
    );
    expect(slice).toMatchObject({
      status: "encrypted",
      range: {
        mapping: {
          status: "unknown",
          reason: "load command 0 LC_SEGMENT_64 appears in a 32-bit image",
        },
      },
    });
  });

  it("names only sections whose bytes the range and their segment both cover", async () => {
    const spanning = segment("__TEXT", {
      vmAddress: 0x1000n,
      fileOffset: 0x4000,
      fileSize: 0x2000,
      sections: [
        { name: "__text", offset: 0x3000, size: 0x2000 },
        // Declared past the segment's file-backed bytes.
        { name: "__stray", offset: 0x7000, size: 0x1000 },
      ],
    });
    const covered = await onlySlice(
      padded(
        machoImage({
          commands: [
            spanning,
            encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 1 }),
          ],
        }),
      ),
    );
    expect(covered.range?.mapping).toMatchObject({
      sections: [{ segment: "__TEXT", section: "__text" }],
    });
    const empty = await onlySlice(
      padded(
        machoImage({
          commands: [
            spanning,
            encryption({ cryptoff: 0x4000, cryptsize: 0, cryptid: 1 }),
          ],
        }),
      ),
    );
    expect(empty.range?.mapping).toMatchObject({ fragments: [], sections: [] });
  });

  it("keeps segment name bytes 0x80-0x9f as their own code points", async () => {
    const named = segment("__X", {
      vmAddress: 0x1000n,
      fileOffset: 0x4000,
      fileSize: 0x2000,
    });
    named[11] = 0x80;
    const slice = await onlySlice(
      padded(machoImage({ commands: [named, ciphertext] })),
    );
    expect(slice.range?.mapping).toMatchObject({
      fragments: [{ segment: "__X\u0080" }],
    });
  });
});

describe("Mach-O encryption reader: segment VM extent", () => {
  const ciphertext = encryption({
    cryptoff: 0x4000,
    cryptsize: 0x2000,
    cryptid: 1,
  });

  it("keeps file-only segment bytes without VM addresses", async () => {
    const fileOnly = segment("__FILE", {
      vmAddress: 0x4000n,
      vmSize: 0n,
      fileOffset: 0x4000,
      fileSize: 0x2000,
    });
    const slice = await onlySlice(
      padded(machoImage({ commands: [fileOnly, ciphertext] })),
    );
    expect(slice.status).toBe("encrypted");
    expect(slice.range?.mapping).toEqual({
      status: "mapped",
      fragments: [
        {
          slice_start: 0x4000,
          slice_end: 0x6000,
          segment: "__FILE",
          vm_start: null,
          vm_end: null,
        },
      ],
      sections: [],
    });
  });

  it.each([
    [
      "a file size beyond its VM size",
      { vmAddress: 0x1000n, vmSize: 0x1000n },
      "segment __TEXT file size 8192 exceeds its VM size 4096",
    ],
    [
      "a VM range beyond the address space",
      { vmAddress: 2n ** 64n - 0x1000n, vmSize: 0x2000n },
      "segment __TEXT VM range exceeds the 64-bit address space",
    ],
  ])(
    "reports %s as an unknown mapping without losing the status",
    async (_case, vm, reason) => {
      const invalid = segment("__TEXT", {
        ...vm,
        fileOffset: 0x4000,
        fileSize: 0x2000,
      });
      const slice = await onlySlice(
        padded(machoImage({ commands: [invalid, ciphertext] })),
      );
      expect(slice.status).toBe("encrypted");
      expect(slice.range?.content).toBe("ciphertext");
      expect(slice.range?.mapping).toEqual({
        status: "unknown",
        reason: `load command 0 ${reason}`,
      });
    },
  );
});

describe("Mach-O encryption reader: defects are never absent", () => {
  it.each([
    {
      name: "a 64-bit command in a 32-bit image",
      image: () =>
        machoImage({
          cpu: CPU.i386,
          wide: false,
          commands: [encryption({ cryptoff: 0, cryptsize: 0, cryptid: 0 })],
        }),
      reason: "load command 0 LC_ENCRYPTION_INFO_64 appears in a 32-bit image",
    },
    {
      name: "an unexpected cmdsize",
      image: () =>
        machoImage({
          commands: [
            encryption({ cryptoff: 0, cryptsize: 0, cryptid: 0 }, true, 32),
          ],
        }),
      reason:
        "load command 0 LC_ENCRYPTION_INFO_64 has cmdsize 32, expected 24",
    },
    {
      name: "a range beyond the slice",
      image: () =>
        machoImage({
          commands: [
            encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 1 }),
          ],
        }),
      reason: expect.stringMatching(
        /^load command 0 encrypted range ends at 32768, beyond the \d+-byte slice$/u,
      ),
    },
    {
      name: "two encryption commands",
      image: () =>
        machoImage({
          commands: [
            encryption({ cryptoff: 0, cryptsize: 0, cryptid: 0 }),
            encryption({ cryptoff: 0, cryptsize: 0, cryptid: 1 }),
          ],
        }),
      reason: "slice has 2 encryption load commands",
    },
  ])("reports $name as malformed", async ({ image, reason }) => {
    const slice = await onlySlice(image());
    expect(slice).toMatchObject({ status: "malformed", reason, range: null });
    expect(slice.commands.length).toBeGreaterThan(0);
  });

  it("retains two of many encryption commands and counts the rest", async () => {
    const slice = await onlySlice(
      machoImage({
        commands: Array.from({ length: 1000 }, () =>
          encryption({ cryptoff: 0, cryptsize: 0, cryptid: 1 }),
        ),
      }),
    );
    expect(slice).toMatchObject({
      status: "malformed",
      reason: "slice has 1000 encryption load commands",
      range: null,
    });
    expect(slice.commands.map(({ index }) => index)).toEqual([0, 1]);
  });

  it("keeps commands read before a framing defect as partial facts", async () => {
    const unsized = new Uint8Array(16);
    new DataView(unsized.buffer).setUint32(0, 0x7f000001, true);
    const slice = await onlySlice(
      machoImage({
        commands: [
          encryption({ cryptoff: 0, cryptsize: 0, cryptid: 1 }),
          unsized,
        ],
      }),
    );
    expect(slice).toMatchObject({
      status: "malformed",
      reason: "load command 1 at offset 24 has invalid cmdsize 0",
      commands: [{ kind: "LC_ENCRYPTION_INFO_64", cryptid: 1 }],
      range: null,
    });
  });

  it("reports the 20-byte form in a 64-bit image as a framing defect", async () => {
    const slice = await onlySlice(
      machoImage({
        commands: [
          encryption({ cryptoff: 0, cryptsize: 0, cryptid: 1 }, false),
        ],
      }),
    );
    expect(slice).toMatchObject({
      status: "malformed",
      reason: "load command 0 at offset 0 has invalid cmdsize 20",
      commands: [],
    });
  });

  it("reports unread load commands as unknown", async () => {
    const oversized = machoImage({});
    new DataView(oversized.buffer).setUint32(
      20,
      MAX_LOAD_COMMAND_BYTES + 8,
      true,
    );
    expect(await onlySlice(oversized)).toMatchObject({
      status: "unknown",
      reason: expect.stringContaining("above the"),
    });
  });

  it("keeps file-level failures distinct from slice status", async () => {
    expect(await read(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({
      status: "not-mach-o",
    });
    expect(
      await read(Uint8Array.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0])),
    ).toEqual({
      status: "unsupported",
      reason: "big-endian Mach-O images are not supported",
    });
  });
});

/** A padded image whose __TEXT range 0x4000-0x8000 is ciphertext. */
const encrypted = (
  cpu: { readonly type: number; readonly subtype: number } = CPU.arm64,
) =>
  padded(
    machoImage({
      cpu,
      commands: [
        text(),
        encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 1 }),
      ],
    }),
  );

describe("Mach-O encryption reader: universal files", () => {
  it("reports every slice in container coordinates", async () => {
    const facts = await read(
      fatImage([
        { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
        { cpu: CPU.arm64, bytes: encrypted() },
      ]),
    );
    expect(facts).toMatchObject({
      status: "parsed",
      slices: [
        {
          cpu_type: CPU.x86_64.type,
          container_file_offset: 4096,
          status: "absent",
        },
        {
          cpu_type: CPU.arm64.type,
          container_file_offset: 8192,
          status: "encrypted",
          range: {
            container_start: 8192 + 0x4000,
            container_end: 8192 + 0x8000,
          },
        },
      ],
    });
  });

  it("does not let one defective slice hide the others", async () => {
    const bigEndian = new Uint8Array(32);
    new DataView(bigEndian.buffer).setUint32(0, 0xfeedfacf, false);
    const fat = fatImage([
      { cpu: CPU.arm64, bytes: bigEndian },
      { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.arm64 }) },
      { cpu: CPU.arm64, bytes: machoImage({}) },
      { cpu: CPU.arm64e, bytes: encrypted(CPU.arm64e) },
    ]);
    // The third declaration's range runs past the end of the file.
    new DataView(fat.buffer).setUint32(8 + 2 * 20 + 12, fat.length, false);
    const facts = await read(fat);
    if (facts.status !== "parsed") throw new Error(facts.status);
    expect(
      facts.slices.map(({ status, reason }) => ({ status, reason })),
    ).toEqual([
      {
        status: "unknown",
        reason: "big-endian Mach-O slices are not supported",
      },
      {
        status: "malformed",
        reason:
          "FAT architecture 1 CPU type/subtype disagrees with its Mach-O header",
      },
      {
        status: "malformed",
        reason: "FAT architecture 2 slice range extends beyond the file",
      },
      { status: "encrypted", reason: null },
    ]);
    expect(facts.slices[2]).toMatchObject({
      cpu_type: CPU.arm64.type,
      cpu_subtype: CPU.arm64.subtype,
      commands: [],
    });
  });

  it("keeps arm64e variants apart by CPU subtype", async () => {
    const facts = await read(
      fatImage([
        { cpu: CPU.arm64e, bytes: machoImage({ cpu: CPU.arm64e }) },
        { cpu: CPU.arm64eX1, bytes: machoImage({ cpu: CPU.arm64eX1 }) },
      ]),
    );
    expect(facts).toMatchObject({
      status: "parsed",
      slices: [
        { cpu_subtype: CPU.arm64e.subtype, status: "absent" },
        { cpu_subtype: CPU.arm64eX1.subtype, status: "absent" },
      ],
    });
  });

  it("covers Apple's hidden ARM64 slice after the declared rows", async () => {
    const armv7 = { type: 12, subtype: 9 };
    const bytes = fatImage([
      { cpu: armv7, bytes: machoImage({ cpu: armv7 }) },
      {
        cpu: CPU.arm64,
        bytes: padded(
          machoImage({
            commands: [
              text(),
              encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 1 }),
            ],
          }),
        ),
      },
    ]);
    // nfat_arch 1 leaves the ARM64 row hidden in the table-to-slice gap.
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(4, 1);
    expect(await read(bytes)).toMatchObject({
      status: "parsed",
      slices: [
        { cpu_type: armv7.type, status: "absent" },
        { cpu_type: CPU.arm64.type, status: "encrypted" },
      ],
    });
  });

  it("keeps the declared slice when the hidden ARM64 row's range is invalid", async () => {
    const armv7 = { type: 12, subtype: 9 };
    const bytes = fatImage([
      { cpu: armv7, bytes: machoImage({ cpu: armv7 }) },
      { cpu: CPU.arm64, bytes: padded(machoImage({ commands: [text()] })) },
    ]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    view.setUint32(4, 1);
    // The hidden row's size runs past the end of the file.
    view.setUint32(8 + 20 + 12, bytes.byteLength);
    expect(await read(bytes)).toMatchObject({
      status: "parsed",
      slices: [
        { cpu_type: armv7.type, status: "absent" },
        {
          cpu_type: CPU.arm64.type,
          status: "malformed",
          reason: "FAT architecture 1 slice range extends beyond the file",
          commands: [],
        },
      ],
    });
  });
});

describe("Mach-O encryption reader: large universal files", () => {
  it("keeps a healthy slice when a sibling's range is invalid past the 16 MiB scan limit", async () => {
    const slice = padded(
      machoImage({
        commands: [
          text(),
          encryption({ cryptoff: 0x4000, cryptsize: 0x4000, cryptid: 1 }),
        ],
      }),
    );
    const size = MAX_LOAD_COMMAND_BYTES + 0x100000;
    const table = new DataView(new ArrayBuffer(8 + 2 * 20));
    table.setUint32(0, 0xcafebabe);
    table.setUint32(4, 2);
    const entry = (index: number, fields: readonly number[]) =>
      fields.forEach((value, field) =>
        table.setUint32(8 + index * 20 + field * 4, value),
      );
    entry(0, [CPU.arm64.type, CPU.arm64.subtype, 0x1000, slice.length, 12]);
    // Declared past the end of the file.
    entry(1, [CPU.x86_64.type, CPU.x86_64.subtype, size, 0x1000, 12]);
    const prefix = new Uint8Array(0x1000 + slice.length);
    prefix.set(new Uint8Array(table.buffer));
    prefix.set(slice, 0x1000);
    // The bytes past the slice are zero, so the reader never needs them.
    const sparseReadAt = async (offset: number, length: number) => {
      const result = new Uint8Array(
        Math.max(0, Math.min(length, size - offset)),
      );
      if (offset < prefix.length)
        result.set(prefix.subarray(offset, offset + result.length));
      return result;
    };

    expect(await readMachoEncryption(sparseReadAt, size, 4096)).toMatchObject({
      status: "parsed",
      slices: [
        { container_file_offset: 0x1000, status: "encrypted" },
        {
          container_file_offset: size,
          status: "malformed",
          reason: "FAT architecture 1 slice range extends beyond the file",
        },
      ],
    });
    // The confirmed container reports the sibling's real fault, not an
    // unresolved JVM identity.
    expect(await readMachoImage(sparseReadAt, size)).toEqual({
      status: "malformed",
      reason: "FAT architecture 1 slice range extends beyond the file",
    });
  });
});

describe("Mach-O encryption reader: mapping budget", () => {
  it.each([
    "section bytes",
    "VM size",
    "VM overflow",
    "command width",
  ] as const)(
    "releases failed %s mappings before admitting the next slice",
    async (failure) => {
      const invalid = segment(
        "__BROKEN",
        {
          vmAddress:
            failure === "VM overflow" ? 0xffffffffffffffffn : 0x100000000n,
          vmSize: failure === "VM size" ? 0xffffn : 0x10000n,
          fileOffset: 0,
          fileSize: 0x10000,
        },
        failure !== "command width",
      );
      if (failure === "section bytes")
        new DataView(invalid.buffer).setUint32(64, 1, true);
      // Two records for the bad segment and five for text(): the first
      // slice fills admission but discards its mapping on validation failure.
      const facts = await read(
        fatImage([
          {
            cpu: CPU.x86_64,
            bytes: padded(
              machoImage({
                cpu: CPU.x86_64,
                commands: [
                  invalid,
                  text(),
                  encryption({
                    cryptoff: 0x4000,
                    cryptsize: 0x4000,
                    cryptid: 1,
                  }),
                ],
              }),
            ),
          },
          { cpu: CPU.arm64, bytes: encrypted() },
        ]),
        7,
      );
      if (facts.status !== "parsed") throw new Error(facts.status);
      expect(facts.slices[0]).toMatchObject({
        status: "encrypted",
        range: { mapping: { status: "unknown", reason: expect.any(String) } },
      });
      const healthy = await read(encrypted());
      if (healthy.status !== "parsed") throw new Error(healthy.status);
      expect(facts.slices[1]?.range?.mapping).toEqual(
        healthy.slices[0]?.range?.mapping,
      );
      expect(facts.slices[1]?.range?.mapping.status).toBe("mapped");
    },
  );

  it("leaves the budget to later slices when a slice does not map its range", async () => {
    const facts = await read(
      fatImage([
        {
          cpu: CPU.x86_64,
          bytes: padded(machoImage({ cpu: CPU.x86_64, commands: [text()] })),
        },
        { cpu: CPU.arm64, bytes: encrypted() },
      ]),
      5,
    );
    if (facts.status !== "parsed") throw new Error(facts.status);
    expect(
      facts.slices.map(({ status, range }) => [status, range?.mapping.status]),
    ).toEqual([
      ["absent", undefined],
      ["encrypted", "mapped"],
    ]);
  });

  it("shares one mapping budget across slices and keeps each status", async () => {
    // text() is one segment with three section records: five mapping records.
    const facts = await read(
      fatImage([
        { cpu: CPU.arm64, bytes: encrypted() },
        { cpu: CPU.arm64e, bytes: encrypted(CPU.arm64e) },
      ]),
      5,
    );
    if (facts.status !== "parsed") throw new Error(facts.status);
    expect(
      facts.slices.map(({ status, range }) => ({
        status,
        mapping: range?.mapping.status,
      })),
    ).toEqual([
      { status: "encrypted", mapping: "mapped" },
      { status: "encrypted", mapping: "unknown" },
    ]);
    expect(facts.slices[1]?.range?.mapping).toEqual({
      status: "unknown",
      reason:
        "mapping needs more than the 5 segment and section records shared by all slices",
    });
  });
});
