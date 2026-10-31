import { EvmAdmissionError } from "./EvmAdmissionError.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { safeParseUtf8Json } from "../domain/safeJson.js";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createAnalysisExecution,
  type ExecutionOptions,
  type ProviderAvailability,
} from "../application/AnalysisProvider.js";
import type {
  EvmInterfaceExecution,
  EvmInterfacePort,
} from "../application/evm/EvmInterfacePort.js";
import {
  completedStableArtifact,
  readStableArtifact,
} from "../artifacts/readStableArtifact.js";
import { completedStableArtifactObservation } from "../artifacts/StableArtifactObservation.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
} from "../artifacts/ArtifactFileOperation.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import {
  OwnedCommandFailure,
  ownedCommandResources,
  runOwnedCommand,
} from "../process/OwnedCommand.js";
import {
  AnalysisError,
  type AnalysisCapturedOutput,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import {
  projectAnalysisError,
  projectAnalysisErrorWithoutCapturedOutput,
} from "../domain/analysisErrorProjection.js";
import { evmInterfaceEvidence } from "../domain/evm/evmInterfaceEvidence.js";
import {
  DEFAULT_EVM_TIMEOUT_MS,
  type InspectEvmInterfaceInput,
  evmInterfaceSchema,
} from "../domain/evm/evmInterface.js";
import { solidityMetadataSchema } from "../domain/evm/solidityMetadata.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import {
  evmInterfaceFailure,
  capturedEvmOutput,
  evmReplyBudgetFailure,
  type EvmFileSizeFailureEvidence,
} from "./EvmoleFailures.js";
import {
  evmoleInterfaceReplySchema,
  projectEvmoleFunctions,
} from "./EvmoleInterfaceAdapter.js";
import {
  EVMOLE_PROVIDER_IDENTITY,
  EVM_CPU_SECONDS,
  EVM_INTERFACE_LIMITS,
  EVM_FILE_SIZE_FAILURE_EXIT,
} from "./EvmoleRelease.js";
import { decodeEvmBytecodeCarrier } from "./EvmBytecodeCarrier.js";
import {
  selectEvmWorkerLimits,
  type EvmWorkerLimits,
} from "./EvmWorkerLimits.js";

const OPERATION = "inspect_evm_interface";
const HOST_REQUIREMENT =
  "Initial real-verified offline EVM interface profile supports Linux x64 only.";

/** The EVM interface profile runs only on Linux x64; discovery and execution share this check. */
export const evmHostSupported = (
  platform: NodeJS.Platform,
  arch: string,
): boolean => platform === "linux" && arch === "x64";
export const EVM_PRLIMIT_COMMAND_DEFAULT = "/usr/bin/prlimit";

export interface EvmLimiterProbeFileSystem {
  access(path: string, mode: number): Promise<void>;
  stat(path: string): Promise<{ isFile(): boolean }>;
}

export interface EvmLimiterProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly fs?: EvmLimiterProbeFileSystem;
  readonly signal?: AbortSignal;
}

type EvmLimiterSelection = {
  readonly path: string;
  readonly diagnostics: Readonly<Record<string, JsonValue>>;
};
type EvmLimiterUnavailable = EvmLimiterSelection & {
  readonly reason: string;
  readonly cause: unknown;
};

/** Select and validate the exact limiter using the same owner check at discovery and admission. */
const selectEvmLimiter = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  probes?: {
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly fs?: EvmLimiterProbeFileSystem;
  },
  signal?: AbortSignal,
  operation = OPERATION,
): Promise<Result<EvmLimiterSelection, EvmLimiterUnavailable> | undefined> => {
  const throwIfAborted = (): void => {
    if (signal?.aborted)
      throw new AnalysisCancelledError(operation, { cause: signal.reason });
  };
  throwIfAborted();
  const platform = probes?.platform ?? process.platform;
  const arch = probes?.arch ?? process.arch;
  if (!evmHostSupported(platform, arch)) return undefined;

  const path =
    environment.REA_EVM_PRLIMIT_COMMAND ?? EVM_PRLIMIT_COMMAND_DEFAULT;
  const diagnostics = { limiter_path: path, platform, arch };
  try {
    if (!isAbsolute(path))
      throw new EvmAdmissionError("prlimit_not_absolute", {
        setting: "REA_EVM_PRLIMIT_COMMAND",
      });
    const fs = probes?.fs ?? { access, stat };
    await fs.access(path, constants.X_OK);
    throwIfAborted();
    if (!(await fs.stat(path)).isFile())
      throw new EvmAdmissionError("prlimit_not_file");
    throwIfAborted();
    return ok({ path, diagnostics });
  } catch (cause: unknown) {
    throwIfAborted();
    if (cause instanceof EvmAdmissionError)
      return err({
        path,
        diagnostics: {
          ...diagnostics,
          code: cause.code,
          ...cause.detail,
        },
        reason: cause.code,
        cause,
      });
    const reason = `Offline EVM interface inspection requires caller-supplied util-linux prlimit: ${path}; ${cause instanceof Error ? cause.message : String(cause)}`;
    return err({ path, diagnostics, reason, cause });
  }
};

/** Fresh, process-free observation of the limiter prerequisite used by EVM execution. */
export const evmLimiterAvailability = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  probes?: EvmLimiterProbeOptions,
): Promise<ProviderAvailability | undefined> => {
  const selected = await selectEvmLimiter(
    environment,
    probes,
    probes?.signal,
    "binary_session",
  );
  if (selected === undefined) return undefined;
  return selected.ok
    ? {
        status: "available",
        code: null,
        reason: null,
        diagnostics: selected.value.diagnostics,
      }
    : {
        status: "unavailable",
        code: "executable_missing",
        reason: selected.error.reason,
        diagnostics: selected.error.diagnostics,
      };
};

const replySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    version: z.literal("0.9.3"),
    bytecode: z.strictObject({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.int().nonnegative(),
      hex: z.string().regex(/^(?:[a-f0-9]{2})*$/),
      metadata: solidityMetadataSchema.optional(),
    }),
    raw: evmoleInterfaceReplySchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["format", "decoder", "output-limit", "unsupported"]),
    message: z.string(),
  }),
]);
type Launcher = NonNullable<Parameters<typeof runOwnedCommand>[2]>["launcher"];
type EvmOutcome = Result<EvmInterfaceExecution, AnalysisError>;
type EvmRuntimeRoot = Pick<PrivateRuntimeRoot, "path" | "close">;
type PendingEvmCleanup = {
  readonly input: InspectEvmInterfaceInput;
  readonly result: EvmOutcome;
  readonly output: AnalysisCapturedOutput | undefined;
  root:
    | { readonly owner: EvmRuntimeRoot; readonly lease: AnalysisCleanupLease }
    | undefined;
  process: { readonly lease: AnalysisCleanupLease } | undefined;
};

const ownerCleanupMarker = (
  owners: readonly AnalysisCleanupLease[],
): ProviderCleanupError =>
  new ProviderCleanupError(
    EVMOLE_PROVIDER_IDENTITY.id,
    owners.flatMap((owner) => owner.cleanupResources ?? ["owned-EVM-resource"]),
    { reason: "Exact EVM cleanup owners have not confirmed release." },
    { operation: OPERATION },
  );

const bindEvmCleanupOwners = (
  failure: AnalysisError,
  owners: readonly AnalysisCleanupLease[],
  primary?: AnalysisError,
): void => {
  const marker = ownerCleanupMarker(owners);
  new AnalysisCleanupLeaseGroup(marker, owners);
  failure.bindCleanupDependencies([
    marker,
    ...(primary?.cleanupIncomplete === true ? [primary] : []),
  ]);
};

const retainedCleanupFailure = (cause: unknown): ProviderCleanupError => {
  if (cause instanceof ProviderCleanupError) return cause;
  if (cause instanceof ArtifactReaderFailure) {
    const observation = ArtifactReaderFailure.cleanupObservation(
      cause,
      "EVM artifact resources",
    );
    const failure = new ProviderCleanupError(
      EVMOLE_PROVIDER_IDENTITY.id,
      observation.resources.length === 0
        ? ["EVM artifact resources"]
        : observation.resources,
      { reason: observation.reason },
      { operation: OPERATION, cause },
    );
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  return new ProviderCleanupError(
    EVMOLE_PROVIDER_IDENTITY.id,
    cause instanceof AnalysisError && cause.cleanupResources.length > 0
      ? cause.cleanupResources
      : ["EVM provider cleanup"],
    { reason: cause instanceof Error ? cause.message : String(cause) },
    {
      operation: OPERATION,
      cause,
      ...(cause instanceof AnalysisError ? { cleanupPrimary: cause } : {}),
    },
  );
};

const compactErrorProjection = (error: AnalysisError) => {
  const projection = projectAnalysisError(error);
  if (error.capturedOutput === undefined) return projection;
  // The cleanup result owns this exact captured stream. Other diagnostics and
  // partial Evidence retain their original fields, including stdout/stderr.
  const details = { ...projection.details };
  delete details.captured_output;
  return { ...projection, details };
};

const evmCleanupFailure = (
  input: InspectEvmInterfaceInput,
  result: EvmOutcome,
  resources: readonly string[],
  reason: string,
  output?: AnalysisCapturedOutput,
  cause?: unknown,
): ProviderCleanupError => {
  const partialObservation = result.ok
    ? evmInterfaceEvidence(input, result.value)
    : result.error.partialObservation;
  const capturedOutput = result.ok
    ? output
    : (result.error.capturedOutput ?? output);
  return new ProviderCleanupError(
    EVMOLE_PROVIDER_IDENTITY.id,
    resources,
    {
      reason,
      previous_error: result.ok ? null : compactErrorProjection(result.error),
      ...(capturedOutput === undefined
        ? {}
        : { captured_output: { ...capturedOutput } }),
    },
    {
      operation: OPERATION,
      ...(result.ok ? {} : { cleanupPrimary: result.error }),
      ...(cause === undefined ? {} : { cause }),
      ...(partialObservation === undefined ? {} : { partialObservation }),
    },
  );
};

/** The private reply owner separates completed bytes from descriptor finalization. */
const evmReplyCompletionFailure = (
  cause: ArtifactReaderFailure,
  capturedOutput: AnalysisCapturedOutput,
): AnalysisError => {
  const cancellation =
    cause.reason === "cancelled"
      ? new AnalysisCancelledError(OPERATION, {
          cause: artifactFileCancellationCause(cause),
          capturedOutput,
        })
      : undefined;
  if (cause.cleanup === undefined) {
    if (cancellation !== undefined) return cancellation;
    return new AnalysisOutputError(
      OPERATION,
      "Owned EVM reply finalization failed.",
      { cause, capturedOutput },
    );
  }
  const cleanup = new ProviderCleanupError(
    EVMOLE_PROVIDER_IDENTITY.id,
    cause.cleanup.resources,
    { phase: "reply_descriptor_close", reason: cause.cleanup.reason },
    { operation: OPERATION, cause, capturedOutput },
  );
  bindArtifactFileCleanup(cause, cleanup);
  return cancellation === undefined
    ? cleanup
    : analysisErrorWithCleanupFailure(
        cancellation,
        cleanup,
        OPERATION,
      ).bindCleanupDependencies([cancellation, cleanup]);
};

/** Run unchanged EVMole/WASM in an owned worker; no target, chain or network execution. */
export class EvmoleInterfaceProvider implements EvmInterfacePort {
  readonly #resources = new ArtifactResourceScope();
  #resourceScopeLease: AnalysisCleanupLease | undefined;
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #pendingCleanup: PendingEvmCleanup | undefined;

  #artifactScopeLease(): AnalysisCleanupLease {
    if (this.#resourceScopeLease !== undefined) return this.#resourceScopeLease;
    const provider = this;
    const owner = {
      close: () => provider.#resources.close(),
      get cleanupResources() {
        return provider.#resources.cleanupResources;
      },
    };
    this.#resourceScopeLease = AnalysisCleanupLease.forCloseOwner(
      owner,
      "EVM artifact resources",
    );
    return this.#resourceScopeLease;
  }

  constructor(
    readonly environment: Readonly<NodeJS.ProcessEnv> = process.env,
    readonly launcher?: Launcher,
    readonly createRuntime: () => Promise<
      Pick<PrivateRuntimeRoot, "path" | "close">
    > = () => PrivateRuntimeRoot.create({ prefix: "rea-evm-interface-" }),
  ) {}

  /** Bind recovered interface candidates to both original carrier and decoded byte identity. */
  inspect(
    input: InspectEvmInterfaceInput,
    options?: ExecutionOptions,
  ): Promise<Result<EvmInterfaceExecution, AnalysisError>> {
    if (this.#closing) return Promise.resolve(err(this.#closedError()));
    const operation = this.#tail.then(async () => {
      if (this.#closing) return err(this.#closedError());
      const environment = snapshotEnvironment(this.environment);
      try {
        return await this.#resources.run(() =>
          this.#inspect(input, environment, options),
        );
      } catch (cause: unknown) {
        const failure = evmInterfaceFailure(
          cause,
          "artifact-read",
          input.path,
          undefined,
          environment.REA_EVM_PRLIMIT_COMMAND ?? EVM_PRLIMIT_COMMAND_DEFAULT,
          undefined,
          input.timeout_ms ?? DEFAULT_EVM_TIMEOUT_MS,
        );
        if (cause instanceof ArtifactReaderFailure)
          bindArtifactFileCleanup(cause, failure);
        return err(failure);
      }
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #inspect(
    input: InspectEvmInterfaceInput,
    environment: Readonly<NodeJS.ProcessEnv>,
    options?: ExecutionOptions,
  ): Promise<Result<EvmInterfaceExecution, AnalysisError>> {
    const pending = await this.#retire();
    if (pending !== undefined) return err(pending);
    let root: Pick<PrivateRuntimeRoot, "path" | "close"> | undefined;
    let rootLease: AnalysisCleanupLease | undefined;
    let processOwner: ProviderProcessSupervisor | undefined;
    let processLease: AnalysisCleanupLease | undefined;
    let processCleanup:
      | {
          readonly reason: string;
          readonly resources: readonly string[];
        }
      | undefined;
    const processLeases = new WeakMap<
      ProviderProcessSupervisor,
      AnalysisCleanupLease
    >();
    const processLeaseFor = (owner: ProviderProcessSupervisor) => {
      let lease = processLeases.get(owner);
      if (lease === undefined) {
        lease = new AnalysisCleanupLease(
          async () => {
            const stopped = await owner.stop();
            if (
              stopped.status === "incomplete" ||
              stopped.status === "not-owned"
            )
              throw new EvmAdmissionError(
                stopped.status === "incomplete"
                  ? "cleanup_incomplete"
                  : "cleanup_unconfirmed",
                stopped.status === "incomplete"
                  ? { reason: stopped.reason }
                  : undefined,
                { cause: stopped },
              );
          },
          owner.launch.ownership === undefined
            ? ["owned-worker"]
            : ownedCommandResources(owner.launch.ownership, root?.path),
        );
        processLeases.set(owner, lease);
      }
      return lease;
    };
    const rootLeaseFor = (owner: EvmRuntimeRoot) => {
      rootLease ??= AnalysisCleanupLease.forCloseOwner(owner, owner.path);
      return rootLease;
    };
    const timeoutMs = input.timeout_ms ?? DEFAULT_EVM_TIMEOUT_MS;
    let retainedOutput: AnalysisCapturedOutput | undefined;
    let replyFinalization: AnalysisError | undefined;
    let phase: "configuration" | "artifact-read" | "worker" = "configuration";
    let workerLimits: EvmWorkerLimits | undefined;
    let limiter =
      environment.REA_EVM_PRLIMIT_COMMAND ?? EVM_PRLIMIT_COMMAND_DEFAULT;
    let result: Result<EvmInterfaceExecution, AnalysisError>;
    try {
      if (options?.signal?.aborted)
        throw new AnalysisCancelledError(OPERATION, {
          cause: options.signal.reason,
        });
      if (!evmHostSupported(process.platform, process.arch))
        throw new AnalysisCapabilityUnavailableError(
          EVMOLE_PROVIDER_IDENTITY.id,
          OPERATION,
          HOST_REQUIREMENT,
          { userMessage: HOST_REQUIREMENT },
        );
      const selectedLimiter = await selectEvmLimiter(
        environment,
        undefined,
        options?.signal,
      );
      if (selectedLimiter === undefined)
        throw new AnalysisCapabilityUnavailableError(
          EVMOLE_PROVIDER_IDENTITY.id,
          OPERATION,
          HOST_REQUIREMENT,
          { userMessage: HOST_REQUIREMENT },
        );
      if (!selectedLimiter.ok) {
        limiter = selectedLimiter.error.path;
        throw new AnalysisCapabilityUnavailableError(
          EVMOLE_PROVIDER_IDENTITY.id,
          OPERATION,
          selectedLimiter.error.reason,
          {
            cause: selectedLimiter.error.cause,
            diagnostics: selectedLimiter.error.diagnostics,
            userMessage: selectedLimiter.error.reason,
          },
        );
      }
      limiter = selectedLimiter.value.path;
      let inheritedLimits: string;
      try {
        inheritedLimits = await readFile("/proc/self/limits", "utf8");
      } catch (cause: unknown) {
        const reason = `Could not read inherited Linux resource limits at /proc/self/limits: ${cause instanceof Error ? cause.message : String(cause)}`;
        throw new AnalysisCapabilityUnavailableError(
          EVMOLE_PROVIDER_IDENTITY.id,
          OPERATION,
          reason,
          { cause, userMessage: reason },
        );
      }
      const limits = selectEvmWorkerLimits(inheritedLimits);
      if (!limits.ok)
        throw new AnalysisCapabilityUnavailableError(
          EVMOLE_PROVIDER_IDENTITY.id,
          OPERATION,
          limits.error,
          { userMessage: limits.error },
        );
      workerLimits = limits.value;
      phase = "artifact-read";
      const carrier = await readStableArtifact(
        input.path,
        EVM_INTERFACE_LIMITS.inputBytes,
        options?.signal,
        undefined,
        this.#resources,
      );
      phase = "worker";
      root = await this.createRuntime();
      rootLeaseFor(root);
      const snapshotPath = join(root.path, "carrier.snapshot");
      const requestPath = join(root.path, "request.json");
      const replyPath = join(root.path, "reply.json");
      await writeFile(snapshotPath, carrier.bytes, {
        flag: "wx",
        mode: 0o600,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      await writeFile(
        requestPath,
        JSON.stringify({
          snapshot_path: snapshotPath,
          reply_path: replyPath,
          failure_marker_path: join(root.path, "resource.failure"),
          encoding: input.encoding,
        }),
        { flag: "wx", mode: 0o600 },
      );
      const { NODE_OPTIONS: _ambientNodeOptions, ...workerEnvironment } =
        environment;
      const execution = await runOwnedCommand(
        {
          command: limiter,
          arguments: [
            `--as=${String(workerLimits.addressSpaceBytes)}:`,
            `--fsize=${String(workerLimits.fileSizeBytes)}:`,
            "--core=0:",
            `--cpu=${String(workerLimits.cpuSeconds)}:`,
            "--",
            process.execPath,
            "--max-old-space-size=256",
            "--v8-pool-size=1",
            "--disable-wasm-trap-handler",
            fileURLToPath(
              new URL("./EvmoleInterfaceWorker.js", import.meta.url),
            ),
            requestPath,
          ],
          cwd: root.path,
          expectedCommand: null,
          runId: `rea-evm-interface-${randomUUID()}`,
          hostEnvironment: workerEnvironment,
        },
        {
          timeoutMs,
          diagnosticBytes: EVM_INTERFACE_LIMITS.diagnosticBytes,
        },
        {
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
          ...(this.launcher === undefined ? {} : { launcher: this.launcher }),
          retainCleanup: (owner, cleanup) => {
            processOwner = owner;
            processLease = processLeaseFor(owner);
            processCleanup = {
              reason: cleanup.reason,
              resources:
                owner.launch.ownership === undefined
                  ? ["owned-worker"]
                  : ownedCommandResources(owner.launch.ownership, root?.path),
            };
          },
        },
      );
      const capturedOutput = capturedEvmOutput(execution);
      retainedOutput = capturedOutput;
      let reply: z.output<typeof replySchema>;
      try {
        let file;
        try {
          file = await readStableArtifact(
            replyPath,
            EVM_INTERFACE_LIMITS.outputBytes,
            options?.signal,
            undefined,
            this.#resources,
          );
        } catch (cause: unknown) {
          const completed = completedStableArtifact(cause);
          if (
            !(cause instanceof ArtifactReaderFailure) ||
            completed === undefined
          )
            throw cause;
          file = completed;
          replyFinalization = evmReplyCompletionFailure(cause, capturedOutput);
        }
        const decoded = safeParseUtf8Json(file.bytes);
        if (!decoded.ok) throw decoded.cause;
        reply = replySchema.parse(decoded.value);
      } catch (cause: unknown) {
        const cleanup =
          cause instanceof ArtifactReaderFailure ? cause.cleanup : undefined;
        if (
          cause instanceof ArtifactReaderFailure &&
          cause.reason === "cancelled"
        ) {
          const failure = new AnalysisCancelledError(OPERATION, {
            cause: artifactFileCancellationCause(cause),
            capturedOutput,
            ...(cleanup === undefined ? {} : { cleanup }),
          });
          if (cause instanceof ArtifactReaderFailure)
            bindArtifactFileCleanup(cause, failure);
          throw failure;
        }
        const failure =
          cause instanceof ArtifactReaderFailure &&
          cause.reason === "limit" &&
          cause.boundary === "file-size"
            ? evmReplyBudgetFailure(cause.message, {
                cause,
                capturedOutput,
                ...(cleanup === undefined ? {} : { cleanup }),
              })
            : new AnalysisOutputError(
                OPERATION,
                `Owned interface worker reply failed for ${input.path}: ${cause instanceof Error ? cause.message : String(cause)}`,
                {
                  cause,
                  capturedOutput,
                  ...(cleanup === undefined ? {} : { cleanup }),
                },
              );
        if (cause instanceof ArtifactReaderFailure)
          bindArtifactFileCleanup(cause, failure);
        throw failure;
      }
      if (!reply.ok) {
        if (reply.reason === "unsupported")
          throw new AnalysisUnsupportedTargetError(
            OPERATION,
            input.path,
            reply.message,
            { capturedOutput },
          );
        if (reply.reason === "format")
          throw new AnalysisInputError(OPERATION, { capturedOutput }, [
            {
              path: ["path"],
              reason: "invalid_format",
              message: reply.message,
            },
          ]);
        if (reply.reason === "output-limit")
          throw evmReplyBudgetFailure(reply.message, {
            capturedOutput,
          });
        throw new ProviderAdapterError(EVMOLE_PROVIDER_IDENTITY.id, OPERATION, {
          diagnostics: {
            phase,
            failure_kind: reply.reason,
            reason: reply.message,
            stdout: execution.stdout.text,
            stderr: execution.stderr.text,
            captured_output: { ...capturedOutput },
          },
        });
      }
      const selectedBytes = decodeEvmBytecodeCarrier(
        carrier.bytes,
        input.encoding,
      );
      const selectedHex = Buffer.from(selectedBytes).toString("hex");
      const decodedHash = createHash("sha256")
        .update(selectedBytes)
        .digest("hex");
      if (
        decodedHash !== reply.bytecode.sha256 ||
        selectedHex !== reply.bytecode.hex ||
        selectedBytes.length !== reply.bytecode.bytes
      )
        throw new AnalysisOutputError(
          OPERATION,
          "Decoded bytecode representation does not match the selected carrier, encoding or reported SHA-256.",
          { capturedOutput },
        );
      const limitations = [
        `Configured worker resource soft limits: address_space_bytes=${String(workerLimits.addressSpaceBytes)}, cpu_seconds=${String(workerLimits.cpuSeconds)}, file_size_bytes=${String(workerLimits.fileSizeBytes)}. Selected from inherited tighter limits; original hard limits are retained. Effective worker limits are not independently probed.`,
        "Upstream may also report terminal metadata while recovering selectors. Its reported values are retained in raw_result, but integer precision and non-text-key coverage are unknown in the JS binding; complete original bytecode remains available.",
        "Recovered selectors, argument strings and mutability are upstream inferences, not verified ABI signatures or names. Empty results do not prove the absence of callable dispatch.",
        "Bytecode kind, hardfork and deployed-contract authenticity are unknown. This inspection performs no target runtime execution, chain/RPC lookup or network request.",
        "Original carrier and decoded bytecode SHA-256 are distinct identities; SHA-256 is not the Ethereum Keccak code hash.",
        "Terminal CBOR metadata is an independently decoded candidate, not proof of Solidity origin, source identity or deployment. Nested or unsupported values retain explicit unavailable interpretation and original byte ranges.",
        `The owned worker has a 256 MiB JavaScript heap. The profile maxima are ${String(EVM_INTERFACE_LIMITS.addressSpaceBytes)} address-space bytes and ${String(EVM_CPU_SECONDS)} CPU seconds; the configured soft limits above retain tighter inherited limits. The command deadline is timeout_ms at ${String(timeoutMs)} ms (default ${String(DEFAULT_EVM_TIMEOUT_MS)}). Those byte, address-space, and CPU maxima have no runtime override, and timeout_ms does not raise them. Virtual address space is distinct from resident memory; limits fail without partial success.`,
      ];
      const validated = evmInterfaceSchema.safeParse({
        artifact: {
          path: input.path,
          sha256: carrier.sha256,
          bytes: carrier.bytes.length,
          encoding: input.encoding,
        },
        bytecode: {
          ...reply.bytecode,
          digest_algorithm: "sha256",
          kind: "unknown",
          deployment_authenticity: "unknown",
          hardfork: "unknown",
        },
        evidence_kind: "inferred",
        functions: projectEvmoleFunctions(reply.raw),
        discovery_completeness: "unknown",
        runtime_execution: "not-performed",
        diagnostics: {
          stdout: execution.stdout.text,
          stderr: execution.stderr.text,
          truncated: capturedOutput.truncated,
        },
        limitations,
      });
      if (!validated.success)
        throw new AnalysisOutputError(
          OPERATION,
          `Interface worker returned invalid bytecode-relative evidence: ${validated.error.issues[0]?.message ?? "schema mismatch"}`,
          { capturedOutput },
        );
      const report = validated.data;
      result = ok(
        createAnalysisExecution(report, EVMOLE_PROVIDER_IDENTITY, {
          rawResult: reply.raw,
          subject: { path: input.path, format: "file", sha256: carrier.sha256 },
          locations: [{ kind: "artifact-path", path: input.path }],
          limitations,
        }),
      );
    } catch (cause: unknown) {
      if (
        cause instanceof OwnedCommandFailure &&
        cause.cleanupOwner !== undefined
      ) {
        processOwner = cause.cleanupOwner;
        processLease = processLeaseFor(cause.cleanupOwner);
      }
      let fileFailure: EvmFileSizeFailureEvidence | undefined;
      let markerCleanupFailure: ArtifactReaderFailure | undefined;
      if (
        cause instanceof OwnedCommandFailure &&
        cause.snapshot?.exitCode === EVM_FILE_SIZE_FAILURE_EXIT &&
        cause.snapshot.signal === null &&
        cause.cleanupOwner === undefined &&
        cause.cleanupFailure === null &&
        processOwner === undefined &&
        root !== undefined
      ) {
        try {
          let marker;
          try {
            marker = await readStableArtifact(
              join(root.path, "resource.failure"),
              1,
              undefined,
              undefined,
              this.#resources,
            );
          } catch (markerFailure: unknown) {
            if (
              markerFailure instanceof ArtifactReaderFailure &&
              markerFailure.cleanup !== undefined
            )
              markerCleanupFailure = markerFailure;
            const completed = completedStableArtifact(markerFailure);
            if (completed === undefined) throw markerFailure;
            marker = completed;
          }
          if (!marker.bytes.equals(Buffer.from("F")))
            throw new EvmAdmissionError("marker_mismatch");
          fileFailure = { verified: true, failure: null };
        } catch (markerFailure: unknown) {
          fileFailure = {
            verified: false,
            failure:
              markerFailure instanceof Error
                ? markerFailure.message
                : String(markerFailure),
          };
        }
      }
      let failure =
        options?.signal?.aborted &&
        (cause === options.signal.reason ||
          (cause instanceof Error && cause.name === "AbortError"))
          ? new AnalysisCancelledError(OPERATION, {
              cause,
              ...(retainedOutput === undefined
                ? {}
                : { capturedOutput: retainedOutput }),
              ...(cause instanceof ArtifactReaderFailure &&
              cause.cleanup !== undefined
                ? { cleanup: cause.cleanup }
                : {}),
            })
          : evmInterfaceFailure(
              cause,
              phase,
              input.path,
              workerLimits,
              limiter,
              fileFailure,
              timeoutMs,
            );
      if (markerCleanupFailure !== undefined) {
        const cleanup = retainedCleanupFailure(markerCleanupFailure);
        failure = analysisErrorWithCleanupFailure(
          failure,
          cleanup,
          OPERATION,
        ).bindCleanupDependencies([failure, cleanup]);
      }
      const artifactFailure =
        cause instanceof ArtifactReaderFailure ? cause : undefined;
      if (artifactFailure !== undefined)
        bindArtifactFileCleanup(artifactFailure, failure);
      // Only the selected-carrier read can establish caller-path snapshot identity.
      if (phase === "artifact-read") {
        const observation = completedStableArtifactObservation(
          cause,
          input.path,
        );
        if (observation !== undefined)
          failure.retainPartialObservation(observation);
      }
      result = err(failure);
    }
    if (replyFinalization !== undefined) {
      if (result.ok) {
        replyFinalization.retainPartialObservation(
          evmInterfaceEvidence(input, result.value),
        );
        result = err(replyFinalization);
      } else {
        result = err(
          replyFinalization.cleanupIncomplete
            ? analysisErrorWithCleanupFailure(
                result.error,
                replyFinalization,
                OPERATION,
              ).bindCleanupDependencies([result.error, replyFinalization])
            : result.error.retainSecondaryFailure(replyFinalization, {
                reply_finalization_error:
                  projectAnalysisErrorWithoutCapturedOutput(replyFinalization),
              }),
        );
      }
    }
    const retainCancellation = (outcome: EvmOutcome): EvmOutcome =>
      outcome.ok && options?.signal?.aborted
        ? err(
            new AnalysisCancelledError(OPERATION, {
              cause: options.signal.reason,
              partialObservation: evmInterfaceEvidence(input, outcome.value),
              ...(retainedOutput === undefined
                ? {}
                : { capturedOutput: retainedOutput }),
            }),
          )
        : outcome;
    result = retainCancellation(result);
    if (processOwner !== undefined) {
      const lease = processLeaseFor(processOwner);
      const rootOwnerLease =
        root === undefined ? undefined : rootLeaseFor(root);
      this.#pendingCleanup = {
        input,
        result,
        output: retainedOutput,
        root:
          root === undefined || rootOwnerLease === undefined
            ? undefined
            : { owner: root, lease: rootOwnerLease },
        process: { lease },
      };
      if (processCleanup === undefined) {
        const owners = [lease, rootOwnerLease].filter(
          (owner): owner is AnalysisCleanupLease => owner !== undefined,
        );
        if (!result.ok && result.error.cleanupIncomplete) {
          bindEvmCleanupOwners(result.error, owners);
          return result;
        }
        const failure = evmCleanupFailure(
          input,
          result,
          [
            ...new Set([
              ...(root === undefined ? [] : [root.path]),
              ...(lease.cleanupResources ?? []),
            ]),
          ],
          "Owned EVM worker cleanup remained unresolved without a failure description.",
          retainedOutput,
          processOwner,
        );
        bindEvmCleanupOwners(
          failure,
          owners,
          result.ok ? undefined : result.error,
        );
        return err(failure);
      }
      const failure = evmCleanupFailure(
        input,
        result,
        [
          ...new Set([
            ...(root === undefined ? [] : [root.path]),
            ...processCleanup.resources,
          ]),
        ],
        processCleanup.reason,
        retainedOutput,
        processOwner,
      );
      bindEvmCleanupOwners(
        failure,
        [lease, rootOwnerLease].filter(
          (lease): lease is AnalysisCleanupLease => lease !== undefined,
        ),
        result.ok ? undefined : result.error,
      );
      return err(failure);
    }
    if (root !== undefined) {
      try {
        await rootLeaseFor(root).release();
      } catch (cause: unknown) {
        const retainedRoot = root;
        const lease = rootLeaseFor(retainedRoot);
        const cleanupResult = retainCancellation(result);
        this.#pendingCleanup = {
          input,
          result: cleanupResult,
          output: retainedOutput,
          root: { owner: retainedRoot, lease },
          process: undefined,
        };
        root = undefined;
        const failure = evmCleanupFailure(
          input,
          cleanupResult,
          [retainedRoot.path],
          cause instanceof Error ? cause.message : String(cause),
          retainedOutput,
          cause,
        );
        bindEvmCleanupOwners(
          failure,
          [lease],
          cleanupResult.ok ? undefined : cleanupResult.error,
        );
        return err(failure);
      }
    }
    return retainCancellation(result);
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#closePromise ??= this.#tail
      .then(async () => {
        const [retirement, artifacts] = await Promise.allSettled([
          this.#retire(),
          this.#artifactScopeLease().release(),
        ]);
        const failures: AnalysisError[] = [];
        if (retirement.status === "rejected")
          failures.push(retainedCleanupFailure(retirement.reason));
        else if (retirement.value !== undefined)
          failures.push(retirement.value);
        if (artifacts.status === "rejected") {
          const scopeLease = this.#artifactScopeLease();
          const artifactFailure = retainedCleanupFailure(artifacts.reason);
          const marker = ownerCleanupMarker([scopeLease]);
          new AnalysisCleanupLeaseGroup(marker, [scopeLease]);
          artifactFailure.bindCleanupDependencies([marker]);
          failures.push(artifactFailure);
        }
        if (failures.length > 0) {
          const resources = failures.flatMap((failure) =>
            failure instanceof ProviderCleanupError
              ? failure.cleanupResources
              : failure instanceof ArtifactReaderFailure &&
                  failure.cleanup !== undefined
                ? failure.cleanup.resources
                : ["artifact-resources"],
          );
          const failure = new ProviderCleanupError(
            EVMOLE_PROVIDER_IDENTITY.id,
            [...new Set(resources)],
            {
              failures: failures.map((failure) =>
                failure instanceof Error ? failure.message : String(failure),
              ),
            },
            { operation: OPERATION, cause: new AggregateError(failures) },
          );
          failure.bindCleanupDependencies(failures);
          throw failure;
        }
      })
      .catch((cause: unknown) => {
        this.#closePromise = undefined;
        throw cause;
      });
    return this.#closePromise;
  }

  #closedError(): ProviderCleanupError {
    return new ProviderCleanupError(
      EVMOLE_PROVIDER_IDENTITY.id,
      [],
      { reason: "Provider is closing" },
      { operation: OPERATION },
    );
  }

  async #retire(): Promise<ProviderCleanupError | undefined> {
    const pending = this.#pendingCleanup;
    if (pending === undefined) return undefined;
    if (pending.process !== undefined) {
      try {
        await pending.process.lease.release();
      } catch (cause: unknown) {
        const failure = evmCleanupFailure(
          pending.input,
          pending.result,
          [
            ...new Set([
              ...(pending.root === undefined ? [] : [pending.root.owner.path]),
              ...(pending.process.lease.cleanupResources ?? []),
            ]),
          ],
          cause instanceof Error ? cause.message : String(cause),
          pending.output,
          cause,
        );
        bindEvmCleanupOwners(
          failure,
          [
            pending.process.lease,
            ...(pending.root === undefined ? [] : [pending.root.lease]),
          ],
          pending.result.ok ? undefined : pending.result.error,
        );
        return failure;
      }
      pending.process = undefined;
    }
    if (pending.root !== undefined) {
      const { owner: root, lease } = pending.root;
      try {
        await lease.release();
        pending.root = undefined;
      } catch (cause: unknown) {
        const failure = evmCleanupFailure(
          pending.input,
          pending.result,
          lease.cleanupResources ?? [root.path],
          cause instanceof Error ? cause.message : String(cause),
          pending.output,
          cause,
        );
        bindEvmCleanupOwners(
          failure,
          [lease],
          pending.result.ok ? undefined : pending.result.error,
        );
        return failure;
      }
    }
    this.#pendingCleanup = undefined;
    return undefined;
  }
}
