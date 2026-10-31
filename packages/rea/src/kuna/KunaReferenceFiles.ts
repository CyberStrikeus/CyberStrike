import { createHash } from "node:crypto";

import { z } from "zod";

import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { err, ok, type Result } from "../domain/result.js";
import { compareKunaAddresses } from "./KunaAddress.js";
import { KunaDocumentError } from "./KunaDocumentError.js";
import { parseKunaJson } from "./KunaJson.js";
import { KunaJsonDocumentReader, parseKunaRow } from "./KunaJsonStream.js";

/** The raw xref budget also bounds its materialized rows. */
export const KUNA_XREF_OUTPUT_BYTES = 16 * 1024 * 1024;

const addressKeys = new Set(["address", "from_address", "to_address"]);
const address = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/u);
const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const kind = z.enum(["call", "jump", "data", "read", "write"]);

const graphHeader = z.object({
  schemaVersion: z.literal(4),
  binary: z.object({
    sourcePath: z.string(),
    functionCount: count,
    edgeCount: count,
  }),
});
const graphNode = z.object({
  address,
  name: z.string().min(1),
  kind: z.string().min(1),
  hasIndirectCalls: z.boolean(),
  forwardsTo: address.nullable(),
  codeC: z.null(),
  assembly: z.null(),
  error: z.null(),
});
const graphEdge = z.object({
  callerAddress: address,
  calleeAddress: address,
  kind,
  calleeOrder: count,
});

export type KunaGraphNode = z.infer<typeof graphNode>;
export interface KunaCallGraph {
  readonly sha256: string;
  readonly bytes: number;
  readonly edgeCount: number;
  readonly hasIndirectCalls: boolean;
  readonly nodes: ReadonlyMap<string, KunaGraphNode>;
  readonly callers: ReadonlyMap<string, readonly string[]>;
  readonly callees: ReadonlyMap<string, readonly string[]>;
}

const fieldsOf = (schema: z.ZodObject, excluded: readonly string[]) =>
  new Set(Object.keys(schema.shape).filter((key) => !excluded.includes(key)));

const GRAPH_DOCUMENT = {
  header: new Set(["schemaVersion"]),
  sections: new Map([
    ["binary", new Set(Object.keys(graphHeader.shape.binary.shape))],
  ]),
  rows: new Map([
    [
      "functions",
      {
        fields: fieldsOf(graphNode, [
          "address",
          "forwardsTo",
          "codeC",
          "assembly",
          "error",
        ]),
        addresses: new Set(["address", "forwardsTo"]),
        empty: new Set<string>(),
        // `--functions ''` requests no bodies; one is refused unassembled.
        nulls: new Set(["codeC", "assembly", "error"]),
      },
    ],
    [
      "edges",
      {
        fields: fieldsOf(graphEdge, ["callerAddress", "calleeAddress"]),
        addresses: new Set(["callerAddress", "calleeAddress"]),
        empty: new Set<string>(),
        nulls: new Set<string>(),
      },
    ],
  ]),
};

/**
 * Validates `kuna decompile-graph --functions ''` as Kuna writes it and
 * retains only the facts call queries use.
 */
export class KunaCallGraphReader extends KunaJsonDocumentReader<KunaCallGraph> {
  readonly #nodes = new Map<string, KunaGraphNode>();
  /** Callees of every edge by caller, which also detects repeated edges. */
  readonly #targets = new Map<string, Set<string>>();
  /** Callee orders by caller; each caller's must be 0..n-1. */
  readonly #orders = new Map<string, Set<number>>();
  readonly #callers = new Map<string, string[]>();
  readonly #callees = new Map<string, string[]>();
  #edgeCount = 0;
  #hasIndirectCalls = false;

  constructor() {
    super("kuna:call-graph", "Kuna's call graph", GRAPH_DOCUMENT);
  }

  override finish(input: string): Result<KunaCallGraph, AnalysisError> {
    const completed = this.complete();
    if (!completed.ok) return completed;
    const header = graphHeader.safeParse(completed.value.header);
    if (!header.success)
      return err(this.unusable("the graph header is not Kuna's schema 4"));
    if (header.data.binary.sourcePath !== input)
      return err(this.unusable("graph names a different input"));
    if (
      header.data.binary.functionCount !== this.#nodes.size ||
      header.data.binary.edgeCount !== this.#edgeCount
    )
      return err(this.unusable("graph counts disagree with examined rows"));
    const invalid = this.#invalidEdges();
    // These indexes only validate edges; queries never read them.
    this.#targets.clear();
    this.#orders.clear();
    if (invalid !== undefined) return err(this.unusable(invalid));
    for (const index of [this.#callers, this.#callees])
      for (const list of index.values()) list.sort(compareKunaAddresses);
    return ok({
      nodes: this.#nodes,
      callers: this.#callers,
      callees: this.#callees,
      edgeCount: this.#edgeCount,
      hasIndirectCalls: this.#hasIndirectCalls,
      bytes: completed.value.bytes,
      sha256: completed.value.sha256,
    });
  }

  protected override acceptRow(
    member: string,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    if (member === "edges") {
      this.#index(parseKunaRow(graphEdge, "graph edge", fields));
      return;
    }
    const node = parseKunaRow(graphNode, "graph function", fields);
    if (this.#nodes.has(node.address))
      throw new KunaDocumentError("repeated_function");
    this.#nodes.set(node.address, node);
    this.#hasIndirectCalls ||= node.hasIndirectCalls;
  }

  protected override discardRows(): void {
    for (const index of [
      this.#nodes,
      this.#targets,
      this.#orders,
      this.#callers,
      this.#callees,
    ])
      index.clear();
  }

  /**
   * Index one edge as it arrives, so the working set grows under the row
   * admission instead of after it; endpoints are checked once every node is
   * known.
   */
  #index(edge: z.infer<typeof graphEdge>): void {
    const { callerAddress: caller, calleeAddress: callee } = edge;
    this.#edgeCount += 1;
    const targets = this.#targets.get(caller) ?? new Set<string>();
    if (targets.has(callee)) throw new KunaDocumentError("repeated_edge");
    targets.add(callee);
    this.#targets.set(caller, targets);
    const order = this.#orders.get(caller) ?? new Set<number>();
    if (order.has(edge.calleeOrder))
      throw new KunaDocumentError("repeated_callee_order");
    order.add(edge.calleeOrder);
    this.#orders.set(caller, order);
    if (edge.kind !== "call") return;
    const incoming = this.#callers.get(callee) ?? [];
    incoming.push(caller);
    this.#callers.set(callee, incoming);
    const outgoing = this.#callees.get(caller) ?? [];
    outgoing.push(callee);
    this.#callees.set(caller, outgoing);
  }

  /** Why the edges contradict the nodes, if they do. */
  #invalidEdges(): string | undefined {
    for (const [caller, targets] of this.#targets) {
      if (!this.#nodes.has(caller)) return "graph edge has an unknown endpoint";
      for (const callee of targets)
        if (!this.#nodes.has(callee))
          return "graph edge has an unknown endpoint";
    }
    for (const order of this.#orders.values())
      for (let index = 0; index < order.size; index += 1)
        if (!order.has(index)) return "graph callee orders are incomplete";
    return undefined;
  }
}

const xrefFunction = z.object({
  name: z.string().min(1),
  address,
  address_hex: address,
});
const xrefRow = z.object({
  address,
  address_hex: address,
  kind,
  from_address: address,
  from_address_hex: address,
  to_address: address,
  to_address_hex: address,
  from_function: xrefFunction.nullable(),
  to_function: xrefFunction.nullable(),
  instruction: z.string(),
});
const xrefsDocument = z.object({
  binary: z.string(),
  direction: z.literal("to"),
  count,
  target: z.object({
    address,
    address_hex: address,
    name: z.string().nullable(),
    aliases: z.array(xrefFunction),
  }),
  xrefs: z.array(z.unknown()),
});

export interface KunaIncomingReferences {
  readonly addresses: readonly string[];
  readonly sha256: string;
  readonly bytes: number;
  readonly rows: number;
  readonly excludedAliasRows: number;
}

/** Code from incoming-reference admission, plus the address field when one failed. */
export interface KunaIncomingReferenceError {
  readonly code: string;
  readonly field?: string;
}

/** Native --to unifies forwarding aliases; REA xrefs asks for the exact address. */
export const parseKunaIncomingReferences = (
  text: string,
  input: string,
  target: string,
): Result<KunaIncomingReferences, KunaIncomingReferenceError> => {
  try {
    const document = xrefsDocument.parse(
      parseKunaJson(text, KUNA_XREF_OUTPUT_BYTES, addressKeys),
    );
    if (
      document.binary !== input ||
      document.target.address !== target ||
      document.target.address_hex !== target
    )
      throw new KunaDocumentError("xref_identity");
    if (document.count !== document.xrefs.length)
      throw new KunaDocumentError("xref_count");
    const aliases = new Set([target]);
    for (const alias of document.target.aliases) {
      if (alias.address !== alias.address_hex)
        throw new KunaDocumentError("xref_alias_hex");
      aliases.add(alias.address);
    }
    const addresses = new Set<string>();
    let excludedAliasRows = 0;
    for (const raw of document.xrefs) {
      const row = xrefRow.parse(raw);
      if (
        row.address !== row.address_hex ||
        row.address !== row.from_address ||
        row.from_address !== row.from_address_hex ||
        row.to_address !== row.to_address_hex
      )
        throw new KunaDocumentError("xref_endpoints");
      for (const fn of [row.from_function, row.to_function])
        if (fn !== null && fn.address !== fn.address_hex)
          throw new KunaDocumentError("xref_function_hex");
      if (!aliases.has(row.to_address))
        throw new KunaDocumentError("xref_target");
      if (row.to_address === target) addresses.add(row.from_address);
      else excludedAliasRows += 1;
    }
    return ok({
      addresses: [...addresses].sort(compareKunaAddresses),
      rows: document.xrefs.length,
      excludedAliasRows,
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  } catch (cause: unknown) {
    if (cause instanceof KunaDocumentError) {
      const field = cause.detail?.field;
      return err(
        typeof field === "string"
          ? { code: cause.code, field }
          : { code: cause.code },
      );
    }
    return err({
      code: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
