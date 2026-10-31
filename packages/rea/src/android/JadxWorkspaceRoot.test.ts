import { EventEmitter } from "node:events";
import { win32 } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

const { spawnMock, tmpdirMock, lstatMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  tmpdirMock: vi.fn(),
  lstatMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  tmpdir: tmpdirMock,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  lstat: lstatMock,
}));

import { createJadxWorkspaceRoot } from "./JadxWorkspaceRoot.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("decodes a Windows guardian path across split UTF-8 stdout writes", async () => {
  const previousPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "win32",
  });
  const parent = "C:\\Users\\研究者\\AppData\\Local\\Temp";
  const path = win32.join(parent, `rea-android-${"a".repeat(32)}`);
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
  });
  child.stdin.once("finish", () => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
  });
  tmpdirMock.mockReturnValue(parent);
  const missingPath = Object.assign(new Error("missing after cleanup"), {
    code: "ENOENT",
  });
  lstatMock.mockRejectedValue(missingPath);
  spawnMock.mockReturnValue(child);
  const ready = Buffer.from(
    `${JSON.stringify({
      path,
      volumeSerial: "0123456789abcdef",
      fileId: "0123456789abcdef0123456789abcdef",
      privateDacl: true,
    })}\n`,
  );
  const split = ready.indexOf(Buffer.from("研")) + 1;

  try {
    const start = createJadxWorkspaceRoot();
    setImmediate(() => {
      child.stdout.write(ready.subarray(0, split), () => {
        setImmediate(() => child.stdout.write(ready.subarray(split)));
      });
    });

    const root = await start;
    try {
      expect(root.path).toBe(path);
    } finally {
      await expect(root.close()).resolves.toBeUndefined();
    }
    expect(lstatMock).toHaveBeenCalledWith(path);
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: previousPlatform,
    });
  }
});
