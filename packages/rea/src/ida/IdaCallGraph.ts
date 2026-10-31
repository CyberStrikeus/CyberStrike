import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { RelationshipCoverage } from "../domain/relationshipCoverage.js";
import { ZodError } from "zod";
import {
  idaAddressSchema,
  modernCallGraphSchema,
  modernLookupBatchSchema,
} from "./IdaProtocolValues.js";

/** The graph only emits edges whose destinations IDA recognizes as functions. */
export const UNRECOGNIZED_CALLEE_LIMITATION =
  "This relationship read does not establish calls to targets IDA does not recognize as functions; imports and other non-function call targets remain unknown.";
const TRUNCATED_LIMITATION =
  "Upstream callgraph was truncated; additional callees remain unknown.";
const POSSIBLY_TRUNCATED_LIMITATION =
  "Upstream callgraph may be truncated; additional callees may remain unknown.";
const expectedReadFailure = (cause: unknown): boolean =>
  cause instanceof AnalysisProtocolError ||
  cause instanceof AnalysisOutputError ||
  cause instanceof ZodError;

const errorReason = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown upstream read failure";

const X86_FAMILIES: ReadonlySet<string> = new Set(["x86", "x86_64"]);

/**
 * True only when every slice the file can load is x86-family. Upstream `callees`
 * recognises x86 call instructions only, so any other or unproven processor
 * must use the processor-neutral call graph for function edges.
 */
export const isX86OnlyTarget = (target: BinaryTarget): boolean =>
  target.kind === "executable" &&
  // IDA can load a managed PE with the CLI loader instead of as x86 code.
  !(target.format === "pe" && target.managed) &&
  X86_FAMILIES.has(target.architecture) &&
  target.availableArchitectures.every((family) => X86_FAMILIES.has(family));

/** Callees observed in a root-only call graph, with what stays unknown. */
export interface CallGraphCallees {
  readonly callees: readonly {
    readonly address: string;
    readonly name: string;
  }[];
  readonly limitations: readonly string[];
  readonly coverage: RelationshipCoverage;
}

/** No function edges can be observed when the server lacks the graph tool. */
export const unavailableCallGraph = (reason: string): CallGraphCallees => ({
  callees: [],
  limitations: [
    UNRECOGNIZED_CALLEE_LIMITATION,
    `Upstream callgraph was unavailable (${reason}); callee edges remain unknown.`,
  ],
  coverage: {
    status: "unknown",
    reason: `Upstream callgraph was unavailable (${reason}); callee edges remain unknown.`,
    diagnostics: [UNRECOGNIZED_CALLEE_LIMITATION],
  },
});

/**
 * Read only the outgoing call edges of one procedure from upstream `callgraph`.
 * `max_depth: 0` includes the root's edges without scanning child functions.
 * Any failure to obtain a consistent root graph is a producer fault that
 * fails the read, like a failing `callees` request: a tool error, a truncated
 * transport reply, an error row, an unreadable reply and a reply for another
 * root all fail the read. Cancellation still propagates. Truncation the upstream
 * declares inside a valid reply stays a limitation.
 */
export const readCallGraphCallees = async (
  call: (
    tool: string,
    args: Readonly<Record<string, JsonValue>>,
  ) => Promise<JsonValue>,
  address: string,
): Promise<CallGraphCallees> => {
  const raw = await call("callgraph", { roots: [address], max_depth: 0 });
  const parsed = modernCallGraphSchema.safeParse(raw);
  const row = parsed.success ? parsed.data[0] : undefined;
  if (row === undefined)
    throw new AnalysisProtocolError("IDA callgraph reply was unreadable.");
  if (row.error !== undefined)
    throw new AnalysisProtocolError(`IDA callgraph failed: ${row.error}`);
  const rootAddress = idaAddressSchema.safeParse(row.root);
  if (!rootAddress.success || rootAddress.data !== address)
    throw new AnalysisProtocolError(
      `IDA callgraph answered for a different root than ${address}.`,
    );

  const edges = row.edges.filter(
    ({ type, from }) => type === "call" && from === address,
  );
  const targets = [...new Set(edges.map(({ to }) => to))].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
  );
  const limitations = [UNRECOGNIZED_CALLEE_LIMITATION];
  const diagnostics = [UNRECOGNIZED_CALLEE_LIMITATION];
  const coverageLimitations: string[] = [];
  const truncated =
    row.truncated === true ||
    row.per_func_capped === true ||
    (row.limit_reason ?? null) !== null;
  // Reaching the per-function cap can stop the root scan without setting a
  // truncation flag, so a saturated root count is possible truncation.
  const saturated =
    row.max_edges_per_func !== undefined &&
    edges.length >= row.max_edges_per_func;
  if (truncated) {
    limitations.push(TRUNCATED_LIMITATION);
    coverageLimitations.push(TRUNCATED_LIMITATION);
  } else if (saturated) {
    limitations.push(POSSIBLY_TRUNCATED_LIMITATION);
    coverageLimitations.push(POSSIBLY_TRUNCATED_LIMITATION);
  }

  const names = new Map<string, string>();
  if (targets.length > 0) {
    try {
      const raw = await call("lookup_funcs", { queries: targets });
      const parsed = modernLookupBatchSchema.safeParse(raw);
      if (!parsed.success) {
        const limitation =
          "IDA observed callee addresses but returned an unreadable name lookup result; the addresses are retained.";
        limitations.push(limitation);
        diagnostics.push(limitation);
      } else {
        const rows = new Map<string, (typeof parsed.data)[number] | null>();
        for (const item of parsed.data) {
          const query = idaAddressSchema.safeParse(item.query);
          if (!query.success || !targets.includes(query.data)) continue;
          rows.set(query.data, rows.has(query.data) ? null : item);
        }
        for (const target of targets) {
          const item = rows.get(target);
          if (item?.fn?.address === target && item.error === null)
            names.set(target, item.fn.name);
          else {
            const limitation = `IDA observed callee address ${target} but could not resolve its name${item?.error == null ? "" : `: ${item.error}`}; the address is retained.`;
            limitations.push(limitation);
            diagnostics.push(limitation);
          }
        }
      }
    } catch (cause: unknown) {
      if (cause instanceof AnalysisCancelledError) throw cause;
      if (!expectedReadFailure(cause)) throw cause;
      const limitation = `IDA observed callee addresses but the name lookup failed (${errorReason(cause)}); the addresses are retained.`;
      limitations.push(limitation);
      diagnostics.push(limitation);
    }
  }
  return {
    callees: targets.map((to) => {
      return {
        address: to,
        name: names.get(to) ?? to,
      };
    }),
    limitations,
    coverage: {
      ...(coverageLimitations.length === 0
        ? { status: "complete" as const }
        : {
            status: "partial" as const,
            limitations: coverageLimitations,
          }),
      diagnostics,
    },
  };
};
