import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { z } from "incur";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { err } from "../domain/result.js";
import { createIl2cppMetadataService } from "../composition/il2cpp.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";

/** CLI and MCP share inspection; one-shot summaries preserve a complete Evidence file. */
export const registerIl2cppCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.inspectIl2cppMetadata, {
    description:
      "Inventory IL2CPP global-metadata.dat names, owners and string literals, optionally linking method addresses from the native binary",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local global-metadata.dat (version 24, 27, 29, 31 or 39)",
      ),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      binary: localPathStringSchema
        .optional()
        .describe(
          "Matching native binary (Mach-O GameAssembly.dylib, PE GameAssembly.dll or ELF libil2cpp.so) to link method addresses; read only",
        ),
      architecture: z
        .enum(["arm64", "amd64"])
        .optional()
        .describe("Slice of a universal Mach-O binary"),
      genericInstances: z
        .boolean()
        .optional()
        .describe(
          "Also link generic method instances (Type<Args>$$Method<Args>) and include them in --ghidra-seeds; needs --binary",
        ),
      ghidraSeeds: localPathStringSchema
        .optional()
        .describe(
          "Also write REA_GHIDRA_SEED_FILE function seeds named Type$$Method for every linked method; needs --binary",
        ),
      seedBase: z
        .string()
        .regex(/^0x[0-9a-fA-F]{1,16}$/u)
        .optional()
        .describe(
          "Address Ghidra loads the binary at; seeds are seed-base + RVA (default: Ghidra's loader default, 0x100000 for an ELF linked at 0, else the link base)",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectIl2cppMetadata, async () => {
          const service = createIl2cppMetadataService();
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () => {
              const input = {
                path: absoluteCallerPath(args.path),
                detail: "complete" as const,
                ...(options.binary === undefined
                  ? {}
                  : { binary_path: absoluteCallerPath(options.binary) }),
                ...(options.architecture === undefined
                  ? {}
                  : { binary_architecture: options.architecture }),
                ...(options.genericInstances === true
                  ? { generic_instances: true }
                  : {}),
              };
              if (options.ghidraSeeds !== undefined)
                return service.inspectWithGhidraSeeds(
                  input,
                  {
                    path: absoluteCallerPath(options.ghidraSeeds),
                    ...(options.seedBase === undefined
                      ? {}
                      : { base: options.seedBase }),
                  },
                  { signal },
                );
              if (options.seedBase !== undefined)
                return Promise.resolve(
                  err(
                    new AnalysisInputError(
                      "inspect_il2cpp_metadata",
                      undefined,
                      [
                        {
                          path: ["seed_base"],
                          reason: "invalid_value",
                          message: "--seed-base requires --ghidra-seeds.",
                        },
                      ],
                    ),
                  ),
                );
              return service.inspect(input, { signal });
            },
            service,
            providerId: "il2cpp-metadata",
            operation: "inspect_il2cpp_metadata",
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
          });
        }),
      ),
  });
};
