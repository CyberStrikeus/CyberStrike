import type { ManagedTypeReferenceLookup } from "./ManagedTypeReferences.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import {
  fullName,
  specSignatureFacts,
  type TypeRange,
} from "./ManagedMemberInspectorCore.js";
import {
  metadataRowOffset,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  metadataRowCursor,
  type MetadataTokenFact,
  metadataToken,
  readMetadataBlob,
} from "./ManagedMetadataHeaps.js";
import { readManagedValue } from "./ManagedReaderFailure.js";

/**
 * Name the type a TypeDef, TypeRef, or generic-instantiation TypeSpec token
 * denotes, in the namespace-qualified form TypeDef `full_name` uses, once per
 * token. Other decoded TypeSpecs stay null: the type is unknown. Malformed or
 * unsupported rows and blobs are reported to `issues` and also stay null,
 * except that a TypeRef with an invalid ResolutionScope keeps its readable name.
 */
export const typeNameLookup = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  ranges: readonly TypeRange[],
  issues: ManagedParseIssue[],
  references: ManagedTypeReferenceLookup,
): ((
  reference: Pick<MetadataTokenFact, "table" | "row" | "token"> | null,
) => string | null) => {
  const names = new Map<string, string | null>();
  const definitionName = (table: 1 | 2, row: number): string | null => {
    if (table === 2) {
      metadataRowOffset(layout, 2, row);
      return ranges[row - 1]?.fullName ?? null;
    }
    const reference = references(row);
    return reference === null
      ? null
      : fullName(reference.namespace, reference.name);
  };
  const specName = (row: number): string | null => {
    const cursor = metadataRowCursor(bytes, layout, 27, row);
    const spec = readMetadataBlob(
      bytes,
      layout,
      cursor.readIndex(layout.blobIndexSize),
      layout.blob?.size ?? 0,
    );
    const owner = {
      form: "type",
      scope: `metadata.TypeSpec:${metadataToken(27, row)}`,
      offset: cursor.start,
    } as const;
    const { nominalGenericType } = specSignatureFacts(layout, spec, owner);
    return nominalGenericType === null
      ? null
      : definitionName(nominalGenericType.table, nominalGenericType.row);
  };
  return (reference) => {
    if (reference === null) return null;
    const { token, table, row } = reference;
    if (names.has(token)) return names.get(token) ?? null;
    const name =
      readManagedValue(
        () =>
          table === 27
            ? specName(row)
            : table === 1 || table === 2
              ? definitionName(table, row)
              : null,
        issues,
      ) ?? null;
    names.set(token, name);
    return name;
  };
};
