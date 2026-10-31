/** Serialized plist UID identity is separate from an ordinary dictionary's keys. */
const plistUidValues = new WeakMap<object, number | undefined>();

/** Decoders mark every dictionary with its format-defined reference identity. */
export const markPlistDictionary = (value: object, uid?: number): void => {
  plistUidValues.set(value, uid);
};

/** Preserve source identity when a projection rebuilds dictionaries. */
export const copyPlistUidIdentity = (
  source: object,
  projected: object,
): void => {
  if (plistUidValues.has(source))
    plistUidValues.set(projected, plistUidValues.get(source));
};

/** Source identity takes precedence over Foundation's XML CF$UID convention. */
export const plistUidValue = (value: unknown): number | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  if (plistUidValues.has(value)) return plistUidValues.get(value);
  const fields = Object.keys(value);
  if (fields.length !== 1) return undefined;
  const key = fields[0];
  if (key !== "CF$UID") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === "number" ? descriptor.value : undefined;
};
