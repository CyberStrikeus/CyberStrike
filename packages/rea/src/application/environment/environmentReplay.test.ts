import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentServeFixture,
  environmentServeSource,
  environmentServeSourceWithBody as singleExchangeSource,
} from "../../../tests/fixtures/environmentServe.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { inspectAnalysisView } from "../analysisView/AnalysisViewService.js";
import {
  REPLAY_BODY_LIMIT_BYTES,
  type EnvironmentSource,
  type RecordedExchange,
} from "./environmentSource.js";
import {
  replayEnvironmentTool,
  selectReplayExchange,
} from "./environmentReplay.js";

const source = environmentServeSource();

const tool = (name: string, from: EnvironmentSource = source) => {
  const found = from.manifest.tools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Fixture manifest lacks ${name}`);
  return found;
};

const replay = (
  name: string,
  args: Readonly<Record<string, unknown>>,
  from: EnvironmentSource = source,
) => {
  const result = replayEnvironmentTool(from, tool(name, from), args);
  if (!result.ok) throw result.error;
  return result.value;
};

/** The fixture source with /api/users/2's response replaced by HAR base64 content the decoder retained. */
const base64Source = async (bytes: Buffer): Promise<EnvironmentSource> => {
  const encoded = bytes.toString("base64");
  const capture = environmentManifestCaptureFixture([
    {
      request: { method: "GET", url: "http://grafana.example/api/users/2" },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: encoded,
          encoding: "base64",
        },
      },
    },
  ]);
  const record = capture.records[0];
  if (record === undefined) throw new Error("Fixture lacks /api/users/2");
  record.binary_fields = [
    {
      pointer: "/response/content/text",
      representation: "har-base64-content",
      state: "retained",
      content_base64: encoded,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  const evidence = analysisViewCaptureEvidence(capture);
  const manifest = await inspectAnalysisView({
    source: { kind: "inline", evidence },
    view: { kind: "environment-manifest" },
  });
  if (!manifest.ok) throw manifest.error;
  expect(environmentServeFixture().manifest.evidence_id).not.toBe(
    manifest.value.evidence_id,
  );
  return environmentServeSource({
    manifest: manifest.value,
    capture: evidence,
  });
};

describe("replay argument mapping and query admission", () => {
  it("does not inspect a recorded query when no query argument can affect selection", () => {
    const users = tool("get_users_by_id");
    const original = source.exchanges.get(users.record_ordinals[0]!);
    if (original === undefined) throw new Error("Missing fixture exchange");
    const exchange = {
      ...original,
      get query(): string {
        throw new Error("Query must not be inspected");
      },
    };
    expect(
      selectReplayExchange(users, new Map([[original.ordinal, exchange]]), {
        id: "2",
      }),
    ).toMatchObject({ exact: true });
  });

  it("matches a bounded path argument alias against the complete retained parameter", () => {
    const users = tool("get_users_by_id");
    const long = {
      ...users,
      params: users.params.map((param) => ({
        ...param,
        name: "long".repeat(1000),
      })),
    };
    expect(
      selectReplayExchange(long, source.exchanges, { path_1: "3" }),
    ).toMatchObject({ exchange: { path: "/api/users/3" }, exact: true });
  });
});

describe("encoded replay path segments", () => {
  it.each([
    ["2", "%32", true],
    ["%32", "2", true],
    ["book1", "book%2531", false],
    ["book%2531", "book1", false],
    ["book%31", "book%2531", true],
  ] as const)(
    "matches %s against %s by at most one decode",
    (segment, value, exact) => {
      const users = tool("get_users_by_id");
      const ordinal = users.record_ordinals[0]!;
      const exchange = {
        ...source.exchanges.get(ordinal)!,
        path: `/api/users/${segment}`,
      };
      expect(
        selectReplayExchange(users, new Map([[ordinal, exchange]]), {
          id: value,
        }),
      ).toMatchObject({
        exchange,
        exact,
      });
    },
  );
});

describe("replayEnvironmentTool selection", () => {
  it("uses observed cross-name query order and marks ambiguous key-wise replay inexact", () => {
    const search = tool("get_search");
    const [first, second] = search.record_ordinals;
    if (first === undefined || second === undefined)
      throw new Error("Fixture search tool must cite two records");
    const exchanges = new Map<number, RecordedExchange>([
      [
        first,
        {
          ordinal: first,
          path: "/api/search",
          query: "?query=a&type=b&query=c",
          status: 200,
          contentType: null,
          bodyText: "first",
        },
      ],
      [
        second,
        {
          ordinal: second,
          path: "/api/search",
          query: "?query=a&query=c&type=b",
          status: 200,
          contentType: null,
          bodyText: "second",
        },
      ],
    ]);
    const args = { query: ["a", "c"], type: "b" };
    expect(
      selectReplayExchange(search, exchanges, args, "?query=a&type=b&query=c"),
    ).toMatchObject({ exchange: { ordinal: first }, exact: true });
    expect(
      selectReplayExchange(search, exchanges, args, "?query=a&query=c&type=b"),
    ).toMatchObject({ exchange: { ordinal: second }, exact: true });
    expect(selectReplayExchange(search, exchanges, args)).toMatchObject({
      exchange: { ordinal: first },
      exact: false,
    });
    const translated = new Map([
      [
        first,
        {
          ...exchanges.get(first)!,
          query: "?query=seed&type=b&query=c",
        },
      ],
    ]);
    expect(
      selectReplayExchange(
        search,
        translated,
        { query: ["seed", "c"], type: "b" },
        "?query=live&type=b&query=c",
      ),
    ).toMatchObject({ exchange: { ordinal: first }, exact: true });
  });
  it("selects the record only when every repeated query occurrence matches", () => {
    const base = source.exchanges.get(tool("get_search").record_ordinals[0]!);
    if (base === undefined) throw new Error("Missing search fixture exchange");
    const search = {
      ...tool("get_search"),
      query_parameter_names: ["tag"],
      record_ordinals: [901, 902],
    };
    const exchanges = new Map<number, RecordedExchange>([
      [901, { ...base, ordinal: 901, query: "?tag=a&tag=b" }],
      [902, { ...base, ordinal: 902, query: "?tag=a&tag=c" }],
    ]);
    expect(
      selectReplayExchange(search, exchanges, { tag: ["a", "c"] }),
    ).toMatchObject({
      exchange: { ordinal: 902, query: "?tag=a&tag=c" },
      exact: true,
    });
    expect(
      selectReplayExchange(search, exchanges, { tag: ["a", "d"] }),
    ).toMatchObject({ exchange: { ordinal: 901 }, exact: false });
  });

  it("replays the record whose path segments equal the supplied parameters as an exact match", () => {
    const result = replay("get_users_by_id", { id: "2" });
    expect(result).toMatchObject({
      status: 200,
      content_type: "application/json",
      body: { id: 2, login: "probe" },
      replay: {
        evidence_id: source.evidenceId,
        exact_match: true,
        recorded_path: "/api/users/2",
        recorded_query: null,
        body_recorded: true,
        truncated: false,
      },
    });
    expect(replay("get_users_by_id", { id: "3" })).toMatchObject({
      body: { login: "viewer" },
      replay: { exact_match: true, recorded_path: "/api/users/3" },
    });
    expect(
      replay("get_folders_by_uid", { uid: "general" }).replay,
    ).toMatchObject({
      exact_match: true,
      recorded_path: "/api/folders/general",
    });
  });

  it("falls back to the tool's first record, flagged inexact, when no record matches", () => {
    const users = tool("get_users_by_id");
    const result = replay("get_users_by_id", { id: "999" });
    expect(result.replay).toMatchObject({
      record_ordinal: users.record_ordinals[0],
      exact_match: false,
      recorded_path: "/api/users/2",
    });
    expect(result.body).toMatchObject({ login: "probe" });
    // Omitted parameters cannot mismatch: a call without arguments is exact on the first record.
    expect(replay("get_users_by_id", {}).replay.exact_match).toBe(true);
  });

  it("matches query values after path segments and reports the recorded query", () => {
    const both = replay("get_search", { query: "probe", type: "dash-db" });
    expect(both.replay).toMatchObject({
      exact_match: true,
      recorded_path: "/api/search",
      recorded_query: "?query=probe&type=dash-db",
    });
    expect(Array.isArray(both.body)).toBe(true);
    expect(both.body).toMatchObject([{ title: "probe dashboard" }]);
    const folder = replay("get_search", { type: "dash-folder" });
    expect(folder.replay).toMatchObject({
      exact_match: true,
      recorded_query: "?query=&type=dash-folder",
    });
    const unmatched = replay("get_search", { type: "dash-nothing" });
    expect(unmatched.replay.exact_match).toBe(false);
    expect(unmatched.replay.recorded_query).toBe("?query=probe&type=dash-db");
  });
});

describe("replay selection precedence", () => {
  it("prefers a recorded segment equal to the argument over one that only matches after decoding", () => {
    const users = { ...tool("get_users_by_id"), record_ordinals: [901, 902] };
    const exchange = (ordinal: number, path: string): RecordedExchange => ({
      ordinal,
      path,
      query: null,
      status: 200,
      contentType: null,
      bodyText: null,
    });
    const exchanges = new Map<number, RecordedExchange>([
      [901, exchange(901, "/api/users/a%252Fb")],
      [902, exchange(902, "/api/users/a%2Fb")],
    ]);
    expect(
      selectReplayExchange(users, exchanges, { id: "a%2Fb" }),
    ).toMatchObject({ exchange: { ordinal: 902 }, exact: true });
    expect(selectReplayExchange(users, exchanges, { id: "a/b" })).toMatchObject(
      { exchange: { ordinal: 902 }, exact: true },
    );
  });

  it("replays an aliased query argument against the captured long name", () => {
    const longName = "n".repeat(100);
    const search = {
      ...tool("get_search"),
      query_parameter_names: [longName],
      record_ordinals: [901, 902],
    };
    const exchange = (ordinal: number, value: string): RecordedExchange => ({
      ordinal,
      path: "/api/search",
      query: `?${longName}=${value}`,
      status: 200,
      contentType: null,
      bodyText: null,
    });
    const exchanges = new Map<number, RecordedExchange>([
      [901, exchange(901, "a")],
      [902, exchange(902, "b")],
    ]);
    expect(
      selectReplayExchange(search, exchanges, { query_1: "b" }),
    ).toMatchObject({ exchange: { ordinal: 902 }, exact: true });
  });

  it("prefers path matches over query matches and keeps manifest order on ties", () => {
    const search = tool("get_search");
    const [first, second] = search.record_ordinals;
    if (first === undefined || second === undefined)
      throw new Error("Fixture search tool must cite two records");
    const exchanges = new Map<number, RecordedExchange>([
      [
        first,
        {
          ordinal: first,
          path: "/api/search",
          query: "?type=a",
          status: 200,
          contentType: null,
          bodyText: null,
        },
      ],
      [
        second,
        {
          ordinal: second,
          path: "/api/search",
          query: "?type=a",
          status: 200,
          contentType: null,
          bodyText: null,
        },
      ],
    ]);
    expect(
      selectReplayExchange(search, exchanges, { type: "a" }),
    ).toMatchObject({ exchange: { ordinal: first }, exact: true });
    expect(
      selectReplayExchange(search, new Map(), { type: "a" }),
    ).toBeUndefined();
    const refused = replayEnvironmentTool(
      { ...source, exchanges: new Map() },
      search,
      {},
    );
    if (refused.ok) throw new Error("Expected a refusal without records");
    expect(projectAnalysisError(refused.error)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["tool"], expected: "get_search" }] },
    });
  });
});

describe("replayEnvironmentTool argument names", () => {
  it("matches a query value whose name collides with a path parameter under its renamed argument", () => {
    const users = tool("get_users_by_id");
    const exchange = (ordinal: number, query: string): RecordedExchange => ({
      ordinal,
      path: "/api/users/2",
      query,
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({ query }),
    });
    const colliding = {
      ...users,
      query_parameter_names: ["id"],
      record_ordinals: [901, 902],
    };
    const from: EnvironmentSource = {
      ...source,
      exchanges: new Map([
        [901, exchange(901, "id=3")],
        [902, exchange(902, "id=4")],
      ]),
    };
    const result = replayEnvironmentTool(from, colliding, {
      id: "2",
      query_id: "4",
    });
    if (!result.ok) throw result.error;
    expect(result.value.replay).toMatchObject({
      record_ordinal: 902,
      recorded_query: "id=4",
      exact_match: true,
    });
  });
});

describe("replayEnvironmentTool bodies", () => {
  it("reports a response whose body the capture did not retain instead of passing off null as recorded", () => {
    const result = replay(
      "get_users_by_id",
      { id: "2" },
      singleExchangeSource(null, "application/json"),
    );
    expect(result.body).toBeNull();
    expect(result.replay).toMatchObject({
      body_recorded: false,
      truncated: false,
    });
  });

  it("returns text for non-JSON content types and for JSON-like content that does not parse", () => {
    expect(
      replay(
        "get_users_by_id",
        { id: "2" },
        singleExchangeSource("<p>", "text/html"),
      ),
    ).toMatchObject({ body: "<p>", content_type: "text/html" });
    expect(
      replay(
        "get_users_by_id",
        { id: "2" },
        singleExchangeSource("{not json", "application/json; charset=utf-8"),
      ).body,
    ).toBe("{not json");
    expect(
      replay(
        "get_users_by_id",
        { id: "2" },
        singleExchangeSource('{"ok":true}', "application/vnd.api+json"),
      ).body,
    ).toEqual({ ok: true });
    expect(
      replay("get_users_by_id", { id: "2" }, singleExchangeSource(null, null)),
    ).toMatchObject({ body: null, content_type: null });
  });

  it("truncates bodies over 256 KiB at a UTF-8 boundary and flags them", () => {
    const text = "é".repeat(REPLAY_BODY_LIMIT_BYTES);
    const result = replay(
      "get_users_by_id",
      { id: "2" },
      singleExchangeSource(text, "application/json"),
    );
    expect(result.replay.truncated).toBe(true);
    expect(typeof result.body).toBe("string");
    const body = result.body as string;
    expect(Buffer.byteLength(body, "utf8")).toBe(REPLAY_BODY_LIMIT_BYTES);
    expect(body).not.toContain("�");
    const exact = "x".repeat(REPLAY_BODY_LIMIT_BYTES);
    expect(
      replay(
        "get_users_by_id",
        { id: "2" },
        singleExchangeSource(exact, "text/plain"),
      ),
    ).toMatchObject({ body: exact, replay: { truncated: false } });
  });

  it("decodes retained HAR base64 bytes that are UTF-8 and keeps other bytes as base64", async () => {
    const decoded = await base64Source(
      Buffer.from('{"login":"decoded"}', "utf8"),
    );
    expect(replay("get_users_by_id", { id: "2" }, decoded)).toMatchObject({
      body: { login: "decoded" },
      replay: { body_encoding: "utf-8" },
    });
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
    expect(
      replay("get_users_by_id", { id: "2" }, await base64Source(binary)),
    ).toMatchObject({
      body: binary.toString("base64"),
      replay: { body_encoding: "base64", body_recorded: true },
    });
    // A leading byte-order mark is recorded content, not decoding noise.
    expect(
      replay(
        "get_users_by_id",
        { id: "2" },
        await base64Source(Buffer.from([0xef, 0xbb, 0xbf, 0x41])),
      ).body,
    ).toBe("\uFEFFA");
  });

  it("decodes only the replayable prefix of a large retained base64 body and flags it truncated", async () => {
    for (const [fill, encoding] of [
      [0x61, "utf-8"],
      [0xff, "base64"],
    ] as const) {
      const large = Buffer.alloc(REPLAY_BODY_LIMIT_BYTES * 2, fill);
      const result = replay(
        "get_users_by_id",
        { id: "2" },
        await base64Source(large),
      );
      expect(result.replay).toMatchObject({
        truncated: true,
        body_encoding: encoding,
      });
      expect(typeof result.body).toBe("string");
      const body = result.body as string;
      expect(
        encoding === "base64"
          ? Buffer.from(body, "base64").length
          : Buffer.byteLength(body, "utf8"),
      ).toBeLessThanOrEqual(REPLAY_BODY_LIMIT_BYTES);
    }
    // Under the limit in recorded bytes, even though its base64 spelling is longer.
    const small = Buffer.alloc(200 * 1024, 0xff);
    expect(
      replay("get_users_by_id", { id: "2" }, await base64Source(small)),
    ).toMatchObject({
      body: small.toString("base64"),
      replay: { truncated: false, body_encoding: "base64" },
    });
  });
});

describe("replayEnvironmentTool reply metadata", () => {
  it("cuts a long recorded path or query in the reply and flags it, while matching on the full line", () => {
    const users = tool("get_users_by_id");
    const ordinal = users.record_ordinals[0] ?? 0;
    const long: EnvironmentSource = {
      ...source,
      exchanges: new Map([
        [
          ordinal,
          {
            ordinal,
            path: `/api/users/2/${"p".repeat(4000)}`,
            query: `?${"q".repeat(4000)}`,
            status: 200,
            contentType: null,
            bodyText: null,
          },
        ],
      ]),
    };
    const cut = replay("get_users_by_id", { id: "2" }, long).replay;
    expect(cut).toMatchObject({
      exact_match: true,
      recorded_line_truncated: true,
    });
    expect(Buffer.byteLength(cut.recorded_path)).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(cut.recorded_query ?? "")).toBeLessThanOrEqual(
      1024,
    );
    expect(
      replay("get_users_by_id", { id: "2" }).replay.recorded_line_truncated,
    ).toBe(false);
  });
});
