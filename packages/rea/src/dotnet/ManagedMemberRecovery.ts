import {
  admitManagedProjection,
  ManagedRepresentationFailure,
  type ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import {
  managedMemberInspectionSchema,
  type ManagedMemberInspection,
  type ManagedParseIssue,
} from "../domain/managed/managedArtifact.js";

type TypeInventory = Pick<
  ManagedMemberInspection,
  | "artifact"
  | "module"
  | "metadata"
  | "identity_scope"
  | "types"
  | "nesting_read"
  | "selection"
  | "method_rows"
  | "limitations"
>;

/**
 * Admit recovery before spending capacity on members. The only later value is
 * the capacity owner's byte coordinate: its longest safe-integer encoding is
 * charged now, so recovery never needs a new budget or an unchecked allocation.
 */
export const prepareManagedMemberRecovery = (
  inventory: TypeInventory,
  issues: readonly ManagedParseIssue[],
  budget: ManagedDecodeBudget,
): ((offset: number | null) => ManagedMemberInspection) => {
  const capacityIssue = new ManagedRepresentationFailure(
    Number.MAX_SAFE_INTEGER,
  ).issue;
  const report: ManagedMemberInspection = {
    ...inventory,
    metadata: { ...inventory.metadata, status: "partial" },
    signature_resolution: null,
    assembly: null,
    exported_types: null,
    fields: [],
    methods: [],
    member_refs: [],
    call_edges: [],
    field_accesses: [],
    user_strings: null,
    coverage: { state: "partial", issues: [...issues, capacityIssue] },
    limitations: [
      ...inventory.limitations,
      "Member decoding exceeded capacity after the type inventory was admitted; fields, methods, member references, call edges, field accesses, exported types and user strings are not examined to completion. Empty member collections do not establish absence.",
      "Use the returned TypeDef full_name values with type_names (CLI --type) to inspect a smaller selection; a single selected type can still exceed capacity.",
      "Metadata tokens are build-local coordinates and require the reported artifact SHA-256 and MVID. Type names and list ranges retain their original metadata and nesting uncertainty.",
    ],
  };
  admitManagedProjection(report, budget);
  // A successful full report serializes these same immutable facts once.
  // Transfer their existing charge, rather than charging the type list twice.
  for (const value of Object.values(inventory)) {
    if (value !== null && typeof value === "object") budget.prepay(value);
  }
  return (offset) =>
    managedMemberInspectionSchema.parse({
      ...report,
      coverage: {
        state: "partial",
        issues: [...issues, { ...capacityIssue, offset }],
      },
    });
};
