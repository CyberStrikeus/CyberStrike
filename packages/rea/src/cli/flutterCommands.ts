import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import {
  evidenceSchema,
  withEvidenceCallerInputPath,
} from "../domain/evidence.js";
import { z } from "incur";
import { FlutterBuildAnalysisService } from "../application/flutter/FlutterBuildAnalysisService.js";
import type { FlutterBuildAnalysisPort } from "../application/flutter/FlutterBuildAnalysisPort.js";
import { createFlutterBuildAnalysisProvider } from "../composition/flutter.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import {
  flutterInputSchemas,
  type FlutterOperation,
} from "../domain/flutter/flutterBuildAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { bindCliEvidenceCallerPath } from "./cliEvidenceCallerPath.js";

/** One flutter command: CLI shape and the request it produces. */
interface FlutterCommandSpec {
  readonly command: string;
  readonly description: string;
  readonly argumentSchema: z.ZodObject<z.ZodRawShape>;
  readonly optionSchema?: z.ZodObject<z.ZodRawShape>;
  readonly operation: FlutterOperation;
  readonly toInput: (
    arguments_: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => unknown;
}

/** Expose the same explicit Flutter requests through one-shot CLI commands. */
export const registerFlutterCommands = (
  cli: CliInstance,
  logger: Logger,
  provider: FlutterBuildAnalysisPort = createFlutterBuildAnalysisProvider(),
): void => {
  const specs: readonly FlutterCommandSpec[] = [
    {
      command: CLI_COMMANDS.identifyFlutterBuild,
      description:
        "Identify a Flutter build's Dart snapshot hash and engine facts by pure APK parsing",
      argumentSchema: z.object({
        path: flutterInputSchemas.identify_flutter_build.shape.path,
      }),
      operation: "identify_flutter_build",
      toInput: (arguments_) => arguments_,
    },
    {
      command: CLI_COMMANDS.inspectDartAot,
      description:
        "Inspect one ABI's Dart AOT snapshot: sections, headers, and the string pool",
      argumentSchema: z.object({
        path: flutterInputSchemas.inspect_dart_aot.shape.path,
      }),
      optionSchema: z.object({
        abi: flutterInputSchemas.inspect_dart_aot.shape.abi,
      }),
      operation: "inspect_dart_aot",
      toInput: (arguments_, options) => ({
        path: arguments_.path,
        ...(options.abi === undefined ? {} : { abi: options.abi }),
      }),
    },
  ];
  for (const spec of specs) {
    cli.command(spec.command, {
      description: spec.description,
      ...(spec.optionSchema === undefined
        ? { args: spec.argumentSchema }
        : { args: spec.argumentSchema, options: spec.optionSchema }),
      run: ({ args, options }) =>
        withCommandCancellation((signal) =>
          logCliCommand(logger, spec.command, () =>
            finishAnalysisCommand(
              bindCliEvidenceCallerPath(args.path as string, () =>
                new FlutterBuildAnalysisService(provider).execute(
                  spec.operation,
                  spec.toInput(args, options ?? {}),
                  { signal },
                ),
              ),
              { close: () => provider.close() },
              "flutter",
              spec.operation,
              signal,
              undefined,
              {
                recoverCompletedObservation: (observation) => {
                  const parsed = evidenceSchema.safeParse(observation);
                  return parsed.success
                    ? withEvidenceCallerInputPath(
                        parsed.data,
                        args.path as string,
                      )
                    : undefined;
                },
              },
            ).then(projectCliAnalysisResult),
          ),
        ),
    });
  }
};
