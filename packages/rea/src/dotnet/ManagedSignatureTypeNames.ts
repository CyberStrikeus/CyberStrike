import { createHash } from "node:crypto";

import { managedDecodeBudget } from "./ManagedDecodeBudget.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import type {
  parseTypes,
  ManagedType,
  SignatureTypeName,
  DeclarationTypeName,
} from "./ManagedMemberInspectorCore.js";
import type { ManagedTypeReferenceLookup } from "./ManagedTypeReferences.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { managedFailure, readManagedValue } from "./ManagedReaderFailure.js";

const TYPE_REF = 1;
const TYPE_DEF = 2;
/** One type's own namespace and name, and its enclosing type's row if nested. */
interface TypeLink {
  readonly namespace: string;
  readonly name: string;
  readonly enclosingRow: number | null;
}

/**
 * Deepest type nesting REA names, counting the outermost type as 1. Real
 * assemblies nest a few levels; the cap bounds the walk a hostile chain of
 * NestedClass rows or TypeRef ResolutionScopes can force per operand.
 */
export const MAX_TYPE_NESTING_DEPTH = 64;

/** Digest prefixes that keep a top-level type apart from a nested one. */
const TOP_LEVEL = Buffer.from([0]);
const NESTED = Buffer.from([1]);
/**
 * Separates a namespace from a name. #Strings entries end at NUL, so neither
 * holds one, and `A` + `B.C` stays apart from `A.B` + `C`.
 */
const NAME_SEPARATOR = Buffer.from([0]);

interface NamedRow {
  readonly digest: Buffer;
  readonly name: string;
  readonly depth: number;
}

/**
 * Digest each row's type name after its enclosing types' names: a top-level
 * type hashes its namespace and name, each framed, and a nested type hashes
 * its enclosing type's digest and its own namespace and name, as
 * `Outer/Inner` would read. Each
 * row is read and digested once, so naming a chain is linear in its length.
 * A gap, a cycle, or nesting deeper than `MAX_TYPE_NESTING_DEPTH` has no
 * digest. `retain` is charged once per row read and once per remembered row.
 */
export const nestedTypeNames = (
  link: (row: number) => TypeLink | null,
  retain: (bytes?: number) => void,
): ((row: number) => NamedRow | null) => {
  const named = new Map<number, NamedRow | null>();
  const remember = (row: number, value: NamedRow | null): void => {
    retain();
    named.set(row, value);
  };
  // Rows a walk read but could not name, such as the parents of a type nested
  // past the cap, are still read only once.
  const links = new Map<number, TypeLink | null>();
  const readLink = (row: number): TypeLink | null => {
    const known = links.get(row);
    if (known !== undefined) return known;
    const read = link(row);
    retain();
    links.set(row, read);
    return read;
  };
  return (row) => {
    // Walk out to a named row or the outermost type, at most past the cap.
    const path: { readonly row: number; readonly link: TypeLink }[] = [];
    const seen = new Set<number>();
    let outer: NamedRow | null = null;
    for (let current: number | null = row; current !== null;) {
      const known = named.get(current);
      if (known !== undefined) {
        if (known === null) {
          for (const step of path) remember(step.row, null);
          return null;
        }
        outer = known;
        break;
      }
      if (seen.has(current)) {
        // Every row on a cycle, and every row nested in one, has no name.
        for (const step of path) remember(step.row, null);
        return null;
      }
      if (path.length === MAX_TYPE_NESTING_DEPTH) {
        // The row the walk started from is nested past the cap.
        remember(row, null);
        return null;
      }
      const step = readLink(current);
      if (step === null) {
        remember(current, null);
        for (const visited of path) remember(visited.row, null);
        return null;
      }
      seen.add(current);
      path.push({ row: current, link: step });
      current = step.enclosingRow;
    }
    // Name inward from the outermost row; a row past the cap, and every row
    // nested in it, has no name.
    let inner: NamedRow | null = outer;
    let exceeded = false;
    for (const step of path.reverse()) {
      const depth = (inner?.depth ?? 0) + 1;
      exceeded ||= depth > MAX_TYPE_NESTING_DEPTH;
      if (exceeded) {
        remember(step.row, null);
        continue;
      }
      const hash = createHash("sha256");
      if (inner === null) hash.update(TOP_LEVEL);
      else hash.update(NESTED).update(inner.digest);
      hash
        .update(step.link.namespace)
        .update(NAME_SEPARATOR)
        .update(step.link.name);
      // Charge each retained expanded path before allocation, including parents.
      const ownLength =
        step.link.namespace.length +
        step.link.name.length +
        Number(step.link.namespace.length > 0);
      retain(((inner?.name.length ?? -1) + 1 + ownLength) * 6 + 2);
      const ownName =
        step.link.namespace.length === 0
          ? step.link.name
          : `${step.link.namespace}.${step.link.name}`;
      const name = inner === null ? ownName : `${inner.name}/${ownName}`;
      inner = { digest: hash.digest(), name, depth };
      remember(step.row, inner);
    }
    return exceeded ? null : inner;
  };
};

/**
 * Name signature type operands independently of their metadata rows: a TypeDef
 * or TypeRef by namespace and name, after its enclosing types for a nested
 * type, as in `Outer/Inner`. A TypeDef and a TypeRef with the same name are
 * the same nominal name, and a TypeRef's resolution scope assembly is not part of its
 * name, so a type forwarded between assemblies keeps its name. A TypeSpec, an
 * unreadable row, cyclic nesting, or nesting deeper than the cap has no name,
 * so its declaration and signature operands have no resolved digest; an unreadable row's failure is
 * retained in `issues`, once per row. Each coded index and each row is
 * named and digested once, so repeated operands cost a lookup.
 */
export const managedSignatureTypeNames = (
  layout: ManagedMetadataLayout,
  issues: ManagedParseIssue[],
  parsedTypes: Pick<ReturnType<typeof parseTypes>, "types" | "nesting">,
  reference: ManagedTypeReferenceLookup,
): {
  readonly operand: SignatureTypeName;
  readonly declaration: DeclarationTypeName;
  readonly displayName: (
    operand: Parameters<SignatureTypeName>[0],
  ) => string | null;
} => {
  const retain = (bytes = 128) =>
    managedDecodeBudget(layout).reserve(bytes, null);
  managedDecodeBudget(layout).reserve(parsedTypes.types.length * 128, null);
  const types = new Map<number, ManagedType>();
  for (const { row, type } of parsedTypes.types) types.set(row, type);
  const definitions = nestedTypeNames((row) => {
    if (!parsedTypes.nesting.complete) return null;
    const type = types.get(row);
    if (
      type === undefined &&
      (row < 1 || row > (layout.table(TYPE_DEF)?.rowCount ?? 0))
    ) {
      readManagedValue(() => {
        throw managedFailure(
          "invalid-row",
          `metadata.signature.type:${TYPE_DEF}:${row}`,
          `Signature references an unavailable TypeDef row ${row}`,
        );
      }, issues);
      return null;
    }
    if (type === undefined) return null;
    const enclosingRow = parsedTypes.nesting.enclosing.get(row) ?? null;
    // ECMA-335 TypeAttributes.VisibilityMask: 0/1 are top-level, 2..7 nested.
    const nested = (type.flags & 0x7) >= 2;
    if (nested !== (enclosingRow !== null)) {
      managedDecodeBudget(layout).reserve(512, type.row_offset);
      readManagedValue(() => {
        throw managedFailure(
          "invalid-row",
          `metadata.TypeDef:${type.token}`,
          nested
            ? `Nested TypeDef ${type.token} has no NestedClass enclosing entry`
            : `Top-level TypeDef ${type.token} has a NestedClass enclosing entry`,
          type.row_offset,
        );
      }, issues);
      return null;
    }
    return {
      namespace: type.namespace,
      name: type.name,
      enclosingRow,
    };
  }, retain);
  const references = nestedTypeNames((row) => {
    const value = reference(row);
    return value?.scopeValid === true ? value : null;
  }, retain);
  const names = new Map<number, NamedRow | null>();
  const nameFor = (
    key: number,
    table: number | undefined,
    row: number,
  ): NamedRow | null => {
    let named = names.get(key);
    if (named === undefined) {
      managedDecodeBudget(layout).reserve(256, null);
      named =
        table === TYPE_DEF
          ? definitions(row)
          : table === TYPE_REF
            ? references(row)
            : null;
      names.set(key, named);
    }
    return named;
  };
  return {
    operand: ({ value, coordinate }) =>
      nameFor(value, coordinate.table, coordinate.row)?.digest ?? null,
    declaration: (table, row) =>
      nameFor(row * 4 + Number(table === TYPE_REF), table, row)?.digest ?? null,
    displayName: ({ value, coordinate }) =>
      nameFor(value, coordinate.table, coordinate.row)?.name ?? null,
  };
};
