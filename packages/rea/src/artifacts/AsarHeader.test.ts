import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { expect, it, vi } from "vitest";

import {
  admitAsarHeader,
  readAsarHeader,
  createAsarHeaderSignatureProbe,
} from "./AsarHeader.js";
import { asarHeaderBytes } from "../../tests/fixtures/asarHeader.js";

const makeArchive = (): Buffer => asarHeaderBytes(' \t\r\n{"files":{}} ');

it("fills the fixed Pickle prefix across controlled short reads", async () => {
  const archive = makeArchive();
  const calls: Array<readonly [number, number, number]> = [];
  const handle = {
    stat: vi.fn(
      async () =>
        ({
          isFile: () => true,
          size: archive.length,
        }) as Stats,
    ),
    read: vi.fn(
      async (
        target: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        calls.push([offset, length, position]);
        const bytesRead = Math.min(3, length, archive.length - position);
        archive.copy(target, offset, position, position + bytesRead);
        return { bytesRead, buffer: target };
      },
    ),
  } as unknown as Parameters<typeof admitAsarHeader>[0];

  await expect(admitAsarHeader(handle)).resolves.toEqual({
    archiveBytes: archive.length,
    headerBytes: archive.readUInt32LE(4),
    jsonBytes: archive.readUInt32LE(12),
  });
  expect(calls).toEqual([
    [0, 16, 0],
    [3, 13, 3],
    [6, 10, 6],
    [9, 7, 9],
    [12, 4, 12],
    [15, 1, 15],
  ]);
});

it("recognizes JSON whitespace before the object token and finalizes file extents", () => {
  const archive = makeArchive();
  const probe = createAsarHeaderSignatureProbe();
  probe.write(archive.subarray(0, 7));
  expect(probe.observation.state).toBe("pending");
  probe.write(archive.subarray(7, 21));
  expect(probe.observation.state).toBe("matched");
  const result = probe.finish(archive.length);
  expect(result).toMatchObject({
    state: "matched",
    extents: {
      archiveBytes: archive.length,
      headerBytes: archive.readUInt32LE(4),
      jsonBytes: archive.readUInt32LE(12),
    },
    signatureOffset: 20,
  });
});

it("rejects a signature whose declared header exceeds the observed archive", () => {
  const archive = makeArchive();
  const probe = createAsarHeaderSignatureProbe();
  probe.write(archive);
  expect(probe.finish(archive.length - 1)).toMatchObject({
    state: "rejected",
    reason: "archive-too-short",
  });
});

it("decodes admitted JSON across short reads without consuming padding", async () => {
  const archive = asarHeaderBytes('{"files":{"�":{}}}', {
    padding: Buffer.from([0xff]),
  });
  const handle = {
    stat: async () => ({ isFile: () => true, size: archive.length }) as Stats,
    read: async (
      target: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesRead = Math.min(2, length, archive.length - position);
      archive.copy(target, offset, position, position + bytesRead);
      return { bytesRead, buffer: target };
    },
  } as unknown as Parameters<typeof admitAsarHeader>[0];
  const extents = await admitAsarHeader(handle);
  await expect(readAsarHeader(handle, extents)).resolves.toEqual({
    files: { "�": {} },
  });
  await expect(
    readAsarHeader(
      {
        read: (async (target: Buffer) => ({
          bytesRead: 0,
          buffer: target,
        })) as FileHandle["read"],
      },
      extents,
    ),
  ).rejects.toMatchObject({
    reason: "format",
    message: "Truncated ASAR JSON header",
  });
});
