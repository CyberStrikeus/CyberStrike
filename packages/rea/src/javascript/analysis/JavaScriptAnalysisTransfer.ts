import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { z } from "zod";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import type { JsonValue } from "../../domain/jsonValue.js";

import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptModuleSemanticIr } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import {
  JAVASCRIPT_PARENT_HEAP_NODE_OPTIONS,
  JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES,
  JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
} from "../../domain/javascript/javascriptAnalysisResourceControls.js";
import type {
  JavaScriptSemanticFileProjection,
  JavaScriptSemanticProjectionCapacity,
} from "../../domain/javascript/javascriptSemanticFileProjection.js";
import { digestSchema } from "../../domain/digests.js";
import {
  javaScriptWorkerGraphRecordSchema,
  javaScriptWorkerModuleHeaderSchema,
  javaScriptWorkerModuleRecordSchema,
  javaScriptWorkerProjectionHeaderSchema,
} from "./JavaScriptAnalysisWorkerSchemas.js";

// Budgets bound transfer representation, independently of source length.
export { JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES } from "../../domain/javascript/javascriptAnalysisResourceControls.js";
const FRAME_BYTES = JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES;
const TRANSFER_BYTES = 512 * 1024 * 1024;
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024 * 1024;
const BATCH_BYTES = 1024 * 1024;
const recordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("projection-header"),
    value: javaScriptWorkerProjectionHeaderSchema,
  }),
  z.strictObject({
    kind: z.literal("module-header"),
    value: javaScriptWorkerModuleHeaderSchema,
  }),
  ...javaScriptWorkerGraphRecordSchema.options,
  ...javaScriptWorkerModuleRecordSchema.options,
]);

/** Complete-file coordinates authenticated before adopting any worker facts. */
export const javaScriptAnalysisTransferDescriptorSchema = z.strictObject({
  bytes: z.int().nonnegative().max(MAX_TRANSFER_BYTES),
  sha256: digestSchema,
  records: z.int().nonnegative(),
  module_bytes: z.int().nonnegative(),
  module_records: z.int().nonnegative(),
  graph_bytes: z.int().nonnegative(),
  graph_records: z.int().nonnegative(),
});
type Descriptor = z.output<typeof javaScriptAnalysisTransferDescriptorSchema>;

/** Conservative retained-object and sealing expansion for validated transfer rows. */
export const javaScriptTransferRetentionBytes = (
  bytes: number,
  records: number,
): number => bytes * 8 + records * 64;

/** Larger streamed files require corresponding parent admission capacity. */
export const javaScriptTransferByteBudget = (
  resultBudgetBytes: number,
): number =>
  Math.min(
    MAX_TRANSFER_BYTES,
    Math.max(TRANSFER_BYTES, Math.floor(resultBudgetBytes / 8)),
  );

/**
 * The record ceiling and the 2 GiB file maximum are fixed. The effective file
 * ceiling follows the parent offered result budget and can rise until that maximum.
 */
export const javaScriptTransferCeilingRemediation = (
  transferFileBytes: number | undefined,
): string => {
  const recordBytes = String(JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES);
  const maximumBytes = String(MAX_TRANSFER_BYTES);
  const fixed = `The ${recordBytes}-byte transfer record ceiling and the ${maximumBytes}-byte transfer file maximum have no runtime override. Raising max_heap_mb does not raise either fixed ceiling. A request that exceeds the record ceiling or that maximum fails the same way when repeated unchanged.`;
  const adjustable = `${JAVASCRIPT_PARENT_HEAP_NODE_OPTIONS} to raise the effective file ceiling up to ${maximumBytes} bytes. Selecting fewer source_paths can also raise this effective file allowance, because earlier retained results and the reserve for remaining sources reduce the offered budget. Neither change raises the record ceiling or the maximum.`;
  if (
    transferFileBytes !== undefined &&
    transferFileBytes >= MAX_TRANSFER_BYTES
  )
    return `${fixed} The effective transfer file ceiling is the ${maximumBytes}-byte maximum. Selecting fewer source_paths does not raise the record ceiling or that maximum.`;
  const effective =
    transferFileBytes === undefined
      ? "The effective transfer file ceiling follows the parent offered result budget, which follows the CLI/MCP process heap, and can be lower than the maximum."
      : `The effective transfer file ceiling is ${String(transferFileBytes)} bytes. It follows the parent offered result budget, which follows the CLI/MCP process heap.`;
  return `${fixed} ${effective} ${adjustable}`;
};

/** Reattach transfer recovery after a worker protocol frame drops remediation. */
export const javaScriptForwardedTransferRemediation = (
  limits: Readonly<Record<string, JsonValue>> | null,
): string | undefined => {
  const transferFileBytes = limits?.transfer_file_bytes;
  if (
    typeof limits?.transfer_record_bytes !== "number" &&
    typeof transferFileBytes !== "number"
  )
    return undefined;
  return javaScriptTransferCeilingRemediation(
    typeof transferFileBytes === "number" ? transferFileBytes : undefined,
  );
};

const javaScriptTransferCeilingReason = (
  recordBytes: number,
  transferFileBytes: number,
): string =>
  recordBytes > FRAME_BYTES
    ? `A complete JavaScript fact exceeds the ${String(FRAME_BYTES)}-byte transfer record ceiling. This release has no runtime override.`
    : transferFileBytes >= MAX_TRANSFER_BYTES
      ? `Complete JavaScript file facts exceed the ${String(MAX_TRANSFER_BYTES)}-byte transfer file maximum. This release has no runtime override.`
      : `Complete JavaScript file facts exceed the effective transfer file ceiling of ${String(transferFileBytes)} bytes (maximum ${String(MAX_TRANSFER_BYTES)} bytes). That effective ceiling follows the parent offered result budget and can rise until the maximum. The record ceiling and that maximum have no runtime override.`;

const assertTransferByteBudget = (transferBytes: number): void => {
  if (
    !Number.isSafeInteger(transferBytes) ||
    transferBytes < 1 ||
    transferBytes > MAX_TRANSFER_BYTES
  )
    throw new RangeError(
      "JavaScript transfer requires a valid complete-file byte budget",
    );
};

const encodeTransferRecord = (
  input: unknown,
  previousBytes: number,
  transferBytes = TRANSFER_BYTES,
) => {
  const record = recordSchema.parse(input);
  const line = `${JSON.stringify(record)}\n`;
  const size = Buffer.byteLength(line);
  if (size > FRAME_BYTES || previousBytes + size > transferBytes)
    throw new AnalysisResourceConstraintError(
      "analyze_javascript_application",
      "transport",
      javaScriptTransferCeilingReason(size, transferBytes),
      {
        transfer_record_bytes: FRAME_BYTES,
        transfer_file_bytes: transferBytes,
        record_bytes: size,
        transfer_bytes_at_least: previousBytes + size,
      },
      {
        remediationAction: javaScriptTransferCeilingRemediation(transferBytes),
      },
    );
  return { line, size, kind: record.kind };
};

function* moduleTransferRecords(
  module: JavaScriptModuleSemanticIr,
): Generator<unknown> {
  yield {
    kind: "module-header",
    value: { coverage: module.coverage, limitations: module.limitations },
  };
  for (const value of module.scopes) yield { kind: "scope", value };
  for (const value of module.bindings) yield { kind: "binding", value };
  for (const value of module.callables) yield { kind: "callable", value };
  for (const value of module.moduleLinks) yield { kind: "module-link", value };
}

/** Measure actual validated module rows before allocating an unadmittable graph. */
export const measureJavaScriptModuleTransfer = (
  module: JavaScriptModuleSemanticIr,
  transferBytes = TRANSFER_BYTES,
) => {
  assertTransferByteBudget(transferBytes);
  let bytes = 0;
  let records = 0;
  for (const record of moduleTransferRecords(module)) {
    bytes += encodeTransferRecord(record, bytes, transferBytes).size;
    records += 1;
  }
  return {
    bytes,
    records,
    retentionBytes: javaScriptTransferRetentionBytes(bytes, records),
  };
};

/** Encode validated facts in bounded records, without serializing a whole graph or IR. */
export const writeJavaScriptAnalysisTransfer = async (
  path: string,
  module: JavaScriptModuleSemanticIr,
  projection: JavaScriptSemanticFileProjection,
  transferBytes = TRANSFER_BYTES,
): Promise<Descriptor> => {
  assertTransferByteBudget(transferBytes);
  const output = await open(path, "wx", 0o600);
  const digest = createHash("sha256");
  let bytes = 0;
  let records = 0;
  let moduleBytes = 0;
  let moduleRecords = 0;
  let graphBytes = 0;
  let graphRecords = 0;
  let batch: string[] = [];
  let batchBytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const buffer = Buffer.from(batch.join(""));
    // FileHandle.write can be short; writeFile completes the buffer.
    await output.writeFile(buffer);
    digest.update(buffer);
    batch = [];
    batchBytes = 0;
  };
  const append = async (input: unknown): Promise<void> => {
    const { line, size, kind } = encodeTransferRecord(
      input,
      bytes,
      transferBytes,
    );
    bytes += size;
    records += 1;
    if (
      ["module-header", "scope", "binding", "callable", "module-link"].includes(
        kind,
      )
    ) {
      moduleBytes += size;
      moduleRecords += 1;
    } else {
      graphBytes += size;
      graphRecords += 1;
    }
    batch.push(line);
    batchBytes += size;
    if (batchBytes >= BATCH_BYTES) await flush();
  };
  try {
    await append({
      kind: "projection-header",
      value: {
        roots: projection.roots,
        nodesTruncated: projection.nodesTruncated,
        ...(projection.omittedUnknownOccurrences === undefined
          ? {}
          : {
              omittedUnknownOccurrences: projection.omittedUnknownOccurrences,
            }),
      },
    });
    for (const record of moduleTransferRecords(module)) await append(record);
    for (const value of projection.evidenceContexts)
      await append({ kind: "evidence-context", value });
    for (const value of projection.nodes) await append({ kind: "node", value });
    for (const value of projection.relations)
      await append({ kind: "relation", value });
    for (const value of projection.unknowns)
      await append({ kind: "unknown", value });
    for (const value of projection.fingerprints)
      await append({ kind: "fingerprint", value });
    await flush();
    return {
      bytes,
      sha256: digest.digest("hex"),
      records,
      module_bytes: moduleBytes,
      module_records: moduleRecords,
      graph_bytes: graphBytes,
      graph_records: graphRecords,
    };
  } finally {
    await output.close();
  }
};

/** Decode producer records into realm-local, source-bound facts; sealing follows in the consumer. */
export function readJavaScriptAnalysisTransfer(
  path: string,
  descriptor: Descriptor,
  source: Pick<JavaScriptArtifactFile, "path" | "sha256">,
  signal?: AbortSignal,
): Promise<{
  readonly module: JavaScriptModuleSemanticIr;
  readonly projection: JavaScriptSemanticFileProjection;
}>;
/** Validate the transfer while retaining only module facts when graph admission fails. */
export function readJavaScriptAnalysisTransfer(
  path: string,
  descriptor: Descriptor,
  source: Pick<JavaScriptArtifactFile, "path" | "sha256">,
  signal: AbortSignal | undefined,
  capacity: JavaScriptSemanticProjectionCapacity | null,
): Promise<{
  readonly module: JavaScriptModuleSemanticIr;
  readonly projection: JavaScriptSemanticFileProjection | null;
}>;
export async function readJavaScriptAnalysisTransfer(
  path: string,
  descriptor: Descriptor,
  source: Pick<JavaScriptArtifactFile, "path" | "sha256">,
  signal?: AbortSignal,
  capacity: JavaScriptSemanticProjectionCapacity | null = {
    nodes: JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
    unknowns: JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
  },
): Promise<{
  readonly module: JavaScriptModuleSemanticIr;
  readonly projection: JavaScriptSemanticFileProjection | null;
}> {
  if (
    capacity !== null &&
    [capacity.nodes, capacity.unknowns].some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
    )
  )
    throw new RangeError(
      "JavaScript transfer requires valid retained capacities",
    );
  const expected = javaScriptAnalysisTransferDescriptorSchema.parse(descriptor);
  if ((await stat(path)).size !== expected.bytes)
    throw new TypeError(
      "JavaScript analysis transfer byte count does not match",
    );
  const scopes: JavaScriptModuleSemanticIr["scopes"][number][] = [];
  const bindings: JavaScriptModuleSemanticIr["bindings"][number][] = [];
  const callables: JavaScriptModuleSemanticIr["callables"][number][] = [];
  const moduleLinks: JavaScriptModuleSemanticIr["moduleLinks"][number][] = [];
  const evidenceContexts: JavaScriptSemanticFileProjection["evidenceContexts"][number][] =
    [];
  const nodes: JavaScriptSemanticFileProjection["nodes"][number][] = [];
  const relations: JavaScriptSemanticFileProjection["relations"][number][] = [];
  const unknowns: JavaScriptSemanticFileProjection["unknowns"][number][] = [];
  const fingerprints: JavaScriptSemanticFileProjection["fingerprints"][number][] =
    [];
  let projectionHeader:
    | z.output<typeof javaScriptWorkerProjectionHeaderSchema>
    | undefined;
  let moduleHeader:
    | z.output<typeof javaScriptWorkerModuleHeaderSchema>
    | undefined;
  const identities = new Map<string, Set<string>>();
  const retainIdentity = (kind: string, identifier: string): void => {
    let seen = identities.get(kind);
    if (seen === undefined) {
      seen = new Set();
      identities.set(kind, seen);
    }
    if (seen.has(identifier))
      throw new TypeError(
        `Duplicate JavaScript transfer ${kind} identity: ${identifier}`,
      );
    seen.add(identifier);
  };
  let records = 0;
  let moduleBytes = 0;
  let moduleRecords = 0;
  let graphBytes = 0;
  let graphRecords = 0;
  const digest = createHash("sha256");
  const stream = createReadStream(path, {
    highWaterMark: 64 * 1024,
    ...(signal === undefined ? {} : { signal }),
  });
  let bytes = 0;
  let pending = "";
  stream.setEncoding("utf8");
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      if (typeof chunk !== "string")
        throw new TypeError("JavaScript transfer stream is not UTF-8 text");
      bytes += Buffer.byteLength(chunk);
      if (bytes > expected.bytes)
        throw new RangeError("JavaScript transfer grew while being read");
      digest.update(chunk);
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (Buffer.byteLength(line) + 1 > FRAME_BYTES)
          throw new RangeError(
            "JavaScript transfer record exceeds its byte budget",
          );
        const input: unknown = JSON.parse(line);
        const record = recordSchema.parse(input);
        if (
          [
            "module-header",
            "scope",
            "binding",
            "callable",
            "module-link",
          ].includes(record.kind)
        ) {
          moduleBytes += Buffer.byteLength(line) + 1;
          moduleRecords += 1;
        } else {
          graphBytes += Buffer.byteLength(line) + 1;
          graphRecords += 1;
        }
        if (record.kind === "projection-header") {
          if (records !== 0 || projectionHeader !== undefined)
            throw new TypeError(
              "Duplicate or late JavaScript projection header",
            );
          projectionHeader = record.value;
        } else if (record.kind === "module-header") {
          if (records !== 1 || moduleHeader !== undefined)
            throw new TypeError("Duplicate or late JavaScript module header");
          moduleHeader = record.value;
        } else {
          if (projectionHeader === undefined || moduleHeader === undefined)
            throw new TypeError(
              "JavaScript transfer facts precede their headers",
            );
          if (
            capacity === null &&
            [
              "evidence-context",
              "node",
              "relation",
              "unknown",
              "fingerprint",
            ].includes(record.kind)
          ) {
            if (
              record.kind === "node" &&
              (record.value.identity.artifact_sha256 !== source.sha256 ||
                record.value.identity.module_path !== source.path)
            )
              throw new TypeError(
                "JavaScript transfer node belongs to a different artifact source",
              );
            records += 1;
            continue;
          }
          switch (record.kind) {
            case "scope":
              retainIdentity(record.kind, record.value.scopeId);
              scopes.push(record.value);
              break;
            case "binding":
              retainIdentity(record.kind, record.value.bindingId);
              bindings.push(record.value);
              break;
            case "callable":
              retainIdentity(record.kind, record.value.callableId);
              callables.push(record.value);
              break;
            case "module-link":
              moduleLinks.push(record.value);
              break;
            case "evidence-context":
              retainIdentity(record.kind, record.value.context_id);
              evidenceContexts.push(record.value);
              break;
            case "node": {
              retainIdentity(record.kind, record.value.node_id);
              if (
                record.value.identity.artifact_sha256 !== source.sha256 ||
                record.value.identity.module_path !== source.path
              )
                throw new TypeError(
                  "JavaScript transfer node belongs to a different artifact source",
                );
              if (capacity !== null && nodes.length >= capacity.nodes)
                throw new TypeError(
                  "JavaScript transfer nodes exceed the offered capacity",
                );
              nodes.push(record.value);
              break;
            }
            case "relation":
              retainIdentity(record.kind, record.value.relation_id);
              relations.push(record.value);
              break;
            case "unknown":
              retainIdentity(record.kind, record.value.unknown_id);
              if (capacity !== null && unknowns.length >= capacity.unknowns)
                throw new TypeError(
                  "JavaScript transfer unknowns exceed the offered capacity",
                );
              unknowns.push(record.value);
              break;
            case "fingerprint":
              retainIdentity(record.kind, record.value.fingerprint_id);
              fingerprints.push(record.value);
              break;
          }
        }
        records += 1;
      }
      if (Buffer.byteLength(pending) + 1 > FRAME_BYTES)
        throw new RangeError(
          "Unterminated JavaScript transfer record exceeds its byte budget",
        );
    }
  } finally {
    stream.destroy();
  }
  if (
    pending !== "" ||
    records !== expected.records ||
    bytes !== expected.bytes ||
    moduleBytes !== expected.module_bytes ||
    moduleRecords !== expected.module_records ||
    graphBytes !== expected.graph_bytes ||
    graphRecords !== expected.graph_records ||
    digest.digest("hex") !== expected.sha256
  )
    throw new TypeError(
      "JavaScript analysis transfer is incomplete or its digest does not match",
    );
  if (projectionHeader === undefined || moduleHeader === undefined)
    throw new TypeError("JavaScript analysis transfer is missing its headers");
  return {
    module: { ...moduleHeader, scopes, bindings, callables, moduleLinks },
    projection:
      capacity !== null
        ? {
            ...projectionHeader,
            evidenceContexts,
            nodes,
            relations,
            unknowns,
            fingerprints,
          }
        : null,
  };
}
