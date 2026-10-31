import { createJavaScriptApplicationEdge } from "../javascript/javascriptApplicationGraph.js";
import type { ApplicationNode } from "../javascript/javascriptApplicationGraphSchemas.js";
import type { ManagedMemberInspection } from "./managedArtifact.js";
import type {
  GraphBuildState,
  ParsedManagedGraphInput,
} from "./managedApplicationGraph.js";
import { sourceManagedEvidence } from "./managedApplicationGraphNodes.js";
import type {
  ManagedRelationOmissions,
  OmittedCallReason,
  OmittedFieldAccessReason,
} from "./managedApplicationGraphCoverage.js";

/** Opcodes that transfer control to their method operand. */
const CALL_OPCODES = new Set(["call", "callvirt", "newobj", "jmp"]);

const FIELD_ACCESS_KINDS: Readonly<Record<string, string>> = {
  ldfld: "read",
  ldsfld: "read",
  stfld: "write",
  stsfld: "write",
  ldflda: "address",
  ldsflda: "address",
};

/** ECMA-335 MemberRef table tokens name members outside the defining tables. */
const isMemberReference = (token: string): boolean =>
  token.toLowerCase().startsWith("0x0a");

/** Sites of one source-target relationship, counted by opcode. */
interface AggregatedRelation {
  readonly source: ApplicationNode;
  readonly target: ApplicationNode;
  readonly opcodes: Map<string, number>;
}

const aggregate = (
  relations: Map<string, AggregatedRelation>,
  source: ApplicationNode,
  target: ApplicationNode,
  opcode: string,
): void => {
  const key = `${source.node_id}\u0000${target.node_id}`;
  let relation = relations.get(key);
  if (relation === undefined) {
    relation = { source, target, opcodes: new Map() };
    relations.set(key, relation);
  }
  relation.opcodes.set(opcode, (relation.opcodes.get(opcode) ?? 0) + 1);
};

const siteProperties = (opcodes: ReadonlyMap<string, number>) => {
  const sorted = [...opcodes].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return {
    site_count: sorted.reduce((total, [, count]) => total + count, 0),
    opcodes: Object.fromEntries(sorted),
  };
};

/**
 * Project in-module call and field-access sites from member Evidence as one
 * edge per source and target, counting every other site by reason.
 */
export const addMemberRelations = (
  state: GraphBuildState,
  parsed: ParsedManagedGraphInput,
): ManagedRelationOmissions | null => {
  const memberInput = parsed.members;
  if (memberInput === null) return null;
  const members: ManagedMemberInspection = memberInput.result;
  const callSites: Record<OmittedCallReason, number> = {
    "member-ref": 0,
    "method-spec": 0,
    "unknown-target": 0,
    "method-reference": 0,
    "absent-node": 0,
    "self-call": 0,
  };
  const fieldAccessSites: Record<OmittedFieldAccessReason, number> = {
    "member-ref": 0,
    "absent-node": 0,
  };
  const calls = new Map<string, AggregatedRelation>();
  for (const edge of members.call_edges) {
    if (edge.target_kind !== "method-def") {
      callSites[
        edge.target_kind === "unknown" ? "unknown-target" : edge.target_kind
      ]++;
      continue;
    }
    if (!CALL_OPCODES.has(edge.opcode)) {
      callSites["method-reference"]++;
      continue;
    }
    const caller = state.methodNodes.get(edge.caller_token);
    const target = state.methodNodes.get(edge.target_token);
    if (caller === undefined || target === undefined) {
      callSites["absent-node"]++;
      continue;
    }
    // Graph edges cannot be self-loops, so recursion is counted instead.
    if (caller === target) {
      callSites["self-call"]++;
      continue;
    }
    aggregate(calls, caller, target, edge.opcode);
  }
  const accesses = new Map<string, AggregatedRelation>();
  for (const access of members.field_accesses) {
    const method = state.methodNodes.get(access.method_token);
    const field = state.fieldNodes.get(access.field_token);
    if (method === undefined || field === undefined) {
      fieldAccessSites[
        isMemberReference(access.field_token) ? "member-ref" : "absent-node"
      ]++;
      continue;
    }
    aggregate(accesses, method, field, access.opcode);
  }
  const evidence = sourceManagedEvidence(
    state,
    memberInput.evidence,
    members.coverage.state,
  );
  for (const { source, target, opcodes } of calls.values())
    state.edges.push(
      createJavaScriptApplicationEdge({
        source_node_id: source.node_id,
        target_node_id: target.node_id,
        relation: "calls",
        properties: { kind: "managed-call", ...siteProperties(opcodes) },
        evidence,
      }),
    );
  for (const { source, target, opcodes } of accesses.values())
    state.edges.push(
      createJavaScriptApplicationEdge({
        source_node_id: source.node_id,
        target_node_id: target.node_id,
        relation: "accesses",
        properties: {
          kind: "managed-field-access",
          access: [
            ...new Set(
              [...opcodes.keys()].map(
                (opcode) => FIELD_ACCESS_KINDS[opcode] ?? "unknown",
              ),
            ),
          ].sort(),
          ...siteProperties(opcodes),
        },
        evidence,
      }),
    );
  return { callSites, fieldAccessSites };
};

const REASON_LABELS: Readonly<
  Record<OmittedCallReason | OmittedFieldAccessReason, string>
> = {
  "member-ref": "member-reference",
  "method-spec": "generic method-instantiation",
  "unknown-target": "unknown-target",
  "method-reference": "function-pointer (ldftn/ldvirtftn)",
  "absent-node": "missing-node",
  "self-call": "recursive self-call",
};

const describeOmissions = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(
      ([reason, count]) =>
        `${String(count)} ${REASON_LABELS[reason as keyof typeof REASON_LABELS]}`,
    )
    .join(", ");

/** Name each omitted site class so the graph never reads as complete. */
export const relationOmissionLimitations = (
  omissions: ManagedRelationOmissions | null,
): string[] => {
  if (omissions === null) return [];
  const calls = describeOmissions(omissions.callSites);
  const fields = describeOmissions(omissions.fieldAccessSites);
  return [
    ...(calls === ""
      ? []
      : [
          `Calls edges link only method nodes in the inspected module; these call sites are omitted: ${calls}.`,
        ]),
    ...(fields === ""
      ? []
      : [
          `Accesses edges link only method and field nodes in the inspected module; these field-access sites are omitted: ${fields}.`,
        ]),
  ];
};
