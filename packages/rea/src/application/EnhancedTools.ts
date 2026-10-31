import { permitsCapabilityFallback } from "./CapabilityFallback.js";
import type { NativeCallGraph } from "../domain/native/nativeCallGraph.js";
import { nativeProcedureInputSchema } from "../domain/native/nativeProcedureInput.js";
import { CALL_RELATIONSHIP_TRAVERSALS } from "./CallRelationshipTraversal.js";
import { z } from "zod";

import type {
  AnalysisExecution,
  AnalysisOperation,
  AnalysisOperationPort,
  ExecutionOptions,
} from "./AnalysisProvider.js";
import {
  enhancedInputSchemas,
  type CallRelationshipDirection,
  type EnhancedToolName,
} from "../contracts/enhancedInputs.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { parseFunctionDossier } from "../domain/native/functionDossier.js";
import {
  parseNativeInventoryCount,
  addressedValueSchema,
} from "../domain/native/nativeInventory.js";
import { parseRelatedAddresses } from "../domain/native/nativeObservation.js";
import {
  parseSegments,
  projectBinaryOverview,
} from "../domain/native/nativeSegments.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  categorizeSwiftTypes,
  discoverObjcProtocols,
  projectObjcClassCandidates,
  selectObjcClassCandidates,
} from "../domain/symbolAnalysis.js";
import { inspectNativeDispatch } from "./native/NativeDispatchMetadataInspection.js";
import { traceNativeValues } from "./native/NativeValueTrace.js";
import { traceNativeUiAction } from "./native/NativeUiActionTrace.js";
import { decompileAll } from "./decompileDirectory/decompileAll.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  nativeDispatchMetadataResultSchema,
  MAX_DISPATCH_METADATA_RECORDS,
} from "../domain/native/objcSwiftMetadata.js";
import { isMachOFormat } from "../domain/binaryTargetTypes.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import {
  machoTargetSelectionMatchesArchitecture,
  machoTargetSelectionMatchesFormat,
  profileMachoTargetSelection,
  sameMachoTargetSelection,
} from "../domain/apple/machoTargetSelection.js";

import {
  invalidEnhancedInput,
  type EnhancedResult,
  type ValidatedEnhancedCall,
} from "./EnhancedToolTypes.js";
import { resolveAnalysisDocument } from "./AnalysisDocument.js";
import { traceCallPath } from "./CallPathTracing.js";
import { resolveXrefsName } from "./XrefsAddressResolution.js";
import {
  parseProcedureAddress,
  resolveProcedureAddress,
} from "./ProcedureAddressResolution.js";
import { traceLiteralFeature } from "./EnhancedLiteralTracing.js";
import { projectNativeApiInspection } from "./native/NativeApiInspection.js";

type BatchProcedureIdentity =
  | {
      readonly status: "resolved";
      readonly address: string;
      readonly name: string | null;
      readonly name_error?: ReturnType<typeof projectAnalysisError>;
    }
  | {
      readonly status: "unknown";
      readonly error: ReturnType<typeof projectAnalysisError>;
    };

type BatchResolution = {
  readonly address: string;
  readonly result: Result<string, AnalysisError>;
};

type BatchReadyItem = {
  readonly address: string;
  readonly procedure: BatchProcedureIdentity;
  readonly providerProcedure: string;
};

type BatchDecompileItem = {
  readonly address: string;
  readonly procedure: BatchProcedureIdentity;
  readonly status: "ok" | "error";
  readonly pseudocode?: string;
  readonly error?: ReturnType<typeof projectAnalysisError>;
  /** Caveats of this item's own observation when it supplied no pseudocode. */
  readonly limitations?: string[];
};

/**
 * Guidance for a batch item whose provider returned null pseudocode, by
 * whether that observation reported caveats for the item to carry.
 */
export const NULL_PSEUDOCODE_GUIDANCE = {
  reported: {
    userMessage:
      "The provider returned no pseudocode for this function; this item's limitations hold that observation's caveats, including any reason the provider reported.",
    remediationAction:
      "Read this item's limitations for the provider's reason before retrying; another provider may decompile this entry.",
  },
  none: {
    userMessage:
      "The provider returned no pseudocode for this function and reported no caveat or reason for it.",
    remediationAction:
      "The provider gave no further explanation; another provider may decompile this entry.",
  },
} as const;

/**
 * The item error for a provider answer without usable text. Null is the
 * provider's observation that it has no pseudocode for this function; empty
 * or non-text pseudocode is unreadable output.
 */
const missingPseudocodeError = (
  providerId: string,
  pseudocode: JsonValue,
  caveats: keyof typeof NULL_PSEUDOCODE_GUIDANCE,
): AnalysisError =>
  pseudocode === null
    ? new AnalysisCapabilityUnavailableError(
        providerId,
        "procedure_pseudo_code",
        "provider returned null pseudocode",
        NULL_PSEUDOCODE_GUIDANCE[caveats],
      )
    : new AnalysisOutputError(
        "procedure_pseudo_code",
        typeof pseudocode === "string"
          ? "provider returned empty pseudocode"
          : "provider returned non-text pseudocode",
      );

const isAnalysisCancellation = (
  error: AnalysisError,
): error is AnalysisCancelledError => error._tag === "AnalysisCancelledError";

/**
 * Composes direct provider operations into reverse-engineering tools.
 * Direct callers use `execute`; adapters that own validation use
 * `executeValidated` so an MCP input is parsed exactly once.
 */
export class EnhancedTools {
  constructor(private readonly analysis: AnalysisOperationPort) {}

  /** Parse an untrusted direct-call input once, then dispatch exhaustively. */
  execute(
    name: EnhancedToolName,
    input: unknown,
    signal?: AbortSignal,
  ): EnhancedResult {
    if (name === "trace_feature" || name === "trace_call_path")
      return this.#executeTracing(name, input, signal);
    if (name === "trace_native_values") {
      const parsed = enhancedInputSchemas.trace_native_values.safeParse(input);
      return parsed.success
        ? this.executeValidated({ name, input: parsed.data }, signal)
        : invalidEnhancedInput(name, parsed.error, input);
    }
    if (name === "trace_native_ui_action") {
      const parsed =
        enhancedInputSchemas.trace_native_ui_action.safeParse(input);
      return parsed.success
        ? this.executeValidated({ name, input: parsed.data }, signal)
        : invalidEnhancedInput(name, parsed.error, input);
    }
    if (name === "analyze_function" || name === "inspect_native_api")
      return this.#executeFunctionAnalysis(name, input, signal);
    switch (name) {
      case "inspect_native_dispatch_metadata": {
        const parsed =
          enhancedInputSchemas.inspect_native_dispatch_metadata.safeParse(
            input,
          );
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "get_objc_classes": {
        const parsed = enhancedInputSchemas.get_objc_classes.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "get_objc_protocols": {
        const parsed = enhancedInputSchemas.get_objc_protocols.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "batch_decompile": {
        const parsed = enhancedInputSchemas.batch_decompile.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "decompile_all": {
        const parsed = enhancedInputSchemas.decompile_all.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "get_call_graph": {
        const parsed = enhancedInputSchemas.get_call_graph.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "analyze_swift_types": {
        const parsed =
          enhancedInputSchemas.analyze_swift_types.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "find_xrefs_to_name": {
        const parsed = enhancedInputSchemas.find_xrefs_to_name.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
      case "binary_overview": {
        const parsed = enhancedInputSchemas.binary_overview.safeParse(input);
        return parsed.success
          ? this.executeValidated({ name, input: parsed.data }, signal)
          : invalidEnhancedInput(name, parsed.error, input);
      }
    }
  }

  /** Dispatch input already parsed by a trusted adapter boundary. */
  executeValidated(
    call: ValidatedEnhancedCall,
    signal?: AbortSignal,
  ): EnhancedResult {
    switch (call.name) {
      case "inspect_native_dispatch_metadata":
        return inspectNativeDispatch(this.analysis, call.input.max_records, {
          signal,
          objcClassImportAddresses: call.input.objc_class_import_addresses,
          objcClassImportAddressesComplete:
            call.input.objc_class_import_addresses_complete,
          maxInputBytes: call.input.max_input_bytes,
        });
      case "get_objc_classes":
        return this.#objcClasses(call.input.pattern, signal);
      case "get_objc_protocols":
        return this.#objcProtocols(signal);
      case "batch_decompile":
        return this.#batchDecompile(call.input.addresses, signal);
      case "decompile_all":
        return decompileAll(this.analysis, call.input, signal);
      case "get_call_graph":
        return this.#callGraph(call.input, signal);
      case "analyze_swift_types":
        return this.#analyzeSwiftTypes(call.input, signal);
      case "find_xrefs_to_name":
        return this.#findXrefs(call.input.name, signal);
      case "binary_overview":
        return this.#binaryOverview(signal);
      case "analyze_function":
        return this.#analyzeFunction(call.input, signal);
      case "inspect_native_api":
        return this.#inspectNativeApi(call.input, signal);
      case "trace_feature":
        return traceLiteralFeature(
          (name, arguments_, operationSignal) =>
            this.#call(name, arguments_, operationSignal),
          (name, arguments_, operationSignal) =>
            this.#observe(name, arguments_, operationSignal),
          call.input,
          signal,
        );
      case "trace_call_path":
        return traceCallPath(
          (name, arguments_, operationSignal, selectorOrigin) =>
            this.#call(name, arguments_, operationSignal, selectorOrigin),
          (name, arguments_, operationSignal, selectorOrigin) =>
            this.#observe(name, arguments_, operationSignal, selectorOrigin),
          call.input,
          signal,
        );
      case "trace_native_values":
        return traceNativeValues(this.analysis, call.input, signal);
      case "trace_native_ui_action": {
        return traceNativeUiAction(this.analysis, call.input, signal);
      }
    }
  }

  #executeTracing(
    name: "trace_feature" | "trace_call_path",
    input: unknown,
    signal?: AbortSignal,
  ): EnhancedResult {
    if (name === "trace_call_path") {
      const parsed = enhancedInputSchemas.trace_call_path.safeParse(input);
      if (!parsed.success)
        return invalidEnhancedInput(name, parsed.error, input);
      return this.executeValidated({ name, input: parsed.data }, signal);
    }
    const parsed = enhancedInputSchemas.trace_feature.safeParse(input);
    if (!parsed.success) return invalidEnhancedInput(name, parsed.error, input);
    return this.executeValidated({ name, input: parsed.data }, signal);
  }

  #executeFunctionAnalysis(
    name: "analyze_function" | "inspect_native_api",
    input: unknown,
    signal?: AbortSignal,
  ): EnhancedResult {
    const parsed = nativeProcedureInputSchema.safeParse(input);
    if (!parsed.success) return invalidEnhancedInput(name, parsed.error, input);
    return this.executeValidated({ name, input: parsed.data }, signal);
  }

  async #analyzeFunction(
    input: Readonly<Record<string, JsonValue>>,
    signal?: AbortSignal,
  ): EnhancedResult {
    const result = await this.#call("analyze_function", input, signal);
    return result.ok ? parseFunctionDossier(result.value) : result;
  }

  async #inspectNativeApi(
    input: z.output<typeof nativeProcedureInputSchema>,
    signal?: AbortSignal,
  ): EnhancedResult {
    const result = await this.#call("analyze_function", input, signal);
    if (!result.ok) return result;
    const parsed = parseFunctionDossier(result.value);
    if (!parsed.ok) return parsed;
    return ok(jsonValueSchema.parse(projectNativeApiInspection(parsed.value)));
  }

  async #objcClasses(pattern: string, signal?: AbortSignal): EnhancedResult {
    const namesExecution = await this.#observe("list_names", {}, signal);
    if (!namesExecution.ok) return namesExecution;
    const names = this.#parseAddressed(
      "list_names",
      namesExecution.value.result,
    );
    if (!names.ok) return names;
    const candidates = selectObjcClassCandidates(names.value, pattern);
    if (candidates.length === 0)
      return ok(
        projectObjcClassCandidates(candidates, {
          bindings: [],
          coverage: { status: "not_applicable", reason: null },
        }),
      );

    const addresses = [...new Set(candidates.map(({ address }) => address))];
    const scannedAddresses = addresses.slice(0, MAX_DISPATCH_METADATA_RECORDS);
    const bindingsExecution = await this.#observe(
      "inspect_native_dispatch_metadata",
      {
        max_records: MAX_DISPATCH_METADATA_RECORDS,
        objc_class_import_addresses: scannedAddresses,
        objc_class_import_addresses_complete:
          addresses.length <= MAX_DISPATCH_METADATA_RECORDS,
      },
      signal,
    );
    if (!bindingsExecution.ok) {
      if (!permitsCapabilityFallback(bindingsExecution.error))
        return bindingsExecution;
      return ok(
        projectObjcClassCandidates(candidates, {
          bindings: [],
          coverage: {
            status: "unknown",
            reason: bindingsExecution.error.reason,
          },
        }),
      );
    }

    const native = nativeDispatchMetadataResultSchema.safeParse(
      bindingsExecution.value.result,
    );
    const nameSubject = namesExecution.value.subject;
    const bindingSubject = bindingsExecution.value.subject;
    const namesSelection = profileMachoTargetSelection(
      namesExecution.value.analysisProfile,
    );
    const nativeSelection = native.success
      ? native.data.result.target_selection
      : undefined;
    if (
      !native.success ||
      nameSubject === null ||
      nameSubject === undefined ||
      bindingSubject === null ||
      bindingSubject === undefined ||
      nameSubject.sha256 !== bindingSubject.sha256 ||
      nameSubject.architecture === undefined ||
      bindingSubject.architecture === undefined ||
      nameSubject.architecture !== bindingSubject.architecture ||
      !isMachOFormat(nameSubject.format) ||
      nameSubject.format !== bindingSubject.format ||
      native.data.target_sha256 !== nameSubject.sha256 ||
      native.data.target_architecture !== nameSubject.architecture ||
      native.data.provider.id !== bindingsExecution.value.provider.id ||
      namesExecution.value.analysisProfile?.provider.id !==
        namesExecution.value.provider.id ||
      nativeSelection === undefined ||
      !machoTargetSelectionMatchesArchitecture(
        nativeSelection,
        nameSubject.architecture,
      ) ||
      !machoTargetSelectionMatchesFormat(nativeSelection, nameSubject.format) ||
      !sameMachoTargetSelection(namesSelection, nativeSelection) ||
      native.data.result.objc_class_import_bindings === undefined ||
      native.data.result.objc_class_import_binding_coverage === undefined
    )
      return ok(
        projectObjcClassCandidates(candidates, {
          bindings: [],
          coverage: {
            status: "unknown",
            reason:
              "Native class-import facts did not prove matching artifact, architecture, and complete producer identity.",
          },
        }),
      );

    const coverage = native.data.result.objc_class_import_binding_coverage;
    const inventoryLimitations = namesExecution.value.limitations;
    const inventoryIncomplete = inventoryLimitations.length > 0;
    const coverageReason = [
      coverage.reason,
      ...inventoryLimitations.map((limitation) => `list_names: ${limitation}`),
    ]
      .filter((reason): reason is string => reason !== null)
      .join("; ");
    return ok(
      projectObjcClassCandidates(candidates, {
        bindings: native.data.result.objc_class_import_bindings,
        coverage: {
          status:
            coverage.status === "not_requested"
              ? "unknown"
              : coverage.status === "complete" && inventoryIncomplete
                ? "partial"
                : coverage.status,
          reason: coverageReason.length === 0 ? null : coverageReason,
        },
      }),
    );
  }

  async #objcProtocols(signal?: AbortSignal): EnhancedResult {
    const names = await this.#allAddressed("list_names", signal);
    return names.ok ? ok(discoverObjcProtocols(names.value)) : names;
  }

  async #batchDecompile(
    addresses: readonly string[],
    signal?: AbortSignal,
  ): EnhancedResult {
    const resolutions: BatchResolution[] = [];
    for (const address of addresses) {
      const result = await resolveProcedureAddress(
        this.#call.bind(this),
        address,
        signal,
      );
      if (!result.ok && isAnalysisCancellation(result.error)) return result;
      resolutions.push({ address, result });
    }
    const identities = await this.#batchIdentities(resolutions, signal);
    if (!identities.ok) return identities;
    const decompilations = await this.#batchPseudocode(
      identities.value,
      signal,
    );
    if (!decompilations.ok) return decompilations;
    const items = decompilations.value;
    const succeeded = items.filter(({ status }) => status === "ok").length;
    return ok({
      items,
      total: items.length,
      succeeded,
      failed: items.length - succeeded,
    });
  }

  async #batchIdentities(
    resolutions: readonly BatchResolution[],
    signal?: AbortSignal,
  ): Promise<Result<BatchReadyItem[], AnalysisCancelledError>> {
    const ready: BatchReadyItem[] = [];
    for (const { address, result } of resolutions) {
      if (!result.ok) {
        ready.push({
          address,
          providerProcedure: address,
          procedure: {
            status: "unknown",
            error: projectAnalysisError(result.error),
          },
        });
        continue;
      }
      const identity = await this.#batchProcedureIdentity(result.value, signal);
      if (!identity.ok) return identity;
      ready.push({
        address,
        providerProcedure: result.value,
        procedure: identity.value,
      });
    }
    return ok(ready);
  }

  async #batchPseudocode(
    ready: readonly BatchReadyItem[],
    signal?: AbortSignal,
  ): Promise<Result<BatchDecompileItem[], AnalysisCancelledError>> {
    const items: BatchDecompileItem[] = [];
    for (const { address, procedure, providerProcedure } of ready) {
      const observed = await this.#observe(
        "procedure_pseudo_code",
        { procedure: providerProcedure },
        signal,
        procedure.status === "resolved" ? "provider" : undefined,
      );
      if (!observed.ok) {
        if (isAnalysisCancellation(observed.error)) return err(observed.error);
        items.push({
          address,
          procedure,
          status: "error",
          error: projectAnalysisError(observed.error),
        });
        continue;
      }
      const { result: pseudocode, provider } = observed.value;
      if (typeof pseudocode === "string" && pseudocode.length > 0) {
        items.push({ address, procedure, status: "ok", pseudocode });
        continue;
      }
      // Only this observation can explain its missing text, so its caveats
      // stay with the item; the batch Evidence still aggregates them.
      const limitations = [...new Set(observed.value.limitations)];
      items.push({
        address,
        procedure,
        status: "error",
        error: projectAnalysisError(
          missingPseudocodeError(
            provider.id,
            pseudocode,
            limitations.length === 0 ? "none" : "reported",
          ),
        ),
        ...(limitations.length === 0 ? {} : { limitations }),
      });
    }
    return ok(items);
  }

  async #batchProcedureIdentity(
    address: string,
    signal?: AbortSignal,
  ): Promise<Result<BatchProcedureIdentity, AnalysisCancelledError>> {
    const observed = await this.#call("address_name", { address }, signal);
    if (!observed.ok && isAnalysisCancellation(observed.error))
      return err(observed.error);
    const named =
      observed.ok &&
      (typeof observed.value === "string" || observed.value === null);
    return ok({
      status: "resolved" as const,
      address,
      name: named ? observed.value : null,
      ...(named
        ? {}
        : {
            name_error: projectAnalysisError(
              observed.ok
                ? new AnalysisOutputError(
                    "address_name",
                    "provider returned an invalid entry label",
                  )
                : observed.error,
            ),
          }),
    });
  }

  async #callGraph(
    input: {
      readonly address: string;
      readonly direction: CallRelationshipDirection;
    },
    signal?: AbortSignal,
  ): EnhancedResult {
    const { relation, operation: tool } =
      CALL_RELATIONSHIP_TRAVERSALS[input.direction];
    const limitations = new Set<string>();
    const resolved = await this.#observe(
      "procedure_address",
      { procedure: input.address },
      signal,
    );
    if (!resolved.ok) return resolved;
    for (const limitation of resolved.value.limitations)
      limitations.add(limitation);
    const parsedAddress = parseProcedureAddress(resolved.value.result);
    if (!parsedAddress.ok) return parsedAddress;
    const startAddress = parsedAddress.value;
    const discovered = new Set([startAddress]);
    const queue: Array<{ address: string; depth: number }> = [
      { address: startAddress, depth: 0 },
    ];
    let queueIndex = 0;
    const graph: Record<string, JsonValue[]> = {};

    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      if (current === undefined) continue;
      const level = String(current.depth);
      graph[level] ??= [];

      const result = await this.#observe(
        tool,
        { procedure: current.address },
        signal,
        "provider",
      );
      if (!result.ok) {
        if (isAnalysisCancellation(result.error)) return result;
        graph[level].push({
          address: current.address,
          status: "error",
          error: projectAnalysisError(result.error),
        } satisfies NativeCallGraph["graph"][string][number]);
        continue;
      }
      const related = parseRelatedAddresses(result.value.result, relation);
      if (!related.ok) {
        graph[level].push({
          address: current.address,
          status: "error",
          error: projectAnalysisError(related.error),
        } satisfies NativeCallGraph["graph"][string][number]);
        continue;
      }
      for (const limitation of result.value.limitations)
        limitations.add(limitation);
      const reportedCoverage = result.value.relationshipCoverage;
      const coverage = reportedCoverage ?? {
        status: "unknown" as const,
        reason: "Provider did not report relationship coverage.",
      };
      const relationshipLimitations =
        reportedCoverage === undefined
          ? [
              ...result.value.limitations,
              "Provider did not report relationship coverage.",
            ]
          : [
              ...(reportedCoverage.status === "partial"
                ? reportedCoverage.limitations
                : reportedCoverage.status === "unknown"
                  ? [reportedCoverage.reason]
                  : []),
              ...("diagnostics" in reportedCoverage
                ? reportedCoverage.diagnostics
                : []),
            ];
      const nodeLimitations = [...new Set(relationshipLimitations)].sort(
        compareUnicodeCodePoints,
      );
      graph[level].push({
        address: current.address,
        status: "ok",
        calls: [...related.value],
        relationship_coverage: coverage,
        ...(nodeLimitations.length === 0
          ? {}
          : { limitations: nodeLimitations }),
      } satisfies NativeCallGraph["graph"][string][number]);
      for (const address of related.value) {
        if (!discovered.has(address)) {
          discovered.add(address);
          queue.push({ address, depth: current.depth + 1 });
        }
      }
    }
    return ok({
      graph,
      limitations: [...limitations].sort(compareUnicodeCodePoints),
    });
  }

  async #analyzeSwiftTypes(
    input: z.output<typeof enhancedInputSchemas.analyze_swift_types>,
    signal?: AbortSignal,
  ): EnhancedResult {
    const procedures = await this.#allAddressed("list_procedures", signal);
    if (!procedures.ok) return procedures;
    const symbols = await this.#allAddressed("list_names", signal);
    if (!symbols.ok && !permitsCapabilityFallback(symbols.error))
      return symbols;
    const result = categorizeSwiftTypes(
      procedures.value,
      input,
      symbols.ok ? symbols.value : [],
    );
    return ok(
      symbols.ok
        ? result
        : {
            ...result,
            symbol_inventory_error: projectAnalysisError(symbols.error),
            limitations: [
              ...result.limitations,
              "The provider's symbol inventory is unavailable; demangled procedures could not be joined to their Swift aliases.",
            ],
          },
    );
  }

  async #findXrefs(name: string, signal?: AbortSignal): EnhancedResult {
    const resolved = await resolveXrefsName(
      this.analysis,
      name,
      signal,
      "find_xrefs_to_name",
    );
    if (!resolved.ok) return resolved;
    if (resolved.value === null)
      return ok({ status: "unresolved", name, reason: "name_not_found" });

    const xrefs = await this.#call(
      "xrefs",
      { address: resolved.value },
      signal,
    );
    if (!xrefs.ok) return xrefs;
    if (
      !Array.isArray(xrefs.value) ||
      xrefs.value.some((xref) => typeof xref !== "string")
    )
      return err(
        new AnalysisOutputError(
          "xrefs",
          "provider returned an invalid address list",
        ),
      );
    return ok({
      status: "resolved",
      name,
      address: resolved.value,
      xrefs: xrefs.value,
    });
  }

  async #binaryOverview(signal?: AbortSignal): EnhancedResult {
    const direct = await this.#call(
      "read_binary_inventory_summary",
      {},
      signal,
    );
    if (direct.ok || !permitsCapabilityFallback(direct.error)) return direct;
    const document = await resolveAnalysisDocument(
      this.analysis,
      undefined,
      signal,
    );
    if (!document.ok) return document;
    const [segmentsResult, proceduresResult, stringsResult] = await Promise.all(
      [
        this.#call("list_segments", {}, signal),
        this.#call("list_procedures", {}, signal),
        this.#call("list_strings", {}, signal),
      ],
    );
    if (!segmentsResult.ok && !permitsCapabilityFallback(segmentsResult.error))
      return segmentsResult;
    if (!proceduresResult.ok) return proceduresResult;
    if (!stringsResult.ok) return stringsResult;

    const segments = segmentsResult.ok
      ? parseSegments(segmentsResult.value)
      : undefined;
    if (segments !== undefined && !segments.ok) return segments;
    const procedureCount = parseNativeInventoryCount(
      proceduresResult.value,
      "list_procedures",
    );
    if (!procedureCount.ok) return procedureCount;
    const stringCount = parseNativeInventoryCount(
      stringsResult.value,
      "list_strings",
    );
    if (!stringCount.ok) return stringCount;

    return ok(
      projectBinaryOverview({
        document: document.value,
        ...(segments?.ok ? { segments: segments.value } : {}),
        procedure_count: procedureCount.value,
        string_count: stringCount.value,
      }),
    );
  }

  async #allAddressed(
    tool: "list_names" | "list_procedures",
    signal?: AbortSignal,
  ) {
    const result = await this.#call(tool, {}, signal);
    if (!result.ok) return result;
    return this.#parseAddressed(tool, result.value);
  }

  #parseAddressed(tool: "list_names" | "list_procedures", value: JsonValue) {
    const parsed = z.array(addressedValueSchema).safeParse(value);
    return parsed.success
      ? ok(
          parsed.data.map(({ address, value: name, objc_class_label }) => ({
            address,
            name,
            ...(objc_class_label === undefined ? {} : { objc_class_label }),
          })),
        )
      : err(
          new AnalysisOutputError(
            tool,
            "provider returned an invalid inventory",
          ),
        );
  }

  async #call(
    name: AnalysisOperation,
    arguments_: Readonly<Record<string, JsonValue>>,
    signal?: AbortSignal,
    selectorOrigin?: ExecutionOptions["selectorOrigin"],
  ): Promise<Result<JsonValue, AnalysisError>> {
    const execution = await this.#observe(
      name,
      arguments_,
      signal,
      selectorOrigin,
    );
    return execution.ok ? ok(execution.value.result) : execution;
  }

  async #observe(
    name: AnalysisOperation,
    arguments_: Readonly<Record<string, JsonValue>>,
    signal?: AbortSignal,
    selectorOrigin?: ExecutionOptions["selectorOrigin"],
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (isAborted(signal))
      return err(new AnalysisCancelledError(name, { cause: signal?.reason }));
    const execution = await this.analysis.execute(name, arguments_, {
      ...(signal === undefined ? {} : { signal }),
      ...(selectorOrigin === undefined ? {} : { selectorOrigin }),
    });
    if (!execution.ok) return execution;
    if (isAborted(signal))
      return err(new AnalysisCancelledError(name, { cause: signal?.reason }));
    return execution;
  }
}

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;
