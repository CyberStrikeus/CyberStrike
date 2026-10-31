import { describe, expect, it } from "vitest";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../../tests/fixtures/analysisView.js";
import {
  environmentStateServeFixture,
  environmentStateServeInputs,
} from "../../../tests/fixtures/environmentServe.js";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import {
  book,
  bookClock,
} from "../../../tests/fixtures/environmentStateWrites.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  REPLAY_BODY_LIMIT_BYTES,
  type EnvironmentSource,
} from "./environmentSource.js";
import {
  answerFromState,
  type StateServing,
} from "./environmentStateAnswer.js";
import { EnvironmentStateStore } from "./environmentStateStore.js";

const grafana = environmentStateServeInputs();

const bk = (id: number, name: string) => book(id, name, bookClock(id));

const servingOf = (
  inputs: typeof grafana = grafana,
): StateServing & { readonly store: EnvironmentStateStore } => ({
  source: inputs.source,
  store: new EnvironmentStateStore(inputs.state),
});

/** Serve the state the view extracts from a synthetic timed capture. */
const servingFrom = (rows: readonly TimedCaptureRow[]) =>
  servingOf(
    environmentStateServeInputs(
      environmentStateServeFixture(timedCaptureEvidence(rows)),
    ),
  );

const toolOf = (source: EnvironmentSource, name: string) => {
  const found = source.manifest.tools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`Fixture manifest lacks ${name}`);
  return found;
};

const answer = (
  serving: StateServing,
  name: string,
  args: Readonly<Record<string, unknown>>,
) => {
  const result = answerFromState(serving, toolOf(serving.source, name), args);
  if (!result.ok) throw result.error;
  return result.value;
};

it("finds state entities using the recorded path's repeated separators", () => {
  const serving = servingFrom([
    ["GET", "/api//books/1", { id: 1, title: "Book" }],
  ]);
  const tool = serving.source.manifest.tools.find(
    (candidate) => candidate.path_template === "/api//books/{numeric}",
  );
  if (tool === undefined) throw new Error("Missing double-separator item tool");
  const result = answerFromState(serving, tool, { id: "1" });
  expect(result).toMatchObject({
    ok: true,
    value: { body: { id: 1, title: "Book" }, state: { source: "state" } },
  });
});

const refusal = (
  serving: StateServing,
  name: string,
  args: Readonly<Record<string, unknown>>,
) => {
  const result = answerFromState(serving, toolOf(serving.source, name), args);
  if (result.ok) throw new Error(`Expected ${name} to be refused`);
  return projectAnalysisError(result.error);
};

/** A list with one proved whole line keeps an entity added to an empty later page off that page. */
const expectAddedEntityStaysOffPage = (
  query: string,
  args: Readonly<Record<string, unknown>>,
  membership: "recorded" | "query" = "query",
): void => {
  const alpha = { id: 1, name: "Alpha" };
  const serving = servingFrom([
    ["GET", "/api/orgs/1/books", [alpha]],
    ["GET", "/api/orgs/1/books/1", alpha],
    ["GET", `/api/orgs/2/books?${query}`, []],
  ]);
  expect(serving.store.state.views.get("get_orgs_books_by_id")).toMatchObject({
    shape: "list",
    membership: "recorded",
  });
  load(serving, (entities) => [
    ...entities,
    {
      type: "/api/orgs/{numeric}/books",
      collection: "/api/orgs/2/books",
      id: "9",
      fields: { id: 9, name: "Added" },
    },
  ]);
  expect(
    answer(serving, "get_orgs_books_by_id", { id: "2", ...args }),
  ).toMatchObject({
    body: [],
    state: { source: "state", membership, listed: 0 },
  });
  // Without a proved whole line here, the argument-less call keeps recorded members.
  expect(answer(serving, "get_orgs_books_by_id", { id: "2" })).toMatchObject({
    body: [],
    state:
      membership === "query"
        ? { source: "state", membership: "recorded", listed: 0 }
        : { source: "recording", reason: "unrecorded-request" },
  });
};

/** A list with one proved whole line keeps an entity added to an empty start page off that page. */
const expectAddedEntityStaysOffStartPage = (name: string): void =>
  expectAddedEntityStaysOffPage(`${name}=1`, { [name]: "1" });

/** Replace the served state with the initial one changed by `edit`. */
const load = (
  serving: ReturnType<typeof servingOf>,
  edit: (entities: Record<string, unknown>[]) => Record<string, unknown>[],
  documents: unknown[] = [],
): void => {
  const initial = structuredClone(serving.store.snapshot().rea_state);
  const replaced = serving.store.replace({
    rea_state: {
      version: 1,
      entities: edit(initial.entities as unknown as Record<string, unknown>[]),
      documents,
    },
  });
  if (!replaced.ok) throw replaced.error;
};

describe("item answers", () => {
  it("renders the named entity into the recorded envelope with the base record's provenance", () => {
    const serving = servingOf();
    const probe = answer(serving, "get_users_by_id", { id: "2" });
    expect(probe).toMatchObject({
      status: 200,
      content_type: "application/json",
      body: { id: 2, login: "probe", email: "probe@example.test" },
      replay: { record_ordinal: 5, exact_match: true, truncated: false },
      state: {
        source: "state",
        view: "item",
        type: "/api/users",
        collection: "/api/users",
        id: "2",
      },
    });
    // The envelope comes from one record; another entity is still answered from the state.
    expect(answer(serving, "get_users_by_id", { id: "3" })).toMatchObject({
      body: { login: "viewer" },
      replay: { record_ordinal: 5, exact_match: false },
    });
    expect(
      answer(serving, "get_dashboards_by_uid", { uid: "acb4v6" }),
    ).toMatchObject({
      body: {
        meta: { type: "db", folderUid: "fg1jo91e57e2ob" },
        dashboard: { uid: "acb4v6", title: "probe dashboard", panels: [] },
      },
    });
    load(serving, (entities) =>
      entities.map((entity) =>
        entity.type === "/api/users" && entity.id === "3"
          ? {
              ...entity,
              fields: { ...(entity.fields as object), login: "renamed" },
            }
          : entity,
      ),
    );
    expect(answer(serving, "get_users_by_id", { id: "3" })).toMatchObject({
      body: { login: "renamed" },
    });
  });

  it("answers a state item whose route has a repeated path separator", () => {
    const serving = servingFrom([
      ["GET", "/api/books/1", { id: 1, title: "Single separator" }],
      ["GET", "/api//books/1", { id: 1, title: "Repeated separator" }],
    ]);
    const itemAnswer = (template: string) => {
      const tool = serving.source.manifest.tools.find(
        (candidate) => candidate.path_template === template,
      );
      if (tool === undefined) throw new Error(`Fixture lacks ${template}`);
      const result = answerFromState(serving, tool, { id: "1" });
      if (!result.ok) throw result.error;
      return result.value;
    };
    // The repeated separator route is answered from the collection it was
    // extracted under, instead of reporting its own entity as missing.
    expect(itemAnswer("/api//books/{numeric}")).toMatchObject({
      body: { title: "Repeated separator" },
      state: {
        source: "state",
        view: "item",
        collection: "/api//books",
        id: "1",
      },
    });
    // The single separator route stays distinct.
    expect(itemAnswer("/api/books/{numeric}")).toMatchObject({
      body: { title: "Single separator" },
      state: { source: "state", collection: "/api/books", id: "1" },
    });
  });

  it("creates into a collection whose route has a repeated path separator", () => {
    const serving = servedFrom([
      ["GET", "/api//books", [bk(1, "One"), bk(2, "Two")]],
      ["GET", "/api//books/1", bk(1, "One")],
      ["GET", "/api//books/2", bk(2, "Two")],
      ["POST", "/api//books", bk(3, "Recorded"), 201, { name: "Recorded" }],
      ["GET", "/api//books/3", bk(3, "Recorded")],
      ["GET", "/api//books", [bk(1, "One"), bk(2, "Two"), bk(3, "Recorded")]],
    ]);
    const post = serving.source.manifest.tools.find(
      (tool) => tool.method === "POST",
    );
    if (post === undefined) throw new Error("Fixture lacks a create tool");
    // A generated create (an unrecorded body) builds from state and must not be
    // refused for the empty literal segment in /api//books.
    const result = serving.call(post.name, { body: { name: "New" } });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      status: 201,
      state: { source: "state", view: "create", collection: "/api//books" },
    });
  });

  it("refuses an entity the state does not hold or one missing a field the view requires", () => {
    const serving = servingOf();
    expect(refusal(serving, "get_users_by_id", { id: "999" })).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("holds no /api/users entity 999"),
    });
    load(serving, (entities) =>
      entities.map((entity) => {
        if (entity.type !== "/api/users" || entity.id !== "2") return entity;
        const { email: _email, ...fields } = entity.fields as Record<
          string,
          unknown
        >;
        return { ...entity, fields };
      }),
    );
    expect(refusal(serving, "get_users_by_id", { id: "2" })).toMatchObject({
      message: expect.stringContaining("lacks fields"),
    });
    expect(refusal(serving, "get_users_by_id", {})).toMatchObject({
      message: expect.stringContaining("needs every path argument"),
    });
  });

  it("matches path arguments as replay does, verbatim or percent-decoded, without re-splitting them", () => {
    const files = servingFrom([
      ["GET", "/api/files/a%2Fb1", { id: "a/b1", name: "x" }],
      ["GET", "/api/files/c2", { id: "c2", name: "y" }],
      ["GET", "/api/files/d3", { id: "d3", name: "z" }],
    ]);
    for (const file_id of ["a/b1", "a%2Fb1"])
      expect(answer(files, "get_files_by_file_id", { file_id })).toMatchObject({
        body: { id: "a/b1", name: "x" },
        state: { source: "state", collection: "/api/files", id: "a/b1" },
      });
    const orgs = servingFrom([
      ["GET", "/api/orgs/my%20org1/users/1", { id: 1, name: "x" }],
      ["GET", "/api/orgs/org2/users/2", { id: 2, name: "y" }],
      ["GET", "/api/orgs/org3/users/3", { id: 3, name: "z" }],
    ]);
    for (const org_id of ["my org1", "my%20org1"])
      expect(
        answer(orgs, "get_orgs_users_by_org_id_id", { org_id, id: "1" }),
      ).toMatchObject({
        body: { id: 1, name: "x" },
        replay: { exact_match: true },
        state: { collection: "/api/orgs/my%20org1/users", id: "1" },
      });
    expect(
      refusal(orgs, "get_orgs_users_by_org_id_id", { org_id: "org2", id: "1" }),
    ).toMatchObject({
      message: expect.stringContaining(
        "holds no /api/orgs/{org_id}/users entity 1 in /api/orgs/org2/users",
      ),
    });
  });
});

describe("loaded later pages", () => {
  it.each(["offset", "start", "_start"])(
    "skips an entity added under an empty ?%s=1 page without whole-collection evidence",
    expectAddedEntityStaysOffStartPage,
  );

  it("does not list an entity added under an empty ?page=2&per_page=1 page", () => {
    expectAddedEntityStaysOffPage(
      "page=2&per_page=1",
      { page: "2", per_page: "1" },
      "recorded",
    );
  });
});

describe("list answers", () => {
  it("replays repeated query values instead of applying scalar state-query semantics", () => {
    const serving = servingFrom([
      ["GET", "/api/items?tag=a&tag=b", { selected: "b" }],
      ["GET", "/api/items?tag=a&tag=c", { selected: "c" }],
    ]);
    const tool = serving.source.manifest.tools.find(
      (candidate) => candidate.path_template === "/api/items",
    );
    if (tool === undefined) throw new Error("Missing items query tool");
    const argument = tool.query_parameter_names.find((name) => name === "tag");
    if (argument === undefined) throw new Error("Missing tag query argument");
    const result = answerFromState(serving, tool, { [argument]: ["a", "c"] });
    if (!result.ok) throw result.error;
    expect(result.value.body).toEqual({ selected: "c" });
    expect(result.value.replay).toMatchObject({
      exact_match: true,
      recorded_query: "?tag=a&tag=c",
    });
    expect(result.value.state).toEqual({
      source: "recording",
      reason: "query-multiplicity",
    });
  });

  it("lists every entity of the collection in state order when membership is all", () => {
    const serving = servingOf();
    const args = { uid: "acb4v6" };
    expect(
      answer(serving, "get_dashboards_versions_by_uid", args),
    ).toMatchObject({
      body: { versions: [{ id: 1, version: 1 }] },
      replay: { record_ordinal: 11, exact_match: true },
      state: {
        source: "state",
        view: "list",
        collection: "/api/dashboards/uid/acb4v6/versions",
        membership: "all",
        listed: 1,
      },
    });
    load(serving, (entities) => [
      ...entities,
      {
        type: "/api/dashboards/uid/{uid}/versions",
        collection: "/api/dashboards/uid/acb4v6/versions",
        id: "2",
        fields: { id: 2, version: 2 },
      },
    ]);
    expect(
      answer(serving, "get_dashboards_versions_by_uid", args).body,
    ).toEqual({
      versions: [
        { id: 1, version: 1 },
        { id: 2, version: 2 },
      ],
    });
  });

  it("lists the recorded members that remain when membership is recorded", () => {
    const serving = servingOf();
    const args = { limit: "100", page: "1" };
    expect(answer(serving, "get_folders", args)).toMatchObject({
      body: [{ id: 5, uid: "fg1jo91e57e2ob", title: "probe folder" }],
      state: { view: "list", membership: "recorded", listed: 1 },
    });
    load(serving, (entities) =>
      entities.filter((entity) => entity.id !== "fg1jo91e57e2ob"),
    );
    expect(answer(serving, "get_folders", args)).toMatchObject({
      body: [],
      state: { listed: 0 },
    });
  });

  it("renders only the lines its view checked, never a later or filtered recording", () => {
    const teams = servingFrom([
      ["GET", "/api/teams", [{ id: 1 }, { id: 2 }]],
      ["POST", "/api/teams", { id: 3 }],
      ["GET", "/api/teams?perpage=1", [{ id: 1 }]],
    ]);
    expect(answer(teams, "get_teams", {})).toMatchObject({
      body: [{ id: 1 }, { id: 2 }],
      replay: { record_ordinal: 0 },
      state: { source: "state", membership: "all", listed: 2 },
    });
    expect(answer(teams, "get_teams", { perpage: "1" })).toMatchObject({
      body: [{ id: 1 }],
      replay: { record_ordinal: 2 },
      state: { source: "recording", reason: "unrecorded-request" },
    });
    // Replay's tie-break picks the first line here, but the arguments name the second exactly.
    const items = servingFrom([
      ["GET", "/api/items?a=1&b=2", [{ id: 1 }]],
      ["GET", "/api/items?a=1", [{ id: 1 }, { id: 2 }]],
    ]);
    expect(answer(items, "get_items", { a: "1" })).toMatchObject({
      body: [{ id: 1 }, { id: 2 }],
      replay: { record_ordinal: 1, recorded_query: "?a=1" },
      state: { source: "state", membership: "recorded", listed: 2 },
    });
    expect(answer(items, "get_items", { a: "1", b: "2" })).toMatchObject({
      body: [{ id: 1 }],
      replay: { record_ordinal: 0 },
      state: { source: "state", listed: 1 },
    });
  });
});

describe("list answer coverage and bounds", () => {
  it("answers an unfiltered call from a paging-only line of the parent its path arguments name", () => {
    const books = servingFrom([
      ["GET", "/api/orgs/1/books?limit=50", [{ id: 1 }, { id: 2 }]],
      ["GET", "/api/orgs/2/books?limit=50", [{ id: 3 }]],
      ["GET", "/api/orgs/3/books?limit=50", [{ id: 4 }]],
    ]);
    expect(answer(books, "get_orgs_books_by_id", { id: "2" })).toMatchObject({
      body: [{ id: 3 }],
      replay: { record_ordinal: 1, exact_match: false },
      state: {
        source: "state",
        collection: "/api/orgs/2/books",
        membership: "all",
        listed: 1,
      },
    });
    expect(answer(books, "get_orgs_books_by_id", { id: "9" })).toMatchObject({
      state: { source: "recording", reason: "unrecorded-request" },
    });
  });

  it("answers a recorded call that pages by two parameters as it recorded, whatever order they are supplied in", () => {
    const books = servingFrom([
      ["GET", "/api/books", [{ id: 1 }, { id: 2 }, { id: 3 }]],
      ["GET", "/api/books?size=2&limit=1", [{ id: 1 }]],
    ]);
    expect(answer(books, "get_books", { size: "2", limit: "1" })).toMatchObject(
      {
        body: [{ id: 1 }],
        replay: { record_ordinal: 1, exact_match: true },
        state: { source: "state", membership: "query", listed: 1 },
      },
    );
  });

  it("refuses a list whose member lacks a field every recording carried, never answering a partial body", () => {
    const serving = servingOf();
    load(serving, (entities) =>
      entities.map((entity) => {
        if (entity.type !== "/api/folders" || entity.id !== "fg1jo91e57e2ob")
          return entity;
        const { title: _title, ...fields } = entity.fields as Record<
          string,
          unknown
        >;
        return { ...entity, fields };
      }),
    );
    expect(
      refusal(serving, "get_folders", { limit: "100", page: "1" }),
    ).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(
        "holds no complete /api/folders entity fg1jo91e57e2ob in /api/folders: it lacks fields this tool's responses always carried: title",
      ),
    });
  });

  it("answers an unrecorded request line from its recording", () => {
    const serving = servingOf();
    load(serving, () => []);
    for (const args of [{ limit: "50", page: "1" }, { limit: "100" }, {}])
      expect(answer(serving, "get_folders", args)).toMatchObject({
        body: [{ uid: "fg1jo91e57e2ob" }],
        state: { source: "recording", reason: "unrecorded-request" },
      });
  });
});

describe("recorded and document answers", () => {
  it("replays recorded views and tools without a view, saying why", () => {
    const serving = servingOf();
    expect(answer(serving, "get_annotations", {})).toMatchObject({
      replay: { record_ordinal: 25 },
      state: { source: "recording", reason: "no-init-recording" },
    });
    expect(answer(serving, "post_folders", {})).toMatchObject({
      state: { source: "recording", reason: "no-view" },
    });
  });

  it("replays a read whose rendered document exceeds the body limit", () => {
    const values = Array.from({ length: 60_000 }, () => "1e3").join(",");
    const body = `{"values":[${values}]}`;
    const serving = servingFrom([["GET", "/api/config", body]]);
    expect(serving.store.state.documents).toEqual([]);
    expect(answer(serving, "get_config", {})).toMatchObject({
      replay: { record_ordinal: 0 },
      state: { source: "recording", reason: "rendered-oversize" },
    });
  });

  it("caps a state-backed document by its exact serialized UTF-8 body bytes", () => {
    const capture = timedCaptureEvidence([
      ["GET", "/api/settings", { theme: "dark" }],
      ["PUT", "/api/settings", { theme: "light" }],
      ["GET", "/api/settings", { theme: "light" }],
    ]);
    const serving = servingOf(
      environmentStateServeInputs(environmentStateServeFixture(capture)),
    );
    const loadDocument = (value: string) =>
      load(serving, (entities) => entities, [
        { tool: "get_settings", path: "/api/settings", value },
      ]);

    const exactLimit = "x".repeat(REPLAY_BODY_LIMIT_BYTES - 2);
    expect(Buffer.byteLength(JSON.stringify(exactLimit), "utf8")).toBe(
      REPLAY_BODY_LIMIT_BYTES,
    );
    loadDocument(exactLimit);
    expect(answer(serving, "get_settings", {})).toMatchObject({
      body: exactLimit,
      replay: { truncated: false },
      state: { source: "state", view: "document" },
    });

    // The content is under the limit as text, but JSON escaping makes the
    // actual reply body exceed it. The refusal reports that encoded extent.
    const escaped = "\n".repeat(REPLAY_BODY_LIMIT_BYTES / 2 + 1);
    const bodyBytes = Buffer.byteLength(JSON.stringify(escaped), "utf8");
    expect(escaped.length).toBeLessThan(REPLAY_BODY_LIMIT_BYTES);
    expect(bodyBytes).toBeGreaterThan(REPLAY_BODY_LIMIT_BYTES);
    loadDocument(escaped);
    const before = serving.store.snapshot();
    const result = answerFromState(
      serving,
      toolOf(serving.source, "get_settings"),
      {},
    );
    expect(result.ok).toBe(false);
    if (result.ok)
      throw new Error("Expected the oversized state answer to be refused");
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      operation: "environment-serve",
      resource: "capacity",
      reportedLimits: {
        max_body_bytes: REPLAY_BODY_LIMIT_BYTES,
        body_bytes: bodyBytes,
      },
    });
    expect(serving.store.snapshot()).toEqual(before);
  });

  it("answers a document's recorded line with the state's value for it", () => {
    const capture = timedCaptureEvidence([
      ["GET", "/api/settings", { theme: "dark", density: "compact" }],
      ["PUT", "/api/settings", { theme: "light", density: "compact" }],
      ["GET", "/api/settings", { theme: "light", density: "compact" }],
    ]);
    const serving = servingOf(
      environmentStateServeInputs(environmentStateServeFixture(capture)),
    );
    expect(answer(serving, "get_settings", {})).toMatchObject({
      body: { theme: "dark", density: "compact" },
      replay: { record_ordinal: 0, exact_match: true },
      state: { source: "state", view: "document", path: "/api/settings" },
    });
    load(serving, (entities) => entities, [
      { tool: "get_settings", path: "/api/settings", value: { theme: "blue" } },
    ]);
    expect(answer(serving, "get_settings", {}).body).toEqual({ theme: "blue" });
    // Only the Evidence's own value cites its record; an edited one cites none and an invented citation is refused.
    expect(serving.store.snapshot().rea_state.documents).toEqual([
      { tool: "get_settings", path: "/api/settings", value: { theme: "blue" } },
    ]);
    load(serving, (entities) => entities, [
      {
        tool: "get_settings",
        path: "/api/settings",
        value: { theme: "dark", density: "compact" },
      },
    ]);
    expect(serving.store.snapshot().rea_state.documents).toEqual([
      {
        tool: "get_settings",
        path: "/api/settings",
        value: { theme: "dark", density: "compact" },
        record_ordinal: 0,
      },
    ]);
    const invented = serving.store.replace({
      rea_state: {
        version: 1,
        entities: [],
        documents: [
          {
            tool: "get_settings",
            path: "/api/settings",
            value: { theme: "blue" },
            record_ordinal: 2,
          },
        ],
      },
    });
    expect(invented.ok || invented.error.issues[0]?.path).toEqual([
      "rea_state",
      "documents",
      0,
      "record_ordinal",
    ]);
    load(serving, (entities) => entities, [
      {
        tool: "get_settings",
        path: "/api/settings",
        value: "x".repeat(REPLAY_BODY_LIMIT_BYTES),
      },
    ]);
    expect(refusal(serving, "get_settings", {})).toMatchObject({
      code: "resource_constraint",
      details: {
        reported_limits: { max_body_bytes: REPLAY_BODY_LIMIT_BYTES },
      },
    });
    load(serving, (entities) => entities);
    expect(refusal(serving, "get_settings", {})).toMatchObject({
      message: expect.stringContaining("holds no document"),
    });
  });
});
