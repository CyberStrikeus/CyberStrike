import { mediaTypeEssence } from "./recordedMediaType.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import { ok, type Result } from "../result.js";
import {
  WEB_NETWORK_CAPTURE_LIMITS,
  type WebNetworkCaptureRecord,
} from "../webNetworkCapture.js";
import { pageViewCoverage } from "./analysisViewCoverage.js";
import { z } from "zod";
import { apiSurfaceFields } from "./apiSurfaceSchema.js";
import { WebNetworkProjectionAccumulator } from "./WebNetworkProjectionAccumulator.js";
import {
  CAPTURE_CONTAINER_BYTES,
  ENTRY_BYTES,
  GROUP_BYTES,
  RECORD_SCRATCH_BYTES,
  SEGMENT_BYTES,
  readQueryParameterNames,
  readRecordedRequestLine,
  scanRouteTemplate,
  textBytes,
  type RouteRule,
  type RouteTemplate,
} from "./webNetworkRouteTemplates.js";

type ApiSurfaceFields = {
  [Key in keyof typeof apiSurfaceFields]: z.output<
    (typeof apiSurfaceFields)[Key]
  >;
};
type Group = ApiSurfaceFields["groups"][number];
type Exclusion = ApiSurfaceFields["excluded_records"][number];
interface GroupState {
  readonly method: string;
  readonly origin: string;
  readonly path_template: string;
  readonly segments: readonly {
    readonly segment_index: number;
    readonly rule: RouteRule;
    readonly values: Set<string>;
  }[];
  readonly ordinals: number[];
  readonly statuses: Set<number>;
  readonly contentTypes: Set<string>;
  readonly queryNames?: Map<string, number[]>;
}
type Buckets = Map<string, Map<string, Map<string, Map<string, GroupState>>>>;

/** Own group identity, deduplication and admission for the entire projection. */
export class WebNetworkApiSurfaceAccumulator extends WebNetworkProjectionAccumulator {
  readonly #buckets: Buckets = new Map();
  readonly #groups: GroupState[] = [];
  readonly #excluded: Exclusion[] = [];
  #unavailableResponse = false;

  constructor(
    maximumBytes = WEB_NETWORK_CAPTURE_LIMITS.outputBytes,
    readonly includeQueryParameterNames = false,
  ) {
    super(maximumBytes, "API-surface");
  }

  #exclude(
    ordinal: number,
    reason: Exclusion["reason"],
  ): Result<void, AnalysisError> {
    if (!this.retain(ENTRY_BYTES + RECORD_SCRATCH_BYTES))
      return this.overBudget();
    this.#excluded.push({ ordinal, reason });
    return ok(undefined);
  }

  add(record: WebNetworkCaptureRecord): Result<void, AnalysisError> {
    const limitations = this.addLimitations(record.limitations);
    if (!limitations.ok) return limitations;
    try {
      const line = readRecordedRequestLine(
        record.reported,
        this.includeQueryParameterNames,
        this.scratch,
      );
      if (line === null) return this.overBudget();
      if (line.kind === "excluded")
        return this.#exclude(record.ordinal, line.reason);
      const route = scanRouteTemplate(line.path, this.scratch);
      if (route === null) return this.overBudget();
      const queryNames = readQueryParameterNames(line.query, this.scratch);
      if (queryNames === null) return this.overBudget();
      return this.#append(
        record.ordinal,
        line.method,
        line.origin,
        route,
        line.status,
        mediaTypeEssence(line.rawMime),
        queryNames,
      );
    } finally {
      this.releaseTemporary();
    }
  }

  #append(
    ordinal: number,
    method: string,
    origin: string,
    route: RouteTemplate,
    status: number | null,
    mime: string | null,
    queryNames: ReadonlySet<string> | undefined,
  ): Result<void, AnalysisError> {
    let group = this.#buckets
      .get(method)
      ?.get(origin)
      ?.get(route.template)
      ?.get(route.rules);
    let bytes = ENTRY_BYTES; // One retained record ordinal, including page output.
    if (group === undefined) {
      bytes +=
        GROUP_BYTES +
        textBytes(method.length) +
        textBytes(origin.length) +
        textBytes(route.template.length) +
        textBytes(route.rules.length);
      for (const segment of route.segments)
        bytes += SEGMENT_BYTES + ENTRY_BYTES + textBytes(segment.value.length);
    } else {
      for (const [index, segment] of route.segments.entries()) {
        if (!group.segments[index]!.values.has(segment.value))
          bytes += ENTRY_BYTES + textBytes(segment.value.length);
      }
    }
    if (status !== null && !group?.statuses.has(status)) bytes += ENTRY_BYTES;
    if (mime !== null && !group?.contentTypes.has(mime))
      bytes += ENTRY_BYTES + textBytes(mime.length);
    if (queryNames !== undefined) {
      if (group === undefined) bytes += CAPTURE_CONTAINER_BYTES;
      for (const name of queryNames) {
        bytes += ENTRY_BYTES; // This name's source ordinal, once per record.
        if (!group?.queryNames?.has(name))
          bytes += ENTRY_BYTES + textBytes(name.length);
      }
    }
    // Reserve the whole mutation while route scratch is still live. No sets,
    // map entries, arrays or new observed values are retained before admission.
    if (!this.retain(bytes)) return this.overBudget();
    if (group === undefined) {
      group = {
        method,
        origin,
        path_template: route.template,
        segments: route.segments.map((segment) => ({
          segment_index: segment.segment_index,
          rule: segment.rule,
          values: new Set([segment.value]),
        })),
        ordinals: [],
        statuses: new Set(),
        contentTypes: new Set(),
        ...(queryNames === undefined ? {} : { queryNames: new Map() }),
      };
      const byOrigin = this.#buckets.get(method) ?? new Map();
      this.#buckets.set(method, byOrigin);
      const byTemplate = byOrigin.get(origin) ?? new Map();
      byOrigin.set(origin, byTemplate);
      const byRule = byTemplate.get(route.template) ?? new Map();
      byTemplate.set(route.template, byRule);
      byRule.set(route.rules, group);
      this.#groups.push(group);
    } else {
      for (const [index, segment] of route.segments.entries())
        group.segments[index]!.values.add(segment.value);
    }
    group.ordinals.push(ordinal);
    if (status === null || mime === null) this.#unavailableResponse = true;
    if (status !== null) group.statuses.add(status);
    if (mime !== null) group.contentTypes.add(mime);
    if (queryNames !== undefined && group.queryNames !== undefined) {
      for (const name of queryNames) {
        const ordinals = group.queryNames.get(name);
        if (ordinals === undefined) group.queryNames.set(name, [ordinal]);
        else ordinals.push(ordinal);
      }
    }
    return ok(undefined);
  }

  page(offset: number, limit: number) {
    this.#groups.sort(
      (a, b) =>
        compare(a.origin, b.origin) ||
        compare(a.path_template, b.path_template) ||
        compare(a.method, b.method),
    );
    const groups = this.#groups
      .slice(offset, offset + limit)
      .map((group): Group => ({
        method: group.method,
        origin: group.origin,
        path_template: group.path_template,
        templated_segments: group.segments.map((segment) => ({
          segment_index: segment.segment_index,
          rule: segment.rule,
          basis: "inferred",
          observed_values: [...segment.values].sort(compare),
        })),
        record_ordinals: [...group.ordinals],
        statuses: [...group.statuses].sort((a, b) => a - b),
        content_types: [...group.contentTypes].sort(compare),
        ...(group.queryNames === undefined
          ? {}
          : {
              query_parameter_names: [...group.queryNames]
                .sort(([a], [b]) => compare(a, b))
                .map(([name, record_ordinals]) => ({
                  name,
                  record_ordinals: [...record_ordinals],
                })),
            }),
        flags: [
          ...(group.ordinals.length === 1 ? ["single-sample" as const] : []),
          ...(group.statuses.size > 1 ? ["mixed-statuses" as const] : []),
          ...(group.contentTypes.size > 1
            ? ["mixed-content-types" as const]
            : []),
        ],
      }));
    return {
      coverage: pageViewCoverage(offset, groups.length, this.#groups.length),
      groups,
      templated_groups: this.#groups.reduce(
        (count, group) => count + (group.segments.length > 0 ? 1 : 0),
        0,
      ),
      excluded_records: [...this.#excluded],
      limitations: this.sortedLimitations(),
      unknowns: this.#unavailableResponse
        ? [
            "Some retained records have unavailable status or content type values.",
          ]
        : [],
    };
  }
}
