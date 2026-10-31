import { z } from "zod";
import { addressCoordinate } from "./addressCoordinate.js";
import { unavailableNativeFactSchema } from "./nativeFactAvailability.js";

/** Complete observed function-body ranges; every range endpoint is inclusive. */
export const availableFunctionBodySchema = z
  .strictObject({
    available: z.literal(true),
    provenance: z.string().min(1),
    ranges: z.array(
      z.strictObject({
        start: z.string(),
        end: z
          .string()
          .describe("Inclusive last address of this observed body range."),
      }),
    ),
    total_bytes: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    span_bytes: z.int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    non_contiguous: z.boolean(),
    contains_entry: z.boolean(),
  })
  .superRefine((body, context) => {
    let total = 0n;
    const bounds = new Map<string | null, { start: bigint; end: bigint }>();
    const closedSpaces = new Set<string | null>();
    let previousSpace: string | null | undefined;
    for (const range of body.ranges) {
      const start = addressCoordinate(range.start);
      const end = addressCoordinate(range.end);
      if (
        start === null ||
        end === null ||
        start.space !== end.space ||
        end.offset < start.offset
      ) {
        context.addIssue({
          code: "custom",
          message: "Function body range has invalid inclusive endpoints",
        });
        return;
      }
      if (previousSpace !== undefined && previousSpace !== start.space)
        closedSpaces.add(previousSpace);
      const previous = bounds.get(start.space);
      if (
        closedSpaces.has(start.space) ||
        (previous !== undefined && start.offset <= previous.end + 1n)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Function body ranges must be ordered, disjoint and maximal within each address space",
        });
        return;
      }
      bounds.set(start.space, {
        start: previous?.start ?? start.offset,
        end: end.offset,
      });
      previousSpace = start.space;
      total += end.offset - start.offset + 1n;
    }
    const onlyBounds = bounds.size === 1 ? [...bounds.values()][0] : undefined;
    const span =
      bounds.size === 0
        ? 0n
        : onlyBounds === undefined
          ? null
          : onlyBounds.end - onlyBounds.start + 1n;
    const reportedSpan =
      body.span_bytes === null ? null : BigInt(body.span_bytes);
    if (
      total !== BigInt(body.total_bytes) ||
      span !== reportedSpan ||
      body.non_contiguous !== body.ranges.length > 1
    )
      context.addIssue({
        code: "custom",
        message:
          "Function body counts, enclosing span or contiguity disagree with inclusive ranges",
      });
  });

export const functionBodySchema = z.discriminatedUnion("available", [
  unavailableNativeFactSchema,
  availableFunctionBodySchema,
]);

/** Check the declared entry membership against complete, inclusive body ranges. */
export const functionBodyEntryAgrees = (
  body: z.infer<typeof functionBodySchema>,
  address: string,
): boolean => {
  if (!body.available) return true;
  const entry = addressCoordinate(address);
  if (entry === null) return false;
  const contains = body.ranges.some((range) => {
    const start = addressCoordinate(range.start);
    const end = addressCoordinate(range.end);
    return (
      start !== null &&
      end !== null &&
      start.space === entry.space &&
      entry.offset >= start.offset &&
      entry.offset <= end.offset
    );
  });
  return contains === body.contains_entry;
};
