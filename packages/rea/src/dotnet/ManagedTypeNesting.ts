import { managedDecodeBudget } from "./ManagedDecodeBudget.js";
import { metadataRowCursor, metadataToken } from "./ManagedMetadataHeaps.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { managedFailure, readManagedValue } from "./ManagedReaderFailure.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";

/** Parsed NestedClass facts shared by declaring types and signature operands. */
export interface ManagedTypeNesting {
  readonly enclosing: ReadonlyMap<number, number>;
  readonly complete: boolean;
}

export const readManagedTypeNesting = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): ManagedTypeNesting => {
  const initialIssues = issues.length;
  const typeCount = layout.table(2)?.rowCount ?? 0;
  const enclosing = new Map<number, number>();
  for (let row = 1; row <= (layout.table(41)?.rowCount ?? 0); row += 1) {
    readManagedValue(() => {
      const cursor = metadataRowCursor(bytes, layout, 41, row);
      const nested = cursor.readIndex(layout.tableIndexSize(2));
      const outer = cursor.readIndex(layout.tableIndexSize(2));
      if (
        nested < 1 ||
        outer < 1 ||
        nested > typeCount ||
        outer > typeCount ||
        nested === outer ||
        enclosing.has(nested)
      )
        throw managedFailure(
          "invalid-row",
          `metadata.NestedClass:${metadataToken(41, row)}`,
          `NestedClass requires a unique nested type and distinct existing enclosing type; observed ${nested} -> ${outer}`,
          cursor.start,
        );
      managedDecodeBudget(layout).reserve(128, cursor.start);
      enclosing.set(nested, outer);
    }, issues);
  }
  return { enclosing, complete: issues.length === initialIssues };
};
