/** Parse the major release only when the complete macOS probe is a dotted numeric version. */
export const macosMajorVersion = (
  version: string | undefined,
): number | undefined => {
  if (version === undefined) return undefined;
  const match = /^\d+(?:\.\d+)*/u.exec(version);
  if (match?.[0] !== version) return undefined;
  const major = Number(version.split(".")[0]);
  return Number.isSafeInteger(major) ? major : undefined;
};
