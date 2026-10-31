/** Branching inert selectors exceed precise alias work without target execution. */
export const aliasSelectionBudgetSource = (): string => {
  const source = ["const a0 = {};"];
  for (let index = 1; index <= 30; index++)
    source.push(
      `const a${index} = flag ? a${index - 1}?.x : a${index - 1}?.y;`,
    );
  source.push('a30?.require("./shared.cjs");');
  return source.join("\n");
};
