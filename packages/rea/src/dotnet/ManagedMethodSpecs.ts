import { readMemberReferenceRowFacts } from "./ManagedMemberReferenceRows.js";
import { readMethodDefinitionRow } from "./ManagedMethodDefinitionRows.js";
import { createHash } from "node:crypto";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import {
  methodGenericArity,
  specSignatureFacts,
  type SignatureTypeName,
  type DecodedMethod,
  type MemberCore,
} from "./ManagedMemberInspectorCore.js";
import {
  MANAGED_CODED_INDEXES,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  decodeMetadataCodedIndex,
  type MetadataTokenFact,
  metadataRowCursor,
  readMetadataBlob,
} from "./ManagedMetadataHeaps.js";
import { managedFailure, readManagedValue } from "./ManagedReaderFailure.js";

/**
 * Index fields, member references, and methods by token, then name each
 * MethodSpec an inspected body calls after the generic method it instantiates,
 * so every edge target resolves through one lookup.
 */
export const edgeTargets = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  methods: readonly DecodedMethod[],
  cores: readonly ReadonlyMap<string, MemberCore>[],
  signatureTypeName: SignatureTypeName,
): {
  readonly members: ReadonlyMap<string, MemberCore>;
  readonly issues: readonly ManagedParseIssue[];
} => {
  const members = new Map(cores.flatMap((core) => [...core]));
  const issues: ManagedParseIssue[] = [];
  const seen = new Set<string>();
  // Generic arity by method token, so instantiations of one method decode it once.
  const arities = new Map<string, number | null>();
  for (const { tokenInstructions } of methods)
    for (const { reference } of tokenInstructions) {
      if (reference.table !== 0x2b || seen.has(reference.token)) continue;
      seen.add(reference.token);
      readManagedValue(
        () =>
          readMethodSpec(
            { bytes, layout, members, issues, arities, signatureTypeName },
            reference,
          ),
        issues,
      );
    }
  return { members, issues };
};

/**
 * Map one MethodSpec to its generic method, then check its instantiation
 * decodes and matches that method's generic arity. A readable Method column
 * keeps its name when the rest is malformed; the failure makes coverage partial.
 */
const readMethodSpec = (
  {
    bytes,
    layout,
    members,
    issues,
    arities,
    signatureTypeName,
  }: {
    readonly bytes: Buffer;
    readonly layout: ManagedMetadataLayout;
    readonly members: Map<string, MemberCore>;
    readonly issues: ManagedParseIssue[];
    readonly arities: Map<string, number | null>;
    readonly signatureTypeName: SignatureTypeName;
  },
  reference: MetadataTokenFact,
): void => {
  const { token, row } = reference;
  const scope = `metadata.MethodSpec:${token}`;
  const cursor = metadataRowCursor(bytes, layout, 0x2b, row);
  const methodRaw = cursor.readIndex(layout.codedIndexSize("MethodDefOrRef"));
  const instantiation = cursor.readIndex(layout.blobIndexSize);
  const method = decodeMetadataCodedIndex(
    methodRaw,
    MANAGED_CODED_INDEXES.MethodDefOrRef.bits,
    MANAGED_CODED_INDEXES.MethodDefOrRef.tables,
    layout.rowCounts,
  );
  if (method.kind !== "valid")
    issues.push({
      code: "invalid-row",
      scope,
      offset: cursor.start,
      detail:
        method.kind === "null"
          ? "MethodSpec method coded index 0x0 is null, but the Method column must reference a row"
          : `MethodSpec method coded index 0x${methodRaw.toString(16)} is invalid: ${method.reason}`,
    });
  const methodReference = method.kind === "valid" ? method : null;
  const target =
    methodReference === null ? undefined : members.get(methodReference.token);
  // A MethodSpec instantiates a method, so a field target never lends it a
  // name, even to a field operand.
  if (target !== undefined && target.kind !== "field")
    members.set(token, { ...target, token, identitySha256: null });
  const instantiationFacts = specSignatureFacts(
    layout,
    readMetadataBlob(bytes, layout, instantiation, layout.blob?.size ?? 0),
    { form: "instantiation", scope, offset: cursor.start },
    signatureTypeName,
  );
  const { types } = instantiationFacts;
  if (methodReference === null) return;
  const generic = methodReference.token;
  // Prefer the arity the target's owner decoded; read the raw signature only
  // for a target nothing decoded, such as a MethodDef outside the selection.
  if (target?.genericArity === undefined && !arities.has(generic))
    arities.set(
      generic,
      methodGenericArity(
        layout,
        methodSignatureBlob(bytes, layout, methodReference),
      ),
    );
  const arity =
    target?.genericArity === undefined
      ? (arities.get(generic) ?? null)
      : target.genericArity;
  if (arity !== types.length)
    throw managedFailure(
      "invalid-row",
      scope,
      arity === null
        ? "MethodSpec method does not have a decodable method signature"
        : `MethodSpec supplies ${String(types.length)} type argument(s), but its method declares ${String(arity)} generic parameter(s)`,
      cursor.start,
    );
  if (
    target !== undefined &&
    target.kind === "method" &&
    target.identitySha256 != null &&
    instantiationFacts.resolvedSha256 !== null
  )
    members.set(token, {
      ...target,
      token,
      identitySha256: createHash("sha256")
        .update("managed-method-instantiation-v1\0")
        .update(Buffer.from(target.identitySha256, "hex"))
        .update(Buffer.from(instantiationFacts.resolvedSha256, "hex"))
        .digest("hex"),
    });
};

/** The Signature column of a MethodDef or MemberRef row. */
const methodSignatureBlob = (
  bytes: Buffer,
  layout: ManagedMetadataLayout,
  { table, row }: Pick<MetadataTokenFact, "table" | "row">,
): Buffer => {
  let signatureIndex: number;
  if (table === 6) {
    signatureIndex = readMethodDefinitionRow(bytes, layout, row).signatureIndex;
  } else {
    signatureIndex = readMemberReferenceRowFacts(
      bytes,
      layout,
      row,
    ).signatureIndex;
  }
  return readMetadataBlob(
    bytes,
    layout,
    signatureIndex,
    layout.blob?.size ?? 0,
  );
};
