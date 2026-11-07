import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { isUtf8 } from "node:buffer";

import { z } from "zod";

import {
  CDP_DISCOVERY_RESPONSE_TIMEOUT_MS,
  cdpCommandTimeoutUnrelatedControl,
  noRuntimeOverrideSentence,
} from "../domain/browserDeadline.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import { urlDeclaresQueryOrFragment } from "../domain/urlComponents.js";
import { safeParseJson } from "../domain/safeJson.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import type { CdpConnection } from "./CdpConnection.js";
import { recordValue } from "./CdpCaptureValues.js";
import {
  parseCdpDiscoveryTargets,
  type CdpDiscoveryTarget,
} from "./CdpDiscoveryTargets.js";

const endpointVersionSchema = z.object({
  Browser: z.string().min(1),
  "Protocol-Version": z.string().min(1),
  "User-Agent": z.string(),
  "V8-Version": z.string(),
  "WebKit-Version": z.string(),
  webSocketDebuggerUrl: z.string().min(1),
});

/** Per-response bounds for loopback CDP discovery documents. There is no runtime override. */
const CDP_DISCOVERY_RESPONSE_LIMITS = {
  bytes: 8 * 1024 * 1024,
  timeoutMs: CDP_DISCOVERY_RESPONSE_TIMEOUT_MS,
} as const;

const discoveryBudget = (phase: "response" | "browser-socket"): string =>
  phase === "response"
    ? `The ${String(CDP_DISCOVERY_RESPONSE_LIMITS.bytes)}-byte discovery document budget`
    : `The ${String(WEB_RUNTIME_LIMITS.protocolBytes)}-byte browser-socket message budget`;

const discoveryTimeout = (
  operation: BrowserObservationOperation,
  timeoutMs: number,
  phase: "response" | "browser-socket",
): BrowserObservationError => {
  const subject =
    phase === "response"
      ? `CDP discovery response exceeded its ${String(timeoutMs)} ms deadline.`
      : `CDP browser-socket discovery exceeded its ${String(timeoutMs)} ms deadline.`;
  const fixed = noRuntimeOverrideSentence(
    `${discoveryBudget(phase)} and the ${String(timeoutMs)} ms discovery deadline stay fixed.`,
    cdpCommandTimeoutUnrelatedControl(operation),
  );
  return new BrowserObservationError(operation, "timeout", {
    detail: `${subject} ${fixed}`,
    remediationAction: fixed,
  });
};

interface CdpDiscoveryResponseLimits {
  readonly bytes: number;
  readonly timeoutMs: number;
}

const browserSocketVersionSchema = z.object({
  protocolVersion: z.string().min(1),
  product: z.string().min(1),
  revision: z.string(),
  userAgent: z.string(),
  jsVersion: z.string(),
});

/** Validated direct CDP WebSocket bound to one discovered page target. */
interface CdpPageWebSocketEndpoint {
  readonly scope: "page";
  readonly targetId: string;
  readonly url: string;
}

/** Validated CDP discovery socket and its command-routing scope. */
export type CdpWebSocketEndpoint =
  | { readonly scope: "browser"; readonly url: string }
  | CdpPageWebSocketEndpoint;

/** Bounded discovery target with an optional validated direct transport. */
export interface CdpEndpointTarget {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly attached: boolean | null;
  readonly webSocket?: CdpPageWebSocketEndpoint;
}

export interface CdpEndpointDiscovery {
  readonly limitations?: readonly string[];
  readonly ambiguousTargetIds?: readonly string[];
  readonly webSocket: CdpWebSocketEndpoint;
  readonly version: {
    readonly product: string;
    readonly protocol_version: string;
    readonly revision: string;
    readonly user_agent: string;
    readonly js_version: string;
  };
  readonly targets: readonly CdpEndpointTarget[];
}

/** Read CDP discovery endpoints without following redirects. */
export const discoverCdpEndpoint = async (
  endpoint: string,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
): Promise<CdpEndpointDiscovery> => {
  const versionInput = await readCdpJson(
    new URL("/json/version", endpoint),
    operation,
    signal,
  );
  const targetsInput = await readCdpJson(
    new URL("/json/list", endpoint),
    operation,
    signal,
  );
  const version = parseCdpEndpointValue(
    endpointVersionSchema,
    versionInput,
    operation,
  );
  const { targets, limitations, ambiguousTargetIds } = parseCdpDiscoveryTargets(
    targetsInput,
    operation,
  );
  return {
    limitations,
    ambiguousTargetIds,
    webSocket: safeCdpWebSocketEndpoint(
      endpoint,
      version.webSocketDebuggerUrl,
      operation,
    ),
    version: {
      product: version.Browser,
      protocol_version: version["Protocol-Version"],
      revision: version["WebKit-Version"],
      user_agent: version["User-Agent"],
      js_version: version["V8-Version"],
    },
    targets: targets.map((target) => ({
      id: target.id,
      type: target.type,
      title: sanitizeTargetTitle(target.title, target.url),
      url: target.url,
      attached: target.attached,
      ...targetWebSocket(endpoint, target, operation),
    })),
  };
};

/**
 * Run browser-socket discovery work, including its WebSocket handshake, under
 * the HTTP discovery deadline. Reaching the deadline is a timeout, not a
 * caller cancellation, so the internal abort is not carried as its cause.
 */
export const withCdpDiscoveryDeadline = async <T>(
  operation: BrowserObservationOperation,
  signal: AbortSignal | undefined,
  work: (deadlineSignal: AbortSignal) => Promise<T>,
  timeoutMs: number = CDP_DISCOVERY_RESPONSE_LIMITS.timeoutMs,
): Promise<T> => {
  const deadline = new AbortController();
  let abortSource: "caller" | "deadline" | undefined;
  let abortReason: unknown;
  const abort = (source: "caller" | "deadline", reason: unknown): void => {
    if (abortSource !== undefined) return;
    abortSource = source;
    abortReason = reason;
    deadline.abort(reason);
  };
  const onCallerAbort = (): void => {
    if (signal?.aborted === true) abort("caller", signal.reason);
  };
  const timer = setTimeout(
    () => abort("deadline", new Error("CDP discovery deadline exceeded")),
    timeoutMs,
  );
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  onCallerAbort();
  try {
    return await work(deadline.signal);
  } catch (cause: unknown) {
    if (cause === abortReason) {
      if (abortSource === "caller")
        throw new AnalysisCancelledError(operation, { cause: abortReason });
      if (abortSource === "deadline")
        throw discoveryTimeout(operation, timeoutMs, "browser-socket");
    }
    // A concrete failure produced before cancellation remains authoritative.
    if (cause instanceof AnalysisError) {
      if (
        abortSource === "deadline" &&
        cause instanceof AnalysisCancelledError &&
        cause.cause === abortReason
      )
        throw discoveryTimeout(operation, timeoutMs, "browser-socket");
      throw cause;
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
};

/**
 * Read discovery facts over a browser socket that has no HTTP discovery.
 * Each reply is bounded by the connection's protocol message limit; callers
 * apply the discovery deadline through `signal`.
 */
export const discoverCdpBrowserSocket = async (
  connection: Pick<CdpConnection, "send">,
  url: string,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
): Promise<CdpEndpointDiscovery> => {
  const versionInput = await connection.send(
    "Browser.getVersion",
    {},
    undefined,
    signal,
  );
  const targetsInput = await connection.send(
    "Target.getTargets",
    {},
    undefined,
    signal,
  );
  const version = parseCdpEndpointValue(
    browserSocketVersionSchema,
    versionInput,
    operation,
  );
  const { targets, limitations, ambiguousTargetIds } = parseCdpDiscoveryTargets(
    recordValue(targetsInput)?.targetInfos,
    operation,
    "browser-socket",
  );
  return {
    limitations,
    ambiguousTargetIds,
    webSocket: { scope: "browser", url },
    version: {
      product: version.product,
      protocol_version: version.protocolVersion,
      revision: version.revision,
      user_agent: version.userAgent,
      js_version: version.jsVersion,
    },
    targets: targets.map((target) => ({
      id: target.id,
      type: target.type,
      title: sanitizeTargetTitle(target.title, target.url),
      url: target.url,
      attached: target.attached,
    })),
  };
};

const sanitizeTargetTitle = (value: string, targetUrl: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    // Non-URL titles fall back to alias redaction.
    void cause;
    return sanitizeTargetUrlAlias(value, targetUrl);
  }
  return url.protocol === "http:" || url.protocol === "https:"
    ? sanitizeBrowserUrl(value).url
    : sanitizeTargetUrlAlias(value, targetUrl);
};

const sanitizeTargetUrlAlias = (value: string, targetUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch (cause: unknown) {
    // Without a parseable target URL there is nothing to redact.
    void cause;
    return value;
  }
  const markers = [parsed.origin, `//${parsed.host}`, parsed.host];
  if (parsed.pathname !== "/") markers.push(parsed.pathname);
  const candidatePattern = new RegExp(
    `(?:${markers.map(escapeRegExp).join("|")})[^\\s<>"']*`,
    "gu",
  );
  return value.replace(candidatePattern, (candidate) =>
    sanitizeSameOriginTitleUrl(candidate, parsed),
  );
};

const sanitizeSameOriginTitleUrl = (candidate: string, target: URL): string => {
  let parsed: URL;
  try {
    parsed = candidate.startsWith("//")
      ? new URL(`${target.protocol}${candidate}`)
      : candidate.startsWith(target.host)
        ? new URL(`${target.protocol}//${candidate}`)
        : new URL(candidate, target.origin);
  } catch (cause: unknown) {
    // Unparseable candidates are preserved verbatim.
    void cause;
    return candidate;
  }
  return parsed.origin === target.origin &&
    (parsed.username !== "" || parsed.password !== "")
    ? sanitizeBrowserUrl(candidate).url
    : candidate;
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Select a browser attachment socket or a direct socket for one page target. */
export const cdpTargetWebSocket = (
  discovery: CdpEndpointDiscovery,
  target: CdpEndpointTarget,
  operation: BrowserObservationOperation,
): CdpWebSocketEndpoint => {
  const webSocket = availableCdpTargetWebSocket(discovery, target);
  if (webSocket !== undefined) return webSocket;
  throw new BrowserObservationError(operation, "invalid_endpoint_response");
};

/** Report whether discovery contains a validated transport for one target. */
export const hasCdpTargetWebSocket = (
  discovery: CdpEndpointDiscovery,
  target: CdpEndpointTarget,
): boolean => availableCdpTargetWebSocket(discovery, target) !== undefined;

const availableCdpTargetWebSocket = (
  discovery: CdpEndpointDiscovery,
  target: CdpEndpointTarget,
): CdpWebSocketEndpoint | undefined => {
  if (discovery.webSocket.scope === "browser") return discovery.webSocket;
  if (target.webSocket !== undefined) return target.webSocket;
  return discovery.webSocket.targetId === target.id
    ? discovery.webSocket
    : undefined;
};

/** Parse one CDP discovery value through its exact boundary schema. */
export const parseCdpEndpointValue = <Output>(
  schema: z.ZodType<Output>,
  input: unknown,
  operation: BrowserObservationOperation,
): Output => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new BrowserObservationError(operation, "invalid_endpoint_response", {
      cause: parsed.error,
    });
  return parsed.data;
};

const safeCdpWebSocketEndpoint = (
  endpoint: string,
  reported: string,
  operation: BrowserObservationOperation,
): CdpWebSocketEndpoint => {
  let parsed: URL;
  try {
    parsed = new URL(reported);
  } catch (cause: unknown) {
    throw new BrowserObservationError(operation, "invalid_endpoint_response", {
      cause,
    });
  }
  const trustedEndpoint = new URL(endpoint);
  const path = cdpWebSocketPath(parsed.pathname);
  if (
    parsed.protocol !== "ws:" ||
    parsed.port !== trustedEndpoint.port ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    urlDeclaresQueryOrFragment(parsed) ||
    path === undefined
  )
    throw new BrowserObservationError(operation, "invalid_endpoint_response");
  parsed.hostname = trustedEndpoint.hostname;
  return path.scope === "browser"
    ? { scope: "browser", url: parsed.href }
    : { scope: "page", targetId: path.targetId, url: parsed.href };
};

const cdpWebSocketPath = (
  pathname: string,
):
  | { readonly scope: "browser" }
  | { readonly scope: "page"; targetId: string }
  | undefined => {
  const browserId = pathIdentifier(pathname, "/devtools/browser/");
  if (browserId !== undefined) return { scope: "browser" };
  const targetId = pathIdentifier(pathname, "/devtools/page/");
  return targetId === undefined ? undefined : { scope: "page", targetId };
};

const pathIdentifier = (
  pathname: string,
  prefix: string,
): string | undefined => {
  if (!pathname.startsWith(prefix)) return undefined;
  const identifier = pathname.slice(prefix.length);
  return identifier.length > 0 && !identifier.includes("/")
    ? identifier
    : undefined;
};

const targetWebSocket = (
  endpoint: string,
  target: CdpDiscoveryTarget,
  operation: BrowserObservationOperation,
): { readonly webSocket?: CdpPageWebSocketEndpoint } => {
  if (
    typeof target.webSocketDebuggerUrl !== "string" ||
    target.webSocketDebuggerUrl.length === 0
  )
    return {};
  try {
    const webSocket = safeCdpWebSocketEndpoint(
      endpoint,
      target.webSocketDebuggerUrl,
      operation,
    );
    return webSocket.scope === "page" && webSocket.targetId === target.id
      ? { webSocket }
      : {};
  } catch (cause: unknown) {
    // Endpoint validation failures mean no validated transport exists.
    void cause;
    return {};
  }
};

/** Read one loopback CDP discovery document without redirects. */
export const readCdpJson = async (
  url: URL,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
  limits: CdpDiscoveryResponseLimits = CDP_DISCOVERY_RESPONSE_LIMITS,
): Promise<unknown> =>
  await new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AnalysisCancelledError(operation, { cause: signal.reason }));
      return;
    }
    let response: IncomingMessage | undefined;
    let request_: ClientRequest | undefined;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const removeAbort = (): void =>
      signal?.removeEventListener("abort", onAbort);
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      removeAbort();
      if (error !== undefined) {
        reject(error);
        response?.destroy();
        request_?.destroy();
      } else resolve(value);
    };
    const onAbort = (): void => {
      if (signal?.aborted === true)
        finish(new AnalysisCancelledError(operation, { cause: signal.reason }));
    };
    request_ = request(
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      (received) => {
        response = received;
        if (settled) {
          received.destroy();
          return;
        }
        if (received.statusCode !== 200) {
          finish(
            new BrowserObservationError(operation, "invalid_endpoint_response"),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        received.on("data", (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.byteLength;
          if (bytes > limits.bytes) {
            finish(
              new BrowserObservationError(operation, "payload_limit", {
                detail: noRuntimeOverrideSentence(
                  `CDP discovery response exceeds its ${String(limits.bytes)}-byte limit.`,
                  cdpCommandTimeoutUnrelatedControl(operation),
                ),
              }),
            );
            return;
          }
          chunks.push(chunk);
        });
        received.on("end", () => {
          if (settled) return;
          const body = Buffer.concat(chunks, bytes);
          if (!isUtf8(body)) {
            finish(
              new BrowserObservationError(
                operation,
                "invalid_endpoint_response",
              ),
            );
            return;
          }
          const parsed = safeParseJson(body.toString("utf8"));
          if (!parsed.ok) {
            finish(
              new BrowserObservationError(
                operation,
                "invalid_endpoint_response",
                { cause: parsed.cause },
              ),
            );
            return;
          }
          finish(undefined, parsed.value);
        });
        received.on("aborted", () =>
          finish(
            new BrowserObservationError(operation, "invalid_endpoint_response"),
          ),
        );
        received.on("close", () => {
          if (!settled && !received.complete)
            finish(
              new BrowserObservationError(
                operation,
                "invalid_endpoint_response",
              ),
            );
        });
        received.on("error", (cause: unknown) =>
          finish(endpointFailure(cause, operation, signal)),
        );
      },
    );
    request_.on("error", (cause: unknown) =>
      finish(endpointFailure(cause, operation, signal)),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    onAbort();
    if (settled) return;
    timer = setTimeout(
      () => finish(discoveryTimeout(operation, limits.timeoutMs, "response")),
      limits.timeoutMs,
    );
    request_.end();
  });

const endpointFailure = (
  cause: unknown,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (signal?.aborted === true)
    return new AnalysisCancelledError(operation, { cause: signal.reason });
  return new BrowserObservationError(operation, "endpoint_unreachable", {
    cause,
  });
};
