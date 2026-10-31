import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { JebAnalysisService } from "../application/jeb/JebAnalysisService.js";
import type { JebAnalysisPort } from "../application/jeb/JebAnalysisPort.js";
import { createJebAnalysisProvider } from "../composition/jeb.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { JebOperation } from "../domain/jeb/jebAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { bindCliEvidenceCallerPath } from "./cliEvidenceCallerPath.js";
import { jebInputSchemas } from "../domain/jeb/jebAnalysis.js";

/** Expose the same explicit JEB requests through one-shot CLI commands. */
export const registerJebCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
  provider: JebAnalysisPort = createJebAnalysisProvider(environment),
): void => {
  const service = new JebAnalysisService(provider);
  const execute = (
    name: string,
    operation: JebOperation,
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
          "jeb",
          operation,
          signal,
        ).then(projectCliAnalysisResult),
      ),
    );

  cli.command(CLI_COMMANDS.inspectJebClient, {
    description: "Inspect the running JEB MCP client without opening a target",
    args: z.object({}),
    run: () => execute(CLI_COMMANDS.inspectJebClient, "inspect_jeb_client", {}),
  });
  cli.command(CLI_COMMANDS.openJebProject, {
    description:
      "Open or create a JEB project from an artifact or .jdb2 database",
    args: z.object({
      path: jebInputSchemas.open_jeb_project.shape.path,
    }),
    run: ({ args }) =>
      execute(CLI_COMMANDS.openJebProject, "open_jeb_project", args, args.path),
  });
  cli.command(CLI_COMMANDS.listJebUnits, {
    description: "List JEB project units by path and type with optional filter",
    args: z.object({}),
    options: z.object({
      filter: jebInputSchemas.list_jeb_units.shape.filter,
      "parent-unit-path": jebInputSchemas.list_jeb_units.shape.parent_unit_path,
      index: jebInputSchemas.list_jeb_units.shape.index,
      count: jebInputSchemas.list_jeb_units.shape.count,
    }),
    run: ({ options }) =>
      execute(CLI_COMMANDS.listJebUnits, "list_jeb_units", {
        index: options.index,
        count: options.count,
        ...(options.filter === undefined ? {} : { filter: options.filter }),
        ...(options["parent-unit-path"] === undefined
          ? {}
          : { parent_unit_path: options["parent-unit-path"] }),
      }),
  });
  cli.command(CLI_COMMANDS.decompileJebItem, {
    description: "Decompile one JEB type or method to engine pseudo-code",
    args: z.object({
      "item-address": jebInputSchemas.decompile_jeb_item.shape.item_address,
      "item-kind": jebInputSchemas.decompile_jeb_item.shape.item_kind,
    }),
    options: z.object({
      "unit-path": jebInputSchemas.decompile_jeb_item.shape.unit_path,
    }),
    run: ({ args, options }) =>
      execute(CLI_COMMANDS.decompileJebItem, "decompile_jeb_item", {
        item_address: args["item-address"],
        item_kind: args["item-kind"],
        ...(options["unit-path"] === undefined
          ? {}
          : { unit_path: options["unit-path"] }),
      }),
  });
};
