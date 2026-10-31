import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { FunctionDossier } from "../domain/native/functionDossier.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import { kunaProjectDeadline } from "./KunaConfiguration.js";
import type { KunaInstallation } from "./KunaInstallation.js";
import {
  KUNA_XREF_OUTPUT_BYTES,
  KunaCallGraphReader,
  parseKunaIncomingReferences,
  type KunaCallGraph,
  type KunaGraphNode,
  type KunaIncomingReferences,
} from "./KunaReferenceFiles.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";
import type { KunaPendingQuery, KunaQueryWork } from "./KunaQueryWork.js";
import { kunaUnavailable } from "./KunaUnavailable.js";

/** Charge raw JSON bytes conservatively; retained projections are smaller. */
const XREF_CACHE_BYTES = 16 * 1024 * 1024;
/** Also bound metadata for empty results and queued native queries. */
const XREF_CACHE_ENTRIES = 128;
const PENDING_XREF_QUERIES = 8;

export interface KunaFunctionRelationships {
  readonly callers: readonly FunctionDossier["callers"][number][];
  readonly callees: readonly FunctionDossier["callees"][number][];
  readonly source: JsonValue;
  readonly callersCoverage: RelationshipCoverage;
  readonly calleesCoverage: RelationshipCoverage;
}

/** Lazy session facts, shared producers and bounded exact-address xref reuse. */
export class KunaReferenceQueries {
  #graph: KunaCallGraph | undefined;
  /** Deterministic buffer failures belong to the same session as its graph. */
  #graphFailure: AnalysisError | undefined;
  #pendingGraph: KunaPendingQuery<KunaCallGraph> | undefined;
  readonly #xrefs = new Map<string, KunaIncomingReferences>();
  readonly #pendingXrefs = new Map<
    string,
    KunaPendingQuery<KunaIncomingReferences>
  >();
  #xrefBytes = 0;
  constructor(private readonly work: KunaQueryWork) {}

  async relationships(
    installation: KunaInstallation,
    address: string,
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaFunctionRelationships, AnalysisError>> {
    const graph = await this.#loadGraph(installation, operation, signal);
    return graph.ok
      ? this.#relationships(graph.value, address, operation)
      : graph;
  }

  /** Only a validated graph can establish that an inventory-missing entry exists. */
  async functionAt(
    installation: KunaInstallation,
    address: string,
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<
    Result<
      { readonly address: string; readonly source: JsonValue } | undefined,
      AnalysisError
    >
  > {
    const graph = await this.#loadGraph(installation, operation, signal);
    if (!graph.ok) return graph;
    const node = graph.value.nodes.get(address);
    return ok(
      node === undefined
        ? undefined
        : {
            address: node.address,
            source: this.#source(graph.value, node),
          },
    );
  }

  async #loadGraph(
    installation: KunaInstallation,
    operation: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaCallGraph, AnalysisError>> {
    if (this.#graphFailure !== undefined) return err(this.#graphFailure);
    if (this.#graph === undefined) {
      if (this.#pendingGraph?.signal.aborted === true) {
        const retired = await this.work.wait(
          this.#pendingGraph,
          signal,
          operation,
        );
        if (!retired.ok && !(retired.error instanceof AnalysisCancelledError))
          return retired;
        if (signal?.aborted === true)
          return err(
            new AnalysisCancelledError(operation, { cause: signal?.reason }),
          );
        return this.#loadGraph(installation, operation, signal);
      }
      if (this.#pendingGraph === undefined) {
        const pending = this.work.start<KunaCallGraph>(
          (producerSignal) =>
            this.work.scan(
              {
                installation,
                operation: "kuna:call-graph",
                arguments: (input) => [
                  "decompile-graph",
                  input,
                  "--functions",
                  "",
                ],
                deadline: kunaProjectDeadline(installation.configuration),
              },
              new KunaCallGraphReader(),
              producerSignal,
              (failure) => {
                this.#graphFailure = failure;
              },
            ),
          (value) => {
            this.#graph = value;
          },
        );
        this.#pendingGraph = pending;
        const release = () => {
          if (this.#pendingGraph === pending) this.#pendingGraph = undefined;
        };
        void pending.promise.then(release, release);
      }
      return this.work.wait(this.#pendingGraph, signal, operation);
    }
    return ok(this.#graph);
  }

  #relationships(
    graph: KunaCallGraph,
    address: string,
    operation: string,
  ): Result<KunaFunctionRelationships, AnalysisError> {
    const node = graph.nodes.get(address);
    if (node === undefined)
      return err(
        kunaUnavailable(
          operation,
          `Kuna's graph has no function node at ${address}; its relationships are unknown.`,
        ),
      );
    const identities = (
      addresses: readonly string[],
    ): readonly FunctionDossier["callers"][number][] =>
      addresses.map((entryAddress) => {
        const entry = graph.nodes.get(entryAddress)!; // The parser proved both endpoints.
        return {
          address: entry.address,
          name: entry.name,
          classification: null,
          body: {
            available: false,
            reason: "Kuna's graph reports no observed body ranges.",
          },
        };
      });
    return ok({
      callers: identities(graph.callers.get(address) ?? []),
      callees: identities(graph.callees.get(address) ?? []),
      callersCoverage: graph.hasIndirectCalls
        ? {
            status: "partial",
            limited_directions: ["callers"],
            limitations: [
              "Kuna reports unresolved indirect calls in the image; additional callers cannot be excluded.",
            ],
          }
        : { status: "complete" },
      calleesCoverage: node.hasIndirectCalls
        ? {
            status: "partial",
            limited_directions: ["callees"],
            limitations: [
              "Kuna reports indirect calls in this function without every target; additional callees remain unknown.",
            ],
          }
        : { status: "complete" },
      source: this.#source(graph, node),
    });
  }

  #source(graph: KunaCallGraph, node: KunaGraphNode): JsonValue {
    return {
      kind: "kuna-call-graph",
      schema_version: 4,
      sha256: graph.sha256,
      bytes: graph.bytes,
      functions: graph.nodes.size,
      edges: graph.edgeCount,
      has_indirect_calls: graph.hasIndirectCalls,
      function: {
        address: node.address,
        has_indirect_calls: node.hasIndirectCalls,
        forwards_to: node.forwardsTo,
        forwarding_target_in_graph:
          node.forwardsTo === null ? null : graph.nodes.has(node.forwardsTo),
      },
    };
  }

  async incoming(
    installation: KunaInstallation,
    address: string,
    signal: AbortSignal | undefined,
  ): Promise<Result<KunaIncomingReferences, AnalysisError>> {
    const cached = this.#xrefs.get(address);
    if (cached !== undefined) {
      this.#xrefs.delete(address);
      this.#xrefs.set(address, cached);
      return ok(cached);
    }
    let pending = this.#pendingXrefs.get(address);
    if (pending?.signal.aborted === true) {
      const retired = await this.work.wait(pending, signal, "xrefs");
      if (!retired.ok && !(retired.error instanceof AnalysisCancelledError))
        return retired;
      if (signal?.aborted === true)
        return err(
          new AnalysisCancelledError("xrefs", { cause: signal?.reason }),
        );
      return this.incoming(installation, address, signal);
    }
    if (pending === undefined) {
      if (this.#pendingXrefs.size >= PENDING_XREF_QUERIES)
        return err(
          new AnalysisResourceConstraintError(
            "xrefs",
            "capacity",
            "The session's native reference-query queue is full; await an existing query before starting another.",
            { limit_queries: PENDING_XREF_QUERIES },
          ),
        );
      pending = this.work.start<KunaIncomingReferences>(
        async (producerSignal) => {
          const run = await this.work.run({
            installation,
            operation: "xrefs",
            arguments: (input) => ["xrefs", input, "--to", address, "--json"],
            deadline: kunaProjectDeadline(installation.configuration),
            outputBytes: KUNA_XREF_OUTPUT_BYTES,
            signal: producerSignal,
          });
          if (!run.ok) return run;
          return this.#parsed(
            parseKunaIncomingReferences(
              run.value.stdout.text,
              run.value.input,
              address,
            ),
            "incoming references",
          );
        },
        (value) => this.#cache(address, value),
      );
      this.#pendingXrefs.set(address, pending);
      const current = pending;
      const release = () => {
        if (this.#pendingXrefs.get(address) === current)
          this.#pendingXrefs.delete(address);
      };
      void pending.promise.then(release, release);
    }
    return this.work.wait(pending, signal, "xrefs");
  }

  #cache(address: string, value: KunaIncomingReferences): void {
    this.#xrefs.set(address, value);
    this.#xrefBytes += value.bytes + 256;
    while (
      this.#xrefBytes > XREF_CACHE_BYTES ||
      this.#xrefs.size > XREF_CACHE_ENTRIES
    ) {
      const oldest = this.#xrefs.entries().next().value;
      if (oldest === undefined) break;
      this.#xrefs.delete(oldest[0]);
      this.#xrefBytes -= oldest[1].bytes + 256;
    }
  }

  /** Release parsed facts after the session has drained all owned producers. */
  clear(): void {
    this.#graph = undefined;
    this.#graphFailure = undefined;
    this.#pendingGraph = undefined;
    this.#xrefs.clear();
    this.#pendingXrefs.clear();
    this.#xrefBytes = 0;
  }

  #parsed<T>(
    parsed: Result<
      T,
      { readonly code: string; readonly field?: string | undefined }
    >,
    label: string,
  ): Result<T, AnalysisError> {
    if (parsed.ok) return parsed;
    const { code, field } = parsed.error;
    return err(
      new ProviderAdapterError(KUNA_PROVIDER_ID, "kuna:references", {
        diagnostics: {
          code,
          ...(field === undefined ? {} : { field }),
        },
        userMessage: `Kuna's ${label} cannot be used: ${code}`,
      }),
    );
  }
}
