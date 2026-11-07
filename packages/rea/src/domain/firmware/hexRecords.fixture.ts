const hexByte = (value: number): string =>
  value.toString(16).toUpperCase().padStart(2, "0");

const sum = (bytes: readonly number[]): number =>
  bytes.reduce((total, byte) => total + byte, 0);

/** One Intel HEX record with a computed two's-complement checksum. */
export const intelHexRecord = (
  type: number,
  address: number,
  data: readonly number[] = [],
): string => {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type];
  bytes.push(...data);
  return `:${[...bytes, -sum(bytes) & 0xff].map(hexByte).join("")}`;
};

const SREC_ADDRESS_BYTES: Readonly<Record<number, number>> = {
  0: 2,
  1: 2,
  2: 3,
  3: 4,
  4: 2,
  5: 2,
  6: 3,
  7: 4,
  8: 3,
  9: 2,
};

/** One S-record with a computed ones'-complement checksum. */
export const srecRecord = (
  type: number,
  address: number,
  data: readonly number[] = [],
): string => {
  const width = SREC_ADDRESS_BYTES[type] ?? 2;
  const addressBytes = Array.from(
    { length: width },
    (_, index) => Math.floor(address / 256 ** (width - 1 - index)) & 0xff,
  );
  const bytes = [width + data.length + 1, ...addressBytes, ...data];
  return `S${String(type)}${[...bytes, ~sum(bytes) & 0xff].map(hexByte).join("")}`;
};

const lines = (...records: readonly string[]): string =>
  `${records.join("\n")}\n`;

/** I32HEX with a gap, a start linear address and EOF. */
export const INTEL_HEX_I32_GAP = lines(
  ":020000040800F2",
  ":10000000000102030405060708090A0B0C0D0E0F78",
  ":10001000101112131415161718191A1B1C1D1E1F68",
  ":04010000DEADBEEFC3",
  ":0400000508000101ED",
  ":00000001FF",
);

export const INTEL_HEX_I8 = lines(":0300300002337A1E", ":00000001FF");

export const INTEL_HEX_I16 = lines(
  ":020000021000EC",
  ":04000000A1B2C3D412",
  ":0400000310000000E9",
  ":00000001FF",
);

/** S19 with an S0 header, an S5 count and S9 termination. */
export const SREC_S19 = lines(
  "S00600004844521B",
  "S1130000000102030405060708090A0B0C0D0E0F74",
  "S1130010101112131415161718191A1B1C1D1E1F64",
  "S5030002FA",
  "S9030000FC",
);

export const SREC_S37 = lines("S30908000000DEADBEEFB6", "S70508000101F0");

/** The Wikipedia S19 sample, whose header carries NUL padding. */
export const SREC_WIKIPEDIA = lines(
  "S00F000068656C6C6F202020202000003C",
  "S11F00007C0802A6900100049421FFF07C6C1B787C8C23783C6000003863000026",
  "S11F001C4BFFFFE5398000007D83637880010014382100107C0803A64E800020E9",
  "S111003848656C6C6F20776F726C642E0A0042",
  "S5030003F9",
  "S9030000FC",
);
