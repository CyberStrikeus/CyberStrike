import { throwIfJadxInterrupted } from "./JadxInterruption.js";
import { Client } from "@modelcontextprotocol/client";
import { createAnalysisExecution } from "../application/AnalysisProvider.js";
import type { AndroidAnalysisExecution } from "../application/android/AndroidAnalysisPort.js";
import type { AndroidRequest } from "../domain/android/androidAnalysis.js";
import {
  type AndroidMappingSource,
  androidMappingLimitations,
} from "../domain/android/androidMapping.js";
import type { AndroidPartialObservation } from "../domain/android/androidPartialObservation.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../domain/jsonValue.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import type { OwnedProviderProcessSpawnOptions } from "../process/ProviderProcess.js";
import { analyzeJadxRequest, type JadxToolPort } from "./JadxAnalysis.js";
import { readAndroidNativeInventory } from "./AndroidNativeInventory.js";
import type { AndroidNativeDeclarations } from "../domain/android/androidNativeDeclarations.js";
import {
  readAndroidJniLibraries,
  type AndroidJniLibraries,
} from "./AndroidJniLibraries.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { jadxOperationTimeoutGuidance } from "./JadxOperationTimeout.js";
import { JadxMcpTransport, type JadxLauncher } from "./JadxMcpTransport.js";
import {
  parseJadxClassPage,
  jadxLoadSchema,
  parseJadxFailure,
  jadxRuntimeSchema,
  parseJadxEnvelope,
  parseJadxJson,
} from "./JadxProtocol.js";
import {
  JADX_BRIDGE_IDENTITY,
  JADX_RELEASE,
  JADX_PROVIDER_IDENTITY,
  JADX_LIMITATIONS,
} from "./JadxRelease.js";

type JadxCall = {
  readonly operation: string;
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly response: JsonValue;
};
type JadxCallObservation = {
  readonly complete: JadxCall;
  inline?: JsonValue;
};

/** One owned engine connection; its wire protocol stays inside the Android adapter. */
export class JadxSession {
  readonly transport: JadxMcpTransport;
  readonly #client = new Client({ name: "rea-android-adapter", version: "1" });
  #loaded: ReturnType<typeof jadxLoadSchema.parse> | undefined;
  #connected = false;
  #partialContext:
    | {
        readonly operation: AndroidRequest["operation"];
        readonly selectedPath: string;
        readonly target: BinaryTarget;
        readonly jarHash: string;
        readonly bridgeHash: string;
      }
    | undefined;
  #observedCalls: JadxCallObservation[] = [];
  #serverName: string | null = null;
  #serverVersion: string | null = null;
  #engineVersion: string | null = null;
  #nativeInventory: AndroidNativeDeclarations | undefined;
  #nativeLibraries:
    | { readonly key: string; readonly value: AndroidJniLibraries }
    | undefined;
  #jniObservation: NonNullable<AndroidPartialObservation["jni"]> | undefined;

  constructor(
    options: Omit<OwnedProviderProcessSpawnOptions, "runId" | "stdin">,
    launcher?: JadxLauncher,
  ) {
    this.transport = new JadxMcpTransport(options, launcher);
  }

  /** Analyze one admitted immutable APK, checking producer identity and selectors. */
  async execute(context: {
    readonly request: AndroidRequest;
    readonly target: BinaryTarget;
    readonly snapshot: string;
    readonly jarHash: string;
    readonly bridgeHash: string;
    readonly signal: AbortSignal;
    /** Selected whole-operation deadline; also bounds each upstream call. */
    readonly timeoutMs: number;
    /** Caller-selected mapping, read before this request reached the queue. */
    readonly mapping?: AndroidMappingSource | undefined;
    readonly resources: ArtifactResourceScope;
    readonly deadline: AbortSignal;
  }): Promise<AndroidAnalysisExecution> {
    const { request, target, snapshot, jarHash, signal, timeoutMs, mapping } =
      context;
    this.#partialContext = {
      operation: request.operation,
      selectedPath: request.input.path,
      target,
      jarHash,
      bridgeHash: context.bridgeHash,
    };
    this.#observedCalls = [];
    this.#jniObservation = undefined;
    if (request.operation === "inspect_android_jni_bindings") {
      const selected = request.input;
      this.#jniObservation = {
        selection: {
          ...(selected.class_name === undefined
            ? {}
            : { class_name: selected.class_name }),
          ...(selected.method_names === undefined
            ? {}
            : { method_names: selected.method_names }),
          ...(selected.descriptors === undefined
            ? {}
            : { descriptors: selected.descriptors }),
          ...(selected.abis === undefined ? {} : { abis: selected.abis }),
          ...(selected.library_paths === undefined
            ? {}
            : { library_paths: selected.library_paths }),
        },
        native_inventory: null,
        libraries: null,
      };
    }
    this.#serverName = null;
    this.#serverVersion = null;
    this.#engineVersion = null;
    const abort = () => {
      void this.transport.interrupt(signal.reason).catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      throwIfJadxInterrupted(signal);
      this.transport.beginOperation();
      if (!this.#connected) {
        await this.#client.connect(this.transport, { timeout: 30_000 });
        this.#connected = true;
      }
      const server = this.#client.getServerVersion();
      this.#serverName = server?.name ?? null;
      this.#serverVersion = server?.version ?? null;
      if (
        server?.name !== JADX_BRIDGE_IDENTITY.name ||
        server.version !== JADX_BRIDGE_IDENTITY.version
      )
        throw new AnalysisCapabilityUnavailableError(
          "jadx",
          request.operation,
          `Expected ${JADX_BRIDGE_IDENTITY.name} ${JADX_BRIDGE_IDENTITY.version}; server reported ${server?.name ?? "unknown"} ${server?.version ?? "unknown"}.`,
        );
      const tools = this.#tools(request, target, signal, timeoutMs);
      const runtime = jadxRuntimeSchema.parse(
        await tools.json("rea_jvm_status", {}),
      );
      this.#engineVersion = runtime.engine_reported_version;
      if (runtime.engine_reported_version !== JADX_RELEASE.version)
        throw new AnalysisCapabilityUnavailableError(
          "jadx",
          request.operation,
          `Expected engine ${JADX_RELEASE.version}; JAR reported ${runtime.engine_reported_version}.`,
        );
      const loaded =
        request.operation === "inspect_android_jni_bindings"
          ? undefined
          : (this.#loaded ??
            jadxLoadSchema.parse(
              await tools.json("load_apk", {
                path: snapshot,
                threads: 1,
                resources: "full",
              }),
            ));
      if (loaded !== undefined && loaded.apk_path !== snapshot)
        throw new AnalysisOutputError(
          request.operation,
          "JADX loaded a different APK path than the admitted snapshot",
        );
      if (loaded !== undefined) this.#loaded = loaded;
      const engine = {
        name: "jadx-headless-mcp",
        version: runtime.engine_reported_version,
        artifact_sha256: jarHash,
        source_revision:
          jarHash === JADX_RELEASE.sha256 ? JADX_RELEASE.revision : null,
        worker_count: 1,
        heap_limit_mib:
          Math.floor(runtime.max_heap_bytes / (1024 * 1024)) || null,
      } as const;
      const result = await analyzeJadxRequest(tools, request, {
        loaded,
        engine,
        mapping,
        ...(request.operation !== "inspect_android_jni_bindings"
          ? {}
          : {
              jni: {
                apkSha256: target.sha256,
                inventory: async () => {
                  const inventory =
                    this.#nativeInventory ??
                    (await readAndroidNativeInventory(tools, snapshot));
                  if (this.#jniObservation !== undefined)
                    this.#jniObservation.native_inventory = inventory;
                  if (inventory.coverage.status === "complete")
                    this.#nativeInventory = inventory;
                  return inventory;
                },
                libraries: async () => {
                  const key = JSON.stringify({
                    abis: request.input.abis,
                    library_paths: request.input.library_paths,
                  });
                  if (this.#nativeLibraries?.key === key) {
                    if (this.#jniObservation !== undefined)
                      this.#jniObservation.libraries = {
                        scan_state: "completed",
                        libraries: [...this.#nativeLibraries.value.libraries],
                        inventory: this.#nativeLibraries.value.inventory,
                      };
                    return this.#nativeLibraries.value;
                  }
                  const value = await readAndroidJniLibraries({
                    snapshot,
                    apkSha256: target.sha256,
                    selection: request.input,
                    resources: context.resources,
                    signal,
                    onObservation: (checkpoint) => {
                      if (this.#jniObservation !== undefined)
                        this.#jniObservation.libraries = checkpoint;
                    },
                    interruption: (reason) =>
                      context.deadline.aborted &&
                      reason === context.deadline.reason
                        ? new AnalysisTimeoutError(
                            request.operation,
                            timeoutMs,
                            {
                              cause: reason,
                              ...jadxOperationTimeoutGuidance(timeoutMs),
                            },
                          )
                        : new AnalysisCancelledError(request.operation, {
                            cause: reason,
                          }),
                  });
                  if (
                    value.inventory.status === "complete" &&
                    value.libraries.every((library) => library.failure === null)
                  )
                    this.#nativeLibraries = { key, value };
                  return value;
                },
              },
            }),
      });
      const raw = jsonObjectSchema.parse({
        server,
        bridge_sha256: context.bridgeHash,
        jar_sha256: jarHash,
        ...(loaded === undefined ? {} : { loaded }),
      });
      const execution = createAnalysisExecution(
        result,
        JADX_PROVIDER_IDENTITY,
        {
          rawResult: {
            ...raw,
            calls: this.#observedCalls.map(({ complete }) => complete),
          },
          subject: target,
          limitations:
            request.operation === "inspect_android_jni_bindings"
              ? []
              : [...JADX_LIMITATIONS, ...androidMappingLimitations(mapping)],
          locations:
            request.operation === "inspect_android_package"
              ? [{ kind: "artifact-path", path: "AndroidManifest.xml" }]
              : [],
        },
      );
      return request.operation === "search_android_classes"
        ? {
            ...execution,
            searchRawSummary: {
              ...raw,
              calls: this.#observedCalls.map(
                ({ complete, inline }) => inline ?? complete,
              ),
            },
          }
        : execution;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /** Facts and upstream replies retained if a later request step fails. */
  partialObservation(): AndroidPartialObservation | undefined {
    const context = this.#partialContext;
    if (context === undefined) return undefined;
    return {
      provider_id: "jadx",
      operation: context.operation,
      target: {
        selected_path: context.selectedPath,
        path: context.target.path,
        sha256: context.target.sha256,
        format: "apk",
      },
      provider_facts: {
        jar_sha256: context.jarHash,
        bridge_sha256: context.bridgeHash,
        bridge_name: JADX_BRIDGE_IDENTITY.name,
        bridge_version: JADX_BRIDGE_IDENTITY.version,
        server_name: this.#serverName,
        server_version: this.#serverVersion,
        engine_version: this.#engineVersion,
      },
      calls: this.#observedCalls.map(({ complete }) => complete),
      ...(this.#jniObservation === undefined
        ? {}
        : { jni: this.#jniObservation }),
    };
  }

  /** Whether the selected Java runtime established the REA bridge protocol. */
  initialized(): boolean {
    return this.#connected;
  }

  /** Join owned cleanup even if SDK connection teardown itself fails. */
  async close(): Promise<void> {
    try {
      await this.#client.close();
    } finally {
      await this.transport.close();
    }
  }

  #tools(
    request: AndroidRequest,
    target: BinaryTarget,
    signal: AbortSignal,
    timeoutMs: number,
  ): JadxToolPort {
    const call = async (
      name: string,
      input: Readonly<Record<string, JsonValue>>,
    ) => {
      throwIfJadxInterrupted(signal);
      // Keep an explicit bound: omitting it falls back to the SDK's 60-second default.
      const response = await this.#client.callTool(
        { name, arguments: input },
        { timeout: timeoutMs, signal },
      );
      const observedResponse = jsonValueSchema.parse(response);
      const call = { operation: name, input, response: observedResponse };
      const observation: JadxCallObservation = { complete: call };
      this.#observedCalls.push(observation);
      const envelope = parseJadxEnvelope(observedResponse, request.operation);
      const text = envelope.content[0].text;
      if (envelope.isError === true) {
        const failure = parseJadxFailure(text);
        if (failure !== undefined) {
          if (failure.kind === "reference-output-limit")
            throw new AnalysisResourceConstraintError(
              request.operation,
              "memory",
              "External DEX reference metadata exceeds the bounded transport representation allowance.",
              { stage: failure.stage, limit_bytes: failure.limit_bytes },
              fixedAllowanceOptions(
                `The external DEX ${failure.stage} representation allowance of ${String(failure.limit_bytes)} bytes`,
                "report",
              ),
            );
          if (name === "load_apk" && failure.kind === "jvm-memory-failure")
            throw new AnalysisResourceConstraintError(
              request.operation,
              "memory",
              `The JADX JVM could not allocate memory during ${name}${failure.message ? `: ${failure.message}` : ""}`,
              {
                observed_max_heap_bytes: failure.max_heap_bytes,
                memory_area: failure.memory_area,
              },
              {
                retryable: false,
                remediationAction:
                  failure.memory_area === "heap"
                    ? "Increase REA_JADX_HEAP_MIB (MiB) in the environment that starts REA, within the host or container memory budget. Review JAVA_TOOL_OPTIONS and other JVM heap overrides. The observed heap is this run's limit, not the heap the APK requires."
                    : "Review the JVM allocation failure and the host or container memory limits. The observed maximum heap does not establish which memory region was exhausted; increasing heap alone may not help.",
                diagnostics: {
                  upstream_operation: name,
                  reason: failure.message ?? null,
                  exception_type: failure.exception_type,
                  target_path: target.path,
                  target_sha256: target.sha256,
                },
              },
            );
          if (failure.kind === "invalid-input")
            throw new AnalysisInputError(request.operation, undefined, [
              {
                path: [failure.field],
                reason: "invalid_value",
                message: failure.message,
              },
            ]);
        }
        throw new ProviderAdapterError("jadx", request.operation, {
          diagnostics: {
            upstream_operation: name,
            reason: text,
            target_path: target.path,
            target_sha256: target.sha256,
          },
        });
      }
      return { text, envelope, observation };
    };
    return {
      text: async (name, input) => (await call(name, input)).text,
      json: async (name, input) =>
        parseJadxJson((await call(name, input)).text, request.operation),
      listClasses: async (input) => {
        const reply = await call("list_classes", input);
        const page = parseJadxClassPage(
          parseJadxJson(reply.text, request.operation),
        );
        const { items, ...audit } = page;
        reply.observation.inline = {
          ...reply.observation.complete,
          inventory_elided: true,
          response: {
            ...reply.envelope,
            content: reply.envelope.content.map((entry) => ({
              ...entry,
              text: JSON.stringify({ ...audit, items_omitted: items.length }),
            })),
          },
        };
        return page;
      },
    };
  }
}
