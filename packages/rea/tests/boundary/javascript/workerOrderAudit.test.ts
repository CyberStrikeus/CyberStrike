import { createHash } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { setImmediate as yieldToIo } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { javaScriptRuntime } from "../../../src/domain/runtimeVersion.js";
import { JavaScriptAnalysisWorker } from "../../../src/javascript/analysis/JavaScriptAnalysisWorker.js";
import {
  javaScriptWorkerMessageSchema,
  type JavaScriptWorkerMessage,
} from "../../../src/javascript/analysis/JavaScriptAnalysisWorkerProtocol.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import type { JavaScriptArtifactFile } from "../../../src/domain/javascript/javascriptArtifactFiles.js";
import { staticCheckpointFacts } from "../../fixtures/javascriptWorkerCheckpoint.js";

// The observer is attached before the protocol reader. A queued microtask
// runs after both readers have synchronously processed the current chunk.
const observeWorkerFrames = (
  stdout: Readable | null | undefined,
  observe: (frame: JavaScriptWorkerMessage, beforeEof: boolean) => void,
): void => {
  if (stdout === null || stdout === undefined)
    throw new Error("Expected fixture worker stdout pipe");
  // The runtime attaches its diagnostic and protocol readers together after
  // adopting the launch. Wait for that owner before starting a flowing reader.
  const attach = (event: string | symbol): void => {
    if (event !== "data") return;
    stdout.off("newListener", attach);
    createInterface({ input: stdout }).on("line", (line) =>
      observe(
        javaScriptWorkerMessageSchema.parse(JSON.parse(line)),
        !stdout.readableEnded,
      ),
    );
  };
  stdout.on("newListener", attach);
};

it("preserves buffered startup bytes until the runtime owns stdout", async () => {
  const stdout = new PassThrough();
  const frame = { kind: "ready", heap_limit_bytes: 1 } as const;
  const encoded = JSON.stringify(frame) + "\n";
  const observed: JavaScriptWorkerMessage[] = [];
  const owned: Buffer[] = [];
  observeWorkerFrames(stdout, (message) => observed.push(message));
  try {
    stdout.write(encoded);
    await yieldToIo();
    expect(observed).toEqual([]);
    stdout.on("data", (chunk: Buffer) => owned.push(chunk));
    stdout.end();
    await once(stdout, "end");
    expect(observed).toEqual([frame]);
    expect(Buffer.concat(owned).toString()).toBe(encoded);
  } finally {
    stdout.destroy();
  }
});

const sourceText = "export const observed = 1;";
const file: JavaScriptArtifactFile = {
  path: "app.mjs",
  sha256: createHash("sha256").update(sourceText).digest("hex"),
  container_sha256: "1".repeat(64),
  bytes: Buffer.byteLength(sourceText),
  inventory_artifact_id: "fixture-source",
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: sourceText },
};
const ready =
  'process.stdout.write(JSON.stringify({kind:"ready",heap_limit_bytes:require("node:v8").getHeapStatistics().heap_size_limit})+"\\n");';
const phaseAfterRequest =
  'process.stdin.once("data", chunk => { const request=JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({kind:"phase",id:request.id,phase:"parse"})+"\\n");';

it.each([
  {
    memoryLimitReached: false,
    reason: { requested: "interrupt after worker exit" },
  },
  { memoryLimitReached: false, reason: null },
  {
    memoryLimitReached: true,
    reason: { requested: "interrupt after memory limit" },
  },
  { memoryLimitReached: true, reason: null },
])(
  "keeps an owned worker exit primary and retains later abort ($memoryLimitReached, $reason)",
  async ({ memoryLimitReached, reason }) => {
    const controller = new AbortController();
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        const launched = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} process.stdin.once("data", () => process.exit(7));`,
          ],
        });
        let exited = false;
        launched.process.once("exit", () => {
          exited = true;
          setImmediate(() => controller.abort(reason));
        });
        Object.defineProperty(launched.process, "memoryLimitReached", {
          get: () => memoryLimitReached && exited,
        });
        return launched;
      },
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(controller.signal.reason).toBe(reason);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error).toMatchObject(
          memoryLimitReached
            ? { _tag: "AnalysisResourceConstraintError", resource: "memory" }
            : {
                _tag: "ProviderAdapterError",
                diagnostics: { exit_code: 7 },
              },
        );
        expect(result.error.error.secondaryFailures).toHaveLength(1);
        expect(result.error.error.secondaryFailures[0]).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(result.error.error.secondaryFailures[0]?.cause).toBe(reason);
      }
    } finally {
      await worker.close();
    }
  },
);

it.each([
  {
    label: "an AnalysisOutputError instance",
    reason: new AnalysisOutputError("fixture", "opaque caller value"),
  },
  { label: "explicit null", reason: null },
])(
  "preserves caller cancellation after the request barrier with $label",
  async ({ reason }) => {
    const controller = new AbortController();
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        const launched = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} ${phaseAfterRequest} setTimeout(() => process.exit(7), 500); });`,
          ],
        });
        let acknowledged = false;
        launched.process.stdout?.on("data", (chunk: Buffer | string) => {
          if (String(chunk).includes('"kind":"phase"') && !acknowledged) {
            acknowledged = true;
            setImmediate(() => controller.abort(reason));
          }
        });
        return launched;
      },
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(controller.signal.aborted).toBe(true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.error.cause).toBe(reason);
      }
    } finally {
      await worker.close();
    }
  },
);

it("clears a consumed resource frame before the next reusable worker job", async () => {
  const controller = new AbortController();
  let launchCount = 0;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      launchCount += 1;
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} let count=0; require("node:readline").createInterface({input:process.stdin}).on("line", line => { const {id}=JSON.parse(line); const first=++count===1; const response={kind:"failure",id,reason:first?"resource":"output",resource:first?"memory":null,limits:null,message:first?"first resource response":"second job output response"}; process.stdout.write(JSON.stringify(response)+"\\n"); if(!first)setInterval(()=>{},1000); });`,
        ],
      });
      observeWorkerFrames(launched.process.stdout, (frame) => {
        if (
          frame.kind === "failure" &&
          frame.message === "second job output response"
        )
          queueMicrotask(() => controller.abort("abort after second response"));
      });
      return launched;
    },
  );
  try {
    const first = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(first.ok).toBe(false);
    if (!first.ok)
      expect(first.error.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        reason: "first resource response",
      });
    const second = await worker.analyze(
      { ...file, path: "next.mjs" },
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: "next.mjs during source-transfer: second job output response",
      });
    expect(launchCount).toBe(1);
  } finally {
    await worker.close();
  }
});

it("keeps coalesced static and resource frames in FIFO order and reuses the worker", async () => {
  const encodedStatic = JSON.stringify(staticCheckpointFacts);
  let launchCount = 0;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      launchCount += 1;
      return spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const fs=require("node:fs"); const {createHash}=require("node:crypto"); const staticFacts=JSON.parse(${JSON.stringify(encodedStatic)}); require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); if(!request.file)return; const text=JSON.stringify(staticFacts); fs.writeFileSync(request.id+".static.json",text); const frames=[{kind:"static",id:request.id,bytes:Buffer.byteLength(text),sha256:createHash("sha256").update(text).digest("hex")},{kind:"failure",id:request.id,reason:"resource",resource:"memory",limits:null,message:"fixture resource after static"}]; process.stdout.write(frames.map(frame=>JSON.stringify(frame)).join("\\n")+"\\n"); });`,
        ],
      });
    },
  );
  try {
    for (const path of ["first.mjs", "second.mjs"]) {
      const result = await worker.analyze(
        { ...file, path },
        { nodes: 100, unknowns: 100 },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error).toMatchObject({
          _tag: "AnalysisResourceConstraintError",
          reason: "fixture resource after static",
        });
        expect(result.error.javascript?.parse_status).toBe("complete");
      }
    }
    expect(launchCount).toBe(1);
  } finally {
    await worker.close();
  }
});

it("retains coalesced static evidence when abort follows a resource frame", async () => {
  const controller = new AbortController();
  const encodedStatic = JSON.stringify(staticCheckpointFacts);
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const fs=require("node:fs"); const {createHash}=require("node:crypto"); const staticFacts=JSON.parse(${JSON.stringify(encodedStatic)}); require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); if(!request.file)return; const text=JSON.stringify(staticFacts); fs.writeFileSync(request.id+".static.json",text); const frames=[{kind:"static",id:request.id,bytes:Buffer.byteLength(text),sha256:createHash("sha256").update(text).digest("hex")},{kind:"failure",id:request.id,reason:"resource",resource:"memory",limits:null,message:"resource failure before abort"}]; process.stdout.write(frames.map(frame=>JSON.stringify(frame)).join("\\n")+"\\n"); });`,
        ],
      });
      observeWorkerFrames(launched.process.stdout, (frame) => {
        if (
          frame.kind === "failure" &&
          frame.message === "resource failure before abort"
        )
          queueMicrotask(() => controller.abort(null));
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisResourceConstraintError",
        reason: "resource failure before abort",
      });
      expect(result.error.javascript?.parse_status).toBe("complete");
    }
  } finally {
    await worker.close();
  }
});

it("selects output EOF before a later abort when the current job has no terminal frame", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => process.exit(0));`,
        ],
      });
      launched.process.once("close", () => {
        queueMicrotask(() =>
          controller.abort({ requested: "abort after EOF" }),
        );
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason:
          "JavaScript worker closed output before the operation received its terminal response",
      });
  } finally {
    await worker.close();
  }
});

it("selects startup EOF before an abort queued by the same close event", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: ["-e", "process.exit(0);"],
      });
      launched.process.once("close", () => {
        queueMicrotask(() =>
          controller.abort({ requested: "abort after startup EOF" }),
        );
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason:
          "JavaScript worker closed output before the operation received its terminal response",
      });
  } finally {
    await worker.close();
  }
});

it("keeps a parsed terminal failure primary over startup-close abort", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", chunk => { const id=JSON.parse(String(chunk)).id; process.stdout.write(JSON.stringify({kind:"failure",id,reason:"output",resource:null,limits:null,message:"terminal failure before EOF"})+"\\n",()=>process.exit(0)); });`,
        ],
      });
      launched.process.once("close", () => {
        queueMicrotask(() =>
          controller.abort({ requested: "abort after terminal EOF" }),
        );
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: "app.mjs during source-transfer: terminal failure before EOF",
      });
  } finally {
    await worker.close();
  }
});

it.each([false, true])(
  "admits valid static facts and honors cancellation before terminal admission (%s)",
  async (abortAfterTerminal) => {
    const controller = new AbortController();
    const reason = { requested: "abort after valid terminal frame" };
    let abortedBeforeEof = false;
    const encodedStatic = JSON.stringify(staticCheckpointFacts);
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        const launched = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} const fs=require("node:fs"); const {createHash}=require("node:crypto"); const staticFacts=JSON.parse(${JSON.stringify(encodedStatic)}); let id; require("node:readline").createInterface({input:process.stdin}).on("line", line => { const request=JSON.parse(line); if(request.file){ id=request.id; const text=JSON.stringify(staticFacts); fs.writeFileSync(id+".static.json",text); process.stdout.write(JSON.stringify({kind:"static",id,bytes:Buffer.byteLength(text),sha256:createHash("sha256").update(text).digest("hex")})+"\\n"); } else { process.stdout.write(JSON.stringify({kind:"complete",id,descriptor:null})+"\\n",()=>process.exit(0)); } });`,
          ],
        });
        if (abortAfterTerminal) {
          observeWorkerFrames(launched.process.stdout, (frame, beforeEof) => {
            if (frame.kind !== "complete") return;
            abortedBeforeEof = beforeEof;
            controller.abort(reason);
          });
        }
        return launched;
      },
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(controller.signal.aborted).toBe(abortAfterTerminal);
      if (abortAfterTerminal) {
        expect(abortedBeforeEof).toBe(true);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.error._tag).toBe("AnalysisCancelledError");
          expect(result.error.error.cause).toBe(reason);
          expect(result.error.javascript?.parse_status).toBe("complete");
        }
      } else {
        expect(result).toMatchObject({
          ok: true,
          value: { javascript: { parse_status: "complete" } },
        });
      }
    } finally {
      await worker.close();
    }
  },
);

it.each([
  { abortAfterComplete: false, reason: undefined },
  { abortAfterComplete: true, reason: { requested: "after protocol failure" } },
  { abortAfterComplete: true, reason: null },
])(
  "keeps a complete-before-static protocol failure primary and retains later abort ($abortAfterComplete, $reason)",
  async ({ abortAfterComplete, reason }) => {
    const controller = new AbortController();
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        const launched = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} require("node:readline").createInterface({input:process.stdin}).once("line", line => { const {id}=JSON.parse(line); process.stdout.write(JSON.stringify({kind:"complete",id,descriptor:null})+"\\n"); setInterval(()=>{},1000); });`,
          ],
        });
        if (abortAfterComplete) {
          const stdout = launched.process.stdout;
          let readySeen = false;
          stdout?.on("data", (chunk: Buffer | string) => {
            if (!readySeen && String(chunk).includes('"kind":"ready"')) {
              readySeen = true;
              stdout.on("data", (responseChunk: Buffer | string) => {
                if (String(responseChunk).includes('"kind":"complete"'))
                  queueMicrotask(() => controller.abort(reason));
              });
            }
          });
        }
        return launched;
      },
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(controller.signal.aborted).toBe(abortAfterComplete);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error).toMatchObject({
          _tag: "AnalysisOutputError",
          reason: "JavaScript worker completed before a static checkpoint",
        });
        if (abortAfterComplete) {
          expect(result.error.error.secondaryFailures).toHaveLength(1);
          expect(result.error.error.secondaryFailures[0]).toBeInstanceOf(
            AnalysisCancelledError,
          );
          expect(result.error.error.secondaryFailures[0]?.cause).toBe(reason);
        } else {
          expect(result.error.error.secondaryFailures).toHaveLength(0);
        }
      }
    } finally {
      await worker.close();
    }
  },
);

it("includes the owned process output-loss marker in captured truncation", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => process.exit(0));`,
        ],
      });
      Object.defineProperty(launched.process, "outputIncomplete", {
        value: true,
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("AnalysisOutputError");
      expect(result.error.error.capturedOutput).toMatchObject({
        truncated: true,
      });
    }
  } finally {
    await worker.close();
  }
});

it("selects a control-frame budget failure observed before caller abort", async () => {
  const controller = new AbortController();
  let stdoutBytes = 0;
  let abortQueued = false;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} ${phaseAfterRequest} process.stdout.write("x".repeat(1_100_000)+"\\n", () => process.exit(7)); });`,
        ],
      });
      launched.process.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > 65_536 && !abortQueued) {
          abortQueued = true;
          setTimeout(() => controller.abort("late caller abort"), 20);
        }
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(abortQueued).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: "JavaScript worker control frame is unterminated or oversized",
      });
  } finally {
    await worker.close();
  }
});

it("keeps abort-first cancellation when the owned worker exits during stop", async () => {
  const controller = new AbortController();
  const reason = new AnalysisOutputError("fixture", "opaque abort value");
  let exitedDuringStop = false;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.on("SIGTERM",()=>process.exit(7)); ${phaseAfterRequest} setInterval(()=>{},1000); });`,
        ],
      });
      let acknowledged = false;
      launched.process.stdout?.on("data", (chunk: Buffer | string) => {
        if (String(chunk).includes('"kind":"phase"') && !acknowledged) {
          acknowledged = true;
          setImmediate(() => controller.abort(reason));
        }
      });
      launched.process.once("exit", () => {
        exitedDuringStop = controller.signal.aborted;
      });
      return { process: launched.process, ownership: launched.ownership };
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(exitedDuringStop).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.error.cause).toBe(reason);
      expect(result.error.error.secondaryFailures).toHaveLength(0);
    }
  } finally {
    await worker.close();
  }
});

it("bounds exit-output drain when a descendant holds the inherited pipe", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); process.stdin.once("data",()=>process.exit(7));`,
        ],
      });
      launched.process.once("exit", () => {
        setImmediate(() => controller.abort("abort after observed exit"));
      });
      return launched;
    },
  );
  const started = performance.now();
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: { exit_code: 7 },
      });
  } finally {
    await worker.close();
  }
});

it("admits a final valid control frame written after the worker exit event", async () => {
  const frameWasWrittenAfterExit: boolean[] = [];
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const response = {
        kind: "failure",
        id: "",
        reason: "output",
        resource: null,
        limits: null,
        message: "final response after child exit",
      };
      const script = `${ready} const {spawn}=require("node:child_process"); process.stdin.once("data", chunk => { const response=${JSON.stringify(response)}; response.id=JSON.parse(String(chunk)).id; const frame=JSON.stringify(response)+"\\n"; const lateScript="setTimeout(()=>process.stdout.write("+JSON.stringify(frame)+"),50); setInterval(()=>{},1000)"; spawn(process.execPath,["-e",lateScript],{stdio:["ignore","inherit","ignore"]}); process.exit(7); });`;
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: ["-e", script],
      });
      let exited = false;
      launched.process.once("exit", () => {
        exited = true;
      });
      launched.process.stdout?.on("data", (chunk: Buffer | string) => {
        if (String(chunk).includes("final response after child exit"))
          frameWasWrittenAfterExit.push(exited);
      });
      return launched;
    },
  );
  const started = performance.now();
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(frameWasWrittenAfterExit).toEqual([true]);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: expect.stringContaining("final response after child exit"),
      });
  } finally {
    await worker.close();
  }
});

it("retains the owned worker's V8 heap exhaustion classification", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) =>
      spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => { process.stderr.write("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\\n"); process.exit(7); });`,
        ],
      }),
  );
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toBeInstanceOf(
        AnalysisResourceConstraintError,
      );
      const projected = projectAnalysisError(result.error.error);
      if (javaScriptRuntime(process.versions).id === "node") {
        expect(projected.message).toContain(
          "128 MiB V8 old-space heap (max_heap_mb)",
        );
        expect(projected.remediation.action).toContain("--max-heap-mb");
      } else {
        expect(projected.message).toContain(
          "Bun ignores the V8 old-space flag",
        );
        expect(projected.message).not.toContain(
          "128 MiB V8 old-space heap (max_heap_mb)",
        );
        expect(projected.remediation.action).not.toContain(
          "Increase max_heap_mb",
        );
      }
    }
  } finally {
    await worker.close();
  }
});

it("captures late stderr completely when the exited worker's inherited pipes close", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) =>
      spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const {spawn}=require("node:child_process"); process.stdin.once("data", () => { spawn(process.execPath,["-e","setTimeout(()=>{process.stderr.write('late stderr tail');process.exit(0)},80)"],{stdio:["ignore","inherit","inherit"]}); process.exit(7); });`,
        ],
      }),
  );
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("ProviderAdapterError");
      expect(result.error.error.capturedOutput).toMatchObject({
        stderr: "late stderr tail",
        truncated: false,
      });
    }
  } finally {
    await worker.close();
  }
});

it("marks worker diagnostics incomplete when caller abort interrupts inherited-pipe drain", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const {spawn}=require("node:child_process"); process.stdin.once("data", () => { spawn(process.execPath,["-e","setTimeout(()=>{process.stderr.write('late stderr tail');process.exit(0)},1000)"],{stdio:["ignore","inherit","inherit"]}); process.exit(7); });`,
        ],
      });
      launched.process.once("exit", () => {
        setImmediate(() =>
          controller.abort("abort during output finalization"),
        );
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("ProviderAdapterError");
      expect(result.error.error.capturedOutput).toMatchObject({
        stderr: "",
        truncated: true,
      });
    }
  } finally {
    await worker.close();
  }
});

it("does not classify a live worker's heap-related stderr as OOM", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) =>
      spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", chunk => { const id=JSON.parse(String(chunk)).id; process.stderr.write("heap limit is configured\\n"); process.stdout.write(JSON.stringify({kind:"phase",id,phase:"parse"})+"\\n"+JSON.stringify({kind:"failure",id,reason:"output",resource:null,limits:null,message:"fixture output failure"})+"\\n",()=>process.exit(0)); });`,
        ],
      }),
  );
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: "app.mjs during parse: fixture output failure",
      });
  } finally {
    await worker.close();
  }
});

it("keeps cancellation after successful exit while a final response is pending", async () => {
  const controller = new AbortController();
  const reason = new AnalysisOutputError(
    "fixture",
    "abort after successful exit",
  );
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const {spawn}=require("node:child_process"); process.stdin.once("data", chunk => { const id=JSON.parse(String(chunk)).id; const frame=JSON.stringify({kind:"failure",id,reason:"output",resource:null,limits:null,message:"late healthy response"})+"\\n"; const lateScript="setTimeout(()=>process.stdout.write("+JSON.stringify(frame)+"),500)"; spawn(process.execPath,["-e",lateScript],{stdio:["ignore","inherit","ignore"]}); process.exit(0); });`,
        ],
      });
      launched.process.once("exit", () => {
        setImmediate(() => controller.abort(reason));
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.error.cause).toBe(reason);
    }
  } finally {
    await worker.close();
  }
});

it("latches an owned stdin error observed before caller abort", async () => {
  const controller = new AbortController();
  const abortReason = { requested: "cancel after input failure" };
  const inputFailure = new Error("fixture stdin failure");
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => setInterval(()=>{},1000));`,
        ],
      });
      let injected = false;
      launched.process.stdout?.on("data", (chunk: Buffer | string) => {
        if (!injected && String(chunk).includes('"kind":"ready"')) {
          injected = true;
          setImmediate(() => {
            launched.process.stdin?.emit("error", inputFailure);
            controller.abort(abortReason);
          });
        }
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("AnalysisOutputError");
      expect(result.error.error.cause).toBe(inputFailure);
    }
  } finally {
    await worker.close();
  }
});

it("keeps a failed exit primary over a later request-stream error", async () => {
  const controller = new AbortController();
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => process.exit(7));`,
        ],
      });
      launched.process.once("exit", () => {
        queueMicrotask(() => {
          launched.process.stdin?.emit("error", new Error("late EPIPE"));
          controller.abort("late abort");
        });
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: { exit_code: 7, signal: null },
      });
  } finally {
    await worker.close();
  }
});

it("keeps a failed exit primary over malformed descendant control output", async () => {
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) =>
      spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} const {spawn}=require("node:child_process"); process.stdin.once("data", () => { spawn(process.execPath,["-e","setTimeout(()=>process.stdout.write('not-json\\\\n'),50);setInterval(()=>{},1000)"],{stdio:["ignore","inherit","ignore"]}); process.exit(7); });`,
        ],
      }),
  );
  try {
    const result = await worker.analyze(file, { nodes: 100, unknowns: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "ProviderAdapterError",
        diagnostics: { exit_code: 7 },
      });
  } finally {
    await worker.close();
  }
});

it("preserves a complete current-job failure parsed before caller abort", async () => {
  const controller = new AbortController();
  let completeFrameSeen = false;
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", chunk => { const id=JSON.parse(String(chunk)).id; process.stdout.write(JSON.stringify({kind:"phase",id,phase:"parse"})+"\\n"); setTimeout(() => process.stdout.write(JSON.stringify({kind:"failure",id,reason:"output",resource:null,limits:null,message:"complete current-job failure"})+"\\n"),1); setInterval(()=>{},1000); });`,
        ],
      });
      observeWorkerFrames(launched.process.stdout, (frame) => {
        if (
          frame.kind === "failure" &&
          frame.message === "complete current-job failure"
        ) {
          completeFrameSeen = true;
          queueMicrotask(() => controller.abort("abort after parsed failure"));
        }
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(completeFrameSeen).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.error).toMatchObject({
        _tag: "AnalysisOutputError",
        reason: "app.mjs during parse: complete current-job failure",
      });
  } finally {
    await worker.close();
  }
});

it("does not let a wrong-job failure frame override later caller abort", async () => {
  const controller = new AbortController();
  let completeFrameSeen = false;
  const reason = { requested: "stop after unrelated frame" };
  const worker = new JavaScriptAnalysisWorker(
    { heapMb: 128, timeoutMs: 30_000 },
    async (request) => {
      const launched = await spawnOwnedProviderProcess({
        ...request,
        arguments: [
          "-e",
          `${ready} process.stdin.once("data", () => { const id="00000000-0000-4000-8000-000000000000"; process.stdout.write(JSON.stringify({kind:"failure",id,reason:"output",resource:null,limits:null,message:"unrelated job failure"})+"\\n"); setInterval(()=>{},1000); });`,
        ],
      });
      observeWorkerFrames(launched.process.stdout, (frame) => {
        if (
          frame.kind === "failure" &&
          frame.message === "unrelated job failure"
        ) {
          completeFrameSeen = true;
          queueMicrotask(() => controller.abort(reason));
        }
      });
      return launched;
    },
  );
  try {
    const result = await worker.analyze(
      file,
      { nodes: 100, unknowns: 100 },
      controller.signal,
    );
    expect(completeFrameSeen).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error._tag).toBe("AnalysisCancelledError");
      expect(result.error.error.cause).toBe(reason);
    }
  } finally {
    await worker.close();
  }
});

it.each([
  {
    reason: "output" as const,
    resource: null,
    limits: null,
  },
  {
    reason: "resource" as const,
    resource: "memory" as const,
    limits: { worker_heap_bytes: 1 },
  },
])(
  "keeps abort-first cancellation when a matching $reason frame arrives afterward",
  async (failure) => {
    const controller = new AbortController();
    let failureFrameSeenAfterAbort = false;
    const worker = new JavaScriptAnalysisWorker(
      { heapMb: 128, timeoutMs: 30_000 },
      async (request) => {
        const launched = await spawnOwnedProviderProcess({
          ...request,
          arguments: [
            "-e",
            `${ready} process.stdin.once("data", chunk => { const id=JSON.parse(String(chunk)).id; const phase={kind:"phase",id,phase:"parse"}; const failure={...${JSON.stringify(failure)},kind:"failure",id,message:"fixture failure delivered after caller cancellation"}; process.stdout.write(JSON.stringify(phase)+"\\n"+JSON.stringify(failure)+"\\n"); setInterval(()=>{},1000); });`,
          ],
        });
        observeWorkerFrames(launched.process.stdout, (frame) => {
          // This launcher observer precedes the worker's protocol reader.
          if (frame.kind === "phase") controller.abort(null);
          if (controller.signal.aborted && frame.kind === "failure")
            failureFrameSeenAfterAbort = true;
        });
        return launched;
      },
    );
    try {
      const result = await worker.analyze(
        file,
        { nodes: 100, unknowns: 100 },
        controller.signal,
      );
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe(null);
      expect(failureFrameSeenAfterAbort).toBe(true);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.error.cause).toBe(null);
      }
    } finally {
      await worker.close();
    }
  },
);
