import { fitJavaScriptRouteSourceFacts } from "../domain/javascript/javascriptRouteResultBudget.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";
import { readBoundedControlLines } from "../process/BoundedControlLines.js";
import { withArtifactFileHandle } from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { jsonParts } from "../domain/jsonSerialization.js";
import type { IncludedScript } from "../domain/webBundleAnalyzerState.js";
import {
  webBundleScriptAnalysisSchema,
  type WebBundleScriptAnalysis,
} from "../domain/webBundleScriptAnalysis.js";
import { javaScriptRuntime } from "../domain/runtimeVersion.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import {
  WEB_BUNDLE_WORKER_LIMITS as LIMITS,
  includedWebScriptSchema,
  webBundleWorkerRequestSchema,
  webBundleWorkerMessageSchema,
  type WebBundleWorkerMessage,
} from "./WebBundleAnalysisWorkerProtocol.js";

export interface WebBundleScriptAnalyzer {
  (script: IncludedScript): WebBundleScriptAnalysis;
}

class WebBundleWorkerInputError extends Error {}
class WebBundleWorkerOutputError extends Error {}

const send = async (input: WebBundleWorkerMessage): Promise<void> => {
  const value = webBundleWorkerMessageSchema.parse(input);
  const frame = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(frame) > LIMITS.protocolBytes)
    throw new RangeError(
      "Web bundle worker control frame exceeds its byte budget",
    );
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, (error) =>
      error === null || error === undefined ? resolve() : reject(error),
    );
  });
};

/** Serve sequential script jobs from the private root owned by the worker runtime. */
export const serveWebBundleAnalysisWorker = async (
  analyze: WebBundleScriptAnalyzer,
): Promise<void> => {
  const root = process.cwd();
  const resources = new ArtifactResourceScope();
  const requests = readBoundedControlLines(
    process.stdin.iterator({ destroyOnReturn: true }),
    LIMITS.protocolBytes,
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
          "Web bundle worker request exceeds its byte budget",
        );
      const raw: unknown = JSON.parse(next.value.value);
      const request = webBundleWorkerRequestSchema.parse(raw);
      const continueServing = await analyzeJob(
        root,
        request,
        analyze,
        resources,
      );
      if (!continueServing) break;
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
  request: ReturnType<typeof webBundleWorkerRequestSchema.parse>,
  analyze: WebBundleScriptAnalyzer,
  resources: ArtifactResourceScope,
): Promise<boolean> => {
  try {
    const sourcePath = join(root, `${request.id}.source`);
    const source = await readStableArtifact(
      sourcePath,
      LIMITS.sourceBytes,
      undefined,
      undefined,
      resources,
    );
    if (
      source.bytes.length !== request.source.bytes ||
      source.sha256 !== request.source.sha256
    )
      throw new WebBundleWorkerInputError(
        "Web bundle worker source descriptor does not match its file",
      );
    let script: IncludedScript;
    try {
      const decoded: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(source.bytes),
      );
      script = includedWebScriptSchema.parse(decoded);
    } catch (cause) {
      throw new WebBundleWorkerInputError(
        `Web bundle worker source is not a valid included script: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    await send({ kind: "phase", id: request.id, phase: "analyze" });
    let result: WebBundleScriptAnalysis;
    try {
      result = webBundleScriptAnalysisSchema.parse(analyze(script));
    } catch (cause) {
      throw new WebBundleWorkerOutputError(
        `Web bundle analyzer returned an invalid result: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (result.status !== "analyzed")
      throw new WebBundleWorkerOutputError(
        "Web bundle analyzer did not produce a completed per-script result",
      );
    if (result.route_facts != null) {
      const { route_facts, ...existing } = result;
      const available =
        request.result_budget_bytes -
        jsonValueByteLength(
          existing as JsonValue,
          request.result_budget_bytes,
        ) -
        Buffer.byteLength(',"route_facts":');
      const admitted = fitJavaScriptRouteSourceFacts(route_facts, available);
      result =
        admitted === undefined
          ? existing
          : { ...existing, route_facts: admitted };
    }
    const resultPath = join(root, `${request.id}.result`);
    const file = await open(resultPath, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    await withArtifactFileHandle(
      resultPath,
      file,
      resources,
      undefined,
      async (handle) => {
        for (const part of jsonParts(result)) {
          const chunk = Buffer.from(part);
          bytes += chunk.length;
          if (bytes > request.result_budget_bytes)
            throw new RangeError(
              "Web bundle worker result exceeds its admitted byte budget",
            );
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const written = await handle.write(
              chunk,
              offset,
              chunk.length - offset,
            );
            if (written.bytesWritten === 0)
              throw new Error(
                "Web bundle worker result write made no progress",
              );
            offset += written.bytesWritten;
          }
        }
      },
    );
    await send({
      kind: "complete",
      id: request.id,
      result: { bytes, sha256: hash.digest("hex") },
    });
    return true;
  } catch (cause: unknown) {
    const resource = cause instanceof RangeError;
    const input = cause instanceof WebBundleWorkerInputError;
    const fatalCleanupFailure =
      cause instanceof ArtifactReaderFailure &&
      cause.cleanupLeases !== undefined &&
      cause.cleanupLeases.length > 0;
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    await send({
      kind: "failure",
      id: request.id,
      reason: resource
        ? "resource"
        : input
          ? "input"
          : cause instanceof WebBundleWorkerOutputError ||
              cause instanceof TypeError
            ? "output"
            : "io",
      message:
        rawMessage.length > 2048 ? `${rawMessage.slice(0, 2048)}…` : rawMessage,
    });
    return !fatalCleanupFailure;
  }
};
