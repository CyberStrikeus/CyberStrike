import { expect, it } from "vitest";

import {
  createUf2Decoder,
  hasUf2Block,
  UF2_MAX_FILE_BYTES,
  type Uf2Image,
} from "./uf2.js";
import {
  RP2040_FAMILY,
  RP2350_ARM_S_FAMILY,
  RP2XXX_ABSOLUTE_FAMILY,
  UF2_FLAGS,
  patternBytes,
  uf2Block,
  uf2File,
  uf2Image,
} from "./uf2.fixture.js";

const decode = (bytes: Uint8Array, chunkSize = bytes.length || 1) => {
  const decoder = createUf2Decoder(bytes.length);
  if (!decoder.ok) throw new Error(decoder.error.message);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const written = decoder.value.write(
      bytes.subarray(offset, offset + chunkSize),
    );
    if (!written.ok) return written;
  }
  return decoder.value.finish();
};

const image = (bytes: Uint8Array, chunkSize?: number): Uf2Image => {
  const decoded = decode(bytes, chunkSize);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value;
};

const regionFacts = ({ regions }: Uf2Image) =>
  regions.map(({ bytes, ...facts }) => ({ ...facts, length: bytes.length }));

it("recognizes only a complete first block with all three magic numbers", () => {
  const block = uf2Block({
    address: 0x1000_0000,
    payload: [1],
    blockNo: 0,
    numBlocks: 1,
  });
  expect(hasUf2Block(block)).toBe(true);
  expect(hasUf2Block(block.subarray(0, 511))).toBe(false);
  for (const magics of [
    [0x0a32_4656, 0x9e5d_5157, 0x0ab1_6f30],
    [0x0a32_4655, 0x9e5d_5156, 0x0ab1_6f30],
    [0x0a32_4655, 0x9e5d_5157, 0x0ab1_6f31],
  ] as const)
    expect(
      hasUf2Block(
        uf2Block({
          address: 0,
          payload: [1],
          blockNo: 0,
          numBlocks: 1,
          magics,
        }),
      ),
    ).toBe(false);
});

it("joins one family's numbered blocks into a region across chunk boundaries", () => {
  const bytes = patternBytes(1000);
  const file = uf2File(uf2Image(RP2040_FAMILY, 0x1000_0000, bytes));
  for (const chunkSize of [file.length, 512, 100, 7]) {
    const decoded = image(file, chunkSize);
    expect(decoded.complete).toBe(true);
    expect(decoded.limitations).toEqual([]);
    expect(regionFacts(decoded)).toEqual([
      {
        familyId: RP2040_FAMILY,
        familyName: "RP2040",
        start: 0x1000_0000,
        end: 0x1000_03e7,
        length: 1000,
        blockCount: 4,
        firstFileBlock: 0,
        lastFileBlock: 3,
      },
    ]);
    expect(Buffer.compare(decoded.regions[0]!.bytes, bytes)).toBe(0);
  }
  expect(image(file).metadata).toEqual({
    kind: "uf2",
    block_count: 4,
    trailing_bytes: 0,
    invalid_block_count: 0,
    flash_block_count: 4,
    not_main_flash_block_count: 0,
    file_container_block_count: 0,
    md5_block_count: 0,
    extension_tag_block_count: 0,
    family_count: 1,
    family_name_registry: "microsoft/uf2 cf3bd7f9 utils/uf2families.json",
    numbering_group_count: 1,
    missing_block_count: 0,
    ambiguous_numbering_group_count: 0,
    repeated_block_count: 0,
    out_of_order_block_count: 0,
    block_number_out_of_range_count: 0,
    region_count: 1,
    data_bytes: 1000,
    duplicate_bytes: 0,
  });
});

it("keeps gaps between regions and sorts blocks that arrive out of order", () => {
  const payload = patternBytes(768);
  const [first, second, third, late] = [0, 1, 2, 3].map((blockNo) =>
    uf2Block({
      address: blockNo === 3 ? 0x1000_1000 : 0x1000_0000 + blockNo * 256,
      payload:
        blockNo === 3
          ? [0xaa, 0xbb]
          : payload.subarray(blockNo * 256, (blockNo + 1) * 256),
      blockNo,
      numBlocks: 4,
      familyId: RP2040_FAMILY,
    }),
  );
  const decoded = image(uf2File([late!, third!, first!, second!]));
  expect(Buffer.compare(decoded.regions[0]!.bytes, payload)).toBe(0);
  expect(regionFacts(decoded)).toEqual([
    expect.objectContaining({
      start: 0x1000_0000,
      end: 0x1000_02ff,
      blockCount: 3,
      firstFileBlock: 1,
      lastFileBlock: 3,
    }),
    expect.objectContaining({
      start: 0x1000_1000,
      end: 0x1000_1001,
      blockCount: 1,
      firstFileBlock: 0,
      lastFileBlock: 0,
    }),
  ]);
  expect(decoded.metadata).toMatchObject({
    out_of_order_block_count: 2,
    missing_block_count: 0,
    region_count: 2,
    data_bytes: 770,
  });
  expect(decoded.complete).toBe(true);
});

it("counts identical rewrites and refuses a conflicting rewrite of one address", () => {
  const first = uf2Block({
    address: 0x2000_0000,
    payload: [1, 2, 3, 4],
    blockNo: 0,
    numBlocks: 2,
    familyId: RP2040_FAMILY,
  });
  const same = uf2Block({
    address: 0x2000_0002,
    payload: [3, 4, 5],
    blockNo: 1,
    numBlocks: 2,
    familyId: RP2040_FAMILY,
  });
  const decoded = image(uf2File([first, same]));
  expect(decoded.metadata).toMatchObject({
    duplicate_bytes: 2,
    data_bytes: 5,
  });
  expect(
    Buffer.compare(decoded.regions[0]!.bytes, Uint8Array.from([1, 2, 3, 4, 5])),
  ).toBe(0);
  const different = uf2Block({
    address: 0x2000_0002,
    payload: [3, 9],
    blockNo: 1,
    numBlocks: 2,
    familyId: RP2040_FAMILY,
  });
  expect(decode(uf2File([first, different]))).toEqual({
    ok: false,
    error: {
      kind: "format",
      message:
        "family 0xe48bff56 (RP2040) address 0x20000003 is written with different values by block 0 (0x04) and block 1 (0x09)",
    },
  });
});

it("keeps families apart even when they target the same addresses", () => {
  // A Pico SDK universal image: an RP2350 absolute block, then RP2040 and RP2350 images.
  const absolute = uf2Block({
    address: 0x10ff_ff00,
    payload: new Uint8Array(256).fill(0xef),
    blockNo: 0,
    numBlocks: 2,
    familyId: RP2XXX_ABSOLUTE_FAMILY,
  });
  const decoded = image(
    uf2File([
      absolute,
      ...uf2Image(RP2040_FAMILY, 0x1000_0000, patternBytes(512, 1)),
      ...uf2Image(RP2350_ARM_S_FAMILY, 0x1000_0000, patternBytes(512, 2)),
    ]),
  );
  expect(
    decoded.regions.map(({ familyId, start, end }) => [familyId, start, end]),
  ).toEqual([
    [RP2040_FAMILY, 0x1000_0000, 0x1000_01ff],
    [RP2XXX_ABSOLUTE_FAMILY, 0x10ff_ff00, 0x10ff_ffff],
    [RP2350_ARM_S_FAMILY, 0x1000_0000, 0x1000_01ff],
  ]);
  expect(decoded.metadata).toMatchObject({
    family_count: 3,
    numbering_group_count: 3,
    missing_block_count: 1,
    duplicate_bytes: 0,
  });
  expect(decoded.complete).toBe(false);
  expect(decoded.limitations).toEqual([
    "UF2 numbering declares 1 block(s) that are absent: family 0xe48bff57 (RP2XXX_ABSOLUTE) with 2 numbered blocks has 1 of them.",
  ]);
});

it("names the LibreTiny families that the cited registry lists", () => {
  // LibreTiny also builds LN882H (0xa38090a8), which that registry omits.
  const families = new Map<number, string | null>([
    [0x9fff_d543, "RTL8710A"],
    [0x22e0_d6fc, "RTL8710B"],
    [0xe08f_7564, "RTL8720C"],
    [0x3379_cfe2, "RTL8720D"],
    [0x675a_40b0, "BK7231U"],
    [0x7b3e_f230, "BK7231N"],
    [0x6a82_cc42, "BK7251"],
    [0xde12_70b7, "BL602"],
    [0xa380_90a8, null],
  ]);
  const decoded = image(
    uf2File(
      [...families.keys()].flatMap((familyId) =>
        uf2Image(familyId, 0x0, patternBytes(256)),
      ),
    ),
  );
  expect(
    new Map(
      decoded.regions.map(({ familyId, familyName }) => [familyId, familyName]),
    ),
  ).toEqual(families);
});

it("reports numbered blocks that are absent and leaves coverage unknown", () => {
  const blocks = uf2Image(RP2040_FAMILY, 0x1000_0000, patternBytes(1024));
  const decoded = image(uf2File([blocks[0]!, blocks[1]!, blocks[3]!]));
  expect(decoded.complete).toBe(false);
  expect(decoded.metadata).toMatchObject({
    missing_block_count: 1,
    region_count: 2,
  });
  expect(decoded.limitations).toEqual([
    "UF2 numbering declares 1 block(s) that are absent: family 0xe48bff56 (RP2040) with 4 numbered blocks has 3 of them.",
  ]);
});

it("keeps equal-sized esptool copies complete and an identical resend complete", () => {
  // esptool numbers each merged file from 0, so equal-sized files reuse numbers.
  const decoded = image(
    uf2File([
      ...uf2Image(0xc47e_5767, 0x0, patternBytes(512, 3)),
      ...uf2Image(0xc47e_5767, 0x8000, patternBytes(512, 4)),
    ]),
  );
  expect(decoded.metadata).toMatchObject({
    numbering_group_count: 1,
    repeated_block_count: 2,
    out_of_order_block_count: 1,
    missing_block_count: 0,
    ambiguous_numbering_group_count: 0,
    family_count: 1,
    region_count: 2,
  });
  expect(decoded.complete).toBe(true);
  expect(decoded.regions[1]?.familyName).toBe("ESP32S3");
  // A block sent twice to its own address is one block, not a second copy.
  const blocks = uf2Image(RP2040_FAMILY, 0x1000_0000, patternBytes(512));
  const resent = image(uf2File([blocks[0]!, blocks[1]!, blocks[1]!]));
  expect(resent.complete).toBe(true);
  expect(resent.metadata).toMatchObject({
    repeated_block_count: 1,
    duplicate_bytes: 256,
    ambiguous_numbering_group_count: 0,
  });
});

it("leaves coverage unknown when one copy of reused numbering lost a block", () => {
  const first = uf2Image(0xc47e_5767, 0x0, patternBytes(768, 5));
  const second = uf2Image(0xc47e_5767, 0x8000, patternBytes(768, 6));
  for (const lost of [first[1]!, second[2]!]) {
    const decoded = image(
      uf2File([...first, ...second].filter((block) => block !== lost)),
    );
    expect(decoded.complete).toBe(false);
    expect(decoded.metadata).toMatchObject({
      missing_block_count: 0,
      ambiguous_numbering_group_count: 1,
    });
    expect(decoded.limitations).toEqual([
      "UF2 numbering cannot show that every copy of a block sequence is complete: family 0xc47e5767 (ESP32S3) with 3 numbered blocks has some numbers at 1 address(es) and others at 2.",
    ]);
  }
});

it("excludes not-main-flash and file-container blocks from regions", () => {
  const flash = uf2Block({
    address: 0x0,
    payload: [1, 2],
    blockNo: 0,
    numBlocks: 3,
  });
  const comment = uf2Block({
    address: 0x0,
    payload: [9, 9, 9],
    blockNo: 1,
    numBlocks: 3,
    flags: UF2_FLAGS.notMainFlash,
  });
  const decoded = image(uf2File([flash, comment]));
  expect(regionFacts(decoded)).toEqual([
    {
      familyId: null,
      familyName: null,
      start: 0,
      end: 1,
      length: 2,
      blockCount: 1,
      firstFileBlock: 0,
      lastFileBlock: 0,
    },
  ]);
  expect(decoded.metadata).toMatchObject({
    not_main_flash_block_count: 1,
    flash_block_count: 1,
    family_count: 0,
    missing_block_count: 1,
  });
  expect(decoded.limitations).toContain(
    "1 UF2 block(s) are flagged not main flash (flag 0x1); their 3 payload bytes are in no region.",
  );
  const file = uf2Block({
    address: 0,
    payload: [0x41],
    blockNo: 2,
    numBlocks: 3,
    fileSize: 1,
    flags: UF2_FLAGS.fileContainer | UF2_FLAGS.notMainFlash,
  });
  const contained = image(uf2File([flash, comment, file]));
  expect(contained.complete).toBe(false);
  expect(contained.metadata).toMatchObject({
    file_container_block_count: 1,
    not_main_flash_block_count: 1,
    missing_block_count: 0,
    region_count: 1,
  });
  expect(contained.limitations).toContain(
    "1 UF2 block(s) belong to file containers (flag 0x1000); their files were not reconstructed.",
  );
});

it("excludes invalid blocks and a truncated final block, leaving coverage unknown", () => {
  const blocks = uf2Image(RP2040_FAMILY, 0x1000_0000, patternBytes(768));
  const badEnd = uf2Block({
    address: 0x1000_0100,
    payload: patternBytes(256),
    blockNo: 1,
    numBlocks: 3,
    familyId: RP2040_FAMILY,
    magics: [0x0a32_4655, 0x9e5d_5157, 0],
  });
  const oversized = uf2Block({
    address: 0x1000_0300,
    payload: [1],
    declaredSize: 477,
    blockNo: 2,
    numBlocks: 3,
    familyId: RP2040_FAMILY,
  });
  const wrapping = uf2Block({
    address: 0xffff_ffff,
    payload: [1, 2],
    blockNo: 0,
    numBlocks: 1,
  });
  const decoded = image(
    uf2File([
      blocks[0]!,
      badEnd,
      blocks[2]!,
      oversized,
      wrapping,
      blocks[1]!.subarray(0, 100),
    ]),
  );
  expect(decoded.metadata).toMatchObject({
    block_count: 5,
    trailing_bytes: 100,
    invalid_block_count: 3,
    flash_block_count: 2,
    missing_block_count: 1,
    region_count: 2,
  });
  expect(decoded.complete).toBe(false);
  expect(decoded.limitations).toEqual([
    "UF2 file ends with 100 bytes after its last complete 512-byte block; the file may be truncated.",
    "3 UF2 block(s) are invalid and were excluded; the first is block 1 at byte offset 512: end magic number does not match.",
    "UF2 numbering declares 1 block(s) that are absent: family 0xe48bff56 (RP2040) with 3 numbered blocks has 2 of them.",
  ]);
});

it("reports block numbers outside their declared count", () => {
  const decoded = image(
    uf2File([
      uf2Block({ address: 0, payload: [1], blockNo: 1, numBlocks: 1 }),
      uf2Block({ address: 1, payload: [2], blockNo: 0, numBlocks: 0 }),
    ]),
  );
  expect(decoded.metadata).toMatchObject({
    block_number_out_of_range_count: 2,
    numbering_group_count: 0,
    region_count: 1,
    data_bytes: 2,
  });
  expect(decoded.complete).toBe(false);
});

it("counts MD5 and extension-tag flags as declared, unverified facts", () => {
  const decoded = image(
    uf2File([
      uf2Block({
        address: 0,
        payload: [1],
        blockNo: 0,
        numBlocks: 2,
        flags: UF2_FLAGS.md5,
      }),
      uf2Block({
        address: 1,
        payload: [2],
        blockNo: 1,
        numBlocks: 2,
        flags: UF2_FLAGS.extensionTags,
      }),
    ]),
  );
  expect(decoded.metadata).toMatchObject({
    md5_block_count: 1,
    extension_tag_block_count: 1,
    region_count: 1,
  });
  expect(decoded.complete).toBe(true);
  expect(decoded.limitations).toEqual([
    "1 UF2 block(s) declare an MD5 flash region (flag 0x4000) and 1 declare extension tags (flag 0x8000); both are counted, not decoded or verified.",
  ]);
});

it("accepts boundary blocks beside the invalid ones", () => {
  const decoded = image(
    uf2File([
      // A full 476-byte payload ends exactly at the top of the address space.
      uf2Block({
        address: 0xffff_ffff - 475,
        payload: patternBytes(476),
        blockNo: 0,
        numBlocks: 3,
        familyId: RP2040_FAMILY,
      }),
      // A main-flash block may carry no payload.
      uf2Block({
        address: 0x1000_0000,
        payload: [],
        blockNo: 1,
        numBlocks: 3,
        familyId: RP2040_FAMILY,
      }),
      // Blocks without a familyID form their own address space.
      uf2Block({
        address: 0xffff_ffff - 475,
        payload: patternBytes(476, 1),
        blockNo: 0,
        numBlocks: 1,
      }),
      uf2Block({
        address: 0x1000_0000,
        payload: [7],
        blockNo: 2,
        numBlocks: 3,
        familyId: RP2040_FAMILY,
      }),
    ]),
  );
  expect(decoded.complete).toBe(true);
  expect(
    decoded.regions.map(({ familyId, start, end }) => [familyId, start, end]),
  ).toEqual([
    [null, 0xffff_fe24, 0xffff_ffff],
    [RP2040_FAMILY, 0x1000_0000, 0x1000_0000],
    [RP2040_FAMILY, 0xffff_fe24, 0xffff_ffff],
  ]);
  expect(decoded.metadata).toMatchObject({
    invalid_block_count: 0,
    flash_block_count: 4,
    family_count: 1,
    numbering_group_count: 2,
  });
});

it("refuses a larger file than its decoder admitted with a typed limit", () => {
  const block = uf2Block({
    address: 0,
    payload: [1],
    blockNo: 0,
    numBlocks: 1,
  });
  const decoder = createUf2Decoder(511);
  if (!decoder.ok) throw new Error(decoder.error.message);
  expect(decoder.value.write(block)).toMatchObject({
    ok: false,
    error: { kind: "limit", boundary: "file-size" },
  });
});

it("refuses files above the fixed ceiling and more regions than retained", () => {
  expect(createUf2Decoder(UF2_MAX_FILE_BYTES + 1)).toMatchObject({
    ok: false,
    error: { kind: "limit", boundary: "file-size" },
  });
  const blocks = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      uf2Block({ address: index * 2, payload: [1], blockNo: 0, numBlocks: 1 }),
    );
  const accepted = decode(uf2File(blocks(65_536)), 512 * 1024);
  if (!accepted.ok) throw new Error(accepted.error.message);
  expect(accepted.value.metadata.region_count).toBe(65_536);
  expect(decode(uf2File(blocks(65_537)), 512 * 1024)).toMatchObject({
    ok: false,
    error: { kind: "limit", boundary: "capacity" },
  });
  // Runs are not capped: blocks in reverse order still merge into one region.
  const reversed = Array.from({ length: 70_000 }, (_, index) =>
    uf2Block({
      address: (69_999 - index) * 4,
      payload: [1, 2, 3, 4],
      blockNo: 0,
      numBlocks: 1,
    }),
  );
  const merged = decode(uf2File(reversed), 512 * 1024);
  if (!merged.ok) throw new Error(merged.error.message);
  expect(merged.value.metadata).toMatchObject({
    region_count: 1,
    data_bytes: 280_000,
  });
});
