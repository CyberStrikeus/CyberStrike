import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { createSqliteDatabaseService } from "../composition/sqlite.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import { inspectSqliteDatabaseInputSchema } from "../domain/sqlite/sqliteDatabase.js";

/** Resolve an operator-selected SQLite snapshot through the shared inspection workflow. */
export const registerSqliteCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  const service = createSqliteDatabaseService(environment);
  cli.command(CLI_COMMANDS.inspectSqliteDatabase, {
    description:
      "Inspect SQLite schema and optional ordinary-table rows from a local snapshot",
    args: z.object({
      path: localPathStringSchema.describe("Local SQLite database snapshot"),
    }),
    options: z.object({
      workerTimeoutMs: inspectSqliteDatabaseInputSchema.shape.worker_timeout_ms,
      table: z
        .string()
        .optional()
        .describe("Exact ordinary table name to read"),
      column: z
        .array(z.string())
        .optional()
        .describe(
          "Repeat to select exact row columns in the requested order; requires table",
        ),
      schemaScope: z
        .enum(["inventory", "selected_table", "database"])
        .optional()
        .describe(
          "Compact inventory by default, or selected-table details when table is supplied; database requests full schema",
        ),
      rowLimit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Positive safe integer row count; default 20; requires table",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectSqliteDatabase, () =>
          finishCliEvidenceCommand(
            args.path,
            () =>
              service.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  ...(options.workerTimeoutMs === undefined
                    ? {}
                    : { worker_timeout_ms: options.workerTimeoutMs }),
                  ...(options.table === undefined
                    ? {}
                    : { table: options.table }),
                  ...(options.rowLimit === undefined
                    ? {}
                    : { row_limit: options.rowLimit }),
                  ...(options.column === undefined
                    ? {}
                    : { columns: options.column }),
                  ...(options.schemaScope === undefined
                    ? {}
                    : { schema_scope: options.schemaScope }),
                },
                { signal },
              ),
            service,
            "sqlite",
            "inspect_sqlite_database",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
};
