import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  firmwareFailure,
  firmwarePhaseInterruption,
} from "./FirmwareFailures.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { z } from "zod";
import { SafeOutputTree } from "../artifacts/SafeOutputTree.js";
import { outputDirectoryAdmissionRefusal } from "../artifacts/SafeOutputTreeAdmission.js";
import { SafeOutputTreeCreationFailure } from "../artifacts/SafeOutputTreeCreationFailure.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import {
  firmwareResultSchemas,
  MAX_FIRMWARE_EXTRACTION_DEPTH,
} from "../domain/firmware/firmwareAnalysis.js";
import type { FirmwareFileAccess, FirmwareEntry } from "./FirmwareFiles.js";
import type { normalizeUnblobReport } from "./FirmwareReports.js";
import type { extractionGap } from "../domain/firmware/firmwareAnalysis.js";

type ExtractionGap = z.infer<typeof extractionGap>;

/** Static, truthful continuations that use already configured capabilities. */
const GAP_CONTINUATIONS: Record<ExtractionGap["kind"], string> = {
  "missing-extractor-dependency":
    "REA installs nothing. Add the named dependency to your own environment and rerun extract_firmware on the same immutable input with a fresh output_directory to re-evaluate the affected region; otherwise it stays unextracted.",
  "unknown-chunk-handler":
    "If Binwalk is configured with REA_BINWALK_COMMAND, run inspect_firmware_regions on the same input for signature hypotheses. Without configured Binwalk that inspection is unavailable. Alternatively, select a materially narrower range with extract_firmware and a fresh output_directory; the region is not decoded content.",
  "unclassified-range":
    "The producer reported no chunk covering these bytes. Their format and extraction status remain unknown. If Binwalk is configured, inspect_firmware_regions can supply signature hypotheses; otherwise retain this range as unexamined.",
  "encrypted-chunk":
    "No static extraction continues past encryption; treat the region as unexamined rather than empty or corrupt.",
  "extractor-failure":
    "The producer retained this chunk's extraction problem in diagnostics. Review the reported failure, then rerun extract_firmware on the same immutable input with a fresh output_directory; the region is not decoded content.",
  "depth-limited": `Rerun extract_firmware with a higher max_depth (up to ${MAX_FIRMWARE_EXTRACTION_DEPTH}) and a fresh output_directory to descend into this path.`,
  "unpublished-entry":
    "The entry is retained as metadata; only regular files are published, without executable permission bits.",
};

const UNNAMED_DEPENDENCY_CONTINUATION =
  "The producer reported a missing extractor dependency without naming it; its identity is unavailable in this evidence. No specific installation or rerun can be prescribed from this report. Retain the gap as unextracted unless additional provider evidence establishes the dependency. REA installs nothing.";

import { FIRMWARE_LIMITS } from "./FirmwareRelease.js";
import type { FirmwareDeadline } from "./FirmwareDeadline.js";

const depthContinuation = (
  maxDepth: number,
  publishedChildPaths: readonly string[],
): string =>
  maxDepth < MAX_FIRMWARE_EXTRACTION_DEPTH
    ? GAP_CONTINUATIONS["depth-limited"]
    : publishedChildPaths.length > 0
      ? `This extraction already ran at the lane's maximum depth. To continue, rerun extract_firmware with path set to any eligible published child below this path and a fresh output directory; each child listed here restarts the depth budget: ${publishedChildPaths.map((path) => JSON.stringify(path)).join(", ")}.`
      : `This extraction already ran at the lane's maximum depth, and no published child under this path is both nonempty and within the ${FIRMWARE_LIMITS.inputBytes}-byte firmware input limit, so the depth budget cannot be restarted from this output. Treat the region below this path as unexamined.`;

// Use a different analyzer on the actual published child; repeating the same
// whole-child extraction with unchanged handlers would reproduce this gap.
const nestedUnknownContinuation = (
  publishedFile: { readonly path: string; readonly size: number } | undefined,
): string => {
  const base =
    "This unknown chunk was carved from a nested extraction, so its range is relative to the published child named by this gap's input_path, not to the original input.";
  return publishedFile !== undefined &&
    publishedFile.size > 0 &&
    publishedFile.size <= FIRMWARE_LIMITS.inputBytes
    ? `${base} Run inspect_firmware_regions with path set to that published child for signature hypotheses only if Binwalk is configured with REA_BINWALK_COMMAND. This inspection step is unavailable without configured Binwalk; retain the region as unexamined. Repeating the same whole-child extraction with unchanged handlers would not advance analysis.`
    : `${base} That published child is not a nonempty file within the ${FIRMWARE_LIMITS.inputBytes}-byte firmware input limit, so inspect_firmware_regions cannot accept it as a fresh input; treat the region as unexamined.`;
};

const emptyGap = {
  relative_path: null,
  handler: null,
  provider_id: null,
  range: null,
  root_file_range: null,
  dependencies: [],
};

const gapSortKey = (gap: ExtractionGap): string =>
  [
    gap.input_path,
    gap.kind,
    gap.provider_id ?? "",
    gap.relative_path ?? "",
  ].join("\u0000");

/** Publish verified regular files, preserving links as metadata and rolling back failed writes. */
export const publishFirmwareExtraction = async (context: {
  files: FirmwareFileAccess;
  workspacePath: string;
  deadline: FirmwareDeadline;
  analysisTimeoutMs: number;
  outputDirectory: string;
  entries: readonly FirmwareEntry[];
  normalized: ReturnType<typeof normalizeUnblobReport>;
  selection: { offset: number; length: number; sha256: string };
  /** Caller-selected extraction depth, for boundary-aware continuations. */
  maxDepth: number;
  engine: z.infer<typeof firmwareResultSchemas.extract_firmware>["engine"];
  signal: AbortSignal;
  retainCleanup: (
    tree: SafeOutputTree,
    lease: AnalysisCleanupLease,
    failure: AnalysisError,
  ) => void;
}) => {
  let tree: SafeOutputTree | undefined;
  let result:
    | z.infer<typeof firmwareResultSchemas.extract_firmware>
    | undefined;
  const files: z.infer<typeof firmwareResultSchemas.extract_firmware>["files"] =
    [];
  let totalFiles = 0;
  const progress = () => ({
    output_directory: context.outputDirectory,
    verified_files: files.length,
    total_files: totalFiles,
  });
  try {
    const materialized = new Set<string>();
    for (const entry of context.entries)
      if (entry.kind === "file")
        materialized.add(`$output/${entry.relativePath}`);
    totalFiles = materialized.size;
    for (const path of context.normalized.files.keys()) {
      if (path !== "$input" && !materialized.has(path))
        throw new AnalysisOutputError(
          "extract_firmware",
          `Reported regular file is absent from materialized output: ${path}`,
        );
    }
    const unpublished = [];
    tree = await SafeOutputTree.create(context.outputDirectory);
    for (const entry of context.entries) {
      if (entry.kind !== "file") {
        unpublished.push({
          relative_path: entry.relativePath,
          kind: entry.kind,
          link_target: entry.linkTarget,
          ...(entry.linkTargetHex === undefined
            ? {}
            : { link_target_hex: entry.linkTargetHex }),
        });
        continue;
      }
      const logicalPath = `$output/${entry.relativePath}`;
      const reported = context.normalized.files.get(logicalPath);
      const sha256 = await context.files.hash(entry.path, context.signal);
      if (
        (reported?.sha256 !== null &&
          reported?.sha256 !== undefined &&
          reported.sha256 !== sha256) ||
        (context.normalized.sizes.has(logicalPath) &&
          context.normalized.sizes.get(logicalPath) !== entry.size)
      )
        throw new AnalysisOutputError(
          "extract_firmware",
          `Extracted bytes disagree with provider report: ${entry.relativePath}`,
        );
      const written = await context.files.publish(
        entry,
        sha256,
        tree,
        context.signal,
      );
      files.push({
        relative_path: entry.relativePath,
        path: join(tree.outputRoot, written.relativePath),
        size: entry.size,
        sha256,
        reported_sha256: reported?.sha256 ?? null,
        mime_type: reported?.mimeType ?? null,
        analysis_depth: reported?.depth ?? null,
        runtime_address: null,
        original_file_range: null,
      });
    }
    result = firmwareResultSchemas.extract_firmware.parse({
      analysis_timeout_ms: context.analysisTimeoutMs,
      engine: context.engine,
      selection: context.selection,
      output_directory: tree.outputRoot,
      coverage:
        unpublished.length > 0 ? "partial" : context.normalized.coverage,
      files,
      unpublished_entries: unpublished,
      chunks: context.normalized.chunks.map(
        ({ extraction_failure_kinds, ...chunk }) => ({
          ...chunk,
          extraction_failed: extraction_failure_kinds.length > 0,
        }),
      ),
      derivations: context.normalized.derivations,
      depth_limited_paths: context.normalized.depth_limited_paths,
      diagnostics: context.normalized.diagnostics,
      ...extractionGaps(
        unpublished,
        files,
        context.normalized,
        context.maxDepth,
      ),
      published_bytes: files.reduce((sum, file) => sum + file.size, 0),
    });
    const interruption = firmwarePhaseInterruption(
      "extract_firmware",
      context.signal,
      context.deadline,
      progress(),
    );
    if (interruption !== undefined) throw interruption;
    await tree.commit(context.signal);
    return result;
  } catch (cause: unknown) {
    if (cause instanceof SafeOutputTreeCreationFailure) tree = cause.tree;
    const ownedTree = tree;
    const treeLease =
      ownedTree === undefined
        ? undefined
        : new AnalysisCleanupLease(async () => {
            await ownedTree.rollback();
          });
    const primary = firmwareFailure(
      outputDirectoryAdmissionRefusal(
        "extract_firmware",
        "output_directory",
        cause,
      ),
      {
        engine: "unblob",
        operation: "extract_firmware",
        deadline: context.deadline,
        treeCleanupLease: treeLease,
        publication: progress(),
      },
    );
    try {
      await treeLease?.release();
    } catch (cleanupCause: unknown) {
      const publishedResult =
        tree?.published === true && result !== undefined
          ? {
              kind: "firmware" as const,
              result: jsonValueSchema.parse(result),
            }
          : undefined;
      const cleanup = new ProviderCleanupError(
        "unblob",
        [context.outputDirectory, context.workspacePath],
        {
          reason:
            cleanupCause instanceof Error
              ? cleanupCause.message
              : String(cleanupCause),
          previous_error:
            cause instanceof Error ? cause.message : String(cause),
        },
        {
          cause: cleanupCause,
          operation: "extract_firmware",
          ...(publishedResult === undefined
            ? {}
            : { partialObservation: publishedResult }),
        },
      );
      if (tree !== undefined && treeLease !== undefined)
        context.retainCleanup(tree, treeLease, cleanup);
      if (publishedResult !== undefined)
        primary.retainPartialObservation(publishedResult);
      throw analysisErrorWithCleanupFailure(
        primary,
        cleanup,
        "extract_firmware",
      ).bindCleanupDependencies([primary, cleanup]);
    }
    if (tree?.published === true && result !== undefined) return result;
    throw primary;
  }
};

/** Derive explicit recovery rows from retained report facts; no new claims. */
/** Gap rows for missing-dependency reports: chunk-nested rows keep their owning chunk. */
const dependencyExtractionGaps = (
  normalized: ReturnType<typeof normalizeUnblobReport>,
  continuation: (instruction: string) => string,
): ExtractionGap[] => {
  // Chunk-nested dependency reports name the chunk that could not extract;
  // task-wide reports (standalone or multi-file) attach to the task.
  // One index over the chunk list keeps dependency-row resolution linear.
  const chunksByKey = new Map(
    normalized.chunks.map((chunk) => [
      JSON.stringify([chunk.input_path, chunk.provider_id]),
      chunk,
    ]),
  );
  return [
    ...normalized.chunk_missing_dependencies.flatMap(
      ({ input_path, provider_id, dependencies }): ExtractionGap[] => {
        const affected = chunksByKey.get(
          JSON.stringify([input_path, provider_id]),
        );
        return [
          {
            kind: "missing-extractor-dependency",
            input_path,
            ...emptyGap,
            ...(affected === undefined
              ? {}
              : {
                  handler: affected.handler,
                  provider_id,
                  range: affected.range,
                  root_file_range: affected.root_file_range,
                }),
            dependencies: [...dependencies],
            continuation_id: continuation(
              dependencies.length > 0
                ? GAP_CONTINUATIONS["missing-extractor-dependency"]
                : UNNAMED_DEPENDENCY_CONTINUATION,
            ),
          },
        ];
      },
    ),
    ...normalized.failed_extraction_stages
      .filter(({ kind }) => kind === "missing-extractor-dependency")
      .map(
        ({
          input_path,
          provider_id,
          handler,
          dependencies,
        }): ExtractionGap => ({
          kind: "missing-extractor-dependency",
          input_path,
          ...emptyGap,
          handler,
          provider_id,
          dependencies: [...dependencies],
          continuation_id: continuation(
            dependencies.length > 0
              ? GAP_CONTINUATIONS["missing-extractor-dependency"]
              : UNNAMED_DEPENDENCY_CONTINUATION,
          ),
        }),
      ),
    // Standalone reports name only the task; do not borrow another stage's id.
    ...normalized.missing_dependencies.map(
      ({ input_path, dependencies }): ExtractionGap => ({
        kind: "missing-extractor-dependency",
        input_path,
        ...emptyGap,
        dependencies: [...dependencies],
        continuation_id: continuation(
          dependencies.length > 0
            ? GAP_CONTINUATIONS["missing-extractor-dependency"]
            : UNNAMED_DEPENDENCY_CONTINUATION,
        ),
      }),
    ),
  ];
};

const extractionGaps = (
  unpublished: z.infer<
    typeof firmwareResultSchemas.extract_firmware
  >["unpublished_entries"],
  files: readonly z.infer<
    typeof firmwareResultSchemas.extract_firmware
  >["files"][number][],
  normalized: ReturnType<typeof normalizeUnblobReport>,
  maxDepth: number,
) => {
  // Intern before row construction: N gaps retain N identities, while K unique
  // recovery instructions consume prose only K times in the public result.
  const instructions = new Map<string, string>();
  const continuation = (instruction: string): string => {
    const known = instructions.get(instruction);
    if (known !== undefined) return known;
    const id = createHash("sha256").update(instruction).digest("hex");
    instructions.set(instruction, id);
    return id;
  };
  const dependencyGaps = dependencyExtractionGaps(normalized, continuation);
  const publishedFiles = new Map(
    files.map((file) => [`$output/${file.relative_path}`, file]),
  );
  const nestedContinuationId = (inputPath: string): string => {
    return continuation(
      nestedUnknownContinuation(publishedFiles.get(inputPath)),
    );
  };
  const chunkGaps = (
    kind: ExtractionGap["kind"],
    matches: (chunk: (typeof normalized.chunks)[number]) => boolean,
  ): ExtractionGap[] =>
    normalized.chunks.filter(matches).map((chunk) => ({
      kind,
      input_path: chunk.input_path,
      ...emptyGap,
      handler: chunk.handler,
      provider_id: chunk.provider_id,
      range: chunk.range,
      root_file_range: chunk.root_file_range,
      dependencies: [],
      continuation_id:
        kind === "unknown-chunk-handler" &&
        chunk.input_path.startsWith("$output/")
          ? nestedContinuationId(chunk.input_path)
          : continuation(GAP_CONTINUATIONS[kind]),
    }));
  // A depth ceiling can only be re-rooted through a published child that a
  // fresh firmware input could actually accept; the index is only needed
  // when a depth row will actually consult it.
  const ceilingReached =
    maxDepth >= MAX_FIRMWARE_EXTRACTION_DEPTH &&
    normalized.depth_limited_paths.length > 0;
  const reRootablePaths = new Map<string, Set<string>>();
  if (ceilingReached)
    for (const [filePath, file] of [...publishedFiles].sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    )) {
      const size = file.size;
      if (size <= 0 || size > FIRMWARE_LIMITS.inputBytes) continue;
      // The published file itself can re-root a fresh run; so can every
      // directory containing it.
      const segments = filePath.split("/");
      while (segments.length > 1) {
        const ancestor = segments.join("/");
        const childPaths = reRootablePaths.get(ancestor) ?? new Set<string>();
        childPaths.add(file.path);
        reRootablePaths.set(ancestor, childPaths);
        segments.pop();
      }
    }
  const depthContinuationIds = new Map<string, string>();
  const depthContinuationId = (inputPath: string): string => {
    const existing = depthContinuationIds.get(inputPath);
    if (existing !== undefined) return existing;
    const id = continuation(
      depthContinuation(
        maxDepth,
        [...(reRootablePaths.get(inputPath) ?? [])].sort(),
      ),
    );
    depthContinuationIds.set(inputPath, id);
    return id;
  };
  const gaps: ExtractionGap[] = [
    ...dependencyGaps,
    ...normalized.unclassified_ranges.map((unclassified): ExtractionGap => ({
      ...emptyGap,
      ...unclassified,
      kind: "unclassified-range",
      continuation_id: unclassified.input_path.startsWith("$output/")
        ? nestedContinuationId(unclassified.input_path)
        : continuation(GAP_CONTINUATIONS["unclassified-range"]),
    })),
    ...normalized.failed_extraction_stages
      .filter(({ kind }) => kind === "extractor-failure")
      .map(({ input_path, provider_id, handler }): ExtractionGap => ({
        kind: "extractor-failure",
        input_path,
        ...emptyGap,
        handler,
        provider_id,
        dependencies: [],
        continuation_id: continuation(
          "The producer retained this extraction stage's failure in diagnostics. Review the stage report and correct the reported cause before rerunning extract_firmware on the same immutable input with a fresh output_directory; this report establishes no byte-region ownership.",
        ),
      })),
    ...chunkGaps("unknown-chunk-handler", (chunk) => chunk.handler === null),
    ...chunkGaps("encrypted-chunk", (chunk) => chunk.encrypted === true),
    ...chunkGaps("extractor-failure", (chunk) =>
      chunk.extraction_failure_kinds.includes("extractor-failure"),
    ),
    ...normalized.depth_limited_paths.map((input_path): ExtractionGap => ({
      kind: "depth-limited",
      input_path,
      ...emptyGap,
      dependencies: [],
      continuation_id: depthContinuationId(input_path),
    })),
    ...unpublished.map((entry): ExtractionGap => ({
      kind: "unpublished-entry",
      input_path: `$output/${entry.relative_path}`,
      ...emptyGap,
      relative_path: entry.relative_path,
      dependencies: [],
      continuation_id: continuation(GAP_CONTINUATIONS["unpublished-entry"]),
    })),
  ];
  gaps.sort((left, right) =>
    gapSortKey(left) < gapSortKey(right)
      ? -1
      : gapSortKey(left) > gapSortKey(right)
        ? 1
        : 0,
  );
  return {
    extraction_gaps: gaps,
    extraction_continuations: [...instructions].map(([instruction, id]) => ({
      id,
      instruction,
    })),
  };
};
