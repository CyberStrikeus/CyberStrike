import { numberValue } from "./CdpCaptureValues.js";

// DOMSnapshot interns an empty or null string as index -1 instead of a table
// entry. Chrome uses it for element node values and empty attribute values.
const CDP_EMPTY_STRING_INDEX = -1;

/** Resolve a DOMSnapshot name index, which must reference a string entry. */
export const cdpSnapshotString = (
  strings: readonly (string | undefined)[],
  index: unknown,
): string | undefined => {
  const integer = numberValue(index);
  if (integer === undefined || !Number.isSafeInteger(integer) || integer < 0)
    return undefined;
  return strings[integer];
};

/** Resolve a DOMSnapshot value index, where -1 is the protocol's empty string. */
export const cdpSnapshotValueString = (
  strings: readonly (string | undefined)[],
  index: unknown,
): string | undefined =>
  numberValue(index) === CDP_EMPTY_STRING_INDEX
    ? ""
    : cdpSnapshotString(strings, index);
