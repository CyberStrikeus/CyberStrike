import { selectCdpDiscoveryTarget } from "../browser/CdpDiscoveryTargets.js";
import {
  DEFAULT_ASAR_HEADER_ADMISSION,
  type AsarHeaderAdmission,
} from "../config/asarHeaderAdmission.js";
import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../application/AnalysisProvider.js";
import type { JavaScriptRuntimeObservationPort } from "../application/javascript/JavaScriptRuntimeObservationPort.js";
import {
  javascriptRuntimeObservationSchema,
  javascriptRuntimeTargetListSchema,
  type JavaScriptRuntimeObservation,
  type JavaScriptRuntimeTargetList,
  type ListJavaScriptRuntimeTargetsInput,
  type ObserveJavaScriptRuntimeInput,
} from "../domain/javascript/javascriptRuntimeObservation.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import { delayWithCancellation } from "../browser/CdpCaptureValues.js";
import {
  readCdpScriptParsed,
  readCdpExecutionContextCreated,
  readCdpExecutionContextDestroyed,
} from "../browser/CdpScriptContextFacts.js";
import type { CdpConnection, CdpEvent } from "../browser/CdpConnection.js";
import {
  ElectronFileScope,
  mapElectronFileAuthorizationFailure,
} from "../browser/ElectronFileScope.js";
import {
  CdpTargetSessionOwner,
  bindCdpTransportCleanup,
} from "../browser/CdpTargetSessionOwner.js";
import {
  authorizeRuntimeLocation,
  authorizeRuntimeTargetLocation,
  inspectorExclusionKey,
  throwIfRuntimeObservationCancelled,
} from "./JavaScriptRuntimeScope.js";
import {
  createInspectorExclusionCounts,
  describeInspectorTargetLimitations,
  finalizeInspectorCapture,
} from "./V8InspectorCaptureProjection.js";
import {
  discoverV8Inspector,
  type AuthorizedV8InspectorTarget,
  type V8InspectorDiscovery,
} from "./V8InspectorEndpoint.js";

import { V8_INSPECTOR_PROVIDER_IDENTITY } from "./providerIdentity.js";

/**
 * Admission and transport cleanup for one Inspector host. Providers are created
 * per operation; the host passes one admission so those providers share cleanup
 * without a process-global counter.
 */
export class V8InspectorAdmission {
  readonly files = new ElectronFileScope();
  readonly connections = new CdpTargetSessionOwner();
  #activeOperations = 0;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #idleWaiters = new Set<() => void>();

  async run<Value>(
    operation: BrowserObservationOperation,
    work: () => Promise<Value>,
  ): Promise<Value> {
    if (this.#closing && this.#closePromise !== undefined)
      await this.#closePromise;
    if (this.#closing)
      throw new ProviderAdapterError(
        V8_INSPECTOR_PROVIDER_IDENTITY.id,
        operation,
        {
          diagnostics: { reason: "provider_closing" },
          userMessage: "Inspector provider cleanup is in progress.",
        },
      );
    this.#activeOperations += 1;
    try {
      return await work();
    } finally {
      this.#activeOperations -= 1;
      if (this.#activeOperations === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return await this.#closePromise;
    const attempt = this.#closeResources();
    this.#closePromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.#closePromise === attempt) this.#closePromise = undefined;
    }
  }

  async #closeResources(): Promise<void> {
    this.#closing = true;
    try {
      while (this.#activeOperations > 0)
        await new Promise<void>((resolve) => this.#idleWaiters.add(resolve));
      const failures: AnalysisError[] = [];
      try {
        await this.connections.retryPending();
      } catch (cause: unknown) {
        failures.push(providerError(cause, "observe_javascript_runtime"));
      }
      try {
        await this.files.retryCleanup();
      } catch (cause: unknown) {
        failures.push(providerError(cause, "observe_javascript_runtime"));
      }
      if (failures.length === 0) return;
      if (failures.length === 1) throw failures[0]!;
      const cleanup = new ProviderCleanupError(
        V8_INSPECTOR_PROVIDER_IDENTITY.id,
        failures.flatMap(({ cleanupResources }) => cleanupResources),
        { reason: "Inspector provider cleanup remains incomplete." },
        {
          operation: "observe_javascript_runtime",
          cause: new AggregateError(
            failures,
            "Inspector provider cleanup owners remain unresolved.",
          ),
        },
      );
      cleanup.bindCleanupDependencies(failures);
      throw cleanup;
    } finally {
      this.#closing = false;
    }
  }
}

/** Maximum decoded CDP message accepted while observing one Inspector target. */
export const INSPECTOR_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
/** Aggregate retained metadata budget, including an estimate of JS object overhead. */
export const INSPECTOR_MAX_RETAINED_METADATA_BYTES = 8 * 1024 * 1024;
const RETAINED_OBJECT_OVERHEAD_BYTES = 512;

export interface ScriptDraft {
  readonly rawUrl: string;
  readonly executionContextKey: string | null;
  readonly cdpHash: string | null;
  readonly length: number | null;
  readonly isModule: boolean | null;
}

export interface ContextDraft {
  readonly contextKey: string;
  state: "created" | "destroyed" | "cleared";
  readonly name: string | null;
  readonly origin: string | null;
}

export interface CaptureState {
  readonly scripts: ScriptDraft[];
  readonly contexts: Map<string, ContextDraft>;
  eventsObserved: number;
  eventsRetained: number;
  eventsDropped: number;
  metadataBytes: number;
  scriptsObserved: number;
  invalidScripts: number;
  parseFailedScripts: number;
  invalidContexts: number;
  truncated: boolean;
  readonly truncationReasons: Set<string>;
}

/** Attach-only provider; sends only Runtime.enable and Debugger.enable. */
export class V8InspectorProvider implements JavaScriptRuntimeObservationPort {
  readonly #asarHeaderAdmission: AsarHeaderAdmission;
  readonly #admission: V8InspectorAdmission;

  /**
   * Header admission comes from the composition root's environment.
   * Pass one {@link V8InspectorAdmission} when several providers must share
   * transport cleanup. Omitted means this provider owns a fresh admission.
   */
  constructor(
    asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
    admission: V8InspectorAdmission = new V8InspectorAdmission(),
  ) {
    this.#asarHeaderAdmission = asarHeaderAdmission;
    this.#admission = admission;
  }

  identity(): ProviderIdentity {
    return V8_INSPECTOR_PROVIDER_IDENTITY;
  }

  async close(): Promise<void> {
    await this.#admission.close();
  }

  async listTargets(
    input: ListJavaScriptRuntimeTargetsInput,
    options: ExecutionOptions = {},
  ): Promise<Result<JavaScriptRuntimeTargetList, AnalysisError>> {
    try {
      return await this.#admission.run("list_javascript_runtime_targets", () =>
        this.#listTargets(input, options),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "list_javascript_runtime_targets"));
    }
  }

  async #listTargets(
    input: ListJavaScriptRuntimeTargetsInput,
    options: ExecutionOptions,
  ): Promise<Result<JavaScriptRuntimeTargetList, AnalysisError>> {
    let discovery: Awaited<ReturnType<typeof discoverV8Inspector>> | undefined;
    const allowed: AuthorizedV8InspectorTarget[] = [];
    const excluded = createInspectorExclusionCounts();
    let unconnectable = 0;
    let targetsExamined = 0;
    try {
      throwIfRuntimeObservationCancelled(
        options.signal,
        "list_javascript_runtime_targets",
      );
      await this.#admission.files.retryCleanup();
      discovery = await discoverV8Inspector(
        input.inspector_endpoint,
        "list_javascript_runtime_targets",
        options.signal,
      );
      for (const target of discovery.targets) {
        throwIfRuntimeObservationCancelled(
          options.signal,
          "list_javascript_runtime_targets",
        );
        const decision = await authorizeRuntimeTargetLocation(
          target.url,
          { type: target.type, product: discovery.runtime.product },
          options.signal,
          "list_javascript_runtime_targets",
          this.#asarHeaderAdmission,
          this.#admission.files,
        );
        if (!decision.allowed) {
          excluded[inspectorExclusionKey(decision.reason)] += 1;
          targetsExamined += 1;
          continue;
        }
        if (decision.location.kind === "builtin") {
          excluded.unsupported_location += 1;
          targetsExamined += 1;
          continue;
        }
        if (target.webSocketUrl === null) {
          unconnectable += 1;
          targetsExamined += 1;
          continue;
        }
        allowed.push({
          id: target.id,
          type: target.type,
          url: target.url,
          attached: target.attached,
          webSocketUrl: target.webSocketUrl,
          location: decision.location,
        });
        targetsExamined += 1;
      }
      allowed.sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      );
      throwIfRuntimeObservationCancelled(
        options.signal,
        "list_javascript_runtime_targets",
      );
      return ok(
        javascriptRuntimeTargetListSchema.parse({
          runtime: discovery.runtime,
          targets: allowed.map(projectTarget),
          excluded: { ...excluded, unconnectable },
          limitations: [
            ...discovery.limitations,
            ...describeInspectorTargetLimitations(
              allowed.some((target) => target.attached === null),
            ),
          ],
        }),
      );
    } catch (cause: unknown) {
      if (cause instanceof AnalysisCancelledError && discovery !== undefined) {
        const complete = targetsExamined === discovery.targets.length;
        const limitations = [
          ...discovery.limitations,
          ...describeInspectorTargetLimitations(
            allowed.some((target) => target.attached === null),
          ),
        ];
        return err(
          new AnalysisCancelledError("list_javascript_runtime_targets", {
            cause: cause.cause,
            diagnostics: {
              completed_target_inventory: {
                runtime: discovery.runtime,
                targets: allowed
                  .sort((left, right) =>
                    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
                  )
                  .map(projectTarget),
                excluded: { ...excluded, unconnectable },
                targets_examined: targetsExamined,
                targets_discovered: discovery.targets.length,
                complete,
                limitations: complete
                  ? limitations
                  : [
                      ...limitations,
                      "Cancellation stopped target authorization; unexamined targets are unknown, not excluded.",
                    ],
              },
            },
          }),
        );
      }
      return err(providerError(cause, "list_javascript_runtime_targets"));
    }
  }

  async observe(
    input: ObserveJavaScriptRuntimeInput,
    options: ExecutionOptions = {},
  ): Promise<Result<JavaScriptRuntimeObservation, AnalysisError>> {
    try {
      return await this.#admission.run("observe_javascript_runtime", () =>
        this.#observe(input, options),
      );
    } catch (cause: unknown) {
      return err(providerError(cause, "observe_javascript_runtime"));
    }
  }

  async #observe(
    input: ObserveJavaScriptRuntimeInput,
    options: ExecutionOptions,
  ): Promise<Result<JavaScriptRuntimeObservation, AnalysisError>> {
    let connection: CdpConnection | undefined;
    let discovery: Awaited<ReturnType<typeof discoverV8Inspector>> | undefined;
    let target: AuthorizedV8InspectorTarget | undefined;
    let state: CaptureState | undefined;
    let cleanupFailure: unknown;
    let cleanupFailed = false;
    let connectionClosePromise: Promise<void> | undefined;
    let outcome:
      | Result<JavaScriptRuntimeObservation, AnalysisError>
      | undefined;
    const closeConnection = (): Promise<void> => {
      if (connection === undefined) return Promise.resolve();
      const ownedConnection = connection;
      connectionClosePromise ??=
        this.#admission.connections.finish(ownedConnection);
      return connectionClosePromise;
    };
    try {
      throwIfRuntimeObservationCancelled(options.signal);
      await this.#admission.connections.retryPending();
      await this.#admission.files.retryCleanup();
      discovery = await discoverV8Inspector(
        input.inspector_endpoint,
        "observe_javascript_runtime",
        options.signal,
      );
      target = await authorizedTarget(
        discovery,
        input,
        this.#asarHeaderAdmission,
        options.signal,
        this.#admission.files,
      );
      if (input.runtime_kind !== undefined)
        assertRuntimeKind(target, input.runtime_kind);
      throwIfRuntimeObservationCancelled(options.signal);
      connection = await this.#admission.connections.connect(
        target.webSocketUrl,
        "observe_javascript_runtime",
        options,
        "browser_transport",
        { maxPayloadBytes: INSPECTOR_MAX_PAYLOAD_BYTES },
      );
      const captureState = emptyCaptureState();
      state = captureState;
      const removeListener = connection.onEvent((event) =>
        ingestEvent(event, captureState),
      );
      try {
        await connection.send("Runtime.enable", {}, undefined, options.signal);
        await connection.send("Debugger.enable", {}, undefined, options.signal);
        await waitForCapture(connection, input.observation_ms, options.signal);
      } finally {
        removeListener();
      }
      const result = await finalizeInspectorCapture({
        input,
        runtime: discovery.runtime,
        discoveryLimitations: discovery.limitations,
        target,
        state: captureState,
        authorizeLocation: (rawUrl, signal) =>
          authorizeRuntimeLocation(
            rawUrl,
            signal,
            "observe_javascript_runtime",
            this.#asarHeaderAdmission,
            this.#admission.files,
          ),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      outcome = ok(javascriptRuntimeObservationSchema.parse(result));
    } catch (cause: unknown) {
      const error = providerError(cause, "observe_javascript_runtime");
      if (
        state !== undefined &&
        discovery !== undefined &&
        target !== undefined
      ) {
        try {
          const partialObservation = await finalizeInspectorCapture({
            input,
            runtime: discovery.runtime,
            discoveryLimitations: discovery.limitations,
            target,
            state,
            locationMode: "reported",
          });
          error.retainPartialObservation(partialObservation);
        } catch (projectionFailure: unknown) {
          error.retainSecondaryFailure(
            new ProviderAdapterError(
              V8_INSPECTOR_PROVIDER_IDENTITY.id,
              "observe_javascript_runtime",
              {
                cause: projectionFailure,
                userMessage:
                  "Inspector partial observations could not be projected.",
              },
            ),
          );
        }
      }
      outcome = err(error);
    } finally {
      if (connection !== undefined)
        try {
          await closeConnection();
        } catch (cause: unknown) {
          cleanupFailed = true;
          cleanupFailure = cause;
        }
    }
    // Cancellation can arrive after capture has completed while the owner is
    // waiting for its bounded transport close. Preserve it as the primary
    // result even when cleanup completed normally.
    if (options.signal?.aborted === true && outcome?.ok === true) {
      const cancellation = new AnalysisCancelledError(
        "observe_javascript_runtime",
        {
          cause: options.signal.reason,
          partialObservation: outcome.value,
        },
      );
      outcome = err(cancellation);
    }
    if (cleanupFailed) {
      const cleanup =
        cleanupFailure instanceof AnalysisError
          ? cleanupFailure
          : providerError(cleanupFailure, "observe_javascript_runtime");
      const primary = outcome?.ok === false ? outcome.error : undefined;
      const partialObservation =
        outcome?.ok === true
          ? outcome.value
          : outcome?.ok === false
            ? outcome.error.partialObservation
            : undefined;
      if (primary === undefined) {
        if (partialObservation !== undefined)
          cleanup.retainPartialObservation(partialObservation);
        return err(bindCdpTransportCleanup(cleanupFailure, cleanup));
      }
      const composed = analysisErrorWithCleanupFailure(
        primary,
        cleanup,
        "observe_javascript_runtime",
      );
      return err(bindCdpTransportCleanup(cleanupFailure, composed));
    }
    return (
      outcome ??
      err(
        new BrowserObservationError(
          "observe_javascript_runtime",
          "protocol_error",
        ),
      )
    );
  }
}

const projectTarget = (target: AuthorizedV8InspectorTarget) => ({
  target_id: target.id,
  protocol_type: target.type,
  attached: target.attached,
  location: target.location,
});

const authorizedTarget = async (
  discovery: V8InspectorDiscovery,
  input: ObserveJavaScriptRuntimeInput,
  asarHeaderAdmission: AsarHeaderAdmission,
  signal?: AbortSignal,
  files?: ElectronFileScope,
): Promise<AuthorizedV8InspectorTarget> => {
  throwIfRuntimeObservationCancelled(signal);
  const target = selectCdpDiscoveryTarget(
    discovery.targets,
    input.target_id,
    "observe_javascript_runtime",
    discovery.ambiguousTargetIds,
  );
  if (target === undefined)
    throw new BrowserObservationError(
      "observe_javascript_runtime",
      "target_not_found",
    );
  const decision = await authorizeRuntimeTargetLocation(
    target.url,
    { type: target.type, product: discovery.runtime.product },
    signal,
    "observe_javascript_runtime",
    asarHeaderAdmission,
    files,
  );
  throwIfRuntimeObservationCancelled(signal);
  if (target.attached === true)
    throw new BrowserObservationError(
      "observe_javascript_runtime",
      "target_not_allowed",
      {
        detail: `Inspector target ${target.id} reports attached: true; REA will not displace its debugger.`,
        diagnostics: { target_id: target.id, attached: true },
        remediationAction:
          "Disconnect the other debugger or select an unattached target, refresh list_javascript_runtime_targets, and retry with its exact target ID.",
      },
    );
  if (!decision.allowed || decision.location.kind === "builtin")
    throw new BrowserObservationError(
      "observe_javascript_runtime",
      "target_not_allowed",
      {
        detail: `Inspector target ${target.id} has no supported observable target location.`,
        remediationAction:
          "Select a target with a supported file or HTTP(S) location from list_javascript_runtime_targets.",
      },
    );
  if (target.webSocketUrl === null)
    throw new BrowserObservationError(
      "observe_javascript_runtime",
      "invalid_endpoint_response",
      {
        detail:
          "The selected Inspector target has no validated direct WebSocket endpoint.",
      },
    );
  return {
    id: target.id,
    type: target.type,
    url: target.url,
    attached: target.attached,
    webSocketUrl: target.webSocketUrl,
    location: decision.location,
  };
};

const assertRuntimeKind = (
  target: AuthorizedV8InspectorTarget,
  kind: ObserveJavaScriptRuntimeInput["runtime_kind"],
): void => {
  const accepted =
    kind === "electron-preload" || kind === "electron-renderer"
      ? target.type === "page"
      : target.type === "node";
  if (!accepted)
    throw new BrowserObservationError(
      "observe_javascript_runtime",
      "target_not_allowed",
      {
        detail: `Declared runtime_kind ${String(kind)} is incompatible with Inspector target ${target.id} protocol type ${target.type}.`,
        diagnostics: {
          target_id: target.id,
          protocol_type: target.type,
          runtime_kind: kind ?? null,
        },
        remediationAction:
          "Correct runtime_kind to match the selected target's protocol type (node for Node or Electron main, page for Electron renderer or preload), or omit runtime_kind to retain an unknown role. The declared role is not authenticated by Inspector.",
      },
    );
};

const emptyCaptureState = (): CaptureState => ({
  scripts: [],
  contexts: new Map(),
  eventsObserved: 0,
  eventsRetained: 0,
  eventsDropped: 0,
  metadataBytes: 0,
  scriptsObserved: 0,
  invalidScripts: 0,
  parseFailedScripts: 0,
  invalidContexts: 0,
  truncated: false,
  truncationReasons: new Set(),
});

const ingestEvent = (event: CdpEvent, state: CaptureState): void => {
  if (
    event.method !== "Debugger.scriptParsed" &&
    event.method !== "Debugger.scriptFailedToParse" &&
    event.method !== "Runtime.executionContextCreated" &&
    event.method !== "Runtime.executionContextDestroyed" &&
    event.method !== "Runtime.executionContextsCleared"
  )
    return;
  state.eventsObserved += 1;
  if (event.method === "Debugger.scriptParsed") {
    ingestScript(event, state);
    return;
  }
  if (event.method === "Debugger.scriptFailedToParse") {
    const facts = readCdpScriptParsed(event.params);
    if (facts.scriptId === undefined || facts.url === undefined) {
      state.invalidScripts += 1;
      retainEvent(state, 0);
      return;
    }
    state.parseFailedScripts += 1;
    retainEvent(state, 0);
    return;
  }
  ingestContext(event, state);
};

const ingestScript = (event: CdpEvent, state: CaptureState): void => {
  state.scriptsObserved += 1;
  const facts = readCdpScriptParsed(event.params);
  const rawUrl = facts.url;
  if (rawUrl === undefined) {
    state.invalidScripts += 1;
    retainEvent(state, 0);
    return;
  }
  const { metadata } = facts;
  const draft: ScriptDraft = {
    rawUrl,
    executionContextKey: facts.contextKey,
    cdpHash: metadata.hash,
    length: metadata.length,
    isModule: metadata.isModule,
  };
  const bytes = retainedMetadataBytes(draft);
  if (!retainEvent(state, bytes)) return;
  state.scripts.push(draft);
};

const ingestContext = (event: CdpEvent, state: CaptureState): void => {
  if (event.method === "Runtime.executionContextsCleared") {
    let byteDelta = 0;
    for (const context of state.contexts.values()) {
      byteDelta +=
        retainedMetadataBytes({ ...context, state: "cleared" }) -
        retainedMetadataBytes(context);
    }
    if (replaceRetainedMetadata(state, byteDelta)) {
      for (const context of state.contexts.values()) context.state = "cleared";
      retainEvent(state, 0);
    }
    return;
  }
  const created = event.method === "Runtime.executionContextCreated";
  const createdContext = created
    ? readCdpExecutionContextCreated(event.params)
    : undefined;
  const key =
    createdContext === undefined
      ? readCdpExecutionContextDestroyed(event.params).contextKey
      : createdContext.contextKey;
  if (key === null) {
    state.invalidContexts += 1;
    retainEvent(state, 0);
    return;
  }
  const previous = state.contexts.get(key);
  const draft: ContextDraft = {
    contextKey: key,
    state: created ? "created" : "destroyed",
    name:
      createdContext === undefined
        ? (previous?.name ?? null)
        : (createdContext.name ?? null),
    origin:
      createdContext === undefined
        ? (previous?.origin ?? null)
        : (createdContext.origin ?? null),
  };
  const bytes =
    retainedMetadataBytes(draft) -
    (previous === undefined ? 0 : retainedMetadataBytes(previous));
  if (!retainEvent(state, bytes)) return;
  state.contexts.set(key, draft);
};

const retainEvent = (state: CaptureState, bytes: number): boolean => {
  if (!replaceRetainedMetadata(state, bytes)) return false;
  state.eventsRetained += 1;
  return true;
};

const replaceRetainedMetadata = (
  state: CaptureState,
  byteDelta: number,
): boolean => {
  if (state.metadataBytes + byteDelta > INSPECTOR_MAX_RETAINED_METADATA_BYTES) {
    state.eventsDropped += 1;
    state.truncated = true;
    state.truncationReasons.add("retained_metadata_budget_exceeded");
    return false;
  }
  state.metadataBytes += byteDelta;
  return true;
};

const waitForCapture = async (
  connection: CdpConnection,
  observationMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  let removeDisconnect = (): void => undefined;
  let removeProtocolFailure = (): void => undefined;
  const disconnected = new Promise<never>((_resolve, reject) => {
    removeDisconnect = connection.onDisconnect((error) => reject(error));
  });
  const protocolFailure = new Promise<never>((_resolve, reject) => {
    removeProtocolFailure = connection.onProtocolFailure((error) =>
      reject(error),
    );
  });
  const timerOwner = new AbortController();
  const timerSignal =
    signal === undefined
      ? timerOwner.signal
      : AbortSignal.any([signal, timerOwner.signal]);
  try {
    await Promise.race([
      delayWithCancellation(
        observationMs,
        "observe_javascript_runtime",
        timerSignal,
      ),
      disconnected,
      protocolFailure,
    ]);
  } finally {
    // Cancel only this wait's timer. The caller owns and retains its signal.
    timerOwner.abort();
    removeDisconnect();
    removeProtocolFailure();
  }
};

const retainedMetadataBytes = (value: ScriptDraft | ContextDraft): number => {
  const strings =
    "rawUrl" in value
      ? [value.rawUrl, value.rawUrl, value.executionContextKey, value.cdpHash]
      : [value.contextKey, value.name, value.origin];
  return (
    RETAINED_OBJECT_OVERHEAD_BYTES +
    strings.reduce((total, text) => total + (text?.length ?? 0) * 2, 0)
  );
};

const providerError = (
  cause: unknown,
  operation: BrowserObservationOperation,
): AnalysisError => {
  const fileFailure =
    operation === "observe_javascript_runtime" ||
    operation === "list_javascript_runtime_targets"
      ? mapElectronFileAuthorizationFailure(
          cause,
          V8_INSPECTOR_PROVIDER_IDENTITY.id,
          operation,
        )
      : undefined;
  if (fileFailure !== undefined) return fileFailure;
  if (cause instanceof AnalysisError) return cause;
  return new ProviderAdapterError(
    V8_INSPECTOR_PROVIDER_IDENTITY.id,
    operation,
    {
      cause,
    },
  );
};
