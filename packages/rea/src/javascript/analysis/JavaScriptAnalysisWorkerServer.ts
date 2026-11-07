import { fitJavaScriptRouteSourceFacts } from "../../domain/javascript/javascriptRouteResultBudget.js";
import { jsonValueByteLength } from "../../domain/jsonValueByteLength.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type {
  JavaScriptSemanticProjectionCapacity,
  JavaScriptSemanticFileProjection,
} from "../../domain/javascript/javascriptSemanticFileProjection.js";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import {
  readBoundedControlLines,
  type BoundedControlLine,
} from "../../process/BoundedControlLines.js";
import { AnalysisResourceConstraintError } from "../../domain/analysisErrorCore.js";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptStaticAnalysis } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptModuleSemanticIr } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import {
  javaScriptTransferByteBudget,
  writeJavaScriptAnalysisTransfer,
} from "./JavaScriptAnalysisTransfer.js";
import { javaScriptWorkerStaticAnalysisSchema } from "./JavaScriptAnalysisWorkerSchemas.js";
import {
  JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS as DEFAULTS,
  javaScriptCheckpointCeilingRemediation,
  javaScriptWorkerRequestSchema,
  javaScriptWorkerAdmissionSchema,
  javaScriptWorkerMessageSchema,
  type JavaScriptWorkerMessage,
} from "./JavaScriptAnalysisWorkerProtocol.js";

/** Trusted composition callback; this provider owns framing and temporary I/O. */
export interface JavaScriptSourceWorkerAnalyzer {
  (
    file: JavaScriptArtifactFile,
    capacity: JavaScriptSemanticProjectionCapacity,
    callbacks: {
      readonly phase: (
        phase: "parse" | "static" | "semantic" | "projection",
      ) => Promise<void>;
      readonly checkpoint: (facts: JavaScriptStaticAnalysis) => Promise<number>;
    },
  ): Promise<{
    readonly module: JavaScriptModuleSemanticIr;
    readonly projection: JavaScriptSemanticFileProjection;
  } | null>;
}

const send = async (input: JavaScriptWorkerMessage): Promise<void> => {
  const value = javaScriptWorkerMessageSchema.parse(input);
  const frame = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(frame) > DEFAULTS.protocolBytes)
    throw new RangeError(
      "JavaScript worker control frame exceeds its byte budget",
    );
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, (error) =>
      error === null || error === undefined ? resolve() : reject(error),
    );
  });
};

/** Serve sequential inert-source requests from a parent-owned private runtime root. */
export const serveJavaScriptAnalysisWorker = async (
  analyze: JavaScriptSourceWorkerAnalyzer,
): Promise<void> => {
  const root = process.cwd();
  const requests = readBoundedControlLines(
    process.stdin.iterator({ destroyOnReturn: false }),
    DEFAULTS.protocolBytes,
  );
  await send({
    kind: "ready",
    heap_limit_bytes:
      javaScriptRuntime(process.versions).id === "node"
        ? getHeapStatistics().heap_size_limit
        : null,
  });
  try {
    for (;;) {
      const next = await requests.next();
      if (next.done) break;
      if (!next.value.ok)
        throw new RangeError(
          "JavaScript worker request exceeds its byte budget",
        );
      const raw: unknown = JSON.parse(next.value.value);
      const request = javaScriptWorkerRequestSchema.parse(raw);
      // Function scope releases source AST/IR/results before accepting another job.
      await analyzeJob(root, request, analyze, requests);
      if (
        process.memoryUsage().heapUsed >
        getHeapStatistics().heap_size_limit / 2
      )
        global.gc?.();
    }
  } finally {
    await requests.return(undefined);
  }
};

const analyzeJob = async (
  root: string,
  request: ReturnType<typeof javaScriptWorkerRequestSchema.parse>,
  analyze: JavaScriptSourceWorkerAnalyzer,
  requests: AsyncIterator<BoundedControlLine>,
): Promise<void> => {
  try {
    let resultBudgetBytes = 0;
    const source = await readFile(join(root, `${request.id}.source`), "utf8");
    if (
      createHash("sha256").update(source).digest("hex") !== request.text_sha256
    )
      throw new TypeError(
        "JavaScript worker source text digest does not match its request",
      );
    const result = await analyze(
      {
        ...request.file,
        text: { included: true, value: source },
      },
      { nodes: request.node_budget, unknowns: request.unknown_budget },
      {
        phase: async (phase) => send({ kind: "phase", id: request.id, phase }),
        checkpoint: async (facts) => {
          let value = javaScriptWorkerStaticAnalysisSchema.parse(facts);
          if (value.routes !== undefined) {
            const { routes, ...existing } = value;
            // This is schema-checked, producer-owned JSON. Interface optional
            // members can only make the size estimate conservative.
            const available =
              DEFAULTS.checkpointBytes -
              jsonValueByteLength(
                existing as JsonValue,
                DEFAULTS.checkpointBytes,
              ) -
              Buffer.byteLength(',"routes":');
            const admitted = fitJavaScriptRouteSourceFacts(routes, available);
            value =
              admitted === undefined
                ? existing
                : { ...existing, routes: admitted };
          }
          const text = JSON.stringify(value);
          const bytes = Buffer.byteLength(text);
          if (bytes > DEFAULTS.checkpointBytes)
            throw new AnalysisResourceConstraintError(
              "analyze_javascript_application",
              "transport",
              `JavaScript static checkpoint exceeds its ${String(DEFAULTS.checkpointBytes)}-byte complete-fact ceiling. This release has no runtime override.`,
              {
                checkpoint_bytes: bytes,
                checkpoint_limit_bytes: DEFAULTS.checkpointBytes,
              },
              {
                remediationAction: javaScriptCheckpointCeilingRemediation(
                  DEFAULTS.checkpointBytes,
                ),
              },
            );
          await writeFile(join(root, `${request.id}.static.json`), text, {
            flag: "wx",
            mode: 0o600,
          });
          await send({
            kind: "static",
            id: request.id,
            bytes,
            sha256: createHash("sha256").update(text).digest("hex"),
          });
          const next = await requests.next();
          if (next.done || !next.value.ok)
            throw new TypeError(
              "JavaScript worker admission frame is missing or oversized",
            );
          const raw: unknown = JSON.parse(next.value.value);
          const admission = javaScriptWorkerAdmissionSchema.parse(raw);
          if (admission.id !== request.id)
            throw new TypeError(
              "JavaScript worker admission names a different source job",
            );
          resultBudgetBytes = admission.semantic_result_budget_bytes;
          return resultBudgetBytes;
        },
      },
    );
    await send({ kind: "phase", id: request.id, phase: "transfer" });
    const descriptor =
      result === null
        ? null
        : await writeJavaScriptAnalysisTransfer(
            join(root, `${request.id}.records`),
            result.module,
            result.projection,
            javaScriptTransferByteBudget(resultBudgetBytes),
          );
    await send({ kind: "complete", id: request.id, descriptor });
  } catch (cause: unknown) {
    await send({
      kind: "failure",
      id: request.id,
      reason:
        cause instanceof AnalysisResourceConstraintError ||
        cause instanceof RangeError
          ? "resource"
          : cause instanceof TypeError
            ? "output"
            : "io",
      resource:
        cause instanceof AnalysisResourceConstraintError
          ? cause.resource
          : cause instanceof RangeError
            ? "memory"
            : null,
      limits:
        cause instanceof AnalysisResourceConstraintError
          ? cause.reportedLimits
          : null,
      // The parent owns resource-error formatting; send its canonical reason.
      message:
        cause instanceof AnalysisResourceConstraintError
          ? cause.reason
          : cause instanceof Error
            ? cause.message
            : String(cause),
    });
  }
};
