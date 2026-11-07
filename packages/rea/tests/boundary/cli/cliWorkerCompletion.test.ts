import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createCliSessionFrameReader,
  encodeCliSessionFrame,
} from "../../support/cli/cliCommandSessionFrames.mjs";
import {
  processTest,
  waitForExit,
} from "../../support/process/processFixture.js";

const worker = fileURLToPath(
  new URL("../../support/cli/cliCommandSessionWorker.mjs", import.meta.url),
);

processTest(
  "keeps a real CLI worker frame failure nonzero when EOF joins command completion",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-cli-worker-completion-");
    const preload = join(root, "deny-response-frame.mjs");
    await writeFile(
      preload,
      `
const write = process.stdout.write.bind(process.stdout);
const failure = new Error("selected CLI response frame write failed");
process.stdout.write = (chunk, ...arguments_) => {
  const frame = Buffer.isBuffer(chunk)
    ? JSON.parse(chunk.subarray(4).toString("utf8"))
    : undefined;
  if (frame?.ready === true) return write(chunk, ...arguments_);
  const callback = arguments_.find((value) => typeof value === "function");
  const deny = () => callback(failure);
  if (process.stdin.readableEnded) setImmediate(deny);
  else process.stdin.once("end", () => setImmediate(deny));
  return true;
};
`,
    );
    const result = await processes.run(
      process.execPath,
      ["--import", preload, worker],
      {
        input: encodeCliSessionFrame({
          id: 1,
          arguments: ["--help"],
          cwd: root,
          env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
        }),
        timeoutMs: 15_000,
      },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stderr).toContain("selected CLI response frame write failed");
  },
);

processTest(
  "settles an active CLI response and skips queued work after malformed input",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-cli-worker-malformed-");
    const marker = join(root, "response-completed");
    const preload = join(root, "hold-response-frame.mjs");
    await writeFile(
      preload,
      `
import { writeFileSync } from "node:fs";
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...arguments_) => {
  const frame = Buffer.isBuffer(chunk)
    ? JSON.parse(chunk.subarray(4).toString("utf8"))
    : undefined;
  if (frame?.id !== 1 || frame.fatal === true) return write(chunk, ...arguments_);
  const callback = arguments_.find((value) => typeof value === "function");
  const continued = new Promise((resolve) => process.stdin.once("data", resolve));
  return write(chunk, (error) => {
    if (error) callback(error);
    else continued.then(() => {
      writeFileSync(${JSON.stringify(marker)}, "response completed");
      callback();
    });
  });
};
`,
    );
    const child = processes.spawn(process.execPath, [
      "--import",
      preload,
      worker,
    ]);
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const ids: number[] = [];
    const request = (id: number) =>
      encodeCliSessionFrame({
        id,
        arguments: ["--help"],
        cwd: root,
        env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
      });
    const reader = createCliSessionFrameReader((value: unknown) => {
      const frame = z
        .object({ ready: z.boolean().optional(), id: z.number().optional() })
        .parse(value);
      if (frame.ready === true) child.stdin.write(request(1));
      if (frame.id === undefined) return;
      ids.push(frame.id);
      if (frame.id === 1) {
        const malformed = Buffer.from([0, 0, 0, 1, 123]);
        child.stdin.write(Buffer.concat([request(2), malformed]));
      }
    });
    child.stdout.on("data", reader);

    expect(await waitForExit(child, 15_000), stderr).toBe(true);
    await closed;
    expect(child.signalCode, stderr).toBeNull();
    expect(child.exitCode, stderr).toBe(1);
    expect(stderr).toMatch(/JSON/u);
    expect(ids).toEqual([1]);
    expect(await readFile(marker, "utf8")).toBe("response completed");
  },
);

processTest(
  "publishes one fatal CLI response and does not dispatch commands queued behind it",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-cli-worker-fatal-");
    const child = processes.spawn(process.execPath, [worker]);
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const frames: unknown[] = [];
    child.stdout.on(
      "data",
      createCliSessionFrameReader((frame: unknown) => {
        frames.push(frame);
      }),
    );
    child.stdin.end(
      Buffer.concat([
        encodeCliSessionFrame({ id: 1, arguments: null, cwd: root, env: {} }),
        encodeCliSessionFrame({
          id: 2,
          arguments: ["--help"],
          cwd: root,
          env: { PATH: process.env.PATH ?? "", REA_LOG_LEVEL: "silent" },
        }),
      ]),
    );
    expect(await waitForExit(child, 15_000), stderr).toBe(true);
    await closed;
    expect(child.signalCode, stderr).toBeNull();
    expect(child.exitCode, stderr).toBe(1);
    expect(stderr).toContain(
      "CLI session command is missing its arguments, cwd, or environment",
    );
    expect(frames).toEqual([
      { ready: true },
      expect.objectContaining({ id: 1, fatal: true, exitCode: 1 }),
    ]);
  },
);
