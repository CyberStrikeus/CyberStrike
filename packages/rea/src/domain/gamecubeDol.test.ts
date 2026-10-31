import { describe, expect, it } from "vitest";

import { parseDolHeader } from "./gamecubeDol.js";

interface SlotSpec {
  readonly offset: number;
  readonly address: number;
  readonly size: number;
}

interface DolSpec {
  readonly text?: readonly SlotSpec[];
  readonly data?: readonly SlotSpec[];
  readonly bss?: { readonly address: number; readonly size: number };
  readonly entry: number;
}

/** Build a DOL header with big-endian fields in a zero-filled file. */
const dol = (spec: DolSpec, fileLength: number): Uint8Array => {
  const bytes = new Uint8Array(fileLength);
  const view = new DataView(bytes.buffer);
  const writeSlots = (
    slots: readonly SlotSpec[],
    offsetBase: number,
    addressBase: number,
    sizeBase: number,
  ) =>
    slots.forEach((slot, index) => {
      view.setUint32(offsetBase + index * 4, slot.offset, false);
      view.setUint32(addressBase + index * 4, slot.address, false);
      view.setUint32(sizeBase + index * 4, slot.size, false);
    });
  writeSlots(spec.text ?? [], 0x00, 0x48, 0x90);
  writeSlots(spec.data ?? [], 0x1c, 0x64, 0xac);
  view.setUint32(0xd8, spec.bss?.address ?? 0, false);
  view.setUint32(0xdc, spec.bss?.size ?? 0, false);
  view.setUint32(0xe0, spec.entry, false);
  return bytes;
};

/** Parse and return the refusal message, failing the test if it is accepted. */
const refusal = (bytes: Uint8Array): string => {
  const result = parseDolHeader(bytes);
  if (result.ok) throw new Error("expected DOL refusal");
  return result.error;
};

describe("DOL header parsing", () => {
  it("keeps slot identity while deriving gaps in address order", () => {
    const parsed = parseDolHeader(
      dol(
        {
          text: [{ offset: 0x100, address: 0x8000_3100, size: 0x20 }],
          data: [
            { offset: 0x120, address: 0x8000_4020, size: 8 },
            { offset: 0x128, address: 0x8000_4008, size: 8 },
          ],
          bss: { address: 0x8000_4000, size: 0x30 },
          entry: 0x8000_3100,
        },
        0x130,
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.bssOverlaps).toEqual([0, 1]);
    expect(
      parsed.value.sections
        .filter(({ kind }) => kind === "data")
        .map(({ index, address }) => [index, address]),
    ).toEqual([
      [0, 0x8000_4020],
      [1, 0x8000_4008],
    ]);
    expect(parsed.value.bssGaps).toEqual([
      { address: 0x8000_4000, size: 8 },
      { address: 0x8000_4010, size: 0x10 },
      { address: 0x8000_4028, size: 8 },
    ]);
  });
  it("accepts a minimal header with one text section", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
        bss: { address: 0x8000_4000, size: 0 },
      },
      0x140,
    );
    expect(parseDolHeader(bytes)).toEqual({
      ok: true,
      value: {
        sections: [
          {
            kind: "text",
            index: 0,
            fileOffset: 0x100,
            address: 0x8000_3100,
            size: 0x40,
          },
        ],
        bss: { address: 0x8000_4000, size: 0 },
        bssGaps: [],
        bssOverlaps: [],
        entryPoint: 0x8000_3100,
      },
    });
  });

  it("returns a realistic layout with BSS overlapping a data section", () => {
    const bytes = dol(
      {
        text: [
          { offset: 0x100, address: 0x8000_3100, size: 0x200 },
          { offset: 0x300, address: 0x8000_3300, size: 0x100 },
        ],
        data: [
          { offset: 0x400, address: 0x8000_4000, size: 0x80 },
          { offset: 0x480, address: 0x8000_5000, size: 0x40 },
          { offset: 0x4c0, address: 0x8000_5040, size: 0x30 },
        ],
        bss: { address: 0x8000_4010, size: 0x100 },
        entry: 0x8000_3104,
      },
      0x500,
    );
    expect(parseDolHeader(bytes)).toEqual({
      ok: true,
      value: {
        sections: [
          {
            kind: "text",
            index: 0,
            fileOffset: 0x100,
            address: 0x8000_3100,
            size: 0x200,
          },
          {
            kind: "text",
            index: 1,
            fileOffset: 0x300,
            address: 0x8000_3300,
            size: 0x100,
          },
          {
            kind: "data",
            index: 0,
            fileOffset: 0x400,
            address: 0x8000_4000,
            size: 0x80,
          },
          {
            kind: "data",
            index: 1,
            fileOffset: 0x480,
            address: 0x8000_5000,
            size: 0x40,
          },
          {
            kind: "data",
            index: 2,
            fileOffset: 0x4c0,
            address: 0x8000_5040,
            size: 0x30,
          },
        ],
        bss: { address: 0x8000_4010, size: 0x100 },
        bssGaps: [{ address: 0x8000_4080, size: 0x90 }],
        bssOverlaps: [0],
        entryPoint: 0x8000_3104,
      },
    });
  });

  it("ignores zero-size slots even when their offset and address are garbage", () => {
    const bytes = dol(
      {
        text: [
          { offset: 0x100, address: 0x8000_3100, size: 0x40 },
          { offset: 0x3, address: 0x1, size: 0 },
        ],
        data: [{ offset: 0xfff_fff0, address: 0x7fff_fff1, size: 0 }],
        entry: 0x8000_3100,
      },
      0x140,
    );
    const result = parseDolHeader(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.sections).toHaveLength(1);
  });
});

describe("DOL section bounds and alignment (rules 1 to 4)", () => {
  it("refuses a file shorter than the 256-byte header (rule 1)", () => {
    expect(refusal(new Uint8Array(0xff))).toBe(
      "DOL header is truncated: needs 256 bytes; the file has 255",
    );
  });

  it("refuses a section whose file data starts inside the header (rule 3)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0xe0, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x200,
    );
    expect(refusal(bytes)).toBe(
      "text 0: file offset 0xe0 overlaps the 256-byte DOL header",
    );
  });

  it("refuses a section whose file range passes the end of the file (rule 3)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x13c,
    );
    expect(refusal(bytes)).toBe(
      "text 0: file range 0x100..0x140 exceeds the 316-byte file",
    );
  });

  it("refuses a load address below the GameCube memory window (rule 3)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x7fff_ff00, size: 0x40 }],
        entry: 0x7fff_ff00,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "text 0: load address 0x7fffff00 is below 0x80000000",
    );
  });

  it("refuses a load range that passes the exclusive memory end (rule 3)", () => {
    const bytes = dol(
      {
        data: [{ offset: 0x100, address: 0x817f_ffe0, size: 0x40 }],
        text: [{ offset: 0x140, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x180,
    );
    expect(refusal(bytes)).toBe(
      "data 0: load range 0x817fffe0..0x81800020 exceeds 0x81800000",
    );
  });

  it("accepts a load range ending exactly at the exclusive memory end (rule 3)", () => {
    const bytes = dol(
      {
        data: [{ offset: 0x140, address: 0x817f_ffc0, size: 0x40 }],
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x180,
    );
    expect(parseDolHeader(bytes).ok).toBe(true);
  });

  it("refuses an unaligned text file offset (rule 4)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x102, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x142,
    );
    expect(refusal(bytes)).toBe(
      "text 0: file offset 0x102 must be 4-byte aligned",
    );
  });

  it("refuses an unaligned text load address (rule 4)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3102, size: 0x40 }],
        entry: 0x8000_3104,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "text 0: load address 0x80003102 must be 4-byte aligned",
    );
  });

  it("refuses an unaligned text size (rule 4)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x42 }],
        entry: 0x8000_3100,
      },
      0x142,
    );
    expect(refusal(bytes)).toBe("text 0: size 0x42 must be 4-byte aligned");
  });

  it("accepts an unaligned data load address (no alignment rule for data)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        data: [{ offset: 0x140, address: 0x8000_4003, size: 0x21 }],
        entry: 0x8000_3100,
      },
      0x161,
    );
    expect(parseDolHeader(bytes).ok).toBe(true);
  });
});

describe("DOL text presence and overlap (rules 5 and 6)", () => {
  it("refuses a DOL with no used text section (rule 5)", () => {
    const bytes = dol(
      {
        data: [{ offset: 0x100, address: 0x8000_4000, size: 0x40 }],
        entry: 0x8000_4000,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe("DOL has no used text section");
  });

  it("refuses two sections whose load addresses overlap (rule 6)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x100 }],
        data: [{ offset: 0x400, address: 0x8000_3180, size: 0x40 }],
        entry: 0x8000_3100,
      },
      0x440,
    );
    expect(refusal(bytes)).toBe(
      "text 0 and data 0 overlap in load address range",
    );
  });

  it("refuses two sections whose file ranges overlap (rule 6)", () => {
    const bytes = dol(
      {
        text: [
          { offset: 0x100, address: 0x8000_3100, size: 0x100 },
          { offset: 0x180, address: 0x8000_4000, size: 0x40 },
        ],
        entry: 0x8000_3100,
      },
      0x200,
    );
    expect(refusal(bytes)).toBe("text 0 and text 1 overlap in file range");
  });

  it("accepts adjacent half-open ranges that only touch (rule 6)", () => {
    const bytes = dol(
      {
        text: [
          { offset: 0x100, address: 0x8000_3100, size: 0x40 },
          { offset: 0x140, address: 0x8000_3140, size: 0x40 },
        ],
        entry: 0x8000_3100,
      },
      0x180,
    );
    expect(parseDolHeader(bytes).ok).toBe(true);
  });
});

describe("DOL entry point and BSS (rules 7 and 8)", () => {
  it("refuses an entry point outside every used text section (rule 7)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3140,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "entry point 0x80003140 is outside every used text section",
    );
  });

  it("refuses an unaligned entry point (rule 7)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        entry: 0x8000_3102,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "entry point 0x80003102 must be 4-byte aligned",
    );
  });

  it("refuses an entry point inside a data section (rule 7)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        data: [{ offset: 0x140, address: 0x8000_4000, size: 0x40 }],
        entry: 0x8000_4000,
      },
      0x180,
    );
    expect(refusal(bytes)).toBe(
      "entry point 0x80004000 is outside every used text section",
    );
  });

  it("accepts zero-size BSS with an address outside the memory window (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        bss: { address: 0x1234_5678, size: 0 },
        entry: 0x8000_3100,
      },
      0x140,
    );
    const result = parseDolHeader(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.bss.size).toBe(0);
  });

  it("refuses non-zero BSS below the memory window (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        bss: { address: 0x7000_0000, size: 0x10 },
        entry: 0x8000_3100,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "bss: load address 0x70000000 is below 0x80000000",
    );
  });

  it("refuses non-zero BSS whose range passes the memory end (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        bss: { address: 0x817f_fff0, size: 0x20 },
        entry: 0x8000_3100,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "bss: load range 0x817ffff0..0x81800010 exceeds 0x81800000",
    );
  });

  it("refuses BSS whose address + size wraps past 32 bits (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        bss: { address: 0xffff_fff0, size: 0x100 },
        entry: 0x8000_3100,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe(
      "bss: load range 0xfffffff0..0x1000000f0 exceeds 0x81800000",
    );
  });

  it("refuses BSS overlapping a text section (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        bss: { address: 0x8000_3120, size: 0x10 },
        entry: 0x8000_3100,
      },
      0x140,
    );
    expect(refusal(bytes)).toBe("bss and text 0 overlap in load address range");
  });

  it("reports every data section that BSS overlaps, by slot index (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        data: [
          { offset: 0x140, address: 0x8000_4000, size: 0x40 },
          { offset: 0x180, address: 0x8000_5000, size: 0x40 },
          { offset: 0x1c0, address: 0x8000_6000, size: 0x40 },
        ],
        bss: { address: 0x8000_4020, size: 0x1100 },
        entry: 0x8000_3100,
      },
      0x200,
    );
    const result = parseDolHeader(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.bssOverlaps).toEqual([0, 1]);
  });

  it("reports no BSS overlaps when BSS sits in a gap between data sections (rule 8)", () => {
    const bytes = dol(
      {
        text: [{ offset: 0x100, address: 0x8000_3100, size: 0x40 }],
        data: [{ offset: 0x140, address: 0x8000_4000, size: 0x40 }],
        bss: { address: 0x8000_4040, size: 0x100 },
        entry: 0x8000_3100,
      },
      0x180,
    );
    const result = parseDolHeader(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.bssOverlaps).toEqual([]);
  });
});
