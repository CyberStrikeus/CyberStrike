import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";

import { analysisCliErrorEnvelopeSchema } from "../../../src/contracts/errorSchemas.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { silentLogger } from "../../../src/logger.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const PROGRESS_INTERVAL_MS = 100;

const progressLineSchema = z.object({
  rea_progress: z.object({
    phase: z.string(),
    completed: z.number().nonnegative(),
    total: z.null(),
    message: z.string(),
    sequence: z.number().int().positive(),
    terminal: z.boolean().optional(),
  }),
});

const progressMessageSchema = z.object({
  elapsed_ms: z.number().int().nonnegative(),
  frames: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative(),
  interactions: z.number().int().nonnegative(),
  disposition: z
    .enum(["exited", "timeout", "idle_timeout", "cancelled", "failed"])
    .optional(),
  owned_process_group: z
    .enum(["cleaned", "failed", "unverified", "not_required"])
    .optional(),
  terminal_renderer: z
    .enum(["cleaned", "failed", "unverified", "not_required"])
    .optional(),
  temporary_root: z
    .enum(["cleaned", "failed", "unverified", "not_required"])
    .optional(),
});

type ProgressLine = z.infer<typeof progressLineSchema>["rea_progress"];
type ParsedProgress = ProgressLine & {
  readonly details: z.infer<typeof progressMessageSchema>;
};

const parseProgressMessage = (message: string) => {
  const matched =
    /^elapsed_ms=(?<elapsed_ms>\d+) frames=(?<frames>\d+) samples=(?<samples>\d+) interactions=(?<interactions>\d+)(?: disposition=(?<disposition>exited|timeout|idle_timeout|cancelled|failed))?(?: owned_process_group=(?<owned_process_group>cleaned|failed|unverified|not_required) terminal_renderer=(?<terminal_renderer>cleaned|failed|unverified|not_required) temporary_root=(?<temporary_root>cleaned|failed|unverified|not_required))?$/u.exec(
      message,
    );
  if (matched?.groups === undefined)
    throw new Error(`Progress message is not capture status: ${message}`);
  return progressMessageSchema.parse({
    elapsed_ms: Number(matched.groups.elapsed_ms),
    frames: Number(matched.groups.frames),
    samples: Number(matched.groups.samples),
    interactions: Number(matched.groups.interactions),
    ...(matched.groups.disposition === undefined
      ? {}
      : { disposition: matched.groups.disposition }),
    ...(matched.groups.owned_process_group === undefined
      ? {}
      : {
          owned_process_group: matched.groups.owned_process_group,
          terminal_renderer: matched.groups.terminal_renderer,
          temporary_root: matched.groups.temporary_root,
        }),
  });
};

interface CliCapture {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly lines: readonly {
    readonly update: ParsedProgress;
  }[];
}

const writeScenario = async (
  prefix: string,
  scenario: Readonly<Record<string, unknown>>,
): Promise<string> => {
  const root = await createTestTempDirectory(prefix);
  const path = join(root, "scenario.json");
  await writeFile(path, JSON.stringify(scenario));
  return path;
};

const runCaptureCli = async (
  scenarioPath: string,
  options: {
    readonly stopOnRunning?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CliCapture> => {
  const child = spawn(
    process.execPath,
    ["scripts/rea.mjs", "capture-process", scenarioPath, "--json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.env === undefined
        ? {}
        : { env: { ...process.env, ...options.env } }),
    },
  );
  let stdout = "";
  let stderr = "";
  let pending = "";
  const lines: string[] = [];
  let sawRunning: (() => void) | undefined;
  const running = options.stopOnRunning
    ? new Promise<void>((resolve) => {
        sawRunning = resolve;
      })
    : undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    pending += chunk.toString();
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length === 0) continue;
      lines.push(line);
      if (line.includes('"phase":"running"')) sawRunning?.();
    }
  });
  const closed = new Promise<{ code: number | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code }));
  });
  if (running !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const appeared = await Promise.race([
      running.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 8_000);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    if (!appeared) {
      child.kill("SIGKILL");
      await closed;
      throw new Error(
        `capture produced no running progress on stderr:\n${lines.join("\n")}`,
      );
    }
    child.kill("SIGINT");
  }
  const result = await closed;
  if (pending.length > 0) lines.push(pending);
  stderr = lines.join("\n");
  return {
    stdout,
    stderr,
    exitCode: result.code,
    lines: lines.map((line) => {
      const update = progressLineSchema.parse(JSON.parse(line)).rea_progress;
      return {
        update: { ...update, details: parseProgressMessage(update.message) },
      };
    }),
  };
};

const assertMonotonic = (updates: readonly ParsedProgress[]): void => {
  for (const [index, update] of updates.entries()) {
    expect(update.total).toBeNull();
    expect(update.message).not.toMatch(/%|\bpercent/iu);
    const previous = updates[index - 1];
    if (previous === undefined) continue;
    expect(update.completed).toBeGreaterThanOrEqual(previous.completed);
    expect(update.sequence).toBe(previous.sequence + 1);
  }
};

const assertRateBound = (
  intermediateCount: number,
  elapsedMs: number,
): void => {
  // Pipe/transport buffering can deliver correctly spaced sends together.
  // Exact send spacing belongs to the reporter's controlled-clock test.
  expect(intermediateCount).toBeGreaterThan(1);
  expect(intermediateCount).toBeLessThanOrEqual(
    Math.floor(elapsedMs / PROGRESS_INTERVAL_MS) + 1,
  );
};

const childScript = (source: string) => ["-e", source];

const connectProgressClient = async (
  recordNotifications = false,
): Promise<{
  readonly client: Client;
  readonly notifications: Array<{
    readonly params: { readonly message?: string | undefined };
  }>;
}> => {
  const session = createTestBinarySession(() => {
    throw new Error("Process capture must not launch a binary provider");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: { logger: silentLogger },
    clientIdentity: { name: "process-capture-progress", version: "1" },
  });
  const notifications: Array<{
    readonly params: { readonly message?: string | undefined };
  }> = [];
  if (recordNotifications) {
    client.setNotificationHandler("notifications/progress", (notification) => {
      notifications.push(notification);
    });
  }
  return { client, notifications };
};

itWithCaptureCapability(
  "keeps capture Evidence on stdout and live status on stderr for a sparse child",
  async () => {
    const scenario = await writeScenario("rea-process-progress-sparse-", {
      executable: process.execPath,
      arguments: childScript(
        "process.stdout.write('SPARSE_CHILD_STARTED\\n'); setTimeout(() => process.stdout.write('SPARSE_CHILD_DONE\\n'), 1600);",
      ),
      timeout_ms: 10_000,
      idle_timeout_ms: 10_000,
    });
    const capture = await runCaptureCli(scenario);
    expect(capture.exitCode, capture.stderr).toBe(0);
    expect(capture.stdout).not.toContain("rea_progress");
    const evidence = parseEvidence(JSON.parse(capture.stdout));
    const recorded = parseProcessCapture(evidence.normalized_result);
    expect(evidence).toMatchObject({
      operation: "capture_process_scenario",
      predicate_type: "rea.process-capture",
    });
    const terminalText = recorded.frames.map(({ data }) => data).join("");
    expect(terminalText).toContain("SPARSE_CHILD_STARTED");
    expect(terminalText).toContain("SPARSE_CHILD_DONE");
    expect(capture.stderr).not.toContain("SPARSE_CHILD_STARTED");
    expect(capture.stderr).not.toContain("SPARSE_CHILD_DONE");
    const updates = capture.lines.map(({ update }) => update);
    assertMonotonic(updates);
    const running = updates.filter(({ phase }) => phase === "running");
    expect(running.length).toBeGreaterThanOrEqual(3);
    const elapsed = running.map(({ details }) => details.elapsed_ms);
    expect(Math.max(...elapsed) - Math.min(...elapsed)).toBeGreaterThanOrEqual(
      1_000,
    );
    // Frames count retained PTY chunks; child writes may be split or coalesced.
    for (const [index, update] of running.entries()) {
      expect(update.details.frames).toBeLessThanOrEqual(recorded.frames.length);
      const previous = running[index - 1];
      if (previous !== undefined)
        expect(update.details.frames).toBeGreaterThanOrEqual(
          previous.details.frames,
        );
    }
    assertRateBound(
      updates.filter(({ terminal }) => terminal !== true).length,
      updates.at(-1)?.details.elapsed_ms ?? 0,
    );
    expect(updates.at(-1)).toMatchObject({
      phase: "cleanup",
      terminal: true,
      details: {
        disposition: "exited",
        frames: recorded.frames.length,
        samples: recorded.process_samples.length,
        interactions: recorded.interaction_events.length,
        owned_process_group: "cleaned",
        terminal_renderer: "cleaned",
        temporary_root: "cleaned",
      },
    });
  },
  30_000,
);

itWithCaptureCapability(
  "reports startup cleanup coverage when temporary storage is unavailable",
  async () => {
    const scenario = await writeScenario(
      "rea-process-progress-prepare-failed-",
      {
        executable: process.execPath,
        arguments: childScript("process.stdout.write('ready\\n')"),
        timeout_ms: 5_000,
      },
    );
    const missingTempRoot = join(
      await createTestTempDirectory("rea-process-progress-missing-tmpdir-"),
      "missing",
    );
    const capture = await runCaptureCli(scenario, {
      env: {
        TMPDIR: missingTempRoot,
        TMP: missingTempRoot,
        TEMP: missingTempRoot,
      },
    });

    expect(capture.exitCode).toBe(1);
    const error = analysisCliErrorEnvelopeSchema.parse(
      JSON.parse(capture.stdout),
    );
    expect(error).toMatchObject({
      code: "process_capture_failed",
      details: { execution_failure: expect.stringContaining(missingTempRoot) },
    });
    // Darwin prepares its native inspector before acquiring capture resources.
    // Other hosts reach the capture root allocation, whose failure is accounted.
    const cleanupState =
      process.platform === "darwin" ? "unverified" : "not_required";
    expect(capture.lines.at(-1)?.update).toMatchObject({
      phase: "cleanup",
      terminal: true,
      details: {
        disposition: "failed",
        owned_process_group: cleanupState,
        terminal_renderer: cleanupState,
        temporary_root: cleanupState,
      },
    });
  },
  30_000,
);

itWithCaptureCapability(
  "bounds stderr progress while a busy child emits many output chunks",
  async () => {
    const scenario = await writeScenario("rea-process-progress-busy-", {
      executable: process.execPath,
      arguments: childScript(
        "let count = 0; const timer = setInterval(() => { process.stdout.write('BUSY_CHILD_LINE\\n'); count += 1; if (count >= 50) clearInterval(timer); }, 12);",
      ),
      timeout_ms: 10_000,
      idle_timeout_ms: 10_000,
    });
    const capture = await runCaptureCli(scenario);
    expect(capture.exitCode, capture.stderr).toBe(0);
    const evidence = parseEvidence(JSON.parse(capture.stdout));
    const recorded = parseProcessCapture(evidence.normalized_result);
    const occurrences =
      recorded.frames
        .map(({ data }) => data)
        .join("")
        .split("BUSY_CHILD_LINE").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(40);
    expect(capture.stderr).not.toContain("BUSY_CHILD_LINE");
    const updates = capture.lines.map(({ update }) => update);
    assertMonotonic(updates);
    expect(updates.length).toBeLessThan(occurrences / 2);
    const nonTerminal = capture.lines.filter(
      ({ update }) => update.terminal !== true,
    );
    assertRateBound(
      nonTerminal.length,
      updates.at(-1)?.details.elapsed_ms ?? 0,
    );
    expect(
      Math.max(...updates.map(({ details }) => details.frames)),
    ).toBeGreaterThanOrEqual(10);
    expect(updates.at(-1)?.details.owned_process_group).toBe("cleaned");
  },
  30_000,
);

itWithCaptureCapability(
  "reports timeout cleanup on stderr without changing Evidence shape",
  async () => {
    const scenario = await writeScenario("rea-process-progress-timeout-", {
      executable: process.execPath,
      arguments: childScript("setInterval(() => undefined, 1000);"),
      timeout_ms: 700,
      idle_timeout_ms: 10_000,
    });
    const capture = await runCaptureCli(scenario);
    expect(capture.exitCode, capture.stderr).toBe(0);
    const evidence = parseEvidence(JSON.parse(capture.stdout));
    const recorded = parseProcessCapture(evidence.normalized_result);
    expect(recorded.exit.reason).toBe("timeout");
    expect(capture.stdout).not.toContain("rea_progress");
    const updates = capture.lines.map(({ update }) => update);
    assertMonotonic(updates);
    expect(updates.at(-1)).toMatchObject({
      phase: "cleanup",
      terminal: true,
      details: {
        disposition: "timeout",
        owned_process_group: "cleaned",
      },
    });
  },
  30_000,
);

itWithCaptureCapability(
  "reports cleanup status on stderr when capture is cancelled",
  async () => {
    const scenario = await writeScenario("rea-process-progress-cancel-", {
      executable: process.execPath,
      arguments: childScript("setInterval(() => undefined, 1000);"),
      timeout_ms: 15_000,
      idle_timeout_ms: 15_000,
    });
    const capture = await runCaptureCli(scenario, { stopOnRunning: true });
    expect(capture.exitCode).toBe(130);
    expect(
      analysisCliErrorEnvelopeSchema.parse(JSON.parse(capture.stdout)),
    ).toMatchObject({
      code: "cancelled",
      details: { operation: "process_capture", cleanup: "complete" },
    });
    expect(capture.stdout).not.toContain("rea_progress");
    const updates = capture.lines.map(({ update }) => update);
    assertMonotonic(updates);
    expect(updates.at(-1)).toMatchObject({
      phase: "cleanup",
      terminal: true,
      details: {
        disposition: "cancelled",
        owned_process_group: "cleaned",
      },
    });
  },
  30_000,
);

itWithCaptureCapability(
  "forwards live capture progress only when the MCP client supplies a token",
  async () => {
    const silentClient = await connectProgressClient(true);
    const { client: tokenClient } = await connectProgressClient();
    const { notifications } = silentClient;
    const silent = await silentClient.client.callTool({
      name: "capture_process_scenario",
      arguments: {
        executable: process.execPath,
        arguments: childScript("process.stdout.write('SILENT_CHILD_OK\\n');"),
        timeout_ms: 10_000,
        idle_timeout_ms: 10_000,
      },
    });
    expect(silent.isError, JSON.stringify(silent)).not.toBe(true);
    expect(notifications).toEqual([]);
    const evidence = toolContract(
      "capture_process_scenario",
    ).outputSchema.parse(silent.structuredContent);
    expect(
      evidence.normalized_result.frames.map((frame) => frame.data).join(""),
    ).toContain("SILENT_CHILD_OK");

    const progress: Array<{
      readonly progress: number;
      readonly total: number | undefined;
      readonly message: string | undefined;
    }> = [];
    const captured = await tokenClient.callTool(
      {
        name: "capture_process_scenario",
        arguments: {
          executable: process.execPath,
          arguments: childScript(
            "process.stdout.write('TOKEN_CHILD_STARTED\\n'); setTimeout(() => process.stdout.write('TOKEN_CHILD_DONE\\n'), 1200);",
          ),
          timeout_ms: 10_000,
          idle_timeout_ms: 10_000,
        },
      },
      {
        onprogress: (update) => {
          progress.push({
            progress: update.progress,
            total: update.total,
            message: update.message,
          });
        },
      },
    );
    expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.every(({ total }) => total === undefined)).toBe(true);
    for (const [index, update] of progress.entries()) {
      const previous = progress[index - 1];
      if (previous !== undefined)
        expect(update.progress).toBeGreaterThanOrEqual(previous.progress);
      expect(update.message ?? "").not.toContain("TOKEN_CHILD_STARTED");
      expect(update.message ?? "").not.toContain("TOKEN_CHILD_DONE");
    }
    const messages = progress.map(({ message }) => message ?? "");
    expect(messages.some((message) => message.startsWith("running:"))).toBe(
      true,
    );
    expect(messages.at(-1)).toContain("cleanup:");
    expect(messages.at(-1)).toContain("owned_process_group=cleaned");
    expect(messages.at(-1)).toContain("disposition=exited");
    const nonTerminal = progress.slice(0, -1);
    assertRateBound(
      nonTerminal.length,
      parseProgressMessage((messages.at(-1) ?? "").slice("cleanup: ".length))
        .elapsed_ms,
    );
    const tokenEvidence = toolContract(
      "capture_process_scenario",
    ).outputSchema.parse(captured.structuredContent);
    const output = tokenEvidence.normalized_result.frames
      .map((frame) => frame.data)
      .join("");
    expect(output).toContain("TOKEN_CHILD_STARTED");
    expect(output).toContain("TOKEN_CHILD_DONE");
    expect(tokenEvidence.normalized_result.exit).toMatchObject({
      reason: "exited",
      code: 0,
    });
  },
  30_000,
);

itWithCaptureCapability(
  "reports timeout and cancellation cleanup through MCP progress",
  async () => {
    const { client } = await connectProgressClient();
    const timeoutProgress: Array<{
      readonly message: string | undefined;
      readonly total: number | undefined;
    }> = [];
    const timedOut = await client.callTool(
      {
        name: "capture_process_scenario",
        arguments: {
          executable: process.execPath,
          arguments: childScript("setInterval(() => undefined, 1000);"),
          timeout_ms: 600,
          idle_timeout_ms: 10_000,
        },
      },
      {
        onprogress: (update) => {
          timeoutProgress.push({
            message: update.message,
            total: update.total,
          });
        },
      },
    );
    expect(timedOut.isError, JSON.stringify(timedOut)).not.toBe(true);
    const timedOutEvidence = toolContract(
      "capture_process_scenario",
    ).outputSchema.parse(timedOut.structuredContent);
    expect(timedOutEvidence.normalized_result.exit.reason).toBe("timeout");
    expect(timeoutProgress.every(({ total }) => total === undefined)).toBe(
      true,
    );
    expect(timeoutProgress.at(-1)?.message).toContain("disposition=timeout");
    expect(timeoutProgress.at(-1)?.message).toContain(
      "owned_process_group=cleaned",
    );

    const cancelling = await connectProgressClient(true);
    // Prepare the SDK's full output-schema cache before timing capture control.
    await cancelling.client.callTool({ name: "binary_session", arguments: {} });
    const controller = new AbortController();
    const stall = setTimeout(() => controller.abort(), 5_000);
    onTestFinished(() => clearTimeout(stall));
    const call = cancelling.client.callTool(
      {
        name: "capture_process_scenario",
        arguments: {
          executable: process.execPath,
          arguments: childScript("setInterval(() => undefined, 1000);"),
          timeout_ms: 15_000,
          idle_timeout_ms: 15_000,
        },
        _meta: { progressToken: "capture-cancel" },
      },
      { signal: controller.signal },
    );
    const completion = call.then(
      (reply) => ({ kind: "reply" as const, reply }),
      (cause: unknown) => ({ kind: "error" as const, cause }),
    );
    try {
      await expect
        .poll(
          () =>
            cancelling.notifications.some((note) =>
              note.params.message?.startsWith("running:"),
            ),
          { timeout: 4_000 },
        )
        .toBe(true);
      controller.abort();
      const outcome = await completion;
      if (outcome.kind !== "error")
        throw new Error("Cancelled capture must reject its client wait");
      expect(outcome.cause).toMatchObject({
        message: expect.stringMatching(/abort/iu),
      });
    } finally {
      clearTimeout(stall);
      controller.abort();
      await completion;
    }
    // Cancellation ends the client wait before the server releases its tree.
    // Bound the notification wait so a missing cleanup event reaches teardown.
    const cleanupMessage = () =>
      cancelling.notifications
        .map((note) => note.params.message)
        .find((message) => message?.startsWith("cleanup:"));
    await expect.poll(cleanupMessage, { timeout: 15_000 }).toBeDefined();
    expect(cleanupMessage()).toContain("disposition=cancelled");
    expect(cleanupMessage()).toContain("owned_process_group=cleaned");
    expect(JSON.stringify(cancelling.notifications)).not.toMatch(
      /setInterval|CHILD/u,
    );
  },
  30_000,
);
