/** Node package patterns contain one star matching at least one character. */
export const packageSubpathPatternMatches = (
  pattern: string,
  subpath: string,
): boolean => {
  const wildcard = pattern.indexOf("*");
  return (
    wildcard !== -1 &&
    pattern.lastIndexOf("*") === wildcard &&
    subpath.length >= pattern.length &&
    subpath.startsWith(pattern.slice(0, wildcard)) &&
    subpath.endsWith(pattern.slice(wildcard + 1))
  );
};

/** Node chooses the longest prefix, then the longest complete pattern key. */
export const selectPackageSubpathPattern = (
  patterns: readonly string[],
  subpath: string,
): string | undefined => {
  let selected: string | undefined;
  for (const pattern of patterns) {
    if (!packageSubpathPatternMatches(pattern, subpath)) continue;
    if (
      selected === undefined ||
      pattern.indexOf("*") > selected.indexOf("*") ||
      (pattern.indexOf("*") === selected.indexOf("*") &&
        pattern.length > selected.length)
    )
      selected = pattern;
  }
  return selected;
};
