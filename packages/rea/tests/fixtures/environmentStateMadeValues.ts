import type { JsonObject } from "../../src/domain/analysisView/environmentStateRules.js";
import type { TimedCaptureRow } from "./analysisView.js";
import { bookClock } from "./environmentStateWrites.js";

/** How a capture of two task creates departs from Vikunja's. */
interface TaskOptions {
  /** Whether tasks carry a `created` clock of their own besides their subscription's. */
  readonly clocked?: boolean;
  /** Whether each create sends the id the task then holds. */
  readonly sentId?: boolean;
  /** A third create, whose subscription names this task rather than its own. */
  readonly thirdSubscribes?: number;
  /** The first create's `identifier`, when not `#` and its index. */
  readonly firstIdentifier?: string;
  /** Whether lists show each task's subscription, as item reads do. */
  readonly listsSubscriptions?: boolean;
  /** A third create of its own task whose subscription shows a clock from before its request. */
  readonly staleThird?: boolean;
}

const seed = (id: number, index: number, clocked: boolean): JsonObject => ({
  id,
  title: `Seeded task ${String(id)}`,
  project_id: 5,
  index,
  identifier: `#${String(index)}`,
  subscription: null,
  ...(clocked ? { created: "2026-10-01T09:00:00Z" } : {}),
});

/** Two task creates at a project path, numbered past tasks deleted before the capture and read back with the subscription the application made, then the list. */
const taskRows = (options: TaskOptions = {}): TimedCaptureRow[] => {
  const clocked = options.clocked ?? true;
  const seeds = [seed(1, 1, clocked), seed(2, 2, clocked)];
  const made = (
    id: number,
    index: number,
    title: string,
    row: number,
    identifier = `#${String(index)}`,
  ): JsonObject => ({
    id,
    title,
    project_id: 5,
    index,
    identifier,
    subscription: null,
    ...(clocked ? { created: bookClock(row) } : {}),
  });
  const subscribed = (
    task: JsonObject,
    subscription: number,
    row: number,
    entity = task["id"]!,
  ): JsonObject => ({
    ...task,
    subscription: {
      id: subscription,
      entity: "task",
      entity_id: entity,
      created: bookClock(row),
    },
  });
  const first = made(
    20,
    15,
    "Replace the lens gasket",
    2,
    options.firstIdentifier,
  );
  const second = made(21, 16, "Log the fog-signal tests", 5);
  const sent = (task: JsonObject) => ({
    ...(options.sentId === true ? { id: task["id"]! } : {}),
    title: task["title"]!,
  });
  const firstRead = subscribed(first, 21, 2);
  const secondRead = subscribed(second, 22, 5);
  const listed = (task: JsonObject): JsonObject => {
    if (options.listsSubscriptions !== false) return task;
    const { subscription: _subscription, ...rest } = task;
    return rest;
  };
  return [
    ["GET", "/api/tasks", seeds.map(listed)],
    ["GET", "/api/tasks/1", seeds[0]!],
    ["POST", "/api/projects/5/tasks", first, 201, sent(first)],
    ["GET", "/api/tasks/20", firstRead],
    ["GET", "/api/tasks", [...seeds, firstRead].map(listed)],
    ["POST", "/api/projects/5/tasks", second, 201, sent(second)],
    ["GET", "/api/tasks/21", secondRead],
    ["GET", "/api/tasks", [...seeds, firstRead, secondRead].map(listed)],
    ...(options.thirdSubscribes === undefined && options.staleThird !== true
      ? []
      : thirdRows(
          made(22, 17, "Paint the gallery rail", 8),
          subscribed(
            made(22, 17, "Paint the gallery rail", 8),
            23,
            options.staleThird === true ? 4 : 8,
            options.thirdSubscribes,
          ),
          [...seeds, firstRead, secondRead].map(listed),
          listed,
          sent,
        )),
  ];
};

/** A third create, its read-back and the list after it. */
const thirdRows = (
  third: JsonObject,
  read: JsonObject,
  before: readonly JsonObject[],
  listed: (task: JsonObject) => JsonObject,
  sent: (task: JsonObject) => JsonObject,
): TimedCaptureRow[] => [
  ["POST", "/api/projects/5/tasks", third, 201, sent(third)],
  ["GET", "/api/tasks/22", read],
  ["GET", "/api/tasks", [...before, listed(read)]],
];

/** Vikunja's two task creates, each read back with a made subscription, then the list. */
export const COUNTED_TASK_ROWS: readonly TimedCaptureRow[] = taskRows();

/** As COUNTED_TASK_ROWS, through a bulk path whose body and answer wrap the one task in `tasks`. */
export const BULK_TASK_ROWS: readonly TimedCaptureRow[] = COUNTED_TASK_ROWS.map(
  (row) =>
    row[0] === "POST"
      ? [
          "POST",
          `${row[1]}/bulk`,
          { tasks: [row[2]!] },
          201,
          { tasks: [row[4]!] },
        ]
      : row,
);

/** COUNTED_TASK_ROWS up to the first create's reads: one create alone shows no counter. */
export const ONE_TASK_ROWS: readonly TimedCaptureRow[] =
  COUNTED_TASK_ROWS.slice(0, 5);

/** Tasks with no clock of their own, so the subscription's is the only one the creates write. */
export const UNCLOCKED_TASK_ROWS: readonly TimedCaptureRow[] = taskRows({
  clocked: false,
});

/** Creates that send the id the task takes. */
export const CHOSEN_ID_TASK_ROWS: readonly TimedCaptureRow[] = taskRows({
  sentId: true,
});

/** A third create whose subscription names the second task, not its own, in a capture whose lists show no subscription. */
export const MISLINKED_TASK_ROWS: readonly TimedCaptureRow[] = taskRows({
  thirdSubscribes: 21,
  listsSubscriptions: false,
});

/** A first create spelling its identifier `TASK-15`, where the second spells `#16`. */
export const RESPELLED_TASK_ROWS: readonly TimedCaptureRow[] = taskRows({
  firstIdentifier: "TASK-15",
});

/** A third create read back with a subscription whose clock is from before its request. */
export const STALE_MADE_TASK_ROWS: readonly TimedCaptureRow[] = taskRows({
  staleThird: true,
});
