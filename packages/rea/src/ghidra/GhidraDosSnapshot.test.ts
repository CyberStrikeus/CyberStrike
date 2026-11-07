import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  fixtureDosLoadImage,
  fixtureDosOverlapLoadImage,
} from "./GhidraLoadImage.fixture.js";
import { attestGhidraDosSnapshot } from "./GhidraDosSnapshot.js";

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

it.each([false, true])(
  "compares final overlapping relocation windows (intermediate=%s)",
  async (intermediate) => {
    const fixture = fixtureDosOverlapLoadImage();
    expect(fixture.bytes.subarray(56, 59).toString("hex")).toBe("000400");
    const first = fixture.observation.relocations[0];
    if (first === undefined) throw new Error("Missing authored overlap record");
    if (intermediate) first.memory_bytes_hex = "0410";
    const directory = await createTestTempDirectory("rea-mz-overlap-");
    const path = join(directory, "inert.exe");
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    try {
      const result = await attestGhidraDosSnapshot(
        handle,
        fixture.bytes.length,
        path,
        fixture.sha256,
        fixture.observation,
      );
      if (!result.ok || result.value.status === "unsupported")
        throw new Error("Expected completed MZ comparison");
      expect(result.value.status).toBe(intermediate ? "mismatch" : "verified");
      expect(
        result.value.checks
          .filter((check) => !check.matched)
          .map((check) => check.name),
      ).toEqual(intermediate ? ["relocation_records"] : []);
      expect(result.value.observations.relocations).toEqual(
        fixture.observation.relocations,
      );
    } finally {
      await handle.close();
    }
  },
);

it.each([23, 65539])(
  "streams complete MZ identity with a %s-byte overlay",
  async (overlay) => {
    const fixture = fixtureDosLoadImage(Buffer.alloc(overlay, 0xa5));
    const directory = await createTestTempDirectory("rea-mz-source-");
    const path = join(directory, "inert.exe");
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    const allocation = vi.spyOn(Buffer, "allocUnsafe");
    const copies = vi.spyOn(Buffer, "from");
    try {
      const result = await attestGhidraDosSnapshot(
        handle,
        fixture.bytes.length,
        path,
        fixture.sha256,
        fixture.observation,
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "verified",
          overlay_bytes: overlay,
          observations: fixture.observation,
        },
      });
      expect(
        Math.max(...allocation.mock.calls.map(([size]) => size)),
      ).toBeLessThanOrEqual(65536);
      expect(
        copies.mock.calls
          .filter(([source]) => Buffer.isBuffer(source))
          .every(([source]) => (source as Buffer).length <= 160),
      ).toBe(true);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
    } finally {
      allocation.mockRestore();
      copies.mockRestore();
      await handle.close();
    }
  },
);

it.each([41, 170])(
  "rejects changed source bytes at file offset %s",
  async (offset) => {
    const fixture = fixtureDosLoadImage();
    fixture.bytes[offset] = (fixture.bytes[offset] ?? 0) ^ 1;
    const directory = await createTestTempDirectory("rea-mz-identity-");
    const path = join(directory, "inert.exe");
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    try {
      expect(
        await attestGhidraDosSnapshot(
          handle,
          fixture.bytes.length,
          path,
          fixture.sha256,
          fixture.observation,
        ),
      ).toMatchObject({ ok: false, error: expect.stringContaining("digest") });
    } finally {
      await handle.close();
    }
  },
);

it.each(["ZZZZ", "NE00"])(
  "observes distant Windows signatures (%s) without capturing the overlay",
  async (signature) => {
    const fixture = fixtureDosLoadImage(Buffer.alloc(1024));
    fixture.bytes.writeUInt32LE(512, 60);
    fixture.bytes.write(signature, 512, "ascii");
    fixture.sha256 = hash(fixture.bytes);
    const modified = Buffer.from(fixture.bytes);
    modified.writeUInt16LE(0x1004, 41);
    Object.assign(fixture.observation.source_files[0] ?? {}, {
      original_sha256: fixture.sha256,
      modified_sha256: hash(modified),
    });
    Object.assign(fixture.observation.mappings[1] ?? {}, {
      sha256: hash(modified.subarray(32, 160)),
    });
    const directory = await createTestTempDirectory("rea-mz-signature-");
    const path = join(directory, "inert.exe");
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    try {
      const result = await attestGhidraDosSnapshot(
        handle,
        fixture.bytes.length,
        path,
        fixture.sha256,
        fixture.observation,
      );
      expect(result).toMatchObject(
        signature === "ZZZZ"
          ? { ok: true, value: { status: "verified" } }
          : { ok: false, error: expect.stringContaining("Windows new header") },
      );
    } finally {
      await handle.close();
    }
  },
);

it("preserves exact cancellation after an overlay descriptor read", async () => {
  const fixture = fixtureDosLoadImage(Buffer.alloc(65539));
  const directory = await createTestTempDirectory("rea-mz-cancel-");
  const path = join(directory, "inert.exe");
  await writeFile(path, fixture.bytes);
  const handle = await open(path, "r");
  const controller = new AbortController();
  const reason = { stage: "overlay read" };
  const original = handle.read.bind(handle);
  const read = vi
    .spyOn(handle, "read")
    .mockImplementation(async (...args: Parameters<typeof handle.read>) => {
      const result = await original(...args);
      if (Reflect.get(args, 3) === 160n) controller.abort(reason);
      return result;
    });
  try {
    await expect(
      attestGhidraDosSnapshot(
        handle,
        fixture.bytes.length,
        path,
        fixture.sha256,
        fixture.observation,
        controller.signal,
      ),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
    expect(handle.fd).toBeGreaterThanOrEqual(0);
  } finally {
    read.mockRestore();
    await handle.close();
  }
});

it.each([
  [0, "invalid DOS MZ page count or final-page size"],
  [4, "truncated DOS MZ load module"],
] as const)(
  "preserves early extent failure before Windows inspection (pages=%s)",
  async (pages, error) => {
    const fixture = fixtureDosLoadImage(Buffer.alloc(1024));
    fixture.bytes.writeUInt16LE(pages, 4);
    fixture.bytes.writeUInt32LE(512, 60);
    fixture.bytes.write("NE", 512, "ascii");
    const directory = await createTestTempDirectory("rea-mz-extent-");
    const path = join(directory, "inert.exe");
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    try {
      await expect(
        attestGhidraDosSnapshot(
          handle,
          fixture.bytes.length,
          path,
          fixture.sha256,
          fixture.observation,
        ),
      ).resolves.toEqual({ ok: false, error });
    } finally {
      await handle.close();
    }
  },
);
