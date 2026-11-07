import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { getHeapStatistics } from "node:v8";

import { getManyValues, isMany, none, type Many } from "stream-chain/defs.js";
import * as streamJsonParser from "stream-json/core/parser.js";
import type { ParserOptions, Token } from "stream-json/core/parser.js";
import type { z } from "zod";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import { KunaDocumentError } from "./KunaDocumentError.js";
import { kunaAddressFromJsonNumber } from "./KunaJson.js";

/**
 * stream-json 3's synchronous tokenizer behind `parser`, which its
 * declarations omit. Each call returns the tokens `text` completes; `none`
 * flushes the end of input.
 */
const { jsonParser } = streamJsonParser as unknown as {
  readonly jsonParser: (
    options: ParserOptions,
  ) => (text: string | typeof none) => Many<Token> | typeof none;
};

/** One array of flat row objects in a Kuna JSON document. */
export interface KunaJsonRows {
  /** Scalar fields kept from each row; other fields are skipped unassembled. */
  readonly fields: ReadonlySet<string>;
  /** Kept numeric u64 fields, read from their exact tokens as hex, or null. */
  readonly addresses: ReadonlySet<string>;
  /** Array fields that must be empty, kept as `[]`. */
  readonly empty: ReadonlySet<string>;
  /** Fields that must be null, rejected before any other value is assembled. */
  readonly nulls: ReadonlySet<string>;
}

/** The members of one Kuna JSON document that a reader interprets. */
export interface KunaJsonDocument {
  /** Root scalar members kept in the header. */
  readonly header: ReadonlySet<string>;
  /** Root object members whose listed scalar fields are kept in the header. */
  readonly sections: ReadonlyMap<string, ReadonlySet<string>>;
  /** Root array members of rows, each passed to `acceptRow`. */
  readonly rows: ReadonlyMap<string, KunaJsonRows>;
}

/** What the document established once Kuna stopped writing. */
export interface KunaJsonCompletion {
  readonly header: Readonly<Record<string, unknown>>;
  readonly sha256: string;
  readonly bytes: number;
}

type Frame =
  | { readonly kind: "root"; readonly values: Record<string, unknown> }
  | {
      readonly kind: "section";
      readonly name: string;
      readonly fields: ReadonlySet<string>;
      readonly values: Record<string, unknown>;
    }
  | {
      readonly kind: "rows";
      readonly name: string;
      readonly spec: KunaJsonRows;
    }
  | {
      readonly kind: "row";
      readonly member: string;
      readonly spec: KunaJsonRows;
      readonly values: Record<string, unknown>;
    }
  | { readonly kind: "empty"; readonly field: string };

/** Charge for one retained row beyond its UTF-16 text. */
const ROW_OVERHEAD_BYTES = 256;
/** Projected retention admitted between heap samples. */
const ADMISSION_INTERVAL_BYTES = 64 * 1024;
/** Per-row reserve for the owner's arrays, sorting and projections. */
const ROW_REFERENCE_BYTES = 16;

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Longest key or kept number assembled. Kuna's field names and u64 decimals
 * are far shorter, so a longer key names no kept field and a longer kept
 * number is not one Kuna writes.
 */
const MAX_TOKEN_CODE_UNITS = 64;

/** Parse one row with its schema, naming the first field that is not Kuna's. */
export const parseKunaRow = <Schema extends z.ZodType>(
  schema: Schema,
  member: string,
  fields: unknown,
): z.infer<Schema> => {
  const parsed = schema.safeParse(fields);
  if (parsed.success) return parsed.data;
  throw new KunaDocumentError("row_field", {
    member,
    field: parsed.error.issues[0]?.path.join(".") ?? "",
  });
};

/** V8 copies shorter substrings instead of slicing them. */
const SLICED_STRING_MIN_LENGTH = 13;

/**
 * Copy kept text out of the decoded chunk the tokenizer sliced it from, so a
 * retained row does not keep that whole chunk alive. UTF-16 code units copy
 * losslessly, including lone surrogates.
 */
const detached = (text: string): string =>
  text.length < SLICED_STRING_MIN_LENGTH
    ? text
    : Buffer.from(text, "utf16le").toString("utf16le");

/**
 * Validate a Kuna JSON document as Kuna writes it, without buffering it.
 *
 * Every scalar arrives in chunks and is assembled only as far as it can
 * matter: keys up to the longest field name, kept numbers up to the longest
 * u64, and kept strings, which can carry target-derived text of any length,
 * admitted against live heap headroom as they grow, as are retained rows.
 * Ignored values are dropped unassembled. The first contradiction aborts
 * `rejected`, letting the owner stop Kuna early. The writable side never
 * fails, so the command's own outcome stays authoritative; `complete` reports
 * what the document established.
 */
export abstract class KunaJsonDocumentReader<Parsed> extends Writable {
  readonly #hash = createHash("sha256");
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #tokens = jsonParser({
    packKeys: false,
    packNumbers: false,
    packStrings: false,
    streamValues: true,
  });
  readonly #rejection = new AbortController();
  readonly #frames: Frame[] = [];
  readonly #rowsSeen = new Set<string>();
  #header: Record<string, unknown> = {};
  #bytes = 0;
  #failure: AnalysisError | undefined;
  #closed = false;
  #key: string | undefined;
  /** Containers still open inside an ignored value. */
  #skipping = 0;
  /** Key the scalar being read is kept under; undefined discards it. */
  #target: string | undefined;
  /** Whether `#target` holds a numeric u64 address. */
  #targetIsAddress = false;
  /** Whether the scalar being assembled is a key. */
  #inKey = false;
  /** The key or kept scalar assembled so far. */
  #text = "";
  #rows = 0;
  #projectedBytes = 0;
  #nextAdmission = 0;

  constructor(
    private readonly producer: string,
    private readonly label: string,
    private readonly document: KunaJsonDocument,
  ) {
    super();
  }

  /** Validate and retain one row; throw to reject the document. */
  protected abstract acceptRow(
    member: string,
    row: Readonly<Record<string, unknown>>,
  ): void;

  /** Release retained rows once the document is rejected. */
  protected abstract discardRows(): void;

  /** The validated document, once Kuna has exited successfully on `input`. */
  abstract finish(input: string): Result<Parsed, AnalysisError>;

  /** Aborted at the first contradiction or refused retention. */
  get rejected(): AbortSignal {
    return this.#rejection.signal;
  }

  /** Why `rejected` aborted, if it has. */
  get rejection(): AnalysisError | undefined {
    return this.#rejection.signal.aborted ? this.#failure : undefined;
  }

  /** An output error naming this document. */
  protected unusable(reason: string): AnalysisOutputError {
    return new AnalysisOutputError(this.producer, reason, {
      userMessage: `${this.label} cannot be used: ${reason}`,
    });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.#failure === undefined)
      try {
        this.#bytes += chunk.byteLength;
        this.#hash.update(chunk);
        this.#feed(this.#decoder.decode(chunk, { stream: true }));
      } catch (cause: unknown) {
        this.#reject(cause);
        this.#rejection.abort();
      }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    // Kuna has stopped writing, so an incomplete document is recorded for
    // `complete` without signalling: its exit status may explain it.
    if (this.#failure === undefined)
      try {
        this.#feed(this.#decoder.decode());
        this.#feed(none);
      } catch (cause: unknown) {
        this.#reject(cause);
      }
    callback();
  }

  /** The kept header and source identity, once Kuna has exited successfully. */
  protected complete(): Result<KunaJsonCompletion, AnalysisError> {
    if (this.#failure !== undefined) return err(this.#failure);
    if (
      !this.writableFinished ||
      !this.#closed ||
      [...this.document.rows.keys()].some((name) => !this.#rowsSeen.has(name))
    )
      return err(this.unusable(`${this.label} ended before it was complete`));
    return ok({
      header: this.#header,
      sha256: this.#hash.digest("hex"),
      bytes: this.#bytes,
    });
  }

  #reject(cause: unknown): void {
    this.#failure ??=
      cause instanceof AnalysisResourceConstraintError
        ? cause
        : cause instanceof KunaDocumentError
          ? new AnalysisOutputError(this.producer, cause.code, {
              cause,
              diagnostics: { code: cause.code, ...cause.detail },
              userMessage: `${this.label} cannot be used`,
            })
          : this.unusable(describe(cause));
    this.#text = "";
    this.#inKey = false;
    this.#header = {};
    this.discardRows();
  }

  #feed(text: string | typeof none): void {
    const tokens = this.#tokens(text);
    if (isMany(tokens))
      for (const token of getManyValues(tokens)) this.#consume(token);
  }

  /** Consume a token inside an ignored value; false once none is open. */
  #skip(token: Token): boolean {
    if (this.#skipping === 0) return false;
    if (token.name === "startObject" || token.name === "startArray")
      this.#skipping += 1;
    else if (token.name === "endObject" || token.name === "endArray")
      this.#skipping -= 1;
    return true;
  }

  #consume(token: Token): void {
    if (this.#skip(token) || this.#assemble(token)) return;
    switch (token.name) {
      case "startKey":
        this.#inKey = true;
        return;
      case "endKey":
        this.#key = this.#text;
        this.#text = "";
        this.#inKey = false;
        return;
      case "startString":
        this.#aim("string");
        return;
      case "endString":
        if (this.#target !== undefined)
          this.#store(detached(this.#text), "string");
        this.#text = "";
        return;
      case "startNumber":
        this.#aim("number");
        return;
      case "endNumber":
        this.#store(this.#text, "number");
        this.#text = "";
        return;
      case "nullValue":
        this.#aim("null");
        this.#store(null, "literal");
        return;
      case "trueValue":
      case "falseValue":
        this.#aim("boolean");
        this.#store(token.value, "literal");
        return;
      case "startObject":
      case "startArray":
        this.#open(token.name === "startObject" ? "object" : "array");
        return;
      case "endObject":
      case "endArray":
        this.#close();
        return;
      default:
        throw new KunaDocumentError("unexpected_token", { token: token.name });
    }
  }

  /** Append a scalar fragment within its bound; false for other tokens. */
  #assemble(token: Token): boolean {
    if (token.name !== "stringChunk" && token.name !== "numberChunk")
      return false;
    const chunk = token.value;
    if (this.#inKey) {
      // A key longer than every kept field name is truncated unmatched.
      if (this.#text.length <= MAX_TOKEN_CODE_UNITS)
        this.#text += chunk.slice(
          0,
          MAX_TOKEN_CODE_UNITS + 1 - this.#text.length,
        );
    } else if (this.#target !== undefined) {
      this.#text += chunk;
      if (token.name === "stringChunk")
        this.#charge(chunk.length * 2, this.#text.length);
      else if (this.#text.length > MAX_TOKEN_CODE_UNITS)
        throw new KunaDocumentError("not_kuna_number", {
          field: this.#target,
        });
    }
    return true;
  }

  /** Decide where a scalar value goes, before any of it is assembled. */
  #aim(kind: "string" | "number" | "null" | "boolean"): void {
    const frame = this.#frames.at(-1);
    const key = this.#key!;
    this.#key = undefined;
    this.#targetIsAddress = false;
    if (frame === undefined) throw new KunaDocumentError("not_json_object");
    switch (frame.kind) {
      case "root":
        if (this.document.rows.has(key) || this.document.sections.has(key))
          throw new KunaDocumentError("member_not_container", { field: key });
        this.#target = this.#kept(frame.values, key, this.document.header);
        return;
      case "section":
        this.#target = this.#kept(frame.values, key, frame.fields);
        return;
      case "rows":
        throw new KunaDocumentError("row_not_object", { member: frame.name });
      case "row":
        if (frame.spec.empty.has(key))
          throw new KunaDocumentError("row_not_array", {
            member: frame.member,
            field: key,
          });
        if (frame.spec.nulls.has(key)) {
          if (kind !== "null")
            throw new KunaDocumentError("row_must_be_null", {
              member: frame.member,
              field: key,
            });
          this.#target = this.#kept(frame.values, key, frame.spec.nulls);
          return;
        }
        if (frame.spec.addresses.has(key)) {
          if (kind !== "number" && kind !== "null")
            throw new KunaDocumentError("invalid_address", { field: key });
          this.#target = this.#kept(frame.values, key, frame.spec.addresses);
          this.#targetIsAddress = kind === "number";
          return;
        }
        this.#target = this.#kept(frame.values, key, frame.spec.fields);
        return;
      case "empty":
        throw new KunaDocumentError("field_must_be_empty", {
          field: frame.field,
        });
    }
  }

  /** The key a kept field is stored under, or undefined to discard it. */
  #kept(
    values: Record<string, unknown>,
    key: string,
    fields: ReadonlySet<string>,
  ): string | undefined {
    if (!fields.has(key)) return undefined;
    this.#claim(values, key);
    return key;
  }

  #claim(values: Record<string, unknown>, key: string): void {
    if (Object.hasOwn(values, key))
      throw new KunaDocumentError("repeated_field", { field: key });
  }

  #store(
    value: string | boolean | null,
    kind: "string" | "number" | "literal",
  ): void {
    const key = this.#target;
    if (key === undefined) return;
    this.#target = undefined;
    this.#values()[key] = this.#targetIsAddress
      ? kunaAddressFromJsonNumber(value as string, key)
      : kind === "number"
        ? Number(value)
        : value;
  }

  #values(): Record<string, unknown> {
    const frame = this.#frames.at(-1);
    if (frame === undefined || frame.kind === "rows" || frame.kind === "empty")
      throw new KunaDocumentError("value_without_member");
    return frame.values;
  }

  /** Open a root member: rows, a section, or a value this reader skips. */
  #openMember(
    kind: "object" | "array",
    key: string,
    root: Record<string, unknown>,
  ): void {
    const rows = this.document.rows.get(key);
    const section = this.document.sections.get(key);
    if (rows !== undefined) {
      if (kind !== "array" || this.#rowsSeen.has(key))
        throw new KunaDocumentError("rows_not_array", { field: key });
      this.#frames.push({ kind: "rows", name: key, spec: rows });
    } else if (section !== undefined) {
      if (kind !== "object")
        throw new KunaDocumentError("not_object", { field: key });
      this.#claim(root, key);
      const values: Record<string, unknown> = {};
      root[key] = values;
      this.#frames.push({
        kind: "section",
        name: key,
        fields: section,
        values,
      });
    } else if (this.document.header.has(key))
      throw new KunaDocumentError("not_scalar", { field: key });
    else this.#skipping = 1;
  }

  #open(kind: "object" | "array"): void {
    const frame = this.#frames.at(-1);
    const key = this.#key;
    this.#key = undefined;
    if (frame === undefined) {
      if (kind !== "object" || this.#closed)
        throw new KunaDocumentError("not_json_object");
      this.#frames.push({ kind: "root", values: this.#header });
      return;
    }
    switch (frame.kind) {
      case "root":
        this.#openMember(kind, key!, frame.values);
        return;
      case "rows":
        if (kind !== "object")
          throw new KunaDocumentError("row_not_object", { member: frame.name });
        this.#frames.push({
          kind: "row",
          member: frame.name,
          spec: frame.spec,
          values: {},
        });
        return;
      case "row":
        if (frame.spec.empty.has(key!)) {
          if (kind !== "array")
            throw new KunaDocumentError("row_not_array", {
              member: frame.member,
              field: key!,
            });
          this.#claim(frame.values, key!);
          this.#frames.push({ kind: "empty", field: key! });
        } else if (
          frame.spec.fields.has(key!) ||
          frame.spec.addresses.has(key!) ||
          frame.spec.nulls.has(key!)
        )
          throw new KunaDocumentError("not_scalar", {
            field: `${frame.member}.${key!}`,
          });
        else this.#skipping = 1;
        return;
      case "section":
        if (frame.fields.has(key!))
          throw new KunaDocumentError("not_scalar", {
            field: `${frame.name}.${key!}`,
          });
        this.#skipping = 1;
        return;
      case "empty":
        throw new KunaDocumentError("field_must_be_empty", {
          field: frame.field,
        });
    }
  }

  #close(): void {
    const frame = this.#frames.pop();
    switch (frame?.kind) {
      case "root":
        this.#closed = true;
        return;
      case "rows":
        this.#rowsSeen.add(frame.name);
        return;
      case "row":
        this.#rows += 1;
        this.#charge(ROW_OVERHEAD_BYTES, 0);
        this.acceptRow(frame.member, frame.values);
        return;
      case "empty": {
        const row = this.#frames.at(-1);
        if (row?.kind === "row") row.values[frame.field] = [];
        return;
      }
      default:
        return;
    }
  }

  /** Admit growth against live headroom rather than a fixed document size. */
  #charge(bytes: number, assemblingCodeUnits: number): void {
    this.#projectedBytes += bytes;
    if (this.#projectedBytes < this.#nextAdmission) return;
    const heap = getHeapStatistics();
    // Reserve the next interval, the owner's per-row references, and a flat
    // copy of the string still being assembled.
    const requiredBytes =
      ADMISSION_INTERVAL_BYTES +
      this.#rows * ROW_REFERENCE_BYTES +
      assemblingCodeUnits * 2;
    if (requiredBytes > heap.total_available_size)
      throw new AnalysisResourceConstraintError(
        this.producer,
        "memory",
        `Insufficient heap headroom to retain more of ${this.label} after ${String(this.#rows)} rows`,
        {
          retained_rows: this.#rows,
          projected_retained_bytes: this.#projectedBytes,
          required_headroom_bytes: requiredBytes,
          available_heap_bytes: heap.total_available_size,
          heap_size_limit_bytes: heap.heap_size_limit,
        },
        {
          remediationAction:
            "Close other targets in this REA process, or start REA with a larger Node.js heap (--max-old-space-size), then reopen the target.",
        },
      );
    this.#nextAdmission = this.#projectedBytes + ADMISSION_INTERVAL_BYTES;
  }
}
