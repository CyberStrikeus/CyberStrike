import { join } from "node:path";
import { ok, err, type Result } from "../domain/result.js";

import {
  AGGREGATE_STRINGS_XML_MAX_BYTES,
  MAX_AGGREGATE_STRINGS,
  MAX_STRINGS,
  androidLocaleDirectorySuffix,
  type ApktoolRequest,
  type StringTable,
} from "../domain/apktool/apktoolResourceAnalysis.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import {
  parseDecodedStrings,
  type DecodedStringEntry,
} from "./ApktoolDecodeOutput.js";
import type { ApktoolWorkspace } from "./ApktoolWorkspace.js";

const STRINGS_XML_MAX_BYTES = 8 * 1024 * 1024;
type Selection = Pick<
  Extract<ApktoolRequest, { operation: "decode_android_resources" }>["input"],
  "include_strings" | "locale" | "locales" | "string_tables_only"
>;
type PresentTable = {
  readonly status: "present";
  readonly entries: readonly DecodedStringEntry[];
  readonly totalCount: number;
  readonly unparsedCount: number;
};
type UnavailableTable =
  | {
      readonly status: "missing";
      readonly totalCount: 0;
      readonly unparsedCount: 0;
    }
  | {
      readonly status: "oversized";
      readonly totalCount: null;
      readonly unparsedCount: null;
      readonly byteBudget: number;
    }
  | {
      readonly status: "malformed";
      readonly totalCount: null;
      readonly unparsedCount: null;
      readonly message: string;
    };
type PhysicalTable = PresentTable | UnavailableTable;

/** One physical read owns parsed counts independently of output allocation. */
const readTable = async (
  resources: Pick<ApktoolWorkspace, "readText">,
  path: string,
  budget: number,
  signal?: AbortSignal,
): Promise<{ readonly fact: PhysicalTable; readonly bytes: number }> => {
  const source = await resources.readText(path, budget, signal);
  if (source.text === null)
    return {
      bytes: 0,
      fact: { status: "missing", totalCount: 0, unparsedCount: 0 },
    };
  if (source.truncated)
    return {
      bytes: source.sourceBytes,
      fact: {
        status: "oversized",
        totalCount: null,
        unparsedCount: null,
        byteBudget: budget,
      },
    };
  const bytes = source.sourceBytes;
  const parsed = parseDecodedStrings(source.text);
  if (!parsed.ok)
    return {
      bytes,
      fact: {
        status: "malformed",
        totalCount: null,
        unparsedCount: null,
        message: parsed.error.message,
      },
    };
  return {
    bytes,
    fact: {
      status: "present",
      // Future aliases need counts and at most one table's output, not every
      // parsed entry. The complete source was examined before this retention cut.
      entries: parsed.value.entries.slice(0, MAX_STRINGS),
      totalCount: parsed.value.entries.length,
      unparsedCount: parsed.value.unparsedCount,
    },
  };
};

const unavailableTableLimitation = (
  fact: UnavailableTable,
  directory: string,
  locale: string | null,
  input: Selection,
): string => {
  if (fact.status === "missing")
    return locale === null
      ? "No default res/values/strings.xml was found in the decoded workspace"
      : `No strings.xml was found for locale ${locale}`;
  if (fact.status === "oversized")
    return input.locales === undefined || locale === null
      ? `strings.xml exceeds the ${String(fact.byteBudget)}-byte projection budget`
      : `strings.xml for locale ${locale} exceeds the ${String(fact.byteBudget)}-byte projection budget`;
  return `String table ${JSON.stringify(`res/${directory}/strings.xml`)} could not be projected: ${fact.message}; entry counts are unknown`;
};

export interface ApktoolStringProjection {
  readonly strings: readonly DecodedStringEntry[];
  readonly tables: readonly StringTable[];
  readonly limitations: readonly string[];
  readonly coverage: "complete" | "partial";
}

/** Project caller labels from shared physical facts for both request shapes. */
export const projectApktoolStringTables = async (
  resources: Pick<ApktoolWorkspace, "readText">,
  workspace: string,
  input: Selection,
  signal?: AbortSignal,
): Promise<
  Result<
    ApktoolStringProjection,
    { readonly cause: unknown; readonly partial: ApktoolStringProjection }
  >
> => {
  if (!input.include_strings)
    return ok({
      strings: [],
      tables: [],
      limitations: [],
      coverage: "complete",
    });
  const primary = input.locale ?? null;
  const locales = [...new Set([primary, ...(input.locales ?? [])])];
  const physical = new Map<string, PhysicalTable>();
  const tables: StringTable[] = [];
  const limitations = new Set<string>();
  let xmlBytes = 0;
  let outputEntries = 0;
  let aggregateCapped = false;
  const projection = (): ApktoolStringProjection => {
    if (aggregateCapped)
      limitations.add(
        "Aggregate string table projection stopped due to resource limits",
      );
    return {
      strings:
        input.string_tables_only === true ? [] : (tables[0]?.strings ?? []),
      tables,
      limitations: [...limitations],
      coverage: tables.some((table) => table.coverage === "partial")
        ? "partial"
        : "complete",
    };
  };
  let pendingIndex = 0;
  try {
    for (const [index, locale] of locales.entries()) {
      pendingIndex = index;
      if (signal?.aborted)
        throw new AnalysisCancelledError("decode_android_resources", {
          cause: signal.reason,
        });
      const directory =
        locale === null
          ? "values"
          : `values-${androidLocaleDirectorySuffix(locale)}`;
      const label =
        locale === null
          ? "default res/values/strings.xml"
          : `res/${directory}/strings.xml`;
      let fact = physical.get(directory);
      if (fact === undefined) {
        const budget = Math.min(
          STRINGS_XML_MAX_BYTES,
          AGGREGATE_STRINGS_XML_MAX_BYTES - xmlBytes,
        );
        if (budget <= 0 || outputEntries >= MAX_AGGREGATE_STRINGS) {
          tables.push({
            locale,
            status: "skipped",
            strings: [],
            total_count: null,
            unparsed_count: null,
            coverage: "partial",
          });
          limitations.add(
            `Projection for ${label} skipped: aggregate resource limit reached`,
          );
          aggregateCapped = true;
          continue;
        }
        const read = await readTable(
          resources,
          join(workspace, "res", directory, "strings.xml"),
          budget,
          signal,
        );
        fact = read.fact;
        xmlBytes += read.bytes;
        if (fact.status === "oversized" && budget < STRINGS_XML_MAX_BYTES)
          aggregateCapped = true;
        physical.set(directory, fact);
      }
      if (fact.status !== "present") {
        tables.push({
          locale,
          status: fact.status,
          strings: [],
          total_count: fact.totalCount,
          unparsed_count: fact.unparsedCount,
          coverage: fact.status === "missing" ? "complete" : "partial",
        });
        limitations.add(
          unavailableTableLimitation(fact, directory, locale, input),
        );
        continue;
      }
      // The default batch shape repeats primary entries in strings and tables;
      // table-only output charges one copy. Account before selecting entries.
      const copies =
        index === 0 &&
        input.locales !== undefined &&
        input.string_tables_only !== true
          ? 2
          : 1;
      const remaining = Math.max(0, MAX_AGGREGATE_STRINGS - outputEntries);
      const selected = fact.entries.slice(0, Math.floor(remaining / copies));
      outputEntries += selected.length * copies;
      const skipped = selected.length === 0 && fact.totalCount > 0;
      const limited = selected.length < Math.min(fact.totalCount, MAX_STRINGS);
      if (limited) aggregateCapped = true;
      tables.push({
        locale,
        status: skipped ? "skipped" : "present",
        strings: selected,
        // Output exhaustion cannot erase counts from an already examined table.
        total_count: fact.totalCount,
        unparsed_count: fact.unparsedCount,
        coverage:
          selected.length < fact.totalCount || fact.unparsedCount > 0
            ? "partial"
            : "complete",
      });
      if (skipped)
        limitations.add(
          `Projection for ${label} skipped: aggregate resource limit reached`,
        );
      if (fact.unparsedCount > 0)
        limitations.add(
          input.locales === undefined || locale === null
            ? `String entries omitted due to unsupported markup or missing names: ${String(fact.unparsedCount)}`
            : `String entries omitted in locale ${locale} due to unsupported markup or missing names: ${String(fact.unparsedCount)}`,
        );
      if (limited && !skipped)
        limitations.add(
          `Locale ${locale ?? "default"} strings reports ${String(selected.length)} entries due to aggregate strings limit`,
        );
      else if (fact.totalCount > MAX_STRINGS && !skipped)
        limitations.add(
          input.locales === undefined || locale === null
            ? `strings reports the first ${String(selected.length)} of ${String(fact.totalCount)} entries`
            : `Locale ${locale} strings reports the first ${String(selected.length)} of ${String(fact.totalCount)} entries`,
        );
    }
  } catch (cause) {
    limitations.add(
      `String projection stopped at locale ${JSON.stringify(locales[pendingIndex])}; this selection and ${String(locales.length - pendingIndex - 1)} remaining selections were not projected`,
    );
    return err({ cause, partial: { ...projection(), coverage: "partial" } });
  }
  return ok(projection());
};
