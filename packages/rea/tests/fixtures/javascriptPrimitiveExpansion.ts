/** Independent unknown host inputs keep both conditional arms reachable. */
export const primitiveCandidateExpansionExpression = (): string =>
  Array.from(
    { length: 20 },
    (_, index) => `(globalThis.choice${String(index)} ? "a" : "b")`,
  ).join(" + ");

/** Source whose repeated doubling exceeds derived primitive string storage. */
export const primitiveByteExpansionSource = (): string => {
  const declarations = ['const value0 = "x";'];
  for (let index = 1; index <= 30; index += 1) {
    const previous = `value${String(index - 1)}`;
    declarations.push(
      `const value${String(index)} = ${previous} + ${previous};`,
    );
  }
  declarations.push("const answer = value30;");
  return declarations.join("\n");
};
