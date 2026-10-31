/** Most unrecognized output lines a parser retains as source evidence. */
export const UNPARSED_LINE_SAMPLE_LIMIT = 10;

/**
 * Unrecognized output lines one parser observed: the first lines verbatim, up
 * to {@link UNPARSED_LINE_SAMPLE_LIMIT}, and the exact number observed.
 */
export interface AdbUnparsedLines {
  readonly sample: readonly string[];
  readonly total: number;
}

/** Accumulate unrecognized lines without retaining more than the sample. */
export const collectUnparsedLines = (): {
  add: (line: string) => void;
  facts: () => AdbUnparsedLines;
} => {
  const sample: string[] = [];
  let total = 0;
  return {
    add: (line) => {
      total += 1;
      if (sample.length < UNPARSED_LINE_SAMPLE_LIMIT) sample.push(line);
    },
    facts: () => ({ sample, total }),
  };
};
