import { expect, it, vi } from "vitest";

import { absoluteCallerPath } from "../../../src/filesystem/callerPath.js";

it("resolves absolute POSIX paths independently of an unavailable cwd", () => {
  const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
    throw new Error("working directory was removed");
  });
  try {
    expect(
      absoluteCallerPath("/cache//rea/kuna/.", { platform: "linux" }),
    ).toBe("/cache/rea/kuna/");
    expect(
      absoluteCallerPath("sample", { cwd: "/explicit", platform: "linux" }),
    ).toBe("/explicit/sample");
  } finally {
    cwd.mockRestore();
  }
});

it("keeps POSIX parent components for the filesystem to resolve", () => {
  const posix = { cwd: "/work", platform: "linux" } as const;
  expect(absoluteCallerPath("link/../sample", posix)).toBe(
    "/work/link/../sample",
  );
  expect(absoluteCallerPath("/abs/link/../sample", posix)).toBe(
    "/abs/link/../sample",
  );
  expect(absoluteCallerPath("../sample", posix)).toBe("/work/../sample");
});

it("removes only POSIX spellings that cannot change the named file", () => {
  const posix = { cwd: "/work/", platform: "darwin" } as const;
  expect(absoluteCallerPath("./module.wasm", posix)).toBe("/work/module.wasm");
  expect(absoluteCallerPath("a//./b", posix)).toBe("/work/a/b");
  expect(absoluteCallerPath("/x/./y", posix)).toBe("/x/y");
  expect(absoluteCallerPath("sample", { ...posix, cwd: "/" })).toBe("/sample");
  expect(absoluteCallerPath("/", posix)).toBe("/");
  // A trailing separator or `.` still requires a directory.
  expect(absoluteCallerPath("sample/", posix)).toBe("/work/sample/");
  expect(absoluteCallerPath("sample/.", posix)).toBe("/work/sample/");
  expect(absoluteCallerPath("a//b//", posix)).toBe("/work/a/b/");
});

it("makes a relative POSIX cwd absolute before appending the path", () => {
  expect(
    absoluteCallerPath("sample", { cwd: "fixtures/../x", platform: "linux" }),
  ).toBe(`${process.cwd()}/fixtures/../x/sample`);
});

it("uses lexical resolution on Windows, where it is exact", () => {
  const win32 = { cwd: "C:\\work", platform: "win32" } as const;
  expect(absoluteCallerPath("link\\..\\sample", win32)).toBe(
    "C:\\work\\sample",
  );
  expect(absoluteCallerPath("D:\\x\\..\\y", win32)).toBe("D:\\y");
});

it("normalizes separator spellings of absolute Windows paths (#4707)", () => {
  const win32 = { cwd: "C:\\work", platform: "win32" } as const;
  for (const spelling of [
    "C:\\Users\\u\\h.exe",
    "C:/Users/u/h.exe",
    "C:\\\\Users\\\\u\\\\h.exe",
    "C://Users//u//h.exe",
  ])
    expect(absoluteCallerPath(spelling, win32)).toBe("C:\\Users\\u\\h.exe");
});
