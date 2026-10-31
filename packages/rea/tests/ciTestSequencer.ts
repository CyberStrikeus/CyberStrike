import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { BaseSequencer, type TestSpecification } from "vitest/node";
import { z } from "zod";

const reportSchema = z.object({
  version: z.literal(1),
  success: z.literal(true),
  files: z.array(z.unknown()),
});
const fileSchema = z.object({
  name: z.string(),
  durationMs: z.number().finite().positive(),
});

export function parseTestDurations(
  contents: string,
  root: string,
): Map<string, number> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const report = reportSchema.safeParse(value);
  if (!report.success) return undefined;

  const durations = new Map<string, number>();
  for (const value of report.data.files) {
    const result = fileSchema.safeParse(value);
    if (!result.success) continue;
    const { name, durationMs } = result.data;
    const path = relative(root, resolve(root, name));
    if (
      path === "" ||
      path === ".." ||
      path.startsWith(".." + sep) ||
      isAbsolute(path)
    )
      continue;
    const key = path.split(sep).join("/");
    durations.set(key, Math.max(durations.get(key) ?? 0, durationMs));
  }
  return durations.size ? durations : undefined;
}

export async function readTestDurations(
  historyPath: string,
  root: string,
): Promise<Map<string, number> | undefined> {
  try {
    return parseTestDurations(await readFile(historyPath, "utf8"), root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/**
 * Case counts from the competing-loader file before it was split: 54 cases
 * stayed in the percent-path file and 46 ran in each of the three dual-surface
 * shards. History that still names only the original path is that combined
 * cost. The shards are retired; one file now runs every loader through stdio
 * MCP plus a few compiled CLI parity cases.
 */
const LOADER_HISTORY_SOURCE =
  "tests/acceptance/applications/javascriptLiteralPercentPaths.test.ts";
const LOADER_HISTORY_PARTS = [
  "tests/acceptance/applications/javascriptLiteralLoaderOwnershipEarly.test.ts",
  "tests/acceptance/applications/javascriptLiteralLoaderOwnershipMiddle.test.ts",
  "tests/acceptance/applications/javascriptLiteralLoaderOwnershipLate.test.ts",
] as const;
const LOADER_HISTORY_CONSOLIDATED =
  "tests/acceptance/applications/javascriptLiteralLoaderOwnership.test.ts";
const LOADER_HISTORY_REMAINDER_CASES = 54;
const LOADER_HISTORY_PART_CASES = 46;
const LOADER_HISTORY_CASES =
  LOADER_HISTORY_REMAINDER_CASES +
  LOADER_HISTORY_PART_CASES * LOADER_HISTORY_PARTS.length;

/**
 * Charge the consolidated loader file until its own duration is published.
 * A pre-split percent-path duration keeps 54/192 and gives 138/192 to the
 * consolidated file. Recorded Early/Middle/Late durations are summed instead,
 * and a partial set is scaled as three equal shares. That weight is the old
 * dual-surface cost, so the first schedule overestimates the demoted file.
 * A published consolidated duration stands, including beside retired shards.
 */
export function seedLoaderOwnershipDurations(
  durations: ReadonlyMap<string, number>,
): Map<string, number> {
  if (durations.has(LOADER_HISTORY_CONSOLIDATED)) return new Map(durations);
  const recordedParts = LOADER_HISTORY_PARTS.flatMap((path) => {
    const duration = durations.get(path);
    return duration === undefined ? [] : [duration];
  });
  if (recordedParts.length > 0) {
    const seeded = new Map(durations);
    const sum = recordedParts.reduce((total, duration) => total + duration, 0);
    seeded.set(
      LOADER_HISTORY_CONSOLIDATED,
      (sum * LOADER_HISTORY_PARTS.length) / recordedParts.length,
    );
    return seeded;
  }
  const combined = durations.get(LOADER_HISTORY_SOURCE);
  if (combined === undefined) return new Map(durations);
  const seeded = new Map(durations);
  const loaderCases = LOADER_HISTORY_CASES - LOADER_HISTORY_REMAINDER_CASES;
  seeded.set(
    LOADER_HISTORY_SOURCE,
    (combined * LOADER_HISTORY_REMAINDER_CASES) / LOADER_HISTORY_CASES,
  );
  seeded.set(
    LOADER_HISTORY_CONSOLIDATED,
    (combined * loaderCases) / LOADER_HISTORY_CASES,
  );
  return seeded;
}

type TimedItem<T> = {
  item: T;
  key: string;
  duration: number | undefined;
  /**
   * Workers for this file's sequence group. The file still occupies one worker
   * for its full duration; the other lanes only overlap its peers.
   */
  laneWidth?: number;
  /**
   * Vitest sequence group. Groups run from lowest to highest, so a later group
   * adds its own makespan instead of overlapping an earlier one.
   */
  groupOrder?: number;
};

type Phase = { laneWidth: number; lanes: number[] };

const laneWidthOf = <T>(entry: TimedItem<T>): number => {
  const laneWidth = entry.laneWidth ?? 1;
  if (!Number.isInteger(laneWidth) || laneWidth < 1)
    throw new RangeError("laneWidth must be a positive integer");
  return laneWidth;
};

const groupOrderOf = <T>(entry: TimedItem<T>): number => {
  const groupOrder = entry.groupOrder ?? 0;
  if (!Number.isInteger(groupOrder) || groupOrder < 0)
    throw new RangeError("groupOrder must be a non-negative integer");
  return groupOrder;
};

const durationOf = <T>(entry: TimedItem<T>, unknownMs: number): number => {
  const duration = entry.duration ?? unknownMs;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new RangeError("duration must be positive");
  return duration;
};

const wallOf = (phases: ReadonlyMap<number, Phase>): number => {
  let wall = 0;
  for (const phase of phases.values())
    wall += phase.lanes.reduce((max, lane) => Math.max(max, lane), 0);
  return wall;
};

/** Place one whole file on the least-loaded lane of its sequence group. */
const place = <T>(
  phases: ReadonlyMap<number, Phase>,
  entry: TimedItem<T>,
  duration: number,
): Map<number, Phase> => {
  const groupOrder = groupOrderOf(entry);
  const laneWidth = laneWidthOf(entry);
  const existing = phases.get(groupOrder);
  if (existing && existing.laneWidth !== laneWidth)
    throw new RangeError("one sequence group must keep a single lane width");
  const lanes = existing
    ? existing.lanes.slice()
    : Array.from({ length: laneWidth }, () => 0);
  let shortest = 0;
  for (let index = 1; index < lanes.length; index += 1)
    if (lanes[index]! < lanes[shortest]!) shortest = index;
  lanes[shortest] = lanes[shortest]! + duration;
  const next = new Map(phases);
  next.set(groupOrder, { laneWidth, lanes });
  return next;
};

/**
 * Wall time of one shard. Each file keeps its full duration on one worker.
 * Files overlap only inside a sequence group, up to that group's lane width,
 * and later groups run after earlier ones.
 */
export function scheduleWall<T>(
  items: readonly TimedItem<T>[],
  unknownMs: number,
): number {
  const ordered = items.toSorted(
    (left, right) =>
      durationOf(right, unknownMs) - durationOf(left, unknownMs) ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
  return wallOf(
    ordered.reduce(
      (phases, entry) => place(phases, entry, durationOf(entry, unknownMs)),
      new Map<number, Phase>(),
    ),
  );
}

/** Distribute the longest files first, retaining every discovered specification. */
export function allocateByDuration<T>(
  items: readonly TimedItem<T>[],
  shardCount: number,
): T[][] | undefined {
  if (!Number.isInteger(shardCount) || shardCount < 1)
    throw new RangeError("shardCount must be a positive integer");
  const known = items
    .flatMap(({ duration }) => (duration === undefined ? [] : [duration]))
    .sort((left, right) => left - right);
  if (!known.length) return undefined;
  const lower = known[Math.floor((known.length - 1) / 2)]!;
  const median = lower + (known[Math.floor(known.length / 2)]! - lower) / 2;
  const ordered = items.toSorted(
    (left, right) =>
      durationOf(right, median) - durationOf(left, median) ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
  const shards = Array.from({ length: shardCount }, () => ({
    phases: new Map<number, Phase>(),
    items: [] as T[],
  }));
  for (const entry of ordered) {
    const duration = durationOf(entry, median);
    let chosen = shards[0]!;
    let chosenPhases = place(chosen.phases, entry, duration);
    let chosenWall = wallOf(chosenPhases);
    for (const candidate of shards.slice(1)) {
      const phases = place(candidate.phases, entry, duration);
      const wall = wallOf(phases);
      if (wall < chosenWall) {
        chosen = candidate;
        chosenPhases = phases;
        chosenWall = wall;
      }
    }
    chosen.phases = chosenPhases;
    chosen.items.push(entry.item);
  }
  return shards.map(({ items }) => items);
}

export class CiTestSequencer extends BaseSequencer {
  override async shard(
    files: TestSpecification[],
  ): Promise<TestSpecification[]> {
    const historyPath = process.env.REA_CI_TEST_HISTORY;
    const shard = this.ctx.config.shard;
    if (!historyPath || !shard) return super.shard(files);
    const root = this.ctx.config.root;
    const recorded = await readTestDurations(historyPath, root);
    if (!recorded) return super.shard(files);
    const durations = seedLoaderOwnershipDurations(recorded);

    const weighted = files.map((item) => {
      const path = relative(root, resolve(root, item.moduleId))
        .split(sep)
        .join("/");
      const projectWorkers = item.project.config.maxWorkers;
      const laneWidth =
        typeof projectWorkers === "number" &&
        Number.isInteger(projectWorkers) &&
        projectWorkers >= 1
          ? projectWorkers
          : 1;
      return {
        item,
        key: path + "\0" + item.project.name + "\0" + item.pool,
        duration: durations.get(path),
        laneWidth,
        groupOrder: item.project.config.sequence.groupOrder,
      };
    });
    const shards = allocateByDuration(weighted, shard.count);
    return shards ? shards[shard.index - 1]! : super.shard(files);
  }
}
