import { UNPARSED_LINE_SAMPLE_LIMIT } from "./AdbUnparsedLines.js";

/** Retain the first diagnostic facts and exact count without copying command output. */
export const collectNumericIssues = <Issue>() => {
  const sample: Issue[] = [];
  let total = 0;
  return {
    add: (issue: Issue) => {
      total += 1;
      if (sample.length < UNPARSED_LINE_SAMPLE_LIMIT) sample.push(issue);
    },
    append: (issues: {
      readonly sample: readonly Issue[];
      readonly total: number;
    }) => {
      total += issues.total;
      for (const issue of issues.sample) {
        if (sample.length === UNPARSED_LINE_SAMPLE_LIMIT) break;
        sample.push(issue);
      }
    },
    facts: () => ({ sample, total }),
  };
};
