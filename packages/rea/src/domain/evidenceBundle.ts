import { InvalidResidualUnknownGraphError } from "./residualUnknownGraphError.js";
import { withEvidenceSubjectDeclaration } from "./evidenceSubject.js";
import { digestSchema } from "./digests.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import { err, ok, type Result } from "./result.js";
import { describeValidationFailure } from "./validationFailure.js";
import { equalJsonText } from "./jsonSerialization.js";
import { z } from "zod";
import canonicalize from "canonicalize";

import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";

import {
  evidenceSchema,
  immutableEvidence,
  parseEvidence,
  providerSchema,
  type Evidence,
} from "./evidence.js";
import {
  residualUnknownSchema,
  type ResidualUnknown,
} from "./residualUnknown.js";
import { freezeJsonSnapshot } from "./immutableJson.js";

const artifactManifestBaseSchema = z.strictObject({
  digest: z.strictObject({ sha256: digestSchema }),
});
const artifactManifestSchema = withEvidenceSubjectDeclaration(
  artifactManifestBaseSchema,
);
const providerManifestSchema = providerSchema;
const environmentManifestSchema = evidenceSchema.shape.environment.unwrap();
const scenarioManifestSchema = z.strictObject({
  evidence_id: evidenceSchema.shape.evidence_id,
  operation: z.string().min(1),
  authority: z.literal("controlled-replay"),
});
const captureManifestSchema = z.strictObject({
  evidence_id: evidenceSchema.shape.evidence_id,
  predicate_type: z.string().min(1),
});

export const evidenceBundleSchema = z.strictObject({
  artifacts: z.array(artifactManifestSchema),
  providers: z.array(providerManifestSchema),
  environments: z.array(environmentManifestSchema),
  scenarios: z.array(scenarioManifestSchema),
  captures: z.array(captureManifestSchema),
  unknowns: z.array(residualUnknownSchema),
  records: z.array(evidenceSchema),
});

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
const immutableBundles = new WeakMap<object, EvidenceBundle>();

/** Caller input has valid shape but is not in authenticated canonical form. */
export class NonCanonicalEvidenceBundleError extends TypeError {
  constructor() {
    super("Evidence bundle manifests are not canonical");
    this.name = "NonCanonicalEvidenceBundleError";
  }
}

/** Caller input lists the same Evidence record more than once. */
export class DuplicateEvidenceRecordError extends TypeError {
  constructor() {
    super("Evidence bundle contains duplicate record IDs");
    this.name = "DuplicateEvidenceRecordError";
  }
}

/** Build and authenticate a sealed bundle while reusing immutable Evidence records. */
export const createImmutableEvidenceBundle = (
  records: readonly Evidence[],
  unknowns: readonly ResidualUnknown[] = [],
): EvidenceBundle => {
  const checkedRecords = records.map(immutableEvidence);
  if (
    new Set(checkedRecords.map(({ evidence_id }) => evidence_id)).size !==
    checkedRecords.length
  )
    throw new DuplicateEvidenceRecordError();
  const checkedUnknowns = unknowns.map((unknown) =>
    residualUnknownSchema.parse(unknown),
  );
  validateUnknownGraph(checkedUnknowns, checkedRecords);
  const bundle = freezeJsonSnapshot(
    createEvidenceBundle(checkedRecords, checkedUnknowns),
  );
  immutableBundles.set(bundle, bundle);
  return bundle;
};

/** Project records into a deterministic bundle whose order has no semantics. */
export const createEvidenceBundle = (
  records: readonly Evidence[],
  unknowns: readonly ResidualUnknown[] = [],
): EvidenceBundle => {
  const sortedRecords = [...records].sort((left, right) =>
    compareUnicodeCodePoints(left.evidence_id, right.evidence_id),
  );
  return {
    artifacts: uniqueSorted(
      sortedRecords.flatMap(({ subject }) =>
        subject === null
          ? []
          : [
              artifactManifestSchema.parse({
                digest: subject.digest,
                format: subject.format,
                architecture: subject.architecture,
              }),
            ],
      ),
    ),
    providers: uniqueSorted(sortedRecords.map(({ provider }) => provider)),
    environments: uniqueSorted(
      sortedRecords.flatMap(({ environment }) =>
        environment === null ? [] : [environment],
      ),
    ),
    scenarios: sortedRecords.flatMap((evidence) =>
      evidence.authority === "controlled-replay"
        ? [
            {
              evidence_id: evidence.evidence_id,
              operation: evidence.operation,
              authority: evidence.authority,
            },
          ]
        : [],
    ),
    captures: sortedRecords.flatMap((evidence) =>
      evidence.predicate_type === "rea.process-capture"
        ? [
            {
              evidence_id: evidence.evidence_id,
              predicate_type: evidence.predicate_type,
            },
          ]
        : [],
    ),
    unknowns: [...unknowns].sort(
      (left, right) =>
        compareUnicodeCodePoints(left.unknown_id, right.unknown_id) ||
        left.revision - right.revision,
    ),
    records: sortedRecords,
  };
};

/** Retain target records and eligible complete unknown histories with their mutation evidence. */
export const evidenceBundleForTarget = (
  bundle: EvidenceBundle,
  sha256: string,
): EvidenceBundle => {
  const recordsById = new Map(
    bundle.records.map((record) => [record.evidence_id, record]),
  );
  const histories = new Map<string, ResidualUnknown[]>();
  for (const unknown of bundle.unknowns) {
    const history = histories.get(unknown.unknown_id) ?? [];
    history.push(unknown);
    histories.set(unknown.unknown_id, history);
  }
  const retained = new Set<string>();
  const dependents = new Map<string, Set<string>>();
  const relationships = new Map<string, Set<string>>();
  for (const [id, history] of histories) {
    const eligible = history.every((unknown) => {
      if (unknown.scope_digest !== sha256) return false;
      const mutationEvidenceIds = new Set(unknown.mutation_evidence_ids);
      return referencedEvidenceIds(unknown).every((evidenceId) => {
        const record = recordsById.get(evidenceId);
        // Mutation subjects record the target active at the time of an edit,
        // which need not be the question's immutable investigation scope.
        return (
          record?.subject?.digest.sha256 === sha256 ||
          (mutationEvidenceIds.has(evidenceId) &&
            record?.predicate_type === "rea.residual-unknown-mutation")
        );
      });
    });
    if (!eligible) continue;
    retained.add(id);
    const relatedIds = new Set(
      history.flatMap((unknown) =>
        unknown.relationships.map(({ unknown_id }) => unknown_id),
      ),
    );
    relationships.set(id, relatedIds);
    for (const relatedId of relatedIds) {
      const references = dependents.get(relatedId) ?? new Set<string>();
      references.add(id);
      dependents.set(relatedId, references);
    }
  }
  const pending: string[] = [];
  for (const [id, relatedIds] of relationships)
    if ([...relatedIds].some((relatedId) => !retained.has(relatedId)))
      pending.push(id);
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    if (id === undefined || !retained.delete(id)) continue;
    for (const dependent of dependents.get(id) ?? []) pending.push(dependent);
  }
  const unknowns = bundle.unknowns.filter((unknown) =>
    retained.has(unknown.unknown_id),
  );
  const mutationIds = new Set(
    unknowns.flatMap(({ mutation_evidence_ids: ids }) => ids),
  );
  return createEvidenceBundle(
    bundle.records.filter(
      (record) =>
        record.subject?.digest.sha256 === sha256 ||
        mutationIds.has(record.evidence_id),
    ),
    unknowns,
  );
};

const referencedEvidenceIds = (unknown: ResidualUnknown): readonly string[] => [
  ...unknown.supporting_evidence_ids,
  ...unknown.contradicting_evidence_ids,
  ...unknown.mutation_evidence_ids,
  ...(unknown.resolution?.evidence_ids ?? []),
];

type EvidenceBundleValidationFailure =
  | z.ZodError
  | DuplicateEvidenceRecordError
  | InvalidResidualUnknownGraphError
  | NonCanonicalEvidenceBundleError;

/** Expected source rejection, including authenticated standalone Evidence. */
export type EvidenceBundleFailure = {
  readonly kind: "single-record" | "invalid-bundle";
  readonly message: string;
  readonly cause: EvidenceBundleValidationFailure;
};

const describeEvidenceBundleFailure = (
  input: unknown,
  cause: EvidenceBundleValidationFailure,
): EvidenceBundleFailure => {
  try {
    const record = parseEvidence(input);
    return {
      kind: "single-record",
      cause,
      message: `Expected an Evidence bundle with records and manifest arrays, but this JSON is one Evidence record (${record.evidence_id}). Export a session bundle with the MCP export_evidence_bundle tool and supply that file.`,
    };
  } catch (recordFailure: unknown) {
    if (!(recordFailure instanceof z.ZodError)) throw recordFailure;
    return {
      kind: "invalid-bundle",
      cause,
      message:
        cause instanceof z.ZodError
          ? `Evidence bundle does not match the bundle schema ${describeValidationFailure(cause)}. Supply an unmodified bundle produced by this REA identity format. Recreate observations from earlier formats; re-exporting an old bundle does not update its identities.`
          : `Evidence bundle validation failed: ${describeValidationFailure(cause)}. Recreate or re-export the bundle, then try again.`,
    };
  }
};

/** Parse records, verify semantic IDs, and reject inconsistent manifests. */
export const parseEvidenceBundle = (input: unknown): EvidenceBundle => {
  return parseBundle(input, false);
};

/** Authenticate and seal snapshot-owned payloads, throwing validation failures. */
export const parseImmutableEvidenceBundle = (input: unknown): EvidenceBundle =>
  parseBundle(input, true);

/** Read expected source failures as facts; implementation failures still throw. */
export const safeParseEvidenceBundle = (
  input: unknown,
): Result<EvidenceBundle, EvidenceBundleFailure> => readBundle(input, false);

/** Authenticate and seal file-owned payloads once for downstream zero-copy reuse. */
export const safeParseImmutableEvidenceBundle = (
  input: unknown,
): Result<EvidenceBundle, EvidenceBundleFailure> => readBundle(input, true);

const parseBundle = (input: unknown, seal: boolean): EvidenceBundle => {
  if (typeof input === "object" && input !== null) {
    const owned = immutableBundles.get(input);
    if (owned !== undefined) return owned;
  }
  return authenticateBundle(evidenceBundleSchema.parse(input), seal);
};

/** Read a source bundle while preserving unexpected implementation failures. */
export const readEvidenceBundle = (
  input: unknown,
  context: {
    readonly operation: string;
    readonly path: readonly (string | number)[];
  },
): Result<EvidenceBundle, AnalysisInputError | EvidenceIntegrityError> => {
  const parsed = safeParseEvidenceBundle(input);
  if (parsed.ok) return parsed;
  const { cause, kind, message } = parsed.error;
  if (kind === "single-record")
    return err(
      new AnalysisInputError(
        context.operation,
        { cause, userMessage: message, remediationAction: message },
        [{ path: context.path, reason: "invalid_value", message }],
      ),
    );
  return err(
    new EvidenceIntegrityError(cause.message, {
      cause,
      userMessage: message,
    }),
  );
};

const readBundle = (
  input: unknown,
  seal: boolean,
): Result<EvidenceBundle, EvidenceBundleFailure> => {
  try {
    return ok(
      seal ? parseImmutableEvidenceBundle(input) : parseEvidenceBundle(input),
    );
  } catch (cause: unknown) {
    if (
      !(cause instanceof z.ZodError) &&
      !(cause instanceof DuplicateEvidenceRecordError) &&
      !(cause instanceof InvalidResidualUnknownGraphError) &&
      !(cause instanceof NonCanonicalEvidenceBundleError)
    )
      throw cause;
    return err(describeEvidenceBundleFailure(input, cause));
  }
};

/** Authenticate evidence and bundle invariants after the bundle shape is parsed. */
export const authenticateParsedEvidenceBundle = (
  parsed: EvidenceBundle,
): EvidenceBundle => authenticateBundle(parsed, false);

const authenticateBundle = (
  parsed: EvidenceBundle,
  seal: boolean,
): EvidenceBundle => {
  const recordIds = parsed.records.map(({ evidence_id: id }) => id);
  if (new Set(recordIds).size !== recordIds.length)
    throw new DuplicateEvidenceRecordError();
  validateUnknownGraph(parsed.unknowns, parsed.records);
  const canonical = createEvidenceBundle(
    parsed.records.map((record, index) => {
      try {
        if (!seal) return parseEvidence(record);
        // Schema parsing gave this boundary exclusive ownership. Register only
        // validated payloads before authenticating the complete record envelope.
        record.normalized_result = freezeJsonSnapshot(record.normalized_result);
        record.raw_result = freezeJsonSnapshot(record.raw_result);
        return immutableEvidence(record);
      } catch (cause: unknown) {
        if (cause instanceof z.ZodError)
          throw new z.ZodError(
            cause.issues.map((issue) => ({
              ...issue,
              path: ["records", index, ...issue.path],
            })),
          );
        throw cause;
      }
    }),
    parsed.unknowns,
  );
  if (!equalJsonText(parsed, canonical))
    throw new NonCanonicalEvidenceBundleError();
  if (seal) {
    freezeJsonSnapshot(canonical);
    immutableBundles.set(canonical, canonical);
  }
  return canonical;
};

const validateUnknownGraph = (
  unknowns: readonly ResidualUnknown[],
  records: readonly Evidence[],
): void => {
  const evidenceById = new Map(
    records.map((record) => [record.evidence_id, record]),
  );
  const histories = new Map<string, ResidualUnknown[]>();
  for (const unknown of unknowns) {
    const history = histories.get(unknown.unknown_id) ?? [];
    history.push(unknown);
    histories.set(unknown.unknown_id, history);
  }
  const unknownById = new Map<string, ResidualUnknown>();
  for (const [id, unordered] of histories) {
    const history = [...unordered].sort(
      (left, right) => left.revision - right.revision,
    );
    for (const [index, revision] of history.entries()) {
      if (revision.revision !== index + 1)
        throw new InvalidResidualUnknownGraphError({
          kind: "history_gap",
          unknown_id: id,
        });
      if (
        index > 0 &&
        revision.previous_revision_digest !==
          history[index - 1]?.revision_digest
      )
        throw new InvalidResidualUnknownGraphError({
          kind: "revision_chain",
          unknown_id: id,
        });
    }
    const head = history.at(-1);
    if (head === undefined)
      throw new TypeError("Residual unknown revision history is empty");
    unknownById.set(id, head);
  }
  for (const unknown of unknowns) {
    const referencedEvidence = [
      ...unknown.supporting_evidence_ids,
      ...unknown.contradicting_evidence_ids,
      ...unknown.mutation_evidence_ids,
      ...(unknown.resolution?.evidence_ids ?? []),
    ];
    for (const evidenceId of referencedEvidence)
      if (!evidenceById.has(evidenceId))
        throw new InvalidResidualUnknownGraphError({
          kind: "missing_evidence",
          unknown_id: unknown.unknown_id,
          evidence_id: evidenceId,
        });
    for (const relationship of unknown.relationships)
      if (!unknownById.has(relationship.unknown_id))
        throw new InvalidResidualUnknownGraphError({
          kind: "missing_unknown",
          unknown_id: unknown.unknown_id,
          related_unknown_id: relationship.unknown_id,
        });
    if (unknown.resolution?.disposition === "verified")
      validateVerifiedResolution(unknown, evidenceById);
  }
  rejectDependencyCycles(unknownById);
};

const validateVerifiedResolution = (
  unknown: ResidualUnknown,
  evidenceById: Pick<ReadonlyMap<string, Evidence>, "get">,
): void => {
  if (unknown.contradicting_evidence_ids.length > 0)
    throw new InvalidResidualUnknownGraphError({
      kind: "contradicting_evidence",
      unknown_id: unknown.unknown_id,
    });
  const qualifies = unknown.resolution?.evidence_ids.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return (
      unknown.supporting_evidence_ids.includes(evidenceId) &&
      evidence !== undefined &&
      evidence.predicate_type !== "rea.residual-unknown-mutation" &&
      evidenceQualifies(unknown, evidence)
    );
  });
  if (qualifies !== true)
    throw new InvalidResidualUnknownGraphError({
      kind: "resolution_unproven",
      unknown_id: unknown.unknown_id,
    });
};

/**
 * Validate one new residual-unknown revision against an already valid ledger.
 * This keeps ordinary mutations proportional to the affected revision while
 * full bundle imports continue to validate the complete graph.
 */
export const validateResidualUnknownAddition = (
  unknown: ResidualUnknown,
  evidenceById: Pick<ReadonlyMap<string, Evidence>, "get" | "has">,
  currentHeads: ReadonlyMap<string, ResidualUnknown>,
): void => {
  const current = currentHeads.get(unknown.unknown_id);
  if (
    current === undefined
      ? unknown.revision !== 1 || unknown.previous_revision_digest !== null
      : unknown.revision !== current.revision + 1 ||
        unknown.previous_revision_digest !== current.revision_digest
  )
    throw new InvalidResidualUnknownGraphError({
      kind: "revision_chain",
      unknown_id: unknown.unknown_id,
    });
  for (const evidenceId of referencedEvidenceIds(unknown))
    if (!evidenceById.has(evidenceId))
      throw new InvalidResidualUnknownGraphError({
        kind: "missing_evidence",
        unknown_id: unknown.unknown_id,
        evidence_id: evidenceId,
      });
  for (const relationship of unknown.relationships)
    if (
      relationship.unknown_id !== unknown.unknown_id &&
      !currentHeads.has(relationship.unknown_id)
    )
      throw new InvalidResidualUnknownGraphError({
        kind: "missing_unknown",
        unknown_id: unknown.unknown_id,
        related_unknown_id: relationship.unknown_id,
      });
  if (unknown.resolution?.disposition === "verified")
    validateVerifiedResolution(unknown, evidenceById);
  // In a valid graph, no existing node can point to an absent ID. Since the
  // schema rejects self-relations, a new node's outgoing edges cannot close a
  // cycle; keep graph traversal for revisions of existing nodes only.
  if (current !== undefined) {
    const dependencies = unknown.relationships
      .filter((relationship) => relationship.type === "depends-on")
      .map(({ unknown_id }) => unknown_id);
    if (
      dependencies.length > 0 &&
      reachesUnknown(dependencies, unknown.unknown_id, currentHeads, unknown)
    )
      throw new InvalidResidualUnknownGraphError({
        kind: "dependency_cycle",
        unknown_id: unknown.unknown_id,
      });
  }
};

const reachesUnknown = (
  starts: readonly string[],
  goal: string,
  currentHeads: ReadonlyMap<string, ResidualUnknown>,
  candidate: ResidualUnknown,
): boolean => {
  const pending = [...starts];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    if (id === goal) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const unknown =
      id === candidate.unknown_id ? candidate : currentHeads.get(id);
    if (unknown === undefined) continue;
    for (const relationship of unknown.relationships)
      if (relationship.type === "depends-on")
        pending.push(relationship.unknown_id);
  }
  return false;
};

const evidenceQualifies = (
  unknown: ResidualUnknown,
  evidence: Evidence,
): boolean => {
  if (
    unknown.required_authority !== null &&
    evidence.authority !== unknown.required_authority
  )
    return false;
  const confidenceRank = { inferred: 1, derived: 2, observed: 3 } as const;
  if (
    confidenceRank[evidence.confidence] <
    confidenceRank[unknown.required_confidence]
  )
    return false;
  const requirement = unknown.required_environment;
  if (requirement === null) return true;
  if (evidence.environment === null) return false;
  return (
    (requirement.id === null || requirement.id === evidence.environment.id) &&
    (requirement.platform === null ||
      requirement.platform === evidence.environment.platform) &&
    (requirement.architecture === null ||
      requirement.architecture === evidence.environment.architecture) &&
    (requirement.isolation === null ||
      requirement.isolation === evidence.environment.isolation)
  );
};

const rejectDependencyCycles = (
  unknownById: ReadonlyMap<string, ResidualUnknown>,
): void => {
  const visited = new Set<string>();
  const active = new Set<string>();
  const pending: {
    readonly id: string;
    readonly relationships: ResidualUnknown["relationships"];
    nextRelationship: number;
  }[] = [];
  for (const root of unknownById.keys()) {
    if (visited.has(root)) continue;
    const rootUnknown = unknownById.get(root);
    if (rootUnknown === undefined)
      throw new TypeError("Residual unknown dependency graph is inconsistent");
    active.add(root);
    pending.push({
      id: root,
      relationships: rootUnknown.relationships,
      nextRelationship: 0,
    });
    while (pending.length > 0) {
      const frame = pending[pending.length - 1];
      if (frame === undefined) break;
      let descended = false;
      while (frame.nextRelationship < frame.relationships.length) {
        const relationship = frame.relationships[frame.nextRelationship];
        frame.nextRelationship += 1;
        if (relationship?.type !== "depends-on") continue;
        const dependency = relationship.unknown_id;
        if (active.has(dependency))
          throw new InvalidResidualUnknownGraphError({
            kind: "dependency_cycle",
            unknown_id: dependency,
          });
        if (visited.has(dependency)) continue;
        const unknown = unknownById.get(dependency);
        if (unknown === undefined)
          throw new TypeError(
            "Residual unknown dependency graph is inconsistent",
          );
        active.add(dependency);
        pending.push({
          id: dependency,
          relationships: unknown.relationships,
          nextRelationship: 0,
        });
        descended = true;
        break;
      }
      if (descended) continue;
      pending.pop();
      active.delete(frame.id);
      visited.add(frame.id);
    }
  }
};

/** Encode a validated bundle as byte-stable RFC 8785 canonical JSON. */
export const serializeEvidenceBundle = (bundle: EvidenceBundle): string => {
  const serialized = canonicalize(parseEvidenceBundle(bundle));
  if (serialized === undefined)
    throw new TypeError("Evidence bundle canonicalization failed");
  return serialized;
};

const uniqueSorted = <Value>(values: readonly Value[]): Value[] => {
  const unique = new Map<string, Value>();
  for (const value of values) unique.set(JSON.stringify(value), value);
  return [...unique.entries()]
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
    .map(([, value]) => value);
};
