import { z } from "zod";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../domain/jsonValue.js";
import { digestSchema } from "../domain/digests.js";
import { uniqueSorted } from "../domain/canonicalOrdering.js";
import { firmwareLogicalPath } from "./FirmwareFiles.js";

const integer = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const signature = z.object({
  id: z.string().min(1),
  offset: integer,
  size: integer,
  name: z.string(),
  description: z.string(),
  confidence: z.int().min(0).max(255),
  always_display: z.boolean(),
  extraction_declined: z.boolean(),
});
const scan = z.array(
  z.object({
    Analysis: z.object({
      file_path: z.string(),
      file_map: z.array(signature),
      extractions: jsonObjectSchema,
    }),
  }),
);
const report = jsonObjectSchema.pipe(
  z.custom<Record<string, JsonValue> & { __typename__: string }>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "__typename__" in value &&
      typeof value.__typename__ === "string",
    "Expected report __typename__ string",
  ),
);
const task = z.object({
  path: z.string(),
  depth: integer,
  blob_id: z.string(),
  is_multi_file: z.boolean(),
});
const extraction = z.array(
  z.object({ task, reports: z.array(report), subtasks: z.array(task) }),
);
const stat = z.object({
  __typename__: z.literal("StatReport"),
  path: z.string(),
  size: integer,
  is_dir: z.boolean(),
  is_file: z.boolean(),
  is_link: z.boolean(),
  link_target: z.string().nullable(),
});
const multiFile = z.object({
  id: z.string(),
  handler_name: z.string(),
  name: z.string(),
  paths: z.array(z.string()),
  extraction_reports: z.array(jsonValueSchema),
});
const hashes = z.object({ sha256: digestSchema });
/**
 * The provider's structured missing-dependency report. Non-strict on purpose:
 * unfamiliar extra fields stay in retained diagnostics, only the dependency
 * names are derived here.
 */
const missingDependency = z.object({
  __typename__: z.literal("ExtractorDependencyNotFoundReport"),
  dependencies: z.array(z.string()),
});
// Unblob reports resolved extraction problems and warnings alongside errors.
// The declared severity owns failure; a diagnostic's presence or class name
// alone does not establish that extraction failed.
const extractionError = z.object({ severity: z.literal("ERROR") });
type ExtractionFailureKind =
  | "missing-extractor-dependency"
  | "extractor-failure";
type DependencyFacts = { readonly names: Set<string>; unnamed: boolean };
interface ExtractionProblemFacts {
  readonly failureKinds: ExtractionFailureKind[];
  /** null means no dependency report; unnamed preserves unavailable identity. */
  readonly dependencies: DependencyFacts | null;
}
/** Parse each stage's direct problems once; nested diagnostic traversal is separate. */
const extractionProblemFacts = (
  reports: readonly unknown[],
): ExtractionProblemFacts => {
  const kinds = new Set<ExtractionFailureKind>();
  let dependencies: DependencyFacts | null = null;
  for (const item of reports) {
    const parsed = missingDependency.safeParse(item);
    if (parsed.success) {
      kinds.add("missing-extractor-dependency");
      dependencies ??= { names: new Set<string>(), unnamed: false };
      if (parsed.data.dependencies.length === 0) dependencies.unnamed = true;
      for (const name of parsed.data.dependencies)
        if (name === "") dependencies.unnamed = true;
        else dependencies.names.add(name);
    } else if (extractionError.safeParse(item).success)
      kinds.add("extractor-failure");
  }
  return { failureKinds: [...kinds], dependencies };
};

/** Callers select the owner key; absence and an unnamed failure stay distinct. */
const accumulateDependencies = (
  owners: Map<string, DependencyFacts>,
  key: string,
  facts: DependencyFacts | null,
): void => {
  if (facts === null) return;
  const known = owners.get(key);
  if (known === undefined) {
    owners.set(key, facts);
    return;
  }
  for (const name of facts.names) known.names.add(name);
  known.unnamed ||= facts.unnamed;
};
const region = z.object({
  id: z.string(),
  start_offset: integer,
  end_offset: integer,
  size: integer,
});
type BlobOrigin = {
  readonly handler: string | null;
  readonly range: { readonly offset: number; readonly length: number } | null;
};
const known = new Set([
  "StatReport",
  "HashReport",
  "FileMagicReport",
  "RandomnessReport",
  "ChunkReport",
  "UnknownChunkReport",
  "CarveDirectoryReport",
  "MultiFileReport",
]);

/** Collect the named extractors from any dependency report nested in one value. */
const diagnosticDependencyNames = (value: unknown): string[] => {
  // Producer-controlled name volume must not make deduplication quadratic;
  // a Set keeps collection linear and uniqueSorted restores canonical order.
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const failure = missingDependency.safeParse(node);
    if (failure.success) {
      // Empty names carry unknown identity, not evidence against the known
      // names in the same declaration. Ownership facts retain that unknown;
      // diagnostics project only names and keep the complete source report.
      for (const dependency of failure.data.dependencies)
        if (dependency !== "") found.add(dependency);
    }
    // A declaration may also carry nested producer diagnostics. Its own
    // admission does not determine whether those independent reports exist.
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return [...found];
};

/**
 * Name the missing extractors and the producing stage for one extraction
 * problem so a caller can act without decoding the raw report. The original
 * report stays retained alongside the normalized fields.
 */
const extractionDiagnostic = (
  inputPath: string,
  stage: string | null,
  report: JsonValue,
): JsonValue => {
  const dependencies = diagnosticDependencyNames(report);
  return {
    input_path: inputPath,
    ...(stage === null ? {} : { stage }),
    ...(dependencies.length === 0
      ? {}
      : { missing_dependencies: dependencies }),
    report,
  };
};

/** Interpret the pinned Binwalk report without inventing validated region lengths. */
export const normalizeBinwalkReport = (
  raw: unknown,
  inputPath: string,
  size: number,
) => {
  const records = scan.parse(raw);
  const analysis = records[0]?.Analysis;
  if (
    records.length !== 1 ||
    analysis?.file_path !== inputPath ||
    Object.keys(analysis.extractions).length !== 0
  )
    throw new AnalysisOutputError(
      "inspect_firmware_regions",
      "Expected one inspection-only report for the selected immutable input",
    );
  return analysis.file_map.map((hit) => {
    if (hit.offset >= size || hit.size > size - hit.offset)
      throw new AnalysisOutputError(
        "inspect_firmware_regions",
        "Reported region lies outside the selected file",
      );
    return {
      provider_id: hit.id,
      offset: hit.offset,
      reported_size: hit.size,
      signature: hit.name,
      description: hit.description,
      reported_confidence: hit.confidence,
      size_basis: "provider_reported_validation_unknown" as const,
    };
  });
};

/** Normalize Unblob's unordered task graph, retaining unknown and failed analyses. */
export const normalizeUnblobReport = (
  raw: unknown,
  context: {
    inputPath: string;
    outputRoot: string;
    sha256: string;
    length: number;
    offset: number;
    maxDepth: number;
  },
) => {
  const records = extraction.parse(raw);
  const logical = (path: string) =>
    firmwareLogicalPath(path, context.inputPath, context.outputRoot);
  const roots = records.filter(
    ({ task: item }) => item.path === context.inputPath && item.depth === 0,
  );
  if (roots.length !== 1)
    throw new AnalysisOutputError(
      "extract_firmware",
      "Expected exactly one selected input task",
    );
  const rootHash = roots[0]?.reports.find(
    (r) => r.__typename__ === "HashReport",
  );
  if (
    rootHash === undefined ||
    hashes.parse(rootHash).sha256 !== context.sha256
  )
    throw new AnalysisOutputError(
      "extract_firmware",
      "Unblob input hash disagrees with selected snapshot",
    );
  const files = new Map<
    string,
    { sha256: string | null; mimeType: string | null; depth: number }
  >();
  const sizes = new Map<string, number>();
  const depths: string[] = [];
  const failedExtractionStages: {
    input_path: string;
    provider_id: string | null;
    handler: string | null;
    dependencies: readonly string[];
    kind: "missing-extractor-dependency" | "extractor-failure";
  }[] = [];
  const diagnostics: JsonValue[] = [];
  const blobOrigins = new Map<string, BlobOrigin>();
  const addBlobOrigin = (
    parentPath: string,
    id: string,
    origin: BlobOrigin,
  ) => {
    const key = JSON.stringify([parentPath, id]);
    if (blobOrigins.has(key))
      throw new AnalysisOutputError(
        "extract_firmware",
        `Duplicate blob identity in parent task: ${parentPath} (${id})`,
      );
    blobOrigins.set(key, origin);
  };
  const chunks: {
    input_path: string;
    provider_id: string;
    range: { offset: number; length: number };
    handler: string | null;
    encrypted: boolean | null;
    root_file_range: { offset: number; length: number } | null;
    extraction_failure_kinds: ExtractionFailureKind[];
  }[] = [];
  const seen = new Set<string>();
  const taskFailures = new Set<string>();
  const missingDependencies = new Map<string, DependencyFacts>();
  /** Dependencies reported by one chunk's extraction, keyed with its chunk id. */
  const chunkMissingDependencies = new Map<string, DependencyFacts>();
  const dependencyRows = (
    facts: DependencyFacts,
  ): readonly { dependencies: readonly string[] }[] => [
    ...(facts.names.size > 0
      ? [{ dependencies: uniqueSorted([...facts.names]) }]
      : []),
    ...(facts.unnamed ? [{ dependencies: [] }] : []),
  ];
  for (const record of records) {
    const path = logical(record.task.path);
    if (seen.has(path))
      throw new AnalysisOutputError(
        "extract_firmware",
        `Duplicate analysis task: ${path}`,
      );
    seen.add(path);
    if (record.task.depth >= context.maxDepth) depths.push(path);
    const metadata = record.reports.find(
      (r) => r.__typename__ === "StatReport",
    );
    if (metadata === undefined)
      throw new AnalysisOutputError(
        "extract_firmware",
        `Missing StatReport: ${path}`,
      );
    const parsedStat = stat.parse(metadata);
    if (parsedStat.path !== record.task.path)
      throw new AnalysisOutputError(
        "extract_firmware",
        `StatReport is bound to another task: ${path}`,
      );
    if (path === "$input" && parsedStat.size !== context.length)
      throw new AnalysisOutputError(
        "extract_firmware",
        "Unblob input size disagrees with selected snapshot",
      );
    if (
      path === "$input" &&
      (!parsedStat.is_file || parsedStat.is_link || parsedStat.is_dir)
    )
      throw new AnalysisOutputError(
        "extract_firmware",
        "Selected input was not reported as a regular file",
      );
    sizes.set(path, parsedStat.size);
    const hash = record.reports.find((r) => r.__typename__ === "HashReport");
    const magic = record.reports.find(
      (r) => r.__typename__ === "FileMagicReport",
    );
    if (parsedStat.is_file && !parsedStat.is_link)
      files.set(path, {
        sha256: hash === undefined ? null : hashes.parse(hash).sha256,
        mimeType:
          magic === undefined
            ? null
            : z.object({ mime_type: z.string() }).parse(magic).mime_type,
        depth: record.task.depth,
      });
    for (const item of record.reports) {
      if (!known.has(item.__typename__))
        diagnostics.push(
          jsonValueSchema.parse({ input_path: path, report: item }),
        );
      const problem = extractionProblemFacts([item]);
      accumulateDependencies(missingDependencies, path, problem.dependencies);
      if (
        problem.failureKinds.includes("extractor-failure") &&
        !taskFailures.has(path)
      ) {
        taskFailures.add(path);
        failedExtractionStages.push({
          input_path: path,
          provider_id: null,
          handler: null,
          dependencies: [],
          kind: "extractor-failure",
        });
      }
      if (
        item.__typename__ === "ChunkReport" ||
        item.__typename__ === "UnknownChunkReport"
      ) {
        const parsed = region.parse(item);
        if (
          parsed.end_offset <= parsed.start_offset ||
          parsed.end_offset > parsedStat.size ||
          parsed.size !== parsed.end_offset - parsed.start_offset
        )
          throw new AnalysisOutputError(
            "extract_firmware",
            `Invalid chunk bounds for ${path}`,
          );
        const detail =
          item.__typename__ === "ChunkReport"
            ? z
                .object({
                  handler_name: z.string(),
                  is_encrypted: z.boolean(),
                  extraction_reports: z.array(jsonValueSchema),
                })
                .parse(item)
            : null;
        const problems = extractionProblemFacts(
          detail?.extraction_reports ?? [],
        );
        // Chunk-nested reports retain their owning chunk, not the whole task.
        accumulateDependencies(
          chunkMissingDependencies,
          JSON.stringify([path, parsed.id]),
          problems.dependencies,
        );
        if (detail !== null)
          for (const problem of detail.extraction_reports) {
            diagnostics.push(
              extractionDiagnostic(
                path,
                detail.handler_name,
                jsonValueSchema.parse(problem),
              ),
            );
          }
        addBlobOrigin(path, parsed.id, {
          handler: detail?.handler_name ?? null,
          range: { offset: parsed.start_offset, length: parsed.size },
        });
        chunks.push({
          input_path: path,
          provider_id: parsed.id,
          range: { offset: parsed.start_offset, length: parsed.size },
          handler: detail?.handler_name ?? null,
          encrypted: detail?.is_encrypted ?? null,
          extraction_failure_kinds: problems.failureKinds,
          root_file_range:
            path === "$input"
              ? {
                  offset: context.offset + parsed.start_offset,
                  length: parsed.size,
                }
              : null,
        });
      }
      if (item.__typename__ === "MultiFileReport") {
        const parsed = multiFile.parse(item);
        addBlobOrigin(path, parsed.id, {
          handler: parsed.handler_name,
          range: null,
        });
        if (parsed.extraction_reports.length > 0) {
          diagnostics.push(
            extractionDiagnostic(
              path,
              parsed.handler_name,
              jsonValueSchema.parse(item),
            ),
          );
          // The report owns its failure and dependencies. A produced subtask
          // is a derivation, not a new owner for the parent's report.
          const problems = extractionProblemFacts(parsed.extraction_reports);
          const dependencies = problems.dependencies;
          const rows = [
            ...(dependencies === null
              ? []
              : dependencyRows(dependencies).map((row) => ({
                  ...row,
                  kind: "missing-extractor-dependency" as const,
                }))),
            ...(problems.failureKinds.includes("extractor-failure")
              ? [{ dependencies: [], kind: "extractor-failure" as const }]
              : []),
          ];
          for (const row of rows)
            failedExtractionStages.push({
              input_path: path,
              provider_id: parsed.id,
              handler: parsed.handler_name,
              dependencies: row.dependencies,
              kind: row.kind,
            });
        }
      }
    }
  }
  const recordsByPath = new Map(
    records.map((record) => [record.task.path, record.task]),
  );
  const derivations = records.flatMap((record) =>
    record.subtasks.map((child) => {
      const parentPath = logical(record.task.path);
      const childPath = logical(child.path);
      if (!seen.has(childPath))
        throw new AnalysisOutputError(
          "extract_firmware",
          `Missing child task: ${childPath}`,
        );
      const reportedChild = recordsByPath.get(child.path);
      if (
        reportedChild?.depth !== child.depth ||
        reportedChild.blob_id !== child.blob_id ||
        reportedChild.is_multi_file !== child.is_multi_file
      )
        throw new AnalysisOutputError(
          "extract_firmware",
          `Child task identity disagrees with its analysis: ${childPath}`,
        );
      const origin = blobOrigins.get(
        JSON.stringify([parentPath, child.blob_id]),
      );
      return {
        parent_path: parentPath,
        child_path: childPath,
        provider_blob_id: child.blob_id,
        handler: origin?.handler ?? null,
        parent_file_range: origin?.range ?? null,
      };
    }),
  );
  const reachable = new Set(["$input"]);
  const pending = ["$input"];
  const childrenByParent = new Map<string, string[]>();
  for (const edge of derivations) {
    const children = childrenByParent.get(edge.parent_path) ?? [];
    children.push(edge.child_path);
    childrenByParent.set(edge.parent_path, children);
  }
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const child of childrenByParent.get(parent ?? "") ?? []) {
      if (reachable.has(child)) continue;
      reachable.add(child);
      pending.push(child);
    }
  }
  if (reachable.size !== seen.size)
    throw new AnalysisOutputError(
      "extract_firmware",
      "Report contains tasks disconnected from the selected input",
    );
  // A producer can emit no UnknownChunkReport for an opaque file. Compute
  // examined byte coverage from reported intervals rather than from empty errors.
  const unclassifiedRanges: {
    input_path: string;
    range: { offset: number; length: number };
    root_file_range: { offset: number; length: number };
  }[] = [];
  let coveredEnd = 0;
  const gap = (offset: number, length: number) =>
    unclassifiedRanges.push({
      input_path: "$input",
      range: { offset, length },
      root_file_range: { offset: context.offset + offset, length },
    });
  for (const chunk of chunks
    .filter((chunk) => chunk.input_path === "$input")
    .sort((left, right) => left.range.offset - right.range.offset)) {
    if (chunk.range.offset > coveredEnd)
      gap(coveredEnd, chunk.range.offset - coveredEnd);
    coveredEnd = Math.max(coveredEnd, chunk.range.offset + chunk.range.length);
  }
  if (coveredEnd < context.length) gap(coveredEnd, context.length - coveredEnd);
  return {
    files,
    sizes,
    chunks,
    unclassified_ranges: unclassifiedRanges,
    derivations,
    depth_limited_paths: depths.sort(),
    failed_extraction_stages: failedExtractionStages.sort((left, right) =>
      `${left.input_path}\u0000${left.provider_id ?? ""}` <
      `${right.input_path}\u0000${right.provider_id ?? ""}`
        ? -1
        : `${left.input_path}\u0000${left.provider_id ?? ""}` >
            `${right.input_path}\u0000${right.provider_id ?? ""}`
          ? 1
          : 0,
    ),
    diagnostics,
    missing_dependencies: [...missingDependencies.entries()]
      .flatMap(([input_path, facts]) =>
        dependencyRows(facts).map(({ dependencies }) => ({
          input_path,
          dependencies,
        })),
      )
      .sort((left, right) =>
        left.input_path < right.input_path
          ? -1
          : left.input_path > right.input_path
            ? 1
            : 0,
      ),
    chunk_missing_dependencies: [...chunkMissingDependencies.entries()]
      .flatMap(([key, facts]) => {
        const [input_path, provider_id] = JSON.parse(key) as [string, string];
        return dependencyRows(facts).map(({ dependencies }) => ({
          input_path,
          provider_id,
          dependencies,
        }));
      })
      .sort((left, right) =>
        `${left.input_path}\u0000${left.provider_id}` <
        `${right.input_path}\u0000${right.provider_id}`
          ? -1
          : `${left.input_path}\u0000${left.provider_id}` >
              `${right.input_path}\u0000${right.provider_id}`
            ? 1
            : 0,
      ),
    coverage:
      unclassifiedRanges.length > 0 ||
      depths.length > 0 ||
      diagnostics.length > 0 ||
      chunks.some((c) => c.handler === null || c.encrypted === true)
        ? ("partial" as const)
        : ("complete" as const),
  };
};
