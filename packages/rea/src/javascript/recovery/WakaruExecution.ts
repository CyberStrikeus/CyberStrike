import { assertArtifactCommandPath } from "../../process/ArtifactCommandPath.js";
import { join } from "node:path";
import {
  createAnalysisExecution,
  type ExecutionOptions,
} from "../../application/AnalysisProvider.js";
import type { SafeOutputTree } from "../../artifacts/SafeOutputTree.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
} from "../../domain/analysisErrorCore.js";
import type { JavaScriptRecoveryInput } from "../../domain/javascript/javascriptRecovery.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import {
  fingerprintRecoveryFile,
  inventoryRecoveryFiles,
  readRecoveryFile,
  type snapshotRecoveryInputs,
} from "./RecoveryFiles.js";
import {
  runWakaruCommand,
  type resolveWakaruCommand,
  type WakaruLauncher,
} from "./WakaruCommand.js";
import { parseWakaruReports } from "./WakaruReport.js";
import { publishWakaruArtifacts } from "./WakaruPublication.js";
import { RECOVERY_LIMITS, WAKARU_PROVIDER_IDENTITY } from "./WakaruRelease.js";
import { admitWakaruVersion } from "./WakaruVersion.js";

const OPERATION = "recover_javascript_sources";
const MODES = {
  structural: "strict",
  heuristic: "auto",
  inspection: "inspect",
} as const;

type RecoveryWorkspace = {
  root: string;
  tree: SafeOutputTree;
  input: JavaScriptRecoveryInput;
  sources: Awaited<ReturnType<typeof snapshotRecoveryInputs>>;
  engine: Awaited<ReturnType<typeof resolveWakaruCommand>>;
  environment: Readonly<Record<string, string | undefined>>;
  launcher: WakaruLauncher | undefined;
  options: ExecutionOptions | undefined;
  deadline: number;
  resources: ArtifactResourceScope;
};

/** Consume the pinned producer representation in a private workspace. */
const executeWakaruRecovery = async (context: RecoveryWorkspace) => {
  const {
    root,
    input,
    sources,
    engine,
    environment,
    launcher,
    options,
    resources,
  } = context;
  const staging = join(root, "modules");
  const commandContext = {
    command: engine.command.invocationPath,
    limiter: engine.limiter.invocationPath,
    cwd: root,
    deadline: context.deadline,
    environment: environment,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(launcher === undefined ? {} : { launcher: launcher }),
    resources,
  };
  const run = async (execution: Parameters<typeof runWakaruCommand>[0]) => {
    for (const selected of [engine.command, engine.limiter])
      await assertArtifactCommandPath(selected, OPERATION, {
        signal: options?.signal,
      });
    const output = await runWakaruCommand(execution);
    for (const selected of [engine.command, engine.limiter])
      await assertArtifactCommandPath(selected, OPERATION, {
        capturedOutput: {
          stdout: output.stdout,
          stderr: output.stderr,
          exit_code: output.exit_code,
          signal: output.signal,
          truncated: false,
        },
      });
    return output;
  };
  const version = await run({
    ...commandContext,
    arguments: ["--version"],
  });
  const admitted =
    version.exit_code === 0
      ? admitWakaruVersion(version.stdout.trim())
      : undefined;
  if (admitted === undefined || admitted.status === "unsupported") {
    // The message names the mismatch; the reason also keeps the tool's stderr.
    const mismatch = `${admitted?.message ?? `Wakaru --version failed; reported version: ${version.stdout.trim()}`}; exit: ${String(version.exit_code)}`;
    throw new AnalysisCapabilityUnavailableError(
      "wakaru",
      OPERATION,
      `${mismatch}; stderr: ${version.stderr}`,
      { userMessage: `${mismatch}.` },
    );
  }
  const execution = await run({
    ...commandContext,
    staging,
    arguments: [
      ...sources.map((source) => source.snapshot_path),
      `--unpack=${MODES[input.extraction_mode]}`,
      `--level=${input.rewrite_level}`,
      "--provenance",
      "--emit-source-map",
      "--json",
      "-o",
      staging,
    ],
  });
  const files = await inventoryRecoveryFiles(
    staging,
    options?.signal,
    resources,
  );
  const snapshots = new Map<string, Buffer>();
  for (const source of sources)
    snapshots.set(
      source.snapshot_path,
      await readRecoveryFile(
        source.snapshot_path,
        source.bytes,
        options?.signal,
        resources,
      ),
    );
  const parsed = await parseWakaruReports({
    execution,
    provenancePath: join(staging, "provenance.json"),
    snapshots,
    files,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    resources,
  });
  return { version, admitted, run: execution, parsed };
};

/** Publish validated recovery and retain exact source and engine bindings. */
export const prepareWakaruExecution = async (context: RecoveryWorkspace) => {
  const { root, tree, input, sources, engine, options, resources } = context;
  const [source] = sources;
  const staging = join(root, "modules");
  const { version, admitted, run, parsed } =
    await executeWakaruRecovery(context);
  const result = await publishWakaruArtifacts({
    tree,
    staging,
    input,
    sources,
    engine,
    admitted,
    parsed,
    execution: run,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    resources,
  });
  for (const selected of sources) {
    const current = await fingerprintRecoveryFile(
      selected.path,
      RECOVERY_LIMITS.inputBytes,
      options?.signal,
      resources,
    );
    if (current.sha256 !== selected.sha256 || current.bytes !== selected.bytes)
      throw new AnalysisArtifactChangedError(
        OPERATION,
        selected.path,
        `Original input changed during recovery: ${selected.path}`,
        {
          diagnostics: {
            expected_sha256: selected.sha256,
            observed_sha256: current.sha256,
            expected_bytes: selected.bytes,
            observed_bytes: current.bytes,
          },
        },
      );
  }
  const currentEngine = await fingerprintRecoveryFile(
    engine.command.resolvedPath,
    RECOVERY_LIMITS.outputBytes,
    options?.signal,
    resources,
  );
  if (currentEngine.sha256 !== engine.sha256)
    throw new AnalysisArtifactChangedError(
      OPERATION,
      engine.command.invocationPath,
      "Configured engine bytes changed during recovery",
      {
        diagnostics: {
          expected_sha256: engine.sha256,
          observed_sha256: currentEngine.sha256,
        },
      },
    );
  return createAnalysisExecution(
    result,
    { ...WAKARU_PROVIDER_IDENTITY, version: admitted.version },
    {
      rawResult: jsonValueSchema.parse({
        version,
        execution: run,
        report: parsed.report,
        provenance: parsed.provenance,
      }),
      subject: {
        path: source.path,
        sha256: source.sha256,
        format: "javascript",
      },
      locations: [
        ...sources.map((selected) => ({
          kind: "artifact-path" as const,
          path: selected.path,
        })),
        ...result.modules.map((module) => ({
          kind: "artifact-path" as const,
          path: module.artifact.path,
        })),
      ],
      limitations: result.limitations,
    },
  );
};
