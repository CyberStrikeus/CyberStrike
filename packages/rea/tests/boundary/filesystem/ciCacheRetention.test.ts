import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listAllCaches,
  retainCaches,
  selectNpmDownloadDuplicateDeletions,
  selectPrefixDeletions,
} from "../../../scripts/ci/cache-retention.mjs";

const cache = (
  id: number,
  key: string,
  created: string,
  accessed = created,
  size = 100,
  version = "a".repeat(64),
  ref = "refs/heads/main",
) => ({
  id,
  key,
  version,
  ref,
  created_at: created,
  last_accessed_at: accessed,
  size_in_bytes: size,
});

describe("Turbo snapshot retention", () => {
  const prefix = "rea-static-v1-Linux-X64-";

  it("keeps the two newest snapshots and the saved key", () => {
    const keepKey = `${prefix}saved`;
    const deletions = selectPrefixDeletions(
      [
        cache(1, `${prefix}old`, "2026-10-20T01:00:00Z", undefined, 10),
        cache(2, `${prefix}older`, "2026-10-20T02:00:00Z", undefined, 20),
        cache(3, `${prefix}recent`, "2026-10-20T03:00:00Z", undefined, 30),
        cache(4, keepKey, "2026-10-20T00:00:00Z", undefined, 40),
      ],
      { prefix, keepKey },
    );
    expect(deletions.map((entry) => entry.id)).toEqual([1]);
    expect(deletions.reduce((sum, entry) => sum + entry.size, 0)).toBe(10);
  });

  it("keeps an in-flight generation when the saved key is already newest", () => {
    const keepKey = `${prefix}newest`;
    const deletions = selectPrefixDeletions(
      [
        cache(1, `${prefix}a`, "2026-10-20T01:00:00Z"),
        cache(2, `${prefix}b`, "2026-10-20T02:00:00Z"),
        cache(3, `${prefix}c`, "2026-10-20T03:00:00Z"),
        cache(4, keepKey, "2026-10-20T04:00:00Z"),
      ],
      { prefix, keepKey },
    );
    expect(
      deletions.map((entry) => entry.id).sort((left, right) => left - right),
    ).toEqual([1, 2]);
  });

  it("keeps two generations of the deep and Knip snapshot families", () => {
    const deep = "rea-static-deep-v1-Linux-X64-";
    const knip = "knip-meta-v1-Linux-";
    expect(
      selectPrefixDeletions(
        [
          cache(1, `${deep}old`, "2026-10-20T01:00:00Z"),
          cache(2, `${deep}mid`, "2026-10-20T02:00:00Z"),
          cache(3, `${deep}new`, "2026-10-20T03:00:00Z"),
        ],
        { prefix: deep, keepKey: `${deep}new` },
      ).map((entry) => entry.id),
    ).toEqual([1]);
    expect(
      selectPrefixDeletions(
        [
          cache(4, `${knip}old`, "2026-10-20T01:00:00Z"),
          cache(5, `${knip}mid`, "2026-10-20T02:00:00Z"),
          cache(6, `${knip}new`, "2026-10-20T03:00:00Z"),
        ],
        { prefix: knip, keepKey: `${knip}new` },
      ).map((entry) => entry.id),
    ).toEqual([4]);
  });

  it("retains the newest portable snapshots without a caller keep key", () => {
    const portable = "rea-portable-build-v2-Linux-X64-";
    const deletions = selectPrefixDeletions(
      [
        cache(7, `${portable}one`, "2026-10-20T01:00:00Z"),
        cache(8, `${portable}two`, "2026-10-20T02:00:00Z"),
        cache(9, `${portable}three`, "2026-10-20T03:00:00Z"),
      ],
      { prefix: portable },
    );
    expect(deletions.map((entry) => entry.id)).toEqual([7]);
  });

  it("refuses prefixes and lists that can reach download caches", () => {
    expect(() =>
      selectPrefixDeletions([], { prefix: "npm-download-Linux-x64-" }),
    ).toThrow(/one Turbo family/u);
    expect(() =>
      selectPrefixDeletions([], { prefix: "rea-static-v1-" }),
    ).toThrow(/one Turbo family/u);
    expect(() =>
      selectPrefixDeletions([], { prefix: "knip-meta-v1-" }),
    ).toThrow(/one Turbo family/u);
    expect(() =>
      selectPrefixDeletions(
        [cache(1, "npm-download-Linux-x64-abc", "2026-10-20T01:00:00Z")],
        {
          prefix,
          keepKey: `${prefix}saved`,
        },
      ),
    ).toThrow(/outside/u);
    expect(() =>
      selectPrefixDeletions([], {
        prefix,
        keepKey: "rea-static-v1-Windows-X64-other",
      }),
    ).toThrow(/keep key/u);
  });
});

describe("npm download duplicate retention", () => {
  it("deletes only an older copy of the same key, version, and ref", () => {
    const key = "npm-download-Linux-x64-lock";
    const version = "a".repeat(64);
    const ref = "refs/heads/main";
    const deletions = selectNpmDownloadDuplicateDeletions([
      cache(
        1,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T02:00:00Z",
        179,
        version,
        ref,
      ),
      cache(
        2,
        key,
        "2026-10-20T01:05:00Z",
        "2026-10-20T03:00:00Z",
        199,
        version,
        ref,
      ),
      cache(
        3,
        "npm-download-Windows-x64-lock",
        "2026-10-20T01:00:00Z",
        undefined,
        186,
      ),
    ]);
    expect(deletions.map((entry) => entry.id)).toEqual([1]);
  });

  it("keeps records that share a key but differ by version or ref", () => {
    const key = "npm-download-Linux-x64-lock";
    const version = "a".repeat(64);
    const otherVersion = "b".repeat(64);
    const deletions = selectNpmDownloadDuplicateDeletions([
      cache(
        1,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T04:00:00Z",
        199,
        version,
        "refs/heads/main",
      ),
      cache(
        2,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T03:00:00Z",
        188,
        otherVersion,
        "refs/heads/main",
      ),
      cache(
        3,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T02:00:00Z",
        180,
        version,
        "refs/heads/feature",
      ),
    ]);
    expect(deletions).toEqual([]);
  });

  it("refuses a download record without a version or ref", () => {
    const key = "npm-download-Linux-x64-lock";
    const { version: _version, ...withoutVersion } = cache(
      1,
      key,
      "2026-10-20T01:00:00Z",
    );
    expect(() => selectNpmDownloadDuplicateDeletions([withoutVersion])).toThrow(
      /version/u,
    );
    const { ref: _ref, ...withoutRef } = cache(2, key, "2026-10-20T01:00:00Z");
    expect(() => selectNpmDownloadDuplicateDeletions([withoutRef])).toThrow(
      /ref/u,
    );
  });

  it("does not delete the only copy when pagination repeats its id", () => {
    const key = "npm-download-Linux-x64-lock";
    const version = "a".repeat(64);
    const ref = "refs/heads/main";
    const deletions = selectNpmDownloadDuplicateDeletions([
      cache(
        5,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T02:00:00Z",
        179,
        version,
        ref,
      ),
      cache(
        5,
        key,
        "2026-10-20T01:00:00Z",
        "2026-10-20T04:00:00Z",
        179,
        version,
        ref,
      ),
    ]);
    expect(deletions).toEqual([]);
  });

  it("aborts when the same id is listed with a different version", () => {
    const key = "npm-download-Linux-x64-lock";
    expect(() =>
      selectNpmDownloadDuplicateDeletions([
        cache(5, key, "2026-10-20T01:00:00Z", undefined, 179, "a".repeat(64)),
        cache(5, key, "2026-10-20T01:00:00Z", undefined, 179, "b".repeat(64)),
      ]),
    ).toThrow(/inconsistent/u);
  });

  it("refuses a Turbo snapshot in the download list", () => {
    expect(() =>
      selectNpmDownloadDuplicateDeletions([
        cache(1, "rea-static-v1-Linux-X64-sha", "2026-10-20T01:00:00Z"),
      ]),
    ).toThrow(/non-download/u);
  });
});

describe("retention orchestration", () => {
  const repository = "morluto/rea";
  const prefix = "rea-static-v1-Linux-X64-";

  it("deletes nothing when a later list is incomplete", async () => {
    const deleted: number[] = [];
    const page = Array.from({ length: 100 }, (_, index) =>
      cache(index + 1, `${prefix}${String(index)}`, "2026-10-20T01:00:00Z"),
    );
    await expect(
      retainCaches({
        repository,
        request: async (_method, endpoint) => {
          if (endpoint.includes("npm-download-"))
            throw new Error("list failed after the first family");
          return { actions_caches: page };
        },
        deleteCache: async (id) => {
          deleted.push(id);
        },
        families: [{ prefix, keepKey: `${prefix}0` }],
        dedupeNpmDownloads: true,
      }),
    ).rejects.toThrow(/list failed|exceeded/u);
    expect(deleted).toEqual([]);
  });

  it("stops listing once a short page proves the inventory is complete", async () => {
    const requests: string[] = [];
    const caches = await listAllCaches(
      async (_method, endpoint) => {
        requests.push(endpoint);
        const page = new URL(endpoint, "https://example.test").searchParams.get(
          "page",
        );
        return {
          actions_caches:
            page === "1"
              ? Array.from({ length: 100 }, (_, index) =>
                  cache(
                    index + 1,
                    `${prefix}${String(index)}`,
                    "2026-10-20T01:00:00Z",
                  ),
                )
              : [cache(101, `${prefix}last`, "2026-10-20T02:00:00Z")],
        };
      },
      repository,
      prefix,
    );
    expect(caches).toHaveLength(101);
    expect(requests).toHaveLength(2);
  });

  it("applies every family only after both lists succeed", async () => {
    const deleted: number[] = [];
    const keepKey = `${prefix}saved`;
    const portable = "rea-portable-build-v2-Linux-X64-";
    const result = await retainCaches({
      repository,
      request: async (_method, endpoint) => {
        const key = new URL(endpoint, "https://example.test").searchParams.get(
          "key",
        );
        if (key === prefix)
          return {
            actions_caches: [
              cache(1, `${prefix}old`, "2026-10-20T01:00:00Z"),
              cache(2, `${prefix}mid`, "2026-10-20T02:00:00Z"),
              cache(3, keepKey, "2026-10-20T03:00:00Z"),
            ],
          };
        if (key === portable)
          return {
            actions_caches: [
              cache(4, `${portable}old`, "2026-10-20T01:00:00Z"),
              cache(5, `${portable}new`, "2026-10-20T02:00:00Z"),
            ],
          };
        return {
          actions_caches: [
            cache(
              6,
              "npm-download-Linux-x64-lock",
              "2026-10-20T01:00:00Z",
              "2026-10-20T01:00:00Z",
            ),
            cache(
              7,
              "npm-download-Linux-x64-lock",
              "2026-10-20T02:00:00Z",
              "2026-10-20T03:00:00Z",
            ),
          ],
        };
      },
      deleteCache: async (id) => {
        deleted.push(id);
      },
      families: [{ prefix, keepKey }, { prefix: portable }],
      dedupeNpmDownloads: true,
    });
    expect(deleted).toEqual([1, 6]);
    expect(result.plan[0]?.deletions.map((entry) => entry.id)).toEqual([1]);
    expect(result.plan[1]?.deletions).toEqual([]);
    expect(result.npmDeletions.map((entry) => entry.id)).toEqual([6]);
  });

  it("dry-run reports the same deletions without calling delete", async () => {
    const result = await retainCaches({
      repository,
      request: async () => ({
        actions_caches: [
          cache(1, `${prefix}old`, "2026-10-20T01:00:00Z", undefined, 50),
          cache(2, `${prefix}mid`, "2026-10-20T02:00:00Z", undefined, 60),
          cache(3, `${prefix}new`, "2026-10-20T03:00:00Z", undefined, 70),
        ],
      }),
      deleteCache: async () => {
        throw new Error("dry-run must not delete");
      },
      families: [{ prefix, keepKey: `${prefix}new` }],
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.plan[0]?.deletions.map((entry) => entry.id)).toEqual([1]);
  });
});

describe("repeated cache ids", () => {
  const repository = "morluto/rea";
  const prefix = "rea-static-v1-Linux-X64-";

  it("treats one cache id on two pages as a single snapshot", () => {
    const keepKey = `${prefix}saved`;
    const deletions = selectPrefixDeletions(
      [
        cache(1, `${prefix}old`, "2026-10-20T01:00:00Z"),
        cache(2, `${prefix}mid`, "2026-10-20T02:00:00Z"),
        cache(3, keepKey, "2026-10-20T03:00:00Z", "2026-10-20T03:00:00Z"),
        cache(3, keepKey, "2026-10-20T03:00:00Z", "2026-10-20T04:00:00Z"),
      ],
      { prefix, keepKey },
    );
    expect(deletions.map((entry) => entry.id)).toEqual([1]);
  });

  it("does not delete when one cache id is listed with inconsistent fields", async () => {
    const deleted: number[] = [];
    const repeated = cache(3, `${prefix}new`, "2026-10-20T03:00:00Z");
    await expect(
      retainCaches({
        repository,
        request: async () => ({
          actions_caches: [
            cache(1, `${prefix}old`, "2026-10-20T01:00:00Z"),
            cache(2, `${prefix}mid`, "2026-10-20T02:00:00Z"),
            repeated,
            { ...repeated, version: "b".repeat(64) },
          ],
        }),
        deleteCache: async (id) => {
          deleted.push(id);
        },
        families: [{ prefix, keepKey: `${prefix}new` }],
      }),
    ).rejects.toThrow(/inconsistent/u);
    expect(deleted).toEqual([]);
  });
});

it("runs retention from the command line without deleting on an unsafe prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-cache-retention-"));
  const log = join(root, "gh.log");
  const gh = join(root, "gh");
  await writeFile(
    gh,
    `#!/bin/sh
printf '%s\\n' "$@" >> "${log}"
exit 1
`,
  );
  await chmod(gh, 0o755);
  expect(() =>
    execFileSync("node", ["scripts/ci/cache-retention.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
        CI_REPOSITORY: "morluto/rea",
        CACHE_PREFIX: "npm-download-Linux-x64-",
        CACHE_KEEP_KEY: "npm-download-Linux-x64-lock",
      },
      encoding: "utf8",
    }),
  ).toThrow(/one Turbo family/u);
  await expect(readFile(log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});
