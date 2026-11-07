import { beforeEach, expect, it, vi } from "vitest";

import { findWindowsExecutable } from "./WindowsExecutable.js";

const lookup = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock("node:fs/promises", () => ({ stat: lookup.stat }));
beforeEach(() => {
  lookup.stat.mockReset();
  lookup.stat.mockRejectedValue(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
});
const options = () => ({
  signal: new AbortController().signal,
  cwd: "C:\\project",
});

it("looks up an explicitly named extension without appending PATHEXT again", async () => {
  lookup.stat.mockResolvedValue({ isFile: () => true });
  expect(
    await findWindowsExecutable(
      "npm.cmd",
      { PATH: "C:\\tools", PATHEXT: ".EXE;.CMD" },
      { ...options(), allowBatch: true },
    ),
  ).toEqual({ ok: true, value: "C:\\tools\\npm.cmd" });
  expect(lookup.stat).toHaveBeenCalledExactlyOnceWith("C:\\tools\\npm.cmd");
});

it("uses native PATH extensions for ADB, preserving directory and extension precedence", async () => {
  lookup.stat.mockImplementation(async (path: string) => ({
    isFile: () => ["C:\\tools\\adb.EXE", "D:\\tools\\adb.COM"].includes(path),
  }));
  expect(
    await findWindowsExecutable(
      "adb",
      { Path: "C:\\tools;D:\\tools", PathExt: ".CMD;.COM;.EXE" },
      options(),
    ),
  ).toEqual({ ok: true, value: "C:\\tools\\adb.EXE" });
  expect(lookup.stat.mock.calls.map(([path]) => path)).toEqual([
    "C:\\tools\\adb.COM",
    "C:\\tools\\adb.EXE",
  ]);
});

it("preserves explicitly selected relative directories and quoted semicolons", async () => {
  lookup.stat.mockImplementation(async (path: string) => ({
    isFile: () => path === "C:\\project\\tools;selected\\npm.CMD",
  }));
  expect(
    await findWindowsExecutable(
      "npm",
      { PATH: ';"";".\\tools;selected";.', PATHEXT: ".CMD" },
      { ...options(), allowBatch: true },
    ),
  ).toEqual({ ok: true, value: "C:\\project\\tools;selected\\npm.CMD" });
  expect(lookup.stat).toHaveBeenCalledTimes(1);
});

it.each([
  {},
  { PATH: "" },
  { PATH: ';"";;' },
  { PATH: "C:\\tools", PATHEXT: "" },
])(
  "returns a missing result without probing implicit CWD for %j",
  async (environment) => {
    expect(await findWindowsExecutable("adb", environment, options())).toEqual({
      ok: false,
      error: { kind: "missing" },
    });
    expect(lookup.stat).not.toHaveBeenCalled();
  },
);

it("retains the failed candidate and cause rather than selecting a later executable", async () => {
  const cause = Object.assign(new Error("denied"), { code: "EACCES" });
  lookup.stat.mockRejectedValue(cause);
  expect(
    await findWindowsExecutable(
      "adb",
      { PATH: "C:\\tools;D:\\tools", PATHEXT: ".EXE" },
      options(),
    ),
  ).toEqual({
    ok: false,
    error: {
      kind: "inspection",
      path: "C:\\tools\\adb.EXE",
      code: "EACCES",
      cause,
    },
  });
  expect(lookup.stat).toHaveBeenCalledTimes(1);
});

it("stops a pending filesystem lookup when its owner aborts", async () => {
  const controller = new AbortController();
  let complete!: (value: { isFile: () => boolean }) => void;
  lookup.stat.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = findWindowsExecutable(
    "adb",
    { PATH: "C:\\tools", PATHEXT: ".EXE" },
    { signal: controller.signal },
  );
  controller.abort();
  expect(await pending).toEqual({ ok: false, error: { kind: "interrupted" } });
  complete({ isFile: () => true });
  expect(lookup.stat).toHaveBeenCalledTimes(1);
});
