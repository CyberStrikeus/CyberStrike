import { estimateTokenCount } from "tokenx";

export interface TokenWindow {
  readonly text: string;
  readonly total: number;
  readonly start: number;
  readonly end: number;
  readonly truncated: boolean;
}

// tokenx 1.3.0 uses this split expression before estimating and slicing.
// Its public API does not expose the segments, so retain the same boundaries
// here while mapping both ends of each segment to a disjoint text range.
const TOKEN_SPLIT_PATTERN = /(\s+|[.,!?;(){}[\]<>:/\\|@#$%^&*+=`~_-]+)/;

const codePointSafeBoundary = (text: string, offset: number): number =>
  offset > 0 &&
  offset < text.length &&
  text.charCodeAt(offset - 1)! >= 0xd800 &&
  text.charCodeAt(offset - 1)! <= 0xdbff &&
  text.charCodeAt(offset)! >= 0xdc00 &&
  text.charCodeAt(offset)! <= 0xdfff
    ? offset - 1
    : offset;

const segmentBoundary = (
  segment: string,
  tokenOffset: number,
  tokenCount: number,
): number =>
  codePointSafeBoundary(
    segment,
    Math.floor((tokenOffset / tokenCount) * segment.length),
  );

/** Slice an approximate token range without overlapping pages or splitting a surrogate pair. */
export const sliceTextByTokenWindow = (
  text: string,
  offset: number,
  limit: number | undefined,
): TokenWindow => {
  const total = estimateTokenCount(text);
  const end = limit === undefined ? total : offset + limit;
  if (offset === 0 && end >= total)
    return { text, total, start: 0, end: total, truncated: false };

  const actualEnd = Math.min(end, total);
  if (offset >= actualEnd)
    return {
      text: "",
      total,
      start: actualEnd,
      end: actualEnd,
      truncated: true,
    };

  const parts: string[] = [];
  let tokenPosition = 0;
  for (const segment of text.split(TOKEN_SPLIT_PATTERN).filter(Boolean)) {
    if (tokenPosition >= actualEnd && actualEnd < total) break;
    const tokenCount = estimateTokenCount(segment);
    if (tokenCount === 0) {
      if (
        tokenPosition >= offset &&
        (tokenPosition < actualEnd || actualEnd === total)
      )
        parts.push(segment);
      continue;
    }

    const segmentEnd = tokenPosition + tokenCount;
    if (tokenPosition < actualEnd && segmentEnd > offset) {
      const localStart = Math.max(0, offset - tokenPosition);
      const localEnd = Math.min(tokenCount, actualEnd - tokenPosition);
      const charStart = segmentBoundary(segment, localStart, tokenCount);
      const charEnd = segmentBoundary(segment, localEnd, tokenCount);
      parts.push(segment.slice(charStart, charEnd));
    }
    tokenPosition = segmentEnd;
  }

  return {
    text: parts.join(""),
    total,
    start: offset,
    end: actualEnd,
    truncated: true,
  };
};
