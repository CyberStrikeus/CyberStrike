import { ProviderProcessSupervisor } from "../../src/process/ProviderProcess.js";
import { systemUpdateHost } from "../../src/application/UpdateRuntime.js";
import {
  UpdateCommandRunner,
  UPDATE_COMMAND_OUTPUT_BYTES,
} from "../../src/application/UpdateCommandRunner.js";
import { spawn, type ChildProcess } from "node:child_process";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Writable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const execution = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("cross-spawn", () => ({ default: execution.spawn }));
let child: ChildProcess | undefined;
beforeEach(() => {
  execution.spawn.mockReset();
  execution.spawn.mockImplementation(
    (
      executable: string,
      args: readonly string[],
      options: Parameters<typeof spawn>[2],
    ) => {
      if (executable !== process.execPath)
        throw new Error("Only owned Node fixtures may execute");
      child = spawn(executable, [...args], options);
      return child;
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (
    child !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    const closed = new Promise<void>((resolve) => {
      child!.once("close", resolve);
    });
    child.kill("SIGKILL");
    await closed;
  }
  child = undefined;
});
const command = (script: string) => [process.execPath, "-e", script];

it.each(["stdout", "stderr"])(
  "rejects incomplete %s metadata after draining the command",
  async (stream) => {
    const result = await updateCommands.runProbe(
      command(
        `process.stdout.write('"6.5.0"');process.${stream}.write(' '.repeat(${UPDATE_COMMAND_OUTPUT_BYTES}))`,
      ),
      process.env,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        detail: expect.stringContaining("complete-output retention budget"),
      },
    });
    expect(child?.exitCode).toBe(0);
  },
);

it("accepts exactly the combined byte budget and preserves split UTF-8", async () => {
  const result = await updateCommands.runProbe(
    command(
      `process.stdout.write('x'.repeat(${UPDATE_COMMAND_OUTPUT_BYTES - 3}));const b=Buffer.from('界');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),10)`,
    ),
    process.env,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(Buffer.byteLength(result.value)).toBe(UPDATE_COMMAND_OUTPUT_BYTES);
    expect(result.value.endsWith("界")).toBe(true);
  }
});

it("refuses malformed UTF-8 instead of interpreting replacement text", async () => {
  expect(
    await updateCommands.runProbe(
      command("process.stdout.write(Buffer.from([255]))"),
      process.env,
    ),
  ).toMatchObject({
    ok: false,
    error: { detail: expect.stringContaining("invalid UTF-8") },
  });
});

it("waits for physical close after an early process error", async () => {
  let settled = false;
  const pending = updateCommands
    .runProbe(
      command("setTimeout(()=>process.stdout.write('late output'),50)"),
      process.env,
    )
    .then((result) => {
      settled = true;
      return result;
    });
  await nextTurn();
  child!.emit("error", new Error("controlled process error"));
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(await pending).toEqual({
    ok: false,
    error: {
      kind: "execution",
      detail: expect.stringContaining("controlled process error"),
    },
  });
  expect(child?.exitCode).toBe(0);
});

it("joins the final human progress write before reporting success", async () => {
  let acknowledge!: (cause?: Error | null) => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      acknowledge = callback;
      started();
    },
  });
  vi.spyOn(process, "stderr", "get").mockReturnValue(
    destination as typeof process.stderr,
  );
  let settled = false;
  const pending = updateCommands
    .runProbe(
      command("process.stdout.write('final progress')"),
      process.env,
      "human",
    )
    .then((result) => {
      settled = true;
      return result;
    });
  await nextTurn();
  const closed = new Promise<void>((resolve) => {
    child!.once("close", resolve);
  });
  await writing;
  await closed;
  expect(settled).toBe(false);
  acknowledge(new Error("final progress refused"));
  expect(await pending).toMatchObject({
    ok: false,
    error: { detail: expect.stringContaining("final progress refused") },
  });
  expect(destination.writableEnded).toBe(false);
  await nextTurn();
  expect(destination.listenerCount("error")).toBe(0);
});

let updateCommands: UpdateCommandRunner;
beforeEach(() => {
  updateCommands = new UpdateCommandRunner();
});
afterEach(async () => {
  await updateCommands.close();
});

/** Observe readiness at launch, before the fixture can emit its first byte. */
const nextChildReady = (script?: string): Promise<void> =>
  new Promise((resolve) => {
    execution.spawn.mockImplementationOnce(
      (
        executable: string,
        args: readonly string[],
        options: Parameters<typeof spawn>[2],
      ) => {
        child = spawn(
          script === undefined ? executable : process.execPath,
          script === undefined ? [...args] : ["-e", script],
          options,
        );
        child.stdout!.once("data", () => resolve());
        return child;
      },
    );
  });
const hangingProbe =
  "process.stdout.write('probe-ready');setInterval(()=>{},1000)";

it("stops and joins metadata discovery when the update host closes", async () => {
  const ready = nextChildReady(hangingProbe);
  const host = systemUpdateHost(process.cwd(), process.cwd(), process.env);
  const probing = host.installation();
  await ready;
  expect(child?.exitCode).toBeNull();
  expect(host.close).toBeTypeOf("function");
  if (host.close === undefined) throw new Error("Missing update host close");
  expect(await host.close()).toBeUndefined();
  // Close must join the probe itself, not rely on the later probe deadline.
  expect(child?.signalCode).not.toBeNull();
  await probing;
});

it("bounds a stalled metadata probe and keeps the runner usable", async () => {
  await updateCommands.close();
  updateCommands = new UpdateCommandRunner(2000);
  const ready = nextChildReady();
  const pending = updateCommands.runProbe(command(hangingProbe), process.env);
  await ready;
  const result = await pending;
  expect(result).toMatchObject({
    ok: false,
    error: { detail: expect.stringContaining("timed out") },
  });
  if (!result.ok) expect(result.error.detail).toContain("probe-ready");
  expect(child?.signalCode).not.toBeNull();
  expect(
    await updateCommands.runProbe(
      command("console.log('recovered')"),
      process.env,
    ),
  ).toEqual({ ok: true, value: "recovered" });
});

it("does not launch probes after close, including a queued launch", async () => {
  const queued = updateCommands.runProbe(command(hangingProbe), process.env);
  await updateCommands.close();
  expect(await queued).toMatchObject({ ok: false });
  expect(
    await updateCommands.runProbe(command(hangingProbe), process.env),
  ).toMatchObject({ ok: false });
  expect(execution.spawn).not.toHaveBeenCalled();
});

it("retains incomplete probe cleanup until a later close succeeds", async () => {
  const ready = nextChildReady();
  const pending = updateCommands.runProbe(command(hangingProbe), process.env);
  await ready;
  const stop = vi
    .spyOn(ProviderProcessSupervisor.prototype, "stop")
    .mockResolvedValue({
      status: "incomplete",
      reason: "controlled stop refusal",
    });
  try {
    await expect(updateCommands.close()).rejects.toThrow(
      /cleanup remains incomplete/u,
    );
    expect(await pending).toMatchObject({
      ok: false,
      error: { detail: expect.stringContaining("Cleanup incomplete") },
    });
    expect(child?.signalCode).toBeNull();
  } finally {
    stop.mockRestore();
  }
  await expect(updateCommands.close()).resolves.toBeUndefined();
  expect(child?.signalCode).not.toBeNull();
});

it("joins an install past the metadata deadline without cancelling it", async () => {
  await updateCommands.close();
  updateCommands = new UpdateCommandRunner(30);
  const ready = nextChildReady();
  const pending = updateCommands.runInstall(
    command(
      "process.stdout.write('install-ready');setTimeout(()=>console.log('done'),100)",
    ),
    process.env,
    "structured",
  );
  await ready;
  await updateCommands.close();
  expect(await pending).toEqual({ ok: true, value: "" });
  expect(child?.exitCode).toBe(0);
});

it("preserves cancellation during final progress acknowledgement", async () => {
  let acknowledge!: () => void;
  let writing!: () => void;
  const started = new Promise<void>((resolve) => {
    writing = resolve;
  });
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      acknowledge = callback;
      writing();
    },
  });
  vi.spyOn(process, "stderr", "get").mockReturnValue(
    destination as typeof process.stderr,
  );
  const pending = updateCommands.runProbe(
    command("process.stdout.write('completed metadata')"),
    process.env,
    "human",
  );
  await started;
  const closing = updateCommands.close();
  acknowledge();
  expect(await pending).toMatchObject({
    ok: false,
    error: { detail: expect.stringContaining("cancelled") },
  });
  await closing;
});
