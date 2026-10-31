import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";

import {
  execFileBytes,
  execFileOutput,
  execFileOutputFailure,
} from "./ExecFileOutput.js";

const realSetTimeout = globalThis.setTimeout;

const inlineJavaScriptCharMap: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "/": "\\u002F",
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function escapeUnsafeCharsForInlineJavaScript(value: string): string {
  return value.replace(
    /[<>/\\\b\f\n\r\t\0\u2028\u2029]/g,
    (character) => inlineJavaScriptCharMap[character] ?? character,
  );
}

const waitForFile = async (path: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return true;
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
  return access(path).then(
    () => true,
    () => false,
  );
};

it.each([undefined, "SIGTERM"] as const)(
  "retains native spawn error facts with stop signal %s",
  async (stopSignal) => {
    const directory = await createTestTempDirectory("rea-exec-missing-");
    const command = join(directory, "missing-executable");
    await expect(
      execFileBytes(
        command,
        ["operand"],
        stopSignal === undefined ? {} : { stopSignal },
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
      path: command,
      spawnargs: ["operand"],
      cmd: `${command} operand`,
      stdout: "",
      stderr: "",
    });
  },
);

it.each([undefined, "SIGTERM"] as const)(
  "closes unused command input with stop signal %s",
  async (stopSignal) => {
    const result = await execFileOutput(
      process.execPath,
      [
        "-e",
        'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("input closed"));',
      ],
      { timeout: 2_000, ...(stopSignal === undefined ? {} : { stopSignal }) },
    );
    expect(result.stdout).toBe("input closed");
  },
);

it("rejects a lifetime pipe without a stoppable command", async () => {
  await expect(
    execFileOutput(process.execPath, ["-e", "process.exit(0)"], {
      lifetimePipe: true,
    }),
  ).rejects.toThrow("lifetimePipe requires stopSignal");
});

describe("execFileOutput", () => {
  it("ignores non-Error and incomplete failure metadata", () => {
    expect(execFileOutputFailure("failure")).toBeUndefined();
    expect(execFileOutputFailure(new Error("failure"))).toBeUndefined();
  });

  it("recognizes the execFile output limit code as truncated output", () => {
    const failure = Object.assign(new Error("output limit"), {
      stdout: "partial stdout",
      stderr: "partial stderr",
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });

    expect(execFileOutputFailure(failure)?.outputTruncated).toBe(true);
  });

  it.each([undefined, "SIGTERM"] as const)(
    "preserves captured bytes with stop signal %s",
    async (stopSignal) => {
      const result = await execFileBytes(
        process.execPath,
        [
          "-e",
          "process.stdout.write(Buffer.from([0x00, 0xff, 0x41])); process.stderr.write(Buffer.from([0xfe]));",
        ],
        stopSignal === undefined ? {} : { stopSignal },
      );

      expect(
        Buffer.compare(result.stdout, Buffer.from([0x00, 0xff, 0x41])),
      ).toBe(0);
      expect(Buffer.compare(result.stderr, Buffer.from([0xfe]))).toBe(0);
    },
  );

  it("reports raw byte counts when UTF-8 decoding changes the captured text", async () => {
    const result = await execFileOutput(process.execPath, [
      "-e",
      "process.stdout.write(Buffer.from([0x61, 0xff])); process.stderr.write(Buffer.from([0xe2, 0x82, 0xac]));",
    ]);

    expect(result).toMatchObject({
      stdout: "a�",
      stderr: "€",
      stdoutBytes: 2,
      stderrBytes: 3,
    });
  });

  it("captures output larger than Node's default execFile limit", async () => {
    const marker = "tail-marker";
    const result = await execFileOutput(process.execPath, [
      "-e",
      `process.stdout.write("x".repeat(2 * 1024 * 1024)); process.stdout.write(${JSON.stringify(marker)});`,
    ]);

    expect(result.stdout).toHaveLength(2 * 1024 * 1024 + marker.length);
    expect(result.stdout.endsWith(marker)).toBe(true);
  });

  it("enforces a caller supplied output bound", async () => {
    await expect(
      execFileOutput(
        process.execPath,
        ["-e", 'process.stdout.write("x".repeat(1024))'],
        { maxBuffer: 64 },
      ),
    ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
  });

  it.skipIf(process.platform === "win32").each(["stdout", "stderr"] as const)(
    "escalates %s overflow and preserves capacity failure when the timeout follows",
    async (stream) => {
      const directory = await createTestTempDirectory("rea-exec-overflow-");
      const identity = join(directory, "pid");
      const overflowSignal = join(directory, "overflow-signal");
      const script = [
        'const fs = require("node:fs");',
        `process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(overflowSignal)}, ""));`,
        `fs.writeFileSync(${JSON.stringify(identity)}, String(process.pid));`,
        "setInterval(() => {}, 1000);",
        `process.${stream}.write("x".repeat(4096));`,
      ].join("\n");
      // Hold the parent's deadline until the real child confirms overflow's
      // stop signal. Startup speed cannot reorder the tested interruptions.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const execution = execFileOutput(process.execPath, ["-e", script], {
        maxBuffer: 64,
        stopSignal: "SIGTERM",
        timeout: 1_000,
      }).catch((cause: unknown) => cause);
      try {
        expect(await waitForFile(overflowSignal)).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.runAllTimersAsync();
        const failure: unknown = await execution;
        expect(execFileOutputFailure(failure)).toMatchObject({
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          outputTruncated: true,
          [`${stream}Bytes`]: 64,
        });
        const pid = Number(await readFile(identity, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      } finally {
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        await execution;
      }
    },
    10_000,
  );

  it.skipIf(process.platform === "win32")(
    "preserves earlier cancellation and reports output truncated during stop",
    async () => {
      const directory = await createTestTempDirectory(
        "rea-exec-abort-overflow-",
      );
      const ready = join(directory, "ready");
      const script = [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => { process.stdout.write("x".repeat(4096)); process.exit(0); });',
        `fs.writeFileSync(${JSON.stringify(ready)}, "");`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const controller = new AbortController();
      const reason = new Error("caller stopped before overflow");
      const execution = execFileOutput(process.execPath, ["-e", script], {
        maxBuffer: 64,
        stopSignal: "SIGTERM",
        signal: controller.signal,
      }).catch((cause: unknown) => cause);
      const readyObserved = await waitForFile(ready);
      controller.abort(reason);
      const failure: unknown = await execution;
      expect(readyObserved).toBe(true);
      expect(failure).toMatchObject({
        _tag: "ExecFileOutputCancelledError",
        cause: reason,
      });
      expect(execFileOutputFailure(failure)).toMatchObject({
        outputTruncated: true,
        stdoutBytes: 64,
      });
    },
  );

  it("retains both captured streams on a failed child process", async () => {
    await expect(
      execFileOutput(process.execPath, [
        "-e",
        'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 7;',
      ]),
    ).rejects.toMatchObject({ code: 7, stdout: "out", stderr: "err" });
  });

  it("uses the built-in execFile timeout when no stop signal is requested", async () => {
    await expect(
      execFileOutput(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        timeout: 100,
      }),
    ).rejects.toMatchObject({ killed: true });
  });
});

describe("execFileOutput cancellation lifecycle", () => {
  it
    .skipIf(process.platform === "win32")
    .each([
      null,
      "stop after readiness",
      new Error("stop after readiness"),
    ] as const)(
    "stops an aborted process with exact %s reason and settles after it exits",
    async (reason) => {
      const directory = await createTestTempDirectory("rea-exec-stop-");
      const ready = join(directory, "ready");
      const stopped = join(directory, "stopped");
      // The child records the signal it received only after a cleanup delay.
      const script = [
        'const fs = require("node:fs");',
        'for (const name of ["SIGINT", "SIGTERM"])',
        `  process.on(name, () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(stopped)}, name); process.exit(0); }, 200));`,
        `fs.writeFileSync(${JSON.stringify(ready)}, "");`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const controller = new AbortController();
      const execution = execFileOutput(process.execPath, ["-e", script], {
        signal: controller.signal,
        stopSignal: "SIGINT",
      }).then(
        () => undefined,
        async (cause: unknown) => ({
          cause,
          stoppedBeforeSettling: await readFile(stopped, "utf8").catch(
            () => null,
          ),
        }),
      );
      const readyObserved = await waitForFile(ready);
      controller.abort(reason);
      const outcome = await execution;

      expect(readyObserved).toBe(true);
      expect(outcome?.cause).toMatchObject({
        name: "AbortError",
        _tag: "ExecFileOutputCancelledError",
      });
      if (!(outcome?.cause instanceof Error))
        throw new Error("Expected cancellation failure");
      expect(outcome.cause.cause).toBe(reason);
      expect(execFileOutputFailure(outcome.cause)).toBeDefined();
      expect(outcome?.stoppedBeforeSettling).toBe("SIGINT");
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps the first stop reason when timeout arrives during abort cleanup",
    async () => {
      const directory = await createTestTempDirectory("rea-exec-double-stop-");
      const ready = join(directory, "ready");
      const interrupted = join(directory, "interrupted");
      const script = [
        'const fs = require("node:fs");',
        `process.on("SIGINT", () => fs.writeFileSync(${escapeUnsafeCharsForInlineJavaScript(JSON.stringify(interrupted))}, ""));`,
        `fs.writeFileSync(${escapeUnsafeCharsForInlineJavaScript(JSON.stringify(ready))}, "");`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      const controller = new AbortController();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const execution = execFileOutput(process.execPath, ["-e", script], {
        signal: controller.signal,
        timeout: 10_000,
        stopSignal: "SIGINT",
      }).catch((cause: unknown) => cause);
      try {
        expect(await waitForFile(ready)).toBe(true);
        await vi.advanceTimersByTimeAsync(9_000);
        controller.abort();
        expect(await waitForFile(interrupted)).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(4_000);
        expect(await execution).toMatchObject({ name: "AbortError" });
      } finally {
        controller.abort();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        await execution;
      }
    },
  );

  it("rejects an already aborted stoppable command without starting it", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      execFileOutput(process.execPath, ["-e", ""], {
        signal: controller.signal,
        stopSignal: "SIGINT",
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe.skipIf(process.platform === "win32")(
  "execFileOutput stop signal at a timeout",
  () => {
    it("stops a timed-out process with the caller's signal and reports the timeout", async () => {
      const directory = await createTestTempDirectory("rea-exec-timeout-");
      const stopped = join(directory, "stopped");
      // The child exits cleanly once it has recorded the signal it received.
      const script = [
        'const fs = require("node:fs");',
        'for (const name of ["SIGINT", "SIGTERM"])',
        `  process.on(name, () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(stopped)}, name); process.exit(0); }, 200));`,
        "setInterval(() => {}, 1000);",
      ].join("\n");

      const failure: unknown = await execFileOutput(
        process.execPath,
        ["-e", script],
        { timeout: 2_000, stopSignal: "SIGINT" },
      ).then(
        () => undefined,
        (cause: unknown) => cause,
      );

      expect(failure).toMatchObject({ code: "ETIMEDOUT", killed: true });
      expect(await readFile(stopped, "utf8")).toBe("SIGINT");
    });

    it.each([-1, Number.NaN, 1.5, Number.POSITIVE_INFINITY, 2 ** 53])(
      "refuses a malformed timeout (%s) in both modes before starting the command",
      async (timeout) => {
        // Starting this command would fail with ENOENT instead.
        await expect(
          execFileOutput("/nonexistent/rea-command", [], {
            timeout,
            stopSignal: "SIGINT",
          }),
        ).rejects.toMatchObject({ code: "ERR_OUT_OF_RANGE" });
        await expect(
          execFileOutput("/nonexistent/rea-command", [], { timeout }),
        ).rejects.toMatchObject({ code: "ERR_OUT_OF_RANGE" });
      },
    );

    it("preserves a child failure's missing signal when reporting timeout", async () => {
      const directory = await createTestTempDirectory(
        "rea-exec-missing-signal-",
      );
      const ready = join(directory, "ready");
      const script = [
        'const fs = require("node:fs");',
        'for (const name of ["SIGINT", "SIGTERM"])',
        "  process.on(name, () => process.exit(1));",
        `fs.writeFileSync(${JSON.stringify(ready)}, "");`,
        "setInterval(() => {}, 1000);",
      ].join("\n");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const execution = execFileOutput(process.execPath, ["-e", script], {
        timeout: 10_000,
        stopSignal: "SIGINT",
      }).catch((cause: unknown) => cause);
      try {
        expect(await waitForFile(ready)).toBe(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await execution).toMatchObject({
          code: "ETIMEDOUT",
          signal: null,
        });
      } finally {
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        await execution;
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("kills a timed-out process that ignores the stop signal", async () => {
      const script = [
        'for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => {});',
        "setInterval(() => {}, 1000);",
      ].join("\n");

      await expect(
        execFileOutput(process.execPath, ["-e", script], {
          timeout: 1_000,
          stopSignal: "SIGINT",
        }),
      ).rejects.toMatchObject({
        code: "ETIMEDOUT",
        killed: true,
        signal: "SIGKILL",
      });
    });
  },
);

const descendantCommand = async (pid: number): Promise<string> => {
  if (process.platform === "linux")
    return readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-p", String(pid), "-o", "command="],
      { encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? "" : stdout);
      },
    );
  });
};

/** Signal only a still-running descendant whose command line contains `marker`. */
const stopOwnedDescendant = async (
  pid: number,
  marker: string,
): Promise<unknown> => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
    return undefined;
  if (!(await descendantCommand(pid)).includes(marker)) return undefined;
  try {
    process.kill(pid, "SIGKILL");
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH")
      return undefined;
    return cause;
  }
  return undefined;
};

describe.skipIf(process.platform === "win32")(
  "execFileOutput inherited pipes",
  () => {
    it("keeps overflowing command scratch files until its inherited-pipe descendant finishes", async () => {
      const directory = await createTestTempDirectory(
        "rea-exec-overflow-pipes-",
      );
      const scratch = join(directory, "scratch");
      const ready = join(directory, "descendant.pid");
      const stopped = join(directory, "launcher-stopped");
      const release = join(directory, "release");
      const finished = join(directory, "finished.json");
      await mkdir(scratch);
      const childSource = [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));`,
        "setInterval(() => {",
        `  if (!fs.existsSync(${JSON.stringify(release)})) return;`,
        `  fs.writeFileSync(${JSON.stringify(finished)}, JSON.stringify({ scratchExists: fs.existsSync(${JSON.stringify(scratch)}) }));`,
        '  process.stdout.write("late output");',
        "  process.exit(0);",
        "}, 10);",
      ].join("\n");
      const script = [
        'const { spawn } = require("node:child_process");',
        'const fs = require("node:fs");',
        `process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stopped)}, ""); process.exit(0); });`,
        `spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], { stdio: "inherit" });`,
        "const timer = setInterval(() => {",
        `  if (!fs.existsSync(${JSON.stringify(ready)})) return;`,
        "  clearInterval(timer);",
        '  process.stdout.write("x".repeat(4096));',
        "}, 10);",
      ].join("\n");
      const controller = new AbortController();
      let completed = false;
      const execution = execFileOutput(process.execPath, ["-e", script], {
        maxBuffer: 64,
        stopSignal: "SIGTERM",
        signal: controller.signal,
      })
        .finally(async () => {
          completed = true;
          await rm(scratch, { recursive: true, force: true });
        })
        .catch((cause: unknown) => cause);
      let killFailure: unknown;
      try {
        expect(await waitForFile(stopped)).toBe(true);
        const pid = Number(await readFile(ready, "utf8"));
        expect((await descendantCommand(pid)).includes(finished)).toBe(true);
        expect(completed).toBe(false);
        await expect(access(scratch)).resolves.toBeUndefined();
        await writeFile(release, "");
        const failure: unknown = await execution;
        expect(execFileOutputFailure(failure)).toMatchObject({
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
          outputTruncated: true,
          stdoutBytes: 64,
        });
        expect(JSON.parse(await readFile(finished, "utf8"))).toEqual({
          scratchExists: true,
        });
        await expect(access(scratch)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await writeFile(release, "");
        controller.abort();
        await execution;
        const pid = Number(await readFile(ready, "utf8").catch(() => ""));
        killFailure = await stopOwnedDescendant(pid, finished);
      }
      if (killFailure !== undefined) throw killFailure;
    }, 15_000);

    it("keeps scratch files until an inherited-pipe descendant closes them", async () => {
      const directory = await createTestTempDirectory("rea-exec-inherited-");
      const scratch = join(directory, "scratch");
      const finished = join(directory, "finished.json");
      const pidPath = join(directory, "child.pid");
      await mkdir(scratch);
      const childSource = [
        'const fs = require("node:fs");',
        "setTimeout(() => {",
        `  fs.writeFileSync(${JSON.stringify(finished)}, JSON.stringify({ scratchExists: fs.existsSync(${JSON.stringify(scratch)}) }));`,
        "  process.exit(0);",
        "}, 7000);",
      ].join("\n");
      const script = [
        'const { spawn } = require("node:child_process");',
        'const fs = require("node:fs");',
        `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], { stdio: "inherit" });`,
        `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
        "process.exit(0);",
      ].join("\n");
      const settled = execFileOutput(process.execPath, ["-e", script], {
        timeout: 200,
        stopSignal: "SIGTERM",
      })
        .finally(async () => {
          await rm(scratch, { recursive: true, force: true });
        })
        .then(
          () => ({ ok: true as const }),
          (cause: unknown) => ({ ok: false as const, cause }),
        );
      let killFailure: unknown;
      let descendantSettled = false;
      try {
        const deadline = Date.now() + 15_000;
        let text: string | undefined;
        while (Date.now() < deadline) {
          text = await readFile(finished, "utf8").then(
            (value) => value,
            (cause: unknown) => {
              if (
                cause instanceof Error &&
                "code" in cause &&
                cause.code === "ENOENT"
              )
                return undefined;
              throw cause;
            },
          );
          if (text !== undefined) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(text).toBeDefined();
        expect(JSON.parse(text ?? "")).toEqual({ scratchExists: true });
        const outcome = await settled;
        descendantSettled = true;
        expect(outcome).toMatchObject({
          ok: false,
          cause: { code: "ETIMEDOUT", killed: true },
        });
      } finally {
        if (!descendantSettled) {
          const pid = Number(await readFile(pidPath, "utf8").catch(() => ""));
          killFailure = await stopOwnedDescendant(pid, finished);
        }
        await settled;
      }
      if (killFailure !== undefined) throw killFailure;
    });
  },
);

describe("execFileOutput failure metadata", () => {
  it("preserves raw byte counts on a failed command with invalid UTF-8", async () => {
    const failure: unknown = await execFileOutput(process.execPath, [
      "-e",
      "process.stdout.write(Buffer.from([0x61, 0xff])); process.stderr.write(Buffer.from([0xe2, 0x82, 0xac])); process.exitCode = 7;",
    ]).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(execFileOutputFailure(failure)).toMatchObject({
      stdout: "a�",
      stderr: "€",
      stdoutBytes: 2,
      stderrBytes: 3,
      code: 7,
    });
  });
  it("preserves explicit truncation metadata from an owned process failure", () => {
    const failure = Object.assign(new Error("owned output was truncated"), {
      stdout: "partial stdout",
      stderr: "partial stderr",
      code: 7,
      outputTruncated: true,
    });

    expect(execFileOutputFailure(failure)).toEqual({
      stdout: "partial stdout",
      stderr: "partial stderr",
      code: 7,
      signal: null,
      killed: false,
      outputTruncated: true,
    });
  });
});

describe("execFileOutput cancellation provenance", () => {
  it.each([null, "caller stopped", new Error("caller stopped")] as const)(
    "retains producer cancellation and exact %s reason",
    async (reason) => {
      const controller = new AbortController();
      controller.abort(reason);
      const failure: unknown = await execFileOutput(
        "/must-not-start-after-cancellation",
        [],
        {
          signal: controller.signal,
          stopSignal: "SIGTERM",
        },
      ).catch((cause: unknown) => cause);
      expect(failure).toMatchObject({
        _tag: "ExecFileOutputCancelledError",
        code: "ABORT_ERR",
        name: "AbortError",
      });
      if (!(failure instanceof Error))
        throw new Error("Expected owned cancellation");
      expect(failure.cause).toBe(reason);
    },
  );
  it("keeps a completed command failure when its consumer later aborts", async () => {
    const controller = new AbortController();
    const failure: unknown = await execFileOutput(
      process.execPath,
      ["-e", "process.exitCode=7"],
      {
        signal: controller.signal,
        stopSignal: "SIGTERM",
      },
    ).catch((cause: unknown) => {
      controller.abort(null);
      return cause;
    });
    expect(failure).toMatchObject({ code: 7 });
    expect(failure).not.toHaveProperty("_tag", "ExecFileOutputCancelledError");
  });
});

it.each([
  null,
  "native callback stopped",
  new Error("native callback stopped"),
] as const)(
  "normalizes Node callback cancellation with exact %s reason",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const failure: unknown = await execFileOutput(
      process.execPath,
      ["-e", "process.exit(0)"],
      {
        signal: controller.signal,
      },
    ).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({
      _tag: "ExecFileOutputCancelledError",
      code: "ABORT_ERR",
    });
    if (!(failure instanceof Error))
      throw new Error("Expected Node callback cancellation");
    expect(failure.cause).toBe(reason);
  },
);

it.skipIf(process.platform === "win32").each([
  { code: 7, action: "abort" },
  { code: 0, action: "abort" },
  { code: 7, action: "overflow" },
] as const)(
  "owns root exit $code before inherited-pipe $action",
  async ({ code, action }) => {
    const directory = await createTestTempDirectory("rea-exec-exit-pipes-");
    const exited = join(directory, "root-exited");
    const release = join(directory, "release");
    const descendant = [
      'const fs = require("node:fs");',
      "const parent = Number(process.argv[1]);",
      "const timer = setInterval(() => {",
      "  try { process.kill(parent, 0); } catch {",
      `    fs.writeFileSync(${JSON.stringify(exited)}, "");`,
      "  }",
      `  if (!fs.existsSync(${JSON.stringify(release)})) return;`,
      `  process.stdout.write(${JSON.stringify(action === "overflow" ? "x".repeat(64) : "late")});`,
      "  clearInterval(timer); process.exit(0);",
      "}, 10);",
      "setTimeout(() => process.exit(0), 5000).unref();",
    ].join("\n");
    const program = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}, String(process.pid)], { stdio: "inherit" }).unref();`,
      'process.stderr.write("root diagnostic");',
      `process.exit(${code});`,
    ].join("\n");
    const controller = new AbortController();
    let settled = false;
    const execution = execFileOutput(process.execPath, ["-e", program], {
      stopSignal: "SIGTERM",
      signal: controller.signal,
      maxBuffer: 32,
    })
      .catch((cause: unknown) => cause)
      .finally(() => {
        settled = true;
      });
    try {
      expect(await waitForFile(exited)).toBe(true);
      expect(settled).toBe(false);
      if (action === "abort") controller.abort("late abort");
      expect(settled).toBe(false);
      await writeFile(release, "");
      const failure = await execution;
      expect(failure).toMatchObject(
        code === 0
          ? { _tag: "ExecFileOutputCancelledError", cause: "late abort" }
          : { code: 7 },
      );
      expect(execFileOutputFailure(failure)).toMatchObject({
        stderr: "root diagnostic",
        stdout: action === "overflow" ? "x".repeat(32) : "late",
        outputTruncated: action === "overflow",
      });
    } finally {
      await writeFile(release, "");
      controller.abort();
      await execution;
    }
  },
);
