import { z } from "zod";

/** Fixed tuples with explicit item and length constraints in JSON Schema. */
export const fixedTupleSchema = <
  const Items extends readonly [z.ZodType, ...z.ZodType[]],
>(
  items: Items,
): z.ZodTuple<Items, z.ZodUnion<Items>> =>
  // Keep the positional schemas and lengths explicit. The union rest schema
  // gives clients that only understand `items` useful element guidance; the
  // exact maximum length means no rest element can be accepted.
  z
    .tuple(items, z.union(items))
    .check(z.minLength(items.length), z.maxLength(items.length));
