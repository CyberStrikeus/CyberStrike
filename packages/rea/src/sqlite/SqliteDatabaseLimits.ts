/** Bound frozen input, retained JSON and worker allocation before parsing untrusted files. */
export const SQLITE_DATABASE_LIMITS = {
  concurrentInspections: 2,
  inputBytes: 256 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  diagnosticBytes: 1024 * 1024,
} as const;
/** Internal rejection retains the failed boundary without returning partial success. */
export class SqliteInspectionFailure extends Error {
  constructor(
    readonly reason:
      | "format"
      | "selection"
      | "column-selection"
      | "column-evaluation"
      | "row-evaluation"
      | "column-limit"
      | "unsupported"
      | "unavailable"
      | "output-limit"
      | "memory",
    message: string,
  ) {
    super(message);
  }
}
/** Selected generated cells the private connection cannot compute; the database stays readable. */
export class SqliteColumnEvaluationFailure extends SqliteInspectionFailure {
  constructor(
    message: string,
    /** Selected or stored columns that remain readable without the failed expressions. */
    readonly readableColumns: readonly string[],
  ) {
    super("column-evaluation", message);
  }
}
/** A projection above this connection's result-column capacity; the database stays readable. */
export class SqliteColumnLimitFailure extends SqliteInspectionFailure {
  constructor(
    message: string,
    readonly selectedColumns: number,
    readonly engineColumnLimit: number,
  ) {
    super("column-limit", message);
  }
}
/** SQLite's primary result code for a native node:sqlite failure, if it carries one. */
export const sqlitePrimaryResultCode = (cause: unknown): number | undefined =>
  cause instanceof Error &&
  "errcode" in cause &&
  typeof cause.errcode === "number"
    ? cause.errcode & 0xff
    : undefined;
