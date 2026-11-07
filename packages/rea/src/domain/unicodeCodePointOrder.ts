/** Compare strings lexicographically by Unicode code point, independent of locale. */
export const compareUnicodeCodePoints = (
  left: string,
  right: string,
): number => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex) ?? 0;
    const rightPoint = right.codePointAt(rightIndex) ?? 0;
    const difference = leftPoint - rightPoint;
    if (difference !== 0) return difference;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
};

/**
 * Collision-free composite key for deduplication/sorting. `\0`-joins
 * collide when any component contains NUL (valid in JS property names);
 * a JSON tuple escapes every component. Single owner for composite keys.
 */
export const compositeKey = (parts: readonly unknown[]): string =>
  JSON.stringify(parts);
