import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { ApktoolResourceAnalysisService } from "../application/apktool/ApktoolResourceAnalysisService.js";
import type { ApktoolResourceAnalysisPort } from "../application/apktool/ApktoolResourceAnalysisPort.js";
import { createApktoolResourceAnalysisProvider } from "../composition/apktool.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import {
  apktoolInputSchemas,
  type ApktoolOperation,
} from "../domain/apktool/apktoolResourceAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { bindCliEvidenceCallerPath } from "./cliEvidenceCallerPath.js";

/** Expose the same explicit Apktool requests through one-shot CLI commands. */
export const registerApktoolCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  provider: ApktoolResourceAnalysisPort = createApktoolResourceAnalysisProvider(
    environment,
  ),
): void => {
  const service = new ApktoolResourceAnalysisService(provider);
  const execute = (
    name: string,
    operation: ApktoolOperation,
    input: unknown,
    callerPath?: string,
  ) =>
    withCommandCancellation((signal) =>
      logCliCommand(logger, name, () =>
        finishAnalysisCommand(
          callerPath === undefined
            ? () => service.execute(operation, input, { signal })
            : bindCliEvidenceCallerPath(callerPath, () =>
                service.execute(operation, input, { signal }),
              ),
          { close: () => provider.close() },
          "apktool",
          operation,
          signal,
        ).then(projectCliAnalysisResult),
      ),
    );

  cli.command(CLI_COMMANDS.inspectApktoolClient, {
    description:
      "Inspect the caller-selected apktool launcher without decoding anything",
    args: z.object({}),
    run: () =>
      execute(CLI_COMMANDS.inspectApktoolClient, "inspect_apktool_client", {}),
  });
  cli.command(CLI_COMMANDS.decodeAndroidResources, {
    description:
      "Decode one APK's manifest, metadata, and string resources with apktool",
    args: z.object({
      path: z.string().min(1).describe("Local APK file to decode"),
    }),
    // The locale grammar and the string-projection default belong to the
    // apktool input owner. Read them from that schema rather than restating a
    // narrower locale pattern, which refused the owner's own advertised
    // `b+zh+Hans+CN` form at the CLI boundary.
    options: z.object({
      locale: apktoolInputSchemas.decode_android_resources.shape.locale,
      "string-tables-only":
        apktoolInputSchemas.decode_android_resources.shape.string_tables_only,
      locales:
        apktoolInputSchemas.decode_android_resources.shape.locales.describe(
          "Repeat to project multiple localized string tables, e.g. --locales de --locales pt-BR",
        ),
      decodeTimeoutMs:
        apktoolInputSchemas.decode_android_resources.shape.decode_timeout_ms,
      strings: z
        .boolean()
        .default(
          apktoolInputSchemas.decode_android_resources.shape.include_strings.parse(
            undefined,
          ),
        )
        .describe(
          "Include string resources; use --no-strings to skip projecting them",
        ),
    }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.decodeAndroidResources,
        "decode_android_resources",
        {
          path: args.path,
          include_strings: options.strings,
          ...(options["string-tables-only"] === undefined
            ? {}
            : { string_tables_only: options["string-tables-only"] }),
          ...(options.locale === undefined ? {} : { locale: options.locale }),
          ...(options.locales === undefined
            ? {}
            : { locales: options.locales }),
          ...(options.decodeTimeoutMs === undefined
            ? {}
            : { decode_timeout_ms: options.decodeTimeoutMs }),
        },
        args.path,
      ),
  });
};
