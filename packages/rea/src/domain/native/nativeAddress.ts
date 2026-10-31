import { z } from "zod";

/** Observed hexadecimal coordinate; preserve padding and encoded space spelling. */
export const nativeAddressObservationSchema = z
  .string()
  .regex(/^(?:(?:[A-Za-z0-9._~\x2d]|%[0-9A-F]{2})+:)?0x[0-9a-f]+$/u);

/** Canonical hexadecimal coordinate, retaining its optional address space. */
export const nativeAddressSchema = z
  .string()
  .regex(
    /^(?:(?:[A-Za-z0-9._~\x2d]|%[0-9A-F]{2})+:)?0x(?:0|[1-9a-f][0-9a-f]*)$/u,
  );

/** Parse caller coordinates once, retaining address-space identity and numeric offset. */
export const nativeAddressCoordinateInputSchema = z
  .string()
  .regex(/^(?:(?:[A-Za-z0-9._~\x2d]|%[0-9a-fA-F]{2})+:)?0[xX][0-9a-fA-F]+$/u)
  .transform((address) => {
    const separator = address.lastIndexOf(":") + 1;
    const space =
      separator === 0
        ? null
        : address
            .slice(0, separator - 1)
            .replace(/%[0-9a-fA-F]{2}/gu, (escape) => escape.toUpperCase());
    return {
      space,
      offset: BigInt(address.slice(separator)),
    };
  });

/** Accept equivalent hexadecimal spellings without changing address-space identity. */
export const nativeAddressInputSchema =
  nativeAddressCoordinateInputSchema.transform(
    ({ space, offset }) =>
      `${space === null ? "" : `${space}:`}0x${offset.toString(16)}`,
  );
