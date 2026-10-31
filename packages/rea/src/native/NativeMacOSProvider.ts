import { withArtifactTargetIdentity } from "../artifacts/withArtifactTargetIdentity.js";
import { translateNativeCommandFailure } from "./NativeCommandAnalysisError.js";
import {
  plistSourceFormat,
  isBinaryPlistDescription,
  readNativePlistBytes,
  requireRegularPlist,
  nativePlistFailure,
  resolveNativePlistSelection,
  unreadablePlist,
  type NativePlistSelection,
  resolveBundleResourcePlistSelection,
} from "./NativePlistSource.js";
import {
  bindArtifactFileCleanup,
  artifactFileCompletion,
  artifactFilePrimaryFacts,
  artifactFileCancellationCause,
  ArtifactFileCleanupFailure,
  type ArtifactFilePrimaryFacts,
} from "../artifacts/ArtifactFileOperation.js";
import { readMachoEncryption } from "../artifacts/apple/MachoEncryptionReader.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
  NATIVE_MACOS_PROVIDER_IDENTITY as IDENTITY,
  nativeMacOSCapabilities,
} from "./NativeMacOSProviderMetadata.js";
import {
  appleDispatchMetadataFailure,
  inspectAppleDispatchMetadata,
} from "./AppleDispatchMetadata.js";
import {
  observeNativeUi,
  finishNativeUiObservation,
} from "./NativeUiObservation.js";
import { NativeUiCleanupError } from "./NativeUiCleanupError.js";
import { LldbCallTracer, type NativeCallTracer } from "./LldbCallTracer.js";
import { observeNativeCalls } from "./NativeCallObservation.js";
import { realpath, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { AnalysisCleanupLeaseGroup } from "../artifacts/AnalysisCleanupLease.js";
import { createAnalysisExecutionEvidence } from "../domain/analysisObservation.js";

import { z } from "zod";

import {
  createAnalysisExecution,
  type AnalysisClient,
  type AnalysisOperation,
  type AnalysisProvider,
  type CapabilityDescriptor,
  type ProviderIdentity,
} from "../application/AnalysisProvider.js";
import {
  NATIVE_TOOL_CONTRACTS,
  type NativeToolName,
} from "../contracts/native/nativeToolContracts.js";
import {
  isMachOFormat,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  isAppleDispatchMetadataTarget,
  nativeDispatchMetadataInputSchema,
} from "../domain/native/objcSwiftMetadata.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import type { EvidenceLocation } from "../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisUnsupportedTargetError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import {
  DEFAULT_NATIVE_COMMAND_TIMEOUT_MS,
  DEFAULT_NATIVE_UI_DEADLINE_MS,
  MAX_NATIVE_TIMER_MS,
  readNativeDeadline,
} from "../domain/native/nativeDeadlines.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  AnalysisError,
  resolvedAnalysisError,
} from "../domain/analysisErrorBase.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  projectPlistValue,
  nonFiniteRealLimitation,
  negativeZeroRealLimitation,
  unknownDateLimitation,
  unknownScalarLimitation,
} from "../domain/apple/plistValue.js";
import { createPlistNumberProjection } from "../domain/apple/plistNumbers.js";
import type { NativeUiObservationResult } from "../domain/native/nativeUiObservation.js";
import { parseXmlPropertyList } from "../domain/propertyListKeys.js";
import { machoKnownCodeSignSelector } from "./MachoArchitectureSelection.js";
import {
  demangleSwiftSchema,
  inspectPlistSchema,
  inspectMachoSchema,
  inspectSignatureSchema,
  type InspectSignature,
  listArchitecturesSchema,
  type NativeCommandInvocation,
} from "../domain/native/nativeInspection.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  NativeCommandFailure,
  NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
  XcrunCommandRunner,
  failureCapture,
  type NativeCommandCleanupFailure,
  type NativeCommandCapture,
  type NativeCommandRunner,
} from "./CommandRunner.js";
import {
  withSignatureTarget,
  verifySignatureTarget,
  type SignatureTargetBinding,
} from "./SignatureTargetBinding.js";
import { parseCodeSignature } from "./parsers/codesign.js";
import { parseDemangledSymbols } from "./parsers/demangle.js";
import { parseLipoCapture } from "./parsers/lipo.js";
import {
  readPlistJson,
  readPlistJsonSource,
  parsePlistBinary,
  parsePlistXml,
  parsePlistXmlSource,
  type ParsedPlist,
} from "./parsers/plist.js";
import { XmlPlistTextDecodeError } from "../domain/propertyListXmlText.js";
import {
  architectureLocations,
  inspectNativeMacho,
} from "./NativeMachoInspection.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  withNativeMachoSource,
  NativeMachoSourceVerificationFailure,
} from "./NativeMachoSource.js";
import {
  MachoBinaryFormatError,
  MachoCommandNamesLimitError,
  readMachoCommandNames,
} from "./MachoCommandNames.js";
import {
  assertSelectedMachoSlice,
  resolveSelectedMachoSlice,
} from "./NativeMachoSelectedSlice.js";
import {
  createNativeUiHelperRuntime,
  type NativeUiHelperRuntime,
} from "./NativeUiHelperRuntime.js";
import { NativeUiInterruptionControl } from "./NativeUiInterruptionControl.js";
import type { ResolvedAppBundleResourceRoot } from "../application/AppBundleExecutable.js";
import { UnsupportedBinaryPlistUidError } from "../artifacts/apple/PlistScalars.js";

type SignatureRuntimeRootFactory = () => Promise<
  Pick<PrivateRuntimeRoot, "path" | "close">
>;

interface NativePlistReadContext {
  readonly selection: NativePlistSelection;
  readonly resources: ArtifactResourceScope;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
}

/** Read-only semantic provider composed from Xcode command-line utilities. */
export class NativeMacOSProvider implements AnalysisProvider {
  readonly #capabilities: readonly CapabilityDescriptor[];
  readonly #environment: NodeJS.ProcessEnv;
  readonly #tracerFactory: () => NativeCallTracer;
  readonly #privateRuntimeRootFactory: SignatureRuntimeRootFactory | undefined;

  constructor(
    environment: Readonly<NodeJS.ProcessEnv>,
    private readonly runner: NativeCommandRunner = new XcrunCommandRunner(
      environment,
    ),
    platform: NodeJS.Platform = process.platform,
    tracerFactory?: () => NativeCallTracer,
    privateRuntimeRootFactory?: SignatureRuntimeRootFactory,
  ) {
    this.#environment = snapshotEnvironment(environment, platform);
    this.#tracerFactory =
      tracerFactory ?? (() => new LldbCallTracer(this.#environment));
    this.#privateRuntimeRootFactory = privateRuntimeRootFactory;
    this.#capabilities = nativeMacOSCapabilities(platform);
  }

  identity(): ProviderIdentity {
    return IDENTITY;
  }

  capabilities(): readonly CapabilityDescriptor[] {
    return this.#capabilities;
  }

  createClient(target: BinaryTarget): AnalysisClient {
    return new NativeMacOSClient(
      target,
      this.runner,
      this.#tracerFactory(),
      this.#environment,
      this.#privateRuntimeRootFactory,
    );
  }

  createBundleResourceClient(
    root: ResolvedAppBundleResourceRoot,
  ): AnalysisClient {
    const plistAvailable = this.#capabilities.some(
      ({ operation, available }) => operation === "inspect_plist" && available,
    );
    return new NativeMacOSClient(
      undefined,
      this.runner,
      this.#tracerFactory(),
      this.#environment,
      this.#privateRuntimeRootFactory,
      root,
      plistAvailable,
    );
  }
}

// Encryption range mapping in every slice shares a sixteenth of the output
// budget at the 256 projected bytes reserved per Mach-O command record.
const MACHO_ENCRYPTION_MAPPING_RECORDS = Math.floor(
  NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / 16 / 256,
);

class NativeMacOSClient implements AnalysisClient {
  readonly #pendingNativeUiRuntimes = new Set<NativeUiHelperRuntime>();
  readonly #pendingCommandOperations = new Set<Promise<unknown>>();
  readonly #signatureResources = new ArtifactResourceScope();
  readonly #plistResources = new ArtifactResourceScope();
  readonly #callResources = new ArtifactResourceScope();
  readonly #dispatchResources = new ArtifactResourceScope();
  readonly #machoOperandResources = new ArtifactResourceScope();
  readonly #machoResources = new ArtifactResourceScope();
  #nativeUiTail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    private readonly activeTarget: BinaryTarget | undefined,
    private readonly runner: NativeCommandRunner,
    private readonly tracer: NativeCallTracer,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly privateRuntimeRootFactory:
      | SignatureRuntimeRootFactory
      | undefined,
    private readonly bundleResourceRoot?: ResolvedAppBundleResourceRoot,
    private readonly bundlePlistAvailable = true,
  ) {}

  private get target(): BinaryTarget {
    if (this.activeTarget === undefined)
      throw new Error("This provider client has no executable target");
    return this.activeTarget;
  }

  async execute(
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, JsonValue>>,
    options?: { readonly signal?: AbortSignal },
  ) {
    if (this.#closed)
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          operation,
          "Native provider client is closed",
        ),
      );
    if (options?.signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: options.signal.reason }),
      );
    if (operation === "health")
      return ok(createAnalysisExecution(null, IDENTITY));
    if (this.activeTarget === undefined && operation !== "inspect_plist")
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          operation,
          "This client is bound to app resource access only.",
        ),
      );
    if (this.bundleResourceRoot !== undefined && !this.bundlePlistAvailable)
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_plist",
          "Property list inspection requires a macOS host.",
        ),
      );
    if (operation === "inspect_native_dispatch_metadata") {
      const input = nativeDispatchMetadataInputSchema.safeParse(parameters);
      if (!input.success)
        return err(
          analysisInputErrorFromIssues(
            operation,
            input.error.issues,
            parameters,
            {
              cause: input.error,
            },
          ),
        );
      if (!isAppleDispatchMetadataTarget(this.target))
        return err(
          new AnalysisCapabilityUnavailableError(
            IDENTITY.id,
            operation,
            "Binary Apple metadata requires Mach-O; other providers can report symbol-only metadata",
          ),
        );
      try {
        const result = await this.#dispatchResources.run(() =>
          inspectAppleDispatchMetadata(
            this.target,
            input.data.max_records,
            this.#dispatchResources,
            {
              signal: options?.signal,
              objcClassImportAddresses: input.data.objc_class_import_addresses,
              objcClassImportAddressesComplete:
                input.data.objc_class_import_addresses_complete ?? true,
              maxInputBytes: input.data.max_input_bytes,
            },
          ),
        );
        return ok(
          createAnalysisExecution(result, result.provider, {
            analysisProfile: APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
            locations: [{ kind: "artifact-path", path: this.target.path }],
            limitations: result.result.coverage.flatMap(({ reason }) =>
              reason === null ? [] : [reason],
            ),
          }),
        );
      } catch (cause) {
        return err(appleDispatchMetadataFailure(cause, this.target.path));
      }
    }
    if (!isNativeOperation(operation))
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          operation,
          "Operation is not implemented by native macOS tools.",
        ),
      );
    if (operation === "observe_native_calls") {
      const result = await observeNativeCalls(
        this.target,
        parameters,
        this.tracer,
        this.#callResources,
        options?.signal,
      );
      return result.ok
        ? ok(
            createAnalysisExecution(result.value, IDENTITY, {
              limitations: result.value.limitations,
              locations: [{ kind: "artifact-path", path: this.target.path }],
            }),
          )
        : result;
    }
    if (
      operation === "observe_native_ui" ||
      operation === "capture_native_ui_scenario"
    ) {
      return this.#observeNativeUi(operation, parameters, options?.signal);
    }
    const pending = Promise.resolve().then(() =>
      this.#dispatchCommand(operation, parameters, options?.signal),
    );
    this.#pendingCommandOperations.add(pending);
    try {
      const observation = await pending;
      return observation.ok
        ? ok(
            createAnalysisExecution(observation.value.result, IDENTITY, {
              limitations: observation.value.limitations,
              locations: observation.value.locations,
            }),
          )
        : err(resolvedAnalysisError(observation.error));
    } catch (cause: unknown) {
      return err(nativeOutputFailure(operation, cause));
    } finally {
      this.#pendingCommandOperations.delete(pending);
    }
  }

  async close(): Promise<Result<null, AnalysisError>> {
    this.#closed = true;
    await Promise.allSettled(this.#pendingCommandOperations);
    const uiCleanupFailures = await this.#serializeNativeUi(() =>
      this.#retryNativeUiCleanup(),
    );
    const signatureCleanup = await closeNativeFileScope(
      this.#signatureResources,
      "signature-snapshot",
    );
    const plistCleanup = await closeNativeFileScope(
      this.#plistResources,
      "plist-file",
    );
    const callCleanup = await closeNativeFileScope(
      this.#callResources,
      "native-call-target",
    );
    const dispatchCleanup = await closeNativeFileScope(
      this.#dispatchResources,
      "native-dispatch-metadata-target",
    );
    const machoCleanup = await closeNativeFileScope(
      this.#machoResources,
      "native-macho-target",
    );
    const commandCleanup = await this.#retryNativeCommandCleanup();
    const machoOperandCleanup = await closeNativeFileScope(
      this.#machoOperandResources,
      "macho-operand",
    );
    let result = await this.tracer.close();
    const cleanupErrors = [
      ...(uiCleanupFailures.length === 0
        ? []
        : [this.#nativeUiCleanupFailure(uiCleanupFailures, "close_binary")]),
      ...(commandCleanup === undefined ? [] : [commandCleanup]),
      ...(signatureCleanup === undefined ? [] : [signatureCleanup]),
      ...(plistCleanup === undefined ? [] : [plistCleanup]),
      ...(callCleanup === undefined ? [] : [callCleanup]),
      ...(dispatchCleanup === undefined ? [] : [dispatchCleanup]),
      ...(machoOperandCleanup === undefined ? [] : [machoOperandCleanup]),
      ...(machoCleanup === undefined ? [] : [machoCleanup]),
    ];
    for (const cleanupError of cleanupErrors)
      result = result.ok
        ? err(cleanupError)
        : err(
            analysisErrorWithCleanupFailure(
              result.error,
              cleanupError,
            ).bindCleanupDependencies([result.error, cleanupError]),
          );
    return result;
  }

  #observeNativeUi(
    operation: "observe_native_ui" | "capture_native_ui_scenario",
    parameters: Readonly<Record<string, JsonValue>>,
    signal?: AbortSignal,
  ) {
    return this.#serializeNativeUi(async () => {
      if (this.#closed)
        return err(
          new AnalysisCapabilityUnavailableError(
            IDENTITY.id,
            operation,
            "Native provider client is closed",
          ),
        );
      const earlierCleanupFailures = await this.#retryNativeUiCleanup();
      if (earlierCleanupFailures.length > 0)
        return err(
          this.#nativeUiCleanupFailure(earlierCleanupFailures, operation),
        );
      const deadline = readNativeDeadline(
        parameters.native_ui_deadline_ms,
        DEFAULT_NATIVE_UI_DEADLINE_MS,
      );
      if (!deadline.ok)
        return err(
          new AnalysisInputError(operation, { userMessage: deadline.message }, [
            {
              path: ["native_ui_deadline_ms"],
              reason: deadline.reason,
              message: deadline.message,
              minimum: 1,
              maximum: MAX_NATIVE_TIMER_MS,
            },
          ]),
        );
      const runtime = createNativeUiHelperRuntime(
        this.environment,
        deadline.timeoutMs,
      );
      const interruption = new NativeUiInterruptionControl(
        signal,
        runtime.signal,
        deadline.timeoutMs,
      );
      try {
        this.#pendingNativeUiRuntimes.add(runtime);
        let result: Awaited<ReturnType<typeof observeNativeUi>>;
        try {
          result = await observeNativeUi(this.target, operation, parameters, {
            environment: this.environment,
            runtime,
            interruption,
          });
        } catch (cause: unknown) {
          result = err(
            cause instanceof AnalysisError
              ? cause
              : new ProviderAdapterError(IDENTITY.id, operation, { cause }),
          );
        }
        try {
          await runtime.close();
          this.#pendingNativeUiRuntimes.delete(runtime);
        } catch (cause: unknown) {
          result = finishNativeUiObservation(result, operation, interruption);
          const cleanup = this.#nativeUiCleanupFailure(
            [{ runtime, cause }],
            operation,
            result.ok ? result.value : undefined,
          );
          return err(
            result.ok
              ? cleanup
              : analysisErrorWithCleanupFailure(
                  result.error,
                  cleanup,
                  operation,
                ).bindCleanupDependencies([result.error, cleanup]),
          );
        }
        result = finishNativeUiObservation(result, operation, interruption);
        return result.ok
          ? ok(
              createAnalysisExecution(result.value, IDENTITY, {
                limitations: result.value.limitations,
              }),
            )
          : result;
      } finally {
        interruption.dispose();
      }
    });
  }

  #serializeNativeUi<Value>(operation: () => Promise<Value>): Promise<Value> {
    const call = this.#nativeUiTail.then(operation, operation);
    this.#nativeUiTail = call.then(
      () => undefined,
      () => undefined,
    );
    return call;
  }

  async #retryNativeUiCleanup(): Promise<
    Array<{ readonly runtime: NativeUiHelperRuntime; readonly cause: unknown }>
  > {
    const failures: Array<{
      readonly runtime: NativeUiHelperRuntime;
      readonly cause: unknown;
    }> = [];
    for (const runtime of this.#pendingNativeUiRuntimes) {
      try {
        await runtime.close();
        this.#pendingNativeUiRuntimes.delete(runtime);
      } catch (cause: unknown) {
        failures.push({ runtime, cause });
      }
    }
    return failures;
  }

  async #retryNativeCommandCleanup(): Promise<AnalysisError | undefined> {
    if (this.runner.retryCleanup === undefined) return undefined;
    try {
      const failures = await this.runner.retryCleanup();
      return failures.length === 0
        ? undefined
        : nativeCommandCleanupFailure(failures);
    } catch (cause: unknown) {
      return new ProviderCleanupError(
        IDENTITY.id,
        ["native-command-process-cleanup"],
        {
          reason:
            cause instanceof Error
              ? cause.message || cause.name
              : String(cause) || "native command cleanup failed unexpectedly",
        },
        { cause },
      );
    }
  }

  #nativeUiCleanupFailure(
    failures: readonly {
      readonly runtime: NativeUiHelperRuntime;
      readonly cause: unknown;
    }[],
    operation: string,
    partialObservation?: NativeUiObservationResult,
  ): ProviderCleanupError {
    return new NativeUiCleanupError(failures, operation, partialObservation);
  }

  #dispatchCommand(
    operation:
      | "inspect_macho"
      | "inspect_signature"
      | "inspect_plist"
      | "list_architectures"
      | "demangle_swift",
    parameters: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal | undefined,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    const timeout = readNativeDeadline(
      parameters.native_command_timeout_ms,
      DEFAULT_NATIVE_COMMAND_TIMEOUT_MS,
    );
    if (!timeout.ok)
      return Promise.resolve(
        err(
          new AnalysisInputError(operation, { userMessage: timeout.message }, [
            {
              path: ["native_command_timeout_ms"],
              reason: timeout.reason,
              message: timeout.message,
              minimum: 1,
              maximum: MAX_NATIVE_TIMER_MS,
            },
          ]),
        ),
      );
    const timeoutMs = timeout.timeoutMs;
    switch (operation) {
      case "inspect_macho":
        return this.#inspectMacho(parameters, signal, timeoutMs);
      case "inspect_signature":
        return this.#inspectSignature(signal, timeoutMs);
      case "inspect_plist":
        return this.#inspectPlist(parameters, signal, timeoutMs);
      case "list_architectures":
        return this.#listArchitectures(signal, timeoutMs);
      case "demangle_swift":
        return this.#demangle(parameters, signal, timeoutMs);
    }
  }

  async #listArchitectures(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    // lipo reads only Mach-O; its refusal of a PE, ELF, or plist target is not
    // a tool failure that a retry or `rea doctor` could repair.
    if (!isMachOFormat(this.target.format))
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "list_architectures",
          "Active artifact is not Mach-O.",
        ),
      );
    const capture = await this.#run(
      "list_architectures",
      "lipo",
      ["-detailed_info", this.target.path],
      { signal, timeoutMs },
    );
    if (!capture.ok) return capture;
    const provenance = [invocation(capture.value, this.target.path)];
    const parsed = parseLipoCapture(
      capture.value,
      "list_architectures",
      this.target.path,
    );
    if (!parsed.ok) return parsed;
    const { architectures } = parsed.value;
    const limitations = architectures.flatMap(
      (architecture) => architecture.limitations,
    );
    const result = listArchitecturesSchema.parse({
      architectures: {
        items: architectures,
        total: architectures.length,
        exhaustive: true,
        limitations: [],
      },
      provenance,
      limitations,
    });
    return ok({
      result: jsonValueSchema.parse(result),
      limitations,
      locations: architectureLocations(result.architectures.items),
    });
  }

  async #demangle(
    parameters: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    const symbols = z.array(z.string()).safeParse(parameters.symbols);
    if (!symbols.success)
      return err(
        new AnalysisOutputError(
          "demangle_swift",
          "symbols were not parsed strings",
        ),
      );
    const capture = await this.#run(
      "demangle_swift",
      "swift-demangle",
      // `--` keeps symbols that begin with `-` from selecting demangler options.
      ["--compact", "--", ...symbols.data],
      { signal, timeoutMs },
    );
    if (!capture.ok) return capture;
    const provenance = [invocation(capture.value, this.target.path)];
    const result = demangleSwiftSchema.parse({
      symbols: parseDemangledSymbols(symbols.data, capture.value.stdout),
      provenance,
      limitations: [],
    });
    return ok({
      result: jsonValueSchema.parse(result),
      limitations: [],
      locations: [],
    });
  }

  async #inspectSignature(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    // This provider's signature inspection covers Mach-O code signatures
    // only. On another container, codesign's "not signed" verdict cannot
    // see a format-level signature such as a xar pkg signature, so
    // reporting it would claim unsigned for a layer that was never
    // evaluated.
    if (this.target.kind !== "executable" || !isMachOFormat(this.target.format))
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_signature",
          "Active artifact is not Mach-O; its container-level signature layer is not evaluated by codesign.",
        ),
      );
    const inspected = await withSignatureTarget(
      this.target,
      this.#signatureResources,
      (binding) => this.#inspectBoundSignature(binding, signal, timeoutMs),
      signal,
      this.privateRuntimeRootFactory,
    );
    return inspected.ok
      ? ok({
          result: inspected.value,
          limitations: inspected.value.limitations,
          locations: [],
        })
      : inspected;
  }

  async #inspectBoundSignature(
    binding: SignatureTargetBinding,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<InspectSignature, AnalysisError>> {
    const architecture =
      this.target.kind === "executable" ? this.target.architecture : undefined;
    if (architecture === undefined)
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_signature",
          "No executable architecture is selected.",
        ),
      );
    const target = this.target;
    const selectedSlice =
      target.format === "mach-o-universal"
        ? target.universalSlices?.find(
            (slice) => slice.offset === target.universalSlice.offset,
          )
        : undefined;
    if (target.format === "mach-o-universal" && selectedSlice === undefined)
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_signature",
          "The selected Mach-O slice identity is unavailable for codesign.",
        ),
      );
    const selectedArchitecture =
      selectedSlice === undefined
        ? architecture === "x86"
          ? "i386"
          : architecture
        : machoKnownCodeSignSelector(
            selectedSlice.cpuType,
            selectedSlice.cpuSubtype,
          );
    if (selectedArchitecture === undefined)
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_signature",
          "The selected Mach-O slice has no known codesign architecture selector.",
        ),
      );
    // A thin Mach-O already identifies its only slice. Its admitted architecture
    // is a CPU family, which is not necessarily a codesign subtype selector
    // (for example arm64e). Only universal containers need a selector.
    const selector =
      this.target.format === "mach-o-universal"
        ? ["-a", selectedArchitecture]
        : [];
    const executablePaths = [
      binding.snapshotPath,
      ...(await canonicalPath(binding.snapshotPath)),
    ];
    const display = await this.#captureSignature(
      binding,
      ["-d", ...selector, "--verbose=4"],
      signal,
      timeoutMs,
    );
    if (!display.ok) return display;
    const unsigned = isNonzeroUnsignedObservation(
      display.value,
      binding.snapshotPath,
      executablePaths,
    );
    const displayFailure = codeSignCaptureFailure(
      display.value,
      binding.snapshotPath,
      executablePaths,
    );
    if (displayFailure !== null) return err(displayFailure);
    const requirements = await this.#captureSignature(
      binding,
      ["-d", ...selector, "-r-"],
      signal,
      timeoutMs,
    );
    if (!requirements.ok) return requirements;
    const requirementsFailure = codeSignCaptureFailure(
      requirements.value,
      binding.snapshotPath,
      executablePaths,
    );
    if (requirementsFailure !== null) return err(requirementsFailure);
    const entitlements = await this.#captureSignature(
      binding,
      ["-d", ...selector, "--entitlements", ":-"],
      signal,
      timeoutMs,
    );
    if (!entitlements.ok) return entitlements;
    const entitlementsFailure = codeSignCaptureFailure(
      entitlements.value,
      binding.snapshotPath,
      executablePaths,
    );
    if (entitlementsFailure !== null) return err(entitlementsFailure);
    // codesign echoes the resolved executable path in its diagnostics.
    const parsed = parseCodeSignature(
      display.value.stderr,
      unsigned,
      executablePaths,
    );
    // The requirement is printed to stdout; stderr echoes the path.
    const requirementText =
      /designated\s*=>\s*(.+)$/mu.exec(requirements.value.stdout)?.[1] ?? null;
    // Entitlements XML is printed to stdout; stderr echoes the path.
    const entitlementValue = parseEntitlements(entitlements.value.stdout);
    const captures = [display.value, requirements.value, entitlements.value];
    const limitations = [
      ...parsed.limitations,
      ...entitlementValue.limitations.map((note) => `Entitlements: ${note}`),
      "Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.",
    ];
    const { architectures, unknownSlices } = codeSignArchitectures(
      parsed.format,
      this.target,
    );
    if (architectures.length > 1 || unknownSlices)
      limitations.push(
        `Partial signature coverage: signature identity, hashes, designated requirement, entitlements and runtime state describe the requested ${selectedArchitecture} architecture; other slices' metadata is not returned.`,
      );
    if (unknownSlices)
      limitations.push(
        "Some Mach-O slice identities cannot be mapped to a known codesign selector; their signature states are unknown.",
      );
    if (
      !unsigned &&
      isNonzeroUnsignedObservation(
        requirements.value,
        binding.snapshotPath,
        executablePaths,
      )
    )
      limitations.push(
        "The designated requirement for the requested architecture is unavailable because codesign reported it unsigned.",
      );
    if (
      !unsigned &&
      isNonzeroUnsignedObservation(
        entitlements.value,
        binding.snapshotPath,
        executablePaths,
      )
    )
      limitations.push(
        "The entitlements for the requested architecture are unavailable because codesign reported it unsigned.",
      );
    const observation = () =>
      inspectSignatureSchema.parse({
        ...parsed,
        designated_requirement: requirementText,
        entitlements: entitlementValue.value,
        provenance: captures.map((capture) =>
          invocation(capture, binding.snapshotPath),
        ),
        limitations,
      });
    if (architectures.length > 1) {
      const slices = await this.#inspectSignatureSliceStates(
        binding,
        architectures,
        executablePaths,
        { captures, limitations },
        signal,
        timeoutMs,
      );
      if (!slices.ok) {
        limitations.push(
          "Architecture-specific signature inspection did not complete; remaining slice signing states are unknown.",
        );
        return err(slices.error.retainPartialObservation(observation()));
      }
    }
    const version = await verifySignatureTarget(this.target, binding, signal);
    if (!version.ok)
      return err(version.error.retainPartialObservation(observation()));
    return ok(observation());
  }

  async #inspectSignatureSliceStates(
    binding: SignatureTargetBinding,
    architectures: readonly string[],
    executablePaths: readonly string[],
    observation: { captures: NativeCommandCapture[]; limitations: string[] },
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<void, AnalysisError>> {
    const { captures, limitations } = observation;
    const unsigned: string[] = [];
    let unsignedNote: number | undefined;
    for (const architecture of architectures) {
      const slice = await this.#captureSignature(
        binding,
        ["-d", "-a", architecture, "--verbose=4"],
        signal,
        timeoutMs,
      );
      if (!slice.ok) return slice;
      captures.push(slice.value);
      if (slice.value.exitCode === 0) continue;
      const failure = codeSignCaptureFailure(
        slice.value,
        binding.snapshotPath,
        executablePaths,
      );
      if (failure !== null) return err(failure);
      unsigned.push(architecture);
      if (unsignedNote === undefined) {
        unsignedNote = limitations.length;
        limitations.push("");
      }
      limitations[unsignedNote] =
        `Unsigned Mach-O slices: ${unsigned.join(", ")}.`;
    }
    return ok(undefined);
  }

  async #captureSignature(
    binding: SignatureTargetBinding,
    args: readonly string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeCommandCapture, AnalysisError>> {
    const before = await verifySignatureTarget(this.target, binding, signal);
    if (!before.ok) return before;
    let capture: Result<NativeCommandCapture, AnalysisError>;
    try {
      capture = await this.#run(
        "inspect_signature",
        "codesign",
        [...args, binding.snapshotPath],
        {
          signal,
          acceptNonZero: true,
          timeoutMs,
        },
      );
    } catch (cause: unknown) {
      capture = err(
        new ProviderAdapterError(IDENTITY.id, "inspect_signature", {
          cause,
          diagnostics: {
            phase: "codesign-capture",
            path: this.target.path,
            reason: cause instanceof Error ? cause.message : String(cause),
          },
        }),
      );
    }
    // Verify failed captures too: a disappearing target is not a codesign
    // execution failure, and later captures must never use another version.
    const after = await verifySignatureTarget(this.target, binding, signal);
    return after.ok ? capture : after;
  }

  async #inspectPlist(
    parameters: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    const requested = parameters.path;
    if (requested !== undefined && typeof requested !== "string")
      return err(
        new AnalysisOutputError("inspect_plist", "path was not a string"),
      );
    try {
      return await this.#plistResources.run(async () => {
        if (
          this.activeTarget === undefined ||
          this.activeTarget.kind !== "executable" ||
          this.activeTarget.bundleInfoPlist === undefined
        )
          return this.#readPlist(requested, signal, timeoutMs);
        try {
          const observation = await withArtifactTargetIdentity(
            this.activeTarget,
            this.#plistResources,
            async () => {
              const result = await this.#readPlist(
                requested,
                signal,
                timeoutMs,
              );
              if (!result.ok) throw result.error;
              return result.value;
            },
            signal,
          );
          return ok(observation);
        } catch (cause: unknown) {
          if (cause instanceof AnalysisError) return err(cause);
          return err(
            nativePlistFailure(cause, {
              path: this.activeTarget.path,
              origin: "selected",
            }),
          );
        }
      });
    } catch (cause: unknown) {
      return err(nativePlistFailure(cause, undefined));
    }
  }

  async #readPlist(
    requested: string | undefined,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    try {
      const plist =
        this.bundleResourceRoot === undefined
          ? await resolveNativePlistSelection(this.target, requested)
          : resolveBundleResourcePlistSelection(
              this.bundleResourceRoot,
              requested,
            );
      if (!plist.ok) return plist;
      const fileInput: NativePlistReadContext = {
        selection: plist.value,
        resources: this.#plistResources,
        signal,
        timeoutMs,
      };
      const selected = await requireRegularPlist(fileInput);
      if (!selected.ok) return selected;
      const classified = await this.#run(
        "inspect_plist",
        "file",
        ["-b", plist.value.path],
        { signal, timeoutMs },
      );
      if (!classified.ok) return classified;
      const binary = await this.#inspectBinaryPlist(
        fileInput,
        classified.value,
      );
      if (binary !== undefined) return binary;
      const format = await plistSourceFormat(
        classified.value.stdout,
        fileInput,
      );
      if (!format.ok) return format;
      const source = await this.#inspectTextPlist(
        fileInput,
        classified.value,
        format.value,
      );
      if (source !== undefined) return source;
      return await this.#inspectConvertedPlist(
        fileInput,
        classified.value,
        format.value,
      );
    } catch (cause: unknown) {
      // Producer failures stay opaque; only scope admission failures reach the file mapper.
      return err(nativeOutputFailure("inspect_plist", cause));
    }
  }

  async #inspectBinaryPlist(
    fileInput: NativePlistReadContext,
    classified: NativeCommandCapture,
  ): Promise<Result<NativeObservation, AnalysisError> | undefined> {
    if (!isBinaryPlistDescription(classified.stdout)) return undefined;
    const source = await readNativePlistBytes(fileInput);
    if (!source.ok) return source;
    const parsed = parsePlistBinary(source.value);
    if (!parsed.ok) {
      if (parsed.error instanceof UnsupportedBinaryPlistUidError)
        return err(
          new AnalysisUnsupportedTargetError(
            "inspect_plist",
            fileInput.selection.path,
            parsed.error.message,
            { cause: parsed.error },
          ),
        );
      return parsed.error instanceof AnalysisOutputError
        ? err(
            unreadablePlist(
              fileInput.selection,
              "binary property list could not be decoded",
              { cause: parsed.error },
            ),
          )
        : err(parsed.error);
    }
    return ok(
      nativePlistObservation({
        parsed: parsed.value,
        format: "binary",
        path: fileInput.selection.path,
        resourceRoot: this.bundleResourceRoot,
        provenance: [
          invocation(classified, fileInput.selection.path, "$PLIST"),
        ],
      }),
    );
  }

  async #inspectTextPlist(
    fileInput: NativePlistReadContext,
    classified: NativeCommandCapture,
    format: z.infer<typeof inspectPlistSchema>["format"],
  ): Promise<Result<NativeObservation, AnalysisError> | undefined> {
    const source = await readNativePlistBytes(fileInput);
    if (!source.ok) return source;
    let parsed: ReturnType<typeof parsePlistXmlSource>;
    const provenance = [
      invocation(classified, fileInput.selection.path, "$PLIST"),
    ];
    if (format === "xml") {
      parsed = parsePlistXmlSource(source.value);
      if (parsed.ok) {
        const validated = await this.#run(
          "inspect_plist",
          "plutil",
          ["-lint", "--", fileInput.selection.path],
          {
            signal: fileInput.signal,
            acceptNonZero: true,
            timeoutMs: fileInput.timeoutMs,
          },
        );
        if (!validated.ok) return validated;
        if (validated.value.exitCode !== 0)
          return err(
            nativePlistDecodeFailure(fileInput.selection, validated.value),
          );
        provenance.push(
          invocation(validated.value, fileInput.selection.path, "$PLIST"),
        );
      }
      if (
        !parsed.ok &&
        parsed.error instanceof XmlPlistTextDecodeError &&
        parsed.error.reason === "unsupported-encoding"
      )
        return undefined;
    } else {
      const json = readPlistJsonSource(source.value);
      if (
        json === undefined ||
        json.rootKind === "invalid" ||
        (json.rootKind !== "container" && format !== "json") ||
        json.needsNumberTypes ||
        json.nonFiniteNumberObserved
      )
        return undefined;
      parsed = json.project();
    }
    if (!parsed.ok)
      return parsed.error instanceof AnalysisOutputError ||
        parsed.error instanceof XmlPlistTextDecodeError
        ? err(
            unreadablePlist(fileInput.selection, parsed.error.message, {
              cause: parsed.error,
            }),
          )
        : err(parsed.error);
    return ok(
      nativePlistObservation({
        parsed: parsed.value,
        format,
        path: fileInput.selection.path,
        resourceRoot: this.bundleResourceRoot,
        provenance,
      }),
    );
  }

  async #inspectConvertedPlist(
    fileInput: NativePlistReadContext,
    classified: NativeCommandCapture,
    format: z.infer<typeof inspectPlistSchema>["format"],
  ): Promise<Result<NativeObservation, AnalysisError>> {
    const { path } = fileInput.selection;
    const { signal, timeoutMs } = fileInput;
    const json = await this.#run(
      "inspect_plist",
      "plutil",
      ["-convert", "json", "-o", "-", "--", path],
      { signal, acceptNonZero: true, timeoutMs },
    );
    if (!json.ok) return json;
    // JSON cannot express data, dates, or non-finite reals; plutil rejects
    // such plists, so decode its XML conversion instead. JSON also prints an
    // integral <real> like an <integer>, so XML identifies unsafe number types.
    const jsonDecoded = json.value.exitCode === 0;
    const jsonAttempt = jsonDecoded
      ? readPlistJson(json.value.stdout)
      : undefined;
    let xml: NativeCommandCapture | undefined;
    let parsed: Result<
      ParsedPlist,
      AnalysisOutputError | AnalysisResourceConstraintError
    >;
    if (jsonAttempt === undefined || jsonAttempt.needsNumberTypes) {
      const converted = await this.#run(
        "inspect_plist",
        "plutil",
        ["-convert", "xml1", "-o", "-", "--", path],
        { signal, acceptNonZero: !jsonDecoded, timeoutMs },
      );
      if (!converted.ok) return converted;
      xml = converted.value;
      if (xml.exitCode !== 0) {
        return err(nativePlistDecodeFailure(fileInput.selection, xml));
      }
      parsed =
        jsonAttempt === undefined
          ? parsePlistXml(xml.stdout)
          : jsonAttempt.project(xml.stdout);
    } else {
      parsed = jsonAttempt.project();
    }
    if (!parsed.ok) return parsed;
    const provenance = [
      classified,
      json.value,
      ...(xml === undefined ? [] : [xml]),
    ].map((item) => invocation(item, path, "$PLIST"));
    return ok(
      nativePlistObservation({
        parsed: parsed.value,
        format,
        path,
        resourceRoot: this.bundleResourceRoot,
        provenance,
      }),
    );
  }

  async #inspectMacho(
    parameters: Readonly<Record<string, JsonValue>>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    if (!isMachOFormat(this.target.format))
      return err(
        new AnalysisCapabilityUnavailableError(
          IDENTITY.id,
          "inspect_macho",
          "Active artifact is not Mach-O.",
        ),
      );
    const needsPrivateOtoolOperand = /\([^/]*\)$/u.test(
      basename(this.target.path),
    );
    const inspect = (privateOperand?: string) =>
      withNativeMachoSource(
        this.target,
        this.#machoResources,
        signal,
        (source) =>
          inspectNativeMacho({
            target: this.target,
            ...(signal === undefined ? {} : { signal }),
            run: (tool, arguments_, commandSignal, acceptNonZeroIf) =>
              this.#run(
                "inspect_macho",
                tool,
                privateOperand !== undefined
                  ? arguments_.map((argument) =>
                      argument === this.target.path ? privateOperand : argument,
                    )
                  : arguments_,
                {
                  signal: commandSignal,
                  timeoutMs,
                  ...(acceptNonZeroIf === undefined ? {} : { acceptNonZeroIf }),
                },
              ),
            invocation: (capture) => invocation(capture, this.target.path),
            // Encryption facts come from the same identity-bound descriptor.
            readEncryption: () =>
              readMachoEncryption(
                (at, length) =>
                  source.readSlice(
                    0,
                    source.bytes,
                    Math.min(at, source.bytes),
                    Math.max(0, Math.min(length, source.bytes - at)),
                  ),
                source.bytes,
                MACHO_ENCRYPTION_MAPPING_RECORDS,
              ),
            resolveSlice: (selected) =>
              resolveSelectedMachoSlice(
                source,
                selected,
                Math.floor(NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / 256),
              ),
            readCommandNames: async (offset, size, selected) => {
              const length = size ?? source.bytes - offset;
              // Binary strings can expand to hex and escaped JSON, and each
              // record becomes several objects. Reserve room for those forms.
              const maximum = Math.floor(
                NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / 12,
              );
              const maximumRecords = Math.floor(
                NATIVE_COMMAND_OUTPUT_BUDGET_BYTES / 256,
              );
              const binary = await readMachoCommandNames(
                (at, bytes) => source.readSlice(offset, length, at, bytes),
                length,
                maximum,
                maximumRecords,
                NATIVE_COMMAND_OUTPUT_BUDGET_BYTES,
              );
              if (size !== null) {
                if (selected === undefined)
                  throw new TypeError("Selected Mach-O slice is unavailable");
                assertSelectedMachoSlice(source, selected, binary);
              }
              return binary;
            },
          }),
      );
    try {
      return await this.#machoResources.run(() =>
        needsPrivateOtoolOperand
          ? this.#inspectMachoWithOperand(signal, async (operand) => {
              try {
                return await inspect(operand);
              } catch (cause: unknown) {
                return err(
                  nativeMachoSourceFailure(cause, this.target, parameters),
                );
              }
            })
          : inspect(),
      );
    } catch (cause: unknown) {
      return err(nativeMachoSourceFailure(cause, this.target, parameters));
    }
  }

  async #inspectMachoWithOperand(
    signal: AbortSignal | undefined,
    inspect: (
      operand: string,
    ) => Promise<Result<NativeObservation, AnalysisError>>,
  ): Promise<Result<NativeObservation, AnalysisError>> {
    try {
      return await this.#machoOperandResources.run(async () => {
        if (signal?.aborted)
          return err(
            new AnalysisCancelledError("inspect_macho", {
              cause: signal.reason,
            }),
          );
        let root: Pick<PrivateRuntimeRoot, "path" | "close">;
        try {
          root = await (this.privateRuntimeRootFactory?.() ??
            PrivateRuntimeRoot.create({ prefix: "rea-macho-operand-" }));
        } catch (cause: unknown) {
          return err(
            new ProviderAdapterError(IDENTITY.id, "inspect_macho", {
              cause,
              diagnostics: {
                reason: "Unable to create a private otool operand",
                path: this.target.path,
              },
            }),
          );
        }
        const owner = {
          kind: "lease" as const,
          resource: root.path,
          lease: {
            release: async () => {
              const commandFailure = await this.#retryNativeCommandCleanup();
              if (commandFailure !== undefined) throw commandFailure;
              await root.close();
            },
          },
        };
        let result: Result<NativeObservation, AnalysisError>;
        try {
          const operand = join(root.path, "artifact.macho");
          await symlink(this.target.path, operand);
          result = signal?.aborted
            ? err(
                new AnalysisCancelledError("inspect_macho", {
                  cause: signal.reason,
                }),
              )
            : await inspect(operand);
        } catch (cause: unknown) {
          result = err(
            new ProviderAdapterError(IDENTITY.id, "inspect_macho", {
              cause,
              diagnostics: {
                reason: "Unable to prepare the private otool operand",
                path: this.target.path,
              },
            }),
          );
        }
        const released = await this.#machoOperandResources.release(owner);
        if (released.kind === "failed") {
          const cleanup = new ProviderCleanupError(
            IDENTITY.id,
            [root.path],
            {
              reason: "The private otool operand could not be released",
            },
            { operation: "inspect_macho", cause: released.cause },
          );
          if (result.ok)
            cleanup.retainPartialObservation(
              inspectMachoSchema.parse(result.value.result),
            );
          new AnalysisCleanupLeaseGroup(cleanup, [released.lease]);
          const primary = result.ok
            ? signal?.aborted
              ? new AnalysisCancelledError("inspect_macho", {
                  cause: signal.reason,
                  partialObservation: inspectMachoSchema.parse(
                    result.value.result,
                  ),
                })
              : undefined
            : result.error;
          return err(
            primary === undefined
              ? cleanup
              : analysisErrorWithCleanupFailure(
                  primary,
                  cleanup,
                  "inspect_macho",
                ).bindCleanupDependencies([primary, cleanup]),
          );
        }
        if (signal?.aborted && result.ok)
          return err(
            new AnalysisCancelledError("inspect_macho", {
              cause: signal.reason,
              partialObservation: inspectMachoSchema.parse(result.value.result),
            }),
          );
        return result;
      });
    } catch (cause: unknown) {
      const failure = new ProviderCleanupError(
        IDENTITY.id,
        this.#machoOperandResources.cleanupResources,
        {
          reason: "A previous private otool operand remains owned",
        },
        { operation: "inspect_macho", cause },
      );
      bindArtifactFileCleanup(cause, failure);
      return err(failure);
    }
  }

  async #run(
    operation: NativeToolName,
    tool: string,
    arguments_: readonly string[],
    options: {
      readonly signal?: AbortSignal | undefined;
      readonly timeoutMs: number;
      readonly acceptNonZero?: boolean;
      readonly acceptNonZeroIf?:
        | ((capture: NativeCommandCapture) => boolean)
        | undefined;
    },
  ): Promise<Result<NativeCommandCapture, AnalysisError>> {
    // Commands borrow their enclosing operation's admission through finalization.
    const captured = await this.runner.run(tool, arguments_, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: options.timeoutMs,
      acceptNonZero:
        options.acceptNonZero ?? options.acceptNonZeroIf !== undefined,
    });
    if (captured.ok) {
      const hasFailedExit =
        captured.value.exitCode !== 0 || captured.value.signal !== null;
      if (
        hasFailedExit &&
        options.acceptNonZeroIf !== undefined &&
        !options.acceptNonZeroIf(captured.value)
      )
        return err(
          translateNativeCommandFailure(
            operation,
            new NativeCommandFailure(
              tool,
              captured.value.signal !== null ||
                (captured.value.exitCode !== null &&
                  captured.value.exitCode !== 0)
                ? "nonzero-exit"
                : "io",
              captured.value.exitCode,
              undefined,
              {
                stdout: captured.value.stdout,
                stderr: captured.value.stderr,
                stdoutBytes: captured.value.stdoutBytes,
                stderrBytes: captured.value.stderrBytes,
                exitCode: captured.value.exitCode,
                signal: captured.value.signal,
                truncated: false,
              },
            ),
          ),
        );
      return captured;
    }
    return err(
      translateNativeCommandFailure(
        operation,
        captured.error,
        options.timeoutMs,
      ),
    );
  }
}

const nativeCommandCleanupFailure = (
  failures: readonly NativeCommandCleanupFailure[],
): ProviderCleanupError => {
  const failure = new ProviderCleanupError(
    IDENTITY.id,
    [...new Set(failures.flatMap(({ resources }) => resources))],
    {
      reason: "Native command process cleanup remains incomplete",
      failures: failures.map(({ reason, resources }) => ({
        reason,
        resources: [...resources],
      })),
    },
  );
  if (
    failures.length === 0 ||
    failures.some(({ marker }) => marker === undefined)
  )
    return failure;
  const markers = failures.flatMap(({ marker }) =>
    marker === undefined ? [] : [marker],
  );
  return markers.length === 0
    ? failure
    : failure.bindCleanupDependencies(markers);
};

/** Each file workflow retains its own exact resource set through client close. */
const closeNativeFileScope = async (
  scope: ArtifactResourceScope,
  resource: string,
): Promise<AnalysisError | undefined> => {
  try {
    await scope.close();
    return undefined;
  } catch (cause: unknown) {
    const observation = ArtifactReaderFailure.cleanupObservation(
      cause,
      resource,
    );
    const failure = new ProviderCleanupError(
      IDENTITY.id,
      observation.resources,
      { reason: observation.reason },
      { operation: "close_binary", cause },
    );
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
};

const nativeOutputFailure = (
  operation: AnalysisOperation,
  cause: unknown,
): AnalysisError =>
  new AnalysisOutputError(operation, "Native output parsing failed", { cause });

const nativeMachoCompletedFailure = (
  value: unknown,
): AnalysisError | undefined =>
  value !== null &&
  typeof value === "object" &&
  "ok" in value &&
  value.ok === false &&
  "error" in value &&
  value.error instanceof AnalysisError
    ? value.error
    : undefined;

const nativeMachoSourcePrimary = (
  { cause }: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof MachoBinaryFormatError)
    return new AnalysisOutputError("inspect_macho", cause.message, { cause });
  if (cause instanceof MachoCommandNamesLimitError)
    return new AnalysisResourceConstraintError(
      "inspect_macho",
      "memory",
      cause.message,
      { maximum: cause.maximum, unit: cause.unit },
      { cause, retryable: false },
    );
  const completed =
    cause instanceof NativeMachoSourceVerificationFailure
      ? cause.completed
      : undefined;
  const failed =
    cause instanceof NativeMachoSourceVerificationFailure &&
    cause.outcome.kind === "failed"
      ? nativeMachoSourcePrimary(
          artifactFilePrimaryFacts(cause.outcome.cause),
          path,
        )
      : undefined;
  const previous = failed ?? nativeMachoCompletedFailure(completed);
  const options = {
    cause,
    ...(previous === undefined
      ? {}
      : {
          diagnostics: {
            previous_error: jsonValueSchema.parse(
              projectAnalysisError(previous),
            ),
          },
        }),
  };
  if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
    return new AnalysisCancelledError("inspect_macho", {
      ...options,
      cause: artifactFileCancellationCause(cause),
    });
  if (cause instanceof ArtifactReaderFailure && cause.reason === "format")
    return new AnalysisOutputError("inspect_macho", cause.message, options);
  if (cause instanceof ArtifactReaderFailure && cause.reason === "integrity")
    return new AnalysisArtifactChangedError(
      "inspect_macho",
      path,
      cause.message,
      options,
    );
  return new ProviderAdapterError(IDENTITY.id, "inspect_macho", {
    ...options,
    userMessage: "The selected Mach-O source could not be read safely.",
    remediationAction:
      "Inspect the selected path and its read access, then retry.",
  });
};

const nativeMachoCompletion = (
  cause: unknown,
  target: BinaryTarget,
  parameters: Readonly<Record<string, JsonValue>>,
) => {
  const completion = artifactFileCompletion(cause);
  // The file operation only completes after the producer result has passed
  // the final identity check. Its callback is owned by #inspectMacho.
  const outcome = completion?.value as
    | Result<NativeObservation, AnalysisError>
    | undefined;
  const observation =
    outcome?.ok === true
      ? createAnalysisExecutionEvidence(
          "inspect_macho",
          parameters,
          {
            ...createAnalysisExecution(outcome.value.result, IDENTITY, {
              limitations: outcome.value.limitations,
              locations: outcome.value.locations,
            }),
            subject: target,
          },
          "observed",
          { immutable: true },
        )
      : undefined;
  const completedFailure = nativeMachoCompletedFailure(completion?.value);
  const completionCancellation =
    completion?.cancellation === undefined
      ? undefined
      : new AnalysisCancelledError("inspect_macho", {
          cause: completion.cancellation.reason,
          ...(completedFailure === undefined ||
          (cause instanceof ArtifactReaderFailure &&
            cause.cleanup !== undefined)
            ? {}
            : {
                diagnostics: {
                  previous_error: jsonValueSchema.parse(
                    projectAnalysisError(completedFailure),
                  ),
                },
              }),
        });
  return { observation, completedFailure, completionCancellation };
};

const nativeMachoSourceFailure = (
  cause: unknown,
  target: BinaryTarget,
  parameters: Readonly<Record<string, JsonValue>>,
): AnalysisError => {
  const { observation, completedFailure, completionCancellation } =
    nativeMachoCompletion(cause, target, parameters);
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const physical =
      cause instanceof ArtifactFileCleanupFailure
        ? cause.fileCleanupFailure
        : undefined;
    const previous =
      physical?.outcome.kind === "failed"
        ? nativeMachoSourcePrimary(artifactFilePrimaryFacts(cause), target.path)
        : physical?.outcome.kind === "completed"
          ? (completedFailure ?? completionCancellation)
          : completionCancellation;
    const failure = new ProviderCleanupError(
      IDENTITY.id,
      cause.cleanup.resources,
      {
        reason: cause.cleanup.reason,
        previous_error:
          previous === undefined
            ? null
            : jsonValueSchema.parse(projectAnalysisError(previous)),
        ...(completionCancellation !== undefined &&
        previous !== completionCancellation
          ? {
              completion_cancellation: jsonValueSchema.parse(
                projectAnalysisError(completionCancellation),
              ),
            }
          : {}),
      },
      {
        operation: "inspect_macho",
        cause,
        cleanupPrimary: previous,
        partialObservation: observation,
        ...(completionCancellation === undefined && observation !== undefined
          ? { completedObservation: observation }
          : {}),
      },
    );
    // Do not embed the potentially large observation in the projected
    // cancellation diagnostics as well as the cleanup error's observation.
    if (observation !== undefined)
      completionCancellation?.retainPartialObservation(observation);
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  if (completionCancellation !== undefined) {
    if (observation !== undefined)
      completionCancellation.retainPartialObservation(observation);
    return completionCancellation;
  }
  return nativeMachoSourcePrimary(artifactFilePrimaryFacts(cause), target.path);
};

interface NativeObservation {
  readonly result: JsonValue;
  readonly limitations: readonly string[];
  readonly locations: readonly EvidenceLocation[];
}

const isNativeOperation = (
  operation: AnalysisOperation,
): operation is NativeToolName =>
  NATIVE_TOOL_CONTRACTS.some(({ name }) => name === operation);

const translateCodeSignExitFailure = (
  capture: NativeCommandCapture,
): AnalysisError =>
  translateNativeCommandFailure(
    "inspect_signature",
    new NativeCommandFailure(
      "codesign",
      "nonzero-exit",
      capture.exitCode,
      undefined,
      // Accepted output stays complete until the provider decides it failed.
      failureCapture(capture, false),
    ),
  );

/**
 * Accept only codesign's exact unsigned diagnostic for the bound snapshot,
 * optionally preceded by its verified Executable path echo.
 * The operand is framed byte-for-byte so caller-controlled path text cannot
 * supply the phrase that determines signature state.
 */
const isNonzeroUnsignedObservation = (
  capture: NativeCommandCapture,
  snapshotPath: string,
  executablePaths: readonly string[],
): boolean => {
  if (
    capture.exitCode === null ||
    capture.exitCode === 0 ||
    capture.signal !== null ||
    capture.arguments.at(-1) !== snapshotPath ||
    capture.stdout !== ""
  )
    return false;
  const diagnostic = `${snapshotPath}: code object is not signed at all`;
  return [
    "",
    ...executablePaths.flatMap((path) => [
      `Executable=${path}\n`,
      `Executable=${path}\r\n`,
    ]),
  ].some((prefix) =>
    [diagnostic, `${diagnostic}\n`, `${diagnostic}\r\n`].some(
      (body) => capture.stderr === `${prefix}${body}`,
    ),
  );
};

const canonicalPath = async (path: string): Promise<string[]> => {
  try {
    return [await realpath(path)];
  } catch {
    return [];
  }
};

const codeSignCaptureFailure = (
  capture: NativeCommandCapture,
  snapshotPath: string,
  executablePaths: readonly string[],
): AnalysisError | null =>
  capture.exitCode === 0 ||
  isNonzeroUnsignedObservation(capture, snapshotPath, executablePaths)
    ? null
    : translateCodeSignExitFailure(capture);

const codeSignArchitectures = (
  format: string | null,
  target: BinaryTarget,
): { architectures: string[]; unknownSlices: boolean } => {
  // An architecture-selected codesign display describes the selected slice,
  // not the admitted container. The target owns the container's slice list.
  if (target.kind === "executable" && target.format === "mach-o-universal") {
    if (target.universalSlices === undefined)
      return { architectures: [], unknownSlices: true };
    const names = target.universalSlices.map(({ cpuType, cpuSubtype }) =>
      machoKnownCodeSignSelector(cpuType, cpuSubtype),
    );
    const known = names.filter((name): name is string => name !== undefined);
    return {
      architectures: [...new Set(known)],
      unknownSlices:
        known.length !== names.length || new Set(known).size !== names.length,
    };
  }
  const universal = /^Mach-O universal \(([^)\r\n]+)\)$/u.exec(
    format ?? "",
  )?.[1];
  if (universal !== undefined) {
    const architectures = universal
      .split(/\s+/u)
      .filter((architecture) => /^[A-Za-z][A-Za-z0-9_.]*$/u.test(architecture));
    if (architectures.length > 0)
      return {
        architectures: [...new Set(architectures)],
        unknownSlices: false,
      };
  }
  if (format?.startsWith("Mach-O thin ") === true)
    return { architectures: [], unknownSlices: false };
  if (target.kind !== "executable" || !isMachOFormat(target.format))
    return { architectures: [], unknownSlices: false };
  return {
    architectures: target.availableArchitectures.map((architecture) =>
      architecture === "x86" ? "i386" : architecture,
    ),
    unknownSlices: false,
  };
};

const invocation = (
  capture: NativeCommandCapture,
  artifactPath: string,
  alias = "$ARTIFACT",
): NativeCommandInvocation => ({
  tool: capture.tool,
  command: [
    capture.executable,
    ...capture.arguments.map((argument) =>
      argument === artifactPath ? alias : argument,
    ),
  ],
  tool_version: capture.toolVersion,
  version_reason: capture.versionReason,
  executable_sha256: capture.executableSha256,
  exit: { code: capture.exitCode, signal: capture.signal },
  stdout_bytes: capture.stdoutBytes,
  stderr_bytes: capture.stderrBytes,
});

const nativePlistObservation = (input: {
  readonly parsed: ParsedPlist;
  readonly format: z.infer<typeof inspectPlistSchema>["format"];
  readonly path: string;
  readonly resourceRoot: ResolvedAppBundleResourceRoot | undefined;
  readonly provenance: readonly NativeCommandInvocation[];
}): NativeObservation => {
  const { parsed, format, path, resourceRoot, provenance } = input;
  const result = inspectPlistSchema.parse({
    format,
    value: parsed.value,
    bundle: parsed.bundle,
    source_path: path,
    ...(resourceRoot === undefined
      ? {}
      : {
          resource_root: {
            caller_path: resourceRoot.callerPath,
            canonical_path: resourceRoot.canonicalPath,
            info_plist_path: resourceRoot.infoPlistPath,
            layout: resourceRoot.layout,
            executable_sha256: resourceRoot.executableSha256,
          },
        }),
    provenance,
    limitations: parsed.limitations,
  });
  return {
    result: jsonValueSchema.parse(result),
    limitations: parsed.limitations,
    locations: [{ kind: "artifact-path", path }],
  };
};

const parseEntitlements = (
  output: string,
): {
  readonly value: JsonValue;
  readonly limitations: readonly string[];
} => {
  const start = output.indexOf("<?xml");
  const end = output.lastIndexOf("</plist>");
  if (start < 0 || end < start) return { value: null, limitations: [] };
  const decoded = parseXmlPropertyList(
    output.slice(start, end + "</plist>".length),
  );
  const projected = projectPlistValue(decoded.value);
  const numbers = createPlistNumberProjection(decoded.numberLiterals);
  const value = numbers.project(projected.value);
  return {
    value,
    limitations: [
      ...numbers.limitations(),
      ...(projected.nonFiniteRealCount === 0
        ? []
        : [nonFiniteRealLimitation(projected.nonFiniteRealCount)]),
      ...(projected.negativeZeroRealCount === 0
        ? []
        : [negativeZeroRealLimitation(projected.negativeZeroRealCount)]),
      ...(projected.unknownDateCount === 0
        ? []
        : [unknownDateLimitation(projected.unknownDateCount)]),
      ...(projected.unknownScalarCount === 0
        ? []
        : [unknownScalarLimitation(projected.unknownScalarCount)]),
    ],
  };
};

/** Native admission failures preserve the selected/default source and physical command output. */
const nativePlistDecodeFailure = (
  selection: NativePlistSelection,
  command: NativeCommandCapture,
): AnalysisError => {
  const capture = failureCapture(command, false);
  return unreadablePlist(
    selection,
    `plutil could not decode it as a property list (${plutilDiagnostic(capture, selection.path)})`,
    {
      capturedOutput: {
        stdout: capture.stdout,
        stderr: capture.stderr,
        truncated: capture.truncated,
        stdout_bytes: capture.stdoutBytes,
        stderr_bytes: capture.stderrBytes,
        exit_code: capture.exitCode,
        signal: capture.signal,
      },
    },
  );
};

const plutilDiagnostic = (
  capture: Pick<NativeCommandCapture, "stdout" | "stderr">,
  path: string,
): string => {
  const diagnostics = [capture.stderr, capture.stdout]
    .map((stream) => {
      const text = stream.trim();
      return text.startsWith(`${path}: `) ? text.slice(path.length + 2) : text;
    })
    .filter((text) => text.length > 0);
  return diagnostics.length === 0
    ? "plutil printed no diagnostic"
    : diagnostics.join("\n");
};
