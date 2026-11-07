import { basename } from "node:path";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { EnvironmentBuildCaptureInput } from "../application/environment/environmentBuild.js";
import type {
  EnvironmentExportFile,
  EnvironmentExportResult,
} from "../application/environment/environmentExport.js";
import type { EnvironmentSource } from "../application/environment/environmentSource.js";
import type { ServedState } from "../application/environment/environmentState.js";
import { z } from "incur";
import type { Logger } from "pino";

import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { parseEnvironmentName } from "../config/environmentName.js";
import {
  parseMcpHttpEndpoint,
  mcpHttpListenerPortSchema,
  type McpHttpEndpoint,
} from "../config/mcpHttpEndpoint.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { StreamableHttpListenError } from "../server/http/streamableHttpListenError.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import { createLogger } from "../logger.js";
import { TEMPLATE_RULES } from "../domain/analysisView/environmentManifestRules.js";
import { inspectWebNetworkCaptureInputSchema } from "../domain/webNetworkCapture.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import type { CliInstance } from "./types.js";

/** Same envelope label as the other JSON-input commands and `parseCliJsonInput`. */
const cliError = (error: AnalysisError): JsonValue => ({
  error: "Application workflow failed",
  ...projectAnalysisError(error),
});

/** The listener announces its URL, and a build its stages, at info like `rea mcp --http`; an explicit REA_LOG_LEVEL still wins. */
const infoLogger = (
  environment: Readonly<NodeJS.ProcessEnv>,
  logger: Logger,
): Logger =>
  environment.REA_LOG_LEVEL === undefined
    ? createLogger("cli", "info")
    : logger;

/** Resolve until the one-shot signal requests shutdown. */
const untilAborted = (signal: AbortSignal): Promise<undefined> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve(undefined);
    else
      signal.addEventListener("abort", () => resolve(undefined), {
        once: true,
      });
  });

/** A listener failure as the command's typed refusal. */
export const transportError = (
  endpoint: McpHttpEndpoint,
  cause: StreamableHttpListenError,
): AnalysisResourceConstraintError => {
  const failure = cause.classification.ok
    ? cause.classification.value
    : cause.classification.error;
  return new AnalysisResourceConstraintError(
    CLI_COMMANDS.environmentServe,
    "transport",
    cause.message,
    { host: endpoint.host, port: endpoint.port },
    {
      cause,
      retryable: false,
      diagnostics: {
        listener_failure: {
          kind: failure.kind,
          ...("systemCode" in failure && failure.systemCode !== undefined
            ? { system_code: failure.systemCode }
            : {}),
          ...(failure.kind === "host_allowlist"
            ? {
                reason: failure.reason,
              }
            : {}),
        },
        listener_phase: cause.phase,
      },
      remediationAction: cause.remediationAction,
    },
  );
};

interface ServeArguments {
  readonly manifest: string;
  readonly evidence: string;
  readonly replayOnly: boolean;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
}

interface ServeInputs {
  readonly source: EnvironmentSource;
  readonly served: ServedState;
}

const cancelledServe = (signal: AbortSignal): JsonValue =>
  cliError(
    new AnalysisCancelledError(CLI_COMMANDS.environmentServe, {
      cause: signal.reason,
    }),
  );

/** Pure replay, as `--replay-only` asks for: no state is derived. */
const REPLAY_ONLY: ServedState = {
  state: undefined,
  report: { served: false, reason: "replay-only" },
};

/** Read and authenticate the manifest and capture, then prepare the state under the served name unless pure replay is asked for; a refusal is the command's output. */
const loadServeInputs = async (
  input: ServeArguments,
  environmentName: string | undefined,
  signal: AbortSignal,
): Promise<Result<ServeInputs, JsonValue>> => {
  const read = (path: string) =>
    parseCliJsonInput(path, CLI_COMMANDS.environmentServe, signal, {
      snapshot: true,
    });
  const manifest = await read(input.manifest);
  if (!manifest.ok) return manifest;
  const evidence = await read(input.evidence);
  if (!evidence.ok) return evidence;
  const { loadEnvironmentSource } =
    await import("../application/environment/environmentSource.js");
  if (signal.aborted) return err(cancelledServe(signal));
  const source = loadEnvironmentSource(manifest.value, evidence.value);
  if (!source.ok) return err(cliError(source.error));
  if (input.replayOnly)
    return ok({ source: source.value, served: REPLAY_ONLY });
  const { prepareServedState } =
    await import("../application/environment/environmentState.js");
  if (signal.aborted) return err(cancelledServe(signal));
  return ok({
    source: source.value,
    served: prepareServedState(source.value, evidence.value, {
      name: environmentName,
    }),
  });
};

/** Load the Evidence files, bind the listener and run until a signal ends it. */
const serveEnvironmentCommand = async (
  input: ServeArguments,
  environment: Readonly<NodeJS.ProcessEnv>,
  logger: Logger,
  signal: AbortSignal,
): Promise<JsonValue> => {
  if (signal.aborted) return cancelledServe(signal);
  const endpoint = parseMcpHttpEndpoint(environment, {
    ...(input.host === undefined ? {} : { host: input.host }),
    ...(input.port === undefined ? {} : { port: input.port }),
  });
  if (!endpoint.ok) return cliError(endpoint.error);
  const environmentName = parseEnvironmentName(environment);
  if (!environmentName.ok) return cliError(environmentName.error);
  const inputs = await loadServeInputs(input, environmentName.value, signal);
  if (!inputs.ok) return inputs.error;
  const {
    source,
    served: { state, report },
  } = inputs.value;
  const commandLogger = infoLogger(environment, logger);
  if (!report.served && report.reason === "unavailable")
    commandLogger.warn(
      { code: report.code, error: report.message },
      "Environment state unavailable; serving recorded replay",
    );
  if (signal.aborted) return cancelledServe(signal);
  // Loaded here so registering the command catalog never loads the HTTP listener.
  const { serveEnvironment } =
    await import("../server/environment/serveEnvironment.js");
  const { StreamableHttpListenError } =
    await import("../server/http/streamableHttpListenError.js");
  if (signal.aborted) return cancelledServe(signal);
  // A listener that fails after binding ends the command instead of serving nothing.
  let failListener: (error: StreamableHttpListenError) => void = () =>
    undefined;
  const listenerFailed = new Promise<StreamableHttpListenError>((resolve) => {
    failListener = resolve;
  });
  let served: import("../server/environment/serveEnvironment.js").ServedEnvironment;
  try {
    const started = await serveEnvironment({
      source,
      ...(state === undefined ? {} : { state }),
      signal,
      ...endpoint.value,
      ...(environmentName.value === undefined
        ? {}
        : { environmentName: environmentName.value }),
      logger: commandLogger,
      onerror: failListener,
    });
    if (!started.ok) return cliError(started.error);
    served = started.value;
  } catch (cause: unknown) {
    if (signal.aborted && cause === signal.reason)
      return cancelledServe(signal);
    if (!(cause instanceof StreamableHttpListenError)) throw cause;
    return cliError(transportError(endpoint.value, cause));
  }
  const failure = await Promise.race([untilAborted(signal), listenerFailed]);
  const listenerError =
    failure === undefined ? undefined : transportError(endpoint.value, failure);
  const observation = {
    url: served.url,
    environment: served.card.name,
    tools: served.card.capabilities.tools.length,
    evidence_id: source.evidenceId,
    manifest_evidence_id: source.manifestEvidenceId,
    state: report,
  };
  try {
    await served.close();
  } catch (cause: unknown) {
    if (!(cause instanceof AnalysisError)) throw cause;
    if (listenerError !== undefined)
      return cliError(
        analysisErrorWithCleanupFailure(
          listenerError,
          cause,
          CLI_COMMANDS.environmentServe,
        ).bindCleanupDependencies([cause]),
      );
    cause.retainDiagnostics({
      shutdown_observation: { status: "shutdown_requested", ...observation },
    });
    return cliError(cause);
  }
  if (listenerError !== undefined) return cliError(listenerError);
  return { status: "stopped", ...observation };
};

interface ExportArguments {
  readonly manifest: string;
  readonly evidence: string;
  readonly directory: string;
  readonly packageTarball?: string | undefined;
  readonly name?: string | undefined;
}

/** The written files with sizes, whether the bundle serves the state, and the pinned package source, as the command prints them. */
const exportDocument = (result: EnvironmentExportResult): JsonValue => ({
  status: result.status,
  directory: result.directory,
  name: result.name,
  tool_count: result.tool_count,
  evidence_id: result.evidence_id,
  manifest_evidence_id: result.manifest_evidence_id,
  state: result.state,
  package_source: result.package_source,
  files: result.files.map(({ path, bytes }) => ({ path, bytes })),
});

/** Read each file once, authenticate the pair as the serve command does, then write the bundle from the same bytes. */
const exportEnvironmentCommand = async (
  input: ExportArguments,
): Promise<JsonValue> => {
  const { readEnvironmentExportInputs, exportEnvironmentBundle } =
    await import("../application/environment/environmentExport.js");
  const inputs = await readEnvironmentExportInputs(
    input.manifest,
    input.evidence,
  );
  if (!inputs.ok) return cliError(inputs.error);
  // Loaded here, as for environment-serve, so registering the command catalog never loads it.
  const { loadEnvironmentSource } =
    await import("../application/environment/environmentSource.js");
  const source = loadEnvironmentSource(
    inputs.value.manifest.value,
    inputs.value.evidence.value,
    CLI_COMMANDS.environmentExport,
  );
  if (!source.ok) return cliError(source.error);
  const exported = await exportEnvironmentBundle({
    ...inputs.value,
    source: source.value,
    directory: absoluteCallerPath(input.directory),
    name: input.name,
    packageTarball:
      input.packageTarball === undefined
        ? undefined
        : absoluteCallerPath(input.packageTarball),
  });
  return exported.ok
    ? exportDocument(exported.value)
    : cliError(exported.error);
};

interface BuildArguments {
  readonly capture: string;
  readonly directory?: string | undefined;
  readonly name?: string | undefined;
  readonly templateRule?:
    | readonly (typeof TEMPLATE_RULES)[number][]
    | undefined;
  readonly formatRulesOnly: boolean;
  readonly packageTarball?: string | undefined;
  readonly dryRun: boolean;
  readonly captureTimeoutMs?: number | undefined;
}

const conflictingRules = (): JsonValue =>
  cliError(
    new AnalysisInputError(CLI_COMMANDS.environmentBuild, undefined, [
      {
        path: ["format_rules_only"],
        reason: "invalid_value",
        message:
          "--format-rules-only applies no opt-in template rules; it cannot be combined with --template-rule.",
      },
    ]),
  );

/** Inspect a HAR as inspect-web-network-capture does and serialize the Evidence as it prints it; a refusal is the command's output. */
const inspectBuildHar = async (
  capturePath: string,
  captureTimeoutMs: number | undefined,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal: AbortSignal,
): Promise<Result<EnvironmentExportFile, JsonValue>> => {
  const { createWebNetworkCaptureService } =
    await import("../composition/webNetworkCaptures.js");
  const { environmentExportEvidenceFile } =
    await import("../application/environment/environmentExport.js");
  const { ENVIRONMENT_BUILD_OPERATION } =
    await import("../application/environment/environmentBuild.js");
  const service = createWebNetworkCaptureService(environment);
  const inspected = await finishAnalysisCommand(
    () =>
      service.inspect(
        {
          capture_path: capturePath,
          format: "har",
          ...(captureTimeoutMs === undefined
            ? {}
            : { capture_timeout_ms: captureTimeoutMs }),
        },
        { signal },
      ),
    service,
    "web-network-capture",
    "inspect_web_network_capture",
    signal,
  );
  if (!inspected.ok)
    return err({
      error: "Application workflow failed",
      ...inspected.error,
    });
  const file = await environmentExportEvidenceFile(
    "evidence",
    capturePath,
    inspected.value,
    ENVIRONMENT_BUILD_OPERATION,
  );
  return file.ok ? ok(file.value) : err(cliError(file.error));
};

/** Read the capture once, then build or plan the bundle from it. */
const buildEnvironmentCommand = async (
  input: BuildArguments,
  environment: Readonly<NodeJS.ProcessEnv>,
  logger: Logger,
  signal: AbortSignal,
): Promise<JsonValue> => {
  if (input.formatRulesOnly && input.templateRule !== undefined)
    return conflictingRules();
  const {
    buildEnvironment,
    classifyBuildCapture,
    DEFAULT_BUILD_TEMPLATE_RULES,
    ENVIRONMENT_BUILD_OPERATION,
  } = await import("../application/environment/environmentBuild.js");
  const capturePath = absoluteCallerPath(input.capture);
  const kind = classifyBuildCapture(capturePath);
  if (!kind.ok) return cliError(kind.error);
  if (input.directory === undefined && !input.dryRun)
    return cliError(
      new AnalysisInputError(
        CLI_COMMANDS.environmentBuild,
        { userMessage: "Name the bundle directory, or pass --dry-run." },
        [
          {
            path: ["directory"],
            reason: "invalid_value",
            message: "The bundle directory may be omitted only with --dry-run.",
          },
        ],
      ),
    );
  const commandLogger = infoLogger(environment, logger);
  const progress = (stage: string): void => {
    commandLogger.info({ stage }, "Building environment");
  };
  let capture: EnvironmentExportFile;
  if (kind.value === "har") {
    progress("inspect");
    const inspected = await inspectBuildHar(
      capturePath,
      input.captureTimeoutMs,
      environment,
      signal,
    );
    if (!inspected.ok) return inspected.error;
    capture = inspected.value;
  } else {
    const { readEnvironmentExportFile } =
      await import("../application/environment/environmentExport.js");
    const read = await readEnvironmentExportFile(
      "evidence",
      capturePath,
      ENVIRONMENT_BUILD_OPERATION,
      ["capture"],
    );
    if (!read.ok) return cliError(read.error);
    capture = read.value;
  }
  if (signal.aborted)
    return cliError(
      new AnalysisCancelledError(CLI_COMMANDS.environmentBuild, {
        cause: signal.reason,
      }),
    );
  const captureInput: EnvironmentBuildCaptureInput = kind.value;
  const built = await buildEnvironment({
    capture,
    captureInput,
    capturePath,
    templateRules: input.formatRulesOnly
      ? []
      : (input.templateRule ?? DEFAULT_BUILD_TEMPLATE_RULES),
    directory:
      input.directory === undefined
        ? undefined
        : absoluteCallerPath(input.directory),
    name: input.name,
    packageTarball:
      input.packageTarball === undefined
        ? undefined
        : absoluteCallerPath(input.packageTarball),
    dryRun: input.dryRun,
    progress,
    signal,
  });
  return built.ok
    ? (built.value as unknown as JsonValue)
    : cliError(built.error);
};

/** Register the one-step build from a recorded capture to a bundle folder. */
const registerBuildCommand = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.environmentBuild, {
    description:
      "Build an agent environment bundle from a recorded capture in one offline step: inspect a HAR (or read capture Evidence), project the environment manifest, derive the state, report which tools the environment answers from state, which replay and why each write is withheld, then write the bundle environment-export writes",
    args: z.object({
      capture: localPathStringSchema.describe(
        "A .har file, or capture Evidence JSON from inspect-web-network-capture (HAR) or capture-browser-scenario",
      ),
      directory: localPathStringSchema
        .optional()
        .describe(
          "Bundle directory to create; must be absent or empty, nothing is overwritten; omit only with --dry-run",
        ),
    }),
    options: z.object({
      name: z
        .string()
        .optional()
        .describe(
          "Env folder and env id (kebab-case); default the manifest's name, or the capture file's name when the origin is a loopback or IP address",
        ),
      templateRule: z
        .array(z.enum(TEMPLATE_RULES))
        .optional()
        .describe(
          "Opt-in template rule; repeat to select several. Replaces the default after-uid-literal, opaque-token, sibling-variance and prefix-variance",
        ),
      formatRulesOnly: z
        .boolean()
        .default(false)
        .describe("Apply only the four format rules, the views' own default"),
      packageTarball: localPathStringSchema
        .optional()
        .describe(
          "Packed rea-agents tarball (npm pack) copied into the env folder and installed by the Dockerfile instead of the registry package pinned to this version",
        ),
      dryRun: z
        .boolean()
        .default(false)
        .describe("Run every stage and report, but write nothing"),
      captureTimeoutMs:
        inspectWebNetworkCaptureInputSchema.shape.capture_timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.environmentBuild, () =>
          buildEnvironmentCommand(
            {
              capture: args.capture,
              directory: args.directory,
              name: options.name,
              templateRule: options.templateRule,
              formatRulesOnly: options.formatRulesOnly,
              packageTarball: options.packageTarball,
              dryRun: options.dryRun,
              captureTimeoutMs: options.captureTimeoutMs,
            },
            environment,
            logger,
            signal,
          ),
        ),
      ),
  });
};

const manifestArgument = z
  .string()
  .describe(
    "Environment manifest Evidence JSON path (inspect-analysis-view environment-manifest output)",
  );
const evidenceOption = z
  .string()
  .describe(
    "Parent capture Evidence JSON path (inspect-web-network-capture or capture-browser-scenario output) the manifest cites",
  );

interface CompareArguments {
  readonly manifest: string;
  readonly evidence: string;
  readonly probes: readonly string[];
}

/** Read the environment and every probe, then compare; a refusal is the command's output. */
const compareEnvironmentCommand = async (
  input: CompareArguments,
): Promise<JsonValue> => {
  const read = (path: string) =>
    parseCliJsonInput(path, CLI_COMMANDS.environmentCompare, undefined, {
      snapshot: true,
    });
  const manifest = await read(input.manifest);
  if (!manifest.ok) return manifest.error;
  const evidence = await read(input.evidence);
  if (!evidence.ok) return evidence.error;
  const probes = [];
  for (const path of input.probes) {
    const probe = await read(path);
    if (!probe.ok) return probe.error;
    probes.push({ label: basename(path), value: probe.value });
  }
  const { loadEnvironmentSource } =
    await import("../application/environment/environmentSource.js");
  const source = loadEnvironmentSource(
    manifest.value,
    evidence.value,
    CLI_COMMANDS.environmentCompare,
  );
  if (!source.ok) return cliError(source.error);
  const { compareEnvironment } =
    await import("../application/environment/environmentCompare.js");
  const report = compareEnvironment({
    source: source.value,
    captureValue: evidence.value,
    probes,
    operation: CLI_COMMANDS.environmentCompare,
  });
  return report.ok
    ? (report.value as unknown as JsonValue)
    : cliError(report.error);
};

/** Register the comparison of an environment with probe captures of its application. */
const registerCompareCommand = (cli: CliInstance, logger: Logger): void => {
  cli.command(CLI_COMMANDS.environmentCompare, {
    description:
      "Compare an environment with probe captures of the application it was captured from: each probe is one call sequence recorded against a freshly reset application, answered by the environment from a reset state, with agreement reported per step, tool and probe",
    args: z.object({ manifest: manifestArgument }),
    options: z.object({
      evidence: evidenceOption,
      probe: z
        .array(z.string())
        .min(1)
        .describe(
          "Probe capture Evidence JSON path (inspect-web-network-capture or capture-browser-scenario output) of one call sequence made against a freshly reset application; repeat once per sequence",
        ),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.environmentCompare, () =>
        compareEnvironmentCommand({
          manifest: args.manifest,
          evidence: options.evidence,
          probes: options.probe,
        }),
      ),
  });
};

/** Register the one-shot bundle export command. */
const registerExportCommand = (cli: CliInstance, logger: Logger): void => {
  cli.command(CLI_COMMANDS.environmentExport, {
    description:
      "Export an environment manifest and its capture Evidence as an agent environment bundle folder the agentenv framework runs with agent-env run",
    args: z.object({
      manifest: manifestArgument,
      directory: localPathStringSchema.describe(
        "Bundle directory to create; must be absent or empty, nothing is overwritten",
      ),
    }),
    options: z.object({
      evidence: evidenceOption,
      packageTarball: localPathStringSchema
        .optional()
        .describe(
          "Packed rea-agents tarball (npm pack) copied into the env folder and installed by the Dockerfile instead of the registry package pinned to this version",
        ),
      name: z
        .string()
        .optional()
        .describe(
          "Env folder and env id (kebab-case); default the manifest's name",
        ),
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, CLI_COMMANDS.environmentExport, () =>
        exportEnvironmentCommand({
          manifest: args.manifest,
          evidence: options.evidence,
          directory: args.directory,
          packageTarball: options.packageTarball,
          name: options.name,
        }),
      ),
  });
};

/** Register the long-running agent environment server command and the bundle export. */
export const registerEnvironmentCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  registerBuildCommand(cli, logger, environment);
  registerExportCommand(cli, logger);
  registerCompareCommand(cli, logger);
  cli.command(CLI_COMMANDS.environmentServe, {
    description:
      "Serve an environment manifest as an agent environment over streamable HTTP until SIGINT or SIGTERM: read tools, and write tools whose effect the capture confirmed, answer from the state the capture observed, derived at startup, or every tool replays retained capture records with --replay-only or when the state is unavailable",
    args: z.object({ manifest: manifestArgument }),
    options: z.object({
      evidence: evidenceOption,
      replayOnly: z
        .boolean()
        .default(false)
        .describe(
          "Serve pure replay: derive no state, serve every manifest tool from its retained records and answer every /agentenv method as not found",
        ),
      host: z
        .string()
        .min(1)
        .optional()
        .describe("Listener address; default MCP_HOST, else 127.0.0.1"),
      port: mcpHttpListenerPortSchema
        .optional()
        .describe(
          "Listener port; default MCP_PORT, else 0 for an ephemeral port",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.environmentServe, () =>
          serveEnvironmentCommand(
            {
              manifest: args.manifest,
              evidence: options.evidence,
              replayOnly: options.replayOnly,
              host: options.host,
              port: options.port,
            },
            environment,
            logger,
            signal,
          ),
        ),
      ),
  });
};
