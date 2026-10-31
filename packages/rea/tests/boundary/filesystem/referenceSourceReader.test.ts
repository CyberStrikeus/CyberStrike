import { lstat, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { readStableSymlinkTarget } from "../../../src/reference/ReferenceSourceReaderEntries.js";
import { readReferenceSource } from "../../support/referenceSourceResourceScope.js";

describe("readReferenceSource entries", () => {
  it("returns explicit entries in canonical code-point path order", async () => {
    const root = await createTestTempDirectory("rea-reference-");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "z.js"), "z");
    await writeFile(join(root, "a.js"), "a");
    await writeFile(join(root, "nested", "b.js"), "b");
    await writeFile(join(root, "\u{e000}"), "p");
    await writeFile(join(root, "\u{10000}"), "a");

    const result = await readReferenceSource(root);

    if (!result.ok) throw result.error;
    expect(result.value.entries.map(({ path }) => path)).toEqual([
      "a.js",
      "nested",
      "nested/b.js",
      "z.js",
      "",
      "𐀀",
    ]);
    expect(result.value.bytesRead).toBe(5);
    expect(
      result.value.entries.map((entry) =>
        entry.status === "read" && entry.kind === "file"
          ? Buffer.from(entry.bytes).toString()
          : entry.status === "read"
            ? entry.kind
            : entry.code,
      ),
    ).toEqual(["a", "directory", "b", "z", "p", "a"]);
    expect(result.value.limitations).toHaveLength(1);
  });

  it("reports physical external symlink targets without following them", async () => {
    const root = await createTestTempDirectory("rea-reference-");
    const outside = await createTestTempDirectory("rea-outside-");
    await writeFile(join(outside, "secret"), "secret");
    await writeFile(join(root, "local"), "local");
    await symlink("local", join(root, "internal"));
    await symlink(join(outside, "secret"), join(root, "external"));
    await symlink("absent", join(root, "missing"));

    const result = await readReferenceSource(root);

    if (!result.ok) throw result.error;
    expect(result.value.entries).toEqual([
      {
        status: "read",
        kind: "symlink",
        path: "external",
        target: join(outside, "secret"),
        targetState: "external",
      },
      {
        status: "read",
        kind: "symlink",
        path: "internal",
        target: "local",
        targetState: "internal",
      },
      {
        status: "read",
        kind: "file",
        path: "local",
        bytes: expect.any(Uint8Array),
        size: 5,
      },
      {
        status: "read",
        kind: "symlink",
        path: "missing",
        target: "absent",
        targetState: "missing",
      },
    ]);
    expect(result.value.bytesRead).toBe(5);
    expect(JSON.stringify(result.value.entries)).toContain(
      join(outside, "secret"),
    );
  });

  it("marks a symlink changed when its path is replaced during target observation", async () => {
    const root = await createTestTempDirectory("rea-reference-symlink-race-");
    const link = join(root, "source-link");
    await symlink("original-target", link);
    const expected = await lstat(link, { bigint: true });

    const result = await readStableSymlinkTarget(
      link,
      "source-link",
      expected,
      undefined,
      async () => {
        await unlink(link);
        await symlink("replacement-target", link);
        return {
          status: "read",
          kind: "symlink",
          path: "source-link",
          target: "original-target",
          targetState: "missing",
        };
      },
    );

    expect(result).toEqual({
      status: "failed",
      kind: "symlink",
      path: "source-link",
      code: "changed",
      message: "Symbolic link changed while its target was read",
    });
  });

  it("reads a source file larger than the former 16 MiB ceiling", async () => {
    const root = await createTestTempDirectory("rea-reference-large-");
    const size = 16 * 1024 * 1024 + 1;
    await writeFile(join(root, "large.bin"), Buffer.alloc(size, 0x61));

    const result = await readReferenceSource(root);

    if (!result.ok) throw result.error;
    expect(result.value.bytesRead).toBe(size);
    expect(result.value.entries).toContainEqual(
      expect.objectContaining({
        status: "read",
        kind: "file",
        path: "large.bin",
        size,
      }),
    );
  });

  it("traverses source directories deeper than the former depth ceiling", async () => {
    const root = await createTestTempDirectory("rea-reference-deep-");
    const segments = Array.from({ length: 40 }, (_, index) => `d${index}`);
    const directory = join(root, ...segments);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "deep.txt"), "deep");

    const result = await readReferenceSource(root);

    if (!result.ok) throw result.error;
    const path = [...segments, "deep.txt"].join("/");
    expect(result.value.entries).toContainEqual(
      expect.objectContaining({ status: "read", kind: "file", path }),
    );
    expect(result.value.entries).toHaveLength(41);
  });
});

describe("readReferenceSource failures and exclusions", () => {
  it("applies exclusions to normalized paths after no-follow type inspection", async () => {
    const root = await createTestTempDirectory("rea-reference-");
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, "ignored", "secret"), "secret");
    await writeFile(join(root, "kept"), "kept");
    const checked: Array<[string, string]> = [];

    const result = await readReferenceSource(root, {
      shouldExclude: (path, kind) => {
        checked.push([path, kind]);
        return path === "ignored";
      },
    });

    if (!result.ok) throw result.error;
    expect(checked).toHaveLength(2);
    expect(checked).toEqual(
      expect.arrayContaining([
        ["ignored", "directory"],
        ["kept", "file"],
      ]),
    );
    expect(result.value.entries.map(({ path }) => path)).toEqual(["kept"]);
  });

  it("sanitizes exclusion callback failures", async () => {
    const root = await createTestTempDirectory("rea-reference-");
    await writeFile(join(root, "file"), "value");
    const result = await readReferenceSource(root, {
      shouldExclude: () => {
        throw new Error("private callback detail");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        tag: "reference-source-reader",
        code: "io",
        message: "Reference source exclusion check failed",
        partial: {
          root,
          entries: [],
          bytesRead: 0,
        },
      },
    });
  });

  it("keeps selected-root paths in actionable filesystem errors", async () => {
    const missing = join(tmpdir(), "rea-secret-root-that-does-not-exist");
    const result = await readReferenceSource(missing);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(missing);
  });

  it("returns typed failures for cancellation and invalid roots", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await readReferenceSource("/unused", {
      signal: controller.signal,
    });
    expect(cancelled).toEqual({
      ok: false,
      error: {
        tag: "reference-source-reader",
        code: "cancelled",
        message: "Reference source traversal cancelled",
      },
    });

    const invalid = await readReferenceSource("/path/that/does/not/exist");
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.code).toBe("invalid-root");
  });
});
