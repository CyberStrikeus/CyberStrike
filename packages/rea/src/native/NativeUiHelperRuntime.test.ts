import { expect, it, vi } from "vitest";
import { execFileOutput } from "../process/ExecFileOutput.js";
import { createNativeUiHelperRuntime } from "./NativeUiHelperRuntime.js";
import { DEFAULT_NATIVE_UI_DEADLINE_MS } from "../domain/native/nativeDeadlines.js";

vi.mock("../process/ExecFileOutput.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../process/ExecFileOutput.js")>()),
  execFileOutput: vi.fn(),
}));

const emptyCapture = {
  stdout: "",
  stderr: "",
  stdoutBytes: 0,
  stderrBytes: 0,
};
const helperCapture = {
  stdout: JSON.stringify({ ok: true }),
  stderr: "",
  stdoutBytes: 11,
  stderrBytes: 0,
};

it.each([250_000, undefined])(
  "uses the selected UI deadline for both helper subprocesses: %s",
  async (deadlineMs) => {
    vi.mocked(execFileOutput).mockReset();
    vi.mocked(execFileOutput)
      .mockResolvedValueOnce(emptyCapture)
      .mockResolvedValueOnce(helperCapture);
    const runtime =
      deadlineMs === undefined
        ? createNativeUiHelperRuntime({})
        : createNativeUiHelperRuntime({}, deadlineMs);
    try {
      await runtime.invoke({ pid: 1 });
    } finally {
      await runtime.close();
    }
    const expected = deadlineMs ?? DEFAULT_NATIVE_UI_DEADLINE_MS;
    const calls = vi.mocked(execFileOutput).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe("/usr/bin/xcrun");
    expect(calls[0]?.[2]).toMatchObject({
      timeout: expected,
      stopSignal: "SIGINT",
    });
    expect(calls[1]?.[2]).toMatchObject({
      timeout: expected,
      stopSignal: "SIGTERM",
    });
  },
);
