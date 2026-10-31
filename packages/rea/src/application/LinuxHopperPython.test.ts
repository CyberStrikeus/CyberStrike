import { existsSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  ExecFileOutputCancelledError,
  execFileOutput,
} from "../process/ExecFileOutput.js";
import { inspectLinuxHopperPythonRuntime } from "./LinuxHopperPython.js";

const response = (value: unknown) => {
  const stdout = JSON.stringify(value);
  return {
    stdout,
    stderr: "",
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
  };
};
const available = {
  version: [3, 14],
  library: { status: "loadable", path: "/usr/lib/libpython3.14.so.1.0" },
};

describe("distribution Python runtime inspection", () => {
  it("preserves version and library identity without assuming Python 3.12", async () => {
    const execute = vi
      .fn<typeof execFileOutput>()
      .mockResolvedValue(response(available));
    const environment = {
      PYTHONHOME: "/caller/python",
      PYTHONPATH: "/caller/modules",
    };
    const result = await inspectLinuxHopperPythonRuntime(
      environment,
      undefined,
      execute,
    );
    expect(result).toEqual({
      ok: true,
      value: { ...available, interpreter: "/usr/bin/python3" },
    });
    expect(execute).toHaveBeenCalledWith(
      "/usr/bin/python3",
      expect.arrayContaining(["-I", "-S", "-B"]),
      expect.objectContaining({
        env: environment,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        stopSignal: "SIGTERM",
      }),
    );
  });

  it.each([
    { version: [2, 7], library: available.library },
    { version: [3, "14"], library: available.library },
    {
      version: [3, 14],
      library: { status: "loadable", path: "relative/libpython.so" },
    },
    {
      version: [3, 14],
      library: { status: "loadable", path: "C:\\not-a-linux-path\\python.dll" },
    },
    {
      version: [3, 14],
      library: { status: "loadable", path: "/usr/lib/python\0.so" },
    },
    {
      version: [3, 14],
      library: { status: "unavailable", path: "/lib/python.so" },
    },
    null,
  ])(
    "refuses malformed facts without reporting library absence: %j",
    async (value) => {
      const execute = vi
        .fn<typeof execFileOutput>()
        .mockResolvedValue(response(value));
      const result = await inspectLinuxHopperPythonRuntime(
        {},
        undefined,
        execute,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "invalid_response" },
      });
    },
  );

  it("retains unknown configuration and observes a later repaired library afresh", async () => {
    const unknown = {
      version: [3, 14],
      library: { status: "unknown", reason: "No INSTSONAME" },
    };
    const execute = vi
      .fn<typeof execFileOutput>()
      .mockResolvedValueOnce(response(unknown))
      .mockResolvedValueOnce(response(available));
    expect(
      await inspectLinuxHopperPythonRuntime({}, undefined, execute),
    ).toMatchObject({ ok: true, value: unknown });
    expect(
      await inspectLinuxHopperPythonRuntime({}, undefined, execute),
    ).toMatchObject({ ok: true, value: available });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("distinguishes execution and JSON failures from an unavailable library", async () => {
    const execute = vi
      .fn<typeof execFileOutput>()
      .mockRejectedValueOnce(new Error("fixture execution failure"))
      .mockResolvedValueOnce({
        stdout: "{",
        stderr: "",
        stdoutBytes: 1,
        stderrBytes: 0,
      });
    expect(
      await inspectLinuxHopperPythonRuntime({}, undefined, execute),
    ).toMatchObject({ ok: false, error: { reason: "query_failed" } });
    expect(
      await inspectLinuxHopperPythonRuntime({}, undefined, execute),
    ).toMatchObject({ ok: false, error: { reason: "invalid_response" } });
  });
});

describe("distribution Python process cleanup", () => {
  it("retains output failure when cancellation arrives during command cleanup", async () => {
    const directory = await createTestTempDirectory("rea-python-failure-stop-");
    const stopping = join(directory, "stopping");
    const release = join(directory, "release");
    const controller = new AbortController();
    const program = `
const fs = require('node:fs');
process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(stopping)}, 'stopping');
  const timer = setInterval(() => {
    if (fs.existsSync(${JSON.stringify(release)})) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 10);
});
process.stdout.write(Buffer.alloc(128 * 1024, 120));
setInterval(() => {}, 1000);
`;
    const execution = inspectLinuxHopperPythonRuntime(
      process.env,
      controller.signal,
      (_command, _arguments, options) =>
        execFileOutput(process.execPath, ["-e", program], options),
    );
    try {
      await vi.waitFor(() => access(stopping), {
        timeout: 5_000,
        interval: 10,
      });
      controller.abort({ request: "cancel during failed command cleanup" });
    } finally {
      await writeFile(release, "release");
      await execution;
    }
    expect(await execution).toMatchObject({
      ok: false,
      error: {
        reason: "query_failed",
        cause: { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
      },
    });
  });

  it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/python3"))(
    "waits for a delayed Python exit before completing cancellation",
    async () => {
      const directory = await createTestTempDirectory("rea-python-stop-");
      const ready = join(directory, "ready");
      const stopping = join(directory, "stopping");
      const release = join(directory, "release");
      const stopped = join(directory, "stopped");
      const program = `from pathlib import Path
import signal, sys, time
def stop(signum, frame):
    Path(${JSON.stringify(stopping)}).write_text(str(signum))
    while not Path(${JSON.stringify(release)}).exists():
        time.sleep(0.01)
    Path(${JSON.stringify(stopped)}).write_text(str(signum))
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
Path(${JSON.stringify(ready)}).write_text("ready")
while True:
    time.sleep(0.1)
`;
      const controller = new AbortController();
      const reason = { request: "stop owned Python" };
      let settled = false;
      const execution = inspectLinuxHopperPythonRuntime(
        process.env,
        controller.signal,
        (command, _arguments, options) =>
          execFileOutput(command, ["-I", "-S", "-B", "-c", program], options),
      ).then((result) => {
        settled = true;
        return result;
      });
      try {
        await vi.waitFor(() => access(ready), { timeout: 5_000, interval: 10 });
        controller.abort(reason);
        await vi.waitFor(() => access(stopping), {
          timeout: 3_000,
          interval: 10,
        });
        // The child cannot exit until released; early settlement loses ownership.
        expect(settled).toBe(false);
      } finally {
        try {
          await writeFile(release, "release");
        } finally {
          controller.abort(reason);
          await execution;
        }
        await vi.waitFor(() => access(stopped), {
          timeout: 5_000,
          interval: 10,
        });
      }
      expect(await readFile(stopped, "utf8")).toBe("15");
      const result = await execution;
      expect(result).toMatchObject({
        ok: false,
        error: { reason: "cancelled" },
      });
      if (!result.ok) expect(result.error.cause).toBe(reason);
    },
  );
});

describe("distribution Python isolation and cancellation", () => {
  it("uses the producer's cancellation reason without requiring an aborted caller", async () => {
    const reason = { producer: "interrupted command" };
    const result = await inspectLinuxHopperPythonRuntime(
      {},
      undefined,
      async () => {
        throw new ExecFileOutputCancelledError(reason);
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "cancelled", cause: reason },
    });
    if (!result.ok) expect(result.error.cause).toBe(reason);
  });

  it("preserves cancellation and starts no interpreter for an already cancelled query", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancellation");
    controller.abort(reason);
    const execute = vi.fn<typeof execFileOutput>();
    const result = await inspectLinuxHopperPythonRuntime(
      {},
      controller.signal,
      execute,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "cancelled", cause: reason },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("observes cancellation that arrives during interpreter execution", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled during query");
    const execute = vi
      .fn<typeof execFileOutput>()
      .mockImplementation(async () => {
        controller.abort(reason);
        return response(available);
      });
    const result = await inspectLinuxHopperPythonRuntime(
      {},
      controller.signal,
      execute,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { reason: "cancelled", cause: reason },
    });
  });

  it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/python3"))(
    "runs the real producer without loading caller Python modules or PYTHONHOME",
    async () => {
      const directory = await createTestTempDirectory("rea-system-python-");
      for (const name of ["ctypes.py", "sysconfig.py", "sitecustomize.py"])
        await writeFile(
          join(directory, name),
          "raise RuntimeError('caller module was loaded')\n",
        );
      const result = await inspectLinuxHopperPythonRuntime({
        ...process.env,
        PYTHONPATH: directory,
        PYTHONHOME: join(directory, "missing-python-home"),
      });
      expect(result).toMatchObject({
        ok: true,
        value: {
          interpreter: "/usr/bin/python3",
          version: [3, expect.any(Number)],
        },
      });
    },
  );
});
