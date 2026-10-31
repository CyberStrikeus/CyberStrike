import * as t from "@babel/types";
import { createHash } from "node:crypto";
import { decodeValidatedSourceMapLeaves } from "../javascript/sourceMaps/DecodedSourceMap.js";

import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import {
  AnalysisError,
  type AnalysisErrorOptions,
} from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import { isUrlLikeModuleSpecifier } from "../domain/webBundleAnalyzerAst.js";
import { analyzeParsedJavaScriptReferences } from "../domain/javascript/javascriptSemanticAnalysis.js";
import { traverseJavaScriptAst } from "../domain/javascript/javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "../domain/javascript/javascriptSourceParser.js";
import {
  semanticStaticModuleSource,
  semanticImportEqualsSpecifier,
} from "../domain/javascript/javascriptModuleDeclaration.js";
import { stringValue } from "../domain/javascript/javascriptStaticAnalysisHelpers.js";
import type {
  AnalyzeWebBundleInput,
  WebSourceMapItem,
  WebSourceMaps,
} from "../domain/webBundleAnalysis.js";
import {
  webSourceMapsSchema,
  DEFAULT_SOURCE_MAP_FETCH_TIMEOUT_MS,
} from "../domain/webBundleAnalysis.js";
import {
  createWebTextArtifact,
  type WebTextArtifact,
} from "../domain/webContentArtifact.js";
import { safeParseJson } from "../domain/safeJson.js";
import { sourceMapJsonText } from "../domain/sourceMapEnvelope.js";
import { resolveJavaScriptSourceMapUrl } from "../domain/javascript/javascriptSourceMapPaths.js";
import { jsonByteLength } from "../domain/jsonSerialization.js";
import {
  inspectSourceMapValue,
  SourceMapFormatFailure,
  type SourceMapLeaf,
} from "../javascript/sourceMaps/SourceMapFormat.js";
import {
  noRuntimeOverrideSentence,
  selectedBrowserDeadlineMs,
} from "../domain/browserDeadline.js";
import { WEB_SOURCE_MAP_LIMITS } from "../domain/webSourceLocation.js";

export interface WebSourceMapRequest {
  readonly scriptKey: string;
  readonly declaredUrl: string;
  readonly fetchUrl: string;
}

interface SourceMapFetchHost {
  readonly fetch: typeof fetch;
  /** Fetch-operation deadline; injectable so boundary regressions stay fast. */
  readonly timeoutMs?: number;
  /** Maximum response bytes retained across this operation. */
  readonly maxResponseBytes?: number;
}

// Source maps are normally fetched as a small part of a larger inspection.
// Bound a stalled server to 30 seconds and bound raw map input retained for
// parsing to 64 MiB per inspection. Both limits apply at the network boundary;
// hitting either produces an explicit fetch_failed item, never truncated data.
const SOURCE_MAP_FETCH_TIMEOUT_MS = DEFAULT_SOURCE_MAP_FETCH_TIMEOUT_MS;

const sourceMapFetchDeadlineLimitation = (timeoutMs: number): string =>
  `Source-map fetch exceeded its ${String(timeoutMs)} ms source_map_fetch_timeout_ms deadline (fetch_failed). This is an item limitation, not a thrown analysis timeout, and not the source-map decode deadline. ${noRuntimeOverrideSentence(`The ${String(SOURCE_MAP_RESPONSE_BYTES)}-byte response budget stays fixed.`, "source_map_fetch_timeout_ms")}`;
const SOURCE_MAP_RESPONSE_BYTES = 64 * 1024 * 1024;
const SOURCE_MAP_OUTPUT_BYTES = WEB_SOURCE_MAP_LIMITS.outputBytes;
const SOURCE_MAP_FAILURE_LIMITATION_RESERVE = 512;
const SOURCE_MAP_COLLECTION_ENVELOPE_RESERVE = 1_024;

type ParsedSourceMapItem = Extract<
  WebSourceMapItem,
  { status: "included" | "partial" }
>;
type ResponseIdentity = {
  readonly sha256: string;
  readonly bytes: number;
  readonly representation: "fetch-response-body-bytes";
};
type FailedSourceMapStatus = "fetch_failed" | "invalid" | "policy_filtered";
interface SourceMapDecodeContext {
  readonly signal: AbortSignal | undefined;
  readonly deadlineAt: number;
  readonly deadlineLimitation: string;
  readonly budget: {
    records: number;
    expandedBytes: number;
    resolvedSourceBytes: number;
  };
}

/** Fetch and validate approved source maps without browser credentials. */
export const fetchWebSourceMaps = async (
  requests: readonly WebSourceMapRequest[],
  input: AnalyzeWebBundleInput,
  signal?: AbortSignal,
  host: SourceMapFetchHost = { fetch: globalThis.fetch },
): Promise<Result<WebSourceMaps, AnalysisError>> => {
  if (signalIsAborted(signal))
    return err(
      new AnalysisCancelledError("analyze_web_bundle", {
        cause: signal?.reason,
      }),
    );
  if (requests.length === 0)
    return ok(
      webSourceMapsSchema.parse({
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      }),
    );
  const items: WebSourceMapItem[] = [];
  const operationController = new AbortController();
  const fetchTimeoutMs =
    host.timeoutMs ??
    selectedBrowserDeadlineMs(
      input.source_map_fetch_timeout_ms,
      SOURCE_MAP_FETCH_TIMEOUT_MS,
    );
  const fetchDeadlineLimitation =
    sourceMapFetchDeadlineLimitation(fetchTimeoutMs);
  const timeout = setTimeout(
    () =>
      operationController.abort(
        new SourceMapDeadlineError(fetchDeadlineLimitation),
      ),
    fetchTimeoutMs,
  );
  const abortFromCaller = (): void => operationController.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const operationSignal = operationController.signal;
  const deadlineAt = performance.now() + fetchTimeoutMs;
  const budget = {
    retainedBytes: 0,
    deadlineAt,
    deadlineLimitation: fetchDeadlineLimitation,
    decodedRecords: {
      records: 0,
      expandedBytes: SOURCE_MAP_COLLECTION_ENVELOPE_RESERVE,
      resolvedSourceBytes: 0,
    },
  };
  let limitation: string | undefined;
  const completedMaps = (): WebSourceMaps => {
    const unprocessed = requests.length - items.length;
    const stoppedLimitation =
      unprocessed === 0
        ? undefined
        : `Source-map acquisition stopped with ${String(unprocessed)} requested map${unprocessed === 1 ? "" : "s"} unprocessed; their results are unknown.`;
    const retainedLimitation = [limitation, stoppedLimitation]
      .filter((value) => value !== undefined)
      .join(" ");
    return webSourceMapsSchema.parse({
      status: sourceMapsStatus(
        items,
        unprocessed > 0 || limitation !== undefined,
      ),
      requested: requests.length,
      processed: items.length,
      items,
      ...(retainedLimitation.length === 0
        ? {}
        : { limitation: retainedLimitation }),
    });
  };
  const retainCompleted = (error: AnalysisError): AnalysisError =>
    error.retainPartialObservation({
      kind: "web-source-map-fetch",
      source_maps: completedMaps(),
    });
  try {
    for (const request of requests) {
      if (signal?.aborted === true) throw signal.reason;
      const reservation = sourceMapFailureReservation(request) + 1;
      if (
        reservation >
        SOURCE_MAP_OUTPUT_BYTES - budget.decodedRecords.expandedBytes
      ) {
        limitation = sourceMapOutputLimitation(requests.length - items.length);
        break;
      }
      const expandedBytesBeforeItem = budget.decodedRecords.expandedBytes;
      budget.decodedRecords.expandedBytes += reservation;
      if (operationSignal.aborted || performance.now() >= deadlineAt) {
        items.push(
          emptySourceMapItem(request, "fetch_failed", fetchDeadlineLimitation),
        );
        continue;
      }
      const item = await fetchOne(
        request,
        input,
        operationSignal,
        host,
        budget,
      );
      if (item.status !== "included" && item.status !== "partial") {
        const failureBytes = jsonByteLength(item) + 1;
        if (failureBytes > SOURCE_MAP_OUTPUT_BYTES - expandedBytesBeforeItem) {
          limitation = sourceMapOutputLimitation(
            requests.length - items.length,
          );
          break;
        }
        budget.decodedRecords.expandedBytes =
          expandedBytesBeforeItem + failureBytes;
      }
      items.push(item);
    }
  } catch (cause: unknown) {
    if (signal?.aborted === true && cause === signal.reason)
      return err(
        retainCompleted(
          new AnalysisCancelledError("analyze_web_bundle", {
            cause: signal.reason,
          }),
        ),
      );
    if (cause instanceof AnalysisError) return err(retainCompleted(cause));
    if (signal?.aborted === true)
      return err(
        retainCompleted(
          new AnalysisCancelledError("analyze_web_bundle", {
            cause: signal.reason,
          }),
        ),
      );
    if (cause instanceof SourceMapFormatFailure && cause.reason === "limit")
      limitation = sourceMapOutputLimitation(requests.length - items.length);
    else throw cause;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  if (signal?.aborted === true)
    return err(
      retainCompleted(
        new AnalysisCancelledError("analyze_web_bundle", {
          cause: signal.reason,
        }),
      ),
    );
  return ok(
    webSourceMapsSchema.parse({
      status: sourceMapsStatus(items, limitation !== undefined),
      requested: requests.length,
      processed: items.length,
      items,
      ...(limitation === undefined ? {} : { limitation }),
    }),
  );
};

const sourceMapOutputLimitation = (unprocessed: number): string =>
  `source-map output budget could not retain results for ${String(unprocessed)} requested map${unprocessed === 1 ? "" : "s"}. their results are unknown.`;

const sourceMapsStatus = (
  items: readonly WebSourceMapItem[],
  omitted: boolean,
): WebSourceMaps["status"] => {
  const retained = items.filter(
    ({ status }) => status === "included" || status === "partial",
  ).length;
  if (items.length === 0 || retained === 0) return "unavailable";
  if (omitted) return "partial";
  return retained === items.length &&
    !items.some(({ status }) => status === "partial")
    ? "included"
    : "partial";
};

class SourceMapDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceMapDeadlineError";
  }
}

class SourceMapSizeLimitError extends Error {
  constructor() {
    super(
      `Source-map response exceeded the ${String(SOURCE_MAP_RESPONSE_BYTES)}-byte retained budget. ${noRuntimeOverrideSentence("That response budget stays fixed.", "source_map_fetch_timeout_ms")}`,
    );
    this.name = "SourceMapSizeLimitError";
  }
}

class SourceMapEncodingError extends Error {
  constructor(readonly responseIdentity: ResponseIdentity) {
    super("Source-map response is not valid UTF-8.");
    this.name = "SourceMapEncodingError";
  }
}

class SourceMapRedirectLocationError extends Error {
  constructor(url: string, location: string) {
    super(
      `Source-map redirect from ${JSON.stringify(url)} supplied an invalid Location URL: ${JSON.stringify(location)}.`,
    );
    this.name = "SourceMapRedirectLocationError";
  }
}

const fetchOne = async (
  request: WebSourceMapRequest,
  input: AnalyzeWebBundleInput,
  signal: AbortSignal | undefined,
  host: SourceMapFetchHost,
  budget: {
    retainedBytes: number;
    deadlineAt: number;
    deadlineLimitation: string;
    decodedRecords: {
      records: number;
      expandedBytes: number;
      resolvedSourceBytes: number;
    };
  },
): Promise<WebSourceMapItem> => {
  if (!approvedUrl(request.fetchUrl, input.allowed_origins))
    return emptySourceMapItem(
      request,
      "policy_filtered",
      "Declared source-map URL must be a credential-free HTTP(S) URL on an approved exact origin.",
    );
  let effectiveUrl: string | null = null;
  let completedResponseIdentity: ResponseIdentity | undefined;
  try {
    const fetched = await fetchFollowingApprovedRedirects(
      request.fetchUrl,
      input.allowed_origins,
      signal,
      host,
      (url) => {
        effectiveUrl = url;
      },
    );
    if (fetched === undefined)
      return emptySourceMapItem(
        request,
        "policy_filtered",
        "Each source-map redirect must be a credential-free HTTP(S) URL on an approved exact origin.",
        effectiveUrl,
      );
    const { response, fetchedUrl } = fetched;
    try {
      // Admit the resolution identity before reading or retaining its body.
      consumeExpandedBytes(
        budget.decodedRecords,
        jsonByteLength(fetchedUrl) - 4,
      );
    } catch (cause: unknown) {
      try {
        await response.body?.cancel();
      } catch (cleanupCause: unknown) {
        if (cause instanceof SourceMapFormatFailure && cause.reason === "limit")
          throw sourceMapOutputError(cause, {
            cause: new AggregateError(
              [cause, cleanupCause],
              "Source-map response cleanup failed after its output exceeded capacity.",
            ),
            cleanup: {
              reason:
                "Source-map response cancellation failed after its output exceeded capacity.",
              resources: ["source-map-response"],
            },
          });
        throw cause;
      }
      throw cause;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return emptySourceMapItem(
        request,
        "fetch_failed",
        `Source-map server returned HTTP ${String(response.status)}.`,
        fetchedUrl,
      );
    }
    checkOperation(
      undefined,
      signal,
      budget.deadlineAt,
      budget.deadlineLimitation,
    );
    const body = await readBoundedText(
      response,
      budget,
      host.maxResponseBytes ?? SOURCE_MAP_RESPONSE_BYTES,
      signal,
    );
    completedResponseIdentity = body.responseIdentity;
    return normalizeSourceMap(
      request,
      body.text,
      body.responseIdentity,
      fetchedUrl,
      {
        signal,
        deadlineAt: budget.deadlineAt,
        deadlineLimitation: budget.deadlineLimitation,
        budget: budget.decodedRecords,
      },
    );
  } catch (cause: unknown) {
    if (cause instanceof AnalysisResourceConstraintError) throw cause;
    if (cause instanceof SourceMapFormatFailure && cause.reason === "limit")
      throw cause;
    if (
      signal?.aborted === true &&
      !(signal.reason instanceof SourceMapDeadlineError)
    )
      throw cause;
    if (cause instanceof SourceMapEncodingError)
      return emptySourceMapItem(
        request,
        "invalid",
        cause.message,
        effectiveUrl,
        cause.responseIdentity,
      );
    return emptySourceMapItem(
      request,
      "fetch_failed",
      cause instanceof SourceMapRedirectLocationError ||
        cause instanceof SourceMapSizeLimitError ||
        cause instanceof SourceMapDeadlineError
        ? cause.message
        : "Source-map fetch or validation failed.",
      effectiveUrl,
      completedResponseIdentity,
    );
  }
};

/**
 * Fetch redirect statuses per WHATWG Fetch (redirect status list:
 * 301, 302, 303, 307, 308). Single owner for redirect decisions.
 * 300/304/305/306 carry `Location` without being redirects — following
 * them would replace the observed failure with an unrelated map.
 * See https://fetch.spec.whatwg.org/#redirect-status
 */
export const isFetchRedirectStatus = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

const fetchFollowingApprovedRedirects = async (
  initialUrl: string,
  allowedOrigins: readonly string[],
  signal: AbortSignal | undefined,
  host: SourceMapFetchHost,
  observeResponse: (url: string) => void,
): Promise<{ response: Response; fetchedUrl: string } | undefined> => {
  let current = initialUrl;
  const visited = new Set<string>();
  for (;;) {
    if (signal?.aborted === true) throw signal.reason;
    if (!approvedUrl(current, allowedOrigins)) return undefined;
    if (visited.has(current)) throw new Error("source_map_redirect_loop");
    visited.add(current);
    const response = await promiseWithAbort(
      host.fetch(current, {
        method: "GET",
        headers: {
          Accept: "application/json, application/source-map+json;q=0.9",
        },
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        ...(signal === undefined ? {} : { signal }),
      }),
      signal,
    );
    observeResponse(current);
    if (signal !== undefined && signalIsAborted(signal)) {
      await response.body?.cancel(signal.reason).catch(() => undefined);
      throw signal.reason;
    }
    // `Location` is a redirect target only for Fetch redirect statuses.
    // Other 3xx responses retain their own HTTP failure (strict identity:
    // never replace the observed failure with an unrelated map).
    if (!isFetchRedirectStatus(response.status))
      return { response, fetchedUrl: current };
    const location = response.headers.get("location");
    if (location === null) return { response, fetchedUrl: current };
    await response.body?.cancel();
    try {
      current = new URL(location, current).href;
    } catch {
      throw new SourceMapRedirectLocationError(current, location);
    }
  }
};

const readBoundedText = async (
  response: Response,
  budget: { retainedBytes: number },
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<{ text: string; responseIdentity: ResponseIdentity }> => {
  if (response.body === null)
    return {
      text: "",
      responseIdentity: {
        sha256: createHash("sha256").digest("hex"),
        bytes: 0,
        representation: "fetch-response-body-bytes",
      },
    };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal?.aborted === true) throw signal.reason;
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      const nextBytes = value?.byteLength ?? 0;
      if (budget.retainedBytes + bytes + nextBytes > maxBytes) {
        await reader.cancel(new SourceMapSizeLimitError());
        throw new SourceMapSizeLimitError();
      }
      if (value !== undefined) chunks.push(value);
      bytes += nextBytes;
    }
  } finally {
    // Aborting cancels the reader in readWithAbort. It owns the pending read
    // until that cancellation settles, so releasing the lock here can throw.
    if (signal?.aborted !== true) reader.releaseLock();
  }
  budget.retainedBytes += bytes;
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const responseIdentity: ResponseIdentity = {
    sha256: createHash("sha256").update(joined).digest("hex"),
    bytes,
    representation: "fetch-response-body-bytes",
  };
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        joined,
      ),
      responseIdentity,
    };
  } catch {
    throw new SourceMapEncodingError(responseIdentity);
  }
};

const readWithAbort = <T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal | undefined,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>["read"]>>> => {
  if (signal === undefined) return reader.read();
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void reader.read().then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (cause: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        void reader.cancel(cause).catch(() => undefined);
        reject(cause);
      },
    );
  });
};

const signalIsAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const promiseWithAbort = (
  promise: Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Response> => {
  if (signal === undefined) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (response) => {
        if (settled || signal.aborted) {
          void response.body?.cancel(signal.reason).catch(() => undefined);
          if (!settled) {
            settled = true;
            cleanup();
            reject(signal.reason);
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(response);
      },
      (cause: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause);
      },
    );
    if (signal.aborted) abort();
  });
};

const normalizeSourceMap = (
  request: WebSourceMapRequest,
  text: string,
  responseIdentity: ResponseIdentity,
  fetchedUrl: string,
  context: SourceMapDecodeContext,
): WebSourceMapItem => {
  const retainedBytesBeforeMap = context.budget.expandedBytes;
  const textBytes =
    jsonByteLength(text) +
    artifactMetadataBytes("application/source-map+json", text) -
    4;
  const successBytes =
    retainedBytesBeforeMap -
    SOURCE_MAP_FAILURE_ENVELOPE_BYTES +
    SOURCE_MAP_SUCCESS_ENVELOPE_BYTES +
    textBytes;
  if (successBytes > SOURCE_MAP_OUTPUT_BYTES)
    return emptySourceMapItem(
      request,
      "fetch_failed",
      "Source-map response text exceeds the 32 MiB source-map output budget; JSON parsing and source-map decoding were not attempted.",
      fetchedUrl,
      responseIdentity,
    );
  const parsedJson = safeParseJson(sourceMapJsonText(text));
  if (!parsedJson.ok)
    return emptySourceMapItem(
      request,
      "invalid",
      "Source-map JSON is not a version 3 map.",
      fetchedUrl,
      responseIdentity,
    );
  context.budget.expandedBytes = successBytes;
  try {
    const check = (): void =>
      checkOperation(
        undefined,
        context.signal,
        context.deadlineAt,
        context.deadlineLimitation,
      );
    const inspected = inspectSourceMapValue(parsedJson.value, {
      profile: "browser-collection",
      budget: context.budget,
      check,
    });
    const sourcesByRaw = new Map<string, string>();
    const resolvedByRoot = prepareResolvedSources(
      inspected.leaves,
      fetchedUrl,
      context.budget,
      sourcesByRaw,
      check,
    );
    check();
    const decoded = decodeValidatedSourceMapLeaves(
      inspected.leaves,
      fetchedUrl,
      check,
    );
    const sourceJsonBytes = new Map<string, number>();
    const nameJsonBytes = new Map<string, number>();
    const originalSources: ParsedSourceMapItem["original_sources"] = [];
    let declarationIndex = 0;
    for (const { leaf } of decoded) {
      const resolvedSources = resolvedByRoot.get(leaf.map.sourceRoot ?? null);
      for (const [index, rawSource] of leaf.map.sources.entries()) {
        if ((index & 255) === 0) check();
        const resolved =
          rawSource === null ? null : (resolvedSources?.get(rawSource) ?? null);
        const sanitized =
          resolved === null ? null : cachedSanitized(sourcesByRaw, resolved);
        const content = leaf.map.sourcesContent?.[index] ?? null;
        const mediaType = sourceMediaType(resolved ?? rawSource);
        consumeExpandedBytes(
          context.budget,
          (sanitized === null
            ? 4
            : cachedJsonBytes(sourceJsonBytes, sanitized)) +
            sourceEntryOverheadBytes(index, declarationIndex) +
            (originalSources.length === 0 ? 0 : 1) +
            (content === null
              ? 0
              : jsonByteLength(content) +
                artifactMetadataBytes(mediaType, content) -
                4),
        );
        originalSources.push({
          source_index: index,
          declaration_index: declarationIndex++,
          source: sanitized,
          artifact:
            content === null ? null : createWebTextArtifact(content, mediaType),
        });
      }
    }
    const mappings: ParsedSourceMapItem["mappings"] = [];
    declarationIndex = 0;
    for (const { leaf, rows } of decoded) {
      const resolvedSources = resolvedByRoot.get(leaf.map.sourceRoot ?? null);
      const declarationBase = declarationIndex;
      declarationIndex += leaf.map.sources.length;
      for (const [line, row] of rows.entries()) {
        if ((line & 255) === 0) check();
        for (const segment of row) {
          if (segment.length === 1) continue;
          const rawSource = leaf.map.sources[segment[1]];
          if (rawSource === undefined) continue;
          const resolved =
            rawSource === null
              ? null
              : (resolvedSources?.get(rawSource) ?? null);
          const source =
            resolved === null ? null : cachedSanitized(sourcesByRaw, resolved);
          const name =
            segment.length === 5 ? (leaf.map.names[segment[4]] ?? null) : null;
          const generatedLine = leaf.offset.line + line + 1;
          const generatedColumn =
            segment[0] + (line === 0 ? leaf.offset.column : 0);
          consumeExpandedBytes(
            context.budget,
            (source === null ? 4 : cachedJsonBytes(sourceJsonBytes, source)) +
              (name === null ? 4 : cachedJsonBytes(nameJsonBytes, name)) +
              mappingRowBytes(
                segment[1],
                declarationBase + segment[1],
                generatedLine,
                generatedColumn,
                segment[2] + 1,
                segment[3],
              ) +
              (mappings.length === 0 ? 0 : 1),
          );
          mappings.push({
            source_index: segment[1],
            declaration_index: declarationBase + segment[1],
            generated_line: generatedLine,
            generated_column: generatedColumn,
            source,
            original_line: segment[2] + 1,
            original_column: segment[3],
            name,
          });
        }
      }
    }
    const modules = originalModuleEdges(originalSources, check, (edge) =>
      consumeExpandedBytes(
        context.budget,
        Buffer.byteLength(JSON.stringify(edge)) + 1,
      ),
    );
    check();
    if (modules.incomplete.length > 0)
      consumeExpandedBytes(
        context.budget,
        jsonByteLength(
          `Module edges are incomplete: ${modules.incomplete.length} of ${originalSources.filter(({ artifact }) => artifact !== null).length} original sources could not be parsed in full (${modules.incomplete.join(", ")}).`,
        ) - 4,
      );
    const parsed = {
      ...sourceMapContext(request, fetchedUrl),
      artifact: sourceMapTextArtifact(text, responseIdentity),
      original_sources: originalSources,
      original_module_edges: modules.edges,
      mappings,
    };
    check();
    return modules.incomplete.length === 0
      ? { ...parsed, status: "included", limitation: null }
      : {
          ...parsed,
          status: "partial",
          limitation: `Module edges are incomplete: ${modules.incomplete.length} of ${originalSources.filter(({ artifact }) => artifact !== null).length} original sources could not be parsed in full (${modules.incomplete.join(", ")}).`,
        };
  } catch (cause: unknown) {
    // Failed interpretations retain completed body identity without consuming
    // the collection budget needed for later valid maps.
    context.budget.expandedBytes = retainedBytesBeforeMap;
    if (cause instanceof SourceMapFormatFailure && cause.reason === "limit") {
      return emptySourceMapItem(
        request,
        "fetch_failed",
        cause.message,
        fetchedUrl,
        responseIdentity,
      );
    }
    if (
      context.signal?.aborted === true ||
      cause instanceof SourceMapDeadlineError
    )
      throw cause;
    return emptySourceMapItem(
      request,
      "invalid",
      cause instanceof SourceMapFormatFailure &&
        cause.reason === "section-overlap"
        ? cause.message
        : "Source-map JSON mappings could not be decoded safely.",
      fetchedUrl,
      responseIdentity,
    );
  }
};

interface OriginalModuleEdges {
  readonly edges: ParsedSourceMapItem["original_module_edges"];
  /** Original sources whose dependency edges may be incomplete. */
  readonly incomplete: readonly string[];
}

const originalModuleEdges = (
  sources: ParsedSourceMapItem["original_sources"],
  check: () => void,
  beforeEdge: (
    edge: ParsedSourceMapItem["original_module_edges"][number],
  ) => void,
): OriginalModuleEdges => {
  const edges: ParsedSourceMapItem["original_module_edges"] = [];
  const incomplete: string[] = [];
  for (const source of sources) {
    check();
    if (source.artifact === null) continue;
    const sourceName = source.source;
    if (sourceName === null) {
      incomplete.push(
        `unnamed source at declaration ${String(source.declaration_index)}`,
      );
      continue;
    }
    const parsed = parseJavaScriptSource(
      source.artifact.text,
      originalSourcePath(sourceName),
    );
    check();
    if (parsed === null) {
      incomplete.push(sourceName);
      continue;
    }
    // A recovered program still yields the imports it did parse, but nodes
    // after an unrecoverable point are missing, so the edges are a subset.
    if (parsed.errors.length > 0) incomplete.push(sourceName);
    const seen = new Set<string>();
    let unboundRequires: ReadonlySet<string> | undefined;
    traverseJavaScriptAst(parsed, {
      enter: (node) => {
        check();
        const dependency = originalDependency(node);
        if (dependency === null) return;
        const { kind, specifier, requireCallee } = dependency;
        if (requireCallee !== undefined) {
          unboundRequires ??= new Set(
            analyzeParsedJavaScriptReferences(parsed, "require")
              .filter(
                ({ role, resolution }) =>
                  role === "read" && resolution === "unbound",
              )
              .map(
                ({ location }) =>
                  `${String(location.start.line)}:${String(location.start.column)}`,
              ),
          );
          const location = requireCallee.loc?.start;
          if (
            location === undefined ||
            !unboundRequires.has(
              `${String(location.line)}:${String(location.column)}`,
            )
          )
            return;
        }
        const key = `${kind}\0${specifier}`;
        if (seen.has(key)) return;
        seen.add(key);
        const edge = {
          declaration_index: source.declaration_index,
          from_source: sourceName,
          kind,
          specifier,
          resolved_source: resolveOriginalSource(specifier, sourceName),
        };
        beforeEdge(edge);
        edges.push(edge);
      },
    });
  }
  return { edges, incomplete };
};

/** Derive a language hint without changing the retained source URL identity. */
const originalSourcePath = (source: string): string => {
  const path = URL.parse(source)?.pathname ?? source;
  try {
    return decodeURIComponent(path);
  } catch (cause: unknown) {
    if (!(cause instanceof URIError)) throw cause;
    // A literal or malformed escape must not discard an otherwise useful hint.
    return path;
  }
};

const checkOperation = (
  callerSignal: AbortSignal | undefined,
  operationSignal: AbortSignal | undefined,
  deadlineAt: number,
  deadlineLimitation: string,
): void => {
  if (callerSignal?.aborted === true) throw callerSignal.reason;
  if (operationSignal?.aborted === true) throw operationSignal.reason;
  if (performance.now() >= deadlineAt)
    throw new SourceMapDeadlineError(deadlineLimitation);
};

const approvedUrl = (
  value: string,
  allowedOrigins: readonly string[],
): boolean => {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      allowedOrigins.includes(parsed.origin)
    );
  } catch (cause: unknown) {
    // Non-URL input is not an approved source-map URL.
    void cause;
    return false;
  }
};

const sourceMapContext = (
  request: WebSourceMapRequest,
  effectiveUrl: string | null = null,
) => ({
  script_key: request.scriptKey,
  declared_url: request.declaredUrl,
  effective_url: effectiveUrl,
});

const emptySourceMapItem = (
  request: WebSourceMapRequest,
  status: FailedSourceMapStatus,
  limitation: string,
  effectiveUrl: string | null = null,
  responseIdentity?: ResponseIdentity,
): WebSourceMapItem => {
  const base = {
    ...sourceMapContext(request, effectiveUrl),
    artifact: null,
    original_sources: [],
    original_module_edges: [],
    mappings: [],
    limitation:
      responseIdentity === undefined
        ? limitation
        : `${limitation} Response text was not retained; completed response body identity is available.`,
  };
  return status === "policy_filtered"
    ? { ...base, status }
    : {
        ...base,
        status,
        ...(responseIdentity === undefined
          ? {}
          : { response_identity: responseIdentity }),
      };
};

const sourceMapTextArtifact = (
  text: string,
  responseIdentity: ResponseIdentity,
): WebTextArtifact => ({
  sha256: responseIdentity.sha256,
  bytes: responseIdentity.bytes,
  media_type: "application/source-map+json",
  charset: "utf-8",
  text,
});

const sanitizeSource = (value: string): string => {
  try {
    return sanitizeBrowserUrl(new URL(value).href).url;
  } catch (cause: unknown) {
    // Non-URL sources are preserved verbatim.
    void cause;
    return value;
  }
};

/** Resolve and admit source identities once, before allocating public mapping rows. */
const prepareResolvedSources = (
  leaves: readonly SourceMapLeaf[],
  mapUrl: string,
  budget: { readonly expandedBytes: number; resolvedSourceBytes: number },
  sanitizedByResolved: Map<string, string>,
  check: () => void,
): ReadonlyMap<string | null, ReadonlyMap<string, string>> => {
  const resolvedByRoot = new Map<string | null, Map<string, string>>();
  let estimate = budget.expandedBytes;
  let resolvedBytes = budget.resolvedSourceBytes;
  for (const { map } of leaves) {
    let sourcesForRoot = resolvedByRoot.get(map.sourceRoot ?? null);
    if (sourcesForRoot === undefined) {
      sourcesForRoot = new Map();
      resolvedByRoot.set(map.sourceRoot ?? null, sourcesForRoot);
    }
    for (const source of map.sources) {
      check();
      if (source === null) continue;
      const sourceKey = source;
      let resolved = sourcesForRoot.get(sourceKey);
      if (resolved === undefined) {
        const candidate = resolveJavaScriptSourceMapUrl(
          source,
          map.sourceRoot,
          mapUrl,
        );
        if (candidate === null) continue;
        resolved = candidate;
      }
      const bytes = Buffer.byteLength(resolved, "utf8");
      if (bytes > SOURCE_MAP_RESPONSE_BYTES - resolvedBytes)
        throw resolvedSourceLimitFailure();
      resolvedBytes += bytes;
      sourcesForRoot.set(sourceKey, resolved);
      const sanitized = cachedSanitized(sanitizedByResolved, resolved);
      estimate += jsonByteLength(sanitized);
      if (estimate > WEB_SOURCE_MAP_LIMITS.outputBytes)
        throw expandedOutputFailure();
    }
  }
  budget.resolvedSourceBytes = resolvedBytes;
  return resolvedByRoot;
};

const consumeExpandedBytes = (
  budget: { expandedBytes: number },
  bytes: number,
): void => {
  if (bytes > WEB_SOURCE_MAP_LIMITS.outputBytes - budget.expandedBytes)
    throw expandedOutputFailure();
  budget.expandedBytes += bytes;
};

const expandedOutputFailure = (): SourceMapFormatFailure =>
  new SourceMapFormatFailure(
    "limit",
    `Expanded source-map evidence exceeds the ${String(WEB_SOURCE_MAP_LIMITS.outputBytes)}-byte public representation budget. ${noRuntimeOverrideSentence("That representation budget stays fixed.", "source_map_fetch_timeout_ms")}`,
  );

const sourceMapOutputError = (
  cause: SourceMapFormatFailure,
  options?: AnalysisErrorOptions,
): AnalysisResourceConstraintError =>
  new AnalysisResourceConstraintError(
    "analyze_web_bundle",
    "transport",
    cause.message,
    { maximum_source_map_output_bytes: SOURCE_MAP_OUTPUT_BYTES },
    { cause, ...options },
  );

const resolvedSourceLimitFailure = (): SourceMapFormatFailure =>
  new SourceMapFormatFailure(
    "limit",
    `Resolved source-map identities exceed the ${String(SOURCE_MAP_RESPONSE_BYTES / (1024 * 1024))} MiB decoder representation budget. ${noRuntimeOverrideSentence("That representation budget stays fixed.", "source_map_fetch_timeout_ms")}`,
  );

const artifactMetadataBytes = (mediaType: string, text: string): number =>
  Buffer.byteLength(
    JSON.stringify({
      sha256: "0".repeat(64),
      bytes: Buffer.byteLength(text),
      media_type: mediaType,
      charset: "utf-8",
      text: "",
    }),
  ) - 2;

// Price invariant envelopes once using the producer's representation. Dynamic
// identities keep their own charges when the map's envelope changes.
const EMPTY_SOURCE_MAP_FAILURE = emptySourceMapItem(
  { scriptKey: "", declaredUrl: "", fetchUrl: "" },
  "fetch_failed",
  "x".repeat(SOURCE_MAP_FAILURE_LIMITATION_RESERVE),
);
const SOURCE_MAP_FAILURE_ENVELOPE_BYTES =
  Buffer.byteLength(JSON.stringify(EMPTY_SOURCE_MAP_FAILURE)) - 4;
const SOURCE_MAP_SUCCESS_ENVELOPE_BYTES =
  Buffer.byteLength(
    JSON.stringify({
      ...EMPTY_SOURCE_MAP_FAILURE,
      status: "included",
      limitation: null,
    }),
  ) - 4;

const sourceMapFailureReservation = (
  request: WebSourceMapRequest,
  effectiveUrl: string | null = null,
  limitation?: string,
  status: FailedSourceMapStatus = "fetch_failed",
): number =>
  SOURCE_MAP_FAILURE_ENVELOPE_BYTES +
  jsonByteLength(request.declaredUrl) +
  jsonByteLength(request.scriptKey) +
  (effectiveUrl === null ? 0 : jsonByteLength(effectiveUrl) - 4) +
  Math.max(
    0,
    (limitation === undefined ? 0 : jsonByteLength(limitation)) -
      SOURCE_MAP_FAILURE_LIMITATION_RESERVE -
      2,
  ) +
  jsonByteLength(status) -
  jsonByteLength("fetch_failed");

const sourceEntryOverheadBytes = (
  sourceIndex: number,
  declarationIndex: number,
): number =>
  Buffer.byteLength(
    `{"source_index":${String(sourceIndex)},"declaration_index":${String(declarationIndex)},"source":,"artifact":null}`,
  );

const cachedJsonBytes = (cache: Map<string, number>, value: string): number => {
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const bytes = jsonByteLength(value);
  cache.set(value, bytes);
  return bytes;
};

const cachedSanitized = (cache: Map<string, string>, value: string): string => {
  const cached = cache.get(value);
  if (cached !== undefined) return cached;
  const sanitized = sanitizeSource(value);
  cache.set(value, sanitized);
  return sanitized;
};

const mappingRowBytes = (
  sourceIndex: number,
  declarationIndex: number,
  generatedLine: number,
  generatedColumn: number,
  originalLine: number,
  originalColumn: number,
): number =>
  Buffer.byteLength(
    `{"source_index":${String(sourceIndex)},"declaration_index":${String(declarationIndex)},"generated_line":${String(generatedLine)},"generated_column":${String(generatedColumn)},"source":,"original_line":${String(originalLine)},"original_column":${String(originalColumn)},"name":}`,
  );

const resolveOriginalSource = (
  specifier: string,
  base: string,
): string | null => {
  if (!isUrlLikeModuleSpecifier(specifier)) return null;
  try {
    return sanitizeSource(new URL(specifier, base).href);
  } catch (cause: unknown) {
    // Unresolvable source specifiers are represented by null.
    void cause;
    return null;
  }
};

const sourceMediaType = (source: string | null): string => {
  const path = source === null ? null : originalSourcePath(source);
  return path?.endsWith(".ts") ||
    path?.endsWith(".tsx") ||
    path?.endsWith(".mts") ||
    path?.endsWith(".cts")
    ? "text/typescript"
    : "text/javascript";
};

const originalDependency = (
  node: t.Node,
): {
  readonly kind: ParsedSourceMapItem["original_module_edges"][number]["kind"];
  readonly specifier: string;
  readonly requireCallee?: t.Identifier;
} | null => {
  const moduleSource = semanticStaticModuleSource(node);
  if (moduleSource !== null)
    return { kind: "static_import", specifier: moduleSource.value };
  if (t.isImportExpression(node)) {
    const specifier = stringValue(node.source);
    return specifier === undefined
      ? null
      : { kind: "dynamic_import", specifier };
  }
  if (
    (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
    t.isIdentifier(node.callee, { name: "require" })
  ) {
    const specifier = stringValue(node.arguments[0]);
    return specifier === undefined
      ? null
      : { kind: "require", specifier, requireCallee: node.callee };
  }
  // `import x = require("m")` is only legal at module top level and always
  // refers to the host loader, so it needs no unbound-`require` check. An
  // entity-name alias or an erased `import type` declares no dependency.
  if (t.isTSImportEqualsDeclaration(node)) {
    const specifier = semanticImportEqualsSpecifier(node);
    return specifier === null ? null : { kind: "require", specifier };
  }
  return null;
};
