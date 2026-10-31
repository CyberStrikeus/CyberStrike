import { expect, it } from "vitest";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  environmentStateCaptureFixture,
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  SCENARIO_EXCHANGES,
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import type { Evidence } from "../evidence.js";
import type { JsonValue } from "../jsonValue.js";
import { webNetworkCaptureSchema } from "../webNetworkCapture.js";
import {
  analysisViewResultSchema,
  projectAnalysisView,
  type AnalysisViewParent,
  type AnalysisViewResult,
} from "./analysisView.js";
import { EnvironmentStateAccumulator } from "./EnvironmentStateAccumulator.js";
import type { ObservedEntity } from "./environmentStateMerge.js";
import {
  at,
  identityCandidates,
  replaceAt,
  renderStateList,
  type JsonObject,
  type StateRecordFacts,
} from "./environmentStateRules.js";
import { evaluateQuery } from "./environmentStateListQuery.js";
import { singleQueryValues } from "../recordedTransportUrl.js";
import { environmentStateFields } from "./environmentStateView.js";
import {
  lineShapes,
  replayKeys,
  variantLines,
  withoutVariants,
  type LineShape,
} from "./environmentStateVariants.js";
import { rewriteCuts } from "./environmentStateRewrites.js";
import { StateRecordChronology } from "./StateRecordChronology.js";
import { offsetDateTimeInstantFromEpochMilliseconds } from "../offsetDateTime.js";
import { ENTRY_BYTES } from "./webNetworkRouteTemplates.js";

type State = Extract<AnalysisViewResult, { kind: "environment-state" }>;
const ALL_RULES = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
] as const;

const parentOf = (
  evidence: Evidence = analysisViewCaptureEvidence(
    environmentStateCaptureFixture(),
  ),
): AnalysisViewParent => ({
  evidenceId: evidence.evidence_id,
  operation: evidence.operation,
  normalizedResult: evidence.normalized_result,
  subject: evidence.subject,
  limitations: [],
  parameters: evidence.parameters,
});

const stateOf = (parent: AnalysisViewParent = parentOf()): State => {
  const result = projectAnalysisView(parent, {
    kind: "environment-state",
    template_rules: [...ALL_RULES],
  });
  if (!result.ok || result.value.kind !== "environment-state")
    throw new Error("Expected an environment state");
  return result.value;
};

const captureOf = (rows: readonly TimedCaptureRow[]): AnalysisViewParent =>
  parentOf(timedCaptureEvidence(rows));

const viewOf = (state: State, tool: string) =>
  state.views.find((view) => view.tool === tool);

it("extracts the state the Grafana-shaped capture's reads observed", () => {
  const state = stateOf();
  expect(state.timeline).toBe("recorded-start-time");
  expect(state.types).toContainEqual({
    collection_template: "/api/folders",
    id_field: "uid",
    id_basis: "path-parameter",
    init_before_ordinal: 20,
    volatile_fields: [],
  });
  expect(state.types).toContainEqual({
    collection_template: "/api/search",
    id_field: "id",
    id_basis: "field-name",
    init_before_ordinal: null,
    volatile_fields: [],
  });
  expect(
    state.entities.filter((entity) => entity.type === "/api/folders"),
  ).toEqual([
    {
      type: "/api/folders",
      collection: "/api/folders",
      id: "fg1jo91e57e2ob",
      fields: { id: 5, uid: "fg1jo91e57e2ob", title: "probe folder" },
      view_fields: [],
      record_ordinals: [12, 14],
    },
    {
      type: "/api/folders",
      collection: "/api/folders",
      id: "general",
      fields: { id: 0, uid: "general", title: "Dashboards" },
      view_fields: [],
      record_ordinals: [13],
    },
  ]);
  expect(viewOf(state, "get_folders")).toMatchObject({
    shape: "list",
    pointer: "",
    membership: "recorded",
  });
  expect(viewOf(state, "get_folders_by_uid")).toMatchObject({
    shape: "item",
    envelope_ordinal: 12,
    checked_record_ordinals: [12, 13],
  });
  expect(viewOf(state, "get_dashboards_by_uid")).toMatchObject({
    shape: "item",
    pointer: "/dashboard",
  });
  expect(viewOf(state, "get_annotations")).toEqual({
    tool: "get_annotations",
    shape: "recorded",
    reason: "no-init-recording",
  });
  // The one team member listed proves no suffix-named identity, so the list is a document of its path.
  expect(
    state.documents.map((document) => [document.tool, document.path]),
  ).toEqual([
    [
      "get_datasources_health_by_uid",
      "/api/datasources/uid/dg1jo96tern5sb/health",
    ],
    ["get_org", "/api/org"],
    ["get_teams_members_by_id", "/api/teams/1/members"],
    ["get_user", "/api/user"],
  ]);
  expect(viewOf(state, "get_plugins_settings_by_plugin_id")).toEqual({
    tool: "get_plugins_settings_by_plugin_id",
    shape: "recorded",
    reason: "path-varies",
  });
  expect(state.unknowns.map((unknown) => unknown.kind)).toEqual([
    "authorization-model",
    "response-semantics",
    "state-transition",
  ]);
  expect(
    state.limitations.filter((limitation) =>
      limitation.startsWith("Body shapes"),
    ),
  ).toEqual([]);
});

it("keeps collections with repeated path separators distinct", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/books", [{ id: 1, title: "Single separator" }]],
      ["GET", "/api//books", [{ id: 2, title: "Repeated separator" }]],
    ]),
  );
  expect(state.types.map((type) => type.collection_template)).toEqual(
    expect.arrayContaining(["/api/books", "/api//books"]),
  );
});

it("ends a type's state at the first write under its root, not at unrelated writes", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/items/1", { id: 1, title: "Granite Ledger" }],
      ["PUT", "/api/notes/9", { id: 9 }],
      ["GET", "/api/items/1", { id: 1, title: "Granite Ledger" }],
      ["PUT", "/api/items/1", { id: 1, title: "Saltmarsh Depot" }],
      ["GET", "/api/items/1", { id: 1, title: "Saltmarsh Depot" }],
    ]),
  );
  expect(state.types).toEqual([
    {
      collection_template: "/api/items",
      id_field: "id",
      id_basis: "path-parameter",
      init_before_ordinal: 3,
      volatile_fields: [],
    },
  ]);
  expect(state.entities).toMatchObject([
    { id: "1", fields: { title: "Granite Ledger" }, record_ordinals: [0, 2] },
  ]);
  expect(state.views).toContainEqual(
    expect.objectContaining({ shape: "item", checked_record_ordinals: [2] }),
  );
});

it("keeps the latest value of a field that changed with no related write and names it volatile", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/items/1", { id: 1, title: "Lighthouse Rota", seen: 10 }],
      ["GET", "/api/items/1", { id: 1, title: "Lighthouse Rota", seen: 11 }],
      ["GET", "/api/items/2", { id: 2, title: "Blue Heron", seen: 3 }],
    ]),
  );
  expect(state.types[0]).toMatchObject({ volatile_fields: ["seen"] });
  expect(state.entities[0]).toMatchObject({
    id: "1",
    fields: { seen: 11 },
  });
  expect(state.views).toContainEqual(
    expect.objectContaining({
      shape: "item",
      checked_record_ordinals: [1, 2],
    }),
  );
});

it("ends a type's state at a write under another root its value changed across", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/search", [{ id: 1, title: "Granite Ledger" }]],
      ["POST", "/api/dashboards/db", { id: 1, title: "Saltmarsh Depot" }],
      ["GET", "/api/search", [{ id: 1, title: "Saltmarsh Depot" }]],
    ]),
  );
  expect(state.types).toMatchObject([
    { collection_template: "/api/search", init_before_ordinal: 1 },
  ]);
  expect(state.entities).toMatchObject([
    { id: "1", fields: { title: "Granite Ledger" } },
  ]);
  expect(viewOf(state, "get_search")).toMatchObject({ shape: "list" });
});

it("leaves out of a type's state a read made while the write its value changed across was in flight", () => {
  const exchange = ([method, path, seconds, time, title]: readonly [
    string,
    string,
    number,
    number,
    string,
  ]) => ({
    startedDateTime: new Date(
      Date.parse("2026-10-17T18:00:00.000Z") + seconds * 1000,
    ).toISOString(),
    time,
    request: { method, url: `http://app.example${path}` },
    response: {
      status: 200,
      content: {
        mimeType: "application/json",
        text: JSON.stringify([{ id: 1, title }]),
      },
    },
  });
  const state = stateOf(
    parentOf(
      analysisViewCaptureEvidence(
        environmentManifestCaptureFixture([
          exchange([
            "POST",
            "/api/dashboards/db",
            0,
            30_000,
            "Saltmarsh Depot",
          ]),
          exchange(["GET", "/api/search", 10, 5, "Granite Ledger"]),
          exchange(["GET", "/api/search", 40, 5, "Saltmarsh Depot"]),
        ]),
      ),
    ),
  );
  expect(viewOf(state, "get_search")).toEqual({
    tool: "get_search",
    shape: "recorded",
    reason: "no-init-recording",
  });
});

it("does not list the whole collection when a counter exceeds the number listed", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/items",
        { total: 50, items: [{ id: 1, title: "Ada Finch" }] },
      ],
    ]),
  );
  expect(viewOf(state, "get_items")).toMatchObject({
    shape: "list",
    membership: "recorded",
    counters: [],
  });
});

it("lists the whole collection with its counter only when every recording did", () => {
  const rows: TimedCaptureRow[] = [
    [
      "GET",
      "/api/items",
      {
        total: 2,
        items: [
          { id: 1, title: "Ada Finch" },
          { id: 2, title: "Tomas Vey" },
        ],
      },
    ],
    ["GET", "/api/items/1", { title: "Ada Finch", id: 1, notes: "first" }],
    ["GET", "/api/items/2", { id: 2, notes: "second", title: "Tomas Vey" }],
  ];
  const whole = stateOf(captureOf(rows));
  expect(whole.views).toContainEqual(
    expect.objectContaining({
      shape: "list",
      pointer: "/items",
      fields: ["id", "title"],
      membership: "all",
      counters: ["total"],
    }),
  );
  expect(whole.entities.map((entity) => entity.fields)).toEqual([
    { id: 1, title: "Ada Finch", notes: "first" },
    { id: 2, notes: "second", title: "Tomas Vey" },
  ]);
  const filtered = stateOf(
    captureOf([
      ...rows,
      [
        "GET",
        "/api/items?title=Ada",
        { total: 1, items: [{ id: 1, title: "Ada Finch" }] },
      ],
    ]),
  );
  expect(filtered.views).toContainEqual(
    expect.objectContaining({ shape: "list", membership: "recorded" }),
  );
});

it.each([1, "1", "001"])(
  "retains item count representation %j in extracted list plans",
  (total) => {
    const body = { total, items: [{ id: 1, title: "One" }] };
    const state = stateOf(captureOf([["GET", "/api/items", body]]));
    const view = state.views.find((candidate) => candidate.shape === "list");
    if (view?.shape !== "list") throw new Error("Expected an item list view");
    expect(view.counters).toEqual(["total"]);
    expect(renderStateList(view, body, body.items)).toEqual(body);
    const added = renderStateList(view, body, [
      ...body.items,
      { id: 2, title: "Two" },
    ]);
    expect(added).toMatchObject({
      total: typeof total === "string" ? "2".padStart(total.length, "0") : 2,
    });
  },
);

it("leaves recorded the views it cannot reproduce, with the reason", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/boards/1",
        { meta: { viewer: "Ada Finch" }, board: { id: 1, name: "Rota" } },
      ],
      [
        "GET",
        "/api/boards/2",
        { meta: { viewer: "Mina Okafor" }, board: { id: 2, name: "Depot" } },
      ],
      ["GET", "/api/ledgers/1", '{"id":1,"total":12345678901234567890}'],
      ["POST", "/api/boards/search", [{ id: 1, name: "Rota" }]],
    ]),
  );
  expect(
    state.views.map((view) =>
      view.shape === "recorded" ? [view.tool, view.reason] : view.tool,
    ),
  ).toEqual([
    ["post_boards_search", "query-body"],
    ["get_boards_by_id", "envelope-varies"],
    ["get_ledgers_by_id", "body-unusable"],
  ]);
  expect(state.types).toEqual([]);
  expect(state.entities).toEqual([]);
});

it("leaves a body too deep for the state's own nesting recorded instead of failing to seal", () => {
  let deep: JsonValue = { theme: "dark" };
  for (let level = 0; level < 995; level += 1) deep = { nested: deep };
  const state = stateOf(
    captureOf([
      ["GET", "/api/settings", deep],
      ["PUT", "/api/settings", { theme: "light" }],
    ]),
  );
  expect(state.documents).toEqual([]);
  expect(viewOf(state, "get_settings")).toEqual({
    tool: "get_settings",
    shape: "recorded",
    reason: "body-unusable",
  });
});

it("holds a written path's non-entity read as a document", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/settings", { theme: "dark", density: "compact" }],
      ["PUT", "/api/settings", { theme: "light", density: "compact" }],
      ["GET", "/api/settings", { theme: "light", density: "compact" }],
    ]),
  );
  expect(state.documents).toEqual([
    {
      tool: "get_settings",
      path: "/api/settings",
      value: { theme: "dark", density: "compact" },
      record_ordinal: 0,
    },
  ]);
  expect(viewOf(state, "get_settings")).toEqual({
    tool: "get_settings",
    shape: "document",
    checked_record_ordinals: [0],
  });
});

it("holds a read-only non-entity read as a document unless it varies by request line", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/config", { theme: "dark", locale: "en-GB" }],
      [
        "GET",
        "/api/rates",
        [
          { currency: "EUR", rate: 1.1 },
          { currency: "EUR", rate: 1.2 },
        ],
      ],
      ["GET", "/api/stats?range=day", { visits: 3 }],
      ["GET", "/api/stats?range=week", { visits: 9 }],
    ]),
  );
  expect(state.documents).toEqual([
    {
      tool: "get_config",
      path: "/api/config",
      value: { theme: "dark", locale: "en-GB" },
      record_ordinal: 0,
    },
    {
      tool: "get_rates",
      path: "/api/rates",
      value: [
        { currency: "EUR", rate: 1.1 },
        { currency: "EUR", rate: 1.2 },
      ],
      record_ordinal: 1,
    },
  ]);
  expect(viewOf(state, "get_stats")).toEqual({
    tool: "get_stats",
    shape: "recorded",
    reason: "query-varies",
  });
  expect(state.types).toEqual([]);
});

it("leaves a document recorded when rendering it exceeds the body limit", () => {
  const small = stateOf(
    captureOf([["GET", "/api/config", '{"values":[1e3]}']]),
  );
  expect(viewOf(small, "get_config")).toMatchObject({ shape: "document" });
  expect(small.documents[0]?.value).toEqual({ values: [1000] });
  // 60,000 `1e3` tokens are 240,012 recorded bytes and 300,012 once rendered as `1000`.
  const values = Array.from({ length: 60_000 }, () => "1e3").join(",");
  const body = `{"values":[${values}]}`;
  expect(Buffer.byteLength(body, "utf8")).toBe(240_012);
  const state = stateOf(captureOf([["GET", "/api/config", body]]));
  expect(state.documents).toEqual([]);
  expect(viewOf(state, "get_config")).toEqual({
    tool: "get_config",
    shape: "recorded",
    reason: "rendered-oversize",
  });
});

it("infers a suffix-named identity only when no identity name identifies the listed items", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/memberships",
        [
          { orgId: 7, userId: 1, role: "Admin" },
          { orgId: 8, userId: 1, role: "Viewer" },
        ],
      ],
      [
        "GET",
        "/api/seats",
        {
          total: 2,
          seats: [
            { parentId: 1, seat_id: "s-1" },
            { parentId: 1, seat_id: "s-2" },
          ],
        },
      ],
      [
        "GET",
        "/api/projects",
        [
          { projectId: "a", id: 2 },
          { projectId: "b", id: 3 },
        ],
      ],
      [
        "GET",
        "/api/grants",
        [
          { userId: 1, orgId: 7 },
          { userId: 2, orgId: 8 },
        ],
      ],
      ["GET", "/api/members", []],
      ["GET", "/api/members", [{ memberId: "m-1" }, { memberId: "m-2" }]],
      ["GET", "/api/comments", [{ postId: 9, authorId: 3, text: "hi" }]],
    ]),
  );
  expect(
    state.types.map(({ collection_template, id_field, id_basis }) => [
      collection_template,
      id_field,
      id_basis,
    ]),
  ).toEqual([
    // Both identify the grants; the earlier key in item order wins.
    ["/api/grants", "userId", "field-name"],
    // The empty first recording constrains no field.
    ["/api/members", "memberId", "field-name"],
    ["/api/memberships", "orgId", "field-name"],
    ["/api/projects", "id", "field-name"],
    ["/api/seats", "seat_id", "field-name"],
  ]);
  expect(viewOf(state, "get_seats")).toMatchObject({
    shape: "list",
    pointer: "/seats",
    membership: "all",
    counters: ["total"],
  });
  expect(viewOf(state, "get_members")).toMatchObject({ shape: "list" });
  expect(
    state.entities
      .filter((entity) => entity.type === "/api/memberships")
      .map((entity) => entity.id),
  ).toEqual(["7", "8"]);
  // One listed item shows no field distinct, so its foreign keys identify nothing.
  expect(viewOf(state, "get_comments")).toMatchObject({ shape: "document" });
});

it("chooses an envelope's array by identity name, then by a suffix-named field", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/board",
        {
          labels: [{ text: "urgent" }, { text: "later" }],
          cards: [
            { cardId: 1, text: "Granite Ledger" },
            { cardId: 2, text: "Blue Heron" },
          ],
        },
      ],
      [
        "GET",
        "/api/directory",
        {
          owners: [{ orgId: 1 }, { orgId: 2 }],
          teams: [
            { id: 1, orgId: 1 },
            { id: 2, orgId: 1 },
          ],
        },
      ],
    ]),
  );
  expect(
    state.types.map(({ collection_template, id_field }) => [
      collection_template,
      id_field,
    ]),
  ).toEqual([
    ["/api/board", "cardId"],
    ["/api/directory", "id"],
  ]);
  expect(viewOf(state, "get_board")).toMatchObject({
    shape: "list",
    pointer: "/cards",
  });
  expect(viewOf(state, "get_directory")).toMatchObject({
    shape: "list",
    pointer: "/teams",
  });
});

it("locates an item entity wrapped in a one-element array and merges it with the list view", () => {
  const first = "6ad47b5c1023b500010873e3";
  const second = "6ad47b5c1023b500010873e4";
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/ghost/api/admin/posts/",
        {
          posts: [
            { id: first, title: "Granite Ledger", status: "draft" },
            { id: second, title: "Blue Heron", status: "published" },
          ],
          meta: { pagination: { page: 1, pages: 1 } },
        },
      ],
      [
        "GET",
        `/ghost/api/admin/posts/${first}/`,
        {
          posts: [
            {
              id: first,
              title: "Granite Ledger",
              status: "draft",
              html: "<p>Quarry count</p>",
            },
          ],
        },
      ],
      ["GET", "/api/depots/5", [{ id: 5, name: "Saltmarsh Depot" }]],
      ["GET", "/api/rosters/9", [{ id: 31, roster: 9, name: "Ada Finch" }]],
    ]),
  );
  expect(viewOf(state, "get_rosters_by_id")).toEqual({
    tool: "get_rosters_by_id",
    shape: "recorded",
    reason: "no-identity",
  });
  const posts = "/ghost/api/admin/posts";
  expect(state.types).toContainEqual({
    collection_template: posts,
    id_field: "id",
    id_basis: "path-parameter",
    init_before_ordinal: null,
    volatile_fields: [],
  });
  expect(state.views).toContainEqual(
    expect.objectContaining({
      shape: "item",
      type: posts,
      pointer: "/posts/0",
      fields: ["id", "title", "status", "html"],
      checked_record_ordinals: [1],
    }),
  );
  expect(state.views).toContainEqual(
    expect.objectContaining({
      shape: "list",
      type: posts,
      pointer: "/posts",
      membership: "all",
    }),
  );
  expect(state.views).toContainEqual(
    expect.objectContaining({
      shape: "item",
      type: "/api/depots",
      pointer: "/0",
    }),
  );
  expect(state.entities.filter((entity) => entity.type === posts)).toEqual([
    {
      type: posts,
      collection: posts,
      id: first,
      fields: {
        id: first,
        title: "Granite Ledger",
        status: "draft",
        html: "<p>Quarry count</p>",
      },
      view_fields: [],
      record_ordinals: [0, 1],
    },
    expect.objectContaining({ id: second, record_ordinals: [0] }),
  ]);
});

it("reads and replaces only the root, one member or the element of a one-element array", () => {
  const body = { posts: [{ id: 1 }], meta: { posts: 1 } };
  expect(at(body, "/posts/0")).toEqual({ id: 1 });
  expect(replaceAt(body, "/posts/0", null)).toEqual({
    posts: [null],
    meta: { posts: 1 },
  });
  expect(at([{ id: 1 }], "/0")).toEqual({ id: 1 });
  expect(replaceAt([{ id: 1 }], "/0", { id: 2 })).toEqual([{ id: 2 }]);
  for (const pointer of ["/posts/1", "/meta/posts", "/posts/0/id"])
    expect(at(body, pointer)).toBeUndefined();
  expect(at({ posts: [{ id: 1 }, { id: 2 }] }, "/posts/0")).toBeUndefined();
  expect(replaceAt(body, "/meta/posts", null)).toBe(body);
});

it("leaves an item path's non-entity read recorded", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/files/123", { text: "initial document" }],
      ["PUT", "/api/files/123", null],
    ]),
  );
  expect(state.documents).toEqual([]);
  expect(viewOf(state, "get_files_by_id")).toMatchObject({ shape: "recorded" });
});

it("holds a deleted path's initial non-entity read as a document", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/settings", { text: "initial document" }],
      ["DELETE", "/api/settings", null],
    ]),
  );
  expect(state.documents).toEqual([
    {
      tool: "get_settings",
      path: "/api/settings",
      value: { text: "initial document" },
      record_ordinal: 0,
    },
  ]);
});

it("orders a scenario capture by request order and needs its response bodies", () => {
  const state = stateOf(parentOf(scenarioCaptureEvidence()));
  expect(state.timeline).toBe("record-order");
  expect(state.types).toEqual([
    {
      collection_template: "/api/users",
      id_field: "id",
      id_basis: "path-parameter",
      init_before_ordinal: null,
      volatile_fields: [],
    },
  ]);
  expect(state.entities.map((entity) => entity.fields)).toEqual([
    { id: 2, login: "probe" },
    { id: 3, login: "viewer" },
  ]);
  const headersOnly = scenarioCaptureEvidence(
    scenarioCaptureFixture(SCENARIO_EXCHANGES, {
      request_body: true,
      response_body: false,
      header_values: true,
    }),
  );
  expect(
    projectAnalysisView(parentOf(headersOnly), {
      kind: "environment-state",
      template_rules: [],
    }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisUnsupportedTargetError",
      message: expect.stringContaining("response_body selected"),
    },
  });
});

it("refuses when extraction would exceed the projection budget", () => {
  expect(
    projectAnalysisView(
      parentOf(),
      { kind: "environment-state", template_rules: [...ALL_RULES] },
      { state: new EnvironmentStateAccumulator(160 * 1024, [...ALL_RULES]) },
    ),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      resource: "memory",
      message: expect.stringContaining("Environment-state"),
    },
  });
});

it("counts the line shapes it builds against the budget as it builds them", () => {
  const members = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `member_with_a_long_name_${String(index)}`,
      index,
    ]),
  );
  const entities: ObservedEntity[] = Array.from({ length: 50 }, (_, id) => ({
    type: "/api/items",
    collection: "/api/items",
    id: String(id),
    order: [0, id],
    observations: [1, 2].map((ordinal) => ({
      position: ordinal,
      index: id,
      ordinal,
      tool: "get_items",
      item: false,
      object: members,
    })),
  }));
  let retained = 0;
  lineShapes(entities, (bytes) => {
    retained += bytes;
  });
  // Each of the hundred observations keeps its entity's key and the names of its members.
  expect(retained).toBeGreaterThan(100 * Object.keys(members).join(",").length);
});

it("leaves every line checked rather than compare more lines than the variant pass allows", () => {
  const lines = Array.from({ length: 3000 }, (_, ordinal) => ({
    ordinal,
    method: "GET",
    path: "/api/items",
    query: `?view=${String(ordinal)}`,
    status: 200,
    timing: { start: undefined, endMs: undefined },
  }));
  const shape = {
    entities: new Map(
      Array.from({ length: 4 }, (_, id) => [String(id), "id,name"]),
    ),
    carried: new Set(["id", "name"]),
    common: new Set(["id", "name"]),
  };
  let looked = 0;
  expect(
    variantLines(lines, () => {
      looked += 1;
      return shape;
    }),
  ).toEqual([]);
  // Comparing every pair would look each line's shape up thousands of times.
  expect(looked).toBeLessThan(10 * lines.length);
});

it("tells apart member names that hold the separator, so a line spelling them otherwise is a variant", () => {
  const line = (ordinal: number, query: string) => ({
    ordinal,
    method: "GET",
    path: "/api/items/1",
    query,
    status: 200,
    timing: { start: undefined, endMs: undefined },
  });
  const observed = (ordinal: number, object: JsonObject) => ({
    position: ordinal,
    index: 0,
    ordinal,
    tool: "get_items_by_id",
    item: true,
    object,
  });
  const shapes = lineShapes(
    [
      {
        type: "/api/items",
        collection: "/api/items",
        id: "1",
        order: [1, 0],
        observations: [
          observed(1, { id: 1, a: 1, b: 2 }),
          observed(2, { id: 1, "a,b": 3 }),
        ],
      },
    ],
    () => undefined,
  );
  expect(
    variantLines([line(1, "?view=x"), line(2, "?view=y")], (record) =>
      shapes.get(record.ordinal),
    ),
  ).toHaveLength(1);
});

it("leaves every line checked when comparing many mostly empty lines would exceed the variant pass's work", () => {
  let reads = 0;
  const lines = Array.from({ length: 4200 }, (_, ordinal) => {
    const record = {
      ordinal,
      method: "GET",
      path: "/api/items",
      status: 200,
      timing: { start: undefined, endMs: undefined },
    };
    return Object.defineProperty(record, "query", {
      enumerable: true,
      get: () => {
        reads += 1;
        return `?page=${String(ordinal)}`;
      },
    }) as typeof record & { readonly query: string };
  });
  const empty = {
    entities: new Map(),
    carried: new Set<string>(),
    common: undefined,
  };
  const shown = {
    entities: new Map([
      ["1", "id"],
      ["2", "id"],
    ]),
    carried: new Set(["id"]),
    common: new Set(["id"]),
  };
  expect(
    variantLines(lines, (record) => (record.ordinal === 0 ? shown : empty)),
  ).toEqual([]);
  // Comparing every pair would read each line's query thousands of times.
  expect(reads).toBeLessThan(10 * lines.length);
});

/** Item lines reading each of `items` items plainly, then each again with `?expand=shelf`; each shape's entities count the walks over them. */
const expandedItemLines = (items: number) => {
  let walks = 0;
  const lines: StateRecordFacts[] = Array.from(
    { length: items * 2 },
    (_, ordinal) => ({
      ordinal,
      method: "GET",
      path: `/api/items/${String(ordinal % items)}`,
      query: ordinal < items ? undefined : "?expand=shelf",
      status: 200,
      timing: { start: undefined, endMs: undefined },
    }),
  );
  const shapes = new Map(
    lines.map((line): [StateRecordFacts, LineShape] => {
      const members =
        line.query === undefined ? ["id", "name"] : ["id", "name", "shelf"];
      const entities = new Map([
        [
          JSON.stringify([
            "/api/items",
            "/api/items",
            String(line.ordinal % items),
          ]),
          JSON.stringify(members),
        ],
      ]);
      const walk = entities[Symbol.iterator].bind(entities);
      entities[Symbol.iterator] = () => {
        walks += 1;
        return walk();
      };
      const carried = new Set(members);
      return [line, { entities, carried, common: carried }];
    }),
  );
  return {
    lines,
    shapeOf: (record: StateRecordFacts) => shapes.get(record),
    walks: () => walks,
  };
};

it("compares lines through the entities they show, so items read plainly and expanded are not compared pair by pair", () => {
  const { lines, shapeOf, walks } = expandedItemLines(1000);
  expect(variantLines(lines, shapeOf)).toEqual(lines.slice(1000));
  // Comparing every pair would walk each line's entities thousands of times.
  expect(walks()).toBeLessThan(10 * lines.length);
});

it("reads each base line's query a fixed number of times however many variants it keys", () => {
  const items = 200;
  const { lines, shapeOf } = expandedItemLines(items);
  let reads = 0;
  for (const line of lines.slice(0, items)) {
    const { query } = line;
    Object.defineProperty(line, "query", {
      enumerable: true,
      get: () => ((reads += 1), query),
    });
  }
  const tool = {
    name: "get_items_by_id",
    method: "GET",
    path_template: "/api/items/{id}",
    record_ordinals: lines.map((line) => line.ordinal),
  };
  const plan = {
    tool,
    item: true,
    type: "/api/items",
    pointer: "",
    recordings: lines,
    latest: lines,
  };
  const split = withoutVariants(plan, {
    shapeOf,
    queryOf: (ordinal) => lines[ordinal]?.query,
    position: (ordinal) => ordinal,
    retain: () => undefined,
    checkpoint: () => () => undefined,
  });
  expect(split?.plan.projected).toHaveLength(items);
  // Keying each variant against the base lines anew reads every base line's query once per variant.
  expect(reads).toBeLessThan(10 * items);
});

it("counts what it holds to compare lines by the entities they show against the budget", () => {
  const { lines, shapeOf } = expandedItemLines(100);
  let retained = 0;
  variantLines(lines, shapeOf, (bytes) => {
    retained += bytes;
  });
  // An entry for each entity each line shows.
  expect(retained).toBeGreaterThanOrEqual(lines.length * ENTRY_BYTES);
});

/** The smallest allowance, to a KiB, a capture's state projects within. */
const allowance = (parent: AnalysisViewParent): number => {
  const fits = (bytes: number): boolean =>
    projectAnalysisView(
      parent,
      { kind: "environment-state", template_rules: [...ALL_RULES] },
      { state: new EnvironmentStateAccumulator(bytes, [...ALL_RULES]) },
    ).ok;
  let [low, high] = [0, 8 * 1024];
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle * 1024)) high = middle;
    else low = middle;
  }
  return high * 1024;
};

it("counts the member names of later item lines against the budget before keeping them", () => {
  const reads = 20;
  // Each later read of an item names members its initial reads never did, `width` characters long.
  const capture = (width: number) =>
    captureOf([
      ["GET", "/api/items/1", { id: 1, name: "One" }],
      ["POST", "/api/items", { id: 2, name: "Two" }, 201, { name: "Two" }],
      ...Array.from({ length: reads }, (_, read): TimedCaptureRow => [
        "GET",
        `/api/items/1?expand=meta&view=${String(read)}`,
        {
          id: 1,
          name: "One",
          ...Object.fromEntries(
            Array.from({ length: 5 }, (_, member) => [
              `${String(read)}_${String(member)}_`.padEnd(width, "m"),
              1,
            ]),
          ),
        },
      ]),
    ]);
  expect(
    allowance(capture(400)) - allowance(capture(10)),
  ).toBeGreaterThanOrEqual((reads * 5 * 390 * 14) / 2);
});

it("counts each change of a line's membership across a write against the budget", () => {
  const tags = 64;
  // Each tag's list is read three times across two writes; the third read shows the first book again or keeps the second.
  const capture = (third: number) =>
    captureOf([
      ...Array.from({ length: tags }, (_, tag): TimedCaptureRow => [
        "GET",
        `/api/books?tag=${String(tag)}`,
        [{ id: 1 }],
      ]),
      ["POST", "/api/view-log", { ok: true }, 200, { tag: 0 }],
      ...Array.from({ length: tags }, (_, tag): TimedCaptureRow => [
        "GET",
        `/api/books?tag=${String(tag)}`,
        [{ id: 2 }],
      ]),
      ["POST", "/api/view-log", { ok: true }, 200, { tag: 1 }],
      ...Array.from({ length: tags }, (_, tag): TimedCaptureRow => [
        "GET",
        `/api/books?tag=${String(tag)}`,
        [{ id: third }],
      ]),
    ]);
  // Both captures keep the same entities and observations; only the second change of each line differs.
  expect(allowance(capture(1)) - allowance(capture(2))).toBeGreaterThanOrEqual(
    tags * 256,
  );
});

it("counts each replay key it keeps against the budget", () => {
  let retained = 0;
  const names = Array.from(
    { length: 500 },
    (_, index) => `view_${String(index)}`,
  );
  const keys = replayKeys(
    ["?view=plain"],
    [`?${names.map((name) => `${name}=1`).join("&")}`],
    (bytes) => {
      retained += bytes;
    },
  );
  expect(keys.length).toBeGreaterThan(names.length);
  expect(retained).toBeGreaterThanOrEqual(keys.length * 128);
});

it("finds each span's earliest write without scanning the writes before it", () => {
  let reads = 0;
  const timed = (ordinal: number, start: number, end: number) => {
    const record = {
      ordinal,
      method: "POST",
      path: "/api/log",
      query: undefined,
      status: 200,
      timing: {
        start: {
          instant: offsetDateTimeInstantFromEpochMilliseconds(start),
          get ms() {
            reads += 1;
            return start;
          },
        },
        get endMs() {
          reads += 1;
          return end;
        },
      },
    };
    return record;
  };
  const count = 2000;
  const writes = Array.from({ length: count }, (_, index) =>
    timed(index, index * 10, index * 10 + 1),
  );
  const reads_ = new Map(
    Array.from({ length: count }, (_, index) => {
      const ordinal = count + index;
      return [
        ordinal,
        timed(ordinal, index * 10 + 5, index * 10 + 12),
      ] as const;
    }),
  );
  const spans = [...reads_.keys()].map((earlier, index) => ({
    type: `/api/type_${String(index)}`,
    earlier,
    later: earlier,
  }));
  reads = 0;
  const chronology = new StateRecordChronology(
    [...writes, ...reads_.values()],
    "recorded-start-time",
  );
  const cuts = rewriteCuts(spans, writes, reads_, chronology);
  expect(cuts.size).toBe(count - 1);
  expect(reads).toBeLessThan(200 * count);
});

it("releases a planning pass a rewrite cut discards before extracting the state again", () => {
  const recipe = (id: number, views: number) => ({
    id,
    name: `Recipe ${String(id)} simmered slowly with a long descriptive title`,
    views,
  });
  const shelf = Array.from({ length: 400 }, (_, index) => recipe(index + 1, 1));
  // Logging a view bumps the counter only when `views` changes, which cuts the type's reads at the log.
  const capture = (views: number) =>
    captureOf([
      ["GET", "/api/recipes", shelf],
      ["GET", "/api/recipes/1", recipe(1, 1)],
      ["POST", "/api/view-log", { ok: true }, 200, { recipe: 1 }],
      ["GET", "/api/recipes/1", recipe(1, views)],
    ]);
  expect(stateOf(capture(2)).types).toMatchObject([
    { collection_template: "/api/recipes", init_before_ordinal: 2 },
  ]);
  expect(allowance(capture(2))).toBeLessThan(allowance(capture(1)) + 16 * 1024);
});

it("ends every type's state at a write whose URL was redacted, and says so", () => {
  const parent = captureOf([
    ["GET", "/api/items/1", { id: 1, title: "Granite Ledger" }],
    ["PUT", "/api/items/1", { id: 1 }],
    ["GET", "/api/items/1", { id: 1, title: "Saltmarsh Depot" }],
  ]);
  const result = structuredClone(parent.normalizedResult) as {
    records: { reported: { request: { url: string | null } } }[];
  };
  // A scenario keeps a redacted URL as null, so the write's target is unknown.
  result.records[1]!.reported.request.url = null;
  const state = stateOf({ ...parent, normalizedResult: result });
  expect(state.types).toMatchObject([{ init_before_ordinal: 1 }]);
  expect(state.entities).toMatchObject([
    { fields: { title: "Granite Ledger" }, record_ordinals: [0] },
  ]);
  expect(state.limitations).toContain(
    "1 of the recorded writes had a redacted URL; each ends the initial state of every type, since its target is unknown.",
  );
});

it("infers no identity for a list whose recordings held no items and holds it as a document", () => {
  const state = stateOf(captureOf([["GET", "/api/widgets", []]]));
  expect(state.types).toEqual([]);
  expect(state.views).toEqual([
    { tool: "get_widgets", shape: "document", checked_record_ordinals: [0] },
  ]);
});

it("does not call a value volatile when it differs between request lines", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/items/1?lang=fr", { id: 1, name: "Bonjour" }],
      ["GET", "/api/items/1", { id: 1, name: "Hello" }],
    ]),
  );
  expect(state.types).toEqual([]);
  expect(
    state.views.map((view) =>
      view.shape === "recorded" ? [view.tool, view.reason] : view.tool,
    ),
  ).toEqual([["get_items_by_id", "fields-differ"]]);
});

it("orders entities by their earliest sighting, so a complete list keeps all membership", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/items",
        [
          { id: 1, title: "Granite Ledger" },
          { id: 2, title: "Blue Heron" },
        ],
      ],
      ["GET", "/api/items/2", { id: 2, title: "Blue Heron" }],
      ["GET", "/api/items/1", { id: 1, title: "Granite Ledger" }],
    ]),
  );
  expect(state.entities.map((entity) => entity.id)).toEqual(["1", "2"]);
  expect(state.views).toContainEqual(
    expect.objectContaining({ tool: "get_items", membership: "all" }),
  );
});

it("does not take a later recording that is itself an entity as the list", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/items", { items: [{ id: 1, title: "Granite Ledger" }] }],
      [
        "GET",
        "/api/items",
        { id: 99, items: [{ id: 2, title: "Blue Heron" }] },
      ],
    ]),
  );
  // Without one list across its recordings, the read is held as a document, not entities.
  expect(state.views).toContainEqual(
    expect.objectContaining({ tool: "get_items", shape: "document" }),
  );
  expect(state.entities).toEqual([]);
});

it("ends a type's state at a write two of its tools read different values across", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/search", [{ id: 1, title: "Granite Ledger" }]],
      ["POST", "/api/dashboards/db", { id: 9 }],
      ["GET", "/api/search/1", { id: 1, title: "Saltmarsh Depot" }],
    ]),
  );
  expect(state.types).toMatchObject([
    { collection_template: "/api/search", init_before_ordinal: 1 },
  ]);
  expect(state.entities).toMatchObject([
    { id: "1", fields: { title: "Granite Ledger" } },
  ]);
  expect(
    state.views.map((view) =>
      view.shape === "recorded" ? [view.tool, view.reason] : view.tool,
    ),
  ).toEqual(["get_search", ["get_search_by_id", "no-init-recording"]]);
});

it.each(["old", "new"])(
  "retains field observations through sparse reads across a write (%s)",
  (title) => {
    const state = stateOf(
      captureOf([
        ["GET", "/api/search", [{ id: 1, title: "old" }]],
        ["POST", "/api/items", { id: 2 }],
        ["GET", "/api/search?fields=id", [{ id: 1 }]],
        ["GET", "/api/search/1", { id: 1, title }],
      ]),
    );
    if (title === "new") {
      expect(state.types).toMatchObject([{ init_before_ordinal: 1 }]);
      expect(state.entities[0]?.fields.title).toBe("old");
      expect(viewOf(state, "get_search")).toMatchObject({ shape: "list" });
    } else {
      expect(viewOf(state, "get_search_by_id")).toMatchObject({
        shape: "item",
      });
      expect(state.entities[0]?.fields.title).toBe("old");
    }
  },
);

it("proves the identity field against every item response", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/widgets/1", { left: 1, right: 1 }],
      ["GET", "/api/widgets/2", { right: 2, left: "other" }],
    ]),
  );
  expect(state.types).toMatchObject([
    { id_field: "right", id_basis: "path-parameter" },
  ]);
  expect(state.entities.map((entity) => entity.id)).toEqual(["1", "2"]);
});

it.each(["/api", "/api/items/1/update"])(
  "bounds a type by a write at a related root (%s)",
  (path) => {
    const state = stateOf(
      captureOf([
        ["GET", "/api/items/1", { id: 1, title: "initial" }],
        ["POST", path, {}],
        ["GET", "/api/items/1", { id: 1, title: "after" }],
      ]),
    );
    expect(state.types).toMatchObject([{ init_before_ordinal: 1 }]);
    expect(state.entities).toMatchObject([{ fields: { title: "initial" } }]);
  },
);

it("chooses the earliest related write in timeline order, across ancestor and descendant roots", () => {
  const parent = captureOf([
    ["GET", "/api/items/1", { id: 1, title: "initial" }],
    ["POST", "/api/items/1/update", {}],
    ["POST", "/api", {}],
    ["GET", "/api/items/1", { id: 1, title: "after" }],
  ]);
  const data = structuredClone(parent.normalizedResult) as {
    records: { reported: { startedDateTime: string } }[];
  };
  const first = data.records[1]!.reported.startedDateTime;
  data.records[1]!.reported.startedDateTime =
    data.records[2]!.reported.startedDateTime;
  data.records[2]!.reported.startedDateTime = first;
  const state = stateOf({ ...parent, normalizedResult: data });
  expect(state.types).toMatchObject([{ init_before_ordinal: 2 }]);
  expect(state.entities).toMatchObject([{ fields: { title: "initial" } }]);
});

it.each<{
  spelling: string;
  starts: readonly [string, string, string];
}>([
  {
    spelling: "minute-only offset timestamps",
    starts: ["2026-10-20T09:00Z", "2026-10-20T09:02Z", "2026-10-20T09:01Z"],
  },
  {
    spelling: "ten-digit fractional timestamps",
    starts: [
      "2026-10-20T09:00:00.0000000001Z",
      "2026-10-20T09:00:00.0000000003Z",
      "2026-10-20T09:00:00.0000000002Z",
    ],
  },
])(
  "keeps the pre-write document when $spelling put the write before an earlier ordinal",
  ({ starts }) => {
    const entries = starts.map((startedDateTime, ordinal) => ({
      startedDateTime,
      // Zero-duration requests isolate start ordering from interval precision.
      time: 0,
      request: {
        method: ordinal === 2 ? "PATCH" : "GET",
        url: "http://app.example/api/settings",
        ...(ordinal === 2
          ? {
              postData: {
                mimeType: "application/json",
                text: '{"theme":"dark"}',
              },
            }
          : {}),
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: ordinal === 0 ? '{"theme":"light"}' : '{"theme":"dark"}',
        },
      },
    }));
    const capture = webNetworkCaptureSchema.parse(
      environmentManifestCaptureFixture(entries),
    );
    expect(capture.records.map((record) => record.reported)).toEqual(entries);
    const state = stateOf(parentOf(analysisViewCaptureEvidence(capture)));
    expect(state.documents).toEqual([
      {
        tool: "get_settings",
        path: "/api/settings",
        value: { theme: "light" },
        record_ordinal: 0,
      },
    ]);
    expect(state.timeline).toBe("recorded-start-time");
  },
);

it.each([
  { duration: undefined, redactedWrite: false },
  { duration: null, redactedWrite: false },
  { duration: -1, redactedWrite: false },
  { duration: "0", redactedWrite: false },
  { duration: undefined, redactedWrite: true },
  { duration: null, redactedWrite: true },
])(
  "retains chronological initial state with duration $duration and redacted write $redactedWrite",
  ({ duration, redactedWrite }) => {
    const entry = (
      method: string,
      path: string | null,
      second: string,
      body: JsonValue,
    ) => ({
      startedDateTime: `2026-10-20T09:00:${second}Z`,
      time: 0,
      request: {
        method,
        url: path === null ? null : `http://app.example${path}`,
      },
      response: {
        status: 200,
        content: { mimeType: "application/json", text: JSON.stringify(body) },
      },
    });
    const { time: _duration, ...laterRead } = entry(
      "GET",
      "/api/settings",
      "02",
      { theme: "dark" },
    );
    const entries = [
      entry("GET", "/api/settings", "00", { theme: "light" }),
      { ...laterRead, ...(duration === undefined ? {} : { time: duration }) },
      entry("PATCH", redactedWrite ? null : "/api/settings", "01", {
        theme: "dark",
      }),
      entry("GET", "/api/health", "00.1", { healthy: true }),
      entry("GET", "/api/version", "00.2", { version: "1" }),
    ];
    const capture = webNetworkCaptureSchema.parse(
      environmentManifestCaptureFixture(entries),
    );
    const before = structuredClone(capture);
    const state = stateOf(parentOf(analysisViewCaptureEvidence(capture)));
    expect(state.timeline).toBe("recorded-start-time");
    expect(state.limitations).toContain(
      "Some records carry no usable request duration; their completion and overlap remain unknown.",
    );
    expect(state.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/settings",
          value: { theme: "light" },
          record_ordinal: 0,
        }),
        expect.objectContaining({
          path: "/api/health",
          value: { healthy: true },
          record_ordinal: 3,
        }),
        expect.objectContaining({
          path: "/api/version",
          value: { version: "1" },
          record_ordinal: 4,
        }),
      ]),
    );
    expect(capture).toEqual(before);
    if (redactedWrite)
      expect(state.limitations).toContain(
        "1 of the recorded writes had a redacted URL; each ends the initial state of every type, since its target is unknown.",
      );
  },
);

it("does not confirm completion of an untimed delete while preserving unrelated known reads", () => {
  const source = captureOf([
    ["GET", "/api/items", [{ id: 1 }, { id: 2 }]],
    ["GET", "/api/items/2", { id: 2 }],
    ["GET", "/api/health", { healthy: true }],
    ["GET", "/api/version", { version: "1" }],
    ["DELETE", "/api/items/2", "", 204],
    ["GET", "/api/items/2", null, 404],
  ]);
  const known = stateOf(source);
  expect(known.writes).toContainEqual(
    expect.objectContaining({ tool: "delete_items_by_id", served: true }),
  );
  const result = structuredClone(source.normalizedResult) as {
    records: { reported: { time?: JsonValue } }[];
  };
  delete result.records[4]!.reported.time;
  const before = structuredClone(result);
  const state = stateOf({ ...source, normalizedResult: result });
  expect(state.timeline).toBe("recorded-start-time");
  expect(state.limitations).toContain(
    "Some records carry no usable request duration; their completion and overlap remain unknown.",
  );
  expect(state.writes).toContainEqual(
    expect.objectContaining({ tool: "delete_items_by_id", served: false }),
  );
  expect(state.documents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/api/health",
        value: { healthy: true },
      }),
      expect.objectContaining({
        path: "/api/version",
        value: { version: "1" },
      }),
    ]),
  );
  expect(result).toEqual(before);
});

it("bounds a parameterized namespace by concrete writes before publishing new items", () => {
  const result = projectAnalysisView(
    captureOf([
      ["GET", "/api/v1/repos/alice/alpha/issues/1", { id: 1 }],
      ["GET", "/api/v1/repos/bob/beta/issues/2", { id: 2 }],
      ["GET", "/api/v1/repos/carol/gamma/issues/3", { id: 3 }],
      ["POST", "/api/v1/repos/dana/delta/issues", { id: 4 }],
      ["GET", "/api/v1/repos/dana/delta/issues/4", { id: 4 }],
    ]),
    {
      kind: "environment-state",
      template_rules: [...ALL_RULES, "sibling-pair-variance"],
    },
  );
  if (!result.ok || result.value.kind !== "environment-state")
    throw new Error("Expected state");
  expect(result.value.entities.map((entity) => entity.id)).toEqual([
    "1",
    "2",
    "3",
  ]);
  expect(result.value.types).toMatchObject([{ init_before_ordinal: 3 }]);
});

it.each(["totalcount", "itemcount"])(
  "recognizes a compact compound item total (%s)",
  (name) => {
    const state = stateOf(
      captureOf([["GET", "/api/items", { [name]: 50, items: [{ id: 1 }] }]]),
    );
    expect(viewOf(state, "get_items")).toMatchObject({
      shape: "list",
      membership: "recorded",
      counters: [],
    });
  },
);

it.each([
  [[], [{ id: 1 }]],
  [[{ id: 1 }], []],
  [[{ id: 1 }], [{ id: 2 }]],
] as const)(
  "ends a list's state at another root's write its membership changed across (%j -> %j)",
  (before, after) => {
    const state = stateOf(
      captureOf([
        ["GET", "/api/search", [...before]],
        ["POST", "/api/items", { id: 2 }],
        ["GET", "/api/search", [...after]],
      ]),
    );
    // An empty initial list proves no identity, so it is held as a document.
    expect(state.types.map((type) => type.init_before_ordinal)).toEqual(
      before.length > 0 ? [1] : [],
    );
    expect(state.entities.map((entity) => entity.id)).toEqual(
      before.map((item) => String(item.id)),
    );
    expect(viewOf(state, "get_search")).toMatchObject({
      shape: before.length > 0 ? "list" : "document",
    });
  },
);

it("accepts stable membership across another root's write and changes confined before it", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/search", []],
      ["GET", "/api/search", [{ id: 1 }]],
      ["POST", "/api/items", { id: 2 }],
      ["GET", "/api/search", [{ id: 1 }]],
    ]),
  );
  expect(viewOf(state, "get_search")).toMatchObject({ shape: "list" });
  expect(state.entities.map((entity) => entity.id)).toEqual(["1"]);
});

it.each(["offset", "start", "_start"])(
  "does not let an empty ?%s=1 page prove membership all",
  (name) => {
    const state = stateOf(
      captureOf([
        ["GET", "/api/orgs/1/books/1", { id: 1, name: "Alpha" }],
        ["GET", `/api/orgs/2/books?${name}=1`, []],
      ]),
    );
    expect(viewOf(state, "get_orgs_books_by_id")).toMatchObject({
      shape: "list",
      membership: "recorded",
    });
  },
);

it("does not let an empty ?page=2 page prove membership all", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/orgs/1/books/1", { id: 1, name: "Alpha" }],
      ["GET", "/api/orgs/2/books?page=2", []],
    ]),
  );
  expect(viewOf(state, "get_orgs_books_by_id")).toMatchObject({
    shape: "list",
    membership: "recorded",
  });
});

it("does not let ?page=2&per_page=1 prove membership all when it lists the collection", () => {
  const state = stateOf(
    captureOf([
      [
        "GET",
        "/api/orgs/1/books?page=2&per_page=1",
        [{ id: 1, name: "Alpha" }],
      ],
      ["GET", "/api/orgs/1/books/1", { id: 1, name: "Alpha" }],
    ]),
  );
  expect(viewOf(state, "get_orgs_books_by_id")).toMatchObject({
    shape: "list",
    membership: "recorded",
  });
});

it("keeps page 1 membership recorded because the page base is unproven", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/orgs/1/books?page=1", [{ id: 1, name: "Alpha" }]],
      ["GET", "/api/orgs/1/books/1", { id: 1, name: "Alpha" }],
    ]),
  );
  expect(viewOf(state, "get_orgs_books_by_id")).toMatchObject({
    shape: "list",
    membership: "recorded",
  });
});

it("keeps membership all when a zero offset lists the collection", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/orgs/1/books?offset=0", [{ id: 1, name: "Alpha" }]],
      ["GET", "/api/orgs/1/books/1", { id: 1, name: "Alpha" }],
    ]),
  );
  expect(viewOf(state, "get_orgs_books_by_id")).toMatchObject({
    shape: "list",
    membership: "all",
  });
});

it("keeps membership checks specific to the full request line", () => {
  const state = stateOf(
    captureOf([
      ["GET", "/api/search?page=1", [{ id: 1 }]],
      ["POST", "/api/items", { id: 2 }],
      ["GET", "/api/search?page=2", [{ id: 2 }]],
    ]),
  );
  expect(viewOf(state, "get_search")).toMatchObject({
    shape: "list",
    membership: "recorded",
  });
});

it("does not treat a first observation as a membership change", () => {
  const parent = captureOf([
    ["GET", "/api/search", [{ id: 1 }]],
    ["POST", "/api/items", { id: 2 }],
    ["GET", "/api/search", [{ id: 1 }]],
  ]);
  const data = structuredClone(parent.normalizedResult) as {
    records: { reported: { time: number } }[];
  };
  data.records[0]!.reported.time = 1500;
  const state = stateOf({ ...parent, normalizedResult: data });
  expect(viewOf(state, "get_search")).toMatchObject({ shape: "list" });
});

it.each([
  [{ id: 1 }, { id: 1, title: "Created" }],
  [{ id: 1, title: "Original" }, { id: 1 }],
])(
  "ends a type's state at another root's write it gained or lost fields across (%j -> %j)",
  (before, after) => {
    const state = stateOf(
      captureOf([
        ["GET", "/api/search/1", before],
        ["POST", "/api/items", { id: 2 }],
        ["GET", "/api/search/1", after],
      ]),
    );
    expect(state.types).toMatchObject([{ init_before_ordinal: 1 }]);
    expect(state.entities).toMatchObject([{ fields: before }]);
    expect(viewOf(state, "get_search_by_id")).toMatchObject({
      shape: "item",
    });
  },
);

it("reads only item totals and next-page markers as signs of a partial list", () => {
  const membership = (body: JsonValue) =>
    stateOf(captureOf([["GET", "/api/items", body]])).views.map((view) =>
      view.shape === "list" ? [view.membership, view.counters] : view.shape,
    );
  // Page and id numbers are not item totals, so a complete page stays whole.
  expect(
    membership({
      page: 1,
      total: 2,
      total_pages: 1,
      account_id: 77,
      items: [{ id: 1 }, { id: 2 }],
    }),
  ).toEqual([["all", ["total"]]]);
  expect(membership({ has_more: true, items: [{ id: 1 }, { id: 2 }] })).toEqual(
    [["recorded", []]],
  );
  expect(membership({ total: "50", items: [{ id: 1 }] })).toEqual([
    ["recorded", []],
  ]);
});

it("reads a sparse list once per candidate field when inferring identity", () => {
  const fields = 2_000;
  const wide: JsonObject = Object.fromEntries(
    Array.from({ length: fields }, (_, index) => [
      `f${String(index)}Id`,
      index,
    ]),
  );
  let reads = 0;
  const sparse = Array.from(
    { length: 5_000 },
    () =>
      new Proxy<JsonObject>(
        {},
        {
          get: (target, key, receiver) => {
            reads += 1;
            return Reflect.get(target, key, receiver) as unknown;
          },
        },
      ),
  );
  expect(identityCandidates([wide, ...sparse])).toEqual([]);
  // Each identity name and suffix field stops at the first sparse item.
  expect(reads).toBeLessThanOrEqual(fields + 20);
});

it("keeps a document out of the state when its value changed across a write under another root", () => {
  const changed = stateOf(
    captureOf([
      ["GET", "/api/me", { credits: 10, plan: "free" }],
      ["POST", "/api/orders", { id: "o1" }],
      ["GET", "/api/me", { credits: 9, plan: "free" }],
    ]),
  );
  expect(changed.documents).toEqual([]);
  expect(changed.views).toContainEqual({
    tool: "get_me",
    shape: "recorded",
    reason: "fields-differ",
  });
  // A value the write left unchanged is still one initial state.
  const unchanged = stateOf(
    captureOf([
      ["GET", "/api/me", { credits: 10, plan: "free" }],
      ["POST", "/api/orders", { id: "o1" }],
      ["GET", "/api/me", { credits: 10, plan: "free" }],
    ]),
  );
  expect(unchanged.documents).toMatchObject([
    { tool: "get_me", value: { credits: 10, plan: "free" }, record_ordinal: 2 },
  ]);
});

it("refuses a view clock spelling wider than nine fraction digits", () => {
  const item = stateOf().views.find((view) => view.shape === "item")!;
  const spelled = (fraction: number) => [
    {
      ...item,
      clock_formats: {
        created: { kind: "iso", separator: "T", fraction, zone: "Z" },
      },
    },
  ];
  expect(environmentStateFields.views.safeParse(spelled(9)).success).toBe(true);
  expect(environmentStateFields.views.safeParse(spelled(10)).success).toBe(
    false,
  );
});

it.each(["+00:60", "+24:00", "+99:99"])(
  "refuses a view clock spelling with invalid zone %s",
  (zone) => {
    const item = stateOf().views.find((view) => view.shape === "item")!;
    const view = {
      ...item,
      clock_formats: {
        created: { kind: "iso", separator: "T", fraction: 0, zone },
      },
    };
    expect(environmentStateFields.views.safeParse([view]).success).toBe(false);
  },
);

it("keeps learned prototype-named query roles through public result normalization", () => {
  const books = [
    { id: 1, shelf: "a" },
    { id: 2, shelf: "b" },
  ];
  const state = stateOf(
    captureOf([
      ["GET", "/api/books", books],
      ["GET", "/api/books?__proto__=x&shelf=a", [books[0]!]],
    ]),
  );
  const normalized = analysisViewResultSchema.parse(
    JSON.parse(JSON.stringify(state)),
  );
  if (normalized.kind !== "environment-state")
    throw new Error("Expected state");
  const view = normalized.views.find((entry) => entry.shape === "list");
  if (view?.shape !== "list" || view.query === undefined)
    throw new Error("Expected learned query");
  expect(
    Object.getOwnPropertyDescriptor(view.query.parameters, "__proto__")?.value,
  ).toEqual({ role: "inert", values: ["x"] });
  expect(
    evaluateQuery(
      view.query.parameters,
      singleQueryValues("?__proto__=x&shelf=a")!,
      normalized.entities,
    )?.page.map((entity) => entity.id),
  ).toEqual(["1"]);
});

it("validates every own render-metadata dictionary entry through the public schema", () => {
  const state = stateOf();
  const item = state.views.find((view) => view.shape === "item")!;
  const parse = (clock: unknown, nested: unknown) =>
    analysisViewResultSchema.safeParse({
      ...state,
      views: [
        {
          ...item,
          clock_formats: Object.fromEntries([["__proto__", clock]]),
          nested_fields: Object.fromEntries([["__proto__", nested]]),
        },
      ],
    });
  const clock = { kind: "epoch", unit: "ms" };
  const parsed = parse(clock, ["id"]);
  expect(parsed.success).toBe(true);
  if (!parsed.success || parsed.data.kind !== "environment-state")
    throw new Error("Expected state");
  const view = parsed.data.views[0]!;
  if (view.shape !== "item") throw new Error("Expected item");
  expect(
    Object.getOwnPropertyDescriptor(view.clock_formats, "__proto__")?.value,
  ).toEqual(clock);
  expect(
    Object.getOwnPropertyDescriptor(view.nested_fields, "__proto__")?.value,
  ).toEqual(["id"]);
  expect(parse({ kind: "epoch", unit: "invalid" }, ["id"]).success).toBe(false);
  expect(parse(clock, [1]).success).toBe(false);
});

it("preserves own prototype-named entity and document fields through capture projection and public normalization", () => {
  const first = JSON.parse(
    '{"id":1,"__proto__":{"label":"one"},"constructor":"first","meta":{"__proto__":"nested"}}',
  ) as JsonObject;
  const second = JSON.parse(
    '{"id":2,"__proto__":{"label":"two"},"constructor":"second","meta":{"__proto__":"nested"}}',
  ) as JsonObject;
  const document = JSON.parse('{"__proto__":{"theme":"dark"}}') as JsonObject;
  const projected = stateOf(
    captureOf([
      ["GET", "/api/items", [first, second]],
      ["GET", "/api/items/1", first],
      ["GET", "/api/settings", document],
    ]),
  );
  const state = analysisViewResultSchema.parse(
    JSON.parse(JSON.stringify(projected)),
  );
  if (state.kind !== "environment-state") throw new Error("Expected state");
  const entity = state.entities.find((entry) => entry.id === "1")!;
  expect(JSON.stringify(entity.fields)).toBe(JSON.stringify(first));
  expect(
    Object.getOwnPropertyDescriptor(entity.fields, "__proto__")?.value,
  ).toEqual({ label: "one" });
  expect(state.documents).toContainEqual(
    expect.objectContaining({ value: document }),
  );
});

it.each([
  {
    starts: [
      "Tue, 20 Oct 2026 09:00:00 GMT",
      "Tue, 20 Oct 2026 09:02:00 GMT",
      "Tue, 20 Oct 2026 09:01:00 GMT",
    ],
    missingDuration: false,
  },
  {
    starts: [
      "Tue, 20 Oct 2026 14:30:00 GMT+0530",
      "Tue, 20 Oct 2026 14:32:00 GMT+0530",
      "Tue, 20 Oct 2026 14:31:00 GMT+0530",
    ],
    missingDuration: true,
  },
  {
    starts: [
      "October 20, 2026 09:00:00",
      "October 20, 2026 09:02:00",
      "October 20, 2026 09:01:00",
    ],
    missingDuration: true,
  },
])(
  "preserves native chronological state and discloses interpretation ($missingDuration)",
  ({ starts, missingDuration }) => {
    const entries = starts.map((startedDateTime, ordinal) => ({
      startedDateTime,
      ...(missingDuration && ordinal === 2 ? {} : { time: 0 }),
      request: {
        method: ordinal === 2 ? "PATCH" : "GET",
        url: "http://app.example/api/settings",
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: ordinal === 0 ? '{"theme":"light"}' : '{"theme":"dark"}',
        },
      },
    }));
    const capture = webNetworkCaptureSchema.parse(
      environmentManifestCaptureFixture(entries),
    );
    const original = structuredClone(capture.records);
    const state = stateOf(parentOf(analysisViewCaptureEvidence(capture)));
    expect(state.timeline).toBe("recorded-start-time");
    expect(state.documents).toEqual([
      {
        tool: "get_settings",
        path: "/api/settings",
        value: { theme: "light" },
        record_ordinal: 0,
      },
    ]);
    expect(state.limitations).toContain(
      "Some recorded start spellings use native Date parsing at millisecond precision; spellings without an explicit zone depend on the host timezone.",
    );
    expect(capture.records).toEqual(original);
    if (missingDuration) expect(state.write_clock).toBeNull();
  },
);
