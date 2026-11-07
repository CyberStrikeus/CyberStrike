/** JavaScript positions use one-based lines and zero-based UTF-16 columns. */
export interface WebSourcePosition {
  readonly line: number;
  readonly column: number;
}

/** Verify a selected position against actual text without splitting the whole source. */
export const webSourceOffset = (
  text: string,
  position: WebSourcePosition,
): number | undefined => {
  if (
    !Number.isSafeInteger(position.line) ||
    position.line < 1 ||
    !Number.isSafeInteger(position.column) ||
    position.column < 0
  )
    return undefined;
  let line = 1;
  let start = 0;
  for (const boundary of text.matchAll(/\r\n?|\n|\u2028|\u2029/gu)) {
    if (line === position.line)
      return position.column <= boundary.index - start
        ? start + position.column
        : undefined;
    line += 1;
    start = boundary.index + boundary[0].length;
  }
  return line === position.line && position.column <= text.length - start
    ? start + position.column
    : undefined;
};
