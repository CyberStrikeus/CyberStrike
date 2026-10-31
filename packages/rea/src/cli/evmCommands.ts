import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { evmInterfaceModule } from "../composition/evm.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import { inspectEvmInterfaceInputSchema } from "../domain/evm/evmInterface.js";

/** Resolve operator paths and preserve explicit encoding through the shared workflow. */
export const registerEvmCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  const service = evmInterfaceModule.create(environment);
  cli.command(evmInterfaceModule.cliCommand, {
    description: "Infer interface candidates from explicit local EVM bytecode",
    args: z.object({
      path: localPathStringSchema.describe("Local bytecode carrier"),
      encoding: z
        .enum(["raw", "hex"])
        .describe("Selected carrier representation"),
    }),
    options: z.object({
      timeoutMs: inspectEvmInterfaceInputSchema.shape.timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, evmInterfaceModule.cliCommand, () =>
          finishCliEvidenceCommand(
            args.path,
            () =>
              service.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  encoding: args.encoding,
                  ...(options.timeoutMs === undefined
                    ? {}
                    : { timeout_ms: options.timeoutMs }),
                },
                { signal },
              ),
            service,
            "evmole-interface",
            "inspect_evm_interface",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
};
