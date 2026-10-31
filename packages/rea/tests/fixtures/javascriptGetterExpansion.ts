/** Dynamic receiver keys enumerate permutations of these getter names. */
export const getterExpansionSource = (count = 10): string => `
  const shared = { value: 1 };
  class Request {
    ${Array.from(
      { length: count },
      (_, index) => `get field${index}() { return this[key].field${index}; }`,
    ).join("\n")}
    get state() { return shared; }
  }
  consume(new Request().field0);
  const result = shared.value;
`;
