import { z } from "zod";
import { readRecordedResponseDeclaration } from "./recordedResponseBody.js";
import {
  parseRecordedTransportUrl,
  parseUrlQueryParameterNames,
} from "../recordedTransportUrl.js";

/** Exact segment formats shared by the api-surface and environment-manifest views. */
export const ROUTE_RULES = ["numeric", "uuid", "hex", "iso-date"] as const;
export type RouteRule = (typeof ROUTE_RULES)[number];

export interface RouteSegment {
  readonly segment_index: number;
  readonly rule: RouteRule;
  readonly value: string;
}

export interface RouteTemplate {
  readonly template: string;
  readonly rules: string;
  readonly segments: readonly RouteSegment[];
}

export type RequestLineExclusion =
  | "url-redacted"
  | "url-unparseable"
  | "request-unavailable"
  | "method-unavailable";

/** One retained request line, or the reason it cannot join a grouping view. */
export type RecordedRequestLine =
  | { readonly kind: "excluded"; readonly reason: RequestLineExclusion }
  | {
      readonly kind: "line";
      readonly method: string;
      readonly origin: string;
      readonly path: string;
      readonly query: string | undefined;
      readonly status: number | null;
      readonly rawMime: string;
    };

/** Temporary-byte reservation; false means the projection budget is exhausted. */
export type Reserve = (bytes: number) => boolean;

const requestSchema = z.object({
  request: z.object({ url: z.unknown(), method: z.unknown() }),
});
// Conservative representation allowances, not an enforced V8 heap limit.
// Fixed charges include the accumulator, bucket/set entries, array growth and
// page/schema projection. Text includes UTF-16 storage and two worst-case JSON
// encodings (transport text and UTF-8 bytes); no serialization is needed to count.
export const GROUP_BYTES = 2048;
export const SEGMENT_BYTES = 1024;
export const ENTRY_BYTES = 128;
export const RECORD_SCRATCH_BYTES = 512;
export const CAPTURE_CONTAINER_BYTES = 512;
const SEGMENT_SCRATCH_BYTES = 512;
export const textBytes = (length: number): number => 32 + length * 14;

/** Route parts of a template: one more than its separators. */
export const routePartCount = (template: string): number => {
  let count = 1;
  for (const character of template) if (character === "/") count += 1;
  return count;
};
/** The first exact format rule a recorded path segment satisfies, if any. */
export const segmentRule = (value: string): RouteRule | null => {
  if (/^[0-9]+$/u.test(value)) return "numeric";
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    return "uuid";
  if (/^[0-9a-f]{32,}$/iu.test(value)) return "hex";
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
      return "iso-date";
  }
  return null;
};

/** Scan literal spans; only matched segments need descriptors or template parts. */
export const scanRouteTemplate = (
  path: string,
  temporary: Reserve,
): RouteTemplate | null => {
  const segments: RouteSegment[] = [];
  const parts: string[] = [];
  const rules: string[] = [];
  let templateLength = path.length;
  let rulesLength = 0;
  let copied = 0;
  let index = 0;
  let start = 1;
  for (;;) {
    const slash = path.indexOf("/", start);
    const end = slash < 0 ? path.length : slash;
    const value = path.slice(start, end);
    const rule = segmentRule(value);
    if (rule !== null) {
      if (!temporary(SEGMENT_SCRATCH_BYTES)) return null;
      const placeholder = `{${rule}}`;
      const identity = `${index}:${rule};`;
      segments.push({ segment_index: index, rule, value });
      parts.push(path.slice(copied, start), placeholder);
      rules.push(identity);
      templateLength += placeholder.length - value.length;
      rulesLength += identity.length;
      copied = end;
    }
    if (slash < 0) break;
    start = slash + 1;
    index += 1;
  }
  if (segments.length === 0) return { template: path, rules: "", segments };
  if (!temporary(textBytes(templateLength) + textBytes(rulesLength)))
    return null;
  parts.push(path.slice(copied));
  return { template: parts.join(""), rules: rules.join(""), segments };
};

/** Read one record's request line, charging URL and MIME text before parsing them. */
export const readRecordedRequestLine = (
  reported: unknown,
  includeQuery: boolean,
  temporary: Reserve,
): RecordedRequestLine | null => {
  const excluded = (reason: RequestLineExclusion): RecordedRequestLine => ({
    kind: "excluded",
    reason,
  });
  const request = requestSchema.safeParse(reported);
  if (!request.success) return excluded("request-unavailable");
  const { url, method } = request.data.request;
  if (url === null) return excluded("url-redacted");
  if (typeof url !== "string") return excluded("url-unparseable");
  // Admission precedes URL parsing, text normalization and path materialization.
  if (!temporary(RECORD_SCRATCH_BYTES + textBytes(url.length))) return null;
  const parsed = parseRecordedTransportUrl(url, { includeQuery });
  if (parsed.origin === null) return excluded("url-unparseable");
  if (typeof method !== "string" || method.length === 0)
    return excluded("method-unavailable");
  if (parsed.path === null) return excluded("url-unparseable");
  const response = readRecordedResponseDeclaration(reported);
  const status = response?.status;
  const mime = response?.content?.mimeType;
  const rawMime = typeof mime === "string" ? mime : "";
  if (!temporary(textBytes(rawMime.length))) return null;
  return {
    kind: "line",
    method,
    origin: parsed.origin,
    path: parsed.path,
    query: parsed.query,
    status: typeof status === "number" && status !== 0 ? status : null,
    rawMime,
  };
};

/** Reserve form-parser scratch before decoding distinct query parameter names. */
export const readQueryParameterNames = (
  query: string | undefined,
  temporary: Reserve,
): ReadonlySet<string> | undefined | null => {
  if (query === undefined) return undefined;
  // Reserve form-parser tuples, decoded strings, the iterator and the name
  // set before URLSearchParams materializes them. Delimiter count is an upper
  // bound: empty query pairs are ignored by the WHATWG parser.
  let pairs = query.length > 1 ? 1 : 0;
  for (const character of query) if (character === "&") pairs += 1;
  if (
    !temporary(
      RECORD_SCRATCH_BYTES + textBytes(query.length) + pairs * ENTRY_BYTES * 4,
    )
  )
    return null;
  return new Set(parseUrlQueryParameterNames(query));
};
