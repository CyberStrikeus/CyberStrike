import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import type { AnalysisSettingsReader } from "../domain/analysisSettings.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import type {
  RetainedResourceScope,
  ExecutionOptions,
} from "../application/AnalysisProvider.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { throwIfJadxInterrupted } from "./JadxInterruption.js";
import { chmod, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AndroidAnalysisPort } from "../application/android/AndroidAnalysisPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import type { AndroidRequest } from "../domain/android/androidAnalysis.js";
import type { AndroidMappingSource } from "../domain/android/androidMapping.js";
import {
  readAndroidMapping,
  type AndroidMappingReadDeadline,
} from "./AndroidMappingFile.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  createJadxWorkspaceRoot,
  type JadxWorkspaceRoot,
} from "./JadxWorkspaceRoot.js";
import {
  snapshotAndroidEngine,
  snapshotAndroidTarget,
} from "./AndroidTargetSnapshot.js";
import {
  hashStableFile,
  stableFileHashCause,
} from "../filesystem/StableFileHash.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { RegularFileChangedError } from "../filesystem/RegularFile.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import {
  inspectJadxAvailability,
  resolveJadxConfigurationInputs,
  resolveJadxOperationTimeout,
  validateJadxConfiguration,
} from "./JadxConfiguration.js";
import type { JadxLauncher } from "./JadxMcpTransport.js";

import { JadxSession } from "./JadxSession.js";
import { captureJadxFailure } from "./JadxFailure.js";

const BRIDGE_SOURCE = fileURLToPath(
  new URL("../../bridge/android/ReaJadxBridge.java", import.meta.url),
);
type Outcome = Awaited<ReturnType<AndroidAnalysisPort["execute"]>>;

const waitForTurn = (
  predecessor: Promise<void>,
  request: AndroidRequest,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = () =>
      reject(
        new AnalysisCancelledError(request.operation, {
          cause: signal?.reason,
        }),
      );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
    void predecessor.then(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    });
  });

const androidTargetChanged = (
  operation: string,
  path: string,
  cause?: unknown,
): AnalysisInputError =>
  new AnalysisInputError(
    operation,
    cause === undefined ? undefined : { cause },
    [
      {
        path: ["path"],
        reason: "invalid_value",
        message: `APK bytes changed after admission at ${path}; retry against a stable file.`,
      },
    ],
  );

const androidSourceChanged = (
  operation: string,
  source: string,
  cause?: unknown,
): AnalysisCapabilityUnavailableError =>
  new AnalysisCapabilityUnavailableError(
    "jadx",
    operation,
    `Selected JADX input bytes changed during admission at ${source}; retry with a stable installation.`,
    cause === undefined ? undefined : { cause },
  );

const hashAndroidSource = async (
  path: string,
  operation: string,
  signal: AbortSignal,
  retainFailedClose: (owner: OwnedFileHandle) => void,
): Promise<string> => {
  try {
    return (await hashStableFile(path, { signal, retainFailedClose })).sha256;
  } catch (cause: unknown) {
    const physical = stableFileHashCause(cause);
    if (physical instanceof RegularFileChangedError)
      throw androidSourceChanged(operation, path, physical);
    throw cause;
  }
};

interface PendingCleanup {
  readonly operation: string;
  session: JadxSession | undefined;
  root: JadxWorkspaceRoot | undefined;
  readonly fileHandles: Map<OwnedFileHandle, string>;
  readonly previousError: AnalysisError | undefined;
  readonly operationCause: unknown;
  reportedErrors: WeakRef<AnalysisError>[];
}

/** Every descriptor owner nested in one rejected close, without treating a later owner as the first. */
const retainedCleanupOwners = (
  cause: unknown,
): ReadonlySet<OwnedFileHandle> => {
  const owners = new Set<OwnedFileHandle>();
  const visit = (value: unknown, seen: Set<unknown>): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (!(value instanceof RegularFileCleanupFailure)) return;
    owners.add(value.owner);
    if (value.outcome.kind === "failed") visit(value.outcome.cause, seen);
  };
  visit(cause, new Set());
  return owners;
};

const cleanupResources = (resources: PendingCleanup): readonly string[] => [
  ...(resources.session === undefined
    ? []
    : [resources.session.transport.runId]),
  ...(resources.root === undefined ? [] : [resources.root.path]),
  ...resources.fileHandles.values(),
];

/** The retained acquisition record owns both retry and current resource attribution. */
const cleanupFailure = (
  resources: PendingCleanup,
  cleanup: ProviderCleanupError,
): AnalysisError =>
  (resources.previousError === undefined
    ? cleanup
    : analysisErrorWithCleanupFailure(
        resources.previousError,
        cleanup,
        resources.operation,
      )
  ).bindCleanupResourceOwner({
    get cleanupResources() {
      return cleanupResources(resources);
    },
  });

const cleanup = async (
  resources: PendingCleanup,
): Promise<Result<void, AnalysisError>> => {
  const { session, root } = resources;
  let sessionCloseFailed = false;
  let sessionCloseCause: unknown;
  try {
    await session?.close();
    resources.session = undefined;
  } catch (cause) {
    // Still drain independent hash descriptors, but keep the workspace until
    // this session's process ownership is proven stopped.
    sessionCloseFailed = true;
    sessionCloseCause = cause;
  }
  const tracked = retainedCleanupOwners(resources.operationCause);
  const trackedInMap = [...tracked].filter((owner) =>
    resources.fileHandles.has(owner),
  );
  const fileCloseCauses: unknown[] = [];
  for (const owner of resources.fileHandles.keys()) {
    try {
      await owner.close();
      resources.fileHandles.delete(owner);
      // One descriptor's release clears only that owner. The admission error
      // stays incomplete until every owner from the same close failure is gone.
      if (
        trackedInMap.length > 0 &&
        trackedInMap.every((candidate) => !resources.fileHandles.has(candidate))
      )
        resources.previousError?.resolveCleanup();
    } catch (cause: unknown) {
      fileCloseCauses.push(cause);
    }
  }
  if (sessionCloseFailed || fileCloseCauses.length > 0) {
    const cleanupCauses = [
      ...(sessionCloseFailed ? [sessionCloseCause] : []),
      ...fileCloseCauses,
    ];
    const cleanupError = new ProviderCleanupError(
      "jadx",
      cleanupResources(resources),
      {
        reason: cleanupCauses
          .map((failure) =>
            failure instanceof Error ? failure.message : String(failure),
          )
          .join("; "),
        cleanup_causes: cleanupCauses.map((failure) =>
          failure instanceof Error ? failure.message : String(failure),
        ),
        provider_cleanup: cleanupCauses.map((failure) =>
          failure instanceof ProviderCleanupError
            ? (failure.diagnostics ?? null)
            : null,
        ),
      },
      {
        operation: resources.operation,
        cause: new AggregateError(
          cleanupCauses,
          "JADX resource cleanup failed",
        ),
      },
    );
    return err(cleanupFailure(resources, cleanupError));
  }
  try {
    // Child descriptors are released above. The workspace root follows only
    // after those owners confirm close.
    await root?.close();
    resources.root = undefined;
  } catch (cause) {
    const error = new ProviderCleanupError(
      "jadx",
      cleanupResources(resources),
      {
        reason: cause instanceof Error ? cause.message : String(cause),
      },
      { operation: resources.operation, cause },
    );
    return err(cleanupFailure(resources, error));
  }
  return ok(undefined);
};

interface RetainedSession {
  readonly key: string;
  readonly root: JadxWorkspaceRoot;
  readonly session: JadxSession;
  readonly snapshot: string;
  readonly jarHash: string;
  readonly bridgeHash: string;
}

/** One serialized, immutable APK session per REA instance, retired on idle or shutdown. */
export class JadxProvider implements AndroidAnalysisPort {
  #tail: Promise<void> = Promise.resolve();
  #pendingCleanup: PendingCleanup | undefined;
  #retained: RetainedSession | undefined;
  #mappingCache: AndroidMappingSource | undefined;
  #idle: NodeJS.Timeout | undefined;
  readonly #shutdown = new AbortController();
  readonly #prerequisites = new ArtifactResourceScope();
  readonly #inspections = new Set<
    Promise<Awaited<ReturnType<typeof inspectJadxAvailability>>>
  >();
  readonly #prerequisiteOwner: RetainedResourceScope = {
    retain: (owner, resource) =>
      this.#prerequisites.retain({
        kind: "lease",
        resource,
        lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
      }),
    run: (operation) => this.#prerequisites.run(operation),
  };
  #closePromise: Promise<void> | undefined;
  constructor(
    readonly environment: Readonly<Record<string, string | undefined>>,
    readonly launcher?: JadxLauncher,
    readonly settings?: AnalysisSettingsReader,
  ) {}

  /** Report actual local prerequisites without starting JADX or opening a target. */
  inspectAvailability(signal?: AbortSignal) {
    const environment = snapshotEnvironment(this.environment);
    const pending = inspectJadxAvailability(environment, {
      operationTimeoutMs:
        this.settings?.().overrides["jadx.operation_timeout_ms"],
      resourceOwner: this.#prerequisiteOwner,
      signal:
        signal === undefined
          ? this.#shutdown.signal
          : AbortSignal.any([signal, this.#shutdown.signal]),
    });
    this.#inspections.add(pending);
    void pending.then(
      () => this.#inspections.delete(pending),
      () => this.#inspections.delete(pending),
    );
    return pending;
  }

  /** Serialize expensive work and bind both raw and normalized results to the APK. */
  async execute(
    target: BinaryTarget,
    request: AndroidRequest,
    options?: ExecutionOptions,
  ): Promise<Outcome> {
    if (this.#shutdown.signal.aborted)
      return err(
        new AnalysisCancelledError(request.operation, {
          cause: this.#shutdown.signal.reason,
        }),
      );
    const signal =
      options?.signal === undefined
        ? this.#shutdown.signal
        : AbortSignal.any([options.signal, this.#shutdown.signal]);
    const predecessor = this.#tail;
    let release: () => void = () => {};
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await waitForTurn(predecessor, request, signal);
    } catch (cause) {
      void predecessor.then(release);
      return err(
        cause instanceof AnalysisError
          ? cause
          : new AnalysisCancelledError(request.operation, { cause }),
      );
    }
    try {
      if (signal.aborted)
        return err(
          new AnalysisCancelledError(request.operation, {
            cause: signal.reason,
          }),
        );
      clearTimeout(this.#idle);
      const retired =
        this.#pendingCleanup === undefined
          ? ok(undefined)
          : await this.#retire();
      const cleanup = await this.#retryPrerequisiteCleanup(request.operation);
      const outcome: Outcome =
        !retired.ok && !cleanup.ok
          ? err(
              analysisErrorWithCleanupFailure(
                retired.error,
                cleanup.error,
                request.operation,
              ).bindCleanupDependencies([retired.error, cleanup.error]),
            )
          : !retired.ok
            ? retired
            : !cleanup.ok
              ? cleanup
              : signal.aborted
                ? err(
                    new AnalysisCancelledError(request.operation, {
                      cause: signal.reason,
                    }),
                  )
                : await this.#execute(target, request, { signal });
      // A refusal before session work, such as a bad mapping, keeps the session.
      if (
        outcome.ok ||
        this.#retained !== undefined ||
        this.#mappingCache !== undefined ||
        this.#prerequisites.hasPending ||
        this.#pendingCleanup !== undefined
      )
        this.#scheduleIdle();
      return outcome;
    } finally {
      release();
    }
  }

  /** Cancel queued/active operations and join the owned engine and workspace cleanup. */
  close(): Promise<void> {
    this.#shutdown.abort();
    clearTimeout(this.#idle);
    this.#closePromise ??= this.#tail
      .then(async () => {
        this.#mappingCache = undefined;
        await Promise.allSettled(this.#inspections);
        const retired = await this.#retire();
        try {
          await this.#prerequisites.close();
        } catch (cause: unknown) {
          const cleanup = analysisClientFailureForOperation(
            cause,
            "jadx",
            "close_binary",
          );
          if (!retired.ok)
            throw analysisErrorWithCleanupFailure(
              retired.error,
              cleanup,
              "close_binary",
            ).bindCleanupDependencies([retired.error, cleanup]);
          throw cleanup;
        }
        if (!retired.ok) throw retired.error;
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  async #retire(): Promise<Result<void, AnalysisError>> {
    if (this.#pendingCleanup === undefined && this.#retained !== undefined) {
      this.#pendingCleanup = {
        operation: "close_binary",
        session: this.#retained.session,
        root: this.#retained.root,
        fileHandles: new Map(),
        previousError: undefined,
        operationCause: undefined,
        reportedErrors: [],
      };
      this.#retained = undefined;
    }
    if (this.#pendingCleanup === undefined) return ok(undefined);
    const pending = this.#pendingCleanup;
    const result = await cleanup(pending);
    if (result.ok) {
      for (const reportedError of pending.reportedErrors)
        reportedError.deref()?.resolveCleanup();
      pending.reportedErrors = [];
      this.#pendingCleanup = undefined;
    } else {
      pending.reportedErrors = [
        ...pending.reportedErrors.filter(
          (reportedError) => reportedError.deref() !== undefined,
        ),
        new WeakRef(result.error),
      ];
    }
    return result;
  }

  async #readMapping(
    request: AndroidRequest,
    signal: AbortSignal,
    deadline: AndroidMappingReadDeadline,
  ): Promise<Result<AndroidMappingSource | undefined, AnalysisError>> {
    if (
      !("mapping_path" in request.input) ||
      request.input.mapping_path === undefined
    )
      return ok(undefined);
    const read = await readAndroidMapping(
      request.input.mapping_path,
      request.operation,
      this.#prerequisites,
      signal,
      this.#mappingCache,
      deadline,
    );
    if (read.ok) this.#mappingCache = read.value;
    return read;
  }

  /** Every serialized request retries retained file owners before session reuse. */
  async #retryPrerequisiteCleanup(
    operation: string,
  ): Promise<Result<void, AnalysisError>> {
    if (!this.#prerequisites.hasPending) return ok(undefined);
    try {
      await this.#prerequisites.retryCleanup();
      return ok(undefined);
    } catch (cause: unknown) {
      return err(analysisClientFailureForOperation(cause, "jadx", operation));
    }
  }

  #scheduleIdle(): void {
    this.#idle = setTimeout(() => {
      this.#tail = this.#tail.then(async () => {
        this.#mappingCache = undefined;
        await this.#retire();
        await this.#retryPrerequisiteCleanup("close_binary");
      });
    }, 60_000);
    this.#idle.unref();
  }

  async #execute(
    target: BinaryTarget,
    request: AndroidRequest,
    options: ExecutionOptions,
  ): Promise<Outcome> {
    const environment = snapshotEnvironment(this.environment);
    // Resolve the accepted operation's override before acquiring any resource.
    // An unusable launch value is refused without starting the engine.
    const timeoutMs = resolveJadxOperationTimeout(
      environment,
      request.operation,
      this.settings?.().overrides["jadx.operation_timeout_ms"],
    );
    if (!timeoutMs.ok) return timeoutMs;
    const timeout = AbortSignal.timeout(timeoutMs.value);
    const signal =
      options.signal === undefined
        ? timeout
        : AbortSignal.any([options.signal, timeout]);
    // Mapping reads and cache replacements are serialized under the deadline.
    // A replacement parse can briefly coexist with the previous cached index.
    // Its failure is the caller's input and returns before any session work.
    const mapping = await this.#readMapping(request, signal, {
      timeout,
      timeoutMs: timeoutMs.value,
    });
    if (!mapping.ok) return mapping;
    let root: JadxWorkspaceRoot | undefined;
    let session: JadxSession | undefined;
    const fileHandles: PendingCleanup["fileHandles"] = new Map();
    const retainFailedClose =
      (path: string) =>
      (owner: OwnedFileHandle): void => {
        fileHandles.set(owner, path);
      };
    try {
      if (target.format !== "apk")
        throw new AnalysisCapabilityUnavailableError(
          "jadx",
          request.operation,
          `Target ${target.path} is ${target.format}; provide one standalone APK.`,
        );
      const configuration = await resolveJadxConfigurationInputs(
        environment,
        request.operation,
        signal,
      );
      throwIfJadxInterrupted(signal);
      const jarHash = await hashAndroidSource(
        configuration.jar,
        request.operation,
        signal,
        retainFailedClose(configuration.jar),
      );
      const bridgeHash = await hashAndroidSource(
        BRIDGE_SOURCE,
        request.operation,
        signal,
        retainFailedClose(BRIDGE_SOURCE),
      );
      let targetHash: string;
      try {
        targetHash = (
          await hashStableFile(target.path, {
            signal,
            retainFailedClose: retainFailedClose(target.path),
          })
        ).sha256;
      } catch (cause: unknown) {
        if (signal.aborted) throw cause;
        if (cause instanceof RegularFileChangedError)
          throw androidTargetChanged(request.operation, target.path, cause);
        throw cause;
      }
      if (targetHash !== target.sha256)
        throw androidTargetChanged(request.operation, target.path);
      const key = JSON.stringify({
        path: target.path,
        sha256: target.sha256,
        jar: configuration.jar,
        jarHash,
        bridgeHash,
        java: configuration.java,
        arguments: configuration.jvmArguments,
        options: [
          environment.JAVA_TOOL_OPTIONS,
          environment._JAVA_OPTIONS,
          environment.JDK_JAVA_OPTIONS,
          environment.PATH,
          environment.JAVA_HOME,
        ],
      });
      if (this.#retained !== undefined && this.#retained.key !== key) {
        const retired = await this.#retire();
        if (!retired.ok) return retired;
      }
      let retained = this.#retained;
      if (retained === undefined) {
        await validateJadxConfiguration(
          configuration,
          environment,
          request.operation,
          {
            resourceOwner: this.#prerequisiteOwner,
            signal,
            operationDeadline: { signal: timeout, timeoutMs: timeoutMs.value },
          },
        );
        root = await createJadxWorkspaceRoot();
        const workspaceSignal =
          root.failureSignal === undefined
            ? signal
            : AbortSignal.any([signal, root.failureSignal]);
        const retainSnapshot = (path: string, owner: OwnedFileHandle): void => {
          fileHandles.set(owner, path);
        };
        const engine = await snapshotAndroidEngine(
          configuration.jar,
          jarHash,
          root.path,
          request.operation,
          workspaceSignal,
          retainSnapshot,
        );
        const snapshot = await snapshotAndroidTarget(
          target.path,
          target.sha256,
          root.path,
          request.operation,
          workspaceSignal,
          retainSnapshot,
        );
        const bridge = join(root.path, "ReaJadxBridge.java");
        await copyFile(BRIDGE_SOURCE, bridge);
        await chmod(bridge, 0o400);
        const copiedBridgeHash = await hashAndroidSource(
          bridge,
          request.operation,
          workspaceSignal,
          retainFailedClose(bridge),
        );
        if (copiedBridgeHash !== bridgeHash)
          throw androidSourceChanged(
            request.operation,
            BRIDGE_SOURCE,
            undefined,
          );
        throwIfJadxInterrupted(workspaceSignal);
        session = new JadxSession(
          {
            command: configuration.java,
            // Java PATH shims may execute an interpreter or replace themselves.
            // Match the prerequisite probe's run-token ownership policy.
            expectedCommand: null,
            arguments: [
              ...configuration.jvmArguments,
              "--class-path",
              engine.path,
              bridge,
            ],
            cwd: root.path,
            hostEnvironment: environment,
            signal: workspaceSignal,
          },
          this.launcher,
        );
        retained = {
          key,
          root,
          session,
          snapshot,
          jarHash: engine.sha256,
          bridgeHash,
        };
      }
      root = retained.root;
      session = retained.session;
      const activeSignal =
        root.failureSignal === undefined
          ? signal
          : AbortSignal.any([signal, root.failureSignal]);
      const { snapshot } = retained;
      const outcome = ok(
        await session.execute({
          request,
          target,
          snapshot,
          jarHash: retained.jarHash,
          bridgeHash: retained.bridgeHash,
          signal: activeSignal,
          timeoutMs: timeoutMs.value,
          mapping: mapping.value,
          resources: this.#prerequisites,
          deadline: timeout,
        }),
      );
      throwIfJadxInterrupted(activeSignal);
      this.#retained = retained;
      return outcome;
    } catch (cause) {
      const failure = captureJadxFailure({
        cause,
        request,
        timeout,
        timeoutMs: timeoutMs.value,
        signal: options.signal,
        session,
      });
      // Admission can fail before selecting an existing session for execution.
      root ??= this.#retained?.root;
      session ??= this.#retained?.session;
      this.#retained = undefined;
      this.#pendingCleanup = {
        operation: request.operation,
        session,
        root,
        fileHandles,
        get previousError() {
          return failure();
        },
        operationCause: cause,
        reportedErrors: [],
      };
      const retired = await this.#retire();
      return retired.ok ? err(failure()) : retired;
    }
  }
}
