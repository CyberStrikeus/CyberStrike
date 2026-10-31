import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import {
  DFUSE_MAX_FILE_BYTES,
  createDfuSeDecoder,
  isDfuSeFile,
  type DfuSeImage,
} from "./dfuse.js";
import { dfuseFile, type DfuSeFixture } from "./dfuse.fixture.js";

const decode = (bytes: Uint8Array, chunkSize = 64) => {
  const decoder = createDfuSeDecoder(bytes.length);
  if (!decoder.ok) throw new Error(decoder.error.message);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const written = decoder.value.write(
      bytes.subarray(offset, offset + chunkSize),
    );
    if (!written.ok) return written;
  }
  return decoder.value.finish();
};

const image = (bytes: Uint8Array): DfuSeImage => {
  const decoded = decode(bytes);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return decoded.value;
};

const recognized = (bytes: Uint8Array): boolean =>
  isDfuSeFile(bytes.subarray(0, 4096), bytes.subarray(-16), bytes.length);

const elementFacts = ({ elements }: DfuSeImage) =>
  elements.map(({ bytes, ...facts }) => ({ ...facts, length: bytes.length }));

/** One 16-byte image at 0x08000000 in target "ST...", as the packers below write it. */
const DFUSE_PACK_EQUIVALENT: DfuSeFixture = {
  targets: [
    {
      alternateSetting: 0,
      name: "ST...",
      elements: [{ address: 0x0800_0000, data: [...Array(16).keys()] }],
    },
  ],
  deviceVersion: 0,
};

it("decodes files packed with and without the suffix in DFUImageSize", () => {
  // Oracle: build() and compute_crc() of dfu-util's dfuse-pack.py at f9a537c9,
  // transcribed and run under Python 3. Since ee6b393d it writes DFUImageSize
  // as PREFIX_SIZE + len(data) + SUFFIX_SIZE, the whole file.
  const packed = dfuseFile({
    ...DFUSE_PACK_EQUIVALENT,
    imageSizeIncludesSuffix: true,
  });
  expect(createHash("sha256").update(packed).digest("hex")).toBe(
    "4d9f8c231291504484745f0b0586031c8f804d141e964cb33a9b82965f8a69d0",
  );
  expect(image(packed).metadata).toMatchObject({
    image_size: 325,
    suffix_crc: 0x2c4c_4f44,
    computed_crc: 0x2c4c_4f44,
  });
  const bytes = dfuseFile(DFUSE_PACK_EQUIVALENT);
  // Oracle: build() and compute_crc() of MicroPython's tools/dfu.py at
  // cb99ca98, transcribed and run under Python 3. It writes len(data) + 11,
  // leaving the suffix out, as dfuse-pack.py did before ee6b393d.
  expect(bytes.length).toBe(325);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "65ad96452f1f82cc8b44d30dfe94f268f4fd230a32b30a8826a639b269f7034d",
  );
  const decoded = image(bytes);
  expect(decoded.metadata).toEqual({
    kind: "dfuse",
    image_size: 309,
    target_count: 1,
    element_count: 1,
    empty_element_count: 0,
    overlapping_element_count: 0,
    data_bytes: 16,
    device_version: 0,
    product_id: 0xdf11,
    vendor_id: 0x0483,
    suffix_crc: 0x7a37_11da,
    computed_crc: 0x7a37_11da,
  });
  expect(elementFacts(decoded)).toEqual([
    {
      targetIndex: 0,
      alternateSetting: 0,
      targetName: "ST...",
      elementIndex: 0,
      address: 0x0800_0000,
      dataOffset: 293,
      length: 16,
    },
  ]);
  expect(decoded.limitations).toEqual([]);
});

it("keeps each target's alternate setting and name on its elements", () => {
  const decoded = image(
    dfuseFile({
      targets: [
        {
          alternateSetting: 0,
          name: "Internal Flash",
          elements: [
            { address: 0x0800_0000, data: [1, 2, 3, 4] },
            { address: 0x0800_4000, data: [5, 6] },
          ],
        },
        {
          alternateSetting: 1,
          elements: [{ address: 0x1fff_c000, data: [0xaa, 0x55] }],
        },
        {
          alternateSetting: 2,
          name: Uint8Array.from([0x4f, 0xe9, 0, 0x58]),
          elements: [{ address: 0x1fff_7800, data: [] }],
        },
      ],
    }),
  );
  expect(
    decoded.elements.map((element) => [
      element.targetIndex,
      element.alternateSetting,
      element.targetName,
      element.elementIndex,
      element.address,
      [...element.bytes],
    ]),
  ).toEqual([
    [0, 0, "Internal Flash", 0, 0x0800_0000, [1, 2, 3, 4]],
    [0, 0, "Internal Flash", 1, 0x0800_4000, [5, 6]],
    [1, 1, null, 0, 0x1fff_c000, [0xaa, 0x55]],
  ]);
  expect(decoded.metadata).toMatchObject({
    target_count: 3,
    element_count: 4,
    empty_element_count: 1,
    data_bytes: 8,
  });
  // A named target's field is read to its first NUL, one character per byte.
  const named = image(
    dfuseFile({
      targets: [
        {
          alternateSetting: 3,
          name: Uint8Array.from([0x4f, 0xe9, 0, 0x58]),
          elements: [{ address: 0, data: [1] }],
        },
      ],
    }),
  );
  expect(named.elements[0]?.targetName).toBe("Oé");
});

it("reports a suffix CRC mismatch as facts without refusing the file", () => {
  const decoded = image(dfuseFile({ ...DFUSE_PACK_EQUIVALENT, crc: 0 }));
  expect(decoded.metadata).toMatchObject({
    suffix_crc: 0,
    computed_crc: 0x7a37_11da,
  });
  expect(decoded.elements).toHaveLength(1);
});

it("names overlapping elements within one alternate setting only", () => {
  const decoded = image(
    dfuseFile({
      targets: [
        {
          alternateSetting: 0,
          elements: [
            { address: 0x0800_0000, data: [1, 2, 3, 4] },
            { address: 0x0800_0002, data: [3, 4] },
          ],
        },
        {
          alternateSetting: 1,
          elements: [{ address: 0x0800_0000, data: [9] }],
        },
        {
          alternateSetting: 0,
          elements: [{ address: 0x0800_0003, data: [4, 5] }],
        },
      ],
    }),
  );
  expect(decoded.metadata.overlapping_element_count).toBe(2);
  expect(decoded.limitations).toEqual([
    "2 DfuSe element(s) overlap an earlier element of the same alternate setting; each stays a separate entry and no bytes were merged: target 0 element 1 (0x08000002-0x08000003) overlaps target 0 element 0 (0x08000000-0x08000003) in alternate setting 0; target 2 element 0 (0x08000003-0x08000004) overlaps target 0 element 0 (0x08000000-0x08000003) in alternate setting 0.",
  ]);
});

it("accepts boundary declarations beside the malformed ones", () => {
  // A valid file may hold no targets at all.
  expect(image(dfuseFile({ targets: [] })).metadata).toMatchObject({
    image_size: 11,
    target_count: 0,
    element_count: 0,
  });
  const name = Uint8Array.from({ length: 255 }, () => 0x41);
  const decoded = image(
    dfuseFile({
      targets: [
        {
          alternateSetting: 4,
          // A name filling all 255 bytes has no NUL.
          name,
          elements: [
            // An element may end exactly at the top of the address space.
            { address: 0xffff_fffe, data: [1, 2] },
            { address: 0x2000_0000, data: [] },
          ],
        },
        { alternateSetting: 5, elements: [] },
      ],
    }),
  );
  expect(decoded.elements.map((element) => element.targetName)).toEqual([
    "A".repeat(255),
  ]);
  expect(decoded.metadata).toMatchObject({
    target_count: 2,
    element_count: 2,
    empty_element_count: 1,
  });
  expect(decoded.limitations).toEqual([
    "DfuSe declarations without bytes have no entry: target 0 element 1 at 0x20000000 (alternate setting 4) holds no bytes; target 1 (alternate setting 5) declares no elements.",
  ]);
});

it("recognizes a file only by the DfuSe prefix together with the DFU suffix", () => {
  const bytes = dfuseFile(DFUSE_PACK_EQUIVALENT);
  expect(recognized(bytes)).toBe(true);
  const changed = (offset: number, value: number): Buffer => {
    const copy = Buffer.from(bytes);
    copy[offset] = value;
    return copy;
  };
  expect(recognized(changed(5, 2))).toBe(false);
  expect(recognized(changed(0, 0x64))).toBe(false);
  expect(recognized(changed(bytes.length - 10, 0x00))).toBe(false);
  expect(recognized(changed(bytes.length - 8, 0x58))).toBe(false);
  expect(recognized(changed(bytes.length - 5, 15))).toBe(false);
  expect(recognized(bytes.subarray(0, bytes.length - 1))).toBe(false);
  // The CRC is checked after recognition, so a mismatch still recognizes.
  expect(recognized(dfuseFile({ ...DFUSE_PACK_EQUIVALENT, crc: 1 }))).toBe(
    true,
  );
});

it.each([
  [
    "a target without its signature",
    {
      targets: [{ alternateSetting: 0, signature: "Tarxet", elements: [] }],
    },
    'byte offset 11: target 0 does not begin with the "Target" signature',
  ],
  [
    "an element larger than its target",
    {
      targets: [
        {
          alternateSetting: 0,
          elements: [{ address: 0, data: [1, 2], declaredSize: 3 }],
        },
      ],
    },
    "byte offset 289: target 0 element 0 declares 3 bytes, but its target ends at byte 295",
  ],
  [
    "a target larger than the image",
    {
      targets: [
        {
          alternateSetting: 0,
          declaredSize: 100,
          elements: [{ address: 0, data: [1] }],
        },
      ],
    },
    "byte offset 277: target 0 declares 100 bytes, but the image ends at byte 294",
  ],
  [
    "fewer elements than the target size",
    {
      targets: [
        {
          alternateSetting: 0,
          declaredElements: 0,
          elements: [{ address: 0, data: [1] }],
        },
      ],
    },
    "byte offset 285: target 0 declares 9 bytes, but its 0 element(s) end 9 bytes earlier",
  ],
  [
    "an image size that matches neither packer convention",
    { targets: [], imageSize: 12 },
    "byte offset 6: DFUImageSize declares 12 bytes, but the DFU suffix begins at byte 11 and the file holds 27 bytes; the suffix CRC matches the file",
  ],
  [
    "bytes between the last target and the suffix",
    { targets: [], gap: Uint8Array.from([0]) },
    "byte offset 11: 0 target(s) end at byte 11, but the DFU suffix begins at byte 12",
  ],
  [
    "more targets than the image holds",
    { targets: [], declaredTargets: 1 },
    "byte offset 11: target 0 prefix needs 274 bytes, but the image ends at byte 11",
  ],
  [
    "more elements than the target holds",
    {
      targets: [
        {
          alternateSetting: 0,
          declaredElements: 2,
          elements: [{ address: 0, data: [1] }],
        },
      ],
    },
    "byte offset 294: target 0 element 1 header lies beyond the target's end at byte 294",
  ],
  [
    "an element that wraps the address space",
    {
      targets: [
        {
          alternateSetting: 0,
          elements: [{ address: 0xffff_ffff, data: [1, 2] }],
        },
      ],
    },
    "byte offset 285: target 0 element 0 at 0xffffffff with 2 bytes wraps past 0xffffffff",
  ],
] as const)("refuses %s with its byte offset", (_name, fixture, message) => {
  expect(decode(dfuseFile(fixture))).toEqual({
    ok: false,
    error: { kind: "format", message },
  });
});

it("refuses files above the fixed ceiling and more elements than retained", () => {
  expect(createDfuSeDecoder(DFUSE_MAX_FILE_BYTES + 1)).toMatchObject({
    ok: false,
    error: { kind: "limit", boundary: "file-size" },
  });
  const elements = (count: number, data: readonly number[]) =>
    Array.from({ length: count }, (_, index) => ({
      address: index * 2,
      data,
    }));
  const accepted = decode(
    dfuseFile({
      targets: [{ alternateSetting: 0, elements: elements(65_536, [1]) }],
    }),
    1 << 20,
  );
  if (!accepted.ok) throw new Error(accepted.error.message);
  expect(accepted.value.elements).toHaveLength(65_536);
  expect(
    decode(
      dfuseFile({
        targets: [{ alternateSetting: 0, elements: elements(65_537, [1]) }],
      }),
      1 << 20,
    ),
  ).toMatchObject({
    ok: false,
    error: { kind: "limit", boundary: "capacity" },
  });
});

it("counts empty elements past the entry cap and names only the first four", () => {
  // Empty elements have no entry, so they are not capped; 8 header bytes each
  // let a file hold millions, and only a count and four descriptions are kept.
  const empty = Array.from({ length: 65_537 }, (_, index) => ({
    address: index * 2,
    data: [],
  }));
  const decoded = decode(
    dfuseFile({
      targets: [
        { alternateSetting: 0, elements: empty },
        { alternateSetting: 1, elements: [] },
      ],
    }),
    1 << 20,
  );
  if (!decoded.ok) throw new Error(decoded.error.message);
  expect(decoded.value.elements).toEqual([]);
  expect(decoded.value.metadata).toMatchObject({
    element_count: 65_537,
    empty_element_count: 65_537,
    data_bytes: 0,
  });
  expect(decoded.value.limitations).toEqual([
    "DfuSe declarations without bytes have no entry: target 0 element 0 at 0x00000000 (alternate setting 0) holds no bytes; target 0 element 1 at 0x00000002 (alternate setting 0) holds no bytes; target 0 element 2 at 0x00000004 (alternate setting 0) holds no bytes; target 0 element 3 at 0x00000006 (alternate setting 0) holds no bytes; and 65534 more.",
  ]);
});
