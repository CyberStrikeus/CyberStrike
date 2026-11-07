import { z } from "zod";
import { safeParseUtf8Json } from "../../domain/safeJson.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  normalizeArtifactPath,
  ArtifactPathRegistry,
} from "../../artifacts/ArtifactPaths.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../domain/providerAdapterError.js";
import type { JavaScriptRecoveryResult } from "../../domain/javascript/javascriptRecovery.js";
import {
  isRecoveryFileSizeError,
  readRecoveryFile,
  recoveryFailureMessage,
} from "./RecoveryFiles.js";
import { RECOVERY_LIMITS, wakaruFixedLimitRecovery } from "./WakaruRelease.js";
import type { runWakaruCommand } from "./WakaruCommand.js";

const warningSchema = z.looseObject({
  filename: z.string(),
  kind: z.string(),
  is_error: z.boolean(),
  message: z.string(),
});
const reportSchema = z.looseObject({
  detected_formats: z.array(z.string()),
  safety: z.string(),
  modules: z.array(
    z.looseObject({
      filename: z.string().min(1),
      kind: z.literal("javascript"),
      status: z.string().min(1),
    }),
  ),
  warnings: z.array(warningSchema),
  total: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  elapsed_ms: z.int().nonnegative(),
});
const rangeSchema = z.tuple([z.int().nonnegative(), z.int().nonnegative()]);
const provenanceSchema = z.looseObject({
  format: z.string(),
  strategy: z.string(),
  modules: z.record(
    z.string(),
    z.looseObject({
      input: z.string(),
      ranges: z.array(rangeSchema),
      extraction: z.string(),
      context_ranges: z.array(rangeSchema).optional(),
    }),
  ),
});

const OPERATION = "recover_javascript_sources";

type ReportContext = {
  execution: Awaited<ReturnType<typeof runWakaruCommand>>;
  provenancePath: string;
  snapshots: ReadonlyMap<string, Buffer>;
  files: readonly { relativePath: string }[];
  resources?: ArtifactResourceScope;
  signal?: AbortSignal;
};

/**
 * Parse producer JSON before projecting provider-neutral artifacts. Wakaru adds
 * fields and category values within a major version, so unknown keys are kept
 * and `status` stays the reported string; identity, path, range and file-set
 * checks below remain exact.
 */
export const parseWakaruReports = async (context: ReportContext) => {
  const { execution, provenancePath, resources, signal } = context;

  try {
    if (execution.exit_code !== 0 && execution.exit_code !== 1)
      throw new TypeError(
        "Wakaru did not complete recovery (expected exit 0 or a reported partial exit 1)",
      );
    const report = reportSchema.parse(JSON.parse(execution.stdout));
    const decoded = safeParseUtf8Json(
      await readWakaruProvenanceReport(provenancePath, signal, resources),
    );
    if (!decoded.ok) throw decoded.cause;
    const provenance = provenanceSchema.parse(decoded.value);
    if (report.total !== report.modules.length || report.failed > report.total)
      throw new TypeError("Reported module totals disagree");
    if (
      execution.exit_code === 1 &&
      report.failed === 0 &&
      !report.warnings.some((warning) => warning.is_error)
    )
      throw new TypeError(
        "Wakaru exited 1 without a reported partial recovery reason",
      );
    validateModuleSet(report, provenance, context);
    return {
      report,
      provenance,
      status:
        report.failed > 0 ||
        report.warnings.some((warning) => warning.is_error) ||
        execution.exit_code === 1
          ? ("partial" as const)
          : ("complete" as const),
    };
  } catch (cause: unknown) {
    if (
      cause instanceof ArtifactReaderFailure &&
      (cause.cleanup !== undefined || cause.reason === "cancelled")
    )
      throw cause;
    throw new ProviderAdapterError("wakaru", OPERATION, {
      cause,
      ...wakaruReportGuidance(cause),
      diagnostics: {
        reason: `Unusable Wakaru recovery report: ${recoveryFailureMessage(cause)}`,
        exit_code: execution.exit_code,
        signal: execution.signal,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    });
  }
};

const PROVENANCE_REPORT_ALLOWANCE = `Wakaru provenance report exceeds the ${String(RECOVERY_LIMITS.reportBytes)}-byte report allowance`;

/** Report-size refusals name the fixed allowance; other read failures stay unchanged. */
const readWakaruProvenanceReport = async (
  path: string,
  signal: AbortSignal | undefined,
  resources: ArtifactResourceScope | undefined,
): Promise<Buffer> => {
  try {
    return await readRecoveryFile(
      path,
      RECOVERY_LIMITS.reportBytes,
      signal,
      resources,
    );
  } catch (cause: unknown) {
    if (!isRecoveryFileSizeError(cause, RECOVERY_LIMITS.reportBytes))
      throw cause;
    throw new AnalysisOutputError(OPERATION, PROVENANCE_REPORT_ALLOWANCE, {
      cause,
      ...wakaruFixedLimitRecovery(PROVENANCE_REPORT_ALLOWANCE),
    });
  }
};

/** Keep fixed-limit guidance when the report parser wraps the producing error. */
const wakaruReportGuidance = (
  cause: unknown,
): { readonly userMessage?: string; readonly remediationAction?: string } => {
  if (typeof cause !== "object" || cause === null) return {};
  const userMessage =
    "userMessage" in cause && typeof cause.userMessage === "string"
      ? cause.userMessage
      : undefined;
  const remediationAction =
    "remediationAction" in cause && typeof cause.remediationAction === "string"
      ? cause.remediationAction
      : undefined;
  return {
    ...(userMessage === undefined ? {} : { userMessage }),
    ...(remediationAction === undefined ? {} : { remediationAction }),
  };
};

const validateModuleSet = (
  report: z.output<typeof reportSchema>,
  provenance: z.output<typeof provenanceSchema>,
  context: ReportContext,
): void => {
  const { files, snapshots } = context;
  const registry = new ArtifactPathRegistry();
  const expected = new Set(["provenance.json"]);
  const observed = new Set(files.map((file) => file.relativePath));
  for (const module of report.modules) {
    const path = normalizeArtifactPath(module.filename);
    if (path !== module.filename || !/\.(?:js|mjs|cjs)$/u.test(path))
      throw new TypeError(`Unsupported module path: ${module.filename}`);
    registry.add(path, "file");
    if (!observed.has(path))
      throw new TypeError(`Missing reported module file: ${path}`);
    expected.add(path);
    if (observed.has(`${path}.map`)) expected.add(`${path}.map`);
    const entry = provenance.modules[path];
    const sourceBytes =
      entry === undefined ? undefined : snapshots.get(entry.input);
    if (entry === undefined || sourceBytes === undefined)
      throw new TypeError(
        `Module provenance does not bind the selected input snapshot: ${path}`,
      );
    validateRanges(
      [...entry.ranges, ...(entry.context_ranges ?? [])],
      sourceBytes,
      path,
    );
  }
  if (Object.keys(provenance.modules).length !== report.modules.length)
    throw new TypeError("Provenance and reported module sets disagree");
  for (const path of observed)
    if (!expected.has(path))
      throw new TypeError(`Unreported recovery artifact: ${path}`);
};

const validateRanges = (
  ranges: readonly [number, number][],
  bytes: Buffer,
  filename: string,
): void => {
  for (const [start, end] of ranges) {
    if (
      start > end ||
      end > bytes.length ||
      !utf8Boundary(bytes, start) ||
      !utf8Boundary(bytes, end)
    )
      throw new TypeError(
        `Invalid half-open UTF-8 byte range [${String(start)},${String(end)}) for ${filename}`,
      );
  }
};

const utf8Boundary = (bytes: Buffer, offset: number): boolean => {
  const value = bytes[offset];
  return value === undefined || (value & 0xc0) !== 0x80;
};

/** Translate extraction byte ranges without claiming rewritten line positions. */
export const recoveryRanges = (
  ranges: readonly [number, number][],
): JavaScriptRecoveryResult["modules"][number]["provenance"]["byte_ranges"] =>
  ranges.map(([start, end]) => ({ start, end }));

/** Validate a source map's representation; preserve its unverified mapping bytes. */
export const validateRecoverySourceMap = (
  bytes: Buffer,
  filename: string,
): void => {
  const schema = z.object({
    version: z.literal(3),
    sources: z.array(z.string()),
    names: z.array(z.string()),
    mappings: z.string(),
  });
  try {
    const decoded = safeParseUtf8Json(bytes);
    if (!decoded.ok) throw decoded.cause;
    schema.parse(decoded.value);
  } catch (cause: unknown) {
    throw new AnalysisOutputError(
      OPERATION,
      `Invalid emitted source map for ${filename}: ${recoveryFailureMessage(cause)}`,
      { cause },
    );
  }
};
