/** Find a cycle in positional declaring-type links, yielding during long walks. */
export function* firstDeclaringTypeCycle(
  types: readonly { readonly declaring_type: number }[],
): Generator<void, number | null> {
  // 0 unvisited, 1 on the current chain, 2 already examined.
  const state = new Uint8Array(types.length);
  let work = 0;
  for (let first = 0; first < types.length; first += 1) {
    if (work++ % 256 === 0) yield;
    const chain: number[] = [];
    let current = first;
    while (current >= 0 && current < types.length && state[current] === 0) {
      if (work++ % 256 === 0) yield;
      state[current] = 1;
      chain.push(current);
      current = types[current]!.declaring_type;
    }
    if (current >= 0 && current < types.length && state[current] === 1)
      return current;
    for (const index of chain) {
      if (work++ % 256 === 0) yield;
      state[index] = 2;
    }
  }
  return null;
}
