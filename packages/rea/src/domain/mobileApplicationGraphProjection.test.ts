import { expect, it } from "vitest";

import {
  projectedFileComponents,
  type ProjectedInventoryEntry,
} from "./mobileApplicationGraphProjection.js";

it("selects authenticated file and slice facts without reordering or deduplicating occurrences", () => {
  const file: ProjectedInventoryEntry = {
    path: "member",
    kind: "file",
    unavailable: undefined,
    component: {
      path: "member",
      artifact_id: `art_${"a".repeat(64)}`,
      sha256: "b".repeat(64),
      format: "file",
    },
  };
  const slice: ProjectedInventoryEntry = {
    ...file,
    kind: "slice",
    component: { ...file.component, path: "member/arm64", format: "mach-o" },
    path: "member/arm64",
  };
  const unread: ProjectedInventoryEntry = {
    path: "unread",
    kind: "file",
    component: undefined,
    unavailable: {
      path: "unread",
      artifact_id: null,
      sha256: null,
      format: "file",
      encrypted: false,
      limitations: ["Content was not read."],
    },
  };
  const entries = Object.freeze([
    { ...file, kind: "directory" as const },
    file,
    { ...file, kind: "symlink" as const },
    slice,
    unread,
    file,
  ]);
  const result = projectedFileComponents(entries);
  expect(result).toEqual([file.component, slice.component, file.component]);
  expect(result[0]).toBe(file.component);
  expect(result[1]).toBe(slice.component);
  expect(entries[4]).toBe(unread);
});
