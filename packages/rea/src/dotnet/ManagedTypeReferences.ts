import { managedDecodeBudget } from "./ManagedDecodeBudget.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import {
  decodeMetadataCodedIndex,
  metadataRowCursor,
  metadataToken,
  readMetadataString,
} from "./ManagedMetadataHeaps.js";
import { readManagedValue } from "./ManagedReaderFailure.js";
import {
  MANAGED_CODED_INDEXES,
  metadataRowOffset,
} from "./ManagedMetadataLayout.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";

export interface ManagedTypeReference {
  readonly namespace: string;
  readonly name: string;
  readonly enclosingRow: number | null;
  readonly scopeValid: boolean;
}

export type ManagedTypeReferenceLookup = (
  row: number,
) => ManagedTypeReference | null;

interface TypeReferenceRow {
  readonly nameIndex: number;
  readonly namespaceIndex: number;
  readonly enclosingRow: number | null;
  readonly scopeValid: boolean;
}

/** Own each TypeRef source tuple and scope validation once per inspection. */
export const managedTypeReferences = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
): ManagedTypeReferenceLookup => {
  const rows = new Map<number, TypeReferenceRow | null>();
  const names = new Map<number, ManagedTypeReference | null>();
  const checked = new Map<number, boolean>();
  const read = (row: number): TypeReferenceRow | null => {
    const cached = rows.get(row);
    if (cached !== undefined) return cached;
    // Admit the parsed row, validation entry and bounded walk bookkeeping.
    managedDecodeBudget(layout).reserve(384, null);
    const value =
      readManagedValue(() => {
        const cursor = metadataRowCursor(bytes, layout, 1, row);
        const raw = cursor.readIndex(layout.codedIndexSize("ResolutionScope"));
        const scope = decodeMetadataCodedIndex(
          raw,
          MANAGED_CODED_INDEXES.ResolutionScope.bits,
          MANAGED_CODED_INDEXES.ResolutionScope.tables,
          layout.rowCounts,
        );
        if (scope.kind === "invalid")
          issues.push({
            code: "invalid-row",
            scope: `metadata.TypeRef:${metadataToken(1, row)}`,
            offset: cursor.start,
            detail: `TypeRef ResolutionScope coded index 0x${raw.toString(16)} is invalid: ${scope.reason}`,
          });
        return {
          nameIndex: cursor.readIndex(layout.stringIndexSize),
          namespaceIndex: cursor.readIndex(layout.stringIndexSize),
          enclosingRow:
            scope.kind !== "null" && scope.table === 1 ? scope.row : null,
          scopeValid: scope.kind !== "invalid",
        };
      }, issues) ?? null;
    rows.set(row, value);
    return value;
  };
  const validate = (row: number): boolean => {
    const prior = checked.get(row);
    if (prior !== undefined) return prior;
    const path: number[] = [];
    const seen = new Set<number>();
    let current: number | null = row;
    let valid = true;
    while (current !== null) {
      const known = checked.get(current);
      if (known !== undefined) {
        valid = known;
        break;
      }
      if (seen.has(current)) {
        issues.push({
          code: "invalid-row",
          scope: `metadata.TypeRef:${metadataToken(1, current)}`,
          offset: metadataRowOffset(layout, 1, current),
          detail: "TypeRef ResolutionScope chain contains a cycle",
        });
        valid = false;
        break;
      }
      seen.add(current);
      path.push(current);
      const value = read(current);
      if (value === null || !value.scopeValid) {
        valid = false;
        break;
      }
      current = value.enclosingRow;
    }
    for (const visited of path) checked.set(visited, valid);
    return valid;
  };
  return (row) => {
    const cached = names.get(row);
    if (cached !== undefined) return cached;
    const value = read(row);
    if (value === null) return null;
    const scopeValid = validate(row);
    // Scope validation loads only scalar row facts. The digest owner's nesting
    // cap determines which names are requested, rather than preloading parents.
    managedDecodeBudget(layout).reserve(128, null);
    const named =
      readManagedValue(
        () => ({
          namespace: readMetadataString(
            bytes,
            layout,
            value.namespaceIndex,
            layout.strings.size,
          ),
          name: readMetadataString(
            bytes,
            layout,
            value.nameIndex,
            layout.strings.size,
          ),
          enclosingRow: value.enclosingRow,
          scopeValid,
        }),
        issues,
      ) ?? null;
    names.set(row, named);
    return named;
  };
};
