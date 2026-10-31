import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { inspectSqliteDatabaseInputSchema } from "../domain/sqlite/sqliteDatabase.js";
import { inspectSqliteDatabaseSnapshot } from "./SqliteDatabaseInspection.js";
import {
  SQLITE_DATABASE_LIMITS,
  SqliteColumnEvaluationFailure,
  SqliteColumnLimitFailure,
  SqliteInspectionFailure,
  sqlitePrimaryResultCode,
} from "./SqliteDatabaseLimits.js";

const requestSchema = z.strictObject({
  snapshot_path: z.string(),
  reply_path: z.string(),
  input: inspectSqliteDatabaseInputSchema,
});
const main = async (): Promise<void> => {
  const requestPath = process.argv[2];
  if (requestPath === undefined)
    throw new Error("Owned SQLite worker request path missing.");
  const request = requestSchema.parse(
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  let reply: unknown;
  try {
    reply = {
      ok: true,
      inspection: inspectSqliteDatabaseSnapshot(
        request.snapshot_path,
        request.input,
      ),
    };
  } catch (cause: unknown) {
    const code = sqlitePrimaryResultCode(cause);
    const message = cause instanceof Error ? cause.message : String(cause);
    reply =
      cause instanceof SqliteColumnEvaluationFailure
        ? {
            ok: false,
            reason: cause.reason,
            message,
            readable_columns: cause.readableColumns,
          }
        : cause instanceof SqliteColumnLimitFailure
          ? {
              ok: false,
              reason: cause.reason,
              message,
              selected_columns: cause.selectedColumns,
              engine_column_limit: cause.engineColumnLimit,
            }
          : {
              ok: false,
              reason:
                cause instanceof SqliteInspectionFailure
                  ? cause.reason
                  : code === 7
                    ? "memory"
                    : code === 18
                      ? "output-limit"
                      : "format",
              message,
            };
  }
  let encoded = JSON.stringify(reply);
  if (Buffer.byteLength(encoded) > SQLITE_DATABASE_LIMITS.outputBytes)
    encoded = JSON.stringify({
      ok: false,
      reason: "output-limit",
      message:
        "Complete SQLite evidence exceeds the 16 MiB JSON reply budget; no partial success was returned.",
    });
  await writeFile(request.reply_path, encoded, { flag: "wx", mode: 0o600 });
};
await main();
