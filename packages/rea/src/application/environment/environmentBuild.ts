import { setImmediate } from "node:timers/promises";

import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { summarizeEnvironmentCoverage } from "../../domain/analysisView/environmentCoverageView.js";
import {
  TEMPLATE_RULES,
  type TemplateRule,
} from "../../domain/analysisView/environmentManifestRules.js";
import type { Evidence } from "../../domain/evidence.js";
import type { EnvironmentBuildReport } from "../../domain/environmentBundleExport.js";
import { err, ok, type Result } from "../../domain/result.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import {
  BUNDLE_NAME_CONSTRAINT,
  ENVIRONMENT_EXPORT_OPERATION,
  isPortableBundleName,
  planEnvironmentBundle,
  registryPackageSource,
  type EnvironmentPackageSource,
} from "./environmentBundle.js";
import {
  anonymousOrigin,
  credentialScanWarnings,
  savedCredentialWarnings,
  nameFromCaptureFile,
  type EnvironmentBuildWarning,
} from "./environmentBuildReport.js";
import {
  environmentExportEvidenceFile,
  exportEnvironmentBundle,
  packageTarballBytes,
  type EnvironmentExportFile,
  type WrittenBundleFile,
} from "./environmentExport.js";
import {
  composeEnvironmentSource,
  parseCaptureEvidence,
  parseEvidenceFile,
  parseViewEvidence,
} from "./environmentSource.js";
import { prepareServedState } from "./environmentState.js";

/** Operation name the build command's own refusals report; each stage keeps its own. */
export const ENVIRONMENT_BUILD_OPERATION = "environment-build";

/** The opt-in rules the rebuild pipeline selects for every published capture-built environment. */
export const DEFAULT_BUILD_TEMPLATE_RULES: readonly TemplateRule[] = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
  "prefix-variance",
];

/** What the capture argument is, decided from its file name before anything is read. */
export type EnvironmentBuildCaptureInput = "har" | "evidence";

/** A HAR file is inspected; a JSON file must already be capture Evidence. */
export const classifyBuildCapture = (
  path: string,
): Result<EnvironmentBuildCaptureInput, AnalysisInputError> => {
  if (/\.har$/iu.test(path)) return ok("har");
  if (/\.json$/iu.test(path)) return ok("evidence");
  return err(
    new AnalysisInputError(
      ENVIRONMENT_BUILD_OPERATION,
      {
        userMessage: `${path} is neither a .har capture nor a .json capture Evidence file.`,
      },
      [
        {
          path: ["capture"],
          reason: "invalid_value",
          expected: ".har or .json",
          message:
            "Pass a HAR file, or capture Evidence JSON from inspect-web-network-capture (HAR) or capture-browser-scenario.",
        },
      ],
    ),
  );
};

/** Rules in the views' fixed order, so the report and manifest list them canonically. */
export const canonicalTemplateRules = (
  rules: readonly TemplateRule[],
): TemplateRule[] => TEMPLATE_RULES.filter((rule) => rules.includes(rule));

export interface EnvironmentBuildInput {
  /** The capture Evidence the bundle ships, read or serialized once. */
  readonly capture: EnvironmentExportFile;
  readonly captureInput: EnvironmentBuildCaptureInput;
  /** The capture argument, absolute; names a loopback capture's environment. */
  readonly capturePath: string;
  readonly templateRules: readonly TemplateRule[];
  /** Absolute bundle root, absent or empty; may be absent only for a dry run. */
  readonly directory?: string | undefined;
  readonly name?: string | undefined;
  readonly packageTarball?: string | undefined;
  readonly dryRun: boolean;
  /** Called as each stage starts. */
  readonly progress?: ((stage: string) => void) | undefined;
  /** Checked between stages; a build cancelled before the write writes nothing. */
  readonly signal?: AbortSignal | undefined;
  /** Refuse an existing directory and never create its parent, as MCP output directories require. */
  readonly exclusiveDestination?: boolean | undefined;
}

const captureOperations = new Set([
  "inspect_web_network_capture",
  "capture_browser_scenario",
]);

const harDocument = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const log: unknown = Reflect.get(value, "log");
  return (
    typeof log === "object" &&
    log !== null &&
    Array.isArray(Reflect.get(log, "entries"))
  );
};

const harAsJson = (path: string): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_BUILD_OPERATION,
    {
      userMessage: `${path} is a HAR document, not capture Evidence; save it as a .har file to build from it, or inspect it as a HAR first (inspect_web_network_capture) and build from that Evidence.`,
    },
    [
      {
        path: ["capture"],
        reason: "invalid_value",
        expected: "capture Evidence JSON, or a .har file",
        message:
          "A .json capture must be capture Evidence; a HAR document is inspected only from a .har file.",
      },
    ],
  );

const repeatedRules = (): AnalysisInputError =>
  new AnalysisInputError(ENVIRONMENT_BUILD_OPERATION, undefined, [
    {
      path: ["template_rules"],
      reason: "invalid_value",
      message: "template_rules must not repeat a rule",
    },
  ]);

/** A cancellation, naming the bundle when it arrived after the bundle was written. */
const cancelled = async (
  signal: AbortSignal | undefined,
  written?: string,
): Promise<AnalysisCancelledError | undefined> => {
  // The stages are synchronous; yield so a pending interrupt is dispatched before checking.
  if (signal !== undefined) await setImmediate();
  return signal?.aborted === true
    ? new AnalysisCancelledError(ENVIRONMENT_BUILD_OPERATION, {
        cause: signal.reason,
        ...(written === undefined
          ? {}
          : {
              userMessage: `The build was cancelled after it wrote the bundle at ${written}.`,
              diagnostics: { output_directory: written, bundle_written: true },
            }),
      })
    : undefined;
};

const notCaptureEvidence = (operation: string): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_BUILD_OPERATION,
    {
      userMessage: `The capture file is ${operation} Evidence, not capture Evidence.`,
    },
    [
      {
        path: ["capture", "operation"],
        reason: "invalid_value",
        expected: "inspect_web_network_capture or capture_browser_scenario",
        message:
          "Pass a HAR file, or capture Evidence JSON from inspect-web-network-capture (HAR) or capture-browser-scenario.",
      },
    ],
  );

const unnamed = (path: string): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_BUILD_OPERATION,
    {
      userMessage: `The capture's origin is a loopback or IP address, and ${path === "" ? "retained Evidence has no file name to take one from" : `${path} yields no portable environment name (${BUNDLE_NAME_CONSTRAINT})`}; name the environment.`,
    },
    [
      {
        path: ["name"],
        reason: "invalid_value",
        message:
          "Name the environment: a kebab-case label of lowercase letters, digits and single hyphens.",
      },
    ],
  );

const missingDirectory = (): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_BUILD_OPERATION,
    { userMessage: "Name the bundle directory, or plan a dry run." },
    [
      {
        path: ["directory"],
        reason: "invalid_value",
        message: "The bundle directory may be omitted only with --dry-run.",
      },
    ],
  );

/** The given name; else the manifest's, unless its origin is anonymous, when the capture file names it. */
const environmentName = (
  input: EnvironmentBuildInput,
  manifest: { readonly name: string; readonly origin: string },
  warnings: EnvironmentBuildWarning[],
): Result<string | undefined, AnalysisInputError> => {
  if (input.name !== undefined) return ok(input.name);
  if (!anonymousOrigin(manifest.origin)) return ok(undefined);
  const name = nameFromCaptureFile(input.capturePath);
  if (!isPortableBundleName(name)) return err(unnamed(input.capturePath));
  warnings.push({
    code: "name-from-file",
    pointers: [],
    message: `The capture's origin ${manifest.origin} names no application, so the environment is named ${name} after the capture file; name it explicitly to choose another.`,
  });
  return ok(name);
};

/** A path as one POSIX shell word. */
const shellWord = (path: string): string =>
  /^[\w./@%+=:,-]+$/u.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

const packageSourceValue = (
  source: EnvironmentPackageSource,
): EnvironmentBuildReport["package_source"] =>
  source.kind === "registry"
    ? { kind: "registry", specifier: source.specifier }
    : { kind: "tarball", path: source.path };

/**
 * Build an agent environment bundle from capture Evidence: project the
 * manifest from the in-memory capture, authenticate the pair, prepare the
 * state the bundle's server derives and summarize what it serves, then write
 * the bundle with the export unless this is a dry run. Every file equals what
 * inspect-analysis-view and environment-export produce from the same capture.
 */
export const buildEnvironment = async (
  input: EnvironmentBuildInput,
): Promise<Result<EnvironmentBuildReport, AnalysisError>> => {
  if (input.directory === undefined && !input.dryRun)
    return err(missingDirectory());
  if (new Set(input.templateRules).size !== input.templateRules.length)
    return err(repeatedRules());
  if (input.captureInput === "evidence" && harDocument(input.capture.value))
    return err(harAsJson(input.capturePath));
  const evidence = parseEvidenceFile(
    ENVIRONMENT_BUILD_OPERATION,
    "evidence",
    input.capture.value,
  );
  if (!evidence.ok) return evidence;
  if (!captureOperations.has(evidence.value.operation))
    return err(notCaptureEvidence(evidence.value.operation));
  const capture = evidence.value;
  const templateRules = canonicalTemplateRules(input.templateRules);
  input.progress?.("manifest");
  const projected = await inspectAnalysisView(
    {
      source: { kind: "retained-evidence", evidence_id: capture.evidence_id },
      view: { kind: "environment-manifest", template_rules: templateRules },
    },
    (id) => (id === capture.evidence_id ? capture : undefined),
  );
  if (!projected.ok) return projected;
  const stopped = await cancelled(input.signal);
  if (stopped !== undefined) return err(stopped);
  const manifest = await environmentExportEvidenceFile(
    "manifest",
    "manifest.json",
    projected.value,
    ENVIRONMENT_BUILD_OPERATION,
  );
  if (!manifest.ok) return manifest;
  const parsedManifest = parseViewEvidence(
    ENVIRONMENT_BUILD_OPERATION,
    "manifest",
    manifest.value.value,
    "environment-manifest",
  );
  if (!parsedManifest.ok) return parsedManifest;
  const recorded = parseCaptureEvidence(
    ENVIRONMENT_BUILD_OPERATION,
    input.capture.value,
  );
  if (!recorded.ok) return recorded;
  const source = composeEnvironmentSource(
    parsedManifest.value,
    recorded.value,
    ENVIRONMENT_BUILD_OPERATION,
  );
  if (!source.ok) return source;
  const warnings: EnvironmentBuildWarning[] = [];
  const named = environmentName(input, source.value.manifest, warnings);
  if (!named.ok) return named;
  const name = named.value ?? source.value.manifest.name;
  const beforeState = await cancelled(input.signal);
  if (beforeState !== undefined) return err(beforeState);
  input.progress?.("state");
  // Prepared as the export prepares it, so its report and the bundle's README match the three-step path.
  const served = prepareServedState(source.value, input.capture.value, {
    name,
    operation: ENVIRONMENT_EXPORT_OPERATION,
  });
  warnings.push(
    ...credentialScanWarnings(recorded.value),
    ...savedCredentialWarnings(capture.parameters),
  );

  const packageSource: EnvironmentPackageSource =
    input.packageTarball === undefined
      ? registryPackageSource()
      : { kind: "tarball", path: input.packageTarball };
  const base = {
    name,
    capture: {
      evidence_id: capture.evidence_id,
      operation: capture.operation,
      records: recorded.value.records.length,
      input: input.captureInput,
    },
    manifest: {
      evidence_id: source.value.manifestEvidenceId,
      tools: source.value.manifest.tools.length,
      excluded_groups: source.value.manifest.excluded.length,
      template_rules: templateRules,
    },
    state: served.report,
    coverage:
      served.state === undefined
        ? null
        : summarizeEnvironmentCoverage({
            views: served.state.views.values(),
            writes: served.state.writes.values(),
          }),
    warnings,
  };
  if (input.dryRun) {
    const beforePlan = await cancelled(input.signal);
    if (beforePlan !== undefined) return err(beforePlan);
    const plan = planEnvironmentBundle(source.value, {
      name,
      packageSource,
      served: () => served,
    });
    if (!plan.ok) return plan;
    const files: WrittenBundleFile[] = [
      ...plan.value.files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.content),
      })),
      { path: plan.value.copies.manifest, bytes: manifest.value.bytes.length },
      { path: plan.value.copies.evidence, bytes: input.capture.bytes.length },
    ];
    if (
      plan.value.copies.tarball !== null &&
      input.packageTarball !== undefined
    ) {
      const bytes = await packageTarballBytes(input.packageTarball);
      if (!bytes.ok) return bytes;
      files.push({ path: plan.value.copies.tarball, bytes: bytes.value });
    }
    const afterPlan = await cancelled(input.signal);
    if (afterPlan !== undefined) return err(afterPlan);
    return ok({
      status: "planned",
      directory: input.directory ?? null,
      ...base,
      tool_count: plan.value.toolCount,
      package_source: packageSourceValue(packageSource),
      files,
      next: [],
    });
  }
  const directory = input.directory;
  if (directory === undefined) return err(missingDirectory());
  const beforeWrite = await cancelled(input.signal);
  if (beforeWrite !== undefined) return err(beforeWrite);
  input.progress?.("bundle");
  const exported = await exportEnvironmentBundle({
    manifest: manifest.value,
    evidence: input.capture,
    source: source.value,
    served,
    directory,
    name,
    packageTarball: input.packageTarball,
    exclusiveDestination: input.exclusiveDestination,
  });
  if (!exported.ok) return exported;
  const report: EnvironmentBuildReport = {
    status: "built",
    directory,
    ...base,
    tool_count: exported.value.tool_count,
    package_source: packageSourceValue(packageSource),
    files: [...exported.value.files],
    next: [`agent-env run ${shellWord(directory)}`],
  };
  // A cancellation that arrives during the write still names the bundle it wrote.
  const afterWrite = await cancelled(input.signal, directory);
  return afterWrite === undefined ? ok(report) : err(afterWrite);
};
