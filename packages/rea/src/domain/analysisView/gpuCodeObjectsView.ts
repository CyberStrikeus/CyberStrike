import { isImmutableJsonSnapshot } from "../immutableJson.js";
import { digestSchema } from "../digests.js";
import { z } from "zod";
import {
  gpuCodeObjectsSchema,
  gpuCodeObjectsObjectSchema,
  gpuCodeObjectsSelectionSchemas,
  gpuObjectSchema,
  gpuKernelSchema,
  gpuTargetSchema,
  type GpuTarget,
  type GpuCodeObjects,
} from "../gpu/gpuCodeObjects.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  ownedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
  analysisViewInputError,
} from "./analysisViewErrors.js";
import { createAnalysisViewResultReader } from "./analysisViewParent.js";
import {
  boundedViewMessages,
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import { err, ok, type Result } from "../result.js";
import type { JsonValue } from "../jsonValue.js";
import { jsonValueByteLength } from "../jsonValueByteLength.js";
import { AnalysisResourceConstraintError } from "../analysisErrorCore.js";
export const gpuCodeObjectsViewRequestSchema = z.discriminatedUnion(
  "collection",
  [
    gpuCodeObjectsSelectionSchemas.objects.extend({
      kind: z.literal("gpu-code-objects"),
    }),
    gpuCodeObjectsSelectionSchemas.kernels.extend({
      kind: z.literal("gpu-code-objects"),
    }),
    gpuCodeObjectsSelectionSchemas.ptx.extend({
      kind: z.literal("gpu-code-objects"),
    }),
    gpuCodeObjectsSelectionSchemas.targets.extend({
      kind: z.literal("gpu-code-objects"),
    }),
  ],
);
export const gpuCodeObjectsSummarySchema = gpuCodeObjectsObjectSchema
  .omit({ objects: true, kernels: true, ptx_artifacts: true })
  .extend({
    counts: z.strictObject({
      objects: z.number().int().nonnegative(),
      kernels: z.number().int().nonnegative(),
      ptx_artifacts: z.number().int().nonnegative(),
      targets: z.number().int().nonnegative(),
    }),
    target_preview: z.array(z.string()),
  });
export const gpuCodeObjectsItemsSchema = z.union([
  z.array(
    gpuObjectSchema
      .partial()
      .required({
        id: true,
        kind: true,
        target: true,
        location: true,
        metadata_location: true,
        payload_target: true,
        target_consistency: true,
        inspection: true,
      })
      .extend({
        // Source defaults qualify historical full rows, never omitted page columns.
        amd_target_metadata: gpuObjectSchema.shape.amd_target_metadata
          .removeDefault()
          .optional(),
      }),
  ),
  z.array(
    gpuKernelSchema.partial().required({
      id: true,
      object_id: true,
      location: true,
      sources: true,
      representation: true,
    }),
  ),
  z.array(
    gpuTargetSchema.partial().required({
      id: true,
      target: true,
      confidence: true,
      kernel_coverage: true,
    }),
  ),
]);
export const gpuCodeObjectsPtxPageSchema = z.strictObject({
  artifact_id: z.string(),
  object_id: z.string(),
  sha256: digestSchema,
  byte_length: z.number().int().nonnegative(),
  text: z.string(),
  offset: z.number().int().nonnegative(),
  offset_unit: z.literal("utf16-code-unit"),
});
const summarizeGpuTargets = (report: GpuCodeObjects): GpuTarget[] => {
  const groups = new Map<
    string | null,
    { row: GpuTarget; encoded: bigint; decoded: bigint | null }
  >();
  const kernelCounts = new Map<string, number>();
  for (const kernel of report.kernels)
    kernelCounts.set(
      kernel.object_id,
      (kernelCounts.get(kernel.object_id) ?? 0) + 1,
    );
  for (const object of report.objects) {
    if (
      object.kind === "cuda-fatbin" ||
      object.kind === "hip-bundle" ||
      object.kind === "native-section" ||
      object.kind === "host"
    )
      continue;
    let group = groups.get(object.target);
    if (group === undefined) {
      group = {
        encoded: 0n,
        decoded: 0n,
        row: {
          id: `target:${JSON.stringify(object.target)}`,
          target: object.target,
          confidence: "derived",
          object_count: 0,
          kernel_count: 0,
          encoded_bytes: "0",
          decoded_bytes: "0",
          kernel_coverage:
            report.analysis === "inventory" ? "not-requested" : "complete",
          by_kind: { ptx: 0, cubin: 0, amdgpu: 0, unknown: 0 },
        },
      };
      groups.set(object.target, group);
    }
    group.row.object_count++;
    group.row.by_kind[object.kind]++;
    group.row.kernel_count += kernelCounts.get(object.id) ?? 0;
    group.encoded += BigInt(object.encoded_size);
    group.decoded =
      group.decoded === null || object.decoded_size === null
        ? null
        : group.decoded + BigInt(object.decoded_size);
    if (report.analysis === "kernels" && object.inspection !== "complete")
      group.row.kernel_coverage = "partial";
  }
  return [...groups.values()].map(({ row, encoded, decoded }) => ({
    ...row,
    encoded_bytes: encoded.toString(),
    decoded_bytes: decoded?.toString() ?? null,
  }));
};
type CheckedGpu = {
  report: z.infer<typeof gpuCodeObjectsSchema>;
  byId: Map<string, z.infer<typeof gpuObjectSchema>>;
  summary: z.infer<typeof gpuCodeObjectsSummarySchema>;
  targets: GpuTarget[];
};
// Evidence owns this immutable snapshot. Collection eviction releases the indexes as well.
const checkedGpu = new WeakMap<object, CheckedGpu>();
const readReport = createAnalysisViewResultReader(gpuCodeObjectsSchema);
const readGpuFacts = (
  parent: AnalysisViewParent,
): Result<CheckedGpu, AnalysisError> => {
  const parsed = readReport(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const reusable = isImmutableJsonSnapshot(report);
  let checked = reusable ? checkedGpu.get(report) : undefined;
  if (checked === undefined) {
    const { objects, kernels, ptx_artifacts, ...context } = report;
    const targets = new Set(
      objects.flatMap((row) => (row.target === null ? [] : [row.target])),
    );
    checked = {
      report,
      targets: summarizeGpuTargets(report),
      byId: new Map(objects.map((row) => [row.id, row])),
      summary: {
        ...context,
        counts: {
          objects: objects.length,
          kernels: kernels.length,
          ptx_artifacts: ptx_artifacts.length,
          targets: targets.size,
        },
        target_preview: [...targets]
          .slice(0, 8)
          .map((target) => target.slice(0, 256)),
      },
    };
    if (reusable) checkedGpu.set(report, checked);
  }
  const subject = parent.subject;
  if (
    subject != null &&
    subject.digest.sha256 !== checked.report.artifact.sha256
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message: "GPU Evidence subject does not match its recorded artifact",
        },
      ]),
    );
  return ok(checked);
};
export const projectGpuCodeObjectsView = (
  parent: AnalysisViewParent,
  admitted: AdmittedView,
) => {
  const view = ownedView<
    SummaryAnalysisView | z.output<typeof gpuCodeObjectsViewRequestSchema>
  >(admitted, "summary", "gpu-code-objects");
  if (view === undefined)
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message: "GPU Evidence supports summary and gpu-code-objects pages",
        },
      ]),
    );
  const parsed = readGpuFacts(parent);
  if (!parsed.ok) return parsed;
  const { report, byId, summary, targets: targetRows } = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_gpu_code_objects" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: boundedViewMessages(
      [...parent.limitations, ...report.limitations],
      parent.evidenceId,
      "limitations",
    ),
    unknowns: [
      "GPU execution, runtime compatibility and host launch sites were not inspected.",
      ...(report.coverage.payloads !== "complete"
        ? [
            "Kernel facts are incomplete outside successfully decoded selected payloads; consult object inspection states.",
          ]
        : []),
    ],
  };
  if (view.kind === "summary") {
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: { ...summary, limitations: shared.limitations },
      coverage: completeWithinViewCoverage(
        report.objects.length,
        report.objects.length,
      ),
    });
  }
  if (view.collection === "ptx") {
    const artifact = report.ptx_artifacts.find(
      (row) => row.object_id === view.object_id,
    );
    if (artifact === undefined)
      return err(
        analysisViewInputError([
          {
            path: ["view", "object_id"],
            reason: "invalid_value",
            message:
              "No retained PTX artifact exists for this object; inspect a selected PTX payload with analysis kernels",
          },
        ]),
      );
    const end = Math.min(artifact.text.length, view.offset + view.limit);
    const split = (offset: number): boolean =>
      offset > 0 &&
      offset < artifact.text.length &&
      /[\uD800-\uDBFF]/u.test(artifact.text[offset - 1]!) &&
      /[\uDC00-\uDFFF]/u.test(artifact.text[offset]!);
    if (split(view.offset) || split(end))
      return err(
        analysisViewInputError([
          {
            path: ["view"],
            reason: "invalid_value",
            message:
              "PTX text page must end and start on Unicode scalar boundaries; offsets use UTF-16 code units",
          },
        ]),
      );
    const text = artifact.text.slice(view.offset, end);
    if (jsonValueByteLength(text, 1024 * 1024) > 1024 * 1024)
      return err(
        new AnalysisResourceConstraintError(
          "inspect_analysis_view",
          "memory",
          "PTX page exceeds the 1 MiB response budget; lower limit",
          { maximum_page_bytes: 1024 * 1024 },
          ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
        ),
      );
    return ok({
      kind: "gpu-code-objects" as const,
      view,
      ...shared,
      source_coverage: report.coverage,
      items: [],
      ptx: {
        artifact_id: artifact.id,
        object_id: artifact.object_id,
        sha256: artifact.sha256,
        byte_length: artifact.byte_length,
        text,
        offset: view.offset,
        offset_unit: "utf16-code-unit" as const,
      },
      coverage: pageViewCoverage(
        view.offset,
        text.length,
        artifact.text.length,
      ),
    });
  }
  const targets =
    view.targets === undefined ? undefined : new Set(view.targets);
  const ids = view.ids === undefined ? undefined : new Set(view.ids);
  const objectIds =
    view.collection === "kernels" && view.object_ids !== undefined
      ? new Set(view.object_ids)
      : undefined;
  const names =
    view.collection === "kernels" && view.names !== undefined
      ? new Set(view.names)
      : undefined;
  const rows =
    view.collection === "objects"
      ? report.objects
      : view.collection === "targets"
        ? targetRows
        : report.kernels;
  const matchesTarget = (row: (typeof rows)[number]): boolean => {
    if (targets === undefined) return true;
    const target =
      "target" in row ? row.target : byId.get(row.object_id)?.target;
    return target !== null && target !== undefined && targets.has(target);
  };
  const matches = rows.filter(
    (row) =>
      (ids === undefined || ids.has(row.id)) &&
      (objectIds === undefined ||
        ("object_id" in row && objectIds.has(row.object_id))) &&
      (names === undefined || ("name" in row && names.has(row.name))) &&
      matchesTarget(row),
  );
  const defaults =
    view.collection === "kernels"
      ? new Set([
          "id",
          "object_id",
          "name",
          "parameter_count",
          "parameter_bytes",
          "registers",
          "shared_bytes",
          "private_bytes",
          "location",
          "limitations",
        ])
      : undefined;
  const fields =
    view.fields === undefined ? defaults : new Set<string>(view.fields);
  const items = matches
    .slice(view.offset, view.offset + view.limit)
    .map((row) => {
      const projected: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(row))
        if (
          key === "id" ||
          key === "object_id" ||
          key === "location" ||
          key === "metadata_location" ||
          key === "kind" ||
          key === "target" ||
          key === "payload_target" ||
          key === "target_consistency" ||
          key === "inspection" ||
          key === "sources" ||
          key === "representation" ||
          (view.collection === "targets" &&
            (key === "target" ||
              key === "confidence" ||
              key === "kernel_coverage")) ||
          fields === undefined ||
          fields.has(key)
        )
          projected[key] = value;
      return projected;
    });
  if (jsonValueByteLength(items, 1024 * 1024) > 1024 * 1024)
    return err(
      new AnalysisResourceConstraintError(
        "inspect_analysis_view",
        "memory",
        "GPU page exceeds the 1 MiB response budget; select fewer fields or rows",
        { maximum_page_bytes: 1024 * 1024 },
        ANALYSIS_VIEW_PAGE_BUDGET_RECOVERY,
      ),
    );
  return ok({
    kind: "gpu-code-objects" as const,
    view,
    ...shared,
    source_coverage: report.coverage,
    items: gpuCodeObjectsItemsSchema.parse(items),
    ptx: null,
    coverage: pageViewCoverage(view.offset, items.length, matches.length),
  });
};
