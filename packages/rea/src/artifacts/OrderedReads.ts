type Settled<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: unknown };

/**
 * Overlap independent reads with an enumeration while consuming their results
 * in enumeration order. `read` returns undefined for items it skips. At most
 * `width` reads are in flight. A failure is reported as a one-at-a-time loop
 * would report it: an earlier item's read or consume failure wins over a
 * later read failure or an enumeration failure. Every started read settles
 * before this returns or throws, and an enumeration left early is closed as
 * `for await` would close it.
 */
export const consumeWithOrderedReads = async <Item, Value>(
  items: AsyncIterable<Item>,
  width: number,
  read: (item: Item) => Promise<Value> | undefined,
  consume: (item: Item, value: Value) => Promise<void>,
): Promise<void> => {
  const pending: {
    readonly item: Item;
    readonly result: Promise<Settled<Value>>;
  }[] = [];
  const consumeNext = async (): Promise<void> => {
    const next = pending.shift();
    if (next === undefined) return;
    const result = await next.result;
    if (!result.ok) throw result.error;
    await consume(next.item, result.value);
  };
  const iterator = items[Symbol.asyncIterator]();
  let iterating = true;
  try {
    while (iterating) {
      let step: IteratorResult<Item>;
      try {
        step = await iterator.next();
      } catch (cause: unknown) {
        iterating = false;
        while (pending.length > 0) await consumeNext();
        throw cause;
      }
      if (step.done === true) {
        iterating = false;
        break;
      }
      const started = read(step.value);
      if (started === undefined) continue;
      pending.push({
        item: step.value,
        result: started.then(
          (value) => ({ ok: true, value }) as const,
          (error: unknown) => ({ ok: false, error }) as const,
        ),
      });
      if (pending.length >= width) await consumeNext();
    }
    while (pending.length > 0) await consumeNext();
  } finally {
    if (iterating) await iterator.return?.().catch(() => undefined);
    await Promise.all(pending.map(({ result }) => result));
  }
};
