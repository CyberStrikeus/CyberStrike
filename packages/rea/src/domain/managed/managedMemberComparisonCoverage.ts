import type {
  ManagedMemberComparisonResult,
  ManagedMemberComparisonSide,
} from "./managedMemberComparison.js";
import type { ManagedMemberInspection } from "./managedArtifact.js";
import { hasSignatureResolution } from "./managedMemberSignatureIdentity.js";

interface ComparisonCoverageInput {
  readonly left: ManagedMemberInspection;
  readonly right: ManagedMemberInspection;
  readonly selectionAgreement: SelectionAgreement;
}

type SelectionAgreement = "same" | "different" | "unknown";

export const buildComparisonCoverage = ({
  left,
  right,
  selectionAgreement,
}: ComparisonCoverageInput): ManagedMemberComparisonResult["coverage"] => {
  const leftStatus = sideCoverageStatus(left);
  const rightStatus = sideCoverageStatus(right);
  const unknownInput =
    left.coverage.state !== "complete" ||
    right.coverage.state !== "complete" ||
    selectionAgreement !== "same" ||
    !sameMethodRows(left, right);
  return {
    status:
      !unknownInput && leftStatus === "complete" && rightStatus === "complete"
        ? "complete-within-inputs"
        : "partial",
    left_status: leftStatus,
    right_status: rightStatus,
  };
};

/** Full MethodDef coverage is required before inferring cross-build absence. */
export const hasCompleteMethodRows = (
  result: ManagedMemberInspection,
): boolean =>
  result.method_rows !== null &&
  result.method_rows.offset === 0 &&
  result.method_rows.count === result.method_rows.total;

const sameMethodRows = (
  left: ManagedMemberInspection,
  right: ManagedMemberInspection,
): boolean =>
  (hasCompleteMethodRows(left) && hasCompleteMethodRows(right)) ||
  (left.method_rows !== null &&
    right.method_rows !== null &&
    left.method_rows.offset === right.method_rows.offset &&
    left.method_rows.count === right.method_rows.count &&
    left.method_rows.total === right.method_rows.total);

/** One side's build-local TypeDef lookup and observed nominal selection. */
const declaringTypeScope = (result: ManagedMemberInspection) => {
  const names = new Map(
    result.types.map((type) => [type.token, type.name_sha256]),
  );
  return {
    names,
    selected:
      result.selection === null
        ? null
        : new Set([...names.values()].filter((name) => name !== null)),
    complete:
      result.coverage.state === "complete" &&
      result.metadata.status === "complete" &&
      result.types.every(({ name_sha256 }) => name_sha256 !== null),
  };
};

type DeclaringTypeScope = ReturnType<typeof declaringTypeScope>;
type DeclaredMember =
  | ManagedMemberInspection["methods"][number]
  | ManagedMemberInspection["fields"][number];

/** Resolve tokens only in their own source, then test opposite nominal scope. */
const observedBy = (
  own: DeclaringTypeScope,
  opposite: DeclaringTypeScope,
  member: DeclaredMember,
): boolean => {
  if (opposite.selected === null) return true;
  const name = own.names.get(member.declaring_type_token ?? "");
  return name != null && opposite.selected.has(name);
};

/** Compare the nominal types the owner retained, independently of request spelling. */
const compareSelectedTypes = (
  left: DeclaringTypeScope,
  right: DeclaringTypeScope,
): SelectionAgreement => {
  const leftNames = left.selected;
  const rightNames = right.selected;
  if (leftNames === null || rightNames === null)
    return leftNames === rightNames ? "same" : "different";
  if (!left.complete || !right.complete) return "unknown";
  return leftNames.size === rightNames.size &&
    [...leftNames].every((name) => rightNames.has(name))
    ? "same"
    : "different";
};

/** Share the same nominal facts across pairing, absence and scope agreement. */
export const managedComparisonScope = (
  left: ManagedMemberInspection,
  right: ManagedMemberInspection,
) => {
  const a = declaringTypeScope(left);
  const b = declaringTypeScope(right);
  return {
    left: a,
    right: b,
    inLeft: (member: DeclaredMember) => observedBy(b, a, member),
    inRight: (member: DeclaredMember) => observedBy(a, b, member),
    agreement: compareSelectedTypes(a, b),
  };
};

export type ManagedComparisonScope = ReturnType<typeof managedComparisonScope>;

const sideCoverageStatus = (
  result: ManagedMemberInspection,
): ManagedMemberComparisonResult["coverage"]["left_status"] =>
  result.coverage.state === "unavailable"
    ? "unavailable"
    : result.coverage.state === "complete"
      ? "complete"
      : "partial";

export const sideManifest = (
  side: ManagedMemberComparisonSide,
): ManagedMemberComparisonResult["left"] => ({
  evidence_id: side.evidenceId,
  artifact_sha256: side.result.artifact.sha256,
  mvid: side.result.module?.mvid ?? null,
  module_name: side.result.module?.name ?? null,
  metadata_status: side.result.metadata.status,
  methods_total: side.result.methods.length,
  fields_total: side.result.fields.length,
});

export const buildComparisonSummary = (
  items: readonly (
    | ManagedMemberComparisonResult["methods"][number]
    | ManagedMemberComparisonResult["fields"][number]
  )[],
): ManagedMemberComparisonResult["summary"] => ({
  unchanged: items.filter(({ status }) => status === "unchanged").length,
  changed: items.filter(({ status }) => status === "changed").length,
  added: items.filter(({ status }) => status === "added").length,
  removed: items.filter(({ status }) => status === "removed").length,
  unknown: items.filter(({ status }) => status === "unknown").length,
});

export const buildComparisonMatching = (
  methodItems: readonly ManagedMemberComparisonResult["methods"][number][],
  fieldItems: readonly ManagedMemberComparisonResult["fields"][number][],
): ManagedMemberComparisonResult["matching"] => ({
  exact_il_signature: methodItems.filter(
    ({ match }) => match.basis === "exact-il-signature",
  ).length,
  exact_signature: [...methodItems, ...fieldItems].filter(
    ({ match }) => match.basis === "exact-signature",
  ).length,
  structural_method_shape: methodItems.filter(
    ({ match }) => match.basis === "structural-method-shape",
  ).length,
  field_signature: fieldItems.filter(
    ({ match }) => match.basis === "field-signature",
  ).length,
  ambiguous:
    methodItems.filter(({ match }) => match.status === "ambiguous").length +
    fieldItems.filter(({ match }) => match.status === "ambiguous").length,
  unmatched: [...methodItems, ...fieldItems].filter(
    ({ match }) => match.status === "unmatched",
  ).length,
});

export const comparisonLimitations = (
  left: ManagedMemberInspection,
  right: ManagedMemberInspection,
  selectionAgreement: SelectionAgreement = managedComparisonScope(left, right)
    .agreement,
): string[] => {
  const limitations: string[] = [
    "Metadata tokens are build-local coordinates; matched pairs are remaps, not persistent identities.",
    "Methods pair within one declared type and name by exact CIL/signature, then signature, then structural shape; only then may exact CIL/signature or structural shape alone remap across declared types or names, never taking a member whose own declared type and name remain unpaired on the other side or whose declaring type is unresolved. Names alone are never a matching basis.",
    "Fields pair by declared type, name, and signature, then remap by exact decoded signature alone under the same rule; an undecoded signature is compared only for an exact signature match, and an unmatched member with one stays unknown.",
  ];
  if (
    [left, right].some((report) =>
      report.fields.some((field) => field.constant != null),
    )
  )
    limitations.push(
      "Field Constant-table defaults are not compared; field matching and change detection cover names, flags and signatures only.",
    );
  const namesTypes = (result: ManagedMemberInspection) =>
    result.methods.some(
      ({ signature }) =>
        signature.resolved_sha256 !== null &&
        signature.resolved_sha256 !== signature.raw_sha256,
    ) ||
    result.fields.some(
      ({ signature }) =>
        signature.resolved_sha256 !== null &&
        signature.resolved_sha256 !== signature.raw_sha256,
    );
  if (
    hasSignatureResolution(left) &&
    hasSignatureResolution(right) &&
    (namesTypes(left) || namesTypes(right))
  )
    limitations.push(
      "Signature type operands compare by namespace, name, and enclosing names only; defining assemblies and CLR type identity are not established by this comparison.",
    );
  if (left.coverage.state !== "complete" || right.coverage.state !== "complete")
    limitations.push("At least one managed member observation is partial.");
  if (selectionAgreement === "different")
    limitations.push(
      "The observations select different declaring types; a member outside the other side's selection is unknown, not added or removed.",
    );
  else if (selectionAgreement === "unknown")
    limitations.push(
      "Selected declaring-type scope agreement is unknown because at least one observation is incomplete or lacks resolved nominal type identities; matching request names do not establish the same observed scope.",
    );
  else if (left.selection !== null && left.types.length === 0)
    limitations.push(
      "Both observations select no observed declaring types; requested and unmatched names remain in each source selection.",
    );
  else if (left.selection !== null)
    limitations.push(
      `Both observations cover only the selected declaring types (${[...new Set(left.types.map(({ full_name }) => full_name))].join(", ")}); member totals and statuses describe those types, not the whole assembly.`,
    );
  if (!hasCompleteMethodRows(left) || !hasCompleteMethodRows(right))
    limitations.push(
      "At least one observation lacks a complete MethodDef row inventory; paged or unrecorded method scope cannot establish cross-build method absence. Row intervals are reported in method_rows and describe build-local selections.",
    );
  if (!hasSignatureResolution(left) || !hasSignatureResolution(right))
    limitations.push(
      "At least one managed member observation does not attest signature type-name resolution, so signatures compare by raw bytes, which name types by build-local metadata row.",
    );
  if (left.nesting_read === null || right.nesting_read === null)
    limitations.push(
      "At least one managed member observation predates enclosing-name identity. The legacy bare-name comparison does not establish the enclosing owner of a nested type.",
    );
  if (left.exported_types === null || right.exported_types === null)
    limitations.push(
      "At least one managed member observation did not examine ExportedType rows; its exported and forwarded types are unknown.",
    );
  if (
    (left.exported_types?.length ?? 0) > 0 ||
    (right.exported_types?.length ?? 0) > 0
  )
    limitations.push(
      "ExportedType rows, including type forwarders, are observed but not compared; an unchanged comparison does not establish an unchanged exported or forwarded type set.",
    );
  limitations.push(
    "ldstr literals are not compared; normalized CIL keeps #US tokens rather than decoded text, so an unchanged method does not establish unchanged string literals.",
  );
  return limitations;
};
