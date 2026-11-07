/** Preserve stored bytes; undecodable targets have no invented text spelling. */
export const observedSymlinkTarget = (
  raw: Buffer,
): { text: string | null; hex: string } => {
  const decoded = raw.toString("utf8");
  return {
    text: Buffer.from(decoded, "utf8").equals(raw) ? decoded : null,
    hex: raw.toString("hex"),
  };
};
