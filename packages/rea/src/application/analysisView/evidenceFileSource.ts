import { requireAuthenticationHeadroom } from "../JsonAuthenticationHeadroom.js";
import { authenticateEvidenceBundleValue } from "../EvidenceBundleFiles.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { INSPECT_ANALYSIS_VIEW_OPERATION } from "../../domain/analysisView/analysisViewErrors.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { Evidence } from "../../domain/evidence.js";
import { safeParseImmutableEvidence } from "../../domain/evidenceValidation.js";
import { EvidenceFileError } from "../../domain/evidenceErrors.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { readJsonFile } from "../JsonFiles.js";

/** The request cancellation and the scope retaining descriptors whose close failed. */
export interface EvidenceFileReadOptions {
  readonly signal?: AbortSignal;
  readonly resources?: ArtifactResourceScope;
}

/** Caller context and related-record resolution for this admitted file. */
export interface EvidenceFileSourceContext {
  readonly operation: string;
  readonly path: readonly (string | number)[];
  readonly resolveSelected?: EvidenceFileRecordResolver;
}

/** Resolve related facts while the authenticated file records are in scope. */
export type EvidenceFileRecordResolver = (
  selected: Evidence,
  lookup: (evidenceId: string) => Evidence | undefined,
) => Result<Evidence, AnalysisError>;

const ANALYSIS_VIEW_SOURCE: EvidenceFileSourceContext = {
  operation: INSPECT_ANALYSIS_VIEW_OPERATION,
  path: ["source"],
};

const selectionError = (
  site: EvidenceFileSourceContext,
  message: string,
): AnalysisInputError =>
  new AnalysisInputError(site.operation, { userMessage: message }, [
    {
      path: [...site.path, "evidence_id"],
      reason: "invalid_value",
      message,
    },
  ]);

/** Listed identities stay bounded so a large bundle cannot grow the error itself. */
const RECORD_REFERENCE_PREVIEW_BYTES = 2048;

/** Select the one record a source names from an authenticated bundle. */
const selectBundleRecord = (
  records: readonly Evidence[],
  path: string,
  evidenceId: string | undefined,
  site: EvidenceFileSourceContext,
): Result<Evidence, AnalysisError> => {
  if (evidenceId !== undefined) {
    const selected = records.find(
      (record) => record.evidence_id === evidenceId,
    );
    return selected === undefined
      ? err(
          selectionError(
            site,
            `Evidence bundle ${path} holds no record ${evidenceId}. It holds ${listRecordIds(records)}.`,
          ),
        )
      : ok(selected);
  }
  const only = records[0];
  if (only === undefined)
    return err(
      selectionError(site, `Evidence bundle ${path} holds no records.`),
    );
  if (records.length > 1)
    return err(
      selectionError(
        site,
        `Evidence bundle ${path} holds ${String(records.length)} records; select one with ${[...site.path, "evidence_id"].join(".")}. It holds ${listRecordIds(records)}.`,
      ),
    );
  return ok(only);
};

const listRecordIds = (records: readonly Evidence[]): string => {
  const labels: string[] = [];
  let bytes = 0;
  for (const record of records) {
    const separator = labels.length === 0 ? "" : ", ";
    const remaining = RECORD_REFERENCE_PREVIEW_BYTES - bytes;
    let label = `${record.evidence_id} (operation omitted)`;
    // UTF-8/JSON cannot use fewer bytes than the source UTF-16 code units.
    // Reject a label before copying it when even that lower bound cannot fit.
    if (record.operation.length <= remaining) {
      const complete = `${record.evidence_id} (${record.operation})`;
      if (
        Buffer.byteLength(JSON.stringify(separator + complete), "utf8") <=
        remaining
      )
        label = complete;
    }
    const encodedBytes = Buffer.byteLength(
      JSON.stringify(separator + label),
      "utf8",
    );
    if (encodedBytes > remaining) break;
    labels.push(label);
    bytes += encodedBytes;
  }
  const omitted = records.length - labels.length;
  const listed = labels.join(", ");
  return omitted > 0 ? `${listed} and ${String(omitted)} more` : listed;
};

/** Read one Evidence record or select from an authenticated bundle without rereading the file. */
export const readEvidenceFileSource = async (
  path: string,
  options: EvidenceFileReadOptions = {},
  evidenceId?: string,
  site: EvidenceFileSourceContext = ANALYSIS_VIEW_SOURCE,
): Promise<Result<Evidence, AnalysisError>> => {
  const { signal, resources } = options;
  const { operation } = site;
  const resolveSelected =
    site.resolveSelected ?? ((selected: Evidence) => ok(selected));
  if (signal?.aborted)
    return err(new AnalysisCancelledError(operation, { cause: signal.reason }));
  const loaded = await readJsonFile(path, signal, resources, operation);
  if (!loaded.ok) return loaded;
  if (signal?.aborted)
    return err(new AnalysisCancelledError(operation, { cause: signal.reason }));
  const value = loaded.value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "records")
  ) {
    const bundle = authenticateEvidenceBundleValue(value, path, {
      operation,
      immutable: true,
    });
    if (!bundle.ok) return bundle;
    const selected = selectBundleRecord(
      bundle.value.records,
      path,
      evidenceId,
      site,
    );
    return selected.ok
      ? resolveSelected(selected.value, (id) =>
          bundle.value.records.find((record) => record.evidence_id === id),
        )
      : selected;
  }
  const headroom = requireAuthenticationHeadroom(value, {
    operation,
    path,
    description: "Insufficient heap headroom to authenticate the Evidence file",
  });
  if (!headroom.ok) return headroom;
  const parsed = safeParseImmutableEvidence(value);
  if (!parsed.ok)
    return err(
      new EvidenceFileError("read", "wrong-kind", {
        path,
        cause: parsed.error,
        contentIssues: projectInputIssues(parsed.error.issues, value),
        userMessage:
          "The selected file does not contain valid Evidence. Repair or recreate the file and try again.",
      }),
    );
  if (evidenceId !== undefined && parsed.value.evidence_id !== evidenceId)
    return err(
      selectionError(
        site,
        `Evidence file ${path} holds ${parsed.value.evidence_id}, not selected record ${evidenceId}.`,
      ),
    );
  return resolveSelected(parsed.value, (id) =>
    parsed.value.evidence_id === id ? parsed.value : undefined,
  );
};
