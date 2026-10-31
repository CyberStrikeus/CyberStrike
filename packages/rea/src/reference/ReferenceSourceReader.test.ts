import { describe, expect, it } from "vitest";

import type {
  ReferenceSourceEntry,
  TraversalState,
} from "./ReferenceSourceReaderTypes.js";
import { reconcileUnobservedSymlinkTargets } from "./ReferenceSourceReader.js";

const failedDirectory = (
  path: string,
  code: "changed" | "io" | "symlink",
): ReferenceSourceEntry => ({
  status: "failed",
  kind: "directory",
  path,
  code,
  message: `directory failure ${code}`,
});

const internalLink = (path: string, target: string): ReferenceSourceEntry => ({
  status: "read",
  kind: "symlink",
  path,
  target,
  targetState: "internal",
});

const exclusions = (
  ...items: TraversalState["exclusions"][number][]
): TraversalState["exclusions"] => items;

describe("unobserved internal symlink reconciliation", () => {
  it("uses the explicit root failure only when no closer completed directory or exclusion covers the target", () => {
    const entries: ReferenceSourceEntry[] = [
      internalLink("unobserved", "unseen/target.txt"),
      internalLink("complete", "known/target.txt"),
      internalLink("excluded", "omitted/target.txt"),
      { status: "read", kind: "directory", path: "known" },
    ];

    reconcileUnobservedSymlinkTargets(
      entries,
      exclusions({ path: "omitted", kind: "directory" }),
      undefined,
      { code: "changed", message: "Reference root changed" },
    );

    expect(entries[0]).toMatchObject({
      status: "failed",
      kind: "symlink",
      code: "changed",
      message: expect.stringContaining("Reference root changed"),
    });
    expect(entries.slice(1, 3)).toEqual([
      internalLink("complete", "known/target.txt"),
      internalLink("excluded", "omitted/target.txt"),
    ]);
  });

  it("retains unreadable targets below the nearest failed directory", () => {
    const entries: ReferenceSourceEntry[] = [
      internalLink("alias.txt", "hidden/target.txt"),
      failedDirectory("hidden", "io"),
      {
        status: "read",
        kind: "file",
        path: "visible.txt",
        bytes: new Uint8Array([1]),
        size: 1,
      },
    ];

    reconcileUnobservedSymlinkTargets(entries);

    expect(entries[0]).toMatchObject({
      status: "failed",
      kind: "symlink",
      code: "io",
      message: expect.stringContaining("directory failure io"),
    });
    expect(entries[2]).toMatchObject({ status: "read", path: "visible.txt" });
  });

  it("matches Unicode-equivalent failed ancestor identities", () => {
    const entries: ReferenceSourceEntry[] = [
      internalLink("alias.txt", "hidden/cafe\u0301/target.txt"),
      failedDirectory("hidden/caf\u00e9", "changed"),
    ];

    reconcileUnobservedSymlinkTargets(entries);

    expect(entries[0]).toMatchObject({
      status: "failed",
      kind: "symlink",
      code: "changed",
      message: expect.stringContaining("directory failure changed"),
    });
  });

  it("stops at a complete nearer directory or an exclusion of unknown kind", () => {
    const entries: ReferenceSourceEntry[] = [
      internalLink("to-missing", "outer/complete/missing.txt"),
      internalLink("to-excluded", "outer/excluded/missing.txt"),
      failedDirectory("outer", "io"),
      { status: "read", kind: "directory", path: "outer/complete" },
    ];

    reconcileUnobservedSymlinkTargets(
      entries,
      exclusions({ path: "outer/excluded", kind: "unknown" }),
    );

    expect(entries[0]).toMatchObject({
      status: "read",
      targetState: "internal",
    });
    expect(entries[1]).toMatchObject({
      status: "read",
      targetState: "internal",
    });
  });

  it("keeps exact exclusions and leaves observations untouched after cancellation", () => {
    const entries = [internalLink("alias.txt", "hidden/target.txt")];
    reconcileUnobservedSymlinkTargets(
      entries,
      exclusions({ path: "hidden/target.txt", kind: "file" }),
    );
    expect(entries[0]).toMatchObject({ targetState: "internal" });

    const cancelledEntries: ReferenceSourceEntry[] = [
      internalLink("alias.txt", "hidden/target.txt"),
      failedDirectory("hidden", "io"),
    ];
    const controller = new AbortController();
    controller.abort();
    reconcileUnobservedSymlinkTargets(cancelledEntries, [], controller.signal);
    expect(cancelledEntries[0]).toMatchObject({ targetState: "internal" });
  });
});
