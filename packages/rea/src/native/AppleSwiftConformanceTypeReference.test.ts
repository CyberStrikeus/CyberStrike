import { describe, expect, it } from "vitest";

import { decodeSwiftConformanceTypeReference } from "./AppleSwiftConformanceTypeReference.js";
import type { SwiftDispatchReaders } from "./AppleSwiftDispatchFacets.js";

describe("Swift conformance type-reference read failures", () => {
  it("propagates unexpected reader errors instead of reporting malformed evidence", () => {
    const failure = new Error("reader invariant failed");
    const read = {
      u32: () => {
        throw failure;
      },
    } as unknown as SwiftDispatchReaders;

    expect(() =>
      decodeSwiftConformanceTypeReference({
        descriptor: 0x100n,
        flags: 0,
        read,
        relative: () => ({ kind: "target", target: 0x200n }),
        unresolvedReason: () => "unresolved",
      }),
    ).toThrow(failure);
  });
});
