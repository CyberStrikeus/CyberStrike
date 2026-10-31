import {
  observeBrowserUrl,
  type BrowserUrlObservation,
  type SanitizedBrowserUrl,
} from "../domain/browserObservation.js";
import { z } from "zod";
import { err, ok, type Result } from "../domain/result.js";
import {
  cdpStringValue,
  numberValue,
  recordValue,
  type UnknownRecord,
} from "./CdpCaptureValues.js";

const integer = z.int().min(0);
/** Active runtime admission remains stricter than passive request observations. */
export const runtimeRequestSchema = z.object({
  requestId: z.string().min(1),
  frameId: z.string().optional(),
  timestamp: z.number().min(0),
  request: z.object({ url: z.string(), method: z.string() }),
  initiator: z
    .object({
      type: z.string(),
      stack: z.unknown().optional(),
      url: z.string().optional(),
      lineNumber: integer.optional(),
      columnNumber: integer.optional(),
    })
    .passthrough(),
});

/** A CDP Response occurs in both responseReceived and redirect continuation events. */
export interface CdpResponseFacts {
  readonly source: UnknownRecord;
  readonly url: BrowserUrlObservation | undefined;
  readonly status: Result<
    number | null,
    { readonly _tag: "InvalidCdpResponseStatus" }
  >;
  readonly mimeType: string | undefined;
  readonly encodedDataLength: number | undefined;
  readonly headers: unknown;
}
export const readCdpResponseFacts = (
  reported: unknown,
): CdpResponseFacts | undefined => {
  const source = recordValue(reported);
  if (source === undefined) return undefined;
  const url = cdpStringValue(source.url);
  return {
    source,
    url: url === undefined ? undefined : observeBrowserUrl(url),
    status: readResponseStatus(source.status),
    mimeType: cdpStringValue(source.mimeType),
    encodedDataLength: numberValue(source.encodedDataLength),
    headers: source.headers,
  };
};

/** Omission is unknown; a supplied non-number is a protocol failure. */
const readResponseStatus = (value: unknown): CdpResponseFacts["status"] => {
  if (value === undefined) return ok(null);
  const status = numberValue(value);
  return status === undefined
    ? err({ _tag: "InvalidCdpResponseStatus" })
    : ok(status);
};

type ScopedCdpResponse =
  | {
      readonly scope: "approved";
      readonly url: SanitizedBrowserUrl;
      readonly response: CdpResponseFacts;
    }
  | { readonly scope: "outside_policy"; readonly reason: "disallowed_origin" }
  | { readonly scope: "unsupported"; readonly reason: "unsupported_url" }
  | {
      readonly scope: null;
      readonly reason: "invalid_protocol_value" | "unattributed_origin";
    };

/** Apply caller origin policy to producer-owned URL syntax, without reparsing it. */
export const scopeCdpResponse = (
  response: CdpResponseFacts | undefined,
  allowedOrigins: ReadonlySet<string>,
  missingUrlReason:
    | "invalid_protocol_value"
    | "unattributed_origin" = "invalid_protocol_value",
): ScopedCdpResponse => {
  if (response === undefined)
    return { scope: null, reason: "invalid_protocol_value" };
  const url = response.url;
  if (url === undefined || url.source === "")
    return { scope: null, reason: missingUrlReason };
  if (url.kind === "malformed")
    return { scope: null, reason: "invalid_protocol_value" };
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { scope: "unsupported", reason: "unsupported_url" };
  if (
    url.sanitized.origin === null ||
    !allowedOrigins.has(url.sanitized.origin)
  )
    return { scope: "outside_policy", reason: "disallowed_origin" };
  return { scope: "approved", url: url.sanitized, response };
};

const requestIdentity = (source: UnknownRecord | undefined): string | null => {
  const id = cdpStringValue(source?.requestId);
  return id === undefined || id === "" ? null : id;
};
export interface CdpRequestWillBeSentFacts {
  readonly source: UnknownRecord | undefined;
  readonly requestId: string | null;
  readonly frameId: string | undefined;
  readonly loaderId: string | undefined;
  readonly resourceType: string | undefined;
  readonly timestamp: number | undefined;
  readonly request:
    | {
        readonly source: UnknownRecord;
        readonly url: string | undefined;
        readonly method: string | undefined;
      }
    | undefined;
  readonly initiator:
    | {
        readonly source: UnknownRecord;
        readonly type: string | undefined;
      }
    | undefined;
  readonly redirect:
    | { readonly kind: "missing" }
    | { readonly kind: "malformed" }
    | { readonly kind: "response"; readonly response: CdpResponseFacts };
}

/** Borrow raw declarations while parsing each shared field once, before consumer policy. */
export const readCdpRequestWillBeSent = (
  reported: unknown,
): CdpRequestWillBeSentFacts => {
  const source = recordValue(reported);
  const request = recordValue(source?.request);
  const initiator = recordValue(source?.initiator);
  const response = readCdpResponseFacts(source?.redirectResponse);
  return {
    source,
    requestId: requestIdentity(source),
    frameId: cdpStringValue(source?.frameId),
    loaderId: cdpStringValue(source?.loaderId),
    resourceType: cdpStringValue(source?.type),
    timestamp: numberValue(source?.timestamp),
    request:
      request === undefined
        ? undefined
        : {
            source: request,
            url: cdpStringValue(request.url),
            method: cdpStringValue(request.method),
          },
    initiator:
      initiator === undefined
        ? undefined
        : { source: initiator, type: cdpStringValue(initiator.type) },
    redirect:
      source === undefined || !Object.hasOwn(source, "redirectResponse")
        ? { kind: "missing" }
        : response === undefined
          ? { kind: "malformed" }
          : { kind: "response", response },
  };
};

export const readCdpResponseReceived = (reported: unknown) => {
  const source = recordValue(reported);
  return {
    source,
    requestId: requestIdentity(source),
    response: readCdpResponseFacts(source?.response),
  };
};
export const readCdpLoadingFinished = (reported: unknown) => {
  const source = recordValue(reported);
  return {
    source,
    requestId: requestIdentity(source),
    timestamp: numberValue(source?.timestamp),
    encodedDataLength: numberValue(source?.encodedDataLength),
  };
};
export const readCdpLoadingFailed = (reported: unknown) => {
  const source = recordValue(reported);
  return {
    source,
    requestId: requestIdentity(source),
    timestamp: numberValue(source?.timestamp),
    errorText: source?.errorText,
  };
};
