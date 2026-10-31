import { rm } from "node:fs/promises";
import { decodeIdaToolResult } from "../../src/ida/IdaMcpConnection.js";
import { IdaSessionClient } from "../../src/ida/IdaSessionClient.js";
import type { JsonValue } from "../../src/domain/jsonValue.js";
import { createIdaTarget, RecordingIdaMcp } from "./idaMcp.js";

const roots: string[] = [];

/** Remove the workspaces of every session opened through `callGraphSession`. */
export const removeCallGraphSessions = async (): Promise<void> => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
};

export const FUNCTIONS: Readonly<
  Record<string, { addr: string; name: string }>
> = {
  main: { addr: "0x1000", name: "main" },
  "0x1000": { addr: "0x1000", name: "main" },
  "0x2000": { addr: "0x2000", name: "square" },
  "0x3000": { addr: "0x3000", name: "printf_stub" },
};

export const edge = (from: string, to: string, type = "call") => ({
  from,
  to,
  type,
});
export const graphRow = (
  edges: readonly ReturnType<typeof edge>[],
  extra: Readonly<Record<string, JsonValue>> = {},
): JsonValue => [
  {
    root: "0x1000",
    nodes: [{ addr: "0x1000", name: "main", depth: 0 }],
    edges: [...edges],
    max_depth: 0,
    truncated: false,
    limit_reason: null,
    max_edges_per_func: 200,
    per_func_capped: false,
    ...extra,
  },
];

/** A realistic reply for a callee that makes no further calls. */
const leafGraphRow = (root: string): JsonValue => [
  {
    root,
    nodes: [{ addr: root, name: FUNCTIONS[root]?.name ?? null, depth: 0 }],
    edges: [],
    max_depth: 0,
    truncated: false,
    limit_reason: null,
    max_edges_per_func: 200,
    per_func_capped: false,
  },
];

export interface Upstream {
  /** Roots, besides the procedure itself, that the fake answers with a leaf graph; any other root is rejected. */
  readonly leafRoots?: readonly string[];
  /** Advertise the fake server's tools; omit for the default full set. */
  readonly tools?: readonly string[];
  /** Items the fake `callees` tool reports for the procedure. */
  readonly callees: readonly JsonValue[];
  /** Raw `callgraph` reply, or undefined when the tool is absent/failing. */
  readonly callgraph?: JsonValue;
  readonly callgraphFailure?: string;
  /** Make the fake transport report a truncated preview for the `callgraph` reply. */
  readonly callgraphTruncatedOutput?: boolean;
}

export const callGraphSession = async (
  upstream: Upstream,
  architecture: "x86_64" | "arm64" = "arm64",
  available: readonly ("x86_64" | "arm64")[] = [architecture],
) => {
  const { root, target } = await createIdaTarget(architecture, available);
  roots.push(root);
  const producer = new RecordingIdaMcp(target, "headless");
  if (upstream.tools !== undefined) producer.tools = upstream.tools;
  producer.beforeCall = async (name) => {
    if (name !== "callgraph") return;
    if (upstream.callgraphFailure !== undefined)
      decodeIdaToolResult({
        content: [{ type: "text", text: upstream.callgraphFailure }],
        isError: true,
      });
    if (upstream.callgraphTruncatedOutput === true)
      decodeIdaToolResult({
        content: [{ type: "text", text: "preview" }],
        _meta: { ida_mcp: { output_truncated: true } },
      });
  };
  producer.overrideCall = (name, args): JsonValue | undefined => {
    if (name === "lookup_funcs") {
      const queries = args.queries;
      const addresses = Array.isArray(queries) ? queries.map(String) : [];
      return addresses.map((query) => {
        const fn = FUNCTIONS[query];
        return fn === undefined
          ? { query, fn: null, error: "Not found" }
          : { query, fn: { ...fn, size: "0x20" }, error: null };
      });
    }
    if (name === "callees")
      return [{ callees: [...upstream.callees], more: false }];
    if (name === "callgraph") {
      const requested = Array.isArray(args.roots) ? args.roots : [];
      const rootKnown =
        JSON.stringify(requested) === JSON.stringify(["0x1000"]) ||
        (requested.length === 1 &&
          upstream.leafRoots?.includes(String(requested[0])) === true);
      if (!rootKnown || args.max_depth !== 0)
        throw new Error(
          `Unexpected callgraph request: ${JSON.stringify(args)}`,
        );
      return String(requested[0]) === "0x1000"
        ? upstream.callgraph
        : leafGraphRow(String(requested[0]));
    }
    return undefined;
  };
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode: "headless",
      timeoutMs: 1000,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { client, producer };
};
