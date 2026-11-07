import { digestCanonicalValue } from "./canonicalDigest.js";

/** Retain short exact string keys or commit their value in a reserved digest namespace. */
export const compactStringIdentityKey = (value: string): string => {
  const prefix = "value-sha256:";
  const digestKey = `${prefix}${digestCanonicalValue(value, "String identity")}`;
  return value.length <= digestKey.length && !value.startsWith(prefix)
    ? value
    : digestKey;
};
