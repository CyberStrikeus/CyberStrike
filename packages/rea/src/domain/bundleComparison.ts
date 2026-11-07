import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseEvidenceBundle,
  serializeEvidenceBundle,
  type EvidenceBundle,
} from "./evidenceBundle.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import type { ResidualUnknown } from "./residualUnknown.js";
import { digestSchema, prefixedDigestSchema } from "./../domain/digests.js";
import { comparisonStatusSchema } from "./comparisonStatus.js";
import { localPathStringSchema } from "./localPath.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const classificationSchema = z.enum([
  "added",
  "removed",
  "changed",
  "unknown",
  "history_advanced",
  "history_diverged",
]);

/** Strict input for canonical Evidence bundle comparison. */
export const bundleComparisonInputSchema = z.strictObject({
  left_bundle_path: localPathStringSchema,
  right_bundle_path: localPathStringSchema,
  record_pairs: z
    .array(
      z.object({
        left_evidence_id: evidenceIdSchema,
        right_evidence_id: evidenceIdSchema,
      }),
    )
    .default([]),
});

const bundleChangeSchema = z.object({
  entity: z.enum(["evidence", "residual_unknown"]),
  key: z.string().min(1),
  classification: classificationSchema,
  conclusion_kind: z.enum([
    "observed_change",
    "contradiction",
    "unresolved_branch",
  ]),
  left_evidence_ids: z.array(evidenceIdSchema),
  right_evidence_ids: z.array(evidenceIdSchema),
  left_digest: digestSchema.nullable(),
  right_digest: digestSchema.nullable(),
  limitations: z.array(z.string()),
});

/** Deterministic classified delta between two canonical Evidence bundles. */
export const bundleComparisonResultSchema = z.object({
  status: comparisonStatusSchema,
  left_bundle_sha256: digestSchema,
  right_bundle_sha256: digestSchema,
  summary: z.object({
    records_unchanged: z.int().min(0),
    records_added: z.int().min(0),
    records_removed: z.int().min(0),
    records_changed: z.int().min(0),
    unknowns_unchanged: z.int().min(0),
    unknowns_added: z.int().min(0),
    unknowns_removed: z.int().min(0),
    unknowns_advanced: z.int().min(0),
    unknowns_diverged: z.int().min(0),
    unresolved: z.int().min(0),
  }),
  changes: z.array(bundleChangeSchema),
  limitations: z.array(z.string()),
});

export type BundleComparisonResult = z.infer<
  typeof bundleComparisonResultSchema
>;
type BundleChange = z.infer<typeof bundleChangeSchema>;
export type BundleRecordPair = z.infer<
  typeof bundleComparisonInputSchema
>["record_pairs"][number];

/** Compare canonical bundle membership and only explicitly paired observations. */
export const compareBundles = (
  leftInput: unknown,
  rightInput: unknown,
  recordPairs: readonly BundleRecordPair[] = [],
): BundleComparisonResult => {
  const left = parseEvidenceBundle(leftInput);
  const right = parseEvidenceBundle(rightInput);
  const leftDigest = bundleDigest(left);
  const rightDigest = bundleDigest(right);
  const recordResult = compareRecords(left, right, recordPairs);
  const unknownResult = compareUnknowns(left, right);
  const changes = [...recordResult.changes, ...unknownResult.changes].sort(
    compareChanges,
  );
  const unresolved = changes.filter(
    ({ conclusion_kind: kind }) => kind !== "observed_change",
  ).length;
  return bundleComparisonResultSchema.parse({
    status:
      unresolved > 0 ? "unknown" : changes.length > 0 ? "changed" : "unchanged",
    left_bundle_sha256: leftDigest,
    right_bundle_sha256: rightDigest,
    summary: {
      ...recordResult.summary,
      ...unknownResult.summary,
      unresolved,
    },
    changes,
    limitations: changes.some(({ limitations }) => limitations.length > 0)
      ? [
          "EvidenceBundle has no inventory completeness marker; one-sided membership remains unknown.",
        ]
      : [],
  });
};

const compareRecords = (
  left: EvidenceBundle,
  right: EvidenceBundle,
  pairs: readonly BundleRecordPair[],
) => {
  const leftIds = new Set(left.records.map(({ evidence_id: id }) => id));
  const rightIds = new Set(right.records.map(({ evidence_id: id }) => id));
  const pairedLeft = new Set<string>();
  const pairedRight = new Set<string>();
  const changes: BundleChange[] = [];
  let changed = 0;
  for (const [index, pair] of pairs.entries()) {
    if (!leftIds.has(pair.left_evidence_id))
      throw recordPairFailure(
        index,
        "left_evidence_id",
        `Explicit pair references missing left evidence ${pair.left_evidence_id}`,
      );
    if (!rightIds.has(pair.right_evidence_id))
      throw recordPairFailure(
        index,
        "right_evidence_id",
        `Explicit pair references missing right evidence ${pair.right_evidence_id}`,
      );
    if (pairedLeft.has(pair.left_evidence_id))
      throw recordPairFailure(
        index,
        "left_evidence_id",
        "Explicit evidence pairs must be one-to-one",
      );
    if (pairedRight.has(pair.right_evidence_id))
      throw recordPairFailure(
        index,
        "right_evidence_id",
        "Explicit evidence pairs must be one-to-one",
      );
    pairedLeft.add(pair.left_evidence_id);
    pairedRight.add(pair.right_evidence_id);
    if (pair.left_evidence_id === pair.right_evidence_id) continue;
    changed += 1;
    changes.push({
      entity: "evidence",
      key: `pair:${pair.left_evidence_id}:${pair.right_evidence_id}`,
      classification: "changed",
      conclusion_kind: "observed_change",
      left_evidence_ids: [pair.left_evidence_id],
      right_evidence_ids: [pair.right_evidence_id],
      left_digest: pair.left_evidence_id.slice(3),
      right_digest: pair.right_evidence_id.slice(3),
      limitations: [],
    });
  }
  const common = [...leftIds].filter(
    (id) => rightIds.has(id) && !pairedLeft.has(id) && !pairedRight.has(id),
  );
  const removed = [...leftIds].filter(
    (id) => !pairedLeft.has(id) && (!rightIds.has(id) || pairedRight.has(id)),
  );
  const added = [...rightIds].filter(
    (id) => !pairedRight.has(id) && (!leftIds.has(id) || pairedLeft.has(id)),
  );
  for (const [ids, side] of [
    [removed, "left"],
    [added, "right"],
  ] as const)
    for (const id of ids)
      changes.push({
        entity: "evidence",
        key: id,
        classification: "unknown",
        conclusion_kind: "unresolved_branch",
        left_evidence_ids: side === "left" ? [id] : [],
        right_evidence_ids: side === "right" ? [id] : [],
        left_digest: side === "left" ? id.slice(3) : null,
        right_digest: side === "right" ? id.slice(3) : null,
        limitations: [
          "EvidenceBundle has no inventory completeness marker; one-sided membership may reflect incomplete capture.",
        ],
      });
  return {
    changes,
    summary: {
      records_unchanged: common.length + pairs.length - changed,
      records_added: 0,
      records_removed: 0,
      records_changed: changed,
    },
  };
};

const recordPairFailure = (
  index: number,
  field: keyof BundleRecordPair,
  message: string,
): AnalysisInputError =>
  new AnalysisInputError("compare_bundles", { userMessage: message }, [
    { path: ["record_pairs", index, field], reason: "invalid_value", message },
  ]);

const compareUnknowns = (left: EvidenceBundle, right: EvidenceBundle) => {
  const leftHistories = histories(left.unknowns);
  const rightHistories = histories(right.unknowns);
  const ids = [...new Set([...leftHistories.keys(), ...rightHistories.keys()])];
  const changes: BundleChange[] = [];
  const summary = {
    unknowns_unchanged: 0,
    unknowns_added: 0,
    unknowns_removed: 0,
    unknowns_advanced: 0,
    unknowns_diverged: 0,
  };
  for (const id of ids) {
    const leftHistory = leftHistories.get(id);
    const rightHistory = rightHistories.get(id);
    if (leftHistory === undefined || rightHistory === undefined) {
      changes.push(unknownChange(id, "unknown", leftHistory, rightHistory));
      continue;
    }
    const leftDigests = leftHistory.map(
      ({ revision_digest: digest }) => digest,
    );
    const rightDigests = rightHistory.map(
      ({ revision_digest: digest }) => digest,
    );
    if (same(leftDigests, rightDigests)) {
      summary.unknowns_unchanged += 1;
      continue;
    }
    const advanced =
      isPrefix(leftDigests, rightDigests) ||
      isPrefix(rightDigests, leftDigests);
    summary[advanced ? "unknowns_advanced" : "unknowns_diverged"] += 1;
    changes.push(
      unknownChange(
        id,
        advanced ? "history_advanced" : "history_diverged",
        leftHistory,
        rightHistory,
      ),
    );
  }
  return { changes, summary };
};

const unknownChange = (
  id: string,
  classification: BundleChange["classification"],
  left: readonly ResidualUnknown[] | undefined,
  right: readonly ResidualUnknown[] | undefined,
): BundleChange => ({
  entity: "residual_unknown",
  key: id,
  classification,
  conclusion_kind:
    classification === "history_diverged"
      ? "contradiction"
      : classification === "history_advanced"
        ? "observed_change"
        : "unresolved_branch",
  left_evidence_ids: historyEvidenceIds(left ?? []),
  right_evidence_ids: historyEvidenceIds(right ?? []),
  left_digest: left?.at(-1)?.revision_digest ?? null,
  right_digest: right?.at(-1)?.revision_digest ?? null,
  limitations:
    left === undefined || right === undefined
      ? [
          "EvidenceBundle has no inventory completeness marker; one-sided history membership remains unknown.",
        ]
      : [],
});

const histories = (unknowns: readonly ResidualUnknown[]) => {
  const output = new Map<string, ResidualUnknown[]>();
  for (const unknown of unknowns) {
    const history = output.get(unknown.unknown_id) ?? [];
    history.push(unknown);
    output.set(unknown.unknown_id, history);
  }
  return output;
};

const historyEvidenceIds = (history: readonly ResidualUnknown[]): string[] =>
  [
    ...new Set(
      history.flatMap((item) => [
        ...item.supporting_evidence_ids,
        ...item.contradicting_evidence_ids,
        ...item.mutation_evidence_ids,
        ...(item.resolution?.evidence_ids ?? []),
      ]),
    ),
  ].sort(ascii);

const bundleDigest = (bundle: EvidenceBundle): string =>
  createHash("sha256").update(serializeEvidenceBundle(bundle)).digest("hex");

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const isPrefix = (
  shorter: readonly string[],
  longer: readonly string[],
): boolean =>
  shorter.length < longer.length &&
  shorter.every((value, index) => value === longer[index]);

const ascii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareChanges = (left: BundleChange, right: BundleChange): number =>
  ascii(
    [
      left.entity,
      left.key,
      left.classification,
      left.left_digest ?? "",
      left.right_digest ?? "",
    ].join("\u0000"),
    [
      right.entity,
      right.key,
      right.classification,
      right.left_digest ?? "",
      right.right_digest ?? "",
    ].join("\u0000"),
  );
