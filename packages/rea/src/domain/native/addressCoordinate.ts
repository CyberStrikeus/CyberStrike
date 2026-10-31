import {
  nativeAddressCoordinateInputSchema,
  nativeAddressObservationSchema,
} from "./nativeAddress.js";

// Observations retain their stricter spelling contract, including encoded spaces.
const observedCoordinateSchema = nativeAddressObservationSchema.pipe(
  nativeAddressCoordinateInputSchema,
);

/** Parse observed native offsets without discarding their address space. */
export const addressCoordinate = (
  value: string,
): { readonly space: string | null; readonly offset: bigint } | null => {
  const parsed = observedCoordinateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Return a bounded byte distance between canonical addresses in one space. */
export const addressDistance = (start: string, end: string): number | null => {
  const left = addressCoordinate(start);
  const right = addressCoordinate(end);
  if (left === null || right === null || left.space !== right.space)
    return null;
  const distance = right.offset - left.offset;
  if (distance < 0n || distance > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(distance);
};
