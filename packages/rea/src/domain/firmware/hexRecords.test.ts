import { describe, expect, it } from "vitest";

import {
  HEX_RECORD_MAX_FILE_BYTES,
  HEX_RECORD_MAX_RUNS,
  createHexRecordDecoder,
  detectHexRecordEncoding,
} from "./hexRecords.js";
import {
  INTEL_HEX_MAX_LINE_CHARS,
  SREC_MAX_LINE_CHARS,
  type HexRecordEncoding,
} from "./hexRecordSyntax.js";
import {
  INTEL_HEX_I16,
  INTEL_HEX_I32_GAP,
  INTEL_HEX_I8,
  SREC_S19,
  SREC_S37,
  SREC_WIKIPEDIA,
  intelHexRecord,
  srecRecord,
} from "./hexRecords.fixture.js";

const decode = (
  text: string,
  encoding: HexRecordEncoding = "intel-hex",
  chunkBytes = 7,
) => {
  const bytes = Buffer.from(text, "latin1");
  const created = createHexRecordDecoder(encoding, bytes.length);
  if (!created.ok) return created;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const written = created.value.write(
      bytes.subarray(offset, offset + chunkBytes),
    );
    if (!written.ok) return written;
  }
  return created.value.finish();
};

const image = (text: string, encoding: HexRecordEncoding = "intel-hex") => {
  const decoded = decode(text, encoding);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value;
};

const regionSummary = (text: string, encoding?: HexRecordEncoding) =>
  image(text, encoding).regions.map((region) => ({
    start: region.start,
    end: region.end,
    hex: Buffer.from(region.bytes).toString("hex"),
  }));

const lineSwap = (text: string, left: number, right: number): string => {
  const rows = text.split("\n");
  [rows[left], rows[right]] = [rows[right] ?? "", rows[left] ?? ""];
  return rows.join("\n");
};

describe("Intel HEX decoding", () => {
  it("decodes separate regions, a start linear address and EOF", () => {
    const decoded = image(INTEL_HEX_I32_GAP);
    expect(regionSummary(INTEL_HEX_I32_GAP)).toEqual([
      {
        start: 0x0800_0000,
        end: 0x0800_001f,
        hex: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString(
          "hex",
        ),
      },
      { start: 0x0800_0100, end: 0x0800_0103, hex: "deadbeef" },
    ]);
    expect(decoded.terminated).toBe(true);
    expect(decoded.limitations).toEqual([]);
    expect(decoded.regions[0]).toMatchObject({
      recordCount: 2,
      firstLine: 2,
      lastLine: 3,
    });
    expect(decoded.metadata).toEqual({
      kind: "hex-records",
      encoding: "intel-hex",
      variant: "I32HEX",
      line_count: 6,
      record_count: 6,
      data_record_count: 3,
      data_bytes: 36,
      duplicate_bytes: 0,
      region_count: 2,
      lowest_address: 0x0800_0000,
      highest_address: 0x0800_0103,
      termination: "present",
      start_address: 0x0800_0101,
      start_address_record: "05",
      start_segment_cs: null,
      start_segment_ip: null,
      header_hex: null,
      header_text: null,
      declared_data_record_count: null,
    });
  });

  it("sorts out-of-order records into the same regions", () => {
    expect(regionSummary(lineSwap(INTEL_HEX_I32_GAP, 1, 2))).toEqual(
      regionSummary(INTEL_HEX_I32_GAP),
    );
  });

  it("decodes I8HEX and I16HEX with segment start facts", () => {
    expect(image(INTEL_HEX_I8)).toMatchObject({
      metadata: { variant: "I8HEX", start_address: null },
      regions: [{ start: 0x30, end: 0x32 }],
    });
    expect(image(INTEL_HEX_I16)).toMatchObject({
      metadata: {
        variant: "I16HEX",
        start_segment_cs: 0x1000,
        start_segment_ip: 0,
        start_address: null,
      },
      regions: [{ start: 0x1_0000, end: 0x1_0003 }],
    });
  });

  it("accepts identical overlap as duplicate bytes and rejects conflicts", () => {
    expect(
      image(":0400000001020304F2\n:020002000304F5\n:00000001FF\n"),
    ).toMatchObject({
      metadata: { duplicate_bytes: 2, data_bytes: 4, region_count: 1 },
      regions: [{ start: 0, end: 3, recordCount: 2 }],
    });
    expect(
      decode(":0400000001020304F2\n:02000200039960\n:00000001FF\n"),
    ).toEqual({
      ok: false,
      error: {
        kind: "format",
        message:
          "address 0x00000003 written with different values at line 1 (0x04) and line 2 (0x99)",
      },
    });
  });

  it.each([
    [
      "checksum",
      INTEL_HEX_I32_GAP.replace("BEEFC3", "BEEFC4"),
      "line 4: record type 00 checksum 0xc4 does not match computed 0xc3",
    ],
    [
      "unknown type",
      INTEL_HEX_I32_GAP.replace(":00000001FF", ":00000006FA\n:00000001FF"),
      "line 6: unknown record type 06",
    ],
    ["odd length", ":0000000\n", "line 1: odd number of hex digits (7)"],
    ["non-hex", ":00000001FG\n", "line 1: invalid character 0x47 at column 11"],
    [
      "lone CR",
      ":00000001FF\r:00000001FF\n",
      "line 1: invalid character 0x0d at column 12",
    ],
    [
      "byte count",
      ":0200000001FD\n",
      "line 1: record type 00 byte count 0x02 declares 2 data bytes, but the line holds 1",
    ],
    [
      "fixed length",
      `${intelHexRecord(4, 0, [8])}\n`,
      "line 1: record type 04 requires 2 data bytes, found 1",
    ],
    [
      "extended address with a non-zero address field",
      ":020001040800F1\n",
      "line 1: record type 04 requires address 0x0000, found 0x0001",
    ],
    [
      "segment address with a non-zero address field",
      `${intelHexRecord(2, 0x10, [0x10, 0x00])}\n`,
      "line 1: record type 02 requires address 0x0000, found 0x0010",
    ],
    [
      "offset wrap",
      ":020000040000FA\n:10FFF800000102030405060708090A0B0C0D0E0F81\n:00000001FF\n",
      "line 2: data at offset 0xfff8 with 16 bytes wraps past 0xffff",
    ],
    [
      "record after EOF",
      `${INTEL_HEX_I8}:00000001FF\n`,
      "line 3: record follows the termination record at line 2",
    ],
    [
      "conflicting start",
      `${intelHexRecord(5, 0, [0, 0, 0, 1])}\n${intelHexRecord(5, 0, [0, 0, 0, 2])}\n`,
      "line 2: start address 0x00000002 conflicts with 0x00000001 declared at line 1",
    ],
    [
      "I16HEX above 0xfffff",
      `${intelHexRecord(2, 0, [0xff, 0xff])}\n${intelHexRecord(0, 0x20, [1])}\n`,
      "line 2: I16HEX data at 0x00100010 with 1 bytes exceeds the 20-bit address 0xfffff",
    ],
  ])("fails closed on %s", (_name, text, message) => {
    const decoded = decode(text);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.error.kind).toBe("format");
    expect(decoded.error.message).toContain(message);
  });
});

describe("Intel HEX lines, termination and limits", () => {
  it("keeps regions with unknown termination when EOF is missing", () => {
    const decoded = image(INTEL_HEX_I32_GAP.replace(":00000001FF\n", ""));
    expect(decoded.terminated).toBe(false);
    expect(decoded.regions).toHaveLength(2);
    expect(decoded.metadata.termination).toBe("absent");
    expect(decoded.limitations).toEqual([
      "Intel HEX has no termination record; the file may be truncated.",
    ]);
  });

  it("accepts blank lines, lowercase, CRLF and trailing blanks", () => {
    const text = `\n${INTEL_HEX_I8.toLowerCase().replaceAll("\n", " \t\r\n")}\n\n`;
    expect(image(text)).toMatchObject({
      metadata: { line_count: 5, record_count: 2 },
      regions: [{ start: 0x30, firstLine: 2, lastLine: 2 }],
    });
    // A final record without a line ending still decodes.
    expect(image(":00000001FF").terminated).toBe(true);
  });

  it("bounds line length at the format maximum", () => {
    const longest = intelHexRecord(
      0,
      0,
      Array.from({ length: 255 }, () => 1),
    );
    expect(longest).toHaveLength(INTEL_HEX_MAX_LINE_CHARS);
    expect(image(`${longest}\r\n:00000001FF\n`).metadata.data_bytes).toBe(255);
    const decoded = decode(`${longest}0\n`);
    expect(decoded).toMatchObject({
      ok: false,
      error: {
        kind: "format",
        message: "line 1: line exceeds the 521-character Intel HEX maximum",
      },
    });
  });

  it("bounds address runs before creating another", () => {
    const records = (count: number): string => {
      const rows: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const address = index * 2;
        if (address % 0x1_0000 === 0)
          rows.push(
            intelHexRecord(4, 0, [address >>> 24, (address >>> 16) & 0xff]),
          );
        rows.push(intelHexRecord(0, address & 0xffff, [index & 0xff]));
      }
      return `${rows.join("\n")}\n:00000001FF\n`;
    };
    expect(image(records(HEX_RECORD_MAX_RUNS)).regions).toHaveLength(
      HEX_RECORD_MAX_RUNS,
    );
    const over = decode(records(HEX_RECORD_MAX_RUNS + 1), "intel-hex", 65_536);
    expect(over).toMatchObject({
      ok: false,
      error: { kind: "limit", boundary: "capacity" },
    });
  });

  it("refuses a file over the fixed size ceiling before allocation", () => {
    expect(
      createHexRecordDecoder("intel-hex", HEX_RECORD_MAX_FILE_BYTES + 1),
    ).toMatchObject({
      ok: false,
      error: { kind: "limit", boundary: "file-size" },
    });
  });
});

describe("S-record decoding", () => {
  it("decodes S19 with header text, count and start", () => {
    const decoded = image(SREC_S19, "srec");
    expect(decoded.regions.map(({ start, end }) => [start, end])).toEqual([
      [0, 0x1f],
    ]);
    expect(decoded.limitations).toEqual([]);
    expect(decoded.metadata).toMatchObject({
      encoding: "srec",
      variant: "S19",
      header_hex: "484452",
      header_text: "HDR",
      declared_data_record_count: 2,
      start_address: 0,
      start_address_record: "S9",
      termination: "present",
    });
  });

  it("decodes S37 and keeps a NUL-padded header as hex only", () => {
    expect(image(SREC_S37, "srec")).toMatchObject({
      metadata: { variant: "S37", start_address: 0x0800_0101 },
      regions: [{ start: 0x0800_0000, end: 0x0800_0003 }],
    });
    expect(image(SREC_WIKIPEDIA, "srec")).toMatchObject({
      metadata: {
        header_text: null,
        header_hex: "68656c6c6f20202020200000",
        declared_data_record_count: 3,
      },
      regions: [{ start: 0, end: 0x45 }],
    });
  });

  it("reports a termination width mismatch as a limitation", () => {
    const decoded = image(
      SREC_S19.replace("S9030000FC", "S70500000000FA"),
      "srec",
    );
    expect(decoded.terminated).toBe(true);
    expect(decoded.metadata).toMatchObject({
      start_address_record: "S7",
      variant: "S19",
    });
    expect(decoded.limitations).toEqual([
      "S-record termination S7 does not match the address width of S1 data records.",
    ]);
  });

  it("keeps regions with unknown termination when S9 is missing", () => {
    const decoded = image(SREC_S19.replace("S9030000FC\n", ""), "srec");
    expect(decoded.terminated).toBe(false);
    expect(decoded.limitations).toEqual([
      "S-record has no termination record; the file may be truncated.",
    ]);
  });

  it.each([
    [
      "count mismatch",
      SREC_S19.replace("S5030002FA", "S5030003F9"),
      "line 4: record type S5 declares 3 data records, but 2 precede it",
    ],
    ["reserved S4", "S4030000FC\n", "line 1: reserved record type S4"],
    [
      "second header",
      `${SREC_S19.split("\n")[0] ?? ""}\n${SREC_S19}`,
      "line 2: second S0 header record; the first is at line 1",
    ],
    [
      "S9 with data",
      `${srecRecord(9, 0, [1])}\n`,
      "line 1: record type S9 byte count 0x04 does not fit its 2-byte address and checksum",
    ],
    [
      "S1 crossing 0xffff",
      `${srecRecord(1, 0xffff, [1, 2])}\n`,
      "line 1: record type S1 data at 0x0000ffff with 2 bytes crosses 0xffff",
    ],
    [
      "S3 crossing 0xffffffff",
      `${srecRecord(3, 0xffff_ffff, [1, 2])}\n`,
      "crosses 0xffffffff",
    ],
  ])("fails closed on %s", (_name, text, message) => {
    const decoded = decode(text, "srec");
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error.message).toContain(message);
  });

  it("bounds line length at the format maximum", () => {
    const longest = srecRecord(
      1,
      0,
      Array.from({ length: 252 }, () => 1),
    );
    expect(longest).toHaveLength(SREC_MAX_LINE_CHARS);
    expect(image(`${longest}\n`, "srec").metadata.data_bytes).toBe(252);
    expect(decode(`${longest} 0\n`, "srec").ok).toBe(false);
  });
});

describe("hex record recognition", () => {
  it.each([
    [INTEL_HEX_I32_GAP, "intel-hex"],
    [":00000001FF", "intel-hex"],
    [SREC_S19, "srec"],
    [SREC_S19.toLowerCase().replace("s0", "S0"), "srec"],
    ["﻿:00000001FF\n", undefined],
    ["\n:00000001FF\n", undefined],
    [":00000001FE\n", undefined],
    ["Some text\n", undefined],
    ["", undefined],
  ] as const)("recognizes %j as %s", (text, expected) => {
    expect(detectHexRecordEncoding(Buffer.from(text))).toBe(expected);
  });
});

it("keeps data offsets, start payloads and the ignored EOF offset distinct", () => {
  const parsed = image(
    [
      intelHexRecord(0, 0x1234, [0xa5]),
      intelHexRecord(3, 0, [0x10, 0, 0x12, 0x34]),
      intelHexRecord(5, 0, [0x12, 0x34, 0x56, 0x78]),
      intelHexRecord(1, 0x1234),
    ].join("\n"),
  );
  expect(parsed.metadata).toMatchObject({
    start_segment_cs: 0x1000,
    start_segment_ip: 0x1234,
    start_address: 0x12345678,
  });
  expect(parsed.terminated).toBe(true);
  expect(parsed.regions).toMatchObject([
    { start: 0x1234, end: 0x1234, bytes: Uint8Array.of(0xa5) },
  ]);
});
