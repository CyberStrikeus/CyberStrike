/** Replace caller-declared literal text values without guessing sensitivity from names. */
export const redactExplicitText = (
  value: string,
  sensitiveValues: readonly string[],
): string => {
  const literals = [...new Set(sensitiveValues)].filter(
    (literal) => literal !== "",
  );
  const replacement =
    ["[REDACTED]", "…", ""].find((candidate) =>
      literals.every((literal) => !candidate.includes(literal)),
    ) ?? "";
  let result = value;
  for (const literal of literals.sort(
    (left, right) => right.length - left.length,
  ))
    result = result.replaceAll(literal, replacement);
  // Replacement boundaries can form another declaration; exclude that text.
  return literals.some((literal) => result.includes(literal)) ? "" : result;
};
