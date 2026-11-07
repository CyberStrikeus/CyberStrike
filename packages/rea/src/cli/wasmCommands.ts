import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { compareWasmInterfaces } from "../application/wasm/WasmInterfaceComparisonService.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { z } from "incur";
import { wasmArtifactModule } from "../composition/wasm.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import {
  evidenceBundleOption,
  runEvidenceInputCommand,
} from "./evidenceInputCommand.js";
import {
  inspectWasmArtifactInputSchema,
  wasmArtifactPathsSchema,
} from "../domain/wasm/wasmArtifact.js";

/** Resolve all caller-selected artifact paths through the shared workflow. */
export const registerWasmCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.compareWasmInterfaces, {
    description:
      "Compare core WASM interfaces from two exact inspection Evidence records",
    args: z.object({
      input: z
        .string()
        .describe(
          "Inline JSON or input file containing left/right Evidence or retained references and required scope",
        ),
    }),
    options: z.object({ evidenceBundle: evidenceBundleOption }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) =>
        logCliCommand(logger, CLI_COMMANDS.compareWasmInterfaces, async () => {
          const input = await parseCliJsonInput(
            args.input,
            "compare_wasm_interfaces",
            signal,
          );
          if (!input.ok) return input.error;
          return runEvidenceInputCommand(
            "compare_wasm_interfaces",
            options.evidenceBundle,
            signal,
            async (lookup) => {
              const result = await compareWasmInterfaces(
                input.value,
                { signal },
                lookup,
              );
              return result.ok
                ? { ok: true, value: result.value.evidence }
                : result;
            },
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
  const service = wasmArtifactModule.create(environment);
  cli.command(wasmArtifactModule.cliCommand, {
    description: "Inspect an explicit local WASM artifact with WABT",
    args: z.object({
      path: localPathStringSchema.describe("Local WASM artifact"),
    }),
    options: z.object({
      commandTimeoutMs: inspectWasmArtifactInputSchema.shape.command_timeout_ms,
      glue_paths: wasmArtifactPathsSchema(localPathStringSchema)
        .optional()
        .describe("Selected local JavaScript glue paths"),
      candidate_paths: wasmArtifactPathsSchema(localPathStringSchema)
        .optional()
        .describe("Explicit local WASM candidates"),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, wasmArtifactModule.cliCommand, () =>
          finishCliEvidenceCommand(
            args.path,
            () =>
              service.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  ...(options.commandTimeoutMs === undefined
                    ? {}
                    : { command_timeout_ms: options.commandTimeoutMs }),
                  glue_paths: options.glue_paths?.map((path) =>
                    absoluteCallerPath(path),
                  ),
                  candidate_paths: options.candidate_paths?.map((path) =>
                    absoluteCallerPath(path),
                  ),
                },
                { signal },
              ),
            service,
            "wabt-artifact",
            "inspect_wasm_artifact",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
};
