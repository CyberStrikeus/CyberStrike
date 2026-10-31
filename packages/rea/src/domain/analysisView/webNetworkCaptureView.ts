import {
  projectProtobufCapturePage,
  protobufViewRequestSchema,
} from "./protobufCaptureView.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AnalysisError } from "../analysisErrorBase.js";
import { parseAnalysisViewResult } from "./analysisViewParent.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import {
  webNetworkCaptureRecordSchema,
  webNetworkCaptureBinaryDescriptorSchema,
  safeParseOwnedWebNetworkCapture,
  webNetworkCaptureArtifactSchema,
  webNetworkCaptureDecoderSchema,
  protobufCaptureCoverageSchema,
  WEB_NETWORK_CAPTURE_FORMATS,
  type WebNetworkCaptureRecord,
  type WebNetworkCapture,
} from "../webNetworkCapture.js";
import type { AnalysisViewParent } from "./analysisViewParent.js";
import {
  assertOwnedView,
  type AdmittedView,
  type SummaryAnalysisView,
} from "./analysisViewShape.js";
import {
  completeWithinViewCoverage,
  pageViewCoverage,
} from "./analysisViewCoverage.js";
import {
  qlogSummarySchema,
  qlogViewRequestSchema,
  summarizeQlogCapture,
  projectQlogCapturePage,
} from "./qlogCaptureView.js";

/** Offsets page the parent's retained record order, preserving producer ordinals. */
export const captureViewRequestSchema = z.strictObject({
  kind: z.literal("capture"),
  detail: z.enum(["preview", "complete"]).default("preview"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
});

const protobufSummarySchema = z.strictObject({
  bodies: z.number().int().nonnegative(),
  frames: z.number().int().nonnegative(),
  fields: z.number().int().nonnegative(),
  incomplete_bodies: z.number().int().nonnegative(),
});
const summarizeProtobuf = (records: readonly WebNetworkCaptureRecord[]) => {
  const counts = { bodies: 0, frames: 0, fields: 0, incomplete_bodies: 0 };
  for (const record of records)
    for (const body of record.protobuf ?? []) {
      counts.bodies++;
      counts.frames += body.frames.length;
      counts.fields += body.fields.length;
      counts.incomplete_bodies += Number(body.status !== "complete");
    }
  return counts.bodies === 0 ? undefined : counts;
};
const previewSchema = webNetworkCaptureRecordSchema
  .omit({ protobuf: true })
  .extend({
    binary_fields: z.array(webNetworkCaptureBinaryDescriptorSchema),
    protobuf_summary: protobufSummarySchema.exactOptional(),
  });
export const captureViewItemsSchema = z.array(
  z.union([webNetworkCaptureRecordSchema, previewSchema]),
);

/** Count/identity overview; bodies and the archive member inventory stay in the parent. */
export const captureSummarySchema = z.strictObject({
  protobuf_coverage: protobufCaptureCoverageSchema.exactOptional(),
  artifact: webNetworkCaptureArtifactSchema,
  decoder: webNetworkCaptureDecoderSchema,
  format: z.enum(WEB_NETWORK_CAPTURE_FORMATS),
  total_records: z.int().nonnegative(),
  retained_records: z.int().nonnegative(),
  runtime_attribution: z.literal("unknown"),
  protobuf: protobufSummarySchema.exactOptional(),
  qlog: qlogSummarySchema.optional(),
});

const object = (
  value: JsonValue,
): Readonly<Record<string, JsonValue>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;

// Field names have different meanings across producers. In particular, HAR
// entry extensions named `name` or `type` are not qlog or mitmproxy headlines.
const RECORD_HEADLINES: Readonly<Record<string, readonly string[]>> = {
  har: ["time", "startedDateTime"],
  qlog: ["name", "time"],
  saz: ["session_id", "time"],
  mitmproxy: ["type"],
};
const HTTP_HEADLINES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  har: {
    request: ["method", "url", "httpVersion"],
    response: ["httpVersion", "status", "statusText"],
  },
  saz: {
    request: ["method", "url", "http_version"],
    response: ["http_version", "status", "reason"],
  },
  mitmproxy: {
    request: ["method", "http_version"],
    response: ["http_version", "reason"],
  },
};
const scalar = (value: JsonValue): boolean =>
  value === null || typeof value !== "object";
// Native mitmproxy flows report the request target in parts and the status
// as status_code. They are previewed only for mitmproxy records and only when
// each value has its field's well-formed shape, which also bounds the
// serialized size of every record (at most ~4 KiB for an escape-heavy path).
// The path must be origin or asterisk form without control characters and
// without any "@": native redaction misses absolute and ambiguous spellings,
// and URL parsing can fail before it recognises their userinfo, so a preview
// fails closed on the marker every userinfo needs. Host and authority never
// carry a userinfo marker either.
// Target fields come only from the request and the status only from the
// response, and integer slots require the producer's own integer type.
// Excluded values stay in complete record pages.
const MITMPROXY_HEADLINE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  request: ["scheme", "host", "port", "authority", "path"],
  response: ["status_code"],
};
const MITMPROXY_PATH_MAX_LENGTH = 2 * 1024;
const integerIn = (value: JsonValue, min: number, max: number): boolean =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
/** True when a code unit is C0, DEL or (optionally) a space. */
const hasControl = (value: string, includeSpace: boolean): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || (includeSpace && code === 0x20))
      return true;
  }
  return false;
};
// An unpaired surrogate has no UTF-8 form, so no producer reported it as text.
const LONE_SURROGATE = /\p{Cs}/u;
const hostLike = (value: JsonValue, maxLength: number): boolean =>
  typeof value === "string" &&
  value.length <= maxLength &&
  !hasControl(value, true) &&
  !/[@/\\]/u.test(value) &&
  !LONE_SURROGATE.test(value);
type NumericSidecar = WebNetworkCaptureRecord["numeric_literals"][number];
type BinaryField = WebNetworkCaptureRecord["binary_fields"][number];
const MITMPROXY_INTEGER_FIELDS = new Set(["port", "status_code"]);
/** Retained native producer bytes whose content, length and digest are all the text's UTF-8. */
const describesText = (descriptor: BinaryField, text: string): boolean => {
  if (
    descriptor.representation !== "producer-bytes" ||
    descriptor.state !== "retained"
  )
    return false;
  // An unpaired surrogate has no UTF-8 form; Buffer.from would invent
  // replacement-character bytes that no producer value could have had.
  const utf8 = Buffer.from(text, "utf8");
  return (
    utf8.toString("utf8") === text &&
    descriptor.bytes === utf8.length &&
    descriptor.content_base64 === utf8.toString("base64") &&
    descriptor.sha256 === createHash("sha256").update(utf8).digest("hex")
  );
};
/**
 * Integer slots need exactly one integer sidecar whose literal is the value's
 * canonical decimal, and no byte descriptor. String slots need no sidecar and
 * at most one byte descriptor, which must describe the value's own UTF-8.
 * Selecting a field also selects its sidecars, so this keeps every copied
 * literal small and consistent.
 */
const representationMatches = (
  field: string,
  value: JsonValue,
  sidecars: readonly NumericSidecar[],
  bytes: readonly BinaryField[],
): boolean => {
  if (MITMPROXY_INTEGER_FIELDS.has(field))
    return (
      bytes.length === 0 &&
      typeof value === "number" &&
      sidecars.length === 1 &&
      sidecars[0]?.producer_type === "integer" &&
      sidecars[0].literal === String(value)
    );
  if (sidecars.length !== 0 || bytes.length > 1) return false;
  const [descriptor] = bytes;
  return (
    descriptor === undefined ||
    (typeof value === "string" && describesText(descriptor, value))
  );
};
const headlineShape = (field: string, value: JsonValue): boolean => {
  switch (field) {
    case "scheme":
      return (
        typeof value === "string" &&
        /^[A-Za-z][A-Za-z0-9+.-]{0,31}$/u.test(value)
      );
    case "host":
      return hostLike(value, 255);
    case "authority":
      return hostLike(value, 262);
    case "port":
      return integerIn(value, 0, 65_535);
    case "status_code":
      return integerIn(value, 100, 999);
    case "path":
      return (
        typeof value === "string" &&
        value.length <= MITMPROXY_PATH_MAX_LENGTH &&
        !hasControl(value, false) &&
        !value.includes("@") &&
        !LONE_SURROGATE.test(value) &&
        (value === "*" ||
          (value.startsWith("/") &&
            !value.startsWith("//") &&
            !value.startsWith("/\\")))
      );
    default:
      return false;
  }
};
/** Strict ancestors of a JSON pointer, from the root down. */
const ancestorsOf = (pointer: string): string[] => {
  const ancestors: string[] = [];
  for (
    let at = pointer.indexOf("/");
    at !== -1;
    at = pointer.indexOf("/", at + 1)
  )
    ancestors.push(pointer.slice(0, at));
  return ancestors;
};
/** Add a pointer's strict ancestors, stopping at one already present (its own ancestors are too). */
const addAncestors = (pointer: string, into: Set<string>): void => {
  for (
    let at = pointer.lastIndexOf("/");
    at !== -1;
    at = at === 0 ? -1 : pointer.lastIndexOf("/", at - 1)
  ) {
    const ancestor = pointer.slice(0, at);
    if (into.has(ancestor)) return;
    into.add(ancestor);
  }
};
const groupByPointer = <T extends { readonly pointer: string }>(
  facets: readonly T[],
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const facet of facets) {
    const group = groups.get(facet.pointer);
    if (group === undefined) groups.set(facet.pointer, [facet]);
    else group.push(facet);
  }
  return groups;
};

/** A record's facet coordinates, indexed once for every headline check. */
type FacetIndex = {
  readonly sidecars: ReadonlyMap<string, readonly NumericSidecar[]>;
  readonly bytes: ReadonlyMap<string, readonly BinaryField[]>;
  /** The producer held a number or bytes here. */
  readonly scalars: ReadonlySet<string>;
  /** A facet lies beneath: the producer held a container here. */
  readonly containers: ReadonlySet<string>;
  /**
   * Withheld by a value redaction or a redacted byte descriptor; either facet
   * withholds the value even when the other one is missing.
   */
  readonly withheld: ReadonlySet<string>;
  /** The parent of an omitted property name; it hides no sibling values. */
  readonly omittedNames: ReadonlySet<string>;
};
const indexFacets = (record: WebNetworkCaptureRecord): FacetIndex => {
  const containers = new Set<string>();
  const withheld = new Set<string>();
  const omittedNames = new Set<string>();
  for (const { pointer } of record.numeric_literals)
    addAncestors(pointer, containers);
  for (const { pointer, state } of record.binary_fields) {
    addAncestors(pointer, containers);
    if (state === "redacted") withheld.add(pointer);
  }
  for (const redaction of record.redactions) {
    addAncestors(redaction.pointer, containers);
    ("scope" in redaction ? omittedNames : withheld).add(redaction.pointer);
  }
  const sidecars = groupByPointer(record.numeric_literals);
  const bytes = groupByPointer(record.binary_fields);
  return {
    sidecars,
    bytes,
    scalars: new Set([...sidecars.keys(), ...bytes.keys()]),
    containers,
    withheld,
    omittedNames,
  };
};
/**
 * A value the record marks as redacted, or that lies under a redacted value,
 * is never promoted even if it is still present (imported or caller-supplied
 * Evidence). A scalar is also inconsistent when a numeric sidecar or byte
 * descriptor sits on an ancestor (the producer held a scalar there) or any
 * facet sits beneath it (the producer held a container at it).
 */
const usableScalar = (index: FacetIndex, pointer: string): boolean => {
  const ancestors = ancestorsOf(pointer);
  return (
    !index.omittedNames.has(pointer) &&
    !index.containers.has(pointer) &&
    !index.withheld.has(pointer) &&
    !ancestors.some(
      (ancestor) => index.withheld.has(ancestor) || index.scalars.has(ancestor),
    )
  );
};
/**
 * The container format alone does not make a flow HTTP; its own type does,
 * when the producer supplied that type as text rather than a number or bytes.
 */
const textualFlowType = (index: FacetIndex): boolean =>
  usableScalar(index, "/type") && !index.scalars.has("/type");
/** Shape checks run first, so the representation check only sees bounded values. */
const mitmproxyHeadline = (
  index: FacetIndex,
  pointer: string,
  field: string,
  value: JsonValue,
): boolean =>
  usableScalar(index, pointer) &&
  headlineShape(field, value) &&
  representationMatches(
    field,
    value,
    index.sidecars.get(pointer) ?? [],
    index.bytes.get(pointer) ?? [],
  );

/** Copy one message side's headlines; mitmproxy fields need the record's facet index. */
const selectHeadlines = (
  fields: Readonly<Record<string, JsonValue>>,
  key: string,
  format: string,
  facets: FacetIndex | null,
  selectedPointers: Set<string>,
): Record<string, JsonValue> => {
  const selected: Record<string, JsonValue> = {};
  const candidates = [
    ...(HTTP_HEADLINES[format]?.[key] ?? []).map(
      (field) => [field, null] as const,
    ),
    ...(facets === null ? [] : (MITMPROXY_HEADLINE_FIELDS[key] ?? [])).map(
      (field) => [field, facets] as const,
    ),
  ];
  for (const [field, index] of candidates) {
    const value = fields[field];
    if (
      !Object.hasOwn(fields, field) ||
      value === undefined ||
      !scalar(value) ||
      (index !== null &&
        !mitmproxyHeadline(index, `/${key}/${field}`, field, value))
    )
      continue;
    selected[field] = value;
    selectedPointers.add(`/${key}/${field}`);
  }
  return selected;
};

/** Select already parsed producer facts without interpreting HTTP or payload bytes again. */
const preview = (record: WebNetworkCaptureRecord, format: string) => {
  const source = object(record.reported);
  const reported: Record<string, JsonValue> = {};
  const selectedPointers = new Set<string>();
  if (source !== null) {
    const index =
      format === "mitmproxy" && source.type === "http"
        ? indexFacets(record)
        : null;
    const mitmproxyFacets =
      index !== null && textualFlowType(index) ? index : null;
    for (const key of RECORD_HEADLINES[format] ?? [])
      if (
        Object.hasOwn(source, key) &&
        source[key] !== undefined &&
        scalar(source[key])
      ) {
        reported[key] = source[key];
        selectedPointers.add(`/${key}`);
      }
    for (const key of Object.keys(HTTP_HEADLINES[format] ?? {})) {
      const value = source[key];
      if (!Object.hasOwn(source, key) || value === undefined) continue;
      const fields = object(value);
      if (fields === null) {
        // Preserve a reported null/scalar instead of inventing HTTP fields.
        reported[key] = value;
        continue;
      }
      reported[key] = selectHeadlines(
        fields,
        key,
        format,
        mitmproxyFacets,
        selectedPointers,
      );
    }
  }
  const { protobuf: _protobuf, ...sourceRecord } = record;
  const protobufSummary = summarizeProtobuf([record]);
  return {
    ...sourceRecord,
    ...(protobufSummary === undefined
      ? {}
      : { protobuf_summary: protobufSummary }),
    reported: source === null ? record.reported : reported,
    binary_fields: record.binary_fields.map(
      ({ content_base64: _content, ...field }) => field,
    ),
    numeric_literals:
      source === null
        ? record.numeric_literals
        : record.numeric_literals.filter(({ pointer }) =>
            selectedPointers.has(pointer),
          ),
  };
};

const captureParser = { safeParse: safeParseOwnedWebNetworkCapture };

/** Authenticate the retained report and its subject at one owning boundary. */
const parseCaptureParent = (
  parent: AnalysisViewParent,
): Result<WebNetworkCapture, AnalysisError> => {
  const parsed = parseAnalysisViewResult(captureParser, parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const subject = parent.subject;
  if (
    report.artifact.sha256 !== null &&
    (subject == null || subject.digest.sha256 !== report.artifact.sha256)
  )
    return err(
      analysisViewInputError([
        {
          path: ["source", "subject"],
          reason: "invalid_value",
          message: "Capture parent subject must identify the report's SHA-256.",
        },
      ]),
    );
  return ok(report);
};

/** Page immutable retained facts; no capture file, provider or network is consulted. */
export const projectWebNetworkCaptureView = (
  parent: AnalysisViewParent,
  view: AdmittedView,
) => {
  if (
    view.kind !== "summary" &&
    view.kind !== "capture" &&
    view.kind !== "protobuf" &&
    view.kind !== "qlog"
  )
    return err(
      analysisViewInputError([
        {
          path: ["view"],
          reason: "invalid_value",
          message:
            "Historical captures support summary, capture record pages, qlog fact pages and admitted api-surface, environment-manifest, environment-state or environment-coverage views.",
        },
      ]),
    );
  assertOwnedView<
    | SummaryAnalysisView
    | z.output<typeof captureViewRequestSchema>
    | z.output<typeof protobufViewRequestSchema>
    | z.output<typeof qlogViewRequestSchema>
  >(view, "summary", "capture", "protobuf", "qlog");
  const parsed = parseCaptureParent(parent);
  if (!parsed.ok) return parsed;
  const report = parsed.value;
  const shared = {
    parent_evidence_id: parent.evidenceId,
    parent_operation: "inspect_web_network_capture" as const,
    parent_digest: parent.evidenceId.slice(3),
    artifact: { path: report.artifact.path, sha256: report.artifact.sha256 },
    limitations: [
      ...new Set([
        ...parent.limitations,
        ...report.limitations,
        "Capture record pages cover the records selected into the parent Evidence, in that selected order; total_records counts the original decoded capture.",
      ]),
    ],
    unknowns: [
      "Historical records do not establish live runtime attribution or deployment authenticity.",
      ...(report.artifact.sha256 === null
        ? ["The explicitly excluded artifact digest remains unknown."]
        : []),
    ],
  };
  if (view.kind === "protobuf")
    return ok({
      ...shared,
      ...projectProtobufCapturePage(report, view),
      unknowns: [
        ...shared.unknowns,
        "Decoding covers selected retained bodies only. Exhausting wire fields does not establish schema completeness or business meaning; compressed bodies and unsupported schema facets remain unknown.",
      ],
    });
  if (view.kind === "summary")
    return ok({
      kind: "summary" as const,
      view,
      ...shared,
      summary: {
        artifact: report.artifact,
        decoder: report.decoder,
        format: report.format,
        total_records: report.total_records,
        retained_records: report.records.length,
        runtime_attribution: report.runtime_attribution,
        ...(report.protobuf_coverage === undefined
          ? {}
          : { protobuf_coverage: report.protobuf_coverage }),
        ...(summarizeProtobuf(report.records) === undefined
          ? {}
          : { protobuf: summarizeProtobuf(report.records)! }),
        ...(report.format === "qlog"
          ? { qlog: summarizeQlogCapture(report.qlog) }
          : {}),
      },
      coverage: completeWithinViewCoverage(
        report.records.length,
        report.records.length,
      ),
    });
  if (view.kind === "qlog") {
    if (report.format !== "qlog")
      return err(
        analysisViewInputError([
          {
            path: ["view", "kind"],
            reason: "invalid_value",
            message: "Qlog fact views require retained qlog Evidence.",
          },
        ]),
      );
    const projected = projectQlogCapturePage(report.qlog, view);
    return projected.ok
      ? ok({
          kind: "qlog" as const,
          view,
          ...shared,
          ...projected.value,
          limitations: [
            ...shared.limitations,
            "Qlog fact pages retain all-recorded-events-before-selection scope. Exhausting a page does not establish network completeness, body recovery, retransmission or actual loss.",
          ],
        })
      : projected;
  }
  const records = report.records.slice(view.offset, view.offset + view.limit);
  return ok({
    kind: "capture" as const,
    view,
    ...shared,
    items: captureViewItemsSchema.parse(
      view.detail === "complete"
        ? records
        : records.map((record) => preview(record, report.format)),
    ),
    coverage: pageViewCoverage(
      view.offset,
      records.length,
      report.records.length,
    ),
    limitations: [
      ...shared.limitations,
      ...(view.detail === "preview"
        ? [
            "Preview selects recorded headline fields and byte descriptors; headers, XML, bodies, message data and other fields remain in complete record pages. Missing preview fields do not establish their absence from the producer record.",
          ]
        : []),
    ],
  });
};
