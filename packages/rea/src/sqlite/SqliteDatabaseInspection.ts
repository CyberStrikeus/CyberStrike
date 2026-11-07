import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { jsonParts } from "../domain/jsonSerialization.js";
import {
  SQLITE_ROW_LIMIT_DEFAULT,
  sqliteSchemaHasObjectDeclaration,
  sqliteSchemaScope,
  type InspectSqliteDatabaseInput,
  type SqliteDatabase,
  type SqliteValue,
} from "../domain/sqlite/sqliteDatabase.js";
import {
  SQLITE_DATABASE_LIMITS,
  SqliteColumnEvaluationFailure,
  SqliteColumnLimitFailure,
  SqliteInspectionFailure,
  sqlitePrimaryResultCode,
} from "./SqliteDatabaseLimits.js";

/** SQLite's generic SQL error, raised while compiling or evaluating an expression. */
const SQLITE_ERROR = 1;

const natural = z
  .bigint()
  .nonnegative()
  .max(BigInt(Number.MAX_SAFE_INTEGER))
  .transform(Number);
const schemaRow = z.object({
  type: z.enum(["table", "index", "view", "trigger"]),
  name: z.instanceof(Uint8Array),
  tbl_name: z.instanceof(Uint8Array),
  rootpage: natural,
  sql: z.instanceof(Uint8Array).nullable().optional(),
});
const tableRow = z.object({
  schema: z.string(),
  display_name: z.string(),
  name: z.instanceof(Uint8Array),
  type: z.enum(["table", "view", "virtual", "shadow"]),
  ncol: natural,
  wr: z.bigint(),
  strict: z.bigint(),
});
const columnRow = z.object({
  cid: natural,
  name: z.instanceof(Uint8Array),
  type: z.instanceof(Uint8Array),
  notnull: z.bigint(),
  dflt_value: z.instanceof(Uint8Array).nullable(),
  pk: natural,
  hidden: z
    .bigint()
    .transform(Number)
    .pipe(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])),
});
const arrayRow = z.array(
  z.union([
    z.null(),
    z.bigint(),
    z.custom<number>(
      (value) => typeof value === "number" && !Number.isNaN(value),
    ),
    z.string(),
  ]),
);
const encodingSchema = z.enum(["UTF-8", "UTF-16le", "UTF-16be"]);
const cellByteLengths = z.array(z.bigint().nonnegative());
type DatabaseEncoding = z.output<typeof encodingSchema>;
type Inspection = Pick<
  SqliteDatabase,
  "engine" | "database_encoding" | "schema" | "rows" | "limitations"
>;
type SelectedTableFacts = Pick<
  SqliteDatabase["schema"]["tables"][number],
  "name" | "kind" | "columns"
>;

class OutputBudget {
  #bytes = 1024;
  retain(value: unknown): void {
    // Count bounded encoded parts, including escapes, without allocating a
    // document-sized string just to decide whether it fits the reply.
    this.#bytes += 1;
    for (const part of jsonParts(value)) {
      this.#bytes += Buffer.byteLength(part);
      if (this.#bytes > SQLITE_DATABASE_LIMITS.outputBytes)
        throw new SqliteInspectionFailure(
          "output-limit",
          "Complete SQLite evidence exceeds the 16 MiB JSON reply budget; no partial success was returned.",
        );
    }
  }
  beforeDecode(row: z.output<typeof arrayRow>): void {
    let minimumBytes = this.#bytes;
    for (const value of row)
      if (typeof value === "string") minimumBytes += Buffer.byteLength(value);
    if (minimumBytes > SQLITE_DATABASE_LIMITS.outputBytes)
      throw new SqliteInspectionFailure(
        "output-limit",
        "Selected cells exceed the 16 MiB reply budget before text/hex expansion.",
      );
  }
  beforeProjection(lengths: readonly bigint[]): void {
    const encodedBytes = lengths.reduce(
      (total, length) => total + length * 2n,
      BigInt(lengths.length * 64),
    );
    if (
      encodedBytes + BigInt(this.#bytes) >
      BigInt(SQLITE_DATABASE_LIMITS.outputBytes)
    )
      throw new SqliteInspectionFailure(
        "output-limit",
        "Selected row byte lengths exceed the 16 MiB reply budget before hex projection.",
      );
  }
}
const quoteIdentifier = (name: string): string =>
  `"${name.replaceAll('"', '""')}"`;
const missingSelectedTable = (name: string): SqliteInspectionFailure =>
  new SqliteInspectionFailure(
    "selection",
    `Selected ordinary table does not exist with that exact name: ${name}`,
  );
// SQLite folds only ASCII letters when matching identifiers. Fold stored
// bytes so replacement decoding cannot make distinct names share an identity.
const sqliteNameBytesKey = (name: Uint8Array): string =>
  Buffer.from(name).toString("hex");
const sqliteIdentifierBytesKey = (
  name: Uint8Array,
  encoding: DatabaseEncoding,
): string => {
  const bytes = Buffer.from(name);
  if (encoding === "UTF-8") {
    for (let index = 0; index < bytes.length; index += 1)
      if (bytes[index]! >= 0x41 && bytes[index]! <= 0x5a)
        bytes[index] = bytes[index]! + 0x20;
  } else {
    const asciiOffset = encoding === "UTF-16le" ? 0 : 1;
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      const letter = bytes[index + asciiOffset]!;
      if (
        bytes[index + (1 - asciiOffset)] === 0 &&
        letter >= 0x41 &&
        letter <= 0x5a
      )
        bytes[index + asciiOffset] = letter + 0x20;
    }
  }
  return bytes.toString("hex");
};
const sqliteNameBytes = (
  db: DatabaseSync,
  name: string,
): Uint8Array | undefined => {
  const row = z
    .object({ name: z.instanceof(Uint8Array) })
    .optional()
    .parse(
      db
        .prepare(
          "SELECT CAST(name AS BLOB) AS name FROM temp.pragma_table_list WHERE schema = 'main' AND name = ? COLLATE BINARY",
        )
        .get(name),
    );
  return row?.name;
};
const textEncoding = (encoding: DatabaseEncoding): string =>
  encoding === "UTF-8"
    ? "utf-8"
    : encoding === "UTF-16le"
      ? "utf-16le"
      : "utf-16be";

const decodeSchemaText = (
  value: Uint8Array,
  encoding: DatabaseEncoding,
  label: string,
): string => {
  try {
    return new TextDecoder(textEncoding(encoding), {
      fatal: true,
      ignoreBOM: true,
    }).decode(value);
  } catch (cause: unknown) {
    throw new SqliteInspectionFailure(
      "format",
      `SQLite schema ${label} contains malformed ${encoding} text: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

const cell = (
  value: z.output<typeof arrayRow>[number],
  encoding: DatabaseEncoding,
): SqliteValue => {
  if (value === null) return { type: "null" };
  if (typeof value === "bigint")
    return { type: "integer", value: String(value) };
  if (typeof value === "number")
    return {
      type: "real",
      value:
        value === Infinity
          ? "Infinity"
          : value === -Infinity
            ? "-Infinity"
            : Object.is(value, -0)
              ? "-0"
              : value,
    };
  const hex = value.slice(1).toLowerCase();
  if (!/^(?:[0-9a-f]{2})*$/.test(hex))
    throw new SqliteInspectionFailure(
      "format",
      "SQLite returned an invalid encoded cell.",
    );
  if (value[0] === "b") return { type: "blob", hex };
  if (value[0] !== "t")
    throw new SqliteInspectionFailure(
      "format",
      "SQLite returned an unknown encoded cell type.",
    );
  return {
    type: "text",
    value: new TextDecoder(textEncoding(encoding), { ignoreBOM: true }).decode(
      Buffer.from(hex, "hex"),
    ),
    bytes_hex: hex,
    encoding,
  };
};

const readColumns = (
  db: DatabaseSync,
  name: string,
  context: {
    readonly budget: OutputBudget;
    readonly encoding: DatabaseEncoding;
    readonly selectedColumns?: readonly string[] | undefined;
  },
): SqliteDatabase["schema"]["tables"][number]["columns"] => {
  const { budget, encoding, selectedColumns } = context;
  const columns: SqliteDatabase["schema"]["tables"][number]["columns"] = [];
  // This private read-only connection has an empty temp schema. Qualifying the
  // built-in there prevents stored main tables/views from shadowing it; the
  // final argument selects main's metadata. Decode bytes before names become
  // SQL identifiers. Inventory-only row subsets compare exact encoded names
  // first, so an unrelated malformed identifier cannot alias a requested one.
  const selection =
    selectedColumns === undefined
      ? ""
      : " WHERE CAST(name AS BLOB) IN (SELECT CAST(value AS BLOB) FROM temp.json_each(?))";
  // One bound data value keeps metadata selection independent of SQL-variable
  // capacity. SQLite owns conversion into the database encoding, and filters
  // before projecting unrelated column definitions. Row projections still keep
  // the caller's order/repetitions and enforce the native result-column limit.
  const parameters =
    selectedColumns === undefined
      ? [name]
      : [name, JSON.stringify([...new Set(selectedColumns)])];
  for (const raw of db
    .prepare(
      `SELECT cid, CAST(name AS BLOB) AS name, CAST(type AS BLOB) AS type, "notnull", CAST(dflt_value AS BLOB) AS dflt_value, pk, hidden FROM temp.pragma_table_xinfo(?, 'main')${selection}`,
    )
    .iterate(...parameters)) {
    const value = columnRow.parse(raw);
    const column = {
      cid: value.cid,
      name: decodeSchemaText(value.name, encoding, "column name"),
      declared_type: decodeSchemaText(value.type, encoding, "column type"),
      not_null: value.notnull !== 0n,
      default_sql:
        value.dflt_value === null
          ? null
          : decodeSchemaText(value.dflt_value, encoding, "column default"),
      primary_key_position: value.pk,
      hidden: value.hidden,
    };
    budget.retain(column);
    columns.push(column);
  }
  // Sort only retained facts, without copying untrusted text into native sorter records.
  return columns.sort((left, right) => left.cid - right.cid);
};

const readSchema = (
  db: DatabaseSync,
  input: InspectSqliteDatabaseInput,
  context: {
    readonly budget: OutputBudget;
    readonly limitations: string[];
    readonly encoding: DatabaseEncoding;
  },
): {
  schema: SqliteDatabase["schema"];
  selectedTable: SelectedTableFacts | undefined;
} => {
  const { budget, limitations, encoding } = context;
  const scope = sqliteSchemaScope(input);
  const selectedName = scope === "selected_table" ? input.table : undefined;
  if (scope === "selected_table" && selectedName === undefined)
    throw new SqliteInspectionFailure(
      "selection",
      "Selected-table schema scope requires an exact table name.",
    );
  let selectedTable: SelectedTableFacts | undefined;
  const metadata = new Map<string, z.output<typeof tableRow>>();
  const selectedBytes =
    selectedName === undefined ? undefined : sqliteNameBytes(db, selectedName);
  const selectedKey =
    selectedBytes === undefined ? undefined : sqliteNameBytesKey(selectedBytes);
  const selectedIdentifierKey =
    selectedBytes === undefined
      ? undefined
      : sqliteIdentifierBytesKey(selectedBytes, encoding);
  const underscore =
    encoding === "UTF-8"
      ? Buffer.from("_")
      : encoding === "UTF-16le"
        ? Buffer.from([0x5f, 0])
        : Buffer.from([0, 0x5f]);
  const unresolvedVirtualTables: { name: string; prefix: string }[] = [];
  // Names bound eventual output only when the whole catalog is requested.
  // Selected scope retains one table and at most one possible shadow parent;
  // unrelated names are examined without retaining them or charging the reply.
  const catalogNameBudget = new OutputBudget();
  for (const raw of db
    .prepare(
      "SELECT schema, name AS display_name, CAST(name AS BLOB) AS name, type, ncol, wr, strict FROM temp.pragma_table_list WHERE schema = 'main'",
    )
    .iterate()) {
    const value = tableRow.parse(raw);
    const nameKey = sqliteNameBytesKey(value.name);
    if (selectedName === undefined) {
      // The private hex key grows with the database encoding, but is never
      // returned. Admit catalog names by their decoded JSON representation;
      // display text is used only for this lower bound, never for identity.
      // Stored schema bytes still undergo strict decoding below.
      catalogNameBudget.retain(value.display_name);
      metadata.set(nameKey, value);
    } else if (nameKey === selectedKey) {
      metadata.set(nameKey, value);
    }
    if (value.type === "virtual" && value.ncol === 0) {
      const virtualName = value.display_name;
      const prefix = `${sqliteIdentifierBytesKey(value.name, encoding)}${underscore.toString("hex")}`;
      if (
        selectedKey === undefined ||
        (unresolvedVirtualTables.length === 0 &&
          selectedIdentifierKey?.startsWith(prefix) === true)
      )
        unresolvedVirtualTables.push({ name: virtualName, prefix });
    }
  }
  // A trigger stores its target as written in CREATE TRIGGER, which SQLite
  // resolves by ASCII case folding; report the stored table or view name.
  // A selected-table scan returns only the selected table's dependents, and
  // other scopes fold stored names once, only when a spelling differs.
  let foldedNames: Map<string, string> | undefined;
  const triggerTable = (written: string, writtenBytes: Uint8Array): string => {
    if (selectedName !== undefined) return selectedName;
    foldedNames ??= new Map(
      [...metadata.values()].flatMap((listed) => {
        try {
          const name = decodeSchemaText(listed.name, encoding, "name");
          return [
            [sqliteIdentifierBytesKey(listed.name, encoding), name] as const,
          ];
        } catch (cause: unknown) {
          if (
            !(cause instanceof SqliteInspectionFailure) ||
            cause.reason !== "format"
          )
            throw cause;
          // The catalog walk reports malformed names at the schema row. Never
          // use SQLite's replacement-decoded display alias for identity.
          return [];
        }
      }),
    );
    return (
      foldedNames.get(sqliteIdentifierBytesKey(writtenBytes, encoding)) ??
      written
    );
  };
  const shadowParentOf = (
    name: Uint8Array,
    listed: z.output<typeof tableRow>,
  ): (typeof unresolvedVirtualTables)[number] | undefined => {
    if (listed.type !== "table") return undefined;
    const identifier = sqliteIdentifierBytesKey(name, encoding);
    return unresolvedVirtualTables.find((parent) =>
      identifier.startsWith(parent.prefix),
    );
  };
  const selected =
    selectedKey === undefined ? undefined : metadata.get(selectedKey);
  if (selectedName !== undefined && selected === undefined)
    throw missingSelectedTable(selectedName);
  const selectedShadowParent =
    selectedName === undefined || selected === undefined
      ? undefined
      : selectedBytes === undefined
        ? undefined
        : shadowParentOf(selectedBytes, selected);
  // sqlite_schema is a queryable ordinary table in PRAGMA inventory, but has
  // no self-row in its stored declaration table. Keep these row-source facts
  // separate from schema.tables rather than manufacturing a declaration.
  const inputTableBytes =
    input.table === undefined ? undefined : sqliteNameBytes(db, input.table);
  const inputTableKey =
    inputTableBytes === undefined
      ? undefined
      : sqliteNameBytesKey(inputTableBytes);
  const selectedRowSource =
    inputTableKey === undefined ? undefined : metadata.get(inputTableKey);
  const selectedRowSourceName = selectedRowSource?.display_name;
  if (
    input.table !== undefined &&
    !sqliteSchemaHasObjectDeclaration(input.table) &&
    selectedRowSource?.type === "table" &&
    selectedRowSourceName !== undefined
  )
    selectedTable = {
      name: selectedRowSourceName,
      kind: selectedRowSource.type,
      columns: readColumns(db, selectedRowSourceName, {
        budget: new OutputBudget(),
        encoding,
        selectedColumns: input.columns,
      }),
    };
  // NOCASE folds only ASCII letters, as SQLite does when it resolves the
  // table named by an index or trigger. Fold only for an ordinary table whose
  // rows can be selected; a selection refused later keeps the exact filter,
  // so its failure does not depend on declarations under another spelling.
  const foldDependents =
    selected?.type === "table" && selectedShadowParent === undefined;
  const schema: SqliteDatabase["schema"] = {
    scope,
    completeness: "complete",
    tables: [],
    indexes: [],
    views: [],
    triggers: [],
  };
  // Raw bytes preserve text without hex expansion; avoid sorter records that
  // duplicate large names or definitions beyond SQLite's native record limit.
  const declaration = scope === "inventory" ? "" : ", CAST(sql AS BLOB) AS sql";
  const selection =
    scope === "selected_table"
      ? ` WHERE tbl_name = ? COLLATE ${foldDependents ? "NOCASE" : "BINARY"}`
      : "";
  const statement = db.prepare(
    `SELECT type, CAST(name AS BLOB) AS name, CAST(tbl_name AS BLOB) AS tbl_name, rootpage${declaration} FROM main.sqlite_schema${selection}`,
  );
  for (const raw of statement.iterate(
    ...(selectedName === undefined ? [] : [selectedName]),
  )) {
    const parsed = schemaRow.parse(raw);
    const value = {
      ...parsed,
      name: decodeSchemaText(parsed.name, encoding, "name"),
      tbl_name: decodeSchemaText(parsed.tbl_name, encoding, "table"),
      sql:
        parsed.sql === undefined
          ? undefined
          : parsed.sql === null
            ? null
            : decodeSchemaText(parsed.sql, encoding, "sql"),
    };
    if (value.type === "table") {
      const listed = metadata.get(sqliteNameBytesKey(parsed.name));
      if (listed === undefined || listed.type === "view")
        throw new SqliteInspectionFailure(
          "format",
          `SQLite schema/table inventory mismatch: ${value.name}`,
        );
      const possibleShadowParent =
        sqliteNameBytesKey(parsed.name) === selectedKey
          ? selectedShadowParent
          : shadowParentOf(parsed.name, listed);
      const table: SqliteDatabase["schema"]["tables"][number] = {
        name: value.name,
        ...(scope === "inventory" ? {} : { sql: value.sql }),
        root_page: value.rootpage,
        kind: possibleShadowParent === undefined ? listed.type : "unknown",
        without_rowid: listed.wr !== 0n,
        strict: listed.strict !== 0n,
        column_count:
          listed.type === "virtual" && listed.ncol === 0 ? null : listed.ncol,
        columns_completeness: "complete",
        columns: [],
      };
      if (possibleShadowParent !== undefined)
        limitations.push(
          `SQLite could not resolve virtual table ${possibleShadowParent.name}. Table ${value.name} may be its shadow table; its kind is unknown and row inspection is unavailable.`,
        );
      budget.retain(table);
      if (scope === "inventory") table.columns_completeness = "not_requested";
      if (listed.type === "virtual" && scope !== "inventory") {
        table.columns_completeness = "unsupported";
        limitations.push(
          `Virtual table column expansion is not performed: ${value.name}. Its complete stored CREATE statement is retained.`,
        );
      } else if (
        listed.type !== "virtual" &&
        (scope !== "inventory" || input.table === value.name)
      ) {
        const columns = readColumns(db, value.name, {
          budget: scope === "inventory" ? new OutputBudget() : budget,
          encoding,
          selectedColumns: scope === "inventory" ? input.columns : undefined,
        });
        if (input.table === value.name)
          selectedTable = { name: table.name, kind: table.kind, columns };
        if (scope !== "inventory") table.columns = columns;
      }
      if (input.table === value.name && selectedTable === undefined)
        selectedTable = {
          name: table.name,
          kind: table.kind,
          columns: table.columns,
        };
      schema.tables.push(table);
    } else if (value.type === "index") {
      const index = {
        name: value.name,
        table: value.tbl_name,
        ...(scope === "inventory" ? {} : { sql: value.sql }),
        root_page: value.rootpage,
      };
      budget.retain(index);
      schema.indexes.push(index);
    } else if (value.type === "view") {
      const view = {
        name: value.name,
        ...(scope === "inventory" ? {} : { sql: value.sql }),
      };
      budget.retain(view);
      schema.views.push(view);
    } else {
      const trigger = {
        name: value.name,
        table: triggerTable(value.tbl_name, parsed.tbl_name),
        ...(scope === "inventory" ? {} : { sql: value.sql }),
      };
      budget.retain(trigger);
      schema.triggers.push(trigger);
    }
  }
  return { schema, selectedTable };
};

/** Byte length of one cell's projected representation, without copying its value. */
const cellByteLength = (name: string): string => {
  const column = quoteIdentifier(name);
  return `CASE typeof(${column}) WHEN 'text' THEN length(CAST(${column} AS BLOB)) WHEN 'blob' THEN length(${column}) ELSE 0 END`;
};

/** Ordinary and stored generated columns, read without evaluating an expression; skips undecodable names. */
const storedColumnNames = (
  db: DatabaseSync,
  table: string,
  encoding: DatabaseEncoding,
): string[] => {
  const names: string[] = [];
  for (const raw of db
    .prepare(
      "SELECT CAST(name AS BLOB) AS name FROM temp.pragma_table_xinfo(?, 'main') WHERE hidden IN (0, 3) ORDER BY cid",
    )
    .iterate(table)) {
    const { name } = z.object({ name: z.instanceof(Uint8Array) }).parse(raw);
    try {
      names.push(decodeSchemaText(name, encoding, "column name"));
    } catch (cause: unknown) {
      // An unrelated malformed name cannot be selected exactly, so it is not recommended.
      if (!(cause instanceof SqliteInspectionFailure)) throw cause;
    }
  }
  return names;
};

/**
 * SQLite counts every projected expression, including repeated selections,
 * against this connection's result-column capacity and reports exhaustion as a
 * generic SQL error. The engine's own limit distinguishes that capacity refusal
 * from malformed or unreadable data.
 */
const resultColumnLimitFailure = (
  db: DatabaseSync,
  cause: unknown,
  selectedColumns: number,
): SqliteColumnLimitFailure | undefined => {
  if (sqlitePrimaryResultCode(cause) !== SQLITE_ERROR) return undefined;
  const engineColumnLimit = db.limits.column;
  if (
    !Number.isSafeInteger(engineColumnLimit) ||
    engineColumnLimit <= 0 ||
    selectedColumns <= engineColumnLimit
  )
    return undefined;
  return new SqliteColumnLimitFailure(
    `SQLite cannot return ${String(selectedColumns)} selected result columns; this connection permits at most ${String(engineColumnLimit)}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    selectedColumns,
    engineColumnLimit,
  );
};

/**
 * Attribute SQL failures to the row source before blaming selected generated
 * expressions. A generic SQL error alone does not establish file corruption.
 * Only columns whose sampled probes succeed are recommended for recovery.
 */
const rowEvaluationFailure = (
  db: DatabaseSync,
  cause: unknown,
  selection: {
    readonly table: SelectedTableFacts;
    readonly columns: readonly string[];
    readonly source: string;
    readonly limit: number;
    readonly encoding: DatabaseEncoding;
  },
): unknown => {
  const { table, columns, source, limit, encoding } = selection;
  const columnLimit = resultColumnLimitFailure(db, cause, columns.length);
  if (columnLimit !== undefined) return columnLimit;
  if (sqlitePrimaryResultCode(cause) !== SQLITE_ERROR) return cause;
  const unavailable = new SqliteInspectionFailure(
    "row-evaluation",
    `SQLite cannot prepare or evaluate rows of table ${JSON.stringify(table.name)} on REA's read-only connection: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  const generated = new Set(
    table.columns
      .filter((column) => column.hidden === 2)
      .map((column) => column.name),
  );
  if (!columns.some((name) => generated.has(name))) return unavailable;
  try {
    // A WITHOUT ROWID source may require an unavailable application collation
    // even for a constant projection. Do not attribute that failure to every
    // generated column or recommend other columns from the same unreadable source.
    db.prepare(`SELECT count(*) FROM (SELECT 1 FROM ${source} LIMIT ?)`).get(
      limit,
    );
  } catch (failure: unknown) {
    return sqlitePrimaryResultCode(failure) === SQLITE_ERROR
      ? unavailable
      : failure;
  }
  // The aggregate evaluates exactly the sampled cells, as the length pass does.
  const probe = (name: string): { readonly failure: unknown } | undefined => {
    try {
      db.prepare(
        `SELECT count(${cellByteLength(name)}) FROM (SELECT ${quoteIdentifier(name)} FROM ${source} LIMIT ?)`,
      ).get(limit);
      return undefined;
    } catch (failure: unknown) {
      return { failure };
    }
  };
  const failures = new Map<string, unknown>();
  for (const name of new Set(columns)) {
    const failed = probe(name);
    if (failed !== undefined) failures.set(name, failed.failure);
  }
  if (
    ![...failures].some(
      ([name, failure]) =>
        generated.has(name) &&
        sqlitePrimaryResultCode(failure) === SQLITE_ERROR,
    )
  )
    return unavailable;
  const remaining = columns.filter((name) => !failures.has(name));
  const readableStoredColumns = (): string[] => {
    try {
      return storedColumnNames(db, table.name, encoding).filter(
        (name) => !failures.has(name) && probe(name) === undefined,
      );
    } catch {
      // Discovery only refines recovery; it must not replace the attributed failure.
      return [];
    }
  };
  return new SqliteColumnEvaluationFailure(
    `SQLite cannot evaluate selected column(s) of table ${JSON.stringify(table.name)} on REA's read-only connection: ${[
      ...failures,
    ]
      .map(
        ([name, failure]) =>
          `${JSON.stringify(name)}: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
      .join("; ")}`,
    remaining.length > 0 ? remaining : readableStoredColumns(),
  );
};

const readRows = (
  db: DatabaseSync,
  input: InspectSqliteDatabaseInput,
  table: SelectedTableFacts | undefined,
  context: {
    readonly encoding: DatabaseEncoding;
    readonly budget: OutputBudget;
  },
): SqliteDatabase["rows"] => {
  const { encoding, budget } = context;
  if (input.table === undefined) return null;
  if (table === undefined) throw missingSelectedTable(input.table);
  if (table.kind === "unknown")
    throw new SqliteInspectionFailure(
      "selection",
      `SQLite cannot determine whether selected table ${input.table} is a shadow table of an unresolved virtual table. Row inspection requires a confirmed ordinary table.`,
    );
  if (table.kind !== "table")
    throw new SqliteInspectionFailure(
      "selection",
      `Rows from ${table.kind} table ${input.table} are outside the ordinary-table inspection profile.`,
    );
  const limit = input.row_limit ?? SQLITE_ROW_LIMIT_DEFAULT;
  const visibleColumns = table.columns
    .filter((column) => column.hidden !== 1)
    .map((column) => column.name);
  const columns = input.columns ?? visibleColumns;
  const available = new Set(visibleColumns);
  for (const name of columns)
    if (!available.has(name))
      throw new SqliteInspectionFailure(
        "column-selection",
        `Selected column does not exist with that exact name in table ${input.table}: ${name}`,
      );
  const projection = columns
    .map((name) => {
      const column = quoteIdentifier(name);
      return `CASE typeof(${column}) WHEN 'text' THEN 't' || hex(CAST(${column} AS BLOB)) WHEN 'blob' THEN 'b' || hex(${column}) ELSE ${column} END`;
    })
    .join(", ");
  const source = `main.${quoteIdentifier(input.table)} NOT INDEXED`;
  const rows: NonNullable<SqliteDatabase["rows"]> = {
    table: input.table,
    columns,
    values: [],
    row_limit: limit,
    returned_rows: 0,
    truncated: false,
    order: "unspecified",
  };
  // Keep query-source, expression, capacity and malformed-data failures distinct.
  try {
    const lengths = db.prepare(
      `SELECT ${columns.map(cellByteLength).join(", ")} FROM ${source} LIMIT ?`,
    );
    lengths.setReturnArrays(true);
    for (const raw of lengths.iterate(limit))
      budget.beforeProjection(cellByteLengths.parse(raw));
    const statement = db.prepare(`SELECT ${projection} FROM ${source} LIMIT ?`);
    statement.setReturnArrays(true);
    for (const raw of statement.iterate(limit)) {
      const rawRow = arrayRow.parse(raw);
      // Hex expansion already belongs to the retained-output budget, before decoding/copying cells.
      budget.beforeDecode(rawRow);
      const values = rawRow.map((value) => cell(value, encoding));
      budget.retain(values);
      rows.values.push(values);
    }
    rows.truncated =
      db.prepare(`SELECT 1 FROM ${source} LIMIT 1 OFFSET ?`).get(limit) !==
      undefined;
  } catch (cause: unknown) {
    throw rowEvaluationFailure(db, cause, {
      table,
      columns,
      source,
      limit,
      encoding,
    });
  }
  rows.returned_rows = rows.values.length;
  return rows;
};

/** Query only a provider-owned snapshot; no caller SQL, extensions, views or virtual rows. */
export const inspectSqliteDatabaseSnapshot = (
  snapshotPath: string,
  input: InspectSqliteDatabaseInput,
): Inspection => {
  const db = new DatabaseSync(snapshotPath, {
    readOnly: true,
    allowExtension: false,
    readBigInts: true,
    enableDoubleQuotedStringLiterals: false,
    timeout: 0,
    limits: {
      length: SQLITE_DATABASE_LIMITS.outputBytes,
      sqlLength: SQLITE_DATABASE_LIMITS.outputBytes,
    },
  });
  try {
    const limits: unknown = db.limits;
    const supported = z
      .object({
        length: z.int().positive().max(SQLITE_DATABASE_LIMITS.outputBytes),
        sqlLength: z.int().positive().max(SQLITE_DATABASE_LIMITS.outputBytes),
      })
      .safeParse(limits);
    if (!supported.success)
      throw new SqliteInspectionFailure(
        "unavailable",
        "SQLite inspection requires the native DatabaseSync.limits API to bound untrusted values and SQL. Use Node.js 24.15 or newer in the supported 24.x line, or a compatible Node.js 26+ runtime.",
      );
    db.exec(
      "PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA mmap_size=0; PRAGMA cell_size_check=ON; BEGIN;",
    );
    const version = z
      .object({ version: z.string() })
      .parse(db.prepare("SELECT sqlite_version() AS version").get()).version;
    const encoding = z
      .object({ encoding: encodingSchema })
      .parse(db.prepare("PRAGMA encoding").get()).encoding;
    const limitations = [
      "Inspects an offline stable file set. Filesystem identity checks detect observed acquisition changes; they do not establish an atomic snapshot of an actively changing database. Supply an application-created backup or quiescent database/WAL pair.",
      "The source database and WAL are never opened by SQLite or modified. A private copy may acquire its own WAL-index sidecar and is removed after inspection.",
      "SQLite reports current schema and selected committed rows from its valid database/WAL state. Deleted records, uncommitted or invalid WAL tails, encrypted databases, forensic recovery, and full integrity verification are outside this profile.",
      "Stored CREATE statements preserve index/view/trigger definitions. Views, triggers, and virtual/shadow table rows are not executed; virtual-table column expansion is unsupported.",
      "Selected rows have unspecified order and are a bounded sample. Text display may replace invalid sequences; bytes_hex and encoding preserve SQLite's text byte representation, not original on-disk page offsets.",
      "Resource boundaries: at most two concurrent inspections per provider; combined input 256 MiB per inspection, complete worker JSON 16 MiB, native SQLite value/record and SQL statement lengths 16 MiB, owned-worker JavaScript heap 256 MiB. The parent applies a separate supervised worker deadline, reported in worker_timeout_ms. These are distinct from total resident memory; an overall native SQLite heap cap is not claimed. Failures return no partial success.",
    ];
    const budget = new OutputBudget();
    const { schema, selectedTable } = readSchema(db, input, {
      budget,
      limitations,
      encoding,
    });
    return {
      engine: { name: "SQLite", version },
      database_encoding: encoding,
      schema,
      rows: readRows(db, input, selectedTable, { encoding, budget }),
      limitations,
    };
  } finally {
    db.close();
  }
};
