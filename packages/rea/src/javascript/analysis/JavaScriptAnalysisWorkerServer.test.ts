import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import {
  JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS,
  javaScriptWorkerAdmissionSchema,
  javaScriptWorkerMessageSchema,
  javaScriptWorkerRequestSchema,
} from "./JavaScriptAnalysisWorkerProtocol.js";

const source = "export const observed = 1;";
const digest = createHash("sha256").update(source).digest("hex");
const frame = (value: unknown): string => `${JSON.stringify(value)}\n`;
const admission = (id: string) =>
  javaScriptWorkerAdmissionSchema.parse({
    id,
    semantic_result_budget_bytes: 0,
  });

const startServer = async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-js-server-framing-"));
  const serverUrl = new URL(
    "./JavaScriptAnalysisWorkerServer.ts",
    import.meta.url,
  ).href;
  const analyzerUrl = new URL(
    "../../domain/javascript/javascriptStaticAnalysis.ts",
    import.meta.url,
  ).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      `const { serveJavaScriptAnalysisWorker } = await import(${JSON.stringify(serverUrl)});
       const { analyzeJavaScriptStaticSource } = await import(${JSON.stringify(analyzerUrl)});
       await serveJavaScriptAnalysisWorker(async (file, capacity, callbacks) => {
         await callbacks.checkpoint(analyzeJavaScriptStaticSource(file.text.value));
         return null;
       });`,
    ],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const messages = lines[Symbol.asyncIterator]();
  return {
    child,
    closed,
    stderr: () => stderr,
    next: async () => {
      const next = await messages.next();
      if (next.done) throw new Error(`Worker output ended: ${stderr}`);
      return javaScriptWorkerMessageSchema.parse(JSON.parse(next.value));
    },
    request: async () => {
      const id = randomUUID();
      await writeFile(join(root, `${id}.source`), source, { flag: "wx" });
      return javaScriptWorkerRequestSchema.parse({
        id,
        unknown_budget: 100,
        node_budget: 100,
        text_sha256: digest,
        file: {
          path: "app.mjs",
          sha256: digest,
          container_sha256: digest,
          bytes: Buffer.byteLength(source),
          inventory_artifact_id: "server-framing-source",
          kind: "javascript",
          unpacked: false,
        },
      });
    },
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
      lines.close();
      await rm(root, { recursive: true, force: true });
    },
  };
};

it("consumes fragmented CRLF admission and coalesced next-job frames in order", async () => {
  const server = await startServer();
  try {
    expect(await server.next()).toMatchObject({ kind: "ready" });
    const first = await server.request();
    const second = await server.request();
    server.child.stdin.write(frame(first));
    expect(await server.next()).toMatchObject({ kind: "static", id: first.id });
    const encoded = JSON.stringify(admission(first.id));
    server.child.stdin.write(encoded.slice(0, 12));
    server.child.stdin.write(`${encoded.slice(12)}\r`);
    server.child.stdin.write(
      `\n${frame(second)}${frame(admission(second.id))}`,
    );
    expect(await server.next()).toMatchObject({
      kind: "phase",
      id: first.id,
      phase: "transfer",
    });
    expect(await server.next()).toEqual({
      kind: "complete",
      id: first.id,
      descriptor: null,
    });
    expect(await server.next()).toMatchObject({
      kind: "static",
      id: second.id,
    });
    expect(await server.next()).toMatchObject({
      kind: "phase",
      id: second.id,
      phase: "transfer",
    });
    expect(await server.next()).toEqual({
      kind: "complete",
      id: second.id,
      descriptor: null,
    });
    server.child.stdin.end();
    expect((await server.closed)[0]).toBe(0);
  } finally {
    await server.close();
  }
});

it("drains oversized checkpoint admission, reports output failure, and serves the next job", async () => {
  const server = await startServer();
  try {
    await server.next();
    const first = await server.request();
    const second = await server.request();
    server.child.stdin.write(frame(first));
    expect(await server.next()).toMatchObject({ kind: "static", id: first.id });
    server.child.stdin.write(
      "x".repeat(JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS.protocolBytes),
    );
    server.child.stdin.write(
      `x\n${frame(second)}${frame(admission(second.id))}`,
    );
    expect(await server.next()).toEqual({
      kind: "failure",
      id: first.id,
      reason: "output",
      resource: null,
      limits: null,
      message: "JavaScript worker admission frame is missing or oversized",
    });
    expect(await server.next()).toMatchObject({
      kind: "static",
      id: second.id,
    });
    expect(await server.next()).toMatchObject({
      kind: "phase",
      id: second.id,
      phase: "transfer",
    });
    expect(await server.next()).toEqual({
      kind: "complete",
      id: second.id,
      descriptor: null,
    });
    server.child.stdin.end();
    expect((await server.closed)[0]).toBe(0);
  } finally {
    await server.close();
  }
});

it("reports missing checkpoint admission as output failure at stdin EOF", async () => {
  const server = await startServer();
  try {
    await server.next();
    const request = await server.request();
    server.child.stdin.write(frame(request));
    expect(await server.next()).toMatchObject({
      kind: "static",
      id: request.id,
    });
    server.child.stdin.end();
    expect(await server.next()).toMatchObject({
      kind: "failure",
      id: request.id,
      reason: "output",
      resource: null,
      message: "JavaScript worker admission frame is missing or oversized",
    });
    expect((await server.closed)[0]).toBe(0);
  } finally {
    await server.close();
  }
});

it.each(["lf", "eof", "open"] as const)(
  "rejects oversized initial requests with %s input",
  async (boundary) => {
    const server = await startServer();
    try {
      await server.next();
      const oversized = "x".repeat(
        JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS.protocolBytes + 1,
      );
      if (boundary === "open") server.child.stdin.write(oversized);
      else server.child.stdin.end(oversized + (boundary === "lf" ? "\n" : ""));
      expect((await server.closed)[0]).not.toBe(0);
      expect(server.stderr()).toContain(
        "RangeError: JavaScript worker request exceeds its byte budget",
      );
    } finally {
      await server.close();
    }
  },
);
