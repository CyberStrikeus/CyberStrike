import { createAnalysisExecutionEvidence } from "../../domain/analysisObservation.js";
import { permitsCapabilityFallback } from "../CapabilityFallback.js";
import { z } from "zod";
import type {
  AnalysisOperationPort,
  ExecutionOptions,
  ProviderIdentity,
} from "../AnalysisProvider.js";
import { parseRelatedAddresses } from "../../domain/native/nativeObservation.js";
import { referenceKindSchema } from "../../domain/native/nativeReference.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { SourceLimitation } from "../SourceLimitations.js";
import {
  nativeCallClassificationSchema,
  type NativeCallReference,
} from "../../domain/native/nativeCallReference.js";

/** Detailed or partial observations and the untyped fallback share one owner. */
export const NATIVE_CALL_ROUTE_SOURCES = {
  references: "procedure_references",
  callees: "procedure_callees",
} as const;

const limitationsFrom = (
  operation: SourceLimitation["operation"],
  provider: ProviderIdentity,
  limitations: readonly string[],
): SourceLimitation[] =>
  limitations.map((limitation) => ({ provider, operation, limitation }));

const referencesSchema = z.object({
  reference_kinds_available: z.boolean(),
  references: z.array(
    z.object({
      source_address: z.string(),
      target_address: z.string(),
      target_procedure: z.object({ address: z.string() }).nullable(),
      kind: referenceKindSchema,
      call: nativeCallClassificationSchema.exactOptional(),
    }),
  ),
  unresolved_calls: z.array(
    z.object({ address: z.string(), reason: z.string() }),
  ),
});

interface NativeCallRoute {
  readonly address: string;
  readonly site: string;
  readonly relation: "direct_call" | "indirect_call" | "provider_call";
  readonly resolution: "observed" | "resolved" | "ambiguous" | "inferred";
  readonly provider: ProviderIdentity;
  readonly callReference?: NativeCallReference;
}

/** Enumeration failure does not invalidate facts already obtained. */
interface NativeCallRouteRead {
  readonly routes: readonly NativeCallRoute[];
  readonly unknowns: readonly {
    address: string;
    reason: string;
    provider: ProviderIdentity;
  }[];
  readonly limitations: readonly SourceLimitation[];
  readonly outcome: Result<void, AnalysisError>;
}

const observedCallRoutes = (
  references: z.infer<typeof referencesSchema>["references"],
  provider: ProviderIdentity,
): NativeCallRoute[] => {
  const calls = references.filter(({ kind, call }) =>
    kind.available ? kind.call : call !== undefined,
  );
  const countBySite = new Map<string, Set<string>>();
  for (const call of calls) {
    const targets = countBySite.get(call.source_address) ?? new Set<string>();
    targets.add(call.target_address);
    countBySite.set(call.source_address, targets);
  }
  return calls.map((call) => ({
    provider,
    address: call.target_procedure?.address ?? call.target_address,
    site: call.source_address,
    ...(call.call === undefined
      ? {}
      : {
          callReference: {
            ...call.call,
            source_address: call.source_address,
            target_address: call.target_address,
          },
        }),
    relation: !call.kind.available
      ? ("provider_call" as const)
      : call.kind.computed || call.kind.indirect
        ? ("indirect_call" as const)
        : ("direct_call" as const),
    resolution: !call.kind.available
      ? ("observed" as const)
      : (countBySite.get(call.source_address)?.size ?? 0) > 1
        ? ("ambiguous" as const)
        : call.kind.computed || call.kind.indirect
          ? ("resolved" as const)
          : ("observed" as const),
  }));
};

/** Retain available observations while supplementing incomplete kinds with inferred callees. */
export const readNativeCallRoutes = async (
  analysis: AnalysisOperationPort,
  procedure: string,
  signal?: AbortSignal,
  selectorOrigin?: ExecutionOptions["selectorOrigin"],
): Promise<NativeCallRouteRead> => {
  const options = {
    ...(signal === undefined ? {} : { signal }),
    ...(selectorOrigin === undefined ? {} : { selectorOrigin }),
  };
  const execution = await analysis.execute(
    NATIVE_CALL_ROUTE_SOURCES.references,
    { procedure, direction: "outgoing" },
    options,
  );
  const routes: NativeCallRoute[] = [];
  const unknowns: Array<{
    address: string;
    reason: string;
    provider: ProviderIdentity;
  }> = [];
  const limitations: SourceLimitation[] = [];
  const finish = (
    outcome: Result<void, AnalysisError>,
  ): NativeCallRouteRead => ({
    routes,
    unknowns,
    limitations,
    outcome,
  });
  if (execution.ok) {
    limitations.push(
      ...limitationsFrom(
        NATIVE_CALL_ROUTE_SOURCES.references,
        execution.value.provider,
        execution.value.limitations,
      ),
    );
    const parsed = referencesSchema.safeParse(execution.value.result);
    if (!parsed.success)
      return finish(
        err(
          new AnalysisOutputError(
            NATIVE_CALL_ROUTE_SOURCES.references,
            "Invalid typed call references",
            { cause: parsed.error },
          ).retainPartialObservation(
            createAnalysisExecutionEvidence(
              NATIVE_CALL_ROUTE_SOURCES.references,
              { procedure, direction: "outgoing" },
              execution.value,
              "observed",
            ),
          ),
        ),
      );
    // Missing detailed reference flags do not invalidate observed targetless
    // calls. Keep their producing provider even if another provider supplies
    // the fallback callee inventory.
    unknowns.push(
      ...parsed.data.unresolved_calls.map((call) => ({
        ...call,
        provider: execution.value.provider,
      })),
    );
    const references = parsed.data.references;
    routes.push(...observedCallRoutes(references, execution.value.provider));
    if (
      references.every(({ kind }) => kind.available) &&
      (parsed.data.reference_kinds_available || references.length > 0)
    )
      return finish(ok(undefined));
  } else if (!permitsCapabilityFallback(execution.error))
    return finish(err(execution.error));
  const callees = await analysis.execute(
    NATIVE_CALL_ROUTE_SOURCES.callees,
    { procedure },
    options,
  );
  if (!callees.ok) return finish(err(callees.error));
  limitations.push(
    ...limitationsFrom(
      NATIVE_CALL_ROUTE_SOURCES.callees,
      callees.value.provider,
      callees.value.limitations,
    ),
  );
  const parsed = parseRelatedAddresses(callees.value.result, "callees");
  if (!parsed.ok) {
    parsed.error.retainPartialObservation(
      createAnalysisExecutionEvidence(
        NATIVE_CALL_ROUTE_SOURCES.callees,
        { procedure },
        callees.value,
        "observed",
      ),
    );
    return finish(err(parsed.error));
  }
  // Keep every observed call site. A target-only fallback cannot replace one,
  // and repeated fallback targets add no new observation.
  const targets = new Set(routes.map(({ address }) => address));
  for (const address of parsed.value) {
    if (targets.has(address)) continue;
    targets.add(address);
    routes.push({
      address,
      site: procedure,
      relation: "provider_call",
      resolution: "inferred",
      provider: callees.value.provider,
    });
  }
  return finish(ok(undefined));
};
