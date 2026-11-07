/** Page literal LF-separated display lines without interpreting annotation semantics. */
export const windowAnnotationText = (
  text: string,
  offset: number,
  limit: number | null,
) => {
  let total = 0;
  let returned = 0;
  let start = text.length;
  let end = text.length;
  for (let from = 0; from < text.length;) {
    const newline = text.indexOf("\n", from);
    const next = newline < 0 ? text.length : newline + 1;
    if (total === offset) start = from;
    if (total >= offset && (limit === null || returned < limit)) {
      end = next;
      returned++;
    }
    total++;
    from = next;
  }
  return {
    // Copy partial windows so retained Evidence does not retain the full producer
    // string. UTF-16 preserves every source code unit, including lone surrogates.
    annotations_text:
      start === 0 && end === text.length
        ? text
        : Buffer.from(text.slice(start, end), "utf16le").toString("utf16le"),
    output_window: {
      total_lines: total,
      returned_lines: returned,
      has_more: Math.min(offset, total) + returned < total,
    },
  };
};
