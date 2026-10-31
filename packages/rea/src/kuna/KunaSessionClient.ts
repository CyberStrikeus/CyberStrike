import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { basename } from "node:path";
import {
  regularFileCancellation,
  RegularFileCleanupFailure,
} from "../filesystem/OwnedRegularFile.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import type { ArtifactResourceOwner } from "../artifacts/ArtifactResourceScope.js";
import { z } from "zod";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisExecution,
  type AnalysisOperation,
  type ExecutionOptions,
  type RetainedResourceScope,
} from "../application/AnalysisProvider.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import type { AnalysisProfileCommitment } from "../domain/analysisProfile.js";
import {
  analysisSearchPredicate,
  analysisSearchQuerySchema,
} from "../domain/analysisSearch.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import { combineFunctionRelationshipCoverage } from "../domain/functionCallCoverage.js";
import { functionDossierSchema } from "../domain/native/functionDossier.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import { ABORTED, waitForAbortable } from "../process/AbortablePromise.js";
import { SharedStartupAttempt } from "../process/SharedStartupAttempt.js";
import {
  KUNA_INVENTORY_OUTPUT_BYTES,
  kunaFileCleanupError,
  kunaRetainedResourceCleanupError,
  type KunaProcessLauncher,
} from "./KunaCommand.js";
import { kunaFunctionDeadline } from "./KunaConfiguration.js";
import {
  createKunaResourceScope,
  inspectKunaInstallation,
  type KunaInstallation,
} from "./KunaInstallation.js";
import {
  kunaProjectKey,
  KunaPublishedProjectCleanupError,
  type KunaProject,
  type KunaProjectCache,
} from "./KunaProjectCache.js";
import type { KunaExportStatus } from "./KunaProjectExport.js";
import {
  parseKunaInventory,
  type KunaInventoryFunction,
} from "./KunaProjectFiles.js";
import {
  isKunaOperation,
  KUNA_RELATIONSHIP_LIMITATION,
  KUNA_SINGLE_FUNCTION_LIMITATION,
  kunaLimitations,
  type KunaOperation,
} from "./KunaProviderCapabilities.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";
import { KunaTargetCommands } from "./KunaTargetCommands.js";
import { KunaReferenceQueries } from "./KunaReferenceQueries.js";
import { KunaQueryWork } from "./KunaQueryWork.js";
import { KunaStringQueries } from "./KunaStringQueries.js";
import { normalizeKunaAddress } from "./KunaAddress.js";
import type { RegexMatchingDeadline } from "../config/regexMatchingDeadline.js";
import type { RegexWorkerHeapRequest } from "../config/regexWorkerHeapRequest.js";
import { KUNA_FUNCTION_TEXT_BYTES } from "./KunaLimits.js";
import type { KunaRunRelease, KunaRunSlots } from "./KunaRunSlots.js";
import {
  KunaProjectReader,
  type KunaProjectFileSpan,
} from "./KunaProjectReader.js";
import { kunaUnavailable } from "./KunaUnavailable.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { kunaQueryFailureForCaller } from "./KunaQueryErrors.js";

/** How often a request waiting on the project export reports that it still waits. */
const WAIT_PROGRESS_INTERVAL_MS = 10_000;

/** Where one answer's text came from, recorded in its raw result. */
type AnswerSource =
  | { readonly kind: "project-export"; readonly project: KunaProject }
  | { readonly kind: "single-function" };

interface InventoryIndex {
  readonly inventory: readonly KunaInventoryFunction[];
  readonly byAddress: ReadonlyMap<string, KunaInventoryFunction>;
  readonly byName: ReadonlyMap<string, readonly KunaInventoryFunction[]>;
}

/** A queued single-function request found the export finished first. */
const EXPORT_READY = Symbol("kuna-export-ready");

type SingleFunctionOutcome =
  | Result<string, AnalysisError>
  | typeof EXPORT_READY;

/** One single-function run that every request for its address shares. */
interface SingleFunctionRun {
  readonly outcome: Promise<SingleFunctionOutcome>;
  /** Stops the run once every waiter has left. */
  readonly controller: AbortController;
  waiters: number;
}

/**
 * Completed single-function texts a session keeps while it has no export
 * reader. Each repeat would otherwise analyze the whole image again; after a
 * failed export that holds for the rest of the session.
 */
const SINGLE_FUNCTION_TEXT_CACHE_BYTES = 16 * 1024 * 1024;
/** Charged per kept text beside its UTF-8 bytes. */
const SINGLE_FUNCTION_TEXT_ENTRY_BYTES = 256;

interface SingleFunctionText {
  readonly text: string;
  readonly bytes: number;
}

interface Answer {
  readonly result: JsonValue;
  readonly source: AnswerSource | null;
  readonly files?: readonly KunaProjectFileSpan[];
  readonly locations: readonly EvidenceLocation[];
  readonly limitations: readonly string[];
  readonly referenceSource?: JsonValue;
  readonly stringSource?: JsonValue;
  readonly relationshipCoverage?: RelationshipCoverage;
}

/**
 * Wait for work this session owns, stopping only this caller's wait when its
 * signal aborts; the work itself continues for other callers.
 */
const waitFor = async <T>(
  work: Promise<Result<T, AnalysisError>>,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<Result<T, AnalysisError>> => {
  const result = await waitForAbortable(work, signal);
  return result === ABORTED
    ? err(new AnalysisCancelledError(operation, { cause: signal?.reason }))
    : result;
};

/** An adopted export file disappeared or changed since its digest was verified. */
const isUnavailableProject = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" ||
    cause.code === "ENOTDIR" ||
    cause.code === "ESTALE");

/** Read through a call so a check before an await does not narrow later ones. */
const cancelled = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const failure = (operation: string, cause: unknown): AnalysisError =>
  cause instanceof AnalysisError
    ? cause
    : new ProviderAdapterError(KUNA_PROVIDER_ID, operation, {
        cause,
        userMessage: `Kuna ${operation} failed: ${message(cause)}`,
      });

/** Bind a refused descriptor retry to the leases that still own those handles. */
const descriptorCleanupError = (
  cause: ArtifactReaderFailure,
  operation: string,
): ProviderCleanupError => {
  const observation = ArtifactReaderFailure.cleanupObservation(
    cause,
    "Kuna provider file descriptor",
  );
  const error = new ProviderCleanupError(
    KUNA_PROVIDER_ID,
    observation.resources,
    { reason: observation.reason },
    { cause, operation },
  );
  bindArtifactFileCleanup(cause, error);
  return error;
};

/**
 * How a request that needs the export reports the export's failure. A session
 * never rebuilds a failed export, so repeating the request cannot succeed; the
 * error says what to change before reopening the target. Kuna settings are read
 * when REA starts, so changing one also needs a restart. Cancellation and
 * unproven cleanup keep their own errors, which callers must still observe.
 */
const exportUnavailable = (
  operation: string,
  failure: AnalysisError,
): AnalysisError => {
  if (failure instanceof AnalysisCancelledError || failure.cleanupIncomplete)
    return failure;
  const reason = failure.userMessage ?? failure.message;
  const exported = projectAnalysisError(failure);
  const restart =
    "REA reads Kuna settings when it starts, so restart REA, then reopen the target.";
  const next =
    failure instanceof AnalysisTimeoutError
      ? `To retry, set REA_KUNA_PROJECT_TIMEOUT_MS above ${String(failure.timeoutMs)} ms or raise REA_KUNA_JOBS in the environment that starts REA. ${restart}`
      : failure instanceof AnalysisResourceConstraintError &&
          failure.remediationAction !== undefined
        ? // A fixed buffer (`memory`) is no setting, so a restart cannot help.
          `${failure.remediationAction.replace(/\.?$/u, ".")}${failure.resource === "memory" ? "" : ` ${restart}`}`
        : "To retry, resolve the reported failure, then reopen the target.";
  return new AnalysisCapabilityUnavailableError(
    KUNA_PROVIDER_ID,
    operation,
    reason,
    {
      cause: failure,
      // Callers see only the top-level projection, so the export failure's
      // own projected code and details (its limits, target path, captured
      // output and diagnostics) travel whole rather than field by field.
      diagnostics: {
        export_error: failure._tag,
        export_code: exported.code,
        ...(exported.details === undefined
          ? {}
          : { export_details: exported.details }),
      },
      userMessage: `Kuna's project export failed, so ${operation} is unavailable in this session: ${reason.replace(/\.?$/u, ".")} ${next}`,
    },
  );
};

/** Kuna names a procedure by its inventory entry or by an exact entry address. */
const procedureSelectorSchema = z.string().min(1);

/**
 * One Kuna analysis session for one target.
 *
 * Reads come from the verified project export in REA's cache. Until that
 * export exists, listings use the inventory the export takes first and
 * pseudocode a single-function `kuna decompile`, while the export builds in
 * the background; assembly waits for it. Kuna always runs on a private copy
 * whose digest matches the selected target.
 */
export class KunaSessionClient implements AnalysisClient {
  readonly #target: BinaryTarget;
  readonly #profile: AnalysisProfileCommitment | undefined;
  readonly #cache: KunaProjectCache;
  readonly #environment: Readonly<NodeJS.ProcessEnv>;
  readonly #runSlots: KunaRunSlots;
  readonly #launcher: KunaProcessLauncher | undefined;
  readonly #resourceScope = new ArtifactResourceScope();
  readonly #spanLeases = new Map<
    OwnedFileHandle,
    {
      readonly lease: AnalysisCleanupLease;
      readonly scopeOwner: ArtifactResourceOwner;
    }
  >();
  /**
   * Serializes span admission and finalization. The byte read stays outside
   * this queue so one held read does not block another span's open.
   */
  #spanAdmission: Promise<void> = Promise.resolve();
  /** Single-function runs in flight, by entry address. */
  readonly #singleFunctionRuns = new Map<string, SingleFunctionRun>();
  /** Completed single-function texts by address, least recently used first. */
  readonly #singleFunctionTexts = new Map<string, SingleFunctionText>();
  #singleFunctionTextBytes = 0;
  /** Owns background work: aborting it cancels this session's export interest. */
  readonly #session = new AbortController();
  /** Requests and shared readers retain their resources until their work settles. */
  readonly #active = new Set<Promise<unknown>>();
  readonly #commands: KunaTargetCommands;
  readonly #queryWork: KunaQueryWork;
  readonly #references: KunaReferenceQueries;
  readonly #strings: KunaStringQueries;
  readonly #deadline: RegexMatchingDeadline;
  readonly #heapRequest: RegexWorkerHeapRequest;
  #installation:
    | SharedStartupAttempt<Result<KunaInstallation, AnalysisError>>
    | undefined;
  #inventory:
    | Promise<Result<readonly KunaInventoryFunction[], AnalysisError>>
    | undefined;
  #project: Promise<Result<KunaProject, AnalysisError>> | undefined;
  /** The cache lookup that decides #project, shared by concurrent first requests. */
  #starting: Promise<void> | undefined;
  /** The building export's inventory; undefined when it settles without one. */
  #exportInventory:
    | Promise<readonly KunaInventoryFunction[] | undefined>
    | undefined;
  #reader: KunaProjectReader | undefined;
  #inventoryIndex: InventoryIndex | undefined;
  #status: KunaExportStatus | undefined;
  #key: string | undefined;
  #exportFailure: string | undefined;
  /** Completed publication and its independently retained staging cleanup owner. */
  #publicationCleanup: KunaPublishedProjectCleanupError | undefined;
  #releasePin: (() => void) | undefined;
  /** Set once close starts; new requests are refused from then on. */
  #closing = false;
  /** Set only when close has released every owned resource. */
  #closed = false;

  constructor(
    target: BinaryTarget,
    profile: AnalysisProfileCommitment | undefined,
    dependencies: {
      readonly cache: KunaProjectCache;
      readonly runSlots: KunaRunSlots;
      readonly environment: Readonly<NodeJS.ProcessEnv>;
      readonly deadline: RegexMatchingDeadline;
      readonly heapRequest: RegexWorkerHeapRequest;
      readonly launcher?: KunaProcessLauncher;
    },
  ) {
    this.#target = target;
    this.#profile = profile;
    this.#cache = dependencies.cache;
    this.#runSlots = dependencies.runSlots;
    this.#environment = dependencies.environment;
    this.#launcher = dependencies.launcher;
    this.#commands = new KunaTargetCommands(target, {
      signal: this.#session.signal,
      ...(dependencies.launcher === undefined
        ? {}
        : { launcher: dependencies.launcher }),
    });
    this.#deadline = dependencies.deadline;
    this.#heapRequest = dependencies.heapRequest;
    this.#queryWork = new KunaQueryWork(
      this.#commands,
      {
        signal: this.#session.signal,
        own: (work) => this.#own(work),
        runSlots: dependencies.runSlots,
      },
      dependencies.deadline,
      dependencies.heapRequest,
    );
    this.#references = new KunaReferenceQueries(this.#queryWork);
    this.#strings = new KunaStringQueries(this.#queryWork);
  }

  async execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options: ExecutionOptions = {},
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (this.#closing)
      return err(kunaUnavailable(operation, "This Kuna session is closed."));
    return this.#own(
      this.#execute(operation, parameters, {
        ...options,
        signal:
          options.signal === undefined
            ? this.#session.signal
            : AbortSignal.any([this.#session.signal, options.signal]),
      }),
    );
  }

  #own<T>(work: Promise<T>): Promise<T> {
    this.#active.add(work);
    const release = () => this.#active.delete(work);
    void work.then(release, release);
    return work;
  }

  async #execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    // A peer can retain a descriptor after this check. Each span open rechecks
    // under #admitSpan, which shares its queue with that descriptor's close.
    const pendingDescriptors = await this.#pendingDescriptorCleanup(operation);
    if (pendingDescriptors !== undefined) return err(pendingDescriptors);
    if (cancelled(options.signal))
      return err(
        new AnalysisCancelledError(operation, {
          cause: options.signal?.reason,
        }),
      );
    if (operation !== "health" && !isKunaOperation(operation))
      return err(
        kunaUnavailable(
          operation,
          "Kuna answers procedure and string queries, pseudocode, assembly and references; this operation needs another provider.",
        ),
      );
    const document = parameters.document;
    if (document !== undefined && document !== this.#target.path)
      return err(
        new AnalysisInputError(
          operation,
          {
            userMessage:
              "A Kuna session analyzes one program; omit document or pass the selected target path.",
          },
          [
            {
              path: ["document"],
              reason: "invalid_value",
              expected: this.#target.path,
            },
          ],
        ),
      );
    const installation = await this.#ensureInstallation(
      operation,
      options.signal,
    );
    if (!installation.ok) return installation;
    try {
      if (operation === "health")
        return ok(
          this.#execution([], installation.value, {
            result: {
              ready: true,
              kuna: {
                version: installation.value.version,
                verified: installation.value.verified,
                sha256: installation.value.sha256,
              },
            },
            source: null,
            locations: [],
            limitations: [],
          }),
        );
      if (
        operation === "procedure_pseudo_code" ||
        operation === "procedure_assembly" ||
        operation === "analyze_function"
      )
        await this.#startProject(installation.value);
      const answer = await this.#answer(
        operation,
        parameters,
        installation.value,
        options,
      );
      if (!answer.ok)
        return err(kunaQueryFailureForCaller(answer.error, operation));
      if (cancelled(options.signal))
        return err(
          new AnalysisCancelledError(operation, {
            cause: options.signal?.reason,
          }),
        );
      return ok(
        this.#execution(
          kunaLimitations(operation, this.#deadline, this.#heapRequest),
          installation.value,
          answer.value,
        ),
      );
    } catch (cause: unknown) {
      if (cancelled(options.signal)) {
        const cancellation = regularFileCancellation(cause);
        return err(
          new AnalysisCancelledError(operation, {
            cause: cancellation === undefined ? cause : cancellation.reason,
          }),
        );
      }
      return err(failure(operation, cause));
    }
  }

  /**
   * Release everything this session owns. A failed close keeps reporting its
   * failure, and each later call retries the cleanup that remains.
   */
  async close(): Promise<Result<null, AnalysisError>> {
    if (this.#closed) return ok(null);
    if (!this.#closing) {
      this.#closing = true;
      this.#session.abort();
    }
    // Cancellation starts process shutdown; its completion proves whether it
    // is safe to remove private copies and exposes any retained cleanup owner.
    // An admitted request may create a shared reader after shutdown begins.
    while (this.#active.size > 0) await Promise.allSettled(this.#active);
    this.#references.clear();
    this.#strings.clear();
    this.#dropSingleFunctionTexts();
    await this.#project;
    await this.#inventory;
    const failures: ProviderCleanupError[] = [];
    // Kuna runs in its own process group; an export no other session wants
    // must stop before this session reports itself closed.
    if (this.#key !== undefined) {
      const settled = await this.#cache.settled(this.#key);
      if (!settled.ok) failures.push(settled.error);
    }
    const commands = await this.#commands.close();
    if (!commands.ok) failures.push(commands.error);
    try {
      await this.#resourceScope.close();
    } catch (cause: unknown) {
      if (!(cause instanceof ArtifactReaderFailure)) throw cause;
      failures.push(descriptorCleanupError(cause, "close_binary"));
    }
    if (failures.length > 0)
      return err(
        new ProviderCleanupError(
          KUNA_PROVIDER_ID,
          failures.flatMap((failed) => failed.cleanupResources),
          {
            reason: failures
              .map((failed) =>
                String(failed.diagnostics?.["reason"] ?? failed.message),
              )
              .join("; "),
          },
          {
            cause: new AggregateError(
              failures,
              "Kuna session cleanup remains incomplete",
            ),
            operation: "close_binary",
          },
        ).bindCleanupDependencies(failures),
      );
    this.#releasePin?.();
    this.#releasePin = undefined;
    this.#closed = true;
    return ok(null);
  }

  #execution(
    operationLimitations: readonly string[],
    installation: KunaInstallation,
    answer: Answer,
  ): AnalysisExecution {
    const source = answer.source;
    const files =
      source?.kind !== "project-export"
        ? []
        : (answer.files ?? []).map((file) => ({
            facet: file.facet,
            file: file.path,
            file_sha256:
              Object.values(source.project.manifest.files).find(
                ({ path }) => path === file.path,
              )?.sha256 ?? null,
            byte_offset: file.byteOffset,
            byte_length: file.byteLength,
          }));
    // Preserve the direct text source shape; combined answers retain every
    // component once, including its producing file digest and byte range.
    const recordedFiles =
      files.length === 1 ? files[0] : files.length === 0 ? {} : { files };
    return createAnalysisExecution(
      answer.result,
      {
        id: KUNA_PROVIDER_ID,
        name: "Kuna",
        version: installation.version,
      },
      {
        // Kuna's identity is in the analysis profile; the raw result records
        // only where file-backed text came from.
        ...(source === null &&
        answer.referenceSource === undefined &&
        answer.stringSource === undefined
          ? {}
          : {
              rawResult: {
                ...(source === null
                  ? {}
                  : {
                      source:
                        source.kind === "single-function"
                          ? { kind: "single-function" }
                          : {
                              kind: "project-export",
                              key: source.project.key,
                              directory: source.project.directory,
                              ...recordedFiles,
                            },
                      project_export: this.#exportState(),
                    }),
                ...(answer.referenceSource === undefined
                  ? {}
                  : { references: answer.referenceSource }),
                ...(answer.stringSource === undefined
                  ? {}
                  : { strings: answer.stringSource }),
              },
            }),
        limitations: [...operationLimitations, ...answer.limitations],
        ...(answer.relationshipCoverage === undefined
          ? {}
          : { relationshipCoverage: answer.relationshipCoverage }),
        locations: [
          { kind: "artifact-path", path: this.#target.path },
          ...answer.locations,
        ],
        ...(this.#profile === undefined
          ? {}
          : { analysisProfile: this.#profile }),
      },
    );
  }

  /** Where the background export stands, for callers deciding whether to wait. */
  #exportState(): JsonValue {
    if (this.#reader !== undefined)
      return {
        state: "ready",
        key: this.#reader.project.key,
        ...(this.#publicationCleanup === undefined
          ? {}
          : { cleanup_incomplete: this.#publicationCleanup.cleanupIncomplete }),
      };
    if (this.#project === undefined) return { state: "not-started" };
    if (this.#exportFailure !== undefined)
      return { state: "failed", reason: this.#exportFailure };
    return {
      state: "building",
      phase: this.#status?.phase ?? null,
      inventory_functions: this.#status?.inventory?.length ?? null,
    };
  }

  async #answer(
    operation: KunaOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Answer, AnalysisError>> {
    if (operation === "list_documents")
      return ok({
        result: [this.#target.path],
        source: null,
        locations: [],
        limitations: [],
      });
    if (
      operation === "xrefs" ||
      operation === "procedure_callers" ||
      operation === "procedure_callees"
    )
      return this.#referenceAnswer(
        operation,
        parameters,
        installation,
        options,
      );
    if (operation === "list_strings" || operation === "search_strings")
      return this.#stringAnswer(operation, parameters, installation, options);
    if (operation === "list_procedures" || operation === "search_procedures")
      return this.#procedureList(operation, parameters, installation, options);
    const inventory = await this.#ensureInventory(installation, options);
    if (!inventory.ok) return inventory;
    if (operation === "address_name")
      return this.#addressName(
        parameters,
        inventory.value,
        installation,
        options,
      );
    const entry = this.#resolve(
      operation,
      parameters.procedure,
      inventory.value,
    );
    if (!entry.ok) {
      const selectedAddress =
        operation === "procedure_address"
          ? normalizeKunaAddress(parameters.procedure)
          : undefined;
      if (selectedAddress === undefined) return entry;
      const graph = await this.#references.functionAt(
        installation,
        selectedAddress,
        operation,
        options.signal,
      );
      if (!graph.ok) return graph;
      if (graph.value === undefined) return entry;
      return ok({
        result: graph.value.address,
        source: null,
        locations: [{ kind: "address", address: selectedAddress }],
        limitations: [],
        referenceSource: graph.value.source,
      });
    }
    const locations = [
      { kind: "address", address: entry.value.address } as const,
    ];
    switch (operation) {
      case "procedure_address":
        return ok({
          result: entry.value.address,
          source: null,
          locations,
          limitations: [],
        });
      case "procedure_pseudo_code": {
        const pseudocode = await this.#pseudocode(
          operation,
          entry.value,
          installation,
          options,
        );
        if (!pseudocode.ok) return pseudocode;
        return ok({ ...pseudocode.value, locations });
      }
      case "procedure_assembly": {
        const assembly = await this.#assemblyText(
          operation,
          entry.value,
          installation,
          options,
        );
        if (!assembly.ok) return assembly;
        return ok({ ...assembly.value, locations });
      }
      case "analyze_function":
        return this.#withProject(operation, installation, options, (reader) =>
          this.#dossier(
            operation,
            entry.value,
            reader,
            installation,
            options.signal,
          ),
        );
    }
  }

  async #stringAnswer(
    operation: "list_strings" | "search_strings",
    parameters: Readonly<Record<string, JsonValue>>,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Answer, AnalysisError>> {
    const answer = await this.#own(
      this.#strings.execute(
        operation,
        parameters,
        installation,
        AbortSignal.any([
          this.#session.signal,
          ...(options.signal === undefined ? [] : [options.signal]),
        ]),
      ),
    );
    return answer.ok
      ? ok({
          result: answer.value.result,
          source: null,
          stringSource: answer.value.source,
          locations: [],
          limitations: [],
        })
      : answer;
  }

  async #procedureList(
    operation: "list_procedures" | "search_procedures",
    parameters: Readonly<Record<string, JsonValue>>,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Answer, AnalysisError>> {
    const query =
      operation === "search_procedures"
        ? analysisSearchQuerySchema.safeParse(parameters)
        : undefined;
    if (query !== undefined && !query.success)
      return err(
        analysisInputErrorFromIssues(operation, query.error.issues, parameters),
      );
    const inventory = await this.#ensureInventory(installation, options);
    if (!inventory.ok) return inventory;
    let selected = inventory.value;
    if (query?.success === true) {
      if (query.data.mode === "regex") {
        const matches = await this.#queryWork.match({
          operation,
          pattern: query.data.pattern,
          caseSensitive: query.data.case_sensitive,
          values: () => inventory.value.map(({ name }) => name),
          signal: options.signal,
        });
        if (!matches.ok) return matches;
        selected = matches.value.map((index) => inventory.value[index]!);
      } else {
        const matches = analysisSearchPredicate(query.data);
        selected = inventory.value.filter(({ name }) => matches(name));
      }
    }
    return ok({
      result: selected.map(({ address, name }) => ({ address, value: name })),
      source: null,
      locations: [],
      limitations: [],
    });
  }

  async #referenceAnswer(
    operation: "xrefs" | "procedure_callers" | "procedure_callees",
    parameters: Readonly<Record<string, JsonValue>>,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Answer, AnalysisError>> {
    const field = operation === "xrefs" ? "address" : "procedure";
    const selected = await this.#referenceAddress(
      operation,
      parameters[field],
      field,
      installation,
      options,
    );
    if (!selected.ok) return selected;
    const address = selected.value;
    const locations = [{ kind: "address" as const, address }];
    if (operation === "xrefs") {
      const references = await this.#references.incoming(
        installation,
        address,
        options.signal,
      );
      if (!references.ok) return references;
      return ok({
        result: [...references.value.addresses],
        source: null,
        locations,
        limitations: [],
        referenceSource: {
          kind: "kuna-xrefs",
          direction: "to",
          target: address,
          sha256: references.value.sha256,
          bytes: references.value.bytes,
          examined_rows: references.value.rows,
          excluded_alias_rows: references.value.excludedAliasRows,
        },
      });
    }
    const relationships = await this.#references.relationships(
      installation,
      address,
      operation,
      options.signal,
    );
    if (!relationships.ok) return relationships;
    const entries =
      operation === "procedure_callers"
        ? relationships.value.callers
        : relationships.value.callees;
    return ok({
      result: entries.map(({ address }) => address),
      source: null,
      locations,
      referenceSource: relationships.value.source,
      limitations: [],
      relationshipCoverage:
        operation === "procedure_callers"
          ? relationships.value.callersCoverage
          : relationships.value.calleesCoverage,
    });
  }

  /** Exact addresses are validated by the producing graph, which also owns
   * synthetic import nodes absent from the quick function inventory. */
  async #referenceAddress(
    operation: string,
    raw: unknown,
    field: "address" | "procedure",
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<string, AnalysisError>> {
    if (typeof raw !== "string" || raw.length === 0)
      return err(
        new AnalysisInputError(
          operation,
          { userMessage: `Kuna requires ${field}; it has no cursor.` },
          [{ path: [field], reason: "missing_argument" }],
        ),
      );
    const address = normalizeKunaAddress(raw);
    if (address !== undefined) return ok(address);
    if (/^0x[0-9a-f]+$/iu.test(raw))
      return err(
        new AnalysisInputError(
          operation,
          { userMessage: "The address exceeds Kuna's u64 address space." },
          [{ path: [field], reason: "invalid_value" }],
        ),
      );
    const inventory = await this.#ensureInventory(installation, options);
    if (!inventory.ok) return inventory;
    const entry = this.#resolve(operation, raw, inventory.value, field);
    return entry.ok ? ok(entry.value.address) : entry;
  }

  /** Resolve an exact inventory name, alias or entry address. */
  #resolve(
    operation: string,
    raw: unknown,
    inventory: readonly KunaInventoryFunction[],
    field: "procedure" | "address" = "procedure",
  ): Result<KunaInventoryFunction, AnalysisError> {
    const parsed = procedureSelectorSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        new AnalysisInputError(
          operation,
          { userMessage: `${field} is required.` },
          [{ path: [field], reason: "missing_argument" }],
        ),
      );
    const selector = parsed.data;
    const address = normalizeKunaAddress(selector);
    if (address !== undefined) {
      const entry = this.#index(inventory).byAddress.get(address);
      return entry === undefined
        ? err(
            new AnalysisInputError(operation, {
              userMessage: `${address} is not a procedure entry Kuna found; list_procedures shows the entries it found.`,
            }),
          )
        : ok(entry);
    }
    const matches = this.#index(inventory).byName.get(selector) ?? [];
    if (matches.length === 1 && matches[0] !== undefined) return ok(matches[0]);
    return err(
      new AnalysisInputError(operation, {
        userMessage:
          matches.length === 0
            ? `Kuna found no procedure named ${selector}; search_procedures finds similar names.`
            : `${selector} names ${String(matches.length)} Kuna entries (${matches.map(({ address }) => address).join(", ")}); select one by address.`,
      }),
    );
  }

  async #addressName(
    parameters: Readonly<Record<string, JsonValue>>,
    inventory: readonly KunaInventoryFunction[],
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Answer, AnalysisError>> {
    const raw = parameters.address;
    const address = normalizeKunaAddress(raw);
    if (address === undefined)
      return err(
        new AnalysisInputError(
          "address_name",
          {
            userMessage:
              "Kuna has no cursor; pass an explicit 0x-prefixed address.",
          },
          [{ path: ["address"], reason: "invalid_format" }],
        ),
      );
    const locations = [{ kind: "address", address } as const];
    const entry = this.#index(inventory).byAddress.get(address);
    if (entry !== undefined)
      return ok({
        result: entry.name,
        source: null,
        locations,
        limitations: [],
      });
    await this.#startProject(installation);
    return this.#withProject(
      "address_name",
      installation,
      options,
      async (reader) => {
        const name = await reader.dataName(
          address,
          "address_name",
          options.signal,
        );
        if (!name.ok) return name;
        return ok({
          result: name.value,
          source: { kind: "project-export", project: reader.project },
          locations,
          limitations: [
            "Kuna names function entries and the data its export references; null means Kuna assigned no name at this address, not that no symbol exists.",
          ],
        });
      },
    );
  }

  async #pseudocode(
    operation: string,
    entry: KunaInventoryFunction,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Omit<Answer, "locations">, AnalysisError>> {
    for (let recovered = false; ;) {
      const reader = this.#reader;
      if (reader !== undefined) {
        try {
          const text = await reader.pseudocode(
            entry.address,
            operation,
            options.signal,
          );
          if (!text.ok) return text;
          return ok({
            ...text.value,
            source: { kind: "project-export", project: reader.project },
          });
        } catch (cause: unknown) {
          if (!isUnavailableProject(cause) || recovered) throw cause;
          recovered = true;
          this.#invalidateProject(reader);
          await this.#startProject(installation);
          continue;
        }
      }
      const outcome = await this.#joinSingleFunction(
        operation,
        entry.address,
        installation,
        options.signal,
      );
      if (outcome === EXPORT_READY) continue;
      if (!outcome.ok) return outcome;
      const exportFailure = await this.#settledExportFailure();
      return ok({
        result: outcome.value,
        source: { kind: "single-function" },
        limitations: [
          KUNA_SINGLE_FUNCTION_LIMITATION,
          ...(exportFailure === undefined
            ? []
            : [
                `The project export failed, so later requests also use single-function runs: ${exportFailure}`,
              ]),
        ],
      });
    }
  }

  /**
   * Wait for this address's shared single-function run, starting it when none
   * is in flight. A caller's cancellation stops only its own wait while others
   * still wait; the last waiter stops the run and receives how it ended,
   * including cleanup it could not prove. A completed text answers repeats
   * until the export can.
   */
  #joinSingleFunction(
    operation: string,
    address: string,
    installation: KunaInstallation,
    signal: AbortSignal | undefined,
  ): Promise<SingleFunctionOutcome> {
    if (cancelled(signal))
      return Promise.resolve(
        err(new AnalysisCancelledError(operation, { cause: signal?.reason })),
      );
    const kept = this.#singleFunctionTexts.get(address);
    if (kept !== undefined) {
      this.#singleFunctionTexts.delete(address);
      this.#singleFunctionTexts.set(address, kept);
      return Promise.resolve(ok(kept.text));
    }
    let run = this.#singleFunctionRuns.get(address);
    if (run === undefined) {
      const controller = new AbortController();
      const created: SingleFunctionRun = {
        controller,
        waiters: 0,
        outcome: this.#own(
          this.#singleFunction(
            operation,
            address,
            installation,
            AbortSignal.any([this.#session.signal, controller.signal]),
          ).catch((cause: unknown) => err(failure(operation, cause))),
        ),
      };
      this.#singleFunctionRuns.set(address, created);
      void created.outcome.then((outcome) => {
        // A run whose waiters all left was already replaced or removed.
        if (this.#singleFunctionRuns.get(address) !== created) return;
        this.#singleFunctionRuns.delete(address);
        if (outcome !== EXPORT_READY && outcome.ok)
          this.#keepSingleFunctionText(address, outcome.value);
      });
      run = created;
    }
    const shared = run;
    shared.waiters += 1;
    return new Promise((resolve) => {
      let waiting = true;
      const leave = () => {
        waiting = false;
        shared.waiters -= 1;
      };
      const onAbort = () => {
        if (!waiting) return;
        leave();
        if (shared.waiters > 0) {
          resolve(
            err(
              new AnalysisCancelledError(operation, { cause: signal?.reason }),
            ),
          );
          return;
        }
        // A run whose waiters all left winds down; a new request starts afresh.
        if (this.#singleFunctionRuns.get(address) === shared)
          this.#singleFunctionRuns.delete(address);
        shared.controller.abort(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void shared.outcome.then((outcome) => {
        signal?.removeEventListener("abort", onAbort);
        if (waiting) leave();
        resolve(outcome);
      });
    });
  }

  /** Keep a completed text within budget, dropping the least recently used. */
  #keepSingleFunctionText(address: string, text: string): void {
    // The export's text supersedes it; a closing session keeps nothing.
    if (this.#reader !== undefined || this.#closing) return;
    const bytes = Buffer.byteLength(text) + SINGLE_FUNCTION_TEXT_ENTRY_BYTES;
    if (bytes > SINGLE_FUNCTION_TEXT_CACHE_BYTES) return;
    this.#singleFunctionTexts.set(address, { text, bytes });
    this.#singleFunctionTextBytes += bytes;
    while (this.#singleFunctionTextBytes > SINGLE_FUNCTION_TEXT_CACHE_BYTES) {
      const oldest = this.#singleFunctionTexts.entries().next().value;
      if (oldest === undefined) break;
      this.#singleFunctionTexts.delete(oldest[0]);
      this.#singleFunctionTextBytes -= oldest[1].bytes;
    }
  }

  #dropSingleFunctionTexts(): void {
    this.#singleFunctionTexts.clear();
    this.#singleFunctionTextBytes = 0;
  }

  /** One `kuna decompile --addr` run, admitted by the provider's run slots. */
  async #singleFunction(
    operation: string,
    address: string,
    installation: KunaInstallation,
    signal: AbortSignal,
  ): Promise<SingleFunctionOutcome> {
    const prepared = await this.#commands.prepare();
    if (!prepared.ok) return prepared;
    const admitted = await this.#admitSingleFunction(signal);
    if (admitted === EXPORT_READY) return admitted;
    if (admitted === undefined)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    const run = await this.#commands.run({
      installation,
      arguments: (input) => ["decompile", input, address, "--addr"],
      operation,
      deadline: kunaFunctionDeadline(installation.configuration),
      outputBytes: KUNA_FUNCTION_TEXT_BYTES,
      signal,
      releaseRun: admitted,
    });
    return run.ok ? ok(run.value.stdout.text.replace(/\n+$/u, "")) : run;
  }

  /**
   * A run slot, or EXPORT_READY when the export this session builds finishes
   * first; the export then answers without another Kuna process.
   */
  async #admitSingleFunction(
    signal: AbortSignal,
  ): Promise<KunaRunRelease | undefined | typeof EXPORT_READY> {
    const yielded = new AbortController();
    const slot = this.#runSlots.acquire(
      AbortSignal.any([signal, yielded.signal]),
    );
    const project = this.#project;
    const exported =
      project === undefined
        ? undefined
        : project.then((built) =>
            (built.ok ||
              built.error instanceof KunaPublishedProjectCleanupError) &&
            this.#reader !== undefined
              ? EXPORT_READY
              : new Promise<never>(() => undefined),
          );
    const admitted = await (exported === undefined
      ? slot
      : Promise.race([slot, exported]));
    if (admitted !== EXPORT_READY) return admitted;
    yielded.abort();
    // A slot granted in the same turn is returned rather than leaked.
    void slot.then((release) => release?.());
    return EXPORT_READY;
  }

  async #assemblyText(
    operation: string,
    entry: KunaInventoryFunction,
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<Omit<Answer, "locations">, AnalysisError>> {
    return this.#withProject(
      operation,
      installation,
      options,
      async (reader) => {
        const text = await reader.assembly(
          entry.address,
          operation,
          options.signal,
        );
        return text.ok
          ? ok({
              ...text.value,
              source: { kind: "project-export", project: reader.project },
            })
          : text;
      },
    );
  }

  async #dossier(
    operation: string,
    entry: KunaInventoryFunction,
    reader: KunaProjectReader,
    installation: KunaInstallation,
    signal: AbortSignal | undefined,
  ): Promise<Result<Answer, AnalysisError>> {
    const assembly = await reader.assembly(entry.address, operation, signal);
    if (!assembly.ok) return assembly;
    const pseudocode = await reader.pseudocode(
      entry.address,
      operation,
      signal,
    );
    if (!pseudocode.ok) return pseudocode;
    const text =
      typeof pseudocode.value.result === "string"
        ? pseudocode.value.result
        : null;
    const unavailable = (reason: string) =>
      ({ available: false, reason }) as const;
    const relationships = await this.#references.relationships(
      installation,
      entry.address,
      operation,
      signal,
    );
    if (
      !relationships.ok &&
      (relationships.error.cleanupIncomplete || signal?.aborted === true)
    )
      return relationships;
    const callAvailability = relationships.ok
      ? { available: true as const }
      : unavailable(
          relationships.error.userMessage ?? relationships.error.message,
        );
    const dossier = functionDossierSchema.parse({
      procedure: {
        address: entry.address,
        name: entry.name,
        classification: null,
        body: unavailable(
          "Kuna reports an inventory extent that is an upper bound, not observed body ranges.",
        ),
        signature: null,
        locals: [],
      },
      pseudocode: text ?? "",
      assembly:
        typeof assembly.value.result === "string"
          ? assembly.value.result.split("\n")
          : [],
      comments: [],
      callers: relationships.ok ? relationships.value.callers : [],
      callees: relationships.ok ? relationships.value.callees : [],
      incoming_references: [],
      outgoing_references: [],
      referenced_strings: [],
      referenced_names: [],
      basic_blocks: [],
      native_api: null,
      native_value_flow: null,
      facet_availability: {
        pseudocode:
          text === null
            ? unavailable(
                pseudocode.value.limitations.at(-1) ??
                  "Kuna did not supply pseudocode.",
              )
            : { available: true },
        assembly: { available: true },
        comments: unavailable("Kuna exports no analyst comments."),
        callers: callAvailability,
        callees: callAvailability,
        references: unavailable(
          "This provider does not report typed references.",
        ),
        strings_names: unavailable(
          "This provider does not report function-referenced strings and names.",
        ),
        cfg: unavailable("Kuna exports no basic blocks."),
      },
      limitations: [
        ...kunaLimitations(
          "analyze_function",
          this.#deadline,
          this.#heapRequest,
        ),
        ...pseudocode.value.limitations,
        KUNA_RELATIONSHIP_LIMITATION,
        ...(relationships.ok
          ? []
          : [relationships.error.userMessage ?? relationships.error.message]),
      ],
    });
    return ok({
      result: dossier,
      source: { kind: "project-export", project: reader.project },
      files: [
        ...(pseudocode.value.files ?? []),
        ...(assembly.value.files ?? []),
      ],
      locations: [{ kind: "address", address: entry.address }],
      limitations: [
        ...pseudocode.value.limitations,
        KUNA_RELATIONSHIP_LIMITATION,
        ...(relationships.ok
          ? []
          : [relationships.error.userMessage ?? relationships.error.message]),
      ],
      referenceSource: relationships.ok
        ? relationships.value.source
        : {
            available: false,
            reason:
              relationships.error.userMessage ?? relationships.error.message,
          },
      relationshipCoverage: relationships.ok
        ? combineFunctionRelationshipCoverage(
            relationships.value.callersCoverage,
            relationships.value.calleesCoverage,
          )
        : {
            status: "unknown",
            reason:
              relationships.error.userMessage ?? relationships.error.message,
            limited_directions: ["callers", "callees"],
          },
    });
  }

  /** Address and name lookups over one inventory, built once. */
  #index(inventory: readonly KunaInventoryFunction[]): InventoryIndex {
    if (this.#inventoryIndex?.inventory === inventory)
      return this.#inventoryIndex;
    const byAddress = new Map<string, KunaInventoryFunction>();
    const byName = new Map<string, KunaInventoryFunction[]>();
    for (const entry of inventory) {
      byAddress.set(entry.address, entry);
      for (const name of new Set([entry.name, ...entry.aliases])) {
        const named = byName.get(name);
        if (named === undefined) byName.set(name, [entry]);
        else named.push(entry);
      }
    }
    this.#inventoryIndex = { inventory, byAddress, byName };
    return this.#inventoryIndex;
  }

  /** One installation producer; only the final departing caller stops it. */
  async #ensureInstallation(
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaInstallation, AnalysisError>> {
    let attempt = this.#installation;
    if (attempt === undefined) {
      attempt = new SharedStartupAttempt(
        (ownerSignal) => this.#own(this.#inspectInstallation(ownerSignal)),
        this.#session.signal,
      );
      const owned = attempt;
      this.#installation = owned;
      void owned.promise.then((result) => {
        // A proven cancellation has no reusable installation result. Its
        // complete cleanup precedes replacement; physical failures stay cached.
        if (
          this.#installation === owned &&
          owned.signal.aborted &&
          (result.ok ||
            (result.error instanceof AnalysisCancelledError &&
              !result.error.cleanupIncomplete))
        )
          this.#installation = undefined;
      });
    }
    const waited = await attempt.wait(signal);
    if (waited.status === "cancelled")
      return err(
        new AnalysisCancelledError(operation, { cause: signal?.reason }),
      );
    if (!waited.value.ok) {
      // A fresh caller can arrive while the previous final waiter joins stop.
      // Retry only proven cancellation, never an authored physical failure.
      if (
        !signal?.aborted &&
        attempt.signal.aborted &&
        waited.value.error instanceof AnalysisCancelledError &&
        !waited.value.error.cleanupIncomplete
      )
        return this.#ensureInstallation(operation, signal);
      return err(kunaQueryFailureForCaller(waited.value.error, operation));
    }
    if (signal?.aborted)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    return waited.value;
  }

  async #inspectInstallation(
    signal: AbortSignal,
  ): Promise<Result<KunaInstallation, AnalysisError>> {
    const parentResourceScope: RetainedResourceScope = {
      retain: (owner, resource) =>
        this.#resourceScope.retain({
          kind: "lease",
          resource,
          lease: AnalysisCleanupLease.forCloseOwner(owner, resource),
        }),
      run: <T>(operation: () => Promise<T>) =>
        this.#resourceScope.run(operation),
    };
    const kunaResources = createKunaResourceScope(parentResourceScope);
    try {
      const inspected = await inspectKunaInstallation(this.#environment, {
        resourceScope: kunaResources.owner,
        signal,
        ...(this.#launcher === undefined
          ? {}
          : { processLauncher: this.#launcher }),
      });
      if (!inspected.ok) {
        const error = kunaUnavailable("health", inspected.error.reason, {
          diagnostics: inspected.error.diagnostics,
          ...(!kunaResources.hasPending
            ? {}
            : {
                cleanup: {
                  reason: "Kuna version-probe process cleanup is unconfirmed.",
                  resources: kunaResources.cleanupResources ?? [],
                },
              }),
        });
        kunaResources.bindRetainedFailure(error);
        return err(error);
      }
      const committed = this.#profile?.parameters["kuna_sha256"];
      const committedCommand = this.#profile?.parameters["kuna_command"];
      const committedExecutable = this.#profile?.parameters["kuna_executable"];
      const identityChanged = [
        [committed, inspected.value.sha256],
        [committedCommand, inspected.value.configuration.command],
        [committedExecutable, inspected.value.executable],
      ].some(
        ([expected, observed]) =>
          expected !== undefined && expected !== observed,
      );
      if (identityChanged)
        return err(
          new ProviderAdapterError(KUNA_PROVIDER_ID, "health", {
            userMessage:
              "The Kuna executable changed after this target was opened; reopen the target to analyze it with the current executable.",
            diagnostics: {
              ...(committed === undefined
                ? {}
                : { committed_sha256: committed }),
              observed_sha256: inspected.value.sha256,
              ...(committedCommand === undefined
                ? {}
                : { committed_command: committedCommand }),
              observed_command: inspected.value.configuration.command,
              ...(committedExecutable === undefined
                ? {}
                : { committed_executable: committedExecutable }),
              observed_executable: inspected.value.executable,
            },
          }),
        );
      return ok(inspected.value);
    } catch (cause: unknown) {
      const retainedCleanup = kunaRetainedResourceCleanupError(cause, "health");
      if (retainedCleanup !== undefined) return err(retainedCleanup);
      if (!(cause instanceof RegularFileCleanupFailure)) {
        const cancellation = kunaResources.installationCancellationError(
          cause,
          "health",
        );
        if (cancellation !== undefined) return err(cancellation);
      }
      if (!(cause instanceof RegularFileCleanupFailure))
        return err(failure("health", cause));
      const error = kunaFileCleanupError(cause, "health");
      kunaResources.bindFailure(cause, error);
      return err(error);
    }
  }

  /** Reuse a verified export, or start building one in the background. */
  #startProject(installation: KunaInstallation): Promise<void> {
    if (this.#project !== undefined) return Promise.resolve();
    // Concurrent first requests share one lookup, which verifies every
    // export file's digest on a fresh server.
    this.#starting ??= this.#lookupOrBuild(installation).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #lookupOrBuild(installation: KunaInstallation): Promise<void> {
    const key = kunaProjectKey({
      targetSha256: this.#target.sha256,
      targetBasename: basename(this.#target.path),
      kunaSha256: installation.sha256,
      kunaCommand: installation.configuration.command,
      kunaExecutable: installation.executable,
      kunaVersion: installation.version,
      jobs: installation.configuration.jobs,
    });
    this.#key = key;
    const cached = await this.#cache.lookup(key, this.#session.signal);
    if (cached !== undefined) {
      this.#adopt(cached);
      this.#project = Promise.resolve(ok(cached));
      return;
    }
    let listed!: (
      inventory: readonly KunaInventoryFunction[] | undefined,
    ) => void;
    this.#exportInventory = new Promise((resolve) => {
      listed = resolve;
    });
    this.#project = this.#cache
      .build({
        installation,
        targetPath: this.#target.path,
        targetSha256: this.#target.sha256,
        signal: this.#session.signal,
        onStatus: (status) => {
          this.#status = status;
          if (status.inventory !== null) listed(status.inventory);
        },
      })
      .then((result) => {
        const published = result.ok
          ? result.value
          : result.error instanceof KunaPublishedProjectCleanupError
            ? result.error.project
            : undefined;
        listed(published?.inventory);
        if (published !== undefined && !this.#closing) {
          this.#adopt(published);
          if (
            !result.ok &&
            result.error instanceof KunaPublishedProjectCleanupError
          )
            this.#publicationCleanup = result.error;
        } else if (!result.ok && !this.#closing)
          this.#exportFailure =
            result.error.userMessage ?? result.error.message;
        return result;
      });
  }

  /** Retry the complete read when its immutable project disappears, never just one facet. */
  async #withProject<T>(
    operation: string,
    installation: KunaInstallation,
    options: ExecutionOptions,
    read: (reader: KunaProjectReader) => Promise<Result<T, AnalysisError>>,
  ): Promise<Result<T, AnalysisError>> {
    for (let attempt = 0; ; attempt += 1) {
      const reader = await this.#awaitProject(operation, options);
      if (!reader.ok) return reader;
      try {
        return await read(reader.value);
      } catch (cause: unknown) {
        if (!isUnavailableProject(cause) || attempt !== 0) throw cause;
        this.#invalidateProject(reader.value);
        await this.#startProject(installation);
      }
    }
  }

  #invalidateProject(reader: KunaProjectReader): void {
    // Another request may already have replaced this reader and its build.
    if (this.#reader !== reader) return;
    this.#releasePin?.();
    this.#releasePin = undefined;
    this.#reader = undefined;
    this.#project = undefined;
    this.#status = undefined;
    this.#exportFailure = undefined;
  }

  #adopt(project: KunaProject): void {
    this.#reader = this.#readerFor(project);
    this.#dropSingleFunctionTexts();
    this.#releasePin ??= this.#cache.pin(project.key);
  }

  #readerFor(project: KunaProject): KunaProjectReader {
    return this.#reader?.project === project
      ? this.#reader
      : new KunaProjectReader(project, {
          signal: this.#session.signal,
          own: (work) => this.#own(work),
          retainFailedClose: (path, owner) => {
            const lease = AnalysisCleanupLease.forCloseOwner(owner, path);
            const scopeOwner: ArtifactResourceOwner = {
              kind: "lease",
              resource: path,
              lease,
            };
            this.#spanLeases.set(owner, { lease, scopeOwner });
            this.#resourceScope.retain(scopeOwner);
          },
          bindSpanCleanup: (owner, marker) => {
            this.#spanLeases.get(owner)?.lease.bindCleanupError(marker);
          },
          admitSpan: (operation, signal, open) =>
            this.#admitSpan(operation, signal, open),
          finishSpan: (finish) => this.#finishSpan(finish),
        });
  }

  #enqueueSpan<T>(work: () => Promise<T>): Promise<T> {
    const admitted = this.#spanAdmission.then(work, work);
    this.#spanAdmission = admitted.then(
      () => undefined,
      () => undefined,
    );
    return admitted;
  }

  /**
   * Recheck retained closes and the caller signal immediately before open.
   * Finalization uses the same queue, so this cannot pass between a rejected
   * close and the lease that records it.
   */
  #admitSpan<T>(
    operation: string,
    signal: AbortSignal | undefined,
    open: () => Promise<T>,
  ): Promise<Result<T, AnalysisError>> {
    const callerAborted = (): AbortSignal | undefined =>
      signal?.aborted === true ? signal : undefined;
    return this.#enqueueSpan(async () => {
      const cancelledBefore = callerAborted();
      if (cancelledBefore !== undefined)
        return err(
          new AnalysisCancelledError(operation, {
            cause: cancelledBefore.reason,
          }),
        );
      const pending = await this.#pendingDescriptorCleanup(operation);
      if (pending !== undefined) return err(pending);
      const cancelledAfter = callerAborted();
      if (cancelledAfter !== undefined)
        return err(
          new AnalysisCancelledError(operation, {
            cause: cancelledAfter.reason,
          }),
        );
      return ok(await open());
    });
  }

  /** Release or retain this descriptor before the next span is admitted. */
  #finishSpan<T>(finish: () => Promise<T>): Promise<T> {
    return this.#enqueueSpan(finish);
  }

  /**
   * Retry span descriptors before another read. Installation cleanup stays on
   * the shared scope and is not re-adjudicated here.
   */
  async #pendingDescriptorCleanup(
    operation: string,
  ): Promise<AnalysisError | undefined> {
    const pending = [...this.#spanLeases.entries()].filter(
      ([, retained]) => !retained.lease.released,
    );
    if (pending.length === 0) return undefined;
    const failures: {
      readonly lease: AnalysisCleanupLease;
      readonly cause: unknown;
      readonly path: string;
    }[] = [];
    for (const [owner, retained] of pending) {
      const attempt = await this.#resourceScope.release(retained.scopeOwner);
      if (attempt.kind === "failed") {
        failures.push({
          lease: retained.lease,
          cause: attempt.cause,
          path:
            retained.lease.cleanupResources?.[0] ??
            retained.scopeOwner.resource,
        });
        continue;
      }
      this.#spanLeases.delete(owner);
    }
    if (failures.length === 0) return undefined;
    const error = new ProviderCleanupError(
      KUNA_PROVIDER_ID,
      failures.map(({ path }) => path),
      {
        reason: failures
          .map(({ cause }) =>
            cause instanceof Error ? cause.message : String(cause),
          )
          .join("; "),
      },
      {
        operation,
        cause: new AggregateError(
          failures.map(({ cause }) => cause),
          "Kuna span descriptor cleanup remains incomplete",
        ),
      },
    );
    new AnalysisCleanupLeaseGroup(
      error,
      failures.map(({ lease }) => lease),
    );
    return error;
  }

  /** The export's failure once it has settled; undefined while it builds or after success. */
  async #settledExportFailure(): Promise<string | undefined> {
    const settled = await Promise.race([
      this.#project,
      Promise.resolve(undefined),
    ]);
    if (
      settled === undefined ||
      settled.ok ||
      settled.error instanceof KunaPublishedProjectCleanupError
    )
      return undefined;
    return settled.error.userMessage ?? settled.error.message;
  }

  /** Wait for the export, reporting progress, without cancelling it for other callers. */
  async #awaitProject(
    operation: string,
    options: ExecutionOptions,
  ): Promise<Result<KunaProjectReader, AnalysisError>> {
    if (this.#reader !== undefined) return ok(this.#reader);
    const project = this.#project;
    if (project === undefined)
      return err(
        new ProviderAdapterError(KUNA_PROVIDER_ID, operation, {
          userMessage: "The Kuna project export was never started.",
        }),
      );
    const started = Date.now();
    const progress = options.progress;
    // Report waiting only; Kuna exposes no measure of completed export work.
    const timer = setInterval(() => {
      void progress
        ?.report({
          phase: "kuna_export",
          completed: 0,
          total: null,
          message: `Waiting for Kuna's project export (${this.#status?.phase ?? "starting"}, ${String(Math.floor((Date.now() - started) / 1000))}s elapsed); it serves this request and every later one`,
        })
        .catch(() => undefined);
    }, WAIT_PROGRESS_INTERVAL_MS);
    try {
      const built = await waitFor(project, options.signal, operation);
      if (!built.ok) return err(exportUnavailable(operation, built.error));
      return ok(this.#readerFor(built.value));
    } finally {
      clearInterval(timer);
    }
  }

  /** The published or building export's inventory, otherwise one `kuna functions` run. */
  async #ensureInventory(
    installation: KunaInstallation,
    options: ExecutionOptions,
  ): Promise<Result<readonly KunaInventoryFunction[], AnalysisError>> {
    if (this.#reader !== undefined) return ok(this.#reader.project.inventory);
    const exported = this.#status?.inventory;
    if (exported !== undefined && exported !== null) return ok(exported);
    if (this.#inventory === undefined) {
      // The session owns the shared run; each caller only stops waiting.
      const run = this.#listInventory(installation);
      this.#inventory = run;
      void run.then((listed) => {
        // A failed listing is retried by the next request.
        if (!listed.ok && this.#inventory === run) this.#inventory = undefined;
      });
    }
    return waitFor(this.#inventory, options.signal, "list_procedures");
  }

  /**
   * The export lists every callable entry before it decompiles, so listings
   * wait for that inventory. Only an export that ends without one, or none at
   * all, leads to a separate `kuna functions` run.
   */
  async #listInventory(
    installation: KunaInstallation,
  ): Promise<Result<readonly KunaInventoryFunction[], AnalysisError>> {
    // A concurrent text request may still be choosing between the cache and a
    // build; its outcome decides whether an inventory already exists.
    await this.#starting?.catch(() => undefined);
    if (this.#reader !== undefined) return ok(this.#reader.project.inventory);
    const exported = await this.#exportInventory;
    if (exported !== undefined) return ok(exported);
    const run = await this.#commands.run({
      installation,
      arguments: (input) => ["functions", input, "--json"],
      operation: "list_procedures",
      deadline: kunaFunctionDeadline(installation.configuration),
      outputBytes: KUNA_INVENTORY_OUTPUT_BYTES,
      signal: this.#session.signal,
    });
    if (!run.ok) return run;
    const inventory = parseKunaInventory(run.value.stdout.text);
    return inventory.ok
      ? ok(inventory.value)
      : err(
          new ProviderAdapterError(KUNA_PROVIDER_ID, "list_procedures", {
            userMessage: `Kuna's function inventory is not usable: ${inventory.error}`,
          }),
        );
  }
}
