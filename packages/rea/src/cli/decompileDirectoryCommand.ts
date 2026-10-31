import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";

import type { DirectAnalysis } from "../composition/directAnalysis.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import {
  directAnalysisOptionsFromCli,
  nativeOpenOptionFields,
} from "./options.js";
import type { CliInstance } from "./types.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { JsonValue } from "../domain/jsonValue.js";

/** Register `rea decompile-all`, the directory export of provider pseudocode. */
export const registerDecompileDirectoryCommand = (
  cli: CliInstance,
  logger: Logger,
  runDirectAnalysis: DirectAnalysis["runDirectAnalysis"],
): void => {
  cli.command(CLI_COMMANDS.decompileAll, {
    description:
      "Write every function's pseudocode into a directory and return a manifest",
    args: z.object({
      path: z.string().describe("App or program path"),
    }),
    options: z.object({
      output: localPathStringSchema.describe(
        "Output directory. A relative path is resolved from the working directory. The parent must exist.",
      ),
      layout: z
        .enum(["address", "dwarf"])
        .default("address")
        .describe(
          "address names files by function address. dwarf reports that compilation-unit paths are unavailable.",
        ),
      resume: z
        .boolean()
        .default(false)
        .describe(
          "Continue a matching export. Never overwrites a function file.",
        ),
      name: z
        .string()
        .min(1)
        .optional()
        .describe("Case-sensitive literal substring of the function name"),
      namespace: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Case-sensitive function-name prefix, including any separator",
        ),
      addressStart: z
        .string()
        .min(1)
        .optional()
        .describe("Inclusive lower bound, 0xoffset or space:0xoffset"),
      addressEnd: z
        .string()
        .min(1)
        .optional()
        .describe("Inclusive upper bound, 0xoffset or space:0xoffset"),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Maximum functions to attempt after skipping verified files and recorded external functions",
        ),
      snapshot: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Load a local analysis snapshot. decompile-all does not update it.",
        ),
      ...nativeOpenOptionFields,
    }),
    run: ({ args, options }) =>
      logCliCommand(logger, "decompile-all", () =>
        runDirectAnalysis(
          args.path,
          "decompile_all",
          decompileAllArguments(options),
          directAnalysisOptionsFromCli(logger, options),
        ).then(projectCliAnalysisResult),
      ),
  });
};

const decompileAllArguments = (options: {
  readonly output: string;
  readonly layout: "address" | "dwarf";
  readonly resume: boolean;
  readonly name?: string | undefined;
  readonly namespace?: string | undefined;
  readonly addressStart?: string | undefined;
  readonly addressEnd?: string | undefined;
  readonly limit?: number | undefined;
}): Readonly<Record<string, JsonValue>> => ({
  output_directory: absoluteCallerPath(options.output),
  layout: options.layout,
  resume: options.resume,
  ...(options.name === undefined ? {} : { name: options.name }),
  ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
  ...(options.addressStart === undefined
    ? {}
    : { address_start: options.addressStart }),
  ...(options.addressEnd === undefined
    ? {}
    : { address_end: options.addressEnd }),
  ...(options.limit === undefined ? {} : { limit: options.limit }),
});
