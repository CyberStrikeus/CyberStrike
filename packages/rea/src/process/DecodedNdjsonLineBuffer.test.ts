import { describe, expect, it } from "vitest";

import { DecodedNdjsonLineBuffer } from "./DecodedNdjsonLineBuffer.js";

describe("decoded NDJSON line buffer", () => {
  it("joins fragments and yields trimmed nonblank complete lines", () => {
    const lines = new DecodedNdjsonLineBuffer();

    expect([...lines.push("  first ")]).toEqual([]);
    expect([...lines.push("\n \t\n second \n unfinished")]).toEqual([
      "first",
      "second",
    ]);
    expect([...lines.push(" line\n")]).toEqual(["unfinished line"]);
  });

  it("retains unconsumed complete lines and reset discards them", () => {
    const lines = new DecodedNdjsonLineBuffer();
    const iterator = lines.push('invalid\n{"id":2}\n');

    expect(iterator.next()).toEqual({ value: "invalid", done: false });
    iterator.return(undefined);
    expect([...lines.push('{"id":3}\n')]).toEqual(['{"id":2}', '{"id":3}']);

    const nextIterator = lines.push(
      "discard me\nwill also be discarded\nkeep partial",
    );
    expect(nextIterator.next()).toEqual({ value: "discard me", done: false });
    nextIterator.return(undefined);
    lines.reset();
    expect([...lines.push("after reset\n")]).toEqual(["after reset"]);
  });
});
