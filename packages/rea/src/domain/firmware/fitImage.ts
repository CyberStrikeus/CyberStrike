/**
 * Whether a flattened devicetree prefix declares a top-level /images node, the
 * U-Boot FIT marker. Only the first 4 KiB is walked, so a FIT whose /images
 * node starts later stays a plain devicetree; the FIT reader's full parse
 * remains the authority for everything this probe accepts.
 */
export const hasFitImagesNode = (prefix: Uint8Array): boolean => {
  const bytes = prefix.subarray(0, 4096);
  if (bytes.length < 40) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number): number => view.getUint32(offset);
  const version = u32(20);
  if (u32(0) !== 0xd00dfeed || (version !== 16 && version !== 17)) return false;
  const end = Math.min(bytes.length, u32(4));
  let cursor = u32(8);
  let depth = 0;
  while (cursor <= end - 4) {
    const token = u32(cursor);
    if (token === 1) {
      const nul = bytes.indexOf(0, cursor + 4);
      if (nul < 0 || nul >= end) return false;
      const name = String.fromCharCode(...bytes.subarray(cursor + 4, nul));
      if (depth === 0 && name !== "") return false;
      if (depth === 1 && name === "images") return true;
      depth += 1;
      cursor = Math.ceil((nul + 1) / 4) * 4;
    } else if (token === 2) {
      depth -= 1;
      if (depth <= 0) return false;
      cursor += 4;
    } else if (token === 3) {
      if (cursor > end - 8) return false;
      cursor += Math.ceil((12 + u32(cursor + 4)) / 4) * 4;
    } else if (token === 4) cursor += 4;
    else return false;
  }
  return false;
};
