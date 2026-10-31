import { describe, expect, it } from "vitest";

import { consumeWithOrderedReads } from "./OrderedReads.js";

/** A read the test settles explicitly. */
const controlled = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = (value) => {
      settled = true;
      onResolve(value);
    };
    reject = (error) => {
      settled = true;
      onReject(error);
    };
  });
  return { promise, resolve, reject, settled: () => settled };
};

/** Let every queued continuation run. */
const drain = () => new Promise((resolve) => setImmediate(resolve));

/** Yield the items, then optionally fail; records whether it was closed early. */
const enumeration = (
  items: readonly string[],
  failure?: Error,
): {
  readonly items: AsyncIterable<string>;
  readonly closed: () => boolean;
} => {
  let closed = false;
  return {
    items: (async function* () {
      try {
        yield* items;
        if (failure !== undefined) throw failure;
      } finally {
        closed = true;
      }
    })(),
    closed: () => closed,
  };
};

describe("consumeWithOrderedReads", () => {
  it("consumes in enumeration order when a later read finishes first", async () => {
    const reads = new Map(
      ["a", "b", "c"].map((item) => [item, controlled<string>()]),
    );
    const consumed: string[] = [];
    const done = consumeWithOrderedReads(
      enumeration(["a", "b", "c"]).items,
      8,
      (item) => reads.get(item)!.promise,
      async (item, value) => {
        consumed.push(`${item}=${value}`);
      },
    );
    await drain();
    reads.get("c")!.resolve("3");
    reads.get("b")!.resolve("2");
    await drain();
    expect(consumed).toEqual([]);
    reads.get("a")!.resolve("1");
    await done;
    expect(consumed).toEqual(["a=1", "b=2", "c=3"]);
  });

  it("keeps at most width reads in flight and skips undefined reads", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const consumed: string[] = [];
    await consumeWithOrderedReads(
      enumeration(["a", "skip", "b", "c", "d", "e"]).items,
      2,
      (item) => {
        if (item === "skip") return undefined;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return drain().then(() => {
          inFlight -= 1;
          return item;
        });
      },
      async (item) => {
        consumed.push(item);
      },
    );
    expect(maxInFlight).toBe(2);
    expect(consumed).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("reports an earlier read failure before a later one", async () => {
    const reads = new Map(["a", "b"].map((item) => [item, controlled<void>()]));
    const done = consumeWithOrderedReads(
      enumeration(["a", "b"]).items,
      8,
      (item) => reads.get(item)!.promise,
      async () => undefined,
    );
    await drain();
    reads.get("b")!.reject(new Error("b failed"));
    await drain();
    reads.get("a")!.reject(new Error("a failed"));
    await expect(done).rejects.toThrow("a failed");
  });

  it("consumes earlier items before reporting an enumeration failure", async () => {
    const reads = new Map(["a", "b"].map((item) => [item, controlled<void>()]));
    const consumed: string[] = [];
    const done = consumeWithOrderedReads(
      enumeration(["a", "b"], new Error("walk failed")).items,
      8,
      (item) => reads.get(item)!.promise,
      async (item) => {
        consumed.push(item);
      },
    );
    await drain();
    reads.get("a")!.resolve();
    reads.get("b")!.reject(new Error("b failed"));
    await expect(done).rejects.toThrow("b failed");
    expect(consumed).toEqual(["a"]);
  });

  it("reports the enumeration failure once earlier items succeed", async () => {
    const consumed: string[] = [];
    await expect(
      consumeWithOrderedReads(
        enumeration(["a"], new Error("walk failed")).items,
        8,
        async (item) => item,
        async (item) => {
          consumed.push(item);
        },
      ),
    ).rejects.toThrow("walk failed");
    expect(consumed).toEqual(["a"]);
  });

  it("closes the enumeration and waits for started reads after a failure", async () => {
    const later = controlled<void>();
    const source = enumeration(["a", "b", "c"]);
    let settledBeforeReturn = false;
    const done = consumeWithOrderedReads(
      source.items,
      2,
      (item) =>
        item === "a" ? Promise.reject(new Error("a failed")) : later.promise,
      async () => undefined,
    ).catch((error: unknown) => {
      settledBeforeReturn = later.settled();
      throw error;
    });
    await drain();
    expect(source.closed()).toBe(true);
    later.resolve();
    await expect(done).rejects.toThrow("a failed");
    expect(settledBeforeReturn).toBe(true);
  });

  it("keeps a consume failure when closing the enumeration also fails", async () => {
    const items: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: "a" }),
        return: async () => {
          throw new Error("close failed");
        },
      }),
    };
    await expect(
      consumeWithOrderedReads(
        items,
        1,
        async () => undefined,
        async () => {
          throw new Error("consume failed");
        },
      ),
    ).rejects.toThrow("consume failed");
  });
});
