import { z } from "zod";
import { basename } from "node:path";
import { isIP } from "node:net";

import {
  isJsonLike,
  mediaTypeEssence,
} from "../../domain/analysisView/recordedMediaType.js";
import {
  decodeRetainedBase64,
  readRecordedResponseBody,
  type RecordedResponseBody,
} from "../../domain/analysisView/recordedResponseBody.js";
import { scenarioContentMediaType } from "../../domain/analysisView/scenarioCaptureRecords.js";
import type { BrowserScenarioEvent } from "../../domain/browserScenarioCaptureValues.js";
import type { EnvironmentBuildReport } from "../../domain/environmentBundleExport.js";
import {
  iterateUrlQueryParameters,
  parseRecordedTransportUrl,
} from "../../domain/recordedTransportUrl.js";
import type { WebNetworkCaptureRecord } from "../../domain/webNetworkCapture.js";

/** A note the build report carries; warnings never change what is built. */
export type EnvironmentBuildWarning =
  EnvironmentBuildReport["warnings"][number];

/** Whole name segments that name credentials; `author` is not `auth`. */
const CREDENTIAL_SEGMENTS = new Set([
  "accesstoken",
  "apikey",
  "apikeys",
  "apitoken",
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "jwt",
  "passphrase",
  "passwd",
  "password",
  "privatekey",
  "pwd",
  "secret",
  "secrets",
  "session",
  "sessionid",
  "token",
  "tokens",
]);
const CREDENTIAL_PAIRS = new Set([
  "access key",
  "api key",
  "api keys",
  "client secret",
  "private key",
  "session id",
  "ssh key",
]);

/** Split a member name into lowercase segments at case changes and separators. */
const nameSegments = (name: string): string[] =>
  name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((segment) => segment.length > 0);

/** Whether a member, header or query name looks like it holds a credential. */
export const credentialNamed = (name: string): boolean => {
  const segments = nameSegments(name);
  return segments.some(
    (segment, index) =>
      CREDENTIAL_SEGMENTS.has(segment) ||
      (index > 0 && CREDENTIAL_PAIRS.has(`${segments[index - 1]} ${segment}`)),
  );
};

/** Bodies larger than this are not scanned. */
const SCAN_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
/** Pointers the report lists; the count covers every match. */
const REPORTED_POINTERS = 20;

const pointerToken = (name: string): string =>
  name.replaceAll("~", "~0").replaceAll("/", "~1");

/** A held value: a non-empty string, or an array holding one. */
const holdsValue = (value: unknown): boolean =>
  (typeof value === "string" && value !== "") ||
  (Array.isArray(value) &&
    value.some((item) => typeof item === "string" && item !== ""));

const member = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null
    ? Reflect.get(value, name)
    : undefined;

/** A recorded body: a JSON value to walk, form fields in order with every occurrence kept, as headers and query strings are, or text too large to scan. */
type ScannedBody =
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "form"; readonly fields: readonly [string, string][] }
  | { readonly kind: "skipped" };

const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

/** The parser a recorded media type names; otherwise JSON by its first character, or a form when it has `=` and no whitespace, which form encoding never leaves raw. */
const bodyFormat = (
  text: string,
  mediaType: unknown,
): "json" | "form" | undefined => {
  const essence =
    typeof mediaType === "string" ? mediaTypeEssence(mediaType) : null;
  if (essence === FORM_MEDIA_TYPE) return "form";
  if (isJsonLike(essence)) return "json";
  const start = text.trimStart()[0];
  if (start === "{" || start === "[") return "json";
  return text.includes("=") && !/\s/u.test(text) ? "form" : undefined;
};

/** A recorded body as JSON or form fields, skipped when it is cut or over the limit, or undefined when it is neither. */
const parsedBody = (
  text: unknown,
  mediaType: unknown,
  cut = false,
): ScannedBody | undefined => {
  if (typeof text !== "string") return undefined;
  if (cut || Buffer.byteLength(text, "utf8") > SCAN_BODY_LIMIT_BYTES)
    return { kind: "skipped" };
  const format = bodyFormat(text, mediaType);
  if (format === "form")
    return { kind: "form", fields: [...new URLSearchParams(text)] };
  if (format === undefined) return undefined;
  try {
    return { kind: "json", value: JSON.parse(text) };
  } catch {
    return undefined;
  }
};

/** Decoded body text as the scan reads it; binary bytes hold no JSON or form text. */
const decodedBody = (
  body: RecordedResponseBody,
  mediaType: unknown,
): ScannedBody | undefined =>
  body.bodyEncoding === "base64"
    ? undefined
    : parsedBody(body.bodyText, mediaType, body.bodyCut === true);

/** Name/value pairs such as HAR headers and query strings. */
const namedValues = (value: unknown): (readonly [string, unknown])[] =>
  Array.isArray(value)
    ? value.flatMap((entry: unknown) => {
        const name = member(entry, "name");
        return typeof name === "string"
          ? [[name, member(entry, "value")] as const]
          : [];
      })
    : [];

/** A count of matches and the first of their pointers. */
interface ScanTally {
  count: number;
  readonly pointers: string[];
}

type CredentialScan = Readonly<ScanTally> & {
  readonly skipped: Readonly<ScanTally>;
};

const tallied = (tally: ScanTally, pointer: string): void => {
  tally.count++;
  if (tally.pointers.length < REPORTED_POINTERS) tally.pointers.push(pointer);
};

/**
 * The tallies both capture readers fill: a named value counts when its name
 * looks like a credential and it holds a value. The body walk keeps its own
 * stack, so nesting depth cannot overflow it.
 */
const credentialTally = () => {
  const matches: ScanTally = { count: 0, pointers: [] };
  const skipped: ScanTally = { count: 0, pointers: [] };
  const field = (pointer: string, name: string, value: unknown): void => {
    if (credentialNamed(name) && holdsValue(value)) tallied(matches, pointer);
  };
  const walk = (root: unknown, label: string): void => {
    const stack: [unknown, string][] = [[root, ""]];
    while (stack.length > 0) {
      const [value, pointer] = stack.pop()!;
      if (typeof value !== "object" || value === null) continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--)
          stack.push([value[index], `${pointer}/${String(index)}`]);
        continue;
      }
      const entries = Object.entries(value);
      for (let index = entries.length - 1; index >= 0; index--) {
        const [name, child] = entries[index]!;
        const path = `${pointer}/${pointerToken(name)}`;
        field(`${label} ${path}`, name, child);
        stack.push([child, path]);
      }
    }
  };
  const body = (scanned: ScannedBody | undefined, label: string): void => {
    if (scanned?.kind === "skipped") tallied(skipped, label);
    else if (scanned?.kind === "json") walk(scanned.value, label);
    else if (scanned?.kind === "form")
      for (const [name, value] of scanned.fields)
        field(`${label} /${pointerToken(name)}`, name, value);
  };
  return {
    field,
    body,
    result: (): CredentialScan => ({ ...matches, skipped }),
  };
};

/**
 * Credential-named members that hold a value in recorded JSON and form
 * bodies, headers and query strings: a count and the first pointers, never
 * values, and the bodies too large to scan by record and side.
 */
export const scanCredentialNames = (
  records: readonly WebNetworkCaptureRecord[],
): CredentialScan => {
  const scan = credentialTally();
  for (const record of records) {
    const ordinal = String(record.ordinal);
    const request = member(record.reported, "request");
    const response = member(record.reported, "response");
    for (const [side, message] of [
      ["request", request],
      ["response", response],
    ] as const)
      for (const [name, value] of namedValues(member(message, "headers")))
        scan.field(`record ${ordinal} ${side} header ${name}`, name, value);
    for (const [name, value] of namedValues(member(request, "queryString")))
      scan.field(`record ${ordinal} request query ${name}`, name, value);
    const postData = member(request, "postData");
    const text = member(postData, "text");
    // A HAR may record form fields only as structured params; each occurrence counts, as in a form body.
    scan.body(
      typeof text !== "string"
        ? {
            kind: "form",
            fields: namedValues(member(postData, "params")).flatMap(
              ([name, value]) =>
                typeof value === "string"
                  ? [[name, value] as [string, string]]
                  : [],
            ),
          }
        : parsedBody(text, member(postData, "mimeType")),
      `record ${ordinal} request`,
    );
    scan.body(
      decodedBody(
        readRecordedResponseBody(record, SCAN_BODY_LIMIT_BYTES),
        member(member(response, "content"), "mimeType"),
      ),
      `record ${ordinal} response`,
    );
  }
  return scan.result();
};

/**
 * The same scan over a browser scenario's retained events, by index in
 * `events.items`: every network-content event's headers and body, whether or
 * not a record represents its transaction, and each transaction URL's query
 * once.
 */
export const scanScenarioCredentialNames = (
  events: readonly BrowserScenarioEvent[],
): CredentialScan => {
  const scan = credentialTally();
  const urls = new Set<string>();
  for (const [index, event] of events.entries()) {
    const label = `event ${String(index)}`;
    if (event.kind === "network-content") {
      const side = `${label} ${event.phase}`;
      if (event.headers.state === "captured")
        for (const { name, value } of event.headers.items)
          scan.field(`${side} header ${name}`, name, value);
      if (event.body.state === "captured")
        scan.body(
          decodedBody(
            decodeRetainedBase64(event.body.content, SCAN_BODY_LIMIT_BYTES),
            scenarioContentMediaType(event),
          ),
          side,
        );
    } else if ("transaction_id" in event) {
      // Every event of a transaction repeats its URL; a response attached mid-flight may be the only one.
      const key = `${event.transaction_id} ${event.url.url}`;
      if (urls.has(key)) continue;
      urls.add(key);
      const { query } = parseRecordedTransportUrl(event.url.url, {
        includeQuery: true,
      });
      for (const [name, value] of iterateUrlQueryParameters(query ?? ""))
        scan.field(`${label} ${event.kind} query ${name}`, name, value);
    }
  }
  return scan.result();
};

/** The credential-name scan's warnings: what it found, and the bodies it could not scan. */
export const credentialScanWarnings = (capture: {
  readonly records: readonly WebNetworkCaptureRecord[];
  readonly scenarioEvents: readonly BrowserScenarioEvent[] | null;
}): EnvironmentBuildWarning[] => {
  const scanned =
    capture.scenarioEvents === null
      ? scanCredentialNames(capture.records)
      : scanScenarioCredentialNames(capture.scenarioEvents);
  const warnings: EnvironmentBuildWarning[] = [];
  if (scanned.count > 0)
    warnings.push({
      code: "credential-named-members",
      message: `${String(scanned.count)} recorded body members have credential-like names and a value; evidence.json ships them, so review it before sharing.`,
      pointers: scanned.pointers,
    });
  if (scanned.skipped.count > 0)
    warnings.push({
      code: "credential-scan-incomplete",
      message: `${String(scanned.skipped.count)} recorded bodies exceed the credential-name scan's 4 MiB limit and were not scanned; evidence.json ships them, so review them before sharing.`,
      pointers: scanned.skipped.pointers,
    });
  return warnings;
};

const savedEntries = z.array(
  z.object({ name: z.string(), secret: z.boolean().optional() }),
);
const scenarioSaves = z.object({
  actions: z.array(
    z
      .object({
        save: savedEntries.optional(),
        save_response: z.object({ save: savedEntries }).optional(),
      })
      .loose(),
  ),
});

/** A browser scenario's saved values named like credentials but not marked secret, which the capture records unredacted. */
export const savedCredentialWarnings = (
  parameters: unknown,
): EnvironmentBuildWarning[] => {
  const parsed = scenarioSaves.safeParse(parameters);
  if (!parsed.success) return [];
  const pointers: string[] = [];
  parsed.data.actions.forEach((action, index) => {
    const unmarked = (
      entries:
        | readonly {
            readonly name: string;
            readonly secret?: boolean | undefined;
          }[]
        | undefined,
      at: string,
    ) =>
      entries?.forEach((entry, position) => {
        if (entry.secret !== true && credentialNamed(entry.name))
          pointers.push(
            `/parameters/actions/${String(index)}/${at}/${String(position)}`,
          );
      });
    unmarked(action.save, "save");
    unmarked(action.save_response?.save, "save_response/save");
  });
  return pointers.length === 0
    ? []
    : [
        {
          code: "credential-named-saved-values",
          message: `${String(pointers.length)} saved values have credential-like names but are not marked secret, so the capture records them unredacted; mark them \`secret: true\` and record again before sharing.`,
          pointers: pointers.slice(0, REPORTED_POINTERS),
        },
      ];
};

/** Whether an origin's host is a loopback name or an IP literal, which says nothing about the application. */
export const anonymousOrigin = (origin: string): boolean => {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bracketless = host.startsWith("[") ? host.slice(1, -1) : host;
  const bare = bracketless.endsWith(".")
    ? bracketless.slice(0, -1)
    : bracketless;
  return (
    bare === "localhost" || bare.endsWith(".localhost") || isIP(bare) !== 0
  );
};

/** A kebab-case name from a capture file's name: `grafana.har` and `grafana.capture.json` become `grafana`. */
export const nameFromCaptureFile = (path: string): string =>
  basename(path)
    .replace(/\.(?:har|json)$/iu, "")
    .replace(/\.capture$/iu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
