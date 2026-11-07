import type { PeImage } from "../metadata/PeImage.js";

/**
 * Prove that a successful native read sees the same bytes as pefile 2024.8.26.
 * pefile adjusts section addresses/raw pointers and clips each read at its
 * selected section's raw end. Native mappings can legitimately span sections.
 * Unsupported layout geometry leaves hash compatibility unknown, without
 * discarding the native parser's observations.
 */
export const createPefileReadCompatibility = (
  image: PeImage,
  fileBytes: number,
): ((rva: number, size: number, offset: number) => boolean) => {
  // pefile's section loop stops at MAX_SECTIONS, even when later mappings
  // are structurally readable. It may also stop at a null/suspicious header.
  if (image.sections.length > 0x800) return () => false;
  const sections = [...image.sections].sort(
    (left, right) => left.virtual_address - right.virtual_address,
  );
  const alignment =
    image.pe_section_alignment < 0x1000
      ? image.pe_file_alignment
      : image.pe_section_alignment;
  let layoutAgrees = true;
  let previousEnd = 0;
  for (const section of sections) {
    const start = section.virtual_address;
    const emptyHeader =
      section.name === "" &&
      start === 0 &&
      section.virtual_size === 0 &&
      section.raw_size === 0 &&
      section.raw_offset === 0 &&
      section.characteristics === 0;
    const sectionWarnings =
      Number(section.raw_offset + section.raw_size > fileBytes) +
      Number(Math.floor(section.raw_offset / 512) * 512 > fileBytes) +
      Number(section.virtual_size > 0x10000000) +
      Number(start > 0x10000000) +
      Number(
        image.pe_file_alignment !== 0 &&
          section.raw_offset % image.pe_file_alignment !== 0,
      );
    if (
      emptyHeader ||
      sectionWarnings >= 3 ||
      (alignment > 0 && start % alignment !== 0) ||
      section.raw_offset % 0x200 !== 0 ||
      start < previousEnd
    )
      layoutAgrees = false;
    previousEnd = start + Math.max(section.raw_size, section.virtual_size);
  }
  return (rva, size, offset) => {
    if (!layoutAgrees) return false;
    let low = 0;
    let high = sections.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((sections[middle]?.virtual_address ?? Infinity) <= rva)
        low = middle + 1;
      else high = middle;
    }
    const section = sections[low - 1];
    if (
      section === undefined ||
      rva >=
        section.virtual_address +
          Math.max(section.raw_size, section.virtual_size)
    )
      return offset === rva;
    const relative = rva - section.virtual_address;
    return (
      offset === section.raw_offset + relative &&
      size <= section.raw_size - relative
    );
  };
};
