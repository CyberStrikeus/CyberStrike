import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import { z } from "zod";

import { withEvidenceSubjectDeclaration } from "./evidenceSubject.js";

import {
  compareUnicodeCodePoints,
  compositeKey,
} from "./unicodeCodePointOrder.js";
import { localPathStringSchema } from "./localPath.js";

import {
  analysisProfileSchema,
  analysisProfilesEqual,
  committedProviderSchema,
  committedProvidersEqual,
  type AnalysisProfileCommitment,
} from "./analysisProfile.js";
import {
  BINARY_ARCHITECTURES,
  RAW_ONLY_ARCHITECTURES,
  type BinaryTarget,
} from "./binaryTargetTypes.js";
import {
  evidenceBundleForTarget,
  evidenceBundleSchema,
  parseEvidenceBundle,
  parseImmutableEvidenceBundle,
} from "./evidenceBundle.js";
import {
  evidenceLocationSchema,
  rebindEvidenceToTargetPath,
  type Evidence,
  type EvidenceLocation,
  type EvidenceSubjectTarget,
} from "./evidence.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "./jsonValue.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { canonicalJsonDigestSteps } from "./canonicalJsonDigestSteps.js";
import { freezeJsonSnapshot } from "./immutableJson.js";
import {
  binaryArchitectureSchema,
  rawBinaryEntryPointSchema,
} from "./rawBinary.js";
import {
  relationshipCoverageSchema,
  type RelationshipCoverage,
} from "./relationshipCoverage.js";

const architectureSchema = z.enum(BINARY_ARCHITECTURES);
const formatSchema = z.enum([
  "analysis-database",
  "mach-o",
  "mach-o-universal",
  "elf",
  "pe",
  "dos-mz",
  "dos-com",
  "raw-binary",
  "gamecube-dol",
  "zip",
  "ipa",
  "apk",
  "msix",
  "appx",
  "hap",
  "hsp",
  "app-pack",
  "asar",
  "ines",
  "godot-pck",
  "unityfs",
  "dmg",
  "pkg",
  "intel-hex",
  "srec",
  "esp-image",
  "uf2",
  "dfuse",
  "esp-flash-image",
  "fit",
  "plist",
  "javascript",
  "source-map",
  "uimage",
]);
const kindSchema = z.enum(["executable", "database", "archive", "artifact"]);
const subjectBaseSchema = z.object({
  path: localPathStringSchema,
  sha256: digestSchema,
});
const subjectSchema = withEvidenceSubjectDeclaration(subjectBaseSchema);
const targetIdentitySchema = z.object({
  sha256: digestSchema,
  kind: kindSchema,
  architecture: architectureSchema.nullable(),
});
const targetSchema = z.discriminatedUnion("format", [
  targetIdentitySchema.extend({
    format: z.enum(
      formatSchema.options.filter(
        (format) =>
          format !== "raw-binary" &&
          format !== "gamecube-dol" &&
          format !== "esp-flash-image",
      ),
    ),
    architecture: architectureSchema
      .exclude([...RAW_ONLY_ARCHITECTURES])
      .nullable(),
  }),
  targetIdentitySchema.extend({
    format: z.literal("raw-binary"),
    kind: z.literal("executable"),
    architecture: binaryArchitectureSchema,
    entry_point: rawBinaryEntryPointSchema,
  }),
  targetIdentitySchema.extend({
    format: z.literal("gamecube-dol"),
    kind: z.literal("executable"),
    architecture: z.literal("powerpc"),
    entry_point: rawBinaryEntryPointSchema,
  }),
  // The caller's inputs select how the dump is read, so they are identity.
  targetIdentitySchema.extend({
    format: z.literal("esp-flash-image"),
    kind: z.literal("archive"),
    architecture: z.null(),
    flash_offset: z.number().int().min(0).max(0xffff_ffff).nullable(),
    partition_table_offset: z.number().int().min(0).max(0xffff_ffff).nullable(),
  }),
]);
const bindingSchema = z
  .object({
    provider: committedProviderSchema,
    analysis_profile: analysisProfileSchema,
  })
  .superRefine((binding, context) => {
    if (
      !committedProvidersEqual(
        binding.provider,
        binding.analysis_profile.provider,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Snapshot binding provider does not match analysis profile",
      });
  });
const entrySchema = z.object({
  query_id: prefixedDigestSchema("query"),
  operation: z.string().min(1),
  parameters: jsonObjectSchema,
  execution: z.object({
    result: jsonValueSchema,
    raw_result: jsonValueSchema.nullable(),
    provider: committedProviderSchema,
    limitations: z.array(z.string()),
    relationship_coverage: relationshipCoverageSchema.nullable(),
    locations: z.array(evidenceLocationSchema),
    subject: subjectSchema.nullable(),
  }),
});
const workflowEntrySchema = entrySchema.extend({
  execution: entrySchema.shape.execution.extend({
    analysis_profile: analysisProfileSchema,
  }),
});

/** Provider- and profile-exact cache of successful immutable analysis calls. */
export const analysisSnapshotSchema = z.object({
  target: targetSchema,
  binding: bindingSchema,
  entries: z.array(entrySchema),
  workflow_entries: z.array(workflowEntrySchema),
  evidence_bundle: evidenceBundleSchema,
});

export type AnalysisSnapshot = z.infer<typeof analysisSnapshotSchema>;
export type AnalysisSnapshotEntry = z.infer<typeof entrySchema>;
export type AnalysisSnapshotWorkflowEntry = z.infer<typeof workflowEntrySchema>;
export type AnalysisSnapshotTarget = z.infer<typeof targetSchema>;
export type AnalysisSnapshotBinding = z.infer<typeof bindingSchema>;

// These handles only represent entries parsed in this realm. File readers can
// release their payloads while retaining an authenticated comparison operand.
const preparedEntryBrand = Symbol("prepared-snapshot-entry");
export interface PreparedSnapshotEntry {
  readonly [preparedEntryBrand]: true;
}
type EntryMetadata = Omit<AnalysisSnapshotEntry, "execution"> & {
  readonly execution: Omit<
    AnalysisSnapshotEntry["execution"],
    "result" | "raw_result"
  >;
};
type WorkflowMetadata = Omit<AnalysisSnapshotWorkflowEntry, "execution"> & {
  readonly execution: Omit<
    AnalysisSnapshotWorkflowEntry["execution"],
    "result" | "raw_result"
  >;
};
type PreparedEntry =
  | {
      readonly kind: "provider";
      readonly entry: EntryMetadata;
      readonly digest: string;
    }
  | {
      readonly kind: "workflow";
      readonly entry: WorkflowMetadata;
      readonly digest: string;
    };
const preparedEntries = new WeakMap<PreparedSnapshotEntry, PreparedEntry>();

/** Capture a cache entry without retaining a second copy of its full payload. */
export const prepareSnapshotEntry = (
  input: unknown,
  kind: "provider" | "workflow",
): PreparedSnapshotEntry => {
  const handle: PreparedSnapshotEntry = Object.freeze({
    [preparedEntryBrand]: true as const,
  });
  if (kind === "provider") {
    const entry = entrySchema.parse(input);
    const { result, raw_result, ...execution } = entry.execution;
    preparedEntries.set(handle, {
      kind,
      entry: { ...entry, execution },
      digest: snapshotContentDigest(result, raw_result, execution),
    });
  } else {
    const entry = workflowEntrySchema.parse(input);
    const { result, raw_result, ...execution } = entry.execution;
    preparedEntries.set(handle, {
      kind,
      entry: { ...entry, execution },
      digest: snapshotContentDigest(result, raw_result, execution),
    });
  }
  return handle;
};

const snapshotFileHeaderSchema = z.object({
  target: targetSchema,
  binding: bindingSchema,
  evidence_bundle: z.unknown(),
});

/** Reconstruct file entries only from fully authenticated matching Evidence. */
export const parsePreparedAnalysisSnapshot = (
  input: unknown,
  entries: readonly PreparedSnapshotEntry[],
  workflowEntries: readonly PreparedSnapshotEntry[],
): AnalysisSnapshot => {
  const header = snapshotFileHeaderSchema.parse(input);
  const bundle = parseImmutableEvidenceBundle(header.evidence_bundle);
  const providerRows = entries.map((handle) => {
    const row = preparedEntries.get(handle);
    if (row?.kind !== "provider")
      throw new TypeError(
        "Analysis snapshot entry was not parsed in this realm",
      );
    return row;
  });
  const workflowRows = workflowEntries.map((handle) => {
    const row = preparedEntries.get(handle);
    if (row?.kind !== "workflow")
      throw new TypeError(
        "Analysis snapshot workflow entry was not parsed in this realm",
      );
    return row;
  });
  const restored = sealSnapshot(
    restoreSnapshot(header, bundle, providerRows, workflowRows),
  );
  for (const handle of [...entries, ...workflowEntries])
    preparedEntries.delete(handle);
  return restored;
};

const contentDigest = (value: JsonValue): string => {
  const steps = canonicalJsonDigestSteps(value);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

const snapshotContentDigest = (
  result: JsonValue,
  rawResult: JsonValue | null,
  execution: Pick<
    AnalysisSnapshotEntry["execution"],
    "limitations" | "locations" | "subject" | "relationship_coverage"
  >,
): string => {
  const metadata = jsonObjectSchema.parse({
    limitations: execution.limitations,
    locations: execution.locations,
    subject:
      execution.subject === null
        ? null
        : {
            local_path: execution.subject.path,
            sha256: execution.subject.sha256,
            format: execution.subject.format,
            architecture: execution.subject.architecture,
          },
    relationship_coverage: execution.relationship_coverage,
  });
  return contentDigest({
    ...metadata,
    normalized_result: result,
    raw_result: rawResult,
  });
};

const evidenceContentDigest = (evidence: Evidence): string => {
  return contentDigest({
    ...jsonObjectSchema.parse(evidenceContentMetadata(evidence)),
    normalized_result: evidence.normalized_result,
    raw_result: evidence.raw_result,
  });
};

interface SnapshotExecution {
  readonly result: JsonValue;
  readonly rawResult: JsonValue | null;
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly version: string | null;
  };
  readonly analysisProfile?: AnalysisProfileCommitment;
  readonly limitations: readonly string[];
  readonly relationshipCoverage?: RelationshipCoverage | null | undefined;
  readonly locations: readonly EvidenceLocation[];
  readonly subject: EvidenceSubjectTarget | null;
}

type SnapshotExecutionProjection = Pick<
  AnalysisSnapshotEntry["execution"],
  | "result"
  | "raw_result"
  | "provider"
  | "limitations"
  | "relationship_coverage"
  | "locations"
  | "subject"
>;

/** Own one execution's snapshot data independently of its caller-visible result. */
const snapshotExecutionProjection = (
  execution: SnapshotExecution,
  provider: AnalysisSnapshotEntry["execution"]["provider"],
): SnapshotExecutionProjection =>
  entrySchema.shape.execution.parse({
    result: execution.result,
    raw_result: execution.rawResult,
    provider,
    limitations: execution.limitations,
    relationship_coverage: execution.relationshipCoverage ?? null,
    locations: execution.locations,
    subject:
      execution.subject === null
        ? null
        : {
            ...execution.subject,
            architecture: execution.subject.architecture ?? null,
          },
  });

const canonicalJson = (value: unknown): string => {
  const json = jsonValueSchema.parse(value);
  const encoded = canonicalize(json);
  if (encoded === undefined)
    throw new TypeError("RFC 8785 canonicalization rejected snapshot data");
  return encoded;
};

/** Project a binary into the path-free identity used for cache invalidation. */
export const snapshotTarget = (target: BinaryTarget): AnalysisSnapshotTarget =>
  target.format === "raw-binary"
    ? {
        sha256: target.sha256,
        kind: target.kind,
        architecture: target.architecture,
        format: target.format,
        entry_point: target.entryPoint,
      }
    : target.format === "gamecube-dol"
      ? {
          sha256: target.sha256,
          kind: target.kind,
          architecture: target.architecture,
          format: target.format,
          entry_point: target.entryPoint,
        }
      : target.format === "esp-flash-image"
        ? {
            sha256: target.sha256,
            kind: target.kind,
            architecture: null,
            format: target.format,
            flash_offset: target.espFlash.flashOffset,
            partition_table_offset: target.espFlash.partitionTableOffset,
          }
        : {
            sha256: target.sha256,
            kind: target.kind,
            architecture: target.architecture ?? null,
            format: target.format,
          };

/** Build the immutable provider/profile binding used by a cached snapshot. */
export const snapshotBinding = (
  profile: AnalysisProfileCommitment,
): AnalysisSnapshotBinding =>
  bindingSchema.parse({
    provider: profile.provider,
    analysis_profile: profile,
  });

/** Compare an open binary with the immutable target identity in a snapshot. */
export const snapshotMatchesTarget = (
  snapshot: AnalysisSnapshotTarget,
  target: BinaryTarget,
): boolean =>
  snapshot.sha256 === target.sha256 &&
  snapshot.kind === target.kind &&
  snapshot.format === target.format &&
  snapshot.architecture === (target.architecture ?? null) &&
  (snapshot.format !== "raw-binary" ||
    (target.format === "raw-binary" &&
      snapshot.entry_point === target.entryPoint)) &&
  (snapshot.format !== "gamecube-dol" ||
    (target.format === "gamecube-dol" &&
      snapshot.entry_point === target.entryPoint)) &&
  (snapshot.format !== "esp-flash-image" ||
    (target.format === "esp-flash-image" &&
      snapshot.flash_offset === target.espFlash.flashOffset &&
      snapshot.partition_table_offset ===
        target.espFlash.partitionTableOffset));

/** Compare a snapshot binding with the selected concrete analysis profile. */
export const snapshotMatchesProfile = (
  binding: AnalysisSnapshotBinding,
  profile: AnalysisProfileCommitment,
): boolean =>
  committedProvidersEqual(binding.provider, profile.provider) &&
  analysisProfilesEqual(binding.analysis_profile, profile);

/** Require an exact target and selected provider/profile cache partition. */
export const snapshotMatchesBinding = (
  snapshot: Pick<AnalysisSnapshot, "target" | "binding">,
  target: BinaryTarget,
  profile: AnalysisProfileCommitment,
): boolean =>
  snapshotMatchesTarget(snapshot.target, target) &&
  snapshotMatchesProfile(snapshot.binding, profile);

/** Find exact persisted CLI Evidence without starting an analysis provider. */
export const snapshotEvidenceForQuery = (
  snapshot: AnalysisSnapshot,
  query: {
    readonly target: BinaryTarget;
    readonly bindingProfile: AnalysisProfileCommitment;
    readonly operation: string;
    readonly parameters: Readonly<Record<string, JsonValue>>;
    readonly provider: SnapshotExecution["provider"];
    readonly evidenceProfile: AnalysisProfileCommitment;
  },
): Evidence | undefined => {
  const {
    target,
    bindingProfile,
    operation,
    parameters,
    provider,
    evidenceProfile,
  } = query;
  if (!snapshotMatchesBinding(snapshot, target, bindingProfile))
    return undefined;
  const encodedParameters = canonicalJson(parameters);
  const queryId = analysisQueryId(
    snapshot.target,
    snapshot.binding,
    operation,
    parameters,
  );
  const entry = snapshot.entries.find(
    (candidate) => candidate.query_id === queryId,
  );
  const workflowEntry = snapshot.workflow_entries.find(
    (candidate) => candidate.query_id === queryId,
  );
  if (entry === undefined && workflowEntry === undefined) return undefined;
  let evidence: Evidence | undefined;
  for (const record of snapshot.evidence_bundle.records) {
    if (
      !(
        record.subject?.digest.sha256 === target.sha256 &&
        record.operation === operation &&
        committedProvidersEqual(record.provider, provider) &&
        record.analysis_profile !== null &&
        analysisProfilesEqual(record.analysis_profile, evidenceProfile) &&
        canonicalJson(record.parameters) === encodedParameters &&
        ((entry !== undefined &&
          evidenceMatchesEntry(record, entry, snapshot)) ||
          (workflowEntry !== undefined &&
            evidenceMatchesWorkflowEntry(record, workflowEntry, snapshot)))
      )
    )
      continue;
    // Entries bind the result, not every part of the Evidence commitment
    // (for example, upstream links). Do not choose provenance by ID sort order.
    if (evidence !== undefined && evidence.evidence_id !== record.evidence_id)
      return undefined;
    evidence = record;
  }
  return evidence === undefined
    ? undefined
    : rebindEvidenceToTargetPath(evidence, target);
};

/** Create one exact replay record for a derived application workflow result. */
export const createAnalysisSnapshotWorkflowEntry = (input: {
  readonly target: AnalysisSnapshotTarget;
  readonly binding: AnalysisSnapshotBinding;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly execution: SnapshotExecution & {
    readonly analysisProfile: AnalysisProfileCommitment;
  };
}): AnalysisSnapshotWorkflowEntry => {
  const { target, binding, operation, parameters, execution } = input;
  if (
    !committedProvidersEqual(
      execution.provider,
      execution.analysisProfile.provider,
    )
  )
    throw new TypeError(
      "Workflow snapshot execution provider does not match its profile",
    );
  return {
    query_id: analysisQueryId(target, binding, operation, parameters),
    operation,
    parameters: jsonObjectSchema.parse(parameters),
    execution: {
      ...snapshotExecutionProjection(
        execution,
        execution.analysisProfile.provider,
      ),
      analysis_profile: analysisProfileSchema.parse(execution.analysisProfile),
    },
  };
};

/** Match an authenticated Evidence record to one exact provider cache binding. */
export const evidenceMatchesEntry = (
  evidence: Evidence,
  entry: AnalysisSnapshotEntry,
  snapshot: Pick<AnalysisSnapshot, "target" | "binding">,
): boolean =>
  isCorrespondingEvidence(evidence, snapshot) &&
  compositeKey([
    evidenceQueryKey(evidence),
    evidenceContentDigest(evidence),
  ]) === entryEvidenceKey(entry, snapshot.binding);

/** Compute the stable lookup key for one provider/profile-specific query. */
export const analysisQueryId = (
  target: AnalysisSnapshotTarget,
  binding: AnalysisSnapshotBinding,
  operation: string,
  parameters: Readonly<Record<string, JsonValue>>,
): string =>
  `query_${createHash("sha256")
    .update(canonicalJson({ target, binding, operation, parameters }))
    .digest("hex")}`;

/** Create one serializable snapshot entry from a successful provider call. */
export const createAnalysisSnapshotEntry = (input: {
  readonly target: AnalysisSnapshotTarget;
  readonly binding: AnalysisSnapshotBinding;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly execution: SnapshotExecution;
}): AnalysisSnapshotEntry => {
  const { target, binding, operation, parameters, execution } = input;
  if (
    execution.analysisProfile === undefined ||
    !snapshotMatchesProfile(binding, execution.analysisProfile) ||
    !committedProvidersEqual(execution.provider, binding.provider)
  )
    throw new TypeError(
      "Snapshot execution does not match its provider/profile binding",
    );
  return {
    query_id: analysisQueryId(target, binding, operation, parameters),
    operation,
    parameters: jsonObjectSchema.parse(parameters),
    execution: snapshotExecutionProjection(execution, binding.provider),
  };
};

const validatedSnapshots = new WeakMap<object, AnalysisSnapshot>();

/** Parse a provider/profile-exact snapshot and verify its entries and evidence. */
export const parseAnalysisSnapshot = (input: unknown): AnalysisSnapshot =>
  authenticateSnapshot(input).parsed;

const authenticateSnapshot = (
  input: unknown,
): {
  readonly parsed: AnalysisSnapshot;
  readonly restored: AnalysisSnapshot;
} => {
  if (typeof input === "object" && input !== null) {
    const owned = validatedSnapshots.get(input);
    if (owned !== undefined) return { parsed: owned, restored: owned };
  }
  const parsed = analysisSnapshotSchema.parse(input);
  const restored = restoreSnapshot(
    parsed,
    parseEvidenceBundle(parsed.evidence_bundle),
    parsed.entries.map((entry) => ({
      kind: "provider",
      entry,
      digest: snapshotContentDigest(
        entry.execution.result,
        entry.execution.raw_result,
        entry.execution,
      ),
    })),
    parsed.workflow_entries.map((entry) => ({
      kind: "workflow",
      entry,
      digest: snapshotContentDigest(
        entry.execution.result,
        entry.execution.raw_result,
        entry.execution,
      ),
    })),
  );
  return { parsed, restored };
};

/** Own an authenticated immutable cache while preserving mutable caller exports. */
export const immutableAnalysisSnapshot = (input: unknown): AnalysisSnapshot =>
  sealSnapshot(authenticateSnapshot(input).restored);

const sealSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => {
  for (const entry of [...snapshot.entries, ...snapshot.workflow_entries]) {
    freezeJsonSnapshot(entry.execution.result);
    freezeJsonSnapshot(entry.execution.raw_result);
  }
  freezeJsonSnapshot(snapshot);
  validatedSnapshots.set(snapshot, snapshot);
  return snapshot;
};

const restoreSnapshot = (
  header: Pick<AnalysisSnapshot, "target" | "binding">,
  bundle: AnalysisSnapshot["evidence_bundle"],
  providerRows: readonly Extract<PreparedEntry, { kind: "provider" }>[],
  workflowRows: readonly Extract<PreparedEntry, { kind: "workflow" }>[],
): AnalysisSnapshot => {
  const scopedEvidence = evidenceBundleForTarget(bundle, header.target.sha256);
  if (
    scopedEvidence.records.length !== bundle.records.length ||
    scopedEvidence.unknowns.length !== bundle.unknowns.length
  )
    throw new TypeError(
      "Analysis snapshot evidence contains records for another target",
    );
  if (!hasCanonicalQueryOrder(providerRows.map(({ entry }) => entry)))
    throw new TypeError("Analysis snapshot entries are not canonical");
  if (!hasCanonicalQueryOrder(workflowRows.map(({ entry }) => entry)))
    throw new TypeError("Analysis snapshot workflow entries are not canonical");
  const ids = new Set<string>();
  const corresponding = new Set<string>();
  const matching = new Map<string, Evidence>();
  for (const evidence of bundle.records) {
    if (
      evidence.predicate_type !== "rea.analysis" ||
      evidence.authority !== "shipped-artifact" ||
      evidence.subject?.digest.sha256 !== header.target.sha256 ||
      evidence.analysis_profile === null ||
      (evidence.confidence !== "observed" && evidence.confidence !== "derived")
    )
      continue;
    if (
      evidence.confidence === "observed" &&
      !isCorrespondingEvidence(evidence, header)
    )
      continue;
    const query = compositeKey([
      evidence.confidence,
      evidenceQueryKey(evidence),
    ]);
    corresponding.add(query);
    matching.set(
      compositeKey([query, evidenceContentDigest(evidence)]),
      evidence,
    );
  }
  const find = (
    query: string,
    digest: string,
    label: string,
    operation: string,
  ): Evidence => {
    const evidence = matching.get(compositeKey([query, digest]));
    if (evidence !== undefined) return evidence;
    throw new TypeError(
      corresponding.has(query)
        ? `Analysis snapshot ${label} ${operation} differs from its Evidence record`
        : `Analysis snapshot ${label} ${operation} has no profile-bound Evidence record`,
    );
  };
  const checkId = (
    entry: EntryMetadata | WorkflowMetadata,
    workflow: boolean,
  ): void => {
    const expected = analysisQueryId(
      header.target,
      header.binding,
      entry.operation,
      entry.parameters,
    );
    if (entry.query_id !== expected)
      throw new TypeError(
        workflow
          ? "Analysis snapshot workflow query identifier does not match"
          : "Analysis snapshot query identifier does not match",
      );
    if (ids.has(entry.query_id))
      throw new TypeError("Analysis snapshot contains duplicate queries");
    ids.add(entry.query_id);
  };
  const entries = providerRows.map(({ entry, digest }) => {
    if (
      !committedProvidersEqual(
        entry.execution.provider,
        header.binding.provider,
      )
    )
      throw new TypeError("Analysis snapshot entry provider does not match");
    checkId(entry, false);
    const evidence = find(
      compositeKey(["observed", entryQueryKey(entry, header.binding)]),
      digest,
      "entry",
      entry.operation,
    );
    return {
      ...entry,
      execution: {
        ...entry.execution,
        result: evidence.normalized_result,
        raw_result: evidence.raw_result,
      },
    };
  });
  const workflow_entries = workflowRows.map(({ entry, digest }) => {
    const provider = entry.execution.analysis_profile.provider;
    if (!committedProvidersEqual(entry.execution.provider, provider))
      throw new TypeError(
        "Analysis snapshot workflow entry provider does not match its profile",
      );
    checkId(entry, true);
    const evidence = find(
      compositeKey(["derived", workflowEntryQueryKey(entry)]),
      digest,
      "workflow entry",
      entry.operation,
    );
    return {
      ...entry,
      execution: {
        ...entry.execution,
        result: evidence.normalized_result,
        raw_result: evidence.raw_result,
      },
    };
  });
  return {
    target: header.target,
    binding: header.binding,
    entries,
    workflow_entries,
    evidence_bundle: bundle,
  };
};

const hasCanonicalQueryOrder = (
  entries: readonly { readonly query_id: string }[],
): boolean => {
  let previous: string | undefined;
  for (const { query_id: queryId } of entries) {
    if (
      previous !== undefined &&
      compareUnicodeCodePoints(previous, queryId) > 0
    )
      return false;
    previous = queryId;
  }
  return true;
};

const isCorrespondingEvidence = (
  evidence: Evidence,
  snapshot: Pick<AnalysisSnapshot, "target" | "binding">,
): boolean =>
  evidence.predicate_type === "rea.analysis" &&
  evidence.confidence === "observed" &&
  evidence.authority === "shipped-artifact" &&
  evidence.subject?.digest.sha256 === snapshot.target.sha256 &&
  evidence.analysis_profile !== null &&
  analysisProfilesEqual(
    evidence.analysis_profile,
    snapshot.binding.analysis_profile,
  );

const evidenceQueryKey = (evidence: Evidence): string =>
  contentDigest({
    operation: evidence.operation,
    parameters: evidence.parameters,
    provider: evidence.provider,
    analysis_profile: evidence.analysis_profile,
  });

const entryQueryKey = (
  entry: Pick<AnalysisSnapshotEntry, "operation" | "parameters"> & {
    readonly execution: Pick<AnalysisSnapshotEntry["execution"], "provider">;
  },
  binding: AnalysisSnapshotBinding,
): string =>
  contentDigest({
    operation: entry.operation,
    parameters: entry.parameters,
    provider: entry.execution.provider,
    analysis_profile: binding.analysis_profile,
  });

const entryEvidenceKey = (
  entry: AnalysisSnapshotEntry,
  binding: AnalysisSnapshotBinding,
): string =>
  compositeKey([
    entryQueryKey(entry, binding),
    snapshotContentDigest(
      entry.execution.result,
      entry.execution.raw_result,
      entry.execution,
    ),
  ]);

const workflowEntryQueryKey = (
  entry: Pick<AnalysisSnapshotWorkflowEntry, "operation" | "parameters"> & {
    readonly execution: Pick<
      AnalysisSnapshotWorkflowEntry["execution"],
      "provider" | "analysis_profile"
    >;
  },
): string =>
  contentDigest({
    operation: entry.operation,
    parameters: entry.parameters,
    provider: entry.execution.provider,
    analysis_profile: entry.execution.analysis_profile,
  });

const workflowEntryEvidenceKey = (
  entry: AnalysisSnapshotWorkflowEntry,
): string =>
  compositeKey([
    workflowEntryQueryKey(entry),
    snapshotContentDigest(
      entry.execution.result,
      entry.execution.raw_result,
      entry.execution,
    ),
  ]);

const isWorkflowEvidence = (
  evidence: Evidence,
  snapshot: Pick<AnalysisSnapshot, "target">,
  entry: AnalysisSnapshotWorkflowEntry,
): boolean =>
  evidence.predicate_type === "rea.analysis" &&
  evidence.confidence === "derived" &&
  evidence.authority === "shipped-artifact" &&
  evidence.subject?.digest.sha256 === snapshot.target.sha256 &&
  evidence.analysis_profile !== null &&
  analysisProfilesEqual(
    evidence.analysis_profile,
    entry.execution.analysis_profile,
  ) &&
  committedProvidersEqual(evidence.provider, entry.execution.provider);

/** Match an authenticated Evidence record to one exact composed cache binding. */
export const evidenceMatchesWorkflowEntry = (
  evidence: Evidence,
  entry: AnalysisSnapshotWorkflowEntry,
  snapshot: Pick<AnalysisSnapshot, "target">,
): boolean =>
  isWorkflowEvidence(evidence, snapshot, entry) &&
  compositeKey([
    evidenceQueryKey(evidence),
    evidenceContentDigest(evidence),
  ]) === workflowEntryEvidenceKey(entry);

const evidenceContentMetadata = (evidence: Evidence) => {
  return {
    limitations: evidence.limitations,
    relationship_coverage: evidence.relationship_coverage,
    locations: evidence.locations,
    subject:
      evidence.subject === null
        ? null
        : {
            local_path: evidence.subject.local_path,
            sha256: evidence.subject.digest.sha256,
            format: evidence.subject.format,
            architecture: evidence.subject.architecture,
          },
  };
};

/** Serialize a validated snapshot with byte-stable canonical entry ordering. */
export const serializeAnalysisSnapshot = (snapshot: AnalysisSnapshot): string =>
  `${canonicalJson(parseAnalysisSnapshot(snapshot))}\n`;
