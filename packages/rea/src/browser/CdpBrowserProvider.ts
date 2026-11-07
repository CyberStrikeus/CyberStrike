import type { BrowserObservationPort } from "../application/BrowserObservationPort.js";
import type {
  ProviderIdentity,
  ExecutionOptions,
} from "../application/AnalysisProvider.js";
import {
  sanitizeBrowserUrl,
  type InspectWebPageInput,
  type ListBrowserTargetsInput,
} from "../domain/browserObservation.js";
import {
  browserTargetListSchema,
  webPageInspectionSchema,
  type BrowserTargetList,
  type WebPageInspection,
} from "../domain/browserObservationSchemas.js";
import {
  IsolatedWebBundleAnalyzer,
  type WebBundleAnalysisAdmission,
} from "./IsolatedWebBundleAnalyzer.js";
import { sourceMapsWithCaptureExclusions } from "../domain/webSourceMapCoverage.js";
import type {
  AnalyzeWebBundleInput,
  WebBundleAnalysis,
  WebSourceMaps,
} from "../domain/webBundleAnalysis.js";
import {
  webObservationSessionSchema,
  type ObserveWebSessionInput,
  type WebObservationSession,
} from "../domain/browserSession.js";
import {
  webMcpDiscoverySchema,
  type DiscoverWebMcpToolsInput,
  type WebMcpDiscovery,
} from "../domain/webMcpDiscovery.js";
import {
  browserCaptureComparisonSchema,
  compareBrowserCaptures,
  type BrowserCaptureComparison,
  type BrowserCaptureComparisonInput,
} from "../domain/browserCaptureComparison.js";
import {
  webScreenshotDiffSchema,
  webScreenshotSchema,
  type CaptureWebScreenshotInput,
  type CompareWebScreenshotsInput,
  type WebScreenshot,
  type WebScreenshotDiff,
} from "../domain/webScreenshot.js";
import {
  AnalysisError,
  type AnalysisPartialObservation,
} from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  hasCdpTargetWebSocket,
  type CdpEndpointDiscovery,
  type CdpEndpointTarget,
} from "./CdpEndpoint.js";
import {
  attachCdpTargetSession,
  closeCdpTargetSession,
  openCdpEndpoint,
  openCdpTargetSession,
  type CdpTargetSession,
} from "./CdpTargetSession.js";
import { capturePage, type CapturedPage } from "./CdpPageCapture.js";
import { selectedCdpCommandTimeoutMs } from "../domain/browserDeadline.js";
import { fetchWebSourceMaps } from "./WebSourceMapFetcher.js";
import { authorizeCdpTarget } from "./CdpAuthorizedTarget.js";
import { observeCdpSession } from "./CdpObservationSession.js";
import { discoverWebMcp } from "./CdpWebMcpDiscovery.js";
import { captureCdpScreenshot } from "./CdpScreenshot.js";
import { comparePngScreenshots } from "./PngVisualDiff.js";

import { CDP_BROWSER_PROVIDER_IDENTITY } from "./providerIdentities.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import {
  CdpTargetSessionOwner,
  bindCdpTransportCleanup,
} from "./CdpTargetSessionOwner.js";
const CLEANUP_DOMAINS = [
  "Network",
  "Debugger",
  "Runtime",
  "Page",
  "WebMCP",
] as const;

/** Passive browser observation through a selected user-owned CDP endpoint. */
export class CdpBrowserProvider implements BrowserObservationPort {
  readonly #owner = new CdpTargetSessionOwner();
  readonly #bundleAnalyzer: IsolatedWebBundleAnalyzer;

  constructor(admission?: WebBundleAnalysisAdmission) {
    this.#bundleAnalyzer = new IsolatedWebBundleAnalyzer(undefined, admission);
  }

  async close(): Promise<void> {
    const outcomes = await Promise.allSettled([
      this.#owner.close(),
      this.#bundleAnalyzer.close(),
    ]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as unknown] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const typed = failures.filter(
        (failure): failure is AnalysisError => failure instanceof AnalysisError,
      );
      throw new ProviderCleanupError(
        CDP_BROWSER_PROVIDER_IDENTITY.id,
        typed.flatMap((failure) => failure.cleanupResources),
        { reason: "Browser transport and analyzer cleanup remain incomplete" },
        {
          operation: "analyze_web_bundle",
          cause: new AggregateError(failures),
        },
      ).bindCleanupDependencies(typed);
    }
  }

  identity(): ProviderIdentity {
    return CDP_BROWSER_PROVIDER_IDENTITY;
  }

  async listTargets(
    input: ListBrowserTargetsInput,
    options: ExecutionOptions = {},
  ): Promise<Result<BrowserTargetList, AnalysisError>> {
    try {
      const endpoint = await openCdpEndpoint(
        input.cdp_endpoint,
        "list_browser_targets",
        options.signal,
        undefined,
        this.#owner,
      );
      if (endpoint.connection !== undefined)
        await this.#owner.finish(endpoint.connection);
      const { discovery } = endpoint;
      const selected = selectTargets(
        discovery,
        input.allowed_origins.length === 0
          ? undefined
          : new Set(input.allowed_origins),
      );
      return ok(
        browserTargetListSchema.parse({
          browser: discovery.version,
          targets: selected.allowed,
          excluded: selected.excluded,
          limitations: [
            ...(discovery.limitations ?? []),
            input.allowed_origins.length === 0
              ? "All page targets with supported HTTP(S) URLs are listed."
              : "Only page targets whose current URL matches an explicitly requested exact origin are listed.",
            ...(selected.unconnectable === 0
              ? []
              : [
                  `${String(selected.unconnectable)} otherwise allowed page target(s) lacked a validated direct CDP WebSocket and were excluded.`,
                ]),
            ...(selected.allowed.some((target) => target.attached === null)
              ? [
                  "CDP discovery could not establish debugger attachment state for one or more targets.",
                ]
              : []),
          ],
        }),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "list_browser_targets", options.signal));
    }
  }

  async inspectPage(
    input: InspectWebPageInput,
    options: ExecutionOptions = {},
  ): Promise<Result<WebPageInspection, AnalysisError>> {
    try {
      const captured = await this.#capture(input, options, "inspect_web_page");
      return ok(webPageInspectionSchema.parse(captured.inspection));
    } catch (cause: unknown) {
      return err(providerError(cause, "inspect_web_page", options.signal));
    }
  }

  async analyzeBundle(
    input: AnalyzeWebBundleInput,
    options: ExecutionOptions = {},
  ): Promise<Result<WebBundleAnalysis, AnalysisError>> {
    const admission = await this.#bundleAnalyzer.reserve();
    if (!admission.ok) return admission;
    let captured: CapturedPage | undefined;
    try {
      captured = await this.#capture(input, options, "analyze_web_bundle");
      let sourceMaps: WebSourceMaps | undefined;
      if (input.fetch_source_maps) {
        const fetched = await fetchWebSourceMaps(
          captured.sourceMapRequests,
          {
            ...input,
            allowed_origins:
              input.allowed_origins.length > 0
                ? input.allowed_origins
                : [captured.inspection.target.origin],
          },
          options.signal,
        );
        if (!fetched.ok) {
          const partial = fetched.error.partialObservation;
          if (
            partial !== undefined &&
            "kind" in partial &&
            partial.kind === "web-source-map-fetch"
          )
            fetched.error.partialObservation = {
              kind: "web-bundle-acquisition",
              inspection: captured.inspection,
              source_maps: sourceMapsWithCaptureExclusions(
                partial.source_maps,
                captured.inspection.completeness.excluded,
              ),
              analysis_status: "not_performed",
            };
          else fetched.error.retainPartialObservation(captured.inspection);
          return err(fetched.error);
        }
        sourceMaps = sourceMapsWithCaptureExclusions(
          fetched.value,
          captured.inspection.completeness.excluded,
        );
      }
      return await this.#bundleAnalyzer.analyze(
        captured.inspection,
        sourceMaps ?? {
          status: "not_requested",
          requested: 0,
          processed: 0,
          items: [],
        },
        input,
        options.signal,
      );
    } catch (cause: unknown) {
      // Capture and analyzer work can still throw the exact caller reason.
      if (options.signal?.aborted === true && cause === options.signal.reason) {
        return err(
          new AnalysisCancelledError("analyze_web_bundle", {
            cause,
            ...(captured === undefined
              ? {}
              : { partialObservation: captured.inspection }),
          }),
        );
      }
      return err(providerError(cause, "analyze_web_bundle", options.signal));
    } finally {
      this.#bundleAnalyzer.releaseReservation();
    }
  }

  async observeSession(
    input: ObserveWebSessionInput,
    options: ExecutionOptions = {},
  ): Promise<Result<WebObservationSession, AnalysisError>> {
    try {
      return ok(
        webObservationSessionSchema.parse(
          await withTargetSession(
            input,
            "observe_web_session",
            options,
            observeCdpSession,
            this.#owner,
          ),
        ),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "observe_web_session", options.signal));
    }
  }

  async discoverWebMcpTools(
    input: DiscoverWebMcpToolsInput,
    options: ExecutionOptions = {},
  ): Promise<Result<WebMcpDiscovery, AnalysisError>> {
    try {
      return ok(
        webMcpDiscoverySchema.parse(
          await withTargetSession(
            input,
            "discover_webmcp_tools",
            options,
            discoverWebMcp,
            this.#owner,
          ),
        ),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "discover_webmcp_tools", options.signal));
    }
  }

  async compareCaptures(
    input: BrowserCaptureComparisonInput,
  ): Promise<Result<BrowserCaptureComparison, AnalysisError>> {
    try {
      return ok(
        browserCaptureComparisonSchema.parse(compareBrowserCaptures(input)),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "compare_web_captures"));
    }
  }

  async captureScreenshot(
    input: CaptureWebScreenshotInput,
    options: ExecutionOptions = {},
  ): Promise<Result<WebScreenshot, AnalysisError>> {
    try {
      return ok(
        webScreenshotSchema.parse(
          await withTargetSession(
            input,
            "capture_web_screenshot",
            options,
            captureCdpScreenshot,
            this.#owner,
          ),
        ),
      );
    } catch (cause: unknown) {
      return err(
        providerError(cause, "capture_web_screenshot", options.signal),
      );
    }
  }

  async compareScreenshots(
    input: CompareWebScreenshotsInput,
  ): Promise<Result<WebScreenshotDiff, AnalysisError>> {
    try {
      return ok(webScreenshotDiffSchema.parse(comparePngScreenshots(input)));
    } catch (cause: unknown) {
      if (cause instanceof TypeError)
        return err(
          new AnalysisInputError("compare_web_screenshots", { cause }, [
            { path: [], reason: "invalid_format", message: cause.message },
          ]),
        );
      return err(providerError(cause, "compare_web_screenshots"));
    }
  }

  async #capture(
    input: InspectWebPageInput,
    options: ExecutionOptions,
    operation: "inspect_web_page" | "analyze_web_bundle",
  ): Promise<CapturedPage> {
    return await withTargetSession(
      input,
      operation,
      options,
      async (session) => await capturePage({ ...session, operation }),
      this.#owner,
      (captured) => captured.inspection,
    );
  }
}

/** Facts and transport handed to one target operation. */
interface CdpTargetOperationSession<Input> {
  readonly connection: CdpTargetSession["connection"];
  readonly sessionId: CdpTargetSession["sessionId"];
  readonly discovery: CdpEndpointDiscovery;
  readonly target: CdpEndpointTarget;
  readonly input: Input;
  readonly signal?: AbortSignal;
  readonly progress?: NonNullable<ExecutionOptions["progress"]>;
}

/** Authorize one discovered target, run work in its session, and close REA's socket. */
const withTargetSession = async <
  Input extends Pick<
    InspectWebPageInput,
    "cdp_endpoint" | "target_id" | "allowed_origins" | "command_timeout_ms"
  >,
  Output,
>(
  input: Input,
  operation: BrowserObservationOperation,
  options: ExecutionOptions,
  work: (session: CdpTargetOperationSession<Input>) => Promise<Output>,
  owner: CdpTargetSessionOwner,
  partialObservation?: (output: Output) => AnalysisPartialObservation,
): Promise<Output> => {
  const commandTimeoutMs = selectedCdpCommandTimeoutMs(
    input.command_timeout_ms,
  );
  const endpoint = await openCdpEndpoint(
    input.cdp_endpoint,
    operation,
    options.signal,
    undefined,
    owner,
    commandTimeoutMs,
  );
  let targetSession: CdpTargetSession | undefined;
  let outcome: Result<Output, unknown>;
  let cleanupFailure: AnalysisError | undefined;
  try {
    const { target, allowedOrigins } = authorizeCdpTarget(
      endpoint.discovery,
      input,
      operation,
    );
    // The authorization owner already derived the target origin scope.
    const scopedInput =
      input.allowed_origins.length > 0
        ? input
        : { ...input, allowed_origins: [...allowedOrigins] };
    targetSession =
      endpoint.connection === undefined
        ? await openCdpTargetSession(
            endpoint.discovery,
            target,
            operation,
            options.signal,
            { commandTimeoutMs },
            owner,
          )
        : await attachCdpTargetSession(
            endpoint.connection,
            target,
            operation,
            options.signal,
            owner,
          );
    outcome = ok(
      await work({
        connection: targetSession.connection,
        sessionId: targetSession.sessionId,
        discovery: endpoint.discovery,
        target,
        input: scopedInput,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.progress === undefined
          ? {}
          : { progress: options.progress }),
      }),
    );
  } catch (cause: unknown) {
    outcome = err(cause);
  }
  try {
    if (targetSession !== undefined)
      await closeCdpTargetSession(
        targetSession,
        CLEANUP_DOMAINS,
        options.signal,
        owner,
      );
    if (
      endpoint.connection !== undefined &&
      endpoint.connection !== targetSession?.connection
    )
      await owner.finish(endpoint.connection);
  } catch (cause: unknown) {
    cleanupFailure =
      cause instanceof AnalysisError
        ? cause
        : new ProviderCleanupError(
            "rea-cdp-browser",
            [input.target_id],
            { reason: cause instanceof Error ? cause.message : String(cause) },
            { operation, cause },
          );
  }

  if (outcome.ok && options.signal?.aborted === true)
    outcome = err(
      partialObservation === undefined
        ? new AnalysisCancelledError(operation, {
            cause: options.signal.reason,
          })
        : new AnalysisCancelledError(operation, {
            cause: options.signal.reason,
            partialObservation: partialObservation(outcome.value),
          }),
    );

  if (cleanupFailure !== undefined) {
    if (!outcome.ok && outcome.error instanceof AnalysisError)
      throw bindCdpTransportCleanup(
        cleanupFailure,
        analysisErrorWithCleanupFailure(
          outcome.error,
          cleanupFailure,
          operation,
        ),
      );
    if (!outcome.ok)
      throw new AggregateError(
        [outcome.error, cleanupFailure],
        `CDP operation ${operation} failed and cleanup remains incomplete.`,
        { cause: outcome.error },
      );
    throw bindCdpTransportCleanup(
      cleanupFailure,
      new ProviderCleanupError(
        "rea-cdp-browser",
        cleanupFailure.cleanupResources,
        { cleanup_error: cleanupFailure.message },
        {
          operation,
          cause: cleanupFailure,
          ...(partialObservation === undefined
            ? {}
            : { partialObservation: partialObservation(outcome.value) }),
        },
      ),
    );
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};

const selectTargets = (
  discovery: CdpEndpointDiscovery,
  allowedOrigins: ReadonlySet<string> | undefined,
): {
  readonly allowed: readonly BrowserTargetList["targets"][number][];
  readonly excluded: BrowserTargetList["excluded"];
  readonly unconnectable: number;
} => {
  const allowed = [];
  let disallowedOrigin = 0;
  let unsupportedUrl = 0;
  let nonPage = 0;
  let unconnectable = 0;
  for (const target of discovery.targets) {
    if (target.type !== "page") {
      nonPage += 1;
      continue;
    }
    const url = sanitizeBrowserUrl(target.url);
    if (url.origin === null) {
      unsupportedUrl += 1;
      continue;
    }
    if (allowedOrigins !== undefined && !allowedOrigins.has(url.origin)) {
      disallowedOrigin += 1;
      continue;
    }
    if (!hasCdpTargetWebSocket(discovery, target)) {
      unconnectable += 1;
      continue;
    }
    allowed.push({
      target_id: target.id,
      type: target.type,
      title: target.title,
      url: url.url,
      origin: url.origin,
      attached: target.attached,
    });
  }
  allowed.sort((left, right) =>
    compareUnicodeCodePoints(left.target_id, right.target_id),
  );
  return {
    allowed,
    excluded: {
      disallowed_origin: disallowedOrigin,
      unsupported_url: unsupportedUrl,
      non_page: nonPage,
    },
    unconnectable,
  };
};

const providerError = (
  cause: unknown,
  operation: BrowserObservationOperation,
  signal?: AbortSignal,
): AnalysisError =>
  cause instanceof BrowserObservationError
    ? cause.forOperation(operation)
    : cause instanceof AnalysisError
      ? cause
      : signal?.aborted === true
        ? new AnalysisCancelledError(operation, { cause })
        : new ProviderAdapterError(
            CDP_BROWSER_PROVIDER_IDENTITY.id,
            operation,
            {
              cause,
            },
          );
