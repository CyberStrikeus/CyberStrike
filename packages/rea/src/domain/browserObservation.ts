import { z } from "zod";

import { webRuntimeCommandTimeoutSchema } from "./browserDeadline.js";
import { urlDeclaresQueryOrFragment } from "./urlComponents.js";
import {
  parseRecordedTransportUrl,
  parseUrlQueryParameterNames,
} from "./recordedTransportUrl.js";

const parseExactOrigin = (value: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    // Invalid input is represented by the undefined return.
    void cause;
    return undefined;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname.includes("*") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    urlDeclaresQueryOrFragment(url)
  )
    return undefined;
  return url.origin;
};

/** Exact normalized HTTP(S) authority used for browser observation scope. */
export const browserOriginSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const origin = parseExactOrigin(value);
    if (origin === undefined) {
      context.addIssue({
        code: "custom",
        message: "Expected one exact HTTP(S) origin without a path or wildcard",
      });
      return z.NEVER;
    }
    return origin;
  });

/** Already-normalized HTTP(S) origin retained in provider output. */
export const recordedBrowserOriginSchema = z
  .string()
  .superRefine((value, context) => {
    const parsed = browserOriginSchema.safeParse(value);
    if (parsed.success && parsed.data === value) return;
    context.addIssue({
      code: "custom",
      message: "Expected one canonical HTTP(S) origin",
    });
  });

/** Recognize the URL API's bracketed IPv6 form and normalized bare literals. */
export const isLiteralLoopbackHostname = (hostname: string): boolean =>
  hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

const HTTP_ENDPOINT_MESSAGE =
  "CDP endpoint must be an explicit-port HTTP URL on 127.0.0.1 or ::1";
const BROWSER_SOCKET_PATH = "/devtools/browser/";
const REDACTED_BROWSER_SOCKET_PATH = `${BROWSER_SOCKET_PATH}[REDACTED]`;

/** Retain an explicit default port, which URL.port and URL.origin erase. */
const explicitEndpointAuthority = (
  value: string,
  url: URL,
): string | undefined => {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/iu.exec(value)?.[1];
  const port =
    authority === undefined ? undefined : /:([0-9]+)$/u.exec(authority)?.[1];
  return port === undefined
    ? undefined
    : `${url.protocol}//${url.hostname}:${String(Number(port))}`;
};

/** Normalized explicit-port origin of a loopback CDP HTTP discovery endpoint. */
const httpDiscoveryOrigin = (value: string, url: URL): string | undefined =>
  url.protocol === "http:" &&
  isLiteralLoopbackHostname(url.hostname) &&
  url.username === "" &&
  url.password === "" &&
  url.pathname === "/" &&
  !urlDeclaresQueryOrFragment(url)
    ? explicitEndpointAuthority(value, url)
    : undefined;

/** Scheme and authority of an accepted loopback CDP browser WebSocket. */
const browserSocketAuthority = (
  value: string,
  url: URL,
): string | undefined => {
  const id = url.pathname.slice(BROWSER_SOCKET_PATH.length);
  return url.protocol === "ws:" &&
    isLiteralLoopbackHostname(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    !urlDeclaresQueryOrFragment(url) &&
    url.pathname.startsWith(BROWSER_SOCKET_PATH) &&
    id.length > 0 &&
    !id.includes("/")
    ? explicitEndpointAuthority(value, url)
    : undefined;
};

/** Loopback-only HTTP endpoint accepted for a user-owned CDP browser. */
export const browserEndpointSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const url = URL.parse(value);
    const origin = url === null ? undefined : httpDiscoveryOrigin(value, url);
    if (origin !== undefined) return origin;
    context.addIssue({
      code: "custom",
      message:
        url === null ? "Invalid CDP endpoint URL" : HTTP_ENDPOINT_MESSAGE,
    });
    return z.NEVER;
  });

/**
 * Caller-selected endpoint for passive browser observation. A browser socket
 * skips HTTP discovery; its identifier gates access, so `recorded` omits it.
 */
export interface BrowserObservationEndpoint {
  readonly transport: "http_discovery" | "browser_websocket";
  readonly url: string;
  readonly recorded: string;
}

/** Loopback CDP HTTP discovery origin or browser WebSocket URL. */
export const browserObservationEndpointSchema = z
  .string()
  .min(1)
  .describe(
    "Literal loopback CDP endpoint: http://127.0.0.1:PORT, or ws://127.0.0.1:PORT/devtools/browser/ID.",
  )
  .transform((value, context): BrowserObservationEndpoint => {
    const url = URL.parse(value);
    if (url === null) {
      context.addIssue({ code: "custom", message: "Invalid CDP endpoint URL" });
      return z.NEVER;
    }
    const origin = httpDiscoveryOrigin(value, url);
    if (origin !== undefined)
      return { transport: "http_discovery", url: origin, recorded: origin };
    const authority = browserSocketAuthority(value, url);
    if (authority !== undefined)
      return {
        transport: "browser_websocket",
        url: `${authority}${url.pathname}`,
        recorded: `${authority}${REDACTED_BROWSER_SOCKET_PATH}`,
      };
    context.addIssue({
      code: "custom",
      message:
        url.protocol === "ws:"
          ? "CDP browser WebSocket must be ws://127.0.0.1:PORT/devtools/browser/ID or ws://[::1]:PORT/devtools/browser/ID"
          : HTTP_ENDPOINT_MESSAGE,
    });
    return z.NEVER;
  });

/** Evidence form of a passive browser endpoint, with any socket identifier redacted. */
export const recordedBrowserObservationEndpointSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const url = URL.parse(value);
      return (
        url !== null &&
        (httpDiscoveryOrigin(value, url) !== undefined ||
          (browserSocketAuthority(value, url) !== undefined &&
            url.pathname === REDACTED_BROWSER_SOCKET_PATH))
      );
    },
    {
      message:
        "Recorded CDP endpoint must be a loopback HTTP origin or a redacted browser WebSocket URL",
    },
  );

export const browserAllowedOriginsSchema = z
  .array(browserOriginSchema)
  .transform((origins) => Array.from(new Set(origins)).sort())
  .default([]);

const browserInput = {
  cdp_endpoint: browserObservationEndpointSchema,
  allowed_origins: browserAllowedOriginsSchema,
};

/**
 * Public input for complete discovery, optionally filtered by exact origin.
 * Discovery uses the fixed deadline and the socket closes without a later
 * command, so this operation accepts no command_timeout_ms.
 */
export const listBrowserTargetsInputSchema = z.strictObject({
  ...browserInput,
});

const inspectWebPageInputFacts = {
  ...browserInput,
  target_id: z.string().min(1),
  command_timeout_ms: webRuntimeCommandTimeoutSchema,
  observation_ms: z.int().min(0).default(500),
  include_accessibility_text: z.boolean().default(false),
  include_console_text: z.boolean().default(false),
  include_json_body_shapes: z.boolean().default(false),
  include_websocket_shapes: z.boolean().default(false),
  include_storage_keys: z.boolean().default(false),
  include_storage_fingerprints: z.boolean().default(false),
} as const;

const inspectWebPageWithoutSourceSchema = z.strictObject({
  ...inspectWebPageInputFacts,
  include_script_sources: z.literal(false).optional().default(false),
});

const inspectWebPageWithSourceShapeSchema = z.strictObject({
  ...inspectWebPageInputFacts,
  include_script_sources: z.literal(true).default(true),
});

type InspectWebPageShape =
  | z.output<typeof inspectWebPageWithoutSourceSchema>
  | z.output<typeof inspectWebPageWithSourceShapeSchema>;

const refineInspectWebPageInput = (
  input: InspectWebPageShape,
  context: z.RefinementCtx,
): void => {
  if (input.include_storage_fingerprints && !input.include_storage_keys)
    context.addIssue({
      code: "custom",
      path: ["include_storage_fingerprints"],
      message: "Storage fingerprints require storage key capture",
    });
};

/** Caller schema for source-capturing inspection and bundle analysis. */
export const inspectWebPageWithSourceInputSchema =
  inspectWebPageWithSourceShapeSchema.superRefine(refineInspectWebPageInput);

/** Caller-visible schema for one passive inspection. */
export const inspectWebPageInputSchema = z.discriminatedUnion(
  "include_script_sources",
  [
    inspectWebPageWithoutSourceSchema.superRefine(refineInspectWebPageInput),
    inspectWebPageWithSourceShapeSchema
      .extend({
        include_script_sources: z.literal(true),
      })
      .superRefine(refineInspectWebPageInput),
  ],
);

export type ListBrowserTargetsInput = z.infer<
  typeof listBrowserTargetsInputSchema
>;
export type InspectWebPageInput = z.infer<typeof inspectWebPageInputSchema>;

export const sanitizedBrowserUrlSchema = z.object({
  url: z.string(),
  origin: z.string().nullable(),
  query_parameter_names: z.array(z.string()),
  redacted: z.boolean(),
});
export type SanitizedBrowserUrl = z.infer<typeof sanitizedBrowserUrlSchema>;

/** Parsed URL syntax and sanitized transport data share one interpretation. */
export type BrowserUrlObservation =
  | { readonly kind: "malformed"; readonly source: string }
  | {
      readonly kind: "parsed";
      readonly source: string;
      readonly protocol: string;
      readonly sanitized: SanitizedBrowserUrl;
    };

export const observeBrowserUrl = (value: string): BrowserUrlObservation => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause: unknown) {
    void cause;
    return { kind: "malformed", source: value };
  }
  const hadCredentials = parsed.username !== "" || parsed.password !== "";
  return {
    kind: "parsed",
    source: value,
    protocol: parsed.protocol,
    sanitized: {
      url: hadCredentials ? removeUrlUserInfo(value, parsed) : value,
      origin: parsed.origin === "null" ? null : parsed.origin,
      query_parameter_names: [...parseUrlQueryParameterNames(parsed.search)],
      redacted: hadCredentials,
    },
  };
};

/** Preserve local URL data while removing only URL userinfo credentials. */
export const sanitizeBrowserUrl = (value: string): SanitizedBrowserUrl => {
  const observation = observeBrowserUrl(value);
  return observation.kind === "parsed"
    ? observation.sanitized
    : {
        url: observation.source,
        origin: null,
        query_parameter_names: [],
        redacted: false,
      };
};

const removeUrlUserInfo = (value: string, parsed: URL): string => {
  const { credentials } = parseRecordedTransportUrl(value);
  return credentials === null || credentials === "ambiguous"
    ? credentialFreeHref(parsed)
    : `${value.slice(0, credentials.start)}${value.slice(credentials.end)}`;
};

const credentialFreeHref = (parsed: URL): string => {
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
};

/** Normalize endpoint candidates without discarding local query or fragment data. */
export const sanitizeEndpointCandidate = (value: string): string => {
  return sanitizeBrowserUrl(value).url;
};
