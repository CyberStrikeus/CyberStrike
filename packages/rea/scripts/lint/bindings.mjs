/** Resolve the lexical binding instead of treating a matching name as an API. */
export const findBinding = (sourceCode, identifier) => {
  for (
    let scope = sourceCode.getScope(identifier);
    scope !== null;
    scope = scope.upper
  ) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
};
