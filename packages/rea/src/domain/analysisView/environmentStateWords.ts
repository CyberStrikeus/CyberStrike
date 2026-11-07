/** An identifier's words in lower case: split at every run of other characters and at each lower-to-upper case step (`sortKey`, `has_more`, `query-history`). */
export const identifierWords = (text: string): string[] =>
  text
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
