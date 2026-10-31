/** A filesystem basename is usable as a logical path only after UTF-8 validity is established. */
export type DirectoryEntryName =
  | { readonly kind: "decoded"; readonly name: string }
  | { readonly kind: "unrepresentable"; readonly rawHex: string };

/** Decode POSIX directory-entry bytes without allowing replacement-character aliases. */
export const decodeDirectoryEntryName = (
  raw: string | Buffer,
): DirectoryEntryName => {
  if (typeof raw === "string") return { kind: "decoded", name: raw };
  const name = raw.toString("utf8");
  return Buffer.from(name, "utf8").equals(raw)
    ? { kind: "decoded", name }
    : { kind: "unrepresentable", rawHex: raw.toString("hex") };
};
