import { beforeEach, expect, it, vi } from "vitest";
import { WindowsPrivateRuntime } from "../../src/windows/WindowsPrivateRuntime.js";
import { PrivateRuntimeRootUnavailableError } from "../../src/process/PrivateRuntimeRootUnavailableError.js";

const { nativeCall } = vi.hoisted(() => ({ nativeCall: vi.fn() }));
vi.mock("../../src/windows/WindowsNativeLoader.js", async (original) => ({
  ...(await original<
    typeof import("../../src/windows/WindowsNativeLoader.js")
  >()),
  requireWindowsNativeAuthority: () => ({ call: nativeCall }),
}));
beforeEach(() => {
  nativeCall.mockReset();
});

it.each([
  {
    label: "sharing conflict before allocation",
    win32Code: 32,
    runtimeAllocation: "not-started",
    retryable: true,
  },
  {
    label: "lock conflict before allocation",
    win32Code: 33,
    runtimeAllocation: "not-started",
    retryable: true,
  },
  { label: "unknown allocation", win32Code: 32, retryable: false },
  {
    label: "possible allocation",
    win32Code: 32,
    runtimeAllocation: "started",
    retryable: false,
  },
  {
    label: "permission failure",
    win32Code: 5,
    runtimeAllocation: "not-started",
    retryable: false,
  },
  {
    label: "string code",
    win32Code: "32",
    runtimeAllocation: "not-started",
    retryable: false,
  },
  {
    label: "inconsistent error code",
    win32Code: 32,
    code: "EACCES",
    runtimeAllocation: "not-started",
    retryable: false,
  },
])(
  "retains $label without guessing runtime ownership",
  ({ retryable, label: _label, ...facts }) => {
    const cause = Object.assign(new Error("Selected native diagnostic"), {
      code: "ERR_REA_WINDOWS_NATIVE",
      ...facts,
    });
    nativeCall.mockImplementation(() => {
      throw cause;
    });
    let observed: unknown;
    try {
      WindowsPrivateRuntime.create("D:/selected parent", "selected-prefix-");
    } catch (failure: unknown) {
      observed = failure;
    }
    expect(nativeCall).toHaveBeenCalledTimes(1);
    expect(nativeCall).toHaveBeenCalledWith("runtime_create", [
      "D:/selected parent",
      "selected-prefix-",
    ]);
    if (retryable) {
      expect(observed).toBeInstanceOf(PrivateRuntimeRootUnavailableError);
      expect(observed).toMatchObject({
        message: cause.message,
        cause,
        retryable: true,
      });
    } else expect(observed).toBe(cause);
  },
);

it("does not infer a transient status from a human-readable diagnostic", () => {
  const cause = new Error("Open Windows path component failed (Win32 32)");
  nativeCall.mockImplementation(() => {
    throw cause;
  });
  let observed: unknown;
  try {
    WindowsPrivateRuntime.create("D:/selected parent", "selected-prefix-");
  } catch (failure: unknown) {
    observed = failure;
  }
  expect(observed).toBe(cause);
});
