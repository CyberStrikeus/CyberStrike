import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  allocateByDuration,
  parseTestDurations,
  readTestDurations,
  scheduleWall,
  seedLoaderOwnershipDurations,
} from "../../ciTestSequencer.js";

describe("CI test history", () => {
  it("uses only successful in-root file durations", () => {
    const root = resolve("/workspace/rea");
    const durations = parseTestDurations(
      JSON.stringify({
        version: 1,
        success: true,
        files: [
          {
            name: join(root, "tests/slow.test.ts"),
            durationMs: 100,
          },
          {
            name: join(root, "tests/slow.test.ts"),
            durationMs: 60,
          },
          {
            name: resolve(root, "../outside.test.ts"),
            durationMs: 990,
          },
          { name: "tests/negative.test.ts", durationMs: -1 },
          { name: "tests/zero.test.ts", durationMs: 0 },
          { name: "tests/invalid.test.ts", durationMs: "100" },
          null,
        ],
      }),
      root,
    );

    expect(durations).toEqual(new Map([["tests/slow.test.ts", 100]]));
    expect(
      parseTestDurations('{"version": 1, "success": false, "files": []}', root),
    ).toBeUndefined();
    // Legacy test-body spans must not be mixed with complete module costs.
    expect(
      parseTestDurations(
        JSON.stringify({
          success: true,
          numFailedTests: 0,
          testResults: [
            { name: "tests/legacy.test.ts", startTime: 0, endTime: 100 },
          ],
        }),
        root,
      ),
    ).toBeUndefined();
    expect(parseTestDurations("not json", root)).toBeUndefined();
    expect(parseTestDurations("null", root)).toBeUndefined();
  });

  it("falls back for missing history while preserving real filesystem errors", async () => {
    const temporaryRoot = await createTestTempDirectory("rea-ci-sequencer-");
    const missing = await readTestDurations(
      join(temporaryRoot, "missing.json"),
      temporaryRoot,
    );
    expect(missing).toBeUndefined();

    const directory = join(temporaryRoot, "directory");
    await mkdir(directory);
    const reportPath = join(temporaryRoot, "report.json");
    await writeFile(reportPath, "{");
    expect(await readTestDurations(reportPath, temporaryRoot)).toBeUndefined();

    await expect(
      readTestDurations(directory, temporaryRoot),
    ).rejects.toMatchObject({
      code: "EISDIR",
    });
  });
});

describe("loader ownership history", () => {
  const source =
    "tests/acceptance/applications/javascriptLiteralPercentPaths.test.ts";
  const consolidated =
    "tests/acceptance/applications/javascriptLiteralLoaderOwnership.test.ts";
  const parts = [
    "tests/acceptance/applications/javascriptLiteralLoaderOwnershipEarly.test.ts",
    "tests/acceptance/applications/javascriptLiteralLoaderOwnershipMiddle.test.ts",
    "tests/acceptance/applications/javascriptLiteralLoaderOwnershipLate.test.ts",
  ];

  it("assigns the pre-split loader share to the consolidated file", () => {
    const seeded = seedLoaderOwnershipDurations(
      new Map([
        [source, 192_000],
        ["tests/other.test.ts", 10],
      ]),
    );
    expect(seeded.get(source)).toBe(54_000);
    expect(seeded.get(consolidated)).toBe(138_000);
    for (const path of parts) expect(seeded.has(path)).toBe(false);
    expect(seeded.get("tests/other.test.ts")).toBe(10);
    expect(
      [...seeded.values()].reduce((sum, duration) => sum + duration, 0),
    ).toBe(192_000 + 10);
  });

  it("sums retired shard durations onto the consolidated file", () => {
    const seeded = seedLoaderOwnershipDurations(
      new Map([
        [source, 20_000],
        [parts[0]!, 30_000],
        [parts[1]!, 40_000],
        [parts[2]!, 50_000],
        ["tests/other.test.ts", 10],
      ]),
    );
    expect(seeded.get(source)).toBe(20_000);
    expect(seeded.get(consolidated)).toBe(120_000);
    expect(seeded.get("tests/other.test.ts")).toBe(10);
  });

  it("scales a partial retired shard as three equal shares", () => {
    const seeded = seedLoaderOwnershipDurations(
      new Map([
        [source, 20_000],
        [parts[0]!, 30_000],
      ]),
    );
    expect(seeded.get(source)).toBe(20_000);
    expect(seeded.get(consolidated)).toBe(90_000);
  });

  it("keeps a published consolidated duration", () => {
    const recorded = new Map<string, number>([
      [source, 20_000],
      [parts[0]!, 30_000],
      [consolidated, 12_000],
    ]);
    expect(seedLoaderOwnershipDurations(recorded)).toEqual(recorded);
    expect(
      seedLoaderOwnershipDurations(new Map([["tests/other.test.ts", 10]])),
    ).toEqual(new Map([["tests/other.test.ts", 10]]));
  });
});

describe("duration shard allocation", () => {
  it.prop([
    fc.uniqueArray(fc.integer({ min: 0, max: 10_000 }), {
      minLength: 1,
      maxLength: 80,
    }),
    fc.integer({ min: 3, max: 8 }),
  ])(
    "is complete, disjoint, reference-preserving, and input-order independent",
    (ids, shardCount) => {
      const items = ids.map((id, index) => ({
        id,
        path: `tests/${id}.test.ts`,
        project: `project-${id % 3}`,
        pool: id % 2 === 0 ? "forks" : "threads",
        duration: index > 0 && id % 5 === 0 ? undefined : (id % 17) + 1,
      }));
      const specifications = items.map((item) => ({
        item,
        key: `${item.path}\0${item.project}\0${item.pool}`,
        duration: item.duration,
      }));
      const shards = allocateByDuration(specifications, shardCount);
      const reversedShards = allocateByDuration(
        [...specifications].reverse(),
        shardCount,
      );

      expect(shards).toBeDefined();
      expect(reversedShards).toEqual(shards);
      const assigned = shards!.flat();
      expect(assigned).toHaveLength(items.length);
      expect(new Set(assigned).size).toBe(items.length);
      expect(assigned.every((item) => items.includes(item))).toBe(true);
    },
  );

  it("keeps tied path, project, pool, and new-file entries deterministic", () => {
    const items = [
      {
        id: "a",
        path: "tests/shared.test.ts",
        project: "alpha",
        pool: "forks",
        duration: 10,
      },
      {
        id: "b",
        path: "tests/shared.test.ts",
        project: "beta",
        pool: "forks",
        duration: 10,
      },
      {
        id: "c",
        path: "tests/shared.test.ts",
        project: "beta",
        pool: "threads",
        duration: 10,
      },
      {
        id: "new",
        path: "tests/new.test.ts",
        project: "alpha",
        pool: "forks",
        duration: undefined,
      },
    ];
    const specifications = items.map((item) => ({
      item,
      key: `${item.path}\0${item.project}\0${item.pool}`,
      duration: item.duration,
    }));
    const shards = allocateByDuration(specifications, 3);
    const reversedShards = allocateByDuration([...specifications].reverse(), 3);

    expect(shards).toBeDefined();
    expect(reversedShards).toEqual(shards);
    expect(shards!.flat()).toHaveLength(items.length);
    expect(new Set(shards!.flat()).size).toBe(items.length);
  });

  it("keeps each file whole and runs the serial group after the parallel group", () => {
    const parallel = (id: string, duration: number) => ({
      item: id,
      key: id,
      duration,
      laneWidth: 2,
      groupOrder: 0,
    });
    const serial = (id: string, duration: number) => ({
      item: id,
      key: id,
      duration,
      laneWidth: 1,
      groupOrder: 1,
    });
    const paired = [
      parallel("wide", 300),
      parallel("peer", 300),
      parallel("third", 300),
    ];
    expect(scheduleWall(paired.slice(0, 1), 1)).toBe(300);
    expect(scheduleWall(paired.slice(0, 2), 1)).toBe(300);
    expect(scheduleWall(paired, 1)).toBe(600);
    expect(
      scheduleWall([parallel("ordinary", 100), serial("tail", 60)], 1),
    ).toBe(160);
    expect(() =>
      scheduleWall(
        [parallel("wide", 10), { ...parallel("wide", 10), laneWidth: 1 }],
        1,
      ),
    ).toThrow(RangeError);

    const packed = [
      parallel("ordinary", 100),
      serial("tail-a", 60),
      serial("tail-b", 60),
    ];
    expect(allocateByDuration(packed, 2)).toEqual([
      ["ordinary"],
      ["tail-a", "tail-b"],
    ]);
    const spread = [
      parallel("wide", 300),
      serial("tail-a", 100),
      serial("tail-b", 100),
      parallel("small", 40),
    ];
    const shards = allocateByDuration(spread, 2);
    expect(shards).toEqual([["wide"], ["tail-a", "tail-b", "small"]]);
    expect(
      scheduleWall(
        spread.filter((entry) => entry.item === "wide"),
        1,
      ),
    ).toBe(300);
    expect(
      Math.max(
        ...shards!.map((ids) =>
          scheduleWall(
            spread.filter((entry) => ids.includes(entry.item)),
            1,
          ),
        ),
      ),
    ).toBe(300);
  });
});
