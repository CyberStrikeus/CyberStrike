import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";

let directory: string | undefined;
const managers: GdbSessionManager[] = [];

afterEach(async () => {
  const closing = managers.splice(0);
  const outcomes = await Promise.allSettled(
    closing.map((manager) => manager.closeAll()),
  );
  const failures: unknown[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      managers.push(closing[index]!);
      failures.push(outcome.reason);
    }
  });
  if (failures.length > 0)
    throw new AggregateError(failures, "GDB queue cleanup failed");
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it("bounds active and queued GDB commands, including cancelled placeholders", async () => {
  directory = await mkdtemp(join(tmpdir(), "rea-gdb-command-queue-limit-"));
  const provider = join(directory, "fake-gdb-queue.mjs");
  const activePath = join(directory, "active-command");
  const releasePath = join(directory, "release-command");
  await writeFile(
    provider,
    `#!${process.execPath}
import { access, writeFile } from "node:fs/promises";
process.stdout.write("(gdb)\\n");
let input = "";
let firstConsoleCommand = true;
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary); input = input.slice(boundary + 1);
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    if (line.includes("-interpreter-exec console") && firstConsoleCommand) {
      firstConsoleCommand = false;
      await writeFile(${JSON.stringify(activePath)}, "active");
      for (;;) {
        try { await access(${JSON.stringify(releasePath)}); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
    }
    process.stdout.write(match[1] + (line.includes("-list-thread-groups") ? "^done,groups=[]\\n" : "^done\\n"));
  }
});
`,
  );
  await chmod(provider, 0o700);
  const manager = new GdbSessionManager({
    platform: "linux",
    environment: { REA_GDB_COMMAND: provider },
  });
  managers.push(manager);
  const started = await manager.start();
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  const active = manager.execute(started.value.session_id, "hold");
  let activeSeen = false;
  for (let attempt = 0; attempt < 100 && !activeSeen; attempt += 1) {
    try {
      await readFile(activePath, "utf8");
      activeSeen = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  expect(activeSeen).toBe(true);

  const controllers = Array.from({ length: 15 }, () => new AbortController());
  const queued = controllers.map((controller, index) =>
    manager.execute(
      started.value.session_id,
      `queued-${index}`,
      controller.signal,
    ),
  );
  const safetyRelease = setTimeout(() => {
    void writeFile(releasePath, "safety release");
  }, 250);
  const overflow = await manager.execute(started.value.session_id, "overflow");
  clearTimeout(safetyRelease);
  expect(overflow).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      operation: "gdb_console",
      resource: "transport",
      reportedLimits: {
        max_pending_commands: 16,
        active_or_queued_commands: 16,
      },
    },
  });

  for (const controller of controllers) controller.abort();
  const cancelled = await Promise.all(queued);
  expect(cancelled).toHaveLength(15);
  expect(
    cancelled.every(
      (result) => !result.ok && result.error._tag === "AnalysisCancelledError",
    ),
  ).toBe(true);
  const cancellationSafetyRelease = setTimeout(() => {
    void writeFile(releasePath, "safety release after cancellation");
  }, 250);
  try {
    await expect(
      manager.execute(
        started.value.session_id,
        "cannot-bypass-cancelled-placeholders",
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        reportedLimits: { active_or_queued_commands: 16 },
      },
    });
  } finally {
    clearTimeout(cancellationSafetyRelease);
  }
  await writeFile(releasePath, "release");
  expect((await active).ok).toBe(true);
  const admittedAfterDrain = await manager.execute(
    started.value.session_id,
    "admitted-after-drain",
  );
  expect(admittedAfterDrain.ok).toBe(true);
  await expect(
    manager.execute(started.value.session_id, "after-drain"),
  ).resolves.toMatchObject({
    ok: true,
    value: { result: { completion_status: "complete" } },
  });
});
