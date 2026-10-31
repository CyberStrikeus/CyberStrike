import type {
  BrowserNetworkBody,
  BrowserNetworkHeaders,
  BrowserNetworkContentSelection,
} from "../../domain/browserNetworkEvidence.js";
import type { BrowserScenarioCaptureLimits } from "../../domain/browserScenarioCaptureLimits.js";
import type {
  BrowserScenarioEventAdmission,
  BrowserScenarioEventBudgetReason,
  BrowserScenarioEvent,
} from "../../domain/browserScenarioCaptureValues.js";
import type { BrowserScenarioSecrets } from "../BrowserScenarioSecrets.js";
import { PLAYWRIGHT_NETWORK_READ_TIMEOUT_MS } from "../PlaywrightExecutionBoundary.js";
import {
  readBoundedResponseBody,
  MAX_SAVED_RESPONSE_BYTES,
} from "../BrowserScenarioResponseValues.js";
import {
  captureNetworkBody,
  captureNetworkHeaders,
  type NetworkBodyCapture,
  type NetworkHeadersSource,
  type NetworkReadOptions,
} from "./PlaywrightNetworkContent.js";

/** Request object identity is the association key, never URL or receipt adjacency. */
export interface ScenarioNetworkRequest extends NetworkHeadersSource {
  method(): string;
  url(): string;
  resourceType(): string;
  postDataBuffer(): Buffer | null;
  redirectedFrom(): ScenarioNetworkRequest | null;
  failure(): { errorText: string } | null;
  /** Browser resource timing: `startTime` in epoch milliseconds (0 until known), `responseEnd` after it (-1 when unknown). */
  timing?(): { readonly startTime: number; readonly responseEnd: number };
  sizes?(): Promise<{ readonly responseBodySize: number }>;
}

/** The browser's own start and duration for a finished or failed request, as far as it reported them. */
const browserTiming = (
  request: ScenarioNetworkRequest,
): { readonly started_at?: string; readonly elapsed_ms?: number } => {
  const timing = request.timing?.();
  if (timing === undefined) return {};
  const { startTime, responseEnd } = timing;
  return {
    ...(Number.isFinite(startTime) && startTime > 0
      ? { started_at: new Date(startTime).toISOString() }
      : {}),
    ...(Number.isFinite(responseEnd) && responseEnd >= 0
      ? { elapsed_ms: responseEnd }
      : {}),
  };
};

/** A response's body becomes eligible for reading only after requestfinished. */
export interface ScenarioNetworkResponse extends NetworkHeadersSource {
  request(): ScenarioNetworkRequest;
  url(): string;
  status(): number;
  body(): Promise<Buffer>;
}

type UnindexedNetworkEvent = BrowserScenarioEvent extends infer Event
  ? Event extends BrowserScenarioEvent
    ? Event["kind"] extends
        | "request"
        | "response"
        | "request-finished"
        | "request-failed"
        | "request-unfinished"
        | "network-content"
      ? Omit<Event, "sequence" | "step_index">
      : never
    : never
  : never;

interface Transaction {
  readonly id: string;
  readonly redirectedFrom: string | null;
  readonly redirectedFromState: "root" | "unknown" | undefined;
  response?: {
    readonly source: ScenarioNetworkResponse;
    readonly sequence: number;
  };
  terminal?: "finished" | "failed";
  responseScheduled: boolean;
  requestObserved: boolean;
}

interface QueuedContentRead {
  readonly run: () => Promise<void>;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

interface NetworkCaptureOptions {
  readonly selection: BrowserNetworkContentSelection;
  readonly limits: BrowserScenarioCaptureLimits;
  readonly secrets: BrowserScenarioSecrets;
  readonly emit: (
    event: UnindexedNetworkEvent,
  ) => BrowserScenarioEventAdmission;
  /** Check aggregate event capacity before redacting producer-owned metadata. */
  readonly admitText: (
    kind: UnindexedNetworkEvent["kind"],
    values: Iterable<string>,
  ) => BrowserScenarioEventAdmission;
  readonly admitContentBody: (input: {
    readonly transactionId: string;
    readonly sourceEventSequence: number;
    readonly phase: "request" | "response";
    readonly headers: BrowserNetworkHeaders;
    readonly observedBytes: number;
    readonly allocationBytes: number;
    readonly mediaType: string | undefined;
  }) => BrowserScenarioEventAdmission;
  readonly omitNetwork: (
    transactionId: string,
    kind: UnindexedNetworkEvent["kind"],
    reason: BrowserScenarioEventBudgetReason,
  ) => void;
  readonly omitEvent: (
    kind: UnindexedNetworkEvent["kind"],
    reason: BrowserScenarioEventBudgetReason,
  ) => void;
  readonly signal?: AbortSignal;
  /** Production uses 5s; a fixture can supply its own bounded-read clock. */
  readonly readTimeoutMs?: number;
}

/** Captures correlated network phases and drains selected content before browser cleanup. */
export class PlaywrightScenarioNetwork {
  private readonly transactions = new Map<
    ScenarioNetworkRequest,
    Transaction
  >();
  private readonly omittedRequests = new WeakSet<ScenarioNetworkRequest>();
  private readonly omittedPhases = new WeakMap<
    ScenarioNetworkRequest,
    Set<string>
  >();
  private totalTransactions = 0;
  private omittedTransactionCount = 0;
  private firstOmittedTransaction = 0;
  private lastOmittedTransaction = 0;
  /** One request and one response-content job at most per admitted transaction. */
  private readonly pending: Promise<void>[] = [];
  private readonly queuedReads: QueuedContentRead[] = [];
  private readonly gaps = new Set<string>();
  private accepting = true;
  private activeReads = 0;
  private readonly readOptions: NetworkReadOptions;
  private readonly limits: BrowserScenarioCaptureLimits;

  constructor(private readonly options: NetworkCaptureOptions) {
    this.limits = options.limits;
    this.readOptions = {
      timeoutMs: options.readTimeoutMs ?? PLAYWRIGHT_NETWORK_READ_TIMEOUT_MS,
      maxBodyBytes: this.limits.max_network_body_bytes,
      maxBodyAllocationBytes: this.limits.max_network_body_allocation_bytes,
      maxHeaderAllocationBytes: this.limits.max_network_header_allocation_bytes,
      maxMetadataAllocationBytes:
        this.limits.max_network_metadata_allocation_bytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
  }

  /** Observe a request start, retaining the producer's redirect relationship when known. */
  request(request: ScenarioNetworkRequest): void {
    if (!this.accepting) return;
    const transaction = this.transaction(request);
    if (transaction === undefined) {
      this.omitOmittedTransactionPhase(request, "request");
      if (
        this.options.selection.request_body ||
        this.options.selection.header_values
      )
        this.omitOmittedTransactionContent(request, "request");
      return;
    }
    if (transaction.requestObserved) return;
    const observedAt = new Date().toISOString();
    if (
      !this.admitMetadata(transaction, "request", request, undefined, [
        observedAt,
      ])
    )
      return;
    transaction.requestObserved = true;
    const admission = this.options.emit({
      ...this.metadata(request, transaction),
      kind: "request",
      status: null,
      failure: null,
      observed_at: observedAt,
    });
    if (admission.status === "omitted") {
      this.options.omitNetwork(transaction.id, "request", admission.reason);
      return;
    }
    const sequence = admission.sequence;
    if (
      this.options.selection.request_body ||
      this.options.selection.header_values
    )
      this.collect({
        transaction,
        sequence,
        phase: "request",
        source: request,
      });
  }

  /** Observe response metadata without starting a potentially unfinished body read. */
  response(response: ScenarioNetworkResponse): void {
    if (!this.accepting) return;
    const request = response.request();
    const transaction = this.transaction(request);
    if (transaction === undefined) {
      this.omitOmittedTransactionPhase(request, "response");
      // Selection follows the observed response, independently of its eventual
      // terminal state. No omitted response body is acquired.
      if (
        this.options.selection.response_body ||
        this.options.selection.header_values
      )
        this.omitOmittedTransactionContent(request, "response");
      return;
    }
    if (
      !this.admitMetadata(
        transaction,
        "response",
        request,
        undefined,
        [],
        [{ source: response, url: response.url() }],
      )
    )
      return;
    const admission = this.options.emit({
      ...this.metadata(request, transaction),
      kind: "response",
      url: this.options.secrets.sanitizeUrl(response.url()),
      status: response.status(),
      header_names: this.headerNames(response),
      failure: null,
    });
    if (admission.status === "omitted") {
      this.options.omitNetwork(transaction.id, "response", admission.reason);
      return;
    }
    const sequence = admission.sequence;
    transaction.response = { source: response, sequence };
  }

  /** Record completion and read selected content through the response API. */
  finished(request: ScenarioNetworkRequest): void {
    if (!this.accepting) return;
    const transaction = this.transaction(request);
    if (transaction === undefined) {
      this.omitOmittedTransactionPhase(request, "request-finished");
      return;
    }
    transaction.terminal = "finished";
    const timing = browserTiming(request);
    if (
      !this.admitMetadata(
        transaction,
        "request-finished",
        request,
        undefined,
        timing.started_at === undefined ? [] : [timing.started_at],
      )
    )
      return;
    const admission = this.options.emit({
      ...this.metadata(request, transaction),
      kind: "request-finished",
      status: null,
      failure: null,
      ...timing,
    });
    if (admission.status === "omitted") {
      this.options.omitNetwork(
        transaction.id,
        "request-finished",
        admission.reason,
      );
      transaction.responseScheduled = true;
      return;
    }
    this.responseContent(transaction);
  }

  /** Preserve request failure separately from missing or unreadable response content. */
  failed(request: ScenarioNetworkRequest): void {
    if (!this.accepting) return;
    const transaction = this.transaction(request);
    if (transaction === undefined) {
      this.omitOmittedTransactionPhase(request, "request-failed");
      return;
    }
    transaction.terminal = "failed";
    const failure = request.failure()?.errorText || "Unknown request failure";
    const timing = browserTiming(request);
    if (
      !this.admitMetadata(transaction, "request-failed", request, undefined, [
        failure,
        ...(timing.started_at === undefined ? [] : [timing.started_at]),
      ])
    )
      return;
    const message = this.options.secrets.redact(failure);
    const admission = this.options.emit({
      ...this.metadata(request, transaction),
      kind: "request-failed",
      status: null,
      failure: message,
      ...timing,
    });
    if (admission.status === "omitted") {
      this.options.omitNetwork(
        transaction.id,
        "request-failed",
        admission.reason,
      );
      transaction.responseScheduled = true;
      return;
    }
    this.responseContent(transaction, {
      state: "unavailable",
      reason: "request-failed",
      message,
    });
  }

  /** Stop observing, mark unfinished transactions, and drain admitted content reads. */
  async finish(): Promise<void> {
    if (!this.accepting) {
      await this.settlePendingReads();
      return;
    }
    this.accepting = false;
    for (const [request, transaction] of this.transactions) {
      if (transaction.terminal === undefined) {
        if (!this.admitMetadata(transaction, "request-unfinished", request))
          continue;
        this.gaps.add(
          "Some network requests had not completed when capture ended; later activity is unknown.",
        );
        const admission = this.options.emit({
          ...this.metadata(request, transaction),
          kind: "request-unfinished",
          status: null,
          failure: null,
          reason:
            this.options.signal?.aborted === true
              ? "cancelled"
              : "capture-ended",
        });
        if (admission.status === "omitted") {
          this.options.omitNetwork(
            transaction.id,
            "request-unfinished",
            admission.reason,
          );
          transaction.responseScheduled = true;
          continue;
        }
        this.responseContent(transaction, {
          state: "unavailable",
          reason:
            this.options.signal?.aborted === true
              ? "cancelled"
              : "response-unfinished",
          message:
            "The response had not finished at the capture cutoff; no body read or refetch was attempted.",
        });
      }
    }
    await this.settlePendingReads();
  }

  private async settlePendingReads(): Promise<void> {
    const results = await Promise.allSettled(this.pending);
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed !== undefined) throw failed.reason;
  }

  /** Missing selected content contributes to aggregate completeness. */
  limitations(): readonly string[] {
    return [...this.gaps];
  }

  /** Source identity and readiness for the retained-event owner's final privacy pass. */
  sourcePrivacy(): ReadonlyMap<string, boolean> {
    return new Map(
      [...this.transactions].flatMap(([request, transaction]) =>
        this.options.secrets.hasResponseProtection(request)
          ? [
              [
                transaction.id,
                this.options.secrets.responseSecretsReady(request),
              ] as const,
            ]
          : [],
      ),
    );
  }

  omittedTransactionRange(): {
    readonly first_transaction_id: string;
    readonly last_transaction_id: string;
    readonly count: number;
    readonly reason: "max-network-transactions";
  } | null {
    return this.omittedTransactionCount === 0
      ? null
      : {
          first_transaction_id: `request-${String(this.firstOmittedTransaction)}`,
          last_transaction_id: `request-${String(this.lastOmittedTransaction)}`,
          count: this.omittedTransactionCount,
          reason: "max-network-transactions",
        };
  }

  private transaction(
    request: ScenarioNetworkRequest,
  ): Transaction | undefined {
    const known = this.transactions.get(request);
    if (known !== undefined) return known;
    if (this.omittedRequests.has(request)) return undefined;
    this.totalTransactions += 1;
    const id = `request-${String(this.totalTransactions)}`;
    if (this.transactions.size >= this.limits.max_network_transactions) {
      this.omittedRequests.add(request);
      if (this.omittedTransactionCount === 0)
        this.firstOmittedTransaction = this.totalTransactions;
      this.lastOmittedTransaction = this.totalTransactions;
      this.omittedTransactionCount += 1;
      this.gaps.add(
        `Network collection reached its ${String(this.limits.max_network_transactions)}-transaction resource budget; omitted transaction IDs are listed in events.omissions.network_transaction_range.`,
      );
      return undefined;
    }
    const predecessor = request.redirectedFrom();
    const predecessorTransaction =
      predecessor === null ? undefined : this.transactions.get(predecessor);
    const transaction: Transaction = {
      id,
      redirectedFrom: predecessorTransaction?.id ?? null,
      redirectedFromState:
        predecessor === null
          ? "root"
          : predecessorTransaction === undefined
            ? "unknown"
            : undefined,
      responseScheduled: false,
      requestObserved: false,
    };
    this.transactions.set(request, transaction);
    return transaction;
  }

  private admitProducerStrings(
    transaction: Transaction,
    kind: UnindexedNetworkEvent["kind"],
    values: Iterable<string>,
  ): boolean {
    const admission = this.options.admitText(kind, values);
    if (admission.status === "retained") return true;
    this.options.omitNetwork(transaction.id, kind, admission.reason);
    this.gaps.add(
      `Network ${kind} metadata was omitted for ${transaction.id} because ${admission.reason} was reached; network coverage is incomplete.`,
    );
    return false;
  }

  private omitOmittedTransactionPhase(
    request: ScenarioNetworkRequest,
    kind: UnindexedNetworkEvent["kind"],
  ): void {
    if (!this.omittedRequests.has(request)) return;
    if (!this.observeOmittedTransactionPhase(request, kind)) return;
    this.options.omitEvent(kind, "max-network-transactions");
  }

  private observeOmittedTransactionPhase(
    request: ScenarioNetworkRequest,
    phase: string,
  ): boolean {
    let observed = this.omittedPhases.get(request);
    if (observed === undefined) {
      observed = new Set();
      this.omittedPhases.set(request, observed);
    }
    if (observed.has(phase)) return false;
    observed.add(phase);
    return true;
  }

  private omitOmittedTransactionContent(
    request: ScenarioNetworkRequest,
    phase: "request" | "response",
  ): void {
    if (!this.omittedRequests.has(request)) return;
    if (
      !this.observeOmittedTransactionPhase(request, `network-content:${phase}`)
    )
      return;
    this.options.omitEvent("network-content", "max-network-transactions");
  }

  private admitMetadata(
    transaction: Transaction,
    kind: UnindexedNetworkEvent["kind"],
    source: NetworkHeadersSource,
    url?: string,
    additionalStrings: readonly string[] = [],
    additionalSources: readonly {
      source: NetworkHeadersSource;
      url?: string;
    }[] = [],
  ): boolean {
    return this.admitProducerStrings(
      transaction,
      kind,
      this.metadataStrings(source, url, additionalStrings, additionalSources),
    );
  }

  private *metadataStrings(
    source: NetworkHeadersSource,
    url: string | undefined,
    additionalStrings: readonly string[],
    additionalSources: readonly {
      source: NetworkHeadersSource;
      url?: string;
    }[],
  ): Generator<string> {
    yield* this.retainedMetadataStrings(source, source.headers(), url);
    yield* additionalStrings;
    for (const extra of additionalSources)
      yield* this.retainedMetadataStrings(
        extra.source,
        extra.source.headers(),
        extra.url,
      );
  }

  private *retainedMetadataStrings(
    source: NetworkHeadersSource,
    headers: Readonly<Record<string, string>>,
    url?: string,
  ): Generator<string> {
    if (url !== undefined) yield url;
    for (const name in headers) {
      if (!Object.hasOwn(headers, name)) continue;
      yield name;
      // Names are always retained in metadata. Values are retained only in
      // selected header-value content; do not charge discarded values.
      if (this.options.selection.header_values) yield headers[name]!;
    }
    if ("method" in source) {
      const request = source as ScenarioNetworkRequest;
      yield request.method();
      yield request.url();
      yield request.resourceType();
    }
  }

  private headerNames(source: NetworkHeadersSource): string[] {
    return Object.keys(source.headers())
      .map((name) => this.options.secrets.redact(name))
      .sort();
  }

  private metadata(request: ScenarioNetworkRequest, transaction: Transaction) {
    return {
      transaction_id: transaction.id,
      redirected_from_transaction_id: transaction.redirectedFrom,
      ...(transaction.redirectedFromState === undefined
        ? {}
        : {
            redirected_from_transaction_state: transaction.redirectedFromState,
          }),
      method: this.options.secrets.redact(request.method()),
      url: this.options.secrets.sanitizeUrl(request.url()),
      resource_type: this.options.secrets.redact(request.resourceType()),
      header_names: this.headerNames(request),
    };
  }

  private responseContent(
    transaction: Transaction,
    unavailable?: BrowserNetworkBody,
  ): void {
    const response = transaction.response;
    if (
      response === undefined ||
      transaction.responseScheduled ||
      (!this.options.selection.response_body &&
        !this.options.selection.header_values)
    )
      return;
    transaction.responseScheduled = true;
    this.collect({
      transaction,
      sequence: response.sequence,
      phase: "response",
      source: response.source,
      ...(unavailable === undefined ? {} : { unavailable }),
    });
  }

  private collect(
    input: {
      readonly transaction: Transaction;
      readonly sequence: number;
    } & (
      | { readonly phase: "request"; readonly source: ScenarioNetworkRequest }
      | {
          readonly phase: "response";
          readonly source: ScenarioNetworkResponse;
          readonly unavailable?: BrowserNetworkBody;
        }
    ),
  ): void {
    const { transaction, sequence, phase, source } = input;
    const collect = async (): Promise<void> => {
      const includeBody =
        phase === "request"
          ? this.options.selection.request_body
          : this.options.selection.response_body;
      const includeHeaders = this.options.selection.header_values;
      const request =
        input.phase === "response" ? input.source.request() : undefined;
      const protection =
        request !== undefined &&
        this.options.secrets.hasResponseProtection(request)
          ? { request, retainBody: includeBody }
          : undefined;
      const protectedResponse = protection !== undefined;
      const privacyOnly = protectedResponse && !includeBody && includeHeaders;
      const readOptions = privacyOnly
        ? { ...this.readOptions, maxBodyBytes: MAX_SAVED_RESPONSE_BYTES }
        : this.readOptions;
      let headers: Promise<BrowserNetworkHeaders> | undefined;
      const getHeaders = (): Promise<BrowserNetworkHeaders> =>
        (headers ??= includeHeaders
          ? captureNetworkHeaders(source, this.options.secrets, readOptions)
          : Promise.resolve({ state: "not_requested" }));
      // Existing reads keep their order. Marked responses establish secret
      // spellings before either their headers or their body can be retained.
      if (!protectedResponse && includeHeaders) await getHeaders();
      const unavailable =
        input.phase === "response" ? input.unavailable : undefined;
      const observedBody: NetworkBodyCapture =
        unavailable ??
        (includeBody || privacyOnly
          ? await captureNetworkBody(
              async () => {
                if (input.phase === "request")
                  return input.source.postDataBuffer();
                if (!protectedResponse) return input.source.body();
                const bounded = await readBoundedResponseBody(
                  input.source,
                  Math.min(readOptions.maxBodyBytes, MAX_SAVED_RESPONSE_BYTES),
                );
                if (!bounded.ok) throw new Error(bounded.error.message);
                return bounded.value;
              },
              phase,
              source,
              this.options.secrets,
              readOptions,
              async (body) =>
                this.options.admitContentBody({
                  transactionId: transaction.id,
                  sourceEventSequence: sequence,
                  phase,
                  headers: await getHeaders(),
                  observedBytes: body.observedBytes,
                  allocationBytes: body.allocationBytes,
                  mediaType: body.mediaType,
                }),
              protection,
            )
          : { state: "not_requested" });
      if (observedBody.state === "omitted") {
        this.options.omitNetwork(
          transaction.id,
          "network-content",
          observedBody.reason,
        );
        return;
      }
      const protectedReadFailed =
        protectedResponse &&
        (observedBody.state === "unavailable" ||
          observedBody.state === "not_exposed");
      const retainedHeaders: BrowserNetworkHeaders =
        protectedReadFailed && includeHeaders
          ? {
              state: "unavailable",
              message:
                "Response header values were withheld because marked source values could not be read safely.",
            }
          : await getHeaders();
      const retainedBody = includeBody
        ? observedBody
        : { state: "not_requested" as const };
      // A recorded request failure is a terminal observation, not a missed
      // body read. Keep the unavailable body without invalidating event coverage.
      if (
        retainedHeaders.state === "unavailable" ||
        (retainedBody.state === "unavailable" &&
          retainedBody.reason !== "request-failed") ||
        retainedBody.state === "not_exposed"
      )
        this.gaps.add(
          "Some selected network content was unavailable; per-transaction content states retain the reason.",
        );
      const admission = this.options.emit({
        kind: "network-content",
        transaction_id: transaction.id,
        source_event_sequence: sequence,
        phase,
        headers: retainedHeaders,
        body: retainedBody,
      });
      if (admission.status === "omitted")
        this.options.omitNetwork(
          transaction.id,
          "network-content",
          admission.reason,
        );
    };
    this.pending.push(
      new Promise<void>((resolve, reject) => {
        this.queuedReads.push({ run: collect, resolve, reject });
        this.pumpContentReads();
      }),
    );
  }

  private pumpContentReads(): void {
    while (this.activeReads < 16 && this.queuedReads.length > 0) {
      const job = this.queuedReads.shift();
      if (job === undefined) return;
      this.activeReads += 1;
      void job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.activeReads -= 1;
          this.pumpContentReads();
        });
    }
  }
}
