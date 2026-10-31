import { join } from "node:path";
import { Readable } from "node:stream";
import type { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import {
  javascriptRecoveryResultSchema,
  type JavaScriptRecoveryInput,
  type JavaScriptRecoveryResult,
} from "../../domain/javascript/javascriptRecovery.js";
import {
  readRecoveryFile,
  recoveryDigest,
  type RecoveryInputSnapshot,
} from "./RecoveryFiles.js";
import {
  recoveryRanges,
  validateRecoverySourceMap,
  type parseWakaruReports,
} from "./WakaruReport.js";
import {
  RECOVERY_LIMITATIONS,
  RECOVERY_LIMITS,
  WAKARU_RELEASE,
} from "./WakaruRelease.js";
import type {
  resolveWakaruCommand,
  runWakaruCommand,
} from "./WakaruCommand.js";
import type { WakaruVersionAdmission } from "./WakaruVersion.js";

type PublicationContext = {
  tree: SafeOutputTree;
  staging: string;
  input: JavaScriptRecoveryInput;
  sources: readonly [RecoveryInputSnapshot, ...RecoveryInputSnapshot[]];
  engine: Awaited<ReturnType<typeof resolveWakaruCommand>>;
  admitted: Exclude<WakaruVersionAdmission, { status: "unsupported" }>;
  parsed: Awaited<ReturnType<typeof parseWakaruReports>>;
  execution: Awaited<ReturnType<typeof runWakaruCommand>>;
  resources?: ArtifactResourceScope;
  signal?: AbortSignal;
};
type PublishedFile = JavaScriptRecoveryResult["manifest"];
type RecoveryWriter = (path: string, bytes: Buffer) => Promise<PublishedFile>;

/** Write validated artifacts to one exclusively owned, rollback-capable tree. */
export const publishWakaruArtifacts = async (
  context: PublicationContext,
): Promise<JavaScriptRecoveryResult> => {
  const { tree, sources, parsed, staging, signal, resources } = context;
  const write = async (path: string, bytes: Buffer) => {
    const sha256 = recoveryDigest(bytes);
    const file = await tree.write(
      path,
      Readable.from([bytes]),
      { sha256, bytes: bytes.byteLength },
      signal,
    );
    return {
      path: join(tree.outputRoot, file.relativePath),
      sha256: file.sha256,
      bytes: file.bytesWritten,
    };
  };
  const publishedSources: JavaScriptRecoveryResult["source"][] = [];
  for (const selected of sources) {
    const { relative_path, ...source } = selected;
    const snapshot = await readRecoveryFile(
      source.snapshot_path,
      source.bytes,
      signal,
      resources,
    );
    if (recoveryDigest(snapshot) !== source.sha256)
      throw new AnalysisOutputError(
        "recover_javascript_sources",
        `The input snapshot changed during recovery: ${source.path}`,
      );
    publishedSources.push({
      ...source,
      published_copy: await write(`inputs/${relative_path}`, snapshot),
    });
  }
  const [source, ...additionalSources] = publishedSources;
  const modules: JavaScriptRecoveryResult["modules"] = [];
  for (const module of parsed.report.modules) {
    modules.push(await publishModule(context, module, write));
  }
  const report = await write(
    "reports/stdout.json",
    Buffer.from(context.execution.stdout),
  );
  const provenance = await write(
    "reports/provenance.json",
    await readRecoveryFile(
      join(staging, "provenance.json"),
      RECOVERY_LIMITS.reportBytes,
      signal,
      resources,
    ),
  );
  const details = {
    source,
    ...(additionalSources.length === 0
      ? {}
      : { additional_sources: additionalSources }),
    engine: {
      id: "wakaru",
      version: context.admitted.version,
      executable: {
        path: context.engine.command.resolvedPath,
        sha256: context.engine.sha256,
        bytes: context.engine.bytes,
      },
      audited_source_revision: WAKARU_RELEASE.revision,
      executed_source_revision: null,
    },
    options: {
      extraction_mode: context.input.extraction_mode,
      rewrite_level: context.input.rewrite_level,
    },
    status: parsed.status,
    detected_formats: parsed.report.detected_formats,
    reported_safety: parsed.report.safety,
    reported_strategy: parsed.provenance.strategy,
    reported_format: parsed.provenance.format,
    total: parsed.report.total,
    failed: parsed.report.failed,
    modules,
    warnings: parsed.report.warnings.map(
      ({ filename, kind, is_error, message }) => ({
        filename,
        kind,
        is_error,
        message,
      }),
    ),
    report,
    provenance,
    analysis_input:
      modules.length === 0
        ? null
        : {
            input_path: join(tree.outputRoot, "modules"),
            format: "directory" as const,
          },
    runtime_equivalence: "unknown" as const,
    limitations: [
      ...RECOVERY_LIMITATIONS,
      ...(context.admitted.status === "compatible"
        ? [context.admitted.limitation]
        : []),
    ],
  };
  const manifest = await write(
    "manifest.json",
    Buffer.from(`${JSON.stringify(details, null, 2)}\n`),
  );
  return javascriptRecoveryResultSchema.parse({ ...details, manifest });
};

const publishModule = async (
  context: PublicationContext,
  module: PublicationContext["parsed"]["report"]["modules"][number],
  write: RecoveryWriter,
): Promise<JavaScriptRecoveryResult["modules"][number]> => {
  const { staging, sources, parsed, signal, resources } = context;
  const artifact = await write(
    `modules/${module.filename}`,
    await readRecoveryFile(
      join(staging, module.filename),
      RECOVERY_LIMITS.outputBytes,
      signal,
      resources,
    ),
  );
  const mapPath = join(staging, `${module.filename}.map`);
  let sourceMap: JavaScriptRecoveryResult["modules"][number]["source_map"] =
    null;
  const map = await readRecoveryFile(
    mapPath,
    RECOVERY_LIMITS.outputBytes,
    signal,
    resources,
  ).catch((cause: unknown) => {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return null;
    throw cause;
  });
  if (map !== null) {
    validateRecoverySourceMap(map, module.filename);
    sourceMap = await write(`modules/${module.filename}.map`, map);
  }
  const provenance = parsed.provenance.modules[module.filename];
  if (provenance === undefined)
    throw new AnalysisOutputError(
      "recover_javascript_sources",
      `Missing module provenance: ${module.filename}`,
    );
  const origin = sources.find(
    (source) => source.snapshot_path === provenance.input,
  );
  if (origin === undefined)
    throw new AnalysisOutputError(
      "recover_javascript_sources",
      `Unselected module provenance input: ${provenance.input}`,
    );
  return {
    reported_filename: module.filename,
    reported_status: module.status,
    artifact,
    source_map: sourceMap,
    provenance: {
      reported_input: provenance.input,
      original_path: origin.path,
      original_sha256: origin.sha256,
      extraction: provenance.extraction,
      byte_ranges: recoveryRanges(provenance.ranges),
      context_byte_ranges: recoveryRanges(provenance.context_ranges ?? []),
      range_semantics: "half-open-utf8-bytes",
    },
  };
};
