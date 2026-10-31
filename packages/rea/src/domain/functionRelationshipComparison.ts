import { canonicalJson } from "./comparisonSemantics.js";
import type {
  FunctionSnapshotCoordinateContext,
  FunctionSnapshot,
} from "./functionDossierEvidence.js";
import { sorted } from "./functionComparisonNormalization.js";
import {
  hasStableNativeSymbol,
  nativeSymbolOrigin,
} from "./native/nativeSymbol.js";
import {
  referenceFactsCompatible,
  type ReferenceCompatibilityRow,
} from "./functionReferenceCompatibility.js";
import { nativeAddressInputSchema } from "./native/nativeAddress.js";

type Reference = FunctionSnapshot["dossier"]["outgoing_references"][number];
type KnownKind = Omit<
  Extract<Reference["kind"], { available: true }>,
  "available" | "provenance"
>;
type Endpoint =
  | { readonly kind: "address"; readonly address: string }
  | {
      readonly kind: "name";
      readonly name: string;
      readonly ambiguous: boolean;
    }
  | {
      readonly kind: "unknown";
      readonly reason:
        | "unparsed_address"
        | "missing_name"
        | "generated_name"
        | "symbol_origin"
        | "coordinate_context";
      readonly reported_address: string;
      readonly reported_name: string | null;
    };

interface RelationshipFact {
  readonly direction: "in" | "out";
  readonly source: Endpoint | null;
  readonly target: Endpoint;
  readonly kind: KnownKind | null;
}

export type FunctionRelationshipComparison = {
  readonly leftCount: number;
  readonly rightCount: number;
  readonly limitations: readonly string[];
} & (
  | { readonly status: "unknown" }
  | {
      readonly status: "changed" | "unchanged";
      readonly left: readonly RelationshipFact[];
      readonly right: readonly RelationshipFact[];
    }
);

/** Names observed at different procedure entries do not uniquely identify an overload. */
const ambiguousProcedureNames = (
  snapshots: readonly FunctionSnapshot[],
): Set<string> => {
  const ambiguous = new Set<string>();
  for (const snapshot of snapshots) {
    const entries = new Map<string, string>();
    const observe = (procedure: Reference["source_procedure"]): void => {
      if (procedure === null) return;
      const address = nativeAddressInputSchema.safeParse(procedure.address);
      if (!address.success) {
        ambiguous.add(procedure.name);
        return;
      }
      const previous = entries.get(procedure.name);
      if (previous !== undefined && previous !== address.data)
        ambiguous.add(procedure.name);
      entries.set(procedure.name, address.data);
    };
    observe(snapshot.dossier.procedure);
    for (const procedure of [
      ...snapshot.dossier.callers,
      ...snapshot.dossier.callees,
    ])
      observe(procedure);
    for (const edge of snapshot.dossier.incoming_references) {
      observe(edge.source_procedure);
      observe(edge.target_procedure);
    }
    for (const edge of snapshot.dossier.outgoing_references) {
      observe(edge.source_procedure);
      observe(edge.target_procedure);
    }
  }
  return ambiguous;
};

const endpoint = (
  procedure: Reference["source_procedure"],
  address: string,
  coordinateContext: "common" | "cross-artifact" | "unknown",
  ambiguousNames: ReadonlySet<string>,
): Endpoint => {
  if (coordinateContext === "common") {
    const parsed = nativeAddressInputSchema.safeParse(address);
    if (parsed.success) return { kind: "address", address: parsed.data };
    return {
      kind: "unknown",
      reason: "unparsed_address",
      reported_address: address,
      reported_name: procedure?.name ?? null,
    };
  }
  if (coordinateContext === "unknown")
    return {
      kind: "unknown",
      reason: "coordinate_context",
      reported_address: address,
      reported_name: procedure?.name ?? null,
    };
  if (
    procedure === null ||
    !hasStableNativeSymbol(procedure.name, procedure.symbol)
  )
    return {
      kind: "unknown",
      reason:
        procedure === null || procedure.name.length === 0
          ? "missing_name"
          : nativeSymbolOrigin(procedure.symbol) === "generated"
            ? "generated_name"
            : "symbol_origin",
      reported_address: address,
      reported_name: procedure?.name ?? null,
    };
  return {
    kind: "name",
    name: procedure.name,
    ambiguous: ambiguousNames.has(procedure.name),
  };
};

const project = (
  snapshot: FunctionSnapshot,
  coordinateContext: "common" | "cross-artifact" | "unknown",
  ambiguousNames: ReadonlySet<string>,
  dimension: "calls" | "references",
): RelationshipFact[] => {
  const facts: RelationshipFact[] = [];
  if (dimension === "calls") {
    for (const [direction, procedures] of [
      ["in", snapshot.dossier.callers],
      ["out", snapshot.dossier.callees],
    ] as const)
      for (const procedure of procedures)
        facts.push({
          direction,
          source: null,
          target: endpoint(
            procedure,
            procedure.address,
            coordinateContext,
            ambiguousNames,
          ),
          kind: null,
        });
    return facts;
  }
  const collect = (
    references: readonly Reference[],
    direction: "in" | "out",
  ): void => {
    for (const edge of references) {
      let kind: KnownKind | null = null;
      if (edge.kind.available) {
        const {
          available: _available,
          provenance: _provenance,
          ...known
        } = edge.kind;
        kind = known;
      }
      facts.push({
        direction,
        source: endpoint(
          edge.source_procedure,
          edge.source_address,
          coordinateContext,
          ambiguousNames,
        ),
        target: endpoint(
          edge.target_procedure,
          edge.target_address,
          coordinateContext,
          ambiguousNames,
        ),
        kind,
      });
    }
  };
  collect(snapshot.dossier.incoming_references, "in");
  collect(snapshot.dossier.outgoing_references, "out");
  return facts;
};

/** Ambiguity blocks equality, but a known label can still contradict another label. */
const endpointKey = (value: Endpoint | null): string | null => {
  if (value === null || value.kind === "unknown") return null;
  return canonicalJson(
    value.kind === "address"
      ? { address: value.address }
      : { name: value.name },
  );
};

const constraints = (
  facts: readonly RelationshipFact[],
): ReferenceCompatibilityRow[] =>
  facts.map((fact) => ({
    direction: fact.direction,
    source: endpointKey(fact.source),
    target: endpointKey(fact.target),
    kind: fact.kind === null ? null : canonicalJson(fact.kind),
  }));

/** Compare parsed endpoint and kind facts without replacing partial knowledge with absence. */
export const compareFunctionRelationships = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
  coordinateContext: FunctionSnapshotCoordinateContext,
): {
  readonly calls: FunctionRelationshipComparison;
  readonly references: FunctionRelationshipComparison;
} => {
  const ambiguousNames = ambiguousProcedureNames([left, right]);
  const compare = (dimension: "calls" | "references") =>
    compareRelationshipFacts(
      project(left, coordinateContext, ambiguousNames, dimension),
      project(right, coordinateContext, ambiguousNames, dimension),
      dimension,
      coordinateContext,
    );
  return { calls: compare("calls"), references: compare("references") };
};

const compareRelationshipFacts = (
  leftFacts: readonly RelationshipFact[],
  rightFacts: readonly RelationshipFact[],
  dimension: "calls" | "references",
  coordinateContext: "common" | "cross-artifact" | "unknown",
): FunctionRelationshipComparison => {
  let unknownIdentity = false;
  let ambiguousIdentity = false;
  let unknownKinds = false;
  for (const facts of [leftFacts, rightFacts]) {
    for (const fact of facts) {
      unknownKinds ||= dimension === "references" && fact.kind === null;
      for (const value of [fact.source, fact.target]) {
        unknownIdentity ||= value !== null && value.kind === "unknown";
        ambiguousIdentity ||=
          value !== null && value.kind === "name" && value.ambiguous;
      }
    }
  }
  const limitations: string[] = [];
  if (unknownIdentity && coordinateContext !== "unknown")
    limitations.push(
      coordinateContext === "common"
        ? "Relationship endpoint coordinates could not be parsed, so their identity remains unknown."
        : "Unnamed relationship endpoints, generated symbols and unknown symbol origins have no stable identity outside a common executable coordinate context.",
    );
  if (coordinateContext === "unknown" && (unknownIdentity || ambiguousIdentity))
    limitations.push(
      "A common executable coordinate context is not established: artifact format, known architecture and provider coordinate commitments must agree.",
    );
  if (ambiguousIdentity)
    limitations.push(
      "A relationship name cannot establish a unique comparable procedure entry, so matching names do not establish equal endpoints.",
    );
  if (unknownKinds)
    limitations.push(
      "At least one provider did not expose reference kinds, so compatible endpoints do not prove equal edge semantics.",
    );
  const context = {
    leftCount: leftFacts.length,
    rightCount: rightFacts.length,
    limitations,
  };
  if (
    !referenceFactsCompatible(constraints(leftFacts), constraints(rightFacts))
  )
    return {
      ...context,
      status: "changed",
      left: sorted(leftFacts),
      right: sorted(rightFacts),
      limitations: [
        "Known relationship facts cannot be paired without contradicting an endpoint or reference kind.",
        ...limitations,
      ],
    };
  if (unknownIdentity || ambiguousIdentity || unknownKinds)
    return { ...context, status: "unknown" };
  return {
    ...context,
    status: "unchanged",
    left: sorted(leftFacts),
    right: sorted(rightFacts),
  };
};
