import type { CallRelationshipDirection } from "../contracts/enhancedInputs.js";
import { CALL_RELATIONSHIP_TRAVERSALS } from "./CallRelationshipTraversal.js";
import type {
  AnalysisExecution,
  AnalysisOperation,
  ExecutionOptions,
} from "./AnalysisProvider.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { parseRelatedAddresses } from "../domain/native/nativeObservation.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok, type Result } from "../domain/result.js";
import type { EnhancedResult } from "./EnhancedToolTypes.js";
import { resolveProcedureAddress } from "./ProcedureAddressResolution.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";

type AnalysisCall = (
  name: AnalysisOperation,
  arguments_: Readonly<Record<string, JsonValue>>,
  signal?: AbortSignal,
  selectorOrigin?: ExecutionOptions["selectorOrigin"],
) => Promise<Result<JsonValue, AnalysisError>>;

type RelationshipCall = (
  name: AnalysisOperation,
  arguments_: Readonly<Record<string, JsonValue>>,
  signal?: AbortSignal,
  selectorOrigin?: ExecutionOptions["selectorOrigin"],
) => Promise<Result<AnalysisExecution, AnalysisError>>;

export interface CallPathTraceInput {
  readonly start: string;
  readonly goal?: string | undefined;
  readonly direction: CallRelationshipDirection;
}

interface TraceNode {
  readonly address: string;
  readonly depth: number;
  readonly parent: TraceNode | undefined;
}

interface TraceState {
  readonly visited: Map<string, TraceNode>;
  readonly queue: string[];
  readonly edges: Map<
    string,
    {
      readonly source_address: string;
      readonly target_address: string;
      readonly discovery_depth: number;
    }
  >;
  readonly failures: Array<{
    readonly address: string;
    readonly error: ReturnType<typeof projectAnalysisError>;
  }>;
  readonly residual: Set<string>;
  readonly limitations: Set<string>;
  readonly relationshipCoverage: Map<string, RelationshipCoverage>;
  queueIndex: number;
  traversalPath: string[];
}

interface AddressExpansion {
  readonly input: CallPathTraceInput;
  readonly state: TraceState;
  readonly address: string;
  readonly current: TraceNode;
  readonly signal?: AbortSignal;
}

interface DiscoveredEdge {
  readonly address: string;
  readonly relatedAddress: string;
  readonly discoveryDepth: number;
}

/** Trace direct caller/callee relationships until the graph is exhausted or the goal is reached. */
export const traceCallPath = async (
  call: AnalysisCall,
  callRelationship: RelationshipCall,
  input: CallPathTraceInput,
  signal?: AbortSignal,
): EnhancedResult => {
  const start = await resolveProcedureAddress(call, input.start, signal);
  if (!start.ok) return start;
  let goal: string | undefined;
  if (input.goal !== undefined) {
    const resolved = await resolveProcedureAddress(call, input.goal, signal);
    if (!resolved.ok) return resolved;
    goal = resolved.value;
  }
  const resolvedInput = {
    start: start.value,
    ...(goal === undefined ? {} : { goal }),
    direction: input.direction,
  };
  if (isAborted(signal))
    return err(
      new AnalysisCancelledError("trace_call_path", { cause: signal?.reason }),
    );
  const state = createTraceState(resolvedInput);
  while (
    state.queueIndex < state.queue.length &&
    state.traversalPath.length === 0
  ) {
    if (isAborted(signal))
      return err(
        new AnalysisCancelledError("trace_call_path", {
          cause: signal?.reason,
        }),
      );
    const address = state.queue[state.queueIndex++];
    if (address === undefined) break;
    const current = state.visited.get(address);
    if (current === undefined) continue;
    const expanded = await expandAddress(callRelationship, {
      input: resolvedInput,
      state,
      address,
      current,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!expanded.ok) return expanded;
    if (expanded.value) break;
  }
  if (isAborted(signal))
    return err(
      new AnalysisCancelledError("trace_call_path", { cause: signal?.reason }),
    );
  return ok(projectTrace(resolvedInput, state));
};

const createTraceState = (input: CallPathTraceInput): TraceState => ({
  visited: new Map([
    [input.start, { address: input.start, depth: 0, parent: undefined }],
  ]),
  queue: [input.start],
  edges: new Map(),
  failures: [],
  residual: new Set(),
  limitations: new Set(),
  relationshipCoverage: new Map(),
  queueIndex: 0,
  traversalPath: input.goal === input.start ? [input.start] : [],
});

const expandAddress = async (
  call: RelationshipCall,
  expansion: AddressExpansion,
): Promise<Result<boolean, AnalysisError>> => {
  const { input, state, address, current, signal } = expansion;
  const { relation, operation: tool } =
    CALL_RELATIONSHIP_TRAVERSALS[input.direction];
  const result = await call(tool, { procedure: address }, signal, "provider");
  if (!result.ok) {
    if (
      result.error._tag === "AnalysisCancelledError" ||
      signal?.aborted === true
    )
      return result;
  }
  if (isAborted(signal))
    return err(
      new AnalysisCancelledError("trace_call_path", { cause: signal?.reason }),
    );
  if (!result.ok) {
    state.failures.push({
      address,
      error: projectAnalysisError(result.error),
    });
    state.residual.add(`Call relationships were unavailable for ${address}.`);
    return ok(false);
  }
  const related = parseRelatedAddresses(result.value.result, relation, tool);
  if (!related.ok) {
    state.failures.push({
      address,
      error: projectAnalysisError(related.error),
    });
    state.residual.add(`Call relationships were unreadable for ${address}.`);
    return ok(false);
  }
  for (const limitation of result.value.limitations)
    state.limitations.add(limitation);
  const coverage = result.value.relationshipCoverage ?? {
    status: "unknown",
    reason: "Provider did not report relationship coverage.",
  };
  state.relationshipCoverage.set(address, coverage);
  for (const diagnostic of "diagnostics" in coverage &&
  Array.isArray(coverage.diagnostics)
    ? coverage.diagnostics
    : [])
    state.limitations.add(diagnostic);
  if (coverage.status === "partial")
    for (const limitation of coverage.limitations)
      state.residual.add(
        `Call relationships for ${address} are limited: ${limitation}`,
      );
  else if (coverage.status === "unknown")
    state.residual.add(
      `Call relationship coverage is unknown for ${address}: ${coverage.reason}`,
    );
  for (const relatedAddress of sortedUniqueAddresses(related.value)) {
    recordEdge(input, state, {
      address,
      relatedAddress,
      discoveryDepth: current.depth + 1,
    });
    if (state.visited.has(relatedAddress)) continue;
    const discovered: TraceNode = {
      address: relatedAddress,
      depth: current.depth + 1,
      parent: current,
    };
    state.visited.set(relatedAddress, discovered);
    if (relatedAddress === input.goal) {
      state.traversalPath = reconstructPath(discovered);
      return ok(true);
    }
    state.queue.push(relatedAddress);
  }
  return ok(false);
};

/** Only the selected goal needs a path; each discovered node owns one parent link. */
const reconstructPath = (goal: TraceNode): string[] => {
  const path: string[] = [];
  for (let node: TraceNode | undefined = goal; node; node = node.parent)
    path.push(node.address);
  return path.reverse();
};

const recordEdge = (
  input: CallPathTraceInput,
  state: TraceState,
  edge: DiscoveredEdge,
): void => {
  const sourceAddress =
    input.direction === "forward" ? edge.address : edge.relatedAddress;
  const targetAddress =
    input.direction === "forward" ? edge.relatedAddress : edge.address;
  const edgeKey = `${sourceAddress}\u0000${targetAddress}`;
  if (state.edges.has(edgeKey)) return;
  state.edges.set(edgeKey, {
    source_address: sourceAddress,
    target_address: targetAddress,
    discovery_depth: edge.discoveryDepth,
  });
};

const projectTrace = (input: CallPathTraceInput, state: TraceState) => ({
  start: input.start,
  goal: input.goal ?? null,
  direction: input.direction,
  goal_status:
    input.goal === undefined
      ? "not_requested"
      : state.traversalPath.length > 0
        ? "reached"
        : state.residual.size > 0
          ? "unknown"
          : "not_reached",
  nodes: [...state.visited.entries()]
    .map(([address, { depth }]) => ({ address, depth }))
    .sort(
      (left, right) =>
        left.depth - right.depth || compareAddress(left.address, right.address),
    ),
  edges: [...state.edges.values()].sort(
    (left, right) =>
      left.discovery_depth - right.discovery_depth ||
      compareAddress(left.source_address, right.source_address) ||
      compareAddress(left.target_address, right.target_address),
  ),
  traversal_path: state.traversalPath,
  failures: state.failures,
  traversal: {
    nodes_visited: state.visited.size,
  },
  relationship_coverage: Object.fromEntries(
    [...state.relationshipCoverage.entries()].sort(([left], [right]) =>
      compareAddress(left, right),
    ),
  ),
  truncated: state.residual.size > 0,
  residual_unknowns: [...state.residual],
  limitations: [
    "Direct provider call relationships may omit unresolved indirect calls.",
    ...state.limitations,
  ],
});

const compareAddress = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedUniqueAddresses = (addresses: readonly string[]): string[] =>
  [...new Set(addresses)].sort(compareAddress);

const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;
