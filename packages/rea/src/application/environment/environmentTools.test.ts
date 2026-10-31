import { describe, expect, it } from "vitest";

import { environmentServeSource } from "../../../tests/fixtures/environmentServe.js";
import type {
  EnvironmentManifestTool,
  RecordedExchange,
} from "./environmentSource.js";
import {
  ENVIRONMENT_CATALOG_LIMIT_BYTES,
  environmentCard,
  environmentToolArguments,
  environmentToolDefinitions as prepareDefinitions,
  REPLAY_CATALOG_INSTRUCTIONS,
} from "./environmentTools.js";

const source = environmentServeSource();
const environmentToolDefinitions = (
  ...args: Parameters<typeof prepareDefinitions>
) => {
  const result = prepareDefinitions(...args);
  if (!result.ok) throw result.error;
  return result.value;
};
const withTools = (tools: readonly EnvironmentManifestTool[]) => ({
  ...source,
  manifest: { ...source.manifest, tools: [...tools] },
});
const environmentToolInputSchema = (tool: EnvironmentManifestTool) => {
  const [definition] = environmentToolDefinitions(withTools([tool]));
  if (definition === undefined) throw new Error("Missing tool definition");
  return definition.inputSchema;
};
const definitions = environmentToolDefinitions(source);

const tool = (name: string): EnvironmentManifestTool => {
  const found = source.manifest.tools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Fixture manifest lacks ${name}`);
  return found;
};

describe("environmentToolDefinitions", () => {
  it("distinguishes computed answers from their retained envelope's match metadata", () => {
    const definitions = environmentToolDefinitions(source, "query-provenance", {
      dataPlane: "state",
    });
    for (const definition of definitions)
      expect(definition.description).toContain(
        "state.source, not replay.exact_match, identifies state vs recording",
      );
    expect(environmentToolDefinitions(source)[0]?.description).not.toContain(
      "state.source",
    );
  });

  it("maps every manifest tool in order with a replay description naming its records and evidence", () => {
    expect(definitions.map(({ name }) => name)).toEqual(
      source.manifest.tools.map(({ name }) => name),
    );
    const users = tool("get_users_by_id");
    const definition = definitions.find(({ name }) => name === users.name);
    expect(definition?.description).toBe(
      `${REPLAY_CATALOG_INSTRUCTIONS} GET ${users.path_template}; returns a JSON object with fields "id", "uid", "login", "email"; recorded statuses 200; replays retained records [${users.record_ordinals.join(", ")}]; evidence ${source.evidenceId}`,
    );
    expect(definition?.tool).toBe(users);
  });

  it("derives required string path parameters with their rule and observed values, refusing other arguments", () => {
    const users = tool("get_users_by_id");
    expect(environmentToolInputSchema(users)).toEqual({
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Path segment 2 (numeric); observed: 2, 3",
        },
      },
      required: ["id"],
      additionalProperties: false,
    });
    const folders = tool("get_folders_by_uid");
    expect(environmentToolInputSchema(folders).properties.uid).toEqual({
      type: "string",
      description: expect.stringMatching(
        /^Path segment 2 \((?:after-uid-literal|opaque-token|sibling-variance)\); observed: .*general/u,
      ),
    });
  });

  it("derives optional string query parameters and no body for reads", () => {
    const search = environmentToolInputSchema(tool("get_search"));
    expect(search.required).toEqual([]);
    expect(search.additionalProperties).toBe(false);
    expect(Object.keys(search.properties).sort()).toEqual(["query", "type"]);
    expect(search.properties.query).toEqual({
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { type: "string" } },
      ],
      description:
        "Query parameter query; optional. Supply one value for one occurrence, a number or boolean sent as its JSON text, or an array of strings to preserve repeated values in captured order; repeated values replay their recorded request.",
    });
    expect("body" in search.properties).toBe(false);
  });

  it("adds an optional body object for write methods describing the recorded key types", () => {
    const folders = environmentToolInputSchema(tool("post_folders"));
    expect(folders).toEqual({
      type: "object",
      properties: {
        body: {
          type: "object",
          description: "Request body; recorded top-level keys: title (string).",
        },
      },
      required: [],
      additionalProperties: false,
    });
    const deleted = environmentToolInputSchema(tool("delete_teams_by_id"));
    expect("body" in deleted.properties).toBe(false);
    expect(
      environmentToolInputSchema({ ...tool("post_folders"), body_shape: null })
        .properties.body?.description,
    ).toBe(
      "Request body; the capture retained no JSON body shape for this tool.",
    );
  });
});

const described = (name: string): string | undefined =>
  definitions.find((definition) => definition.name === name)?.description;
/** The users tool citing exactly the given exchanges, with the statuses its manifest recorded. */
const usersAnswering = (
  answers: readonly Partial<RecordedExchange>[],
  statuses: readonly number[] = [200],
): string | undefined => {
  const exchanges = new Map(
    answers.map((answer, index): [number, RecordedExchange] => [
      index,
      {
        ordinal: index,
        path: "/api/users/2",
        query: null,
        status: 200,
        contentType: "application/json",
        bodyText: null,
        ...answer,
      },
    ]),
  );
  const users = {
    ...tool("get_users_by_id"),
    record_ordinals: [...exchanges.keys()],
    statuses: [...statuses],
  };
  const [definition] = environmentToolDefinitions({
    ...withTools([users]),
    exchanges,
  });
  return definition?.description;
};
const returnsOf = (bodyText: string): string | undefined =>
  /\{numeric\}; (?<returns>[^;]*); recorded statuses/u.exec(
    usersAnswering([{ bodyText }]) ?? "",
  )?.groups?.returns;

describe("environment tool response shapes", () => {
  it("describes array, enveloped list and object responses one level deep with their statuses", () => {
    expect(described("get_folders")).toContain(
      'GET /api/folders; returns a JSON array of objects with fields "id", "uid", "title"; recorded statuses 200; replays',
    );
    expect(described("get_dashboards_versions_by_uid")).toContain(
      '; returns a JSON object whose "versions" lists objects with fields "id", "version"; recorded statuses 200; replays',
    );
    expect(described("get_dashboards_by_uid")).toContain(
      '; returns a JSON object with fields "meta", "dashboard"; recorded statuses 200; replays',
    );
  });

  it("describes empty, scalar and fieldless bodies and bounds a long member name", () => {
    expect(
      [
        "[]",
        "[1,2]",
        '"text"',
        "null",
        "true",
        "3",
        "{}",
        "[{},{}]",
        '{"items":[]}',
      ].map(returnsOf),
    ).toEqual([
      "returns a JSON array",
      "returns a JSON array",
      "returns a JSON string",
      "returns a JSON null",
      "returns a JSON boolean",
      "returns a JSON number",
      "returns a JSON object with no fields",
      "returns a JSON array of objects with no fields",
      'returns a JSON object with fields "items"',
    ]);
    const member = "m".repeat(2048);
    expect(
      usersAnswering([
        { bodyText: JSON.stringify({ [member]: [{ id: 1 }, { id: 2 }] }) },
      ]),
    ).toContain(
      `{numeric}; returns a JSON object whose "${"m".repeat(1022)}"… (member display truncated; full value in capture Evidence) lists objects with fields "id"; recorded statuses 200;`,
    );
  });

  it("quotes captured names, so a separator in one cannot read as more of the description", () => {
    const description = usersAnswering([
      {
        bodyText: JSON.stringify({
          "id, name": 1,
          "x; recorded statuses 500": 2,
        }),
      },
    ]);
    expect(description).toContain(
      'returns a JSON object with fields "id, name", "x; recorded statuses 500"; recorded statuses 200;',
    );
    expect(
      usersAnswering([
        { bodyText: JSON.stringify({ "a\nb": [{ id: 1 }, { id: 2 }] }) },
      ]),
    ).toContain('whose "a\\nb" lists objects with fields "id";');
    // A name too long to show whole is shown as a quoted prefix, so its newline cannot start a line of description.
    const long = `items; recorded statuses 500\n${"m".repeat(2048)}`;
    const shown = usersAnswering([
      { bodyText: JSON.stringify({ [long]: [{ id: 1 }, { id: 2 }] }) },
    ]);
    expect(shown).toContain('whose "items; recorded statuses 500\\nmmm');
    expect(shown).not.toContain("items; recorded statuses 500\n");
  });

  it("applies the sample budget after JSON escaping", () => {
    const member = "\u0000".repeat(1024);
    const description = usersAnswering([
      { bodyText: JSON.stringify({ [member]: [{ id: 1 }] }) },
    ]);
    const shown = /whose (?<name>"(?:\\u0000)*")/u.exec(description ?? "")
      ?.groups?.name;
    expect(shown).toBeDefined();
    expect(Buffer.byteLength(shown ?? "")).toBeLessThanOrEqual(1024);
    expect(description).toContain("member display truncated");
    expect(description).not.toContain("\u0000");
  });
});

describe("environment tool response summaries", () => {
  it("describes the first cited 2xx record replay answers as JSON, then the manifest's statuses", () => {
    const description = usersAnswering(
      [
        {
          contentType: "text/html",
          bodyText: '{"looks":"like JSON"}',
        },
        { status: 401, bodyText: '{"message":"Unauthorized","url":"/login"}' },
        { bodyText: '{"id":2,"login":"probe"}' },
        { bodyText: '[{"id":3,"email":"viewer@example.test"}]' },
      ],
      [200, 401],
    );
    expect(description).toContain(
      '{numeric}; returns a JSON object with fields "id", "login"; recorded statuses 200, 401; replays retained records [0, 1, 2, 3];',
    );
  });

  it("labels a JSON record of another status only when no 2xx record replays as JSON", () => {
    expect(
      usersAnswering(
        [
          { contentType: "text/html", bodyText: "<p>Signed out</p>" },
          { status: 401, bodyText: '{"message":"Unauthorized"}' },
          { status: 403, bodyText: '{"errors":[{"message":"Forbidden"}]}' },
        ],
        [200, 401, 403],
      ),
    ).toContain(
      '{numeric}; status 401 returns a JSON object with fields "message"; recorded statuses 200, 401, 403; replays',
    );
    expect(
      usersAnswering([{ status: null, bodyText: '{"id":2}' }], []),
    ).toContain(
      '{numeric}; a record without a status returns a JSON object with fields "id"; no recorded status; replays',
    );
  });

  it("states only the statuses when no cited exchange replays as JSON", () => {
    for (const answer of [
      { contentType: "text/html", bodyText: "<p>Granite Ledger</p>" },
      { bodyText: '{"id":9007199254740993}' },
      { bodyText: '{"id":2}', bodyEncoding: "base64" as const },
      { bodyText: '{"id":2}', bodyCut: true as const },
      { bodyText: null },
    ])
      expect(usersAnswering([answer])).toMatch(
        /\{numeric\}; recorded statuses 200; replays retained records/u,
      );
  });

  it("charges response summaries to the catalog reservation before retaining them", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `field_${String(index).padStart(3, "0")}`,
        index,
      ]),
    );
    const users = tool("get_users_by_id");
    const ordinal = users.record_ordinals[0] ?? 0;
    const catalog = (contentType: string) =>
      prepareDefinitions({
        ...withTools(
          Array.from({ length: 200 }, (_, index) => ({
            ...users,
            name: `get_users_${String(index)}`,
            record_ordinals: [ordinal],
          })),
        ),
        exchanges: new Map([
          [
            ordinal,
            {
              ordinal,
              path: "/api/users/2",
              query: null,
              status: 200,
              contentType,
              bodyText: JSON.stringify(fields),
            },
          ],
        ]),
      });
    expect(catalog("text/html").ok).toBe(true);
    const bounded = catalog("application/json");
    expect(bounded).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "capacity",
        reportedLimits: { max_catalog_bytes: ENVIRONMENT_CATALOG_LIMIT_BYTES },
      },
    });
    const [single] = environmentToolDefinitions({
      ...withTools([users]),
      exchanges: new Map([
        [
          ordinal,
          {
            ...source.exchanges.get(ordinal)!,
            bodyText: JSON.stringify(fields),
          },
        ],
      ]),
    });
    expect(Buffer.byteLength(single?.description ?? "")).toBeLessThan(1700);
    expect(single?.description).toContain(
      "/300 shown; full list in capture Evidence)",
    );
  });
});

describe("environment catalog description budgets", () => {
  it("bounds captured scalar prose while preserving complete lookup identities", () => {
    const query = "query-".repeat(1000);
    const expanded = {
      ...tool("get_users_by_id"),
      method: "METHOD".repeat(1000),
      path_template: `/${"😀".repeat(1000)}`,
      query_parameter_names: [query],
    };
    const [definition] = environmentToolDefinitions(withTools([expanded]));
    expect(definition?.tool).toBe(expanded);
    expect(Buffer.byteLength(definition?.description ?? "")).toBeLessThan(3500);
    expect(definition?.description).toContain(
      "path display truncated; full value in manifest Evidence",
    );
    expect(definition?.description).not.toContain("\uFFFD");
    expect(
      Object.hasOwn(definition?.inputSchema.properties ?? {}, "query_1"),
    ).toBe(true);
    expect(
      Buffer.byteLength(
        definition?.inputSchema.properties.query_1?.description ?? "",
      ),
    ).toBeLessThan(1400);
  });

  it("bounds observation and record samples without changing the retained manifest", () => {
    const users = tool("get_users_by_id");
    const observations = Array.from(
      { length: 10_000 },
      (_, index) => `${String(index)}-${"x".repeat(200)}`,
    );
    const ordinals = Array.from({ length: 10_000 }, (_, index) => index);
    const expanded = {
      ...users,
      params: users.params.map((param) => ({
        ...param,
        observed_values: observations,
      })),
      record_ordinals: ordinals,
    };
    const [definition] = environmentToolDefinitions(withTools([expanded]));
    expect(definition?.tool).toBe(expanded);
    expect(expanded.params[0]?.observed_values).toBe(observations);
    expect(expanded.record_ordinals).toBe(ordinals);
    for (const description of [
      definition?.description,
      definition?.inputSchema.properties.id?.description,
    ]) {
      expect(Buffer.byteLength(description ?? "")).toBeLessThan(1536);
      expect(description).toContain(
        "/10000 shown; full list in manifest Evidence",
      );
    }
    expect(definition?.description).toContain(source.evidenceId);
    expect(definition?.inputSchema.properties.id?.description).toContain(
      observations[0],
    );
  });

  it("cuts a long captured path in the tool description and keeps it whole in the manifest", () => {
    const users = tool("get_users_by_id");
    const long = {
      ...users,
      path_template: `/api/${"segment/".repeat(200_000)}{id}`,
    };
    const [definition] = environmentToolDefinitions(withTools([long]));
    expect(Buffer.byteLength(definition?.description ?? "")).toBeLessThan(2048);
    expect(definition?.description).toContain(
      "path display truncated; full value in manifest Evidence",
    );
    expect(definition?.tool.path_template).toBe(long.path_template);
  });

  it("advertises long path parameters with collision-safe aliases consistently", () => {
    const users = tool("get_users_by_id");
    const expanded = {
      ...users,
      params: [
        { ...users.params[0]!, name: "long".repeat(1000) },
        { ...users.params[0]!, name: "path_1", index: 3 },
      ],
    };
    const schema = environmentToolInputSchema(expanded);
    expect(schema.required).toEqual(["path_1", "path_path_1"]);
    expect(Object.keys(schema.properties)).toEqual(schema.required);
    expect(Buffer.byteLength(JSON.stringify(schema))).toBeLessThan(4096);
  });

  it("advertises an oversized query name under a short, collision-safe alias", () => {
    const longName = "n".repeat(100_000);
    const search = {
      ...tool("get_search"),
      query_parameter_names: [longName, "query_1"],
    };
    const args = environmentToolArguments(search);
    expect(args.query.get(longName)).toBe("query_1");
    expect(args.query.get("query_1")).toBe("query_query_1");
    const schema = environmentToolInputSchema(search);
    expect(Buffer.byteLength(JSON.stringify(schema))).toBeLessThan(4096);
    expect(schema.properties.query_1?.description).toContain(
      "query name display truncated; full value in manifest Evidence",
    );
    expect(search.query_parameter_names[0]).toBe(longName);
  });

  it("reports an omitted oversized value instead of publishing an unbounded or partial observation", () => {
    const users = tool("get_users_by_id");
    const schema = environmentToolInputSchema({
      ...users,
      params: users.params.map((param) => ({
        ...param,
        observed_values: ["😀".repeat(400), "other"],
      })),
    });
    const description = schema.properties.id?.description;
    expect(description).toBe(
      "Path segment 2 (numeric); observed: … (0/2 shown; full list in manifest Evidence)",
    );
    expect(description).not.toContain("\uFFFD");
  });

  it("applies the same sample budget to captured request-body key descriptions", () => {
    const folders = tool("post_folders");
    if (folders.body_shape === null)
      throw new Error("Missing fixture body shape");
    const properties = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `${String(index)}-${"x".repeat(200)}`,
        "string" as const,
      ]),
    );
    const bodyShape = { ...folders.body_shape, properties };
    const schema = environmentToolInputSchema({
      ...folders,
      body_shape: bodyShape,
    });
    const description = schema.properties.body?.description;
    expect(Buffer.byteLength(description ?? "")).toBeLessThan(1300);
    expect(description).toContain(
      "/10000 shown; full list in manifest Evidence",
    );
    expect(Object.keys(bodyShape.properties)).toHaveLength(10_000);
  });
});

describe("environmentToolInputSchema argument names", () => {
  it("keeps every input addressable when query names collide with a path parameter, the body or inherited names", () => {
    const schema = environmentToolInputSchema({
      ...tool("post_folders"),
      params: tool("get_users_by_id").params,
      query_parameter_names: ["id", "body", "constructor"],
    });
    expect(Object.keys(schema.properties)).toEqual([
      "id",
      "query_id",
      "body",
      "constructor",
      "request_body",
    ]);
    expect(Object.hasOwn(schema.properties, "constructor")).toBe(true);
    expect(schema.properties.query_id?.description).toBe(
      "Query parameter id; optional. Supply one value for one occurrence, a number or boolean sent as its JSON text, or an array of strings to preserve repeated values in captured order; repeated values replay their recorded request.",
    );
    expect(schema.properties.body?.oneOf).toEqual([
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "array", items: { type: "string" } },
    ]);
    expect(schema.properties.request_body?.type).toBe("object");
    expect(schema.required).toEqual(["id"]);
  });
});

describe("environmentCard", () => {
  it("shapes the card with fixed protocol fields, the tools and null extension slots in contract key order", () => {
    const card = environmentCard("grafana-example", definitions);
    expect(Object.keys(card)).toEqual([
      "name",
      "protocolVersion",
      "url",
      "preferredTransport",
      "additionalInterfaces",
      "capabilities",
      "children_environments",
    ]);
    expect(card).toMatchObject({
      name: "grafana-example",
      protocolVersion: "1.0",
      url: "/agentenv",
      preferredTransport: "JSONRPC",
      additionalInterfaces: [{ url: "/mcp", transport: "mcp" }],
      children_environments: null,
    });
    expect(Object.keys(card.capabilities)).toEqual([
      "extensions",
      "tools",
      "operations",
    ]);
    expect(card.capabilities.extensions).toBeNull();
    expect(card.capabilities.operations).toEqual([]);
    expect(card.capabilities.tools).toHaveLength(definitions.length);
    for (const [index, entry] of card.capabilities.tools.entries()) {
      expect(Object.keys(entry)).toEqual([
        "name",
        "description",
        "inputSchema",
      ]);
      expect(entry).toEqual({
        name: definitions[index]?.name,
        description: definitions[index]?.description,
        inputSchema: definitions[index]?.inputSchema,
      });
    }
    expect(environmentCard("renamed", definitions).name).toBe("renamed");
  });
});

describe("environment tool annotations", () => {
  it("marks OPTIONS and TRACE safe and idempotent, as GET is", () => {
    const get = tool("get_users_by_id");
    const hints = environmentToolDefinitions(
      withTools(
        (["OPTIONS", "TRACE"] as const).map((method) => ({
          ...get,
          name: `${method.toLowerCase()}_users_by_id`,
          method,
        })),
      ),
    ).map((definition) => definition.annotations);
    expect(hints).toEqual([
      { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    ]);
  });
});
