import { digestSchema } from "../digests.js";
import { z } from "zod";
import {
  apkSignatureResultSchema,
  apkSignatureUninterpretedBytes,
  apkSignatureMatchesSubject,
  type ApkSignatureResult,
} from "../apkSignature/apkSignatureReport.js";
import {
  apkSignatureSchemeSchema,
  apkSignatureViewItemsSchema,
  apkSignatureViewRequestSchema,
} from "../apkSignature/apkSignatureQuery.js";
import { isImmutableJsonSnapshot } from "../immutableJson.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";

const identityFields = new Set([
  "id",
  "scheme",
  "index",
  "signer_id",
  "signer_index",
  "certificate_sha256",
]);
const schemes = ["v1", "v2", "v3", "v3.1"] as const;
type Scheme = (typeof schemes)[number];
type Selection = z.infer<typeof apkSignatureViewRequestSchema>;
const signerId = (
  report: ApkSignatureResult,
  scheme: Scheme,
  index: number,
): string => `apk:${report.artifact.sha256}:${scheme}:signer:${String(index)}`;
const recordId = (
  signer: string,
  collection: "digests" | "lineage",
  index: number,
): string => `${signer}:${collection}:${String(index)}`;

export const apkSignatureSourceCoverageSchema = z.strictObject({
  scope: z.literal("declared-signing-records"),
  uninterpreted_bytes: z.int().nonnegative(),
  signer_identity: z.enum(["complete-within-records", "partial"]),
  lineage_decoding: z.enum(["complete-within-records", "partial"]),
  signature_verification: z.literal("not-performed"),
  v1_entry_coverage: z.literal("unknown"),
  authenticity: z.literal("unknown"),
});
export const apkSignatureSummarySchema = z.strictObject({
  artifact: apkSignatureResultSchema.shape.artifact,
  schemes: z.record(
    apkSignatureSchemeSchema,
    z.strictObject({ present: z.boolean(), signers: z.int().nonnegative() }),
  ),
  signers: z.array(
    z.strictObject({
      id: z.string(),
      scheme: apkSignatureSchemeSchema,
      index: z.int().nonnegative(),
      certificate_sha256: digestSchema.nullable(),
    }),
  ),
  counts: z.strictObject({
    signers: z.int().nonnegative(),
    digests: z.int().nonnegative(),
    lineage: z.int().nonnegative(),
  }),
  source_stamp: apkSignatureResultSchema.shape.source_stamp
    .omit({ certificate: true })
    .extend({ certificate_sha256: digestSchema.nullable() }),
  posture: apkSignatureResultSchema.shape.posture,
  source_coverage: apkSignatureSourceCoverageSchema,
});
interface Checked {
  readonly report: ApkSignatureResult;
  readonly summary: z.infer<typeof apkSignatureSummarySchema>;
  readonly unknowns: readonly string[];
}
const checked = new WeakMap<object, Checked>();
const readReport = createAnalysisViewResultReader(apkSignatureResultSchema);
const read = (parent: AnalysisViewParent): Result<Checked, AnalysisError> => {
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const reusable = isImmutableJsonSnapshot(report);
  const cached = reusable ? checked.get(report) : undefined;
  // Parent identity is checked on every read, independently of reusable facts.
  if (
    parent.subject != null &&
    !apkSignatureMatchesSubject(report.artifact, {
      sha256: parent.subject.digest.sha256,
      format: parent.subject.format,
    })
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message: "APK subject does not match its recorded artifact",
        },
      ]),
    );
  if (cached !== undefined) return ok(cached);
  const unknowns = [
    "Declared signer and rotation identities are unverified; authenticity and v1 entry coverage remain unknown.",
  ];
  if (report.source_stamp.decode_error !== null)
    unknowns.push(`Source stamp: ${report.source_stamp.decode_error}`);
  const identities: z.infer<typeof apkSignatureSummarySchema>["signers"] = [];
  let digests = 0,
    lineage = 0,
    unknownIdentity = false,
    unknownLineage = false;
  for (const scheme of schemes) {
    for (const [index, signer] of report.schemes[scheme].signers.entries()) {
      identities.push({
        id: signerId(report, scheme, index),
        scheme,
        index,
        certificate_sha256: signer.certificate?.sha256_fingerprint ?? null,
      });
      unknownIdentity ||= signer.certificate === null;
      if (signer.certificate === null)
        unknowns.push(
          `${scheme} signer ${String(index)} has no resolved declared certificate identity.`,
        );
      if ("decode_error" in signer && signer.decode_error !== null)
        unknowns.push(
          `${scheme} signer ${String(index)}: ${String(signer.decode_error)}`,
        );
      if ("digests" in signer) digests += signer.digests.length;
      if (scheme === "v3" || scheme === "v3.1") {
        const rotation = report.schemes[scheme].signers[index]!.rotation;
        lineage += rotation.lineage.length;
        unknownLineage ||= rotation.decode_error !== null;
        if (rotation.decode_error !== null)
          unknowns.push(
            `${scheme} signer ${String(index)} lineage: ${rotation.decode_error}`,
          );
      }
    }
  }
  const summary = apkSignatureSummarySchema.parse({
    artifact: report.artifact,
    schemes: Object.fromEntries(
      schemes.map((scheme) => [
        scheme,
        {
          present: report.schemes[scheme].present,
          signers: report.schemes[scheme].signers.length,
        },
      ]),
    ),
    signers: identities,
    counts: { signers: identities.length, digests, lineage },
    source_stamp: {
      present: report.source_stamp.present,
      certificate_sha256:
        report.source_stamp.certificate?.sha256_fingerprint ?? null,
      decode_error: report.source_stamp.decode_error,
    },
    posture: report.posture,
    source_coverage: {
      scope: "declared-signing-records",
      uninterpreted_bytes: apkSignatureUninterpretedBytes(report),
      signer_identity: unknownIdentity ? "partial" : "complete-within-records",
      lineage_decoding: unknownLineage ? "partial" : "complete-within-records",
      signature_verification: "not-performed",
      v1_entry_coverage: "unknown",
      authenticity: "unknown",
    },
  });
  const value = { report, summary, unknowns };
  if (reusable) checked.set(report, value);
  return ok(value);
};

/** Borrow canonical parsed facts; allocate rows only as this selected collection is visited. */
function* records(
  report: ApkSignatureResult,
  selection: Selection,
): Generator<Record<string, JsonValue>> {
  const wanted =
    selection.schemes === undefined ? undefined : new Set(selection.schemes);
  for (const scheme of schemes) {
    if (wanted !== undefined && !wanted.has(scheme)) continue;
    for (const [signerIndex, signer] of report.schemes[
      scheme
    ].signers.entries()) {
      const id = signerId(report, scheme, signerIndex);
      if (selection.collection === "signers") {
        yield {
          id,
          scheme,
          index: signerIndex,
          certificate: signer.certificate,
          uninterpreted_signed_data_bytes:
            "uninterpreted_signed_data_bytes" in signer
              ? signer.uninterpreted_signed_data_bytes
              : null,
          uninterpreted_signer_bytes:
            "uninterpreted_signer_bytes" in signer
              ? signer.uninterpreted_signer_bytes
              : null,
          certificate_sha256: signer.certificate?.sha256_fingerprint ?? null,
          signatures: "signatures" in signer ? signer.signatures : [],
          public_key_bytes:
            "public_key_bytes" in signer ? signer.public_key_bytes : null,
          min_sdk: "min_sdk" in signer ? signer.min_sdk : null,
          max_sdk: "max_sdk" in signer ? signer.max_sdk : null,
          signature_file:
            "signature_file" in signer ? signer.signature_file : null,
          block_file: "block_file" in signer ? signer.block_file : null,
          signer_infos: "signer_infos" in signer ? signer.signer_infos : [],
          decode_error: "decode_error" in signer ? signer.decode_error : null,
        };
      } else if (selection.collection === "digests" && "digests" in signer) {
        for (const [index, digest] of signer.digests.entries())
          yield {
            ...digest,
            id: recordId(id, "digests", index),
            scheme,
            index,
            signer_id: id,
            signer_index: signerIndex,
          };
      } else if (
        selection.collection === "lineage" &&
        (scheme === "v3" || scheme === "v3.1")
      ) {
        for (const [index, node] of report.schemes[scheme].signers[
          signerIndex
        ]!.rotation.lineage.entries())
          yield {
            ...node,
            certificate_sha256: node.certificate?.sha256_fingerprint ?? null,
            id: recordId(id, "lineage", index),
            scheme,
            index,
            signer_id: id,
            signer_index: signerIndex,
            previous_id:
              index === 0 ? null : recordId(id, "lineage", index - 1),
          };
      }
    }
  }
}

export const projectApkSignatureView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (view.kind !== "summary" && view.kind !== "apk-signature")
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "APK Evidence supports summary and apk-signature signer/digest/lineage pages",
        },
      ]),
    );
  assertOwnedView<
    SummaryAnalysisView | z.output<typeof apkSignatureViewRequestSchema>
  >(view, "summary", "apk-signature");
  const parsed = read(parent);
  if (!parsed.ok) return parsed;
  const { report, summary } = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_apk_signature" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: boundedViewMessages(
      parent.limitations,
      parent.evidenceId,
      "limitations",
    ),
    unknowns: boundedViewMessages(
      parsed.value.unknowns,
      parent.evidenceId,
      "unknowns",
    ),
  };
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary,
      coverage: completeWithinViewCoverage(1, 1),
    });
  const ids = view.ids === undefined ? undefined : new Set(view.ids);
  const signers =
    view.signer_ids === undefined ? undefined : new Set(view.signer_ids);
  const fields =
    view.fields === undefined ? undefined : new Set<string>(view.fields);
  const items: Record<string, JsonValue>[] = [];
  let total = 0;
  const rows =
    ids?.size === 0 || signers?.size === 0 ? [] : records(report, view);
  for (const row of rows) {
    if (ids !== undefined && !ids.has(String(row.id))) continue;
    if (signers !== undefined && !signers.has(String(row.signer_id ?? row.id)))
      continue;
    if (total++ < view.offset || items.length >= view.limit) continue;
    const item: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(row))
      if (identityFields.has(key) || fields === undefined || fields.has(key))
        item[key] = value;
    items.push(item);
  }
  return ok({
    kind: "apk-signature" as const,
    view,
    ...shared,
    source_coverage: summary.source_coverage,
    items: apkSignatureViewItemsSchema.parse(items),
    coverage: pageViewCoverage(view.offset, items.length, total),
  });
};
