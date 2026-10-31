import { StateRecordChronology } from "./StateRecordChronology.js";
import { parseOffsetDateTimeInstant } from "../offsetDateTime.js";
import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import type { StateRecordFacts } from "./environmentStateRules.js";
import { creationLimit } from "./environmentStateWriteLinks.js";

const record = (
  ordinal: number,
  method: string,
  path: string,
  [start, end] = [ordinal, ordinal],
): StateRecordFacts => ({
  ordinal,
  method,
  path,
  query: undefined,
  status: 200,
  timing: {
    start: {
      instant: parseOffsetDateTimeInstant(new Date(start).toISOString()),
      ms: start,
    },
    endMs: end,
  },
});

/** The creation limit of `/api/projects` over list reads and a POST returning `created`, in ordinal order. */
const projectsLimit = (
  reads: readonly StateRecordFacts[],
  post: StateRecordFacts,
  bodies: ReadonlyMap<number, JsonValue>,
  {
    created,
    retain = () => undefined,
  }: {
    readonly created: readonly string[];
    readonly retain?: (bytes: number) => void;
  },
) =>
  creationLimit(
    [{ record: post, ids: created }],
    {
      chronology: new StateRecordChronology(
        [...reads, post],
        "recorded-start-time",
      ),
      type: "/api/projects",
      tools: [
        {
          name: "get_projects",
          method: "GET",
          path_template: "/api/projects",
          record_ordinals: reads.map((read) => read.ordinal),
        },
      ],
      records: new Map([...reads, post].map((at) => [at.ordinal, at])),
      position: (at) => at.ordinal,
      withBody: (ordinal, use) => use(bodies.get(ordinal)),
      retain,
    },
    undefined,
  );

describe("short-id creation limits", () => {
  it("does not use an unknown completion as the prior read needed to link a short id", () => {
    const prior = record(0, "GET", "/api/projects", [0, 5]);
    const unknown = {
      ...prior,
      timing: { ...prior.timing, endMs: undefined },
    };
    const post = record(1, "POST", "/api/imports", [10, 11]);
    const later = record(2, "GET", "/api/projects/7", [20, 21]);
    const limit = (earlier: StateRecordFacts) =>
      creationLimit(
        [{ record: post, ids: ["7"] }],
        {
          type: "/api/projects",
          chronology: new StateRecordChronology(
            [earlier, post, later],
            "recorded-start-time",
          ),
          tools: [
            {
              name: "list",
              method: "GET",
              path_template: "/api/projects",
              record_ordinals: [0],
            },
            {
              name: "item",
              method: "GET",
              path_template: "/api/projects/{id}",
              record_ordinals: [2],
            },
          ],
          records: new Map(
            [earlier, post, later].map((entry) => [entry.ordinal, entry]),
          ),
          position: (entry) => entry.ordinal,
          withBody: (ordinal, use) => use(ordinal === 0 ? [] : { id: "7" }),
          retain: () => undefined,
        },
        undefined,
      );
    expect(limit(unknown)).toBeUndefined();
    expect(limit(prior)).toBe(post);
  });
});

describe("creation limits", () => {
  it("reads the ids of a list body longer than a call's arguments can spread", () => {
    // A million elements overflow the argument limit of a spread, here and in the test workers' larger stack.
    const [list, post, later] = [
      record(0, "GET", "/api/metrics"),
      record(1, "POST", "/api/imports"),
      record(2, "GET", "/api/metrics"),
    ];
    const bodies = new Map<number, JsonValue>([
      [0, Array.from({ length: 1_000_000 }, () => 0)],
      [2, [{ id: "1003" }]],
    ]);
    const limit = creationLimit(
      [{ record: post, ids: ["1003"] }],
      {
        chronology: new StateRecordChronology(
          [list, post, later],
          "recorded-start-time",
        ),
        type: "/api/metrics",
        tools: [
          {
            name: "get_metrics",
            method: "GET",
            path_template: "/api/metrics",
            record_ordinals: [0, 2],
          },
        ],
        records: new Map([list, post, later].map((at) => [at.ordinal, at])),
        position: (at) => at.ordinal,
        withBody: (ordinal, use) => use(bodies.get(ordinal)),
        retain: () => undefined,
      },
      undefined,
    );
    expect(limit).toBe(post);
  });

  it("counts a read still running when the POST began as showing what it made", () => {
    const earlier = record(0, "GET", "/api/projects", [0, 5]);
    const post = record(2, "POST", "/api/imports", [20, 25]);
    const bodies = new Map<number, JsonValue>([
      [0, [{ id: "proj-0001" }]],
      [1, [{ id: "proj-0001" }, { id: "proj-0002" }]],
    ]);
    // The second list began before the POST but ended after it began, so it may show the import.
    const overlapping = record(1, "GET", "/api/projects", [10, 40]);
    expect(
      projectsLimit([earlier, overlapping], post, bodies, {
        created: ["proj-0002"],
      }),
    ).toBe(post);
    const finished = record(1, "GET", "/api/projects", [10, 15]);
    expect(
      projectsLimit([earlier, finished], post, bodies, {
        created: ["proj-0002"],
      }),
    ).toBeUndefined();
  });
});

describe("the entity identities creation limits use", () => {
  it("reads a list's ids from a suffix-named field when no identity name identifies its entities", () => {
    const [list, post, later] = [
      record(0, "GET", "/api/projects"),
      record(1, "POST", "/api/imports"),
      record(2, "GET", "/api/projects"),
    ];
    const bodies = new Map<number, JsonValue>([
      [0, [{ projectId: "proj-0001", name: "Alpha" }]],
      [
        2,
        [
          { projectId: "proj-0001", name: "Alpha" },
          { projectId: "proj-0002", name: "Beta" },
        ],
      ],
    ]);
    expect(
      projectsLimit([list, later], post, bodies, { created: ["proj-0002"] }),
    ).toBe(post);
  });

  it("reads no suffix-named field as a list's ids when an id field already identifies its entities", () => {
    const [list, post, later] = [
      record(0, "GET", "/api/projects"),
      record(1, "POST", "/api/users/user-0003/activate"),
      record(2, "GET", "/api/projects"),
    ];
    const project = (id: string, ownerId: string) => ({ id, ownerId });
    const bodies = new Map<number, JsonValue>([
      [
        0,
        [project("proj-0001", "user-0001"), project("proj-0002", "user-0002")],
      ],
      [
        2,
        [project("proj-0001", "user-0003"), project("proj-0002", "user-0002")],
      ],
    ]);
    // The owner the user call returned is no project the call made.
    expect(
      projectsLimit([list, later], post, bodies, { created: ["user-0003"] }),
    ).toBeUndefined();
  });

  it("counts no id an item read answered with JSON null, the absence the gate accepts, as shown", () => {
    const item = record(0, "GET", "/api/projects/proj-0002");
    const post = record(1, "POST", "/api/imports");
    const later = record(2, "GET", "/api/projects");
    const bodies = new Map<number, JsonValue>([
      [0, null],
      [2, [{ id: "proj-0001" }, { id: "proj-0002" }]],
    ]);
    const limit = creationLimit(
      [{ record: post, ids: ["proj-0002"] }],
      {
        chronology: new StateRecordChronology(
          [item, post, later],
          "recorded-start-time",
        ),
        type: "/api/projects",
        tools: [
          {
            name: "get_projects_by_id",
            method: "GET",
            path_template: "/api/projects/{id}",
            record_ordinals: [0],
          },
          {
            name: "get_projects",
            method: "GET",
            path_template: "/api/projects",
            record_ordinals: [2],
          },
        ],
        records: new Map([item, post, later].map((at) => [at.ordinal, at])),
        position: (at) => at.ordinal,
        withBody: (ordinal, use) => use(bodies.get(ordinal)),
        retain: () => undefined,
      },
      undefined,
    );
    expect(limit).toBe(post);
  });

  it("reads the ids a list shows from its listed entities, not the entities they nest", () => {
    const [list, post, later] = [
      record(0, "GET", "/api/projects"),
      record(1, "POST", "/api/users"),
      record(2, "GET", "/api/projects"),
    ];
    const project = (owner: string) => ({
      id: "proj-0001",
      owner: { id: owner },
    });
    const bodies = new Map<number, JsonValue>([
      [0, [project("user-0001")]],
      [2, { projects: [project("user-0009")] }],
    ]);
    expect(
      projectsLimit([list, later], post, bodies, { created: ["user-0009"] }),
    ).toBeUndefined();
  });
});

describe("the ids creation limits keep", () => {
  it("keeps and charges only the shown ids a creation returned", () => {
    let retained = 0;
    const lists = 50;
    const reads = Array.from({ length: lists }, (_, index) =>
      record(index < lists / 2 ? index : index + 1, "GET", "/api/projects"),
    );
    const post = record(lists / 2, "POST", "/api/imports");
    const rows = (extra: number) =>
      Array.from({ length: 1000 }, (_, row) => ({
        id: `proj-${String(row + extra).padStart(5, "0")}`,
      }));
    const bodies = new Map<number, JsonValue>(
      reads.map((read) => [
        read.ordinal,
        read.ordinal > post.ordinal
          ? [...rows(0), { id: "proj-made" }]
          : rows(0),
      ]),
    );
    expect(
      projectsLimit(reads, post, bodies, {
        created: ["proj-made"],
        retain: (bytes) => {
          retained += bytes;
        },
      }),
    ).toBe(post);
    // One kept id per later list, not a thousand per list.
    expect(retained).toBeGreaterThan(0);
    expect(retained).toBeLessThan(lists * 1000 * 16);
  });
});

describe("the reads creation limits parse", () => {
  /**
   * The creation limit of `/api/projects` over list reads, a POST returning `proj-0002` that later
   * lists show, and the write that ends the initial reads; with the reads parsed, and those whose
   * body was read after its parse ended.
   */
  const parsedLimit = (
    reads: readonly StateRecordFacts[],
    post: StateRecordFacts,
    until: StateRecordFacts,
  ) => {
    const parsed: number[] = [];
    const outside = new Set<number>();
    let parsing = false;
    const withBody = <T>(
      ordinal: number,
      use: (body: JsonValue | undefined) => T,
    ): T => {
      parsed.push(ordinal);
      const body: JsonValue[] =
        ordinal < post.ordinal
          ? [{ id: "proj-0001" }]
          : [{ id: "proj-0001" }, { id: "proj-0002" }];
      parsing = true;
      try {
        return use(
          new Proxy(body, {
            get: (target, key, receiver) => {
              if (!parsing) outside.add(ordinal);
              return Reflect.get(target, key, receiver) as unknown;
            },
          }),
        );
      } finally {
        parsing = false;
      }
    };
    const limit = creationLimit(
      [{ record: post, ids: ["proj-0002"] }],
      {
        chronology: new StateRecordChronology(
          [...reads, post, until],
          "recorded-start-time",
        ),
        type: "/api/projects",
        tools: [
          {
            name: "get_projects",
            method: "GET",
            path_template: "/api/projects",
            record_ordinals: reads.map((read) => read.ordinal),
          },
        ],
        records: new Map([...reads, post, until].map((at) => [at.ordinal, at])),
        position: (at) => at.ordinal,
        withBody,
        retain: () => undefined,
      },
      until,
    );
    return { limit, parsed, outside };
  };

  it("parses no read at or after the write that ends the initial reads, since no id it shows can be fresh", () => {
    const reads = [0, 2, 4, 5].map((ordinal) =>
      record(ordinal, "GET", "/api/projects"),
    );
    const post = record(1, "POST", "/api/imports");
    const { limit, parsed } = parsedLimit(
      reads,
      post,
      record(3, "PUT", "/api/projects/proj-0001"),
    );
    expect(limit).toBe(post);
    expect(parsed).toEqual([0, 2]);
  });

  it("reads the ids a body shows only while its parse is charged", () => {
    const reads = [0, 2].map((ordinal) =>
      record(ordinal, "GET", "/api/projects"),
    );
    const post = record(1, "POST", "/api/imports");
    const { limit, outside } = parsedLimit(
      reads,
      post,
      record(3, "PUT", "/api/projects/proj-0001"),
    );
    expect(limit).toBe(post);
    expect([...outside]).toEqual([]);
  });
});
