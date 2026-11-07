import { StateRecordChronology } from "./StateRecordChronology.js";
import { parseOffsetDateTimeInstant } from "../offsetDateTime.js";
import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import {
  readOnlyTools,
  type QueryCallIo,
} from "./environmentStateQueryCalls.js";
import type {
  StateRecordFacts,
  StateTimeline,
  StateToolFacts,
} from "./environmentStateRules.js";

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly status?: number | null;
  readonly response?: JsonValue;
  readonly request?: JsonValue;
  readonly tool: string;
  readonly template?: string;
  readonly start?: number;
  readonly end?: number | null;
}

/** How the read-only pass parses response bodies and charges what it keeps of them, when a test watches either. */
interface Bodies {
  readonly withBody?: QueryCallIo["withBody"];
  readonly retain?: (bytes: number) => void;
}

/** The read-only tools of a timeline of calls, ordinals in order; a call spans its index unless it gives its times. */
const readOnlyOf = (
  calls: readonly Call[],
  bodies: Bodies = {},
  timeline: StateTimeline = "recorded-start-time",
): string[] => {
  const records: StateRecordFacts[] = calls.map((call, index) => ({
    ordinal: index,
    method: call.method,
    path: call.path,
    query: call.query,
    status: call.status === undefined ? 200 : call.status,
    timing: {
      start: {
        instant: parseOffsetDateTimeInstant(
          new Date(call.start ?? index).toISOString(),
        ),
        ms: call.start ?? index,
      },
      endMs: call.end === null ? undefined : (call.end ?? index),
    },
  }));
  const tools = new Map<string, StateToolFacts>();
  calls.forEach((call, index) => {
    const known = tools.get(call.tool);
    tools.set(call.tool, {
      name: call.tool,
      method: call.method,
      path_template: call.template ?? call.path,
      record_ordinals: [...(known?.record_ordinals ?? []), index],
    });
  });
  const withBody: QueryCallIo["withBody"] =
    bodies.withBody ?? ((ordinal, use) => use(calls[ordinal]?.response));
  return [
    ...readOnlyTools(
      [...tools.values()],
      records,
      {
        withBody,
        request: (ordinal) => calls[ordinal]?.request,
        retain: bodies.retain ?? (() => undefined),
      },
      new StateRecordChronology(records, timeline),
    ),
  ].sort();
};

const JOBS = [{ id: "night-watch", status: "running" }];

describe("POSTs that read state", () => {
  it("reads a POST answering as the latest GET of its path did, with no write between", () => {
    const get = {
      method: "GET",
      path: "/v1/jobs/statuses",
      tool: "get_statuses",
      response: JOBS,
    };
    const post = {
      method: "POST",
      path: "/v1/jobs/statuses",
      tool: "post_statuses",
      request: { jobs: ["night-watch"] },
    };
    expect(readOnlyOf([get, { ...post, response: JOBS }])).toEqual([
      "post_statuses",
    ]);
    expect(readOnlyOf([get, { ...post, response: [] }])).toEqual([]);
    const write = {
      method: "PUT",
      path: "/v1/job/night-watch",
      tool: "put_job",
      response: {},
    };
    expect(readOnlyOf([get, write, { ...post, response: JOBS }])).toEqual([]);
  });

  it("reads an RPC tunnel whose calls name only read operations, in the body or the query", () => {
    const tunnel = (operations: string[]): Call => ({
      method: "POST",
      path: "/api/v2/internal/nc/base1",
      query: "?operation=batch",
      template: "/api/v2/internal/nc/{uid}",
      tool: "post_internal",
      request: {
        operations: operations.map((operation) => ({ operation, query: {} })),
      },
      response: { results: [] },
    });
    expect(readOnlyOf([tunnel(["tableSyncList", "listScripts"])])).toEqual([
      "post_internal",
    ]);
    expect(
      readOnlyOf([tunnel(["tableList"]), tunnel(["tableCreate"])]),
    ).toEqual([]);
    // A container operation names no operation of its own.
    expect(readOnlyOf([{ ...tunnel([]), request: {} }])).toEqual([]);
    const queried = {
      method: "POST",
      path: "/rpc",
      query: "?op=getUser",
      tool: "post_rpc",
      response: {},
    };
    expect(readOnlyOf([queried])).toEqual(["post_rpc"]);
  });

  it("skips a container operation in the body as in the query, still needing a real read", () => {
    const rpc = (request: JsonValue): Call => ({
      method: "POST",
      path: "/rpc",
      tool: "post_rpc",
      request,
      response: {},
    });
    const batch = (operation: string): JsonValue => ({
      operation: "batch",
      operations: [{ operation }],
    });
    expect(readOnlyOf([rpc(batch("getUser"))])).toEqual(["post_rpc"]);
    expect(readOnlyOf([rpc(batch("createUser"))])).toEqual([]);
    expect(readOnlyOf([rpc({ operation: "batch" })])).toEqual([]);
  });

  it("reads a POST whose path names a lookup word, split on underscores, hyphens and case", () => {
    const post = (path: string, tool: string, template = path): Call => ({
      method: "POST",
      path,
      template,
      tool,
      response: [],
    });
    expect(
      readOnlyOf([
        post("/api/documents/selection_data/", "post_selection"),
        post(
          "/api/v4/channels/c1/members/ids",
          "post_member_ids",
          "/api/v4/channels/{uid}/members/ids",
        ),
        post("/v1/discover", "post_discover"),
        post("/api/members", "post_members"),
      ]),
    ).toEqual(["post_discover", "post_member_ids", "post_selection"]);
  });

  it("reads a lookup by a segment's last meaningful word, so a query history stays a write", () => {
    const post = (path: string, tool: string): Call => ({
      method: "POST",
      path,
      tool,
      response: {},
    });
    expect(
      readOnlyOf([
        post("/api/query-history", "post_query_history"),
        post("/api/documents/selection_data/", "post_selection"),
        post("/api/search-results", "post_search_results"),
      ]),
    ).toEqual(["post_search_results", "post_selection"]);
  });

  it("reads a lookup only by the last literal segment, so a trailing write action stays a write", () => {
    const post = (path: string, tool: string, template = path): Call => ({
      method: "POST",
      path,
      template,
      tool,
      response: {},
    });
    expect(
      readOnlyOf([
        post("/api/documents/selection_data/import", "post_import"),
        post("/api/saved-query/create", "post_saved_query"),
        post("/api/views/create_lookup", "post_create_lookup"),
        post(
          "/api/lookup_data/users",
          "post_lookup",
          "/api/lookup_data/{kind}",
        ),
      ]),
    ).toEqual(["post_lookup"]);
  });

  it("reads a session renewal, not a create in the same collection tree", () => {
    const post = (path: string, tool: string): Call => ({
      method: "POST",
      path,
      tool,
      response: { token: "x" },
    });
    expect(
      readOnlyOf([
        post("/api/collections/_superusers/auth-refresh", "post_auth_refresh"),
        post("/api/collections/notes/records", "post_records"),
      ]),
    ).toEqual(["post_auth_refresh"]);
  });
});

describe("POSTs that read state but stay writes", () => {
  it("keeps a lookup-named POST a write when a read its path relates to changes across it alone", () => {
    const read = (members: string[]): Call => ({
      method: "GET",
      path: "/api/members",
      tool: "get_members",
      response: members,
    });
    const post: Call = {
      method: "POST",
      path: "/api/members/ids",
      tool: "post_ids",
      response: ["a"],
    };
    expect(readOnlyOf([read(["a"]), post, read(["a", "b"])])).toEqual([]);
    expect(readOnlyOf([read(["a"]), post, read(["a"])])).toEqual(["post_ids"]);
    // Another write between explains the change, so the POST stays read-only.
    const other: Call = {
      method: "PUT",
      path: "/api/members/b",
      tool: "put_member",
      response: {},
    };
    expect(readOnlyOf([read(["a"]), post, other, read(["a", "b"])])).toEqual([
      "post_ids",
    ]);
  });

  it("keeps a lookup-named POST a write when only another read-only POST sits between it and a changed read", () => {
    const read = (members: string[]): Call => ({
      method: "GET",
      path: "/api/members",
      tool: "get_members",
      response: members,
    });
    const post: Call = {
      method: "POST",
      path: "/api/members/ids",
      tool: "post_ids",
      response: ["a"],
    };
    const refresh: Call = {
      method: "POST",
      path: "/api/collections/_superusers/auth-refresh",
      tool: "post_auth_refresh",
      response: { token: "x" },
    };
    expect(readOnlyOf([read(["a"]), post, refresh, read(["a", "b"])])).toEqual([
      "post_auth_refresh",
    ]);
    expect(readOnlyOf([read(["a"]), refresh, post, read(["a", "b"])])).toEqual([
      "post_auth_refresh",
    ]);
  });

  it("keeps a POST a write when one of its calls was redirected or went unanswered", () => {
    const post = (status: number | null): Call => ({
      method: "POST",
      path: "/api/members/ids",
      tool: "post_ids",
      status,
      response: ["a"],
    });
    expect(readOnlyOf([post(200), post(302)])).toEqual([]);
    expect(readOnlyOf([post(200), post(null)])).toEqual([]);
    // A refused call changed nothing, so it does not hold the tool.
    expect(readOnlyOf([post(200), post(400)])).toEqual(["post_ids"]);
  });

  it("keeps a batch a write when one of its entries names no read operation of its own", () => {
    const rpc = (operations: JsonValue): Call => ({
      method: "POST",
      path: "/rpc",
      tool: "post_rpc",
      request: { operation: "batch", operations },
      response: {},
    });
    const read = { operation: "getUser" };
    expect(readOnlyOf([rpc([read, read])])).toEqual(["post_rpc"]);
    expect(readOnlyOf([rpc([read, { method: "deleteUser" }])])).toEqual([]);
    expect(readOnlyOf([rpc([read, "deleteUser"])])).toEqual([]);
    expect(readOnlyOf([rpc([read, { operation: 7 }])])).toEqual([]);
    expect(
      readOnlyOf([rpc([read, { operation: "batch", operations: [] }])]),
    ).toEqual([]);
    expect(readOnlyOf([rpc({ first: read })])).toEqual([]);
  });

  it("keeps an RPC call a write when it finds and then modifies or replaces", () => {
    const rpc = (operation: string): Call => ({
      method: "POST",
      path: "/rpc",
      tool: "post_rpc",
      request: { operation },
      response: {},
    });
    expect(readOnlyOf([rpc("findOne")])).toEqual(["post_rpc"]);
    expect(readOnlyOf([rpc("findAndModify")])).toEqual([]);
    expect(readOnlyOf([rpc("findOneAndReplace")])).toEqual([]);
  });
});

describe("the reads either side of a POST", () => {
  it("requires known read completion without discarding independent known intervals", () => {
    const known: Call = {
      method: "GET",
      path: "/api/members",
      tool: "get_members",
      response: JOBS,
      start: 0,
      end: 5,
    };
    const unknown = { ...known, start: 6, end: null };
    const post: Call = {
      method: "POST",
      path: "/api/members",
      tool: "post_members",
      response: JOBS,
      start: 10,
      end: 11,
    };
    expect(readOnlyOf([unknown, post])).toEqual([]);
    expect(readOnlyOf([known, unknown, post])).toEqual(["post_members"]);
    expect(readOnlyOf([unknown, post], {}, "record-order")).toEqual([
      "post_members",
    ]);
  });

  it("compares a POST only with reads that finished before it began or began after it ended", () => {
    const note = (title: string): Call => ({
      method: "GET",
      path: "/v1/notes/7",
      template: "/v1/notes/{id}",
      tool: "get_note",
      response: { id: 7, title },
    });
    const post: Call = {
      method: "POST",
      path: "/v1/notes/7",
      template: "/v1/notes/{id}",
      tool: "post_note",
      request: { title: "Renamed" },
      response: { id: 7, title: "Renamed" },
      start: 10,
      end: 20,
    };
    const at = (call: Call, start: number, end: number): Call => ({
      ...call,
      start,
      end,
    });
    const renamed = note("Renamed");
    const original = note("Draft");
    expect(readOnlyOf([at(renamed, 0, 5), post, at(renamed, 40, 41)])).toEqual([
      "post_note",
    ]);
    // A read still running when the POST began may already show its change.
    expect(readOnlyOf([at(renamed, 0, 30), post, at(renamed, 40, 41)])).toEqual(
      [],
    );
    // A read begun before the POST ended may not show it yet, so the later read decides.
    expect(
      readOnlyOf([
        at(original, 0, 5),
        { ...post, response: original.response! },
        at(original, 15, 25),
        at(renamed, 40, 41),
      ]),
    ).toEqual([]);
    // Of the reads finished before the POST began, the one that finished last decides, not the one begun last.
    expect(
      readOnlyOf([
        at(original, 0, 9),
        at(renamed, 1, 2),
        post,
        at(renamed, 40, 41),
      ]),
    ).toEqual([]);
  });

  it("compares a POST with a read begun after another write, which shows that write's effect", () => {
    const message = { id: 1001, body: "hello" };
    const get = (
      start: number,
      end: number,
      status = 200,
      response: JsonValue = message,
    ): Call => ({
      method: "GET",
      path: "/api/messages/1001",
      template: "/api/messages/{id}",
      tool: "get_message",
      status,
      response,
      start,
      end,
    });
    const put: Call = {
      method: "PUT",
      path: "/api/messages/1001",
      template: "/api/messages/{id}",
      tool: "put_message",
      response: message,
      start: 1,
      end: 2,
    };
    const consume: Call = {
      method: "POST",
      path: "/api/messages/1001/ids",
      template: "/api/messages/{id}/ids",
      tool: "post_ids",
      response: ["1001"],
      start: 10,
      end: 11,
    };
    // The read that finished last began before the PUT; the shorter one after it shows the message survived the PUT.
    expect(
      readOnlyOf([
        get(0, 9),
        put,
        get(3, 4),
        consume,
        get(12, 13, 404, { error: "Not found" }),
      ]),
    ).toEqual([]);
  });

  it("keeps a POST a write when a read of its path finds the entity gone after it", () => {
    const message = { id: 1001, body: "hello" };
    const get = (status: number, response: JsonValue): Call => ({
      method: "GET",
      path: "/api/messages/1001",
      template: "/api/messages/{id}",
      tool: "get_message",
      status,
      response,
    });
    const post: Call = {
      method: "POST",
      path: "/api/messages/1001",
      template: "/api/messages/{id}",
      tool: "post_message",
      response: message,
    };
    expect(readOnlyOf([get(200, message), post, get(200, message)])).toEqual([
      "post_message",
    ]);
    expect(
      readOnlyOf([get(200, message), post, get(404, { error: "Not found" })]),
    ).toEqual([]);
  });
});

describe("read-only decisions over many calls", () => {
  it("visits each write-free stretch once for all of a lookup's calls in it", () => {
    let visits = 0;
    const calls = 2000;
    const records: StateRecordFacts[] = Array.from(
      { length: calls * 2 },
      (_, index) => {
        const read = index % 2 === 0;
        const record = {
          ordinal: index,
          path: read ? "/api/members" : "/api/members/ids",
          query: undefined,
          status: 200,
          timing: {
            start: {
              instant: parseOffsetDateTimeInstant(
                new Date(index).toISOString(),
              ),
              ms: index,
            },
            endMs: index,
          },
        };
        const method = read ? "GET" : "POST";
        return Object.defineProperty(record, "method", {
          enumerable: true,
          get: () => {
            visits += 1;
            return method;
          },
        }) as StateRecordFacts;
      },
    );
    const ordinals = (read: boolean) =>
      records
        .filter((record) => (record.ordinal % 2 === 0) === read)
        .map((record) => record.ordinal);
    const tools: StateToolFacts[] = [
      {
        name: "get_members",
        method: "GET",
        path_template: "/api/members",
        record_ordinals: ordinals(true),
      },
      {
        name: "post_ids",
        method: "POST",
        path_template: "/api/members/ids",
        record_ordinals: ordinals(false),
      },
    ];
    visits = 0;
    expect([
      ...readOnlyTools(
        tools,
        records,
        {
          withBody: (_ordinal, use) => use([]),
          request: () => undefined,
          retain: () => undefined,
        },
        new StateRecordChronology(records, "recorded-start-time"),
      ),
    ]).toEqual(["post_ids"]);
    expect(visits).toBeLessThan(50 * records.length);
  });
});

describe("read-only decisions over a long run of calls", () => {
  it("finds each call's repeated read without rescanning the run before it", () => {
    let visits = 0;
    const calls = 2000;
    const records: StateRecordFacts[] = Array.from(
      { length: calls * 2 },
      (_, index) => {
        const read = index % 2 === 0;
        const record = {
          ordinal: index,
          path: "/v1/jobs/statuses",
          query: undefined,
          status: 200,
          timing: {
            start: {
              instant: parseOffsetDateTimeInstant(
                new Date(index).toISOString(),
              ),
              ms: index,
            },
            endMs: index,
          },
        };
        const method = read ? "GET" : "POST";
        return Object.defineProperty(record, "method", {
          enumerable: true,
          get: () => {
            visits += 1;
            return method;
          },
        }) as StateRecordFacts;
      },
    );
    const ordinals = (read: boolean) =>
      records
        .filter((record) => (record.ordinal % 2 === 0) === read)
        .map((record) => record.ordinal);
    const tools: StateToolFacts[] = [
      {
        name: "get_statuses",
        method: "GET",
        path_template: "/v1/jobs/statuses",
        record_ordinals: ordinals(true),
      },
      {
        name: "post_statuses",
        method: "POST",
        path_template: "/v1/jobs/statuses",
        record_ordinals: ordinals(false),
      },
    ];
    visits = 0;
    expect([
      ...readOnlyTools(
        tools,
        records,
        {
          withBody: (_ordinal, use) => use(JOBS),
          request: () => ({ jobs: ["night-watch"] }),
          retain: () => undefined,
        },
        new StateRecordChronology(records, "recorded-start-time"),
      ),
    ]).toEqual(["post_statuses"]);
    expect(visits).toBeLessThan(50 * records.length);
  });
});

describe("read-only decisions over many lines", () => {
  it("reads each related line's records once per call, however many lines the lookup's path relates to", () => {
    let reads = 0;
    const lines = 2000;
    const records: StateRecordFacts[] = Array.from(
      { length: lines + 1 },
      (_, index) => {
        const read = index < lines;
        const record = {
          ordinal: index,
          method: read ? "GET" : "POST",
          path: read ? "/api/members" : "/api/members/ids",
          status: 200,
          timing: {
            start: {
              instant: parseOffsetDateTimeInstant(
                new Date(index).toISOString(),
              ),
              ms: index,
            },
            endMs: index,
          },
        };
        const query = read ? `?page=${String(index)}` : undefined;
        return Object.defineProperty(record, "query", {
          enumerable: true,
          get: () => {
            reads += 1;
            return query;
          },
        }) as StateRecordFacts;
      },
    );
    const tools: StateToolFacts[] = [
      {
        name: "get_members",
        method: "GET",
        path_template: "/api/members",
        record_ordinals: records
          .slice(0, lines)
          .map((record) => record.ordinal),
      },
      {
        name: "post_ids",
        method: "POST",
        path_template: "/api/members/ids",
        record_ordinals: [lines],
      },
    ];
    expect([
      ...readOnlyTools(
        tools,
        records,
        {
          withBody: (_ordinal, use) => use([]),
          request: () => undefined,
          retain: () => undefined,
        },
        new StateRecordChronology(records, "recorded-start-time"),
      ),
    ]).toEqual(["post_ids"]);
    expect(reads).toBeLessThan(20 * records.length);
  });
});

describe("the bodies read-only decisions compare", () => {
  const read = (members: string[]): Call => ({
    method: "GET",
    path: "/api/members",
    tool: "get_members",
    response: members,
  });
  const lookup: Call = {
    method: "POST",
    path: "/api/members/ids",
    tool: "post_ids",
    response: ["a"],
  };
  const refresh: Call = {
    method: "POST",
    path: "/api/collections/_superusers/auth-refresh",
    tool: "post_auth_refresh",
    response: { token: "x" },
  };
  // The change across the lookup's calls drops it on the first pass, so the refresh is checked again.
  const calls = [read(["a"]), lookup, lookup, refresh, read(["a", "b"])];

  it("parses each read once across a tool's calls and the passes that drop vetoed tools", () => {
    const parses = new Map<number, number>();
    expect(
      readOnlyOf(calls, {
        withBody: (ordinal, use) => {
          parses.set(ordinal, (parses.get(ordinal) ?? 0) + 1);
          return use(calls[ordinal]?.response);
        },
      }),
    ).toEqual(["post_auth_refresh"]);
    expect([...parses].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("compares bodies only while their parse is charged, and charges what it keeps of each", () => {
    const [parsed, outside] = [new Set<number>(), new Set<number>()];
    let parsing = false;
    let retained = 0;
    expect(
      readOnlyOf(calls, {
        withBody: (ordinal, use) => {
          parsed.add(ordinal);
          const body = calls[ordinal]?.response;
          parsing = true;
          try {
            return use(
              typeof body === "object" && body !== null
                ? new Proxy(body, {
                    get: (target, key, receiver) => {
                      if (!parsing) outside.add(ordinal);
                      return Reflect.get(target, key, receiver) as unknown;
                    },
                  })
                : body,
            );
          } finally {
            parsing = false;
          }
        },
        retain: (bytes) => {
          retained += bytes;
        },
      }),
    ).toEqual(["post_auth_refresh"]);
    expect([...outside]).toEqual([]);
    // Each body is kept as its digest's hex text, charged before it is.
    expect(retained).toBeGreaterThanOrEqual(parsed.size * 64);
  });
});
