import { z } from "zod";
import { absoluteLocalPathStringSchema } from "../localPath.js";
import type { JsonValue } from "../jsonValue.js";

/** Format identity is shared by discovery, catalog, and observed SQLite results. */
export const SQLITE_PROVIDER_IDENTITY = {
  id: "sqlite",
  name: "REA SQLite database inspector",
  version: null,
} as const;

/** SQLite exposes this table as a row source but omits its own catalog entry. */
export const SQLITE_SCHEMA_TABLE_NAME = "sqlite_schema";
export const sqliteSchemaHasObjectDeclaration = (name: string): boolean =>
  name !== SQLITE_SCHEMA_TABLE_NAME;

/** Default ordinary-table sample size when the caller selects a table. */
export const SQLITE_ROW_LIMIT_DEFAULT = 20;
/** Execution budget, bounded by the runtime's signed 32-bit timer range. */
export const DEFAULT_SQLITE_WORKER_TIMEOUT_MS = 30_000;
export const MAX_SQLITE_WORKER_TIMEOUT_MS = 2_147_483_647;
const workerTimeout = z.number().int().min(1).max(MAX_SQLITE_WORKER_TIMEOUT_MS);

const nonnegative = z.int().nonnegative();
const hex = z.string().regex(/^(?:[0-9a-f]{2})*$/);
const encoding = z.enum(["UTF-8", "UTF-16le", "UTF-16be"]);
const artifactSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: nonnegative,
});

/** Inspect one frozen database and its sibling WAL, with optional ordinary-table rows. */
export const inspectSqliteDatabaseInputSchema = z
  .strictObject({
    path: absoluteLocalPathStringSchema.describe(
      "Absolute path to an offline SQLite database snapshot",
    ),
    worker_timeout_ms: workerTimeout
      .optional()
      .describe(
        `Deadline in milliseconds for worker startup, queries and reply writing (default ${String(DEFAULT_SQLITE_WORKER_TIMEOUT_MS)}), not snapshot acquisition or the whole call. Allow client headroom for acquisition, reply reads, cleanup and delivery. Fixed byte/heap limits do not change.`,
      ),
    table: z
      .string()
      .optional()
      .describe(
        "Exact ordinary table name; views and virtual/shadow tables are not executed",
      ),
    columns: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Exact row columns in caller-selected order; requires table. Omit to sample all visible columns.",
      ),
    schema_scope: z
      .enum(["inventory", "selected_table", "database"])
      .optional()
      .describe(
        "Default: compact inventory without a table, or detailed selected-table schema with a table. selected_table requires table. Database explicitly expands all stored declarations and supported columns.",
      ),
    row_limit: z
      .int()
      .min(1)
      .optional()
      .describe(
        "Selected-table sample size, default 20; subject to byte and worker resource limits",
      ),
  })
  .describe("When schema_scope is selected_table, also provide table.")
  .superRefine((input, context) => {
    if (input.row_limit !== undefined && input.table === undefined)
      context.addIssue({
        code: "custom",
        path: ["row_limit"],
        message: "row_limit requires an explicit table selection",
      });
    if (input.columns !== undefined && input.table === undefined)
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "columns requires an explicit table selection",
      });
    if (input.schema_scope === "selected_table" && input.table === undefined)
      context.addIssue({
        code: "custom",
        path: ["schema_scope"],
        message: "selected_table schema scope requires table",
      });
  })
  .meta({
    dependentRequired: { row_limit: ["table"], columns: ["table"] },
    if: {
      properties: { schema_scope: { const: "selected_table" } },
      required: ["schema_scope"],
    },
    then: { required: ["table"] },
  });

/** JSON-safe SQLite cells retain integers, binary content and special REAL values. */
export const sqliteValueSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("null") }),
  z.strictObject({
    type: z.literal("integer"),
    value: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/),
  }),
  z.strictObject({
    type: z.literal("real"),
    value: z.union([z.number(), z.enum(["Infinity", "-Infinity", "-0"])]),
  }),
  z.strictObject({
    type: z.literal("text"),
    value: z.string(),
    bytes_hex: hex,
    encoding,
  }),
  z.strictObject({ type: z.literal("blob"), hex }),
]);

/** Frozen schema facts and explicitly bounded selected records, without arbitrary SQL. */
export const sqliteDatabaseSchema = z
  .strictObject({
    artifact: artifactSchema,
    wal: artifactSchema.nullable(),
    engine: z.strictObject({
      name: z.literal("SQLite"),
      version: z.string().min(1),
    }),
    worker_timeout_ms: workerTimeout
      .exactOptional()
      .describe(
        "Actual parent-supervised worker deadline in milliseconds; absent in historical Evidence means unknown, not the default.",
      ),
    database_encoding: encoding,
    schema: z.strictObject({
      scope: z.enum(["inventory", "selected_table", "database"]),
      completeness: z
        .literal("complete")
        .describe(
          "Complete within the indicated schema scope; inventory omits declarations and column details",
        ),
      tables: z.array(
        z.strictObject({
          name: z.string(),
          sql: z.string().nullable().optional(),
          root_page: nonnegative,
          kind: z
            .enum(["table", "virtual", "shadow", "unknown"])
            .describe(
              "Unknown means a possible shadow table of an unresolved virtual table; its rows cannot be inspected",
            ),
          without_rowid: z.boolean(),
          strict: z.boolean(),
          column_count: nonnegative.nullable(),
          columns_completeness: z.enum([
            "complete",
            "unsupported",
            "not_requested",
          ]),
          columns: z.array(
            z.strictObject({
              cid: nonnegative,
              name: z.string(),
              declared_type: z.string(),
              not_null: z.boolean(),
              default_sql: z.string().nullable(),
              primary_key_position: nonnegative,
              hidden: z.union([
                z.literal(0),
                z.literal(1),
                z.literal(2),
                z.literal(3),
              ]),
            }),
          ),
        }),
      ),
      indexes: z.array(
        z.strictObject({
          name: z.string(),
          table: z.string(),
          sql: z.string().nullable().optional(),
          root_page: nonnegative,
        }),
      ),
      views: z.array(
        z.strictObject({
          name: z.string(),
          sql: z.string().nullable().optional(),
        }),
      ),
      triggers: z.array(
        z.strictObject({
          name: z.string(),
          table: z.string(),
          sql: z.string().nullable().optional(),
        }),
      ),
    }),
    rows: z
      .strictObject({
        table: z.string(),
        columns: z.array(z.string()),
        values: z.array(z.array(sqliteValueSchema)),
        row_limit: z.int().min(1),
        returned_rows: nonnegative,
        truncated: z.boolean(),
        order: z.literal("unspecified"),
      })
      .nullable(),
    limitations: z.array(z.string()),
  })
  .superRefine((report, context) => {
    const rows = report.rows;
    if (
      rows !== null &&
      (rows.returned_rows !== rows.values.length ||
        rows.returned_rows > rows.row_limit ||
        rows.values.some((row) => row.length !== rows.columns.length))
    )
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message:
          "Selected row counts and column dimensions must match the retained values",
      });
  });

export type InspectSqliteDatabaseInput = z.infer<
  typeof inspectSqliteDatabaseInputSchema
>;
export type SqliteDatabase = z.infer<typeof sqliteDatabaseSchema>;
export type SqliteValue = z.infer<typeof sqliteValueSchema>;

/** Preserve explicit caller selections while omitting absent optional values from JSON. */
export const sqliteInspectionParameters = (
  input: InspectSqliteDatabaseInput,
): Readonly<Record<string, JsonValue>> => ({
  path: input.path,
  ...(input.worker_timeout_ms === undefined
    ? {}
    : { worker_timeout_ms: input.worker_timeout_ms }),
  ...(input.table === undefined ? {} : { table: input.table }),
  ...(input.columns === undefined ? {} : { columns: input.columns }),
  ...(input.schema_scope === undefined
    ? {}
    : { schema_scope: input.schema_scope }),
  ...(input.row_limit === undefined ? {} : { row_limit: input.row_limit }),
});

/** One contract owner interprets omitted scope for adapters and selection checks. */
export const sqliteSchemaScope = (
  input: InspectSqliteDatabaseInput,
): SqliteDatabase["schema"]["scope"] =>
  input.schema_scope ??
  (input.table === undefined ? "inventory" : "selected_table");
