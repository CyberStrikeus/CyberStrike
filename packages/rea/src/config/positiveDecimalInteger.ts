import { z } from "zod";

const decimalInteger = /^[1-9]\d*$/u;

/** Preserve exact decimal bounds before conversion to a runtime number. */
export const positiveDecimalIntegerSchema = (
  minimum: number,
  maximum: number,
  constraint: string,
) =>
  z
    .string()
    .regex(decimalInteger, { error: constraint })
    .refine(
      (value) => {
        // The pattern owns malformed input; range checks only interpret integers.
        if (!decimalInteger.test(value)) return true;
        const parsed = BigInt(value);
        return parsed >= BigInt(minimum) && parsed <= BigInt(maximum);
      },
      { error: constraint },
    )
    .transform(Number);
