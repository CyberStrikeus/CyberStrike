import {
  mkdtemp,
  open,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import { LldbReadbackFiles } from "../../../../src/native/LldbReadbackFiles.js";

it("bounds PID readback while retaining newline-terminated producer fixtures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-lldb-pid-"));
  const values = [
    ["max-safe.pid", String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [
      "max-safe-crlf.pid",
      `${Number.MAX_SAFE_INTEGER}\r\n`,
      Number.MAX_SAFE_INTEGER,
    ],
    ["lf.pid", "12345\n", 12345],
    ["crlf.pid", "12345\r\n", 12345],
    ["unsafe.pid", "9007199254740992", undefined],
    ["too-many-digits.pid", "10000000000000000", undefined],
    ["empty.pid", "", undefined],
    ["oversized.pid", "1".repeat(64), undefined],
  ] as const;
  for (const [name, contents] of values)
    await writeFile(join(directory, name), contents);
  const sample = await open(join(directory, "max-safe.pid"), "r");
  const prototype = Object.getPrototypeOf(sample) as {
    read(
      this: FileHandle,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number; buffer: Buffer }>;
    readFile(this: FileHandle, encoding: "utf8"): Promise<string>;
  };
  await sample.close();
  let bytesRead = 0;
  const requestedLengths: number[] = [];
  const originalReadFile = prototype.readFile;
  const readFileSpy = vi
    .spyOn(prototype, "readFile")
    .mockImplementation(async function (this: FileHandle, ...args) {
      const value = await originalReadFile.call(this, ...args);
      bytesRead += Buffer.byteLength(value);
      return value;
    });
  const originalRead = prototype.read;
  const readSpy = vi
    .spyOn(prototype, "read")
    .mockImplementation(async function (this: FileHandle, ...args) {
      const requestedLength = typeof args[2] === "number" ? args[2] : 0;
      requestedLengths.push(requestedLength);
      const result = await originalRead.call(
        this,
        args[0],
        args[1],
        Math.min(requestedLength, 1),
        args[3],
      );
      bytesRead += result.bytesRead;
      return result;
    });
  const files = new LldbReadbackFiles();
  try {
    for (const [name, , expected] of values) {
      const before = bytesRead;
      expect(await files.readTargetPid(join(directory, name))).toBe(expected);
      expect(bytesRead - before).toBeLessThanOrEqual(19);
    }
    expect(
      await files.readTargetPid(join(directory, "missing.pid")),
    ).toBeUndefined();
    expect(requestedLengths.length).toBeGreaterThan(0);
    expect(requestedLengths.every((length) => length <= 19)).toBe(true);
    expect(bytesRead).toBeLessThanOrEqual(19 * values.length);
  } finally {
    readSpy.mockRestore();
    readFileSpy.mockRestore();
    await files.retryCleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
