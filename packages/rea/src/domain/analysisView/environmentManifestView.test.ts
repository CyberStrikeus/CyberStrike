import { expect, it } from "vitest";
import {
  analysisViewCaptureEvidence,
  analysisViewLayoutEvidence,
  environmentManifestCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import {
  analysisViewRequestSchema,
  projectAnalysisView,
  type AnalysisViewRequest,
} from "./analysisView.js";

type ManifestView = Extract<
  AnalysisViewRequest,
  { kind: "environment-manifest" }
>;
type Rules = ManifestView["template_rules"];
const ALL_RULES: Rules = [
  "after-uid-literal",
  "opaque-token",
  "sibling-variance",
];
const RECORDED_VALUES = [
  "probe folder",
  "Main Org",
  "isGrafanaAdmin",
  "Annotation added",
  "probe@example.test",
  "console.log",
  "<!doctype",
  "JFIF",
  "accesscontrol=true",
  "dash-db",
];

const parentOf = (
  capture = environmentManifestCaptureFixture(),
  parameters: unknown = { sensitive_value_count: 0 },
) => {
  const evidence = analysisViewCaptureEvidence(capture);
  return {
    evidenceId: evidence.evidence_id,
    operation: evidence.operation,
    normalizedResult: evidence.normalized_result,
    subject: evidence.subject,
    limitations: [],
    parameters,
  };
};

const view = (rules: Rules = [], includeQuery = true): ManifestView => ({
  kind: "environment-manifest",
  template_rules: rules,
  include_query_parameter_names: includeQuery,
});

const manifest = (
  rules: Rules = [],
  capture = environmentManifestCaptureFixture(),
  includeQuery = true,
) => {
  const result = projectAnalysisView(
    parentOf(capture),
    view(rules, includeQuery),
  );
  if (!result.ok || result.value.kind !== "environment-manifest")
    throw new Error("Expected an environment manifest");
  return result.value;
};

const line = (entry: { method: string; path_template: string }): string =>
  `${entry.method} ${entry.path_template}`;

/** Replace the fixture's records with synthetic request lines on one or more origins. */
const syntheticCapture = (
  samples: readonly (readonly [
    method: string,
    url: string,
    mimeType?: string | null,
    postText?: string,
    postMimeType?: string,
  ])[],
) => {
  const capture = environmentManifestCaptureFixture();
  capture.total_records = samples.length;
  capture.records = samples.map(
    (
      [method, url, mimeType, postText, postMimeType = "application/json"],
      ordinal,
    ) => ({
      ...capture.records[0]!,
      ordinal,
      reported: {
        request: {
          method,
          url,
          ...(postText === undefined
            ? {}
            : { postData: { mimeType: postMimeType, text: postText } }),
        },
        response: {
          status: 200,
          content: {
            mimeType: mimeType === undefined ? "application/json" : mimeType,
          },
        },
      },
    }),
  );
  return capture;
};

it("keeps every template identical to the api-surface grouping when no opt-in rule is selected", () => {
  const parent = parentOf();
  const result = projectAnalysisView(parent, view());
  if (!result.ok || result.value.kind !== "environment-manifest")
    throw new Error("Expected an environment manifest");
  expect(projectAnalysisView(parent, view())).toEqual(result);
  const projected = result.value;
  const surface = projectAnalysisView(parent, {
    kind: "api-surface",
    offset: 0,
    limit: 100,
  });
  if (!surface.ok || surface.value.kind !== "api-surface")
    throw new Error("Expected an API surface");
  expect(projected).toMatchObject({
    origin: "http://grafana.example",
    name: "grafana-example",
    parent_operation: "inspect_web_network_capture",
    parent_evidence_id: parent.evidenceId,
    artifact: { path: "/fixtures/environment-manifest.har" },
    coverage: { status: "complete-within-view", examined: 22, total: 22 },
    templated_groups: 6,
    view: {
      kind: "environment-manifest",
      template_rules: [],
      include_query_parameter_names: true,
    },
  });
  expect(projected.view_digest).toMatch(/^[0-9a-f]{64}$/u);
  for (const tool of projected.tools)
    expect(tool.path_template).toBe(tool.api_surface_template);
  const primaryGroups = surface.value.groups
    .filter((group) => group.origin === projected.origin)
    .map(line)
    .sort();
  expect(
    [
      ...projected.tools.map(line),
      ...projected.excluded
        .filter((entry) => entry.origin === projected.origin)
        .map(line),
    ].sort(),
  ).toEqual(primaryGroups);
  expect(projected.tools.map((tool) => tool.name)).toEqual([
    "get_annotations",
    "post_annotations",
    "delete_dashboards_uid_acb4v6",
    "get_dashboards_uid_acb4v6",
    "get_dashboards_uid_acb4v6_versions",
    "get_datasources_uid_dg1jo96tern5sb_health",
    "get_folders",
    "post_folders",
    "get_folders_fg1jo91e57e2ob",
    "put_folders_fg1jo91e57e2ob",
    "get_folders_general",
    "get_org",
    "get_plugins_grafana_lokiexplore_app_settings",
    "get_plugins_grafana_pyroscope_app_settings",
    "get_plugins_grafana_testdata_datasource_settings",
    "get_search",
    "delete_teams_by_id",
    "get_teams_by_id",
    "get_teams_members_by_id",
    "get_user",
    "get_users_by_id",
    "get_users_orgs_by_id",
  ]);
  expect(
    projected.tools.find((tool) => tool.name === "get_users_by_id"),
  ).toEqual({
    name: "get_users_by_id",
    method: "GET",
    path_template: "/api/users/{numeric}",
    api_surface_template: "/api/users/{numeric}",
    params: [
      {
        index: 2,
        name: "id",
        rule: "numeric",
        basis: "inferred",
        observed_values: ["2", "3"],
      },
    ],
    query_parameter_names: [],
    body_shape: null,
    statuses: [200],
    content_types: ["application/json"],
    record_ordinals: [5, 6],
  });
  for (const value of RECORDED_VALUES)
    expect(JSON.stringify(projected)).not.toContain(value);
});

it("templates uid literals, opaque tokens and identifier-like siblings when every rule is selected", () => {
  const projected = manifest(ALL_RULES);
  expect(manifest(ALL_RULES)).toEqual(projected);
  const templates = projected.tools.map((tool) => tool.path_template);
  expect(templates).toEqual(
    expect.arrayContaining([
      "/api/dashboards/uid/{uid}",
      "/api/folders/{uid}",
      "/api/plugins/{plugin_id}/settings",
      "/api/datasources/uid/{uid}/health",
    ]),
  );
  expect(projected.tools).toHaveLength(19);
  expect(projected.templated_groups).toBe(13);
  const byName = new Map(projected.tools.map((tool) => [tool.name, tool]));
  expect(byName.get("get_folders_by_uid")).toMatchObject({
    method: "GET",
    path_template: "/api/folders/{uid}",
    api_surface_template: "/api/folders/fg1jo91e57e2ob",
    params: [
      {
        index: 2,
        name: "uid",
        rule: "opaque-token",
        observed_values: ["fg1jo91e57e2ob", "general"],
      },
    ],
    query_parameter_names: ["accesscontrol"],
    record_ordinals: [12, 13],
  });
  expect(byName.get("get_plugins_settings_by_plugin_id")).toMatchObject({
    api_surface_template: "/api/plugins/grafana-testdata-datasource/settings",
    params: [
      {
        index: 2,
        name: "plugin_id",
        rule: "sibling-variance",
        observed_values: [
          "grafana-lokiexplore-app",
          "grafana-pyroscope-app",
          "grafana-testdata-datasource",
        ],
      },
    ],
    record_ordinals: [15, 16, 17],
  });
  expect(byName.get("delete_dashboards_by_uid")).toMatchObject({
    method: "DELETE",
    params: [{ index: 3, name: "uid", rule: "after-uid-literal" }],
  });
  expect(byName.get("put_folders_by_uid")).toMatchObject({
    body_shape: {
      type: "object",
      properties: { overwrite: "boolean", title: "string" },
    },
  });
  expect(projected.limitations).toContain(
    "Opt-in template rules after-uid-literal, opaque-token, sibling-variance merge recorded literals by shape; merged parameters may conflate distinct resources.",
  );
});

it.each([
  [
    "after-uid-literal",
    ["/api/dashboards/uid/{uid}", "/api/datasources/uid/{uid}/health"],
    ["/api/folders/fg1jo91e57e2ob", "/api/folders/general"],
  ],
  [
    "opaque-token",
    ["/api/folders/{uid}", "/api/datasources/uid/{uid}/health"],
    ["/api/dashboards/uid/acb4v6", "/api/folders/general"],
  ],
  [
    "sibling-variance",
    ["/api/plugins/{plugin_id}/settings"],
    [
      "/api/dashboards/uid/acb4v6",
      "/api/datasources/uid/dg1jo96tern5sb/health",
      // `general` is not identifier-like, so on its own the rule leaves both folder literals alone;
      // with opaque-token selected the token's parameter absorbs it instead.
      "/api/folders/fg1jo91e57e2ob",
      "/api/folders/general",
    ],
  ],
] as const)(
  "applies %s on its own and leaves the other literals in place",
  (rule, templated, literal) => {
    const templates = manifest([rule]).tools.map((tool) => tool.path_template);
    expect(templates).toEqual(
      expect.arrayContaining([...templated, ...literal]),
    );
    const params = manifest([rule]).tools.flatMap((tool) => tool.params);
    expect(
      params.every((param) => param.rule === rule || param.rule === "numeric"),
    ).toBe(true);
  },
);

it("derives value-free body shapes, observed query names and record pointers", () => {
  const projected = manifest();
  const byName = new Map(projected.tools.map((tool) => [tool.name, tool]));
  expect(byName.get("post_annotations")?.body_shape).toEqual({
    type: "object",
    properties: {
      dashboardUID: "string",
      panelId: "number",
      tags: "array",
      text: "string",
      time: "number",
    },
  });
  expect(byName.get("post_folders")?.body_shape).toEqual({
    type: "object",
    properties: { title: "string" },
  });
  expect(byName.get("get_folders")?.body_shape).toBeNull();
  expect(byName.get("get_search")?.query_parameter_names).toEqual([
    "query",
    "type",
  ]);
  expect(byName.get("get_folders")?.query_parameter_names).toEqual([
    "limit",
    "page",
  ]);
  expect(byName.get("get_annotations")?.query_parameter_names).toEqual([
    "dashboardUID",
    "limit",
  ]);
  expect(projected.records).toHaveLength(24);
  expect(projected.records.map((record) => record.ordinal)).toEqual(
    Array.from({ length: 24 }, (_, index) => index + 3),
  );
  expect(projected.records[0]).toEqual({
    ordinal: 3,
    method: "GET",
    path: "/api/org",
    status: 200,
    content_type: "application/json",
  });
  for (const record of projected.records)
    expect(Object.keys(record).sort()).toEqual([
      "content_type",
      "method",
      "ordinal",
      "path",
      "status",
    ]);
  const silent = manifest([], environmentManifestCaptureFixture(), false);
  expect(silent.tools.map((tool) => tool.name)).toEqual(
    projected.tools.map((tool) => tool.name),
  );
  expect(
    silent.tools.every((tool) => tool.query_parameter_names.length === 0),
  ).toBe(true);
  expect(silent.limitations.join(" ")).not.toContain("query parameter names");
  expect(silent.view.include_query_parameter_names).toBe(false);
});

it("excludes other origins, pages, assets and non-JSON groups with reasons and fixed unknowns", () => {
  const projected = manifest();
  expect(projected.excluded).toEqual([
    {
      method: "GET",
      origin: "http://grafana.example",
      path_template: "/avatar/{hex}",
      reason: "ui-page-or-asset",
    },
    {
      method: "GET",
      origin: "http://grafana.example",
      path_template: "/dashboards",
      reason: "ui-page-or-asset",
    },
    {
      method: "GET",
      origin: "http://grafana.example",
      path_template: "/public/build/app.js",
      reason: "ui-page-or-asset",
    },
    {
      method: "GET",
      origin: "https://grafana.example.com",
      path_template: "/api/plugins/announcements",
      reason: "other-origin",
    },
  ]);
  expect(projected.unknowns.map((unknown) => unknown.kind)).toEqual([
    "authorization-model",
    "response-semantics",
    "state-transition",
  ]);
  expect(
    projected.unknowns.every((unknown) => unknown.statement.length > 0),
  ).toBe(true);
  const mixed = manifest(
    [],
    syntheticCapture([
      [
        "GET",
        "https://app.test/download/report.bin",
        "application/octet-stream",
      ],
      ["GET", "https://app.test/api/export", "text/csv"],
      ["GET", "https://app.test/notes/readme", "text/markdown"],
      ["GET", "https://app.test/health", null],
      ["GET", "https://app.test/api/items/9", "application/vnd.api+json"],
      ["GET", "invalid URL"],
      ["GET", "https://app.test/status", " ; charset=utf-8"],
    ]),
  );
  expect(mixed.tools.map(line)).toEqual([
    "GET /api/export",
    "GET /api/items/{numeric}",
    "GET /notes/readme",
  ]);
  expect(
    mixed.excluded.map((entry) => `${entry.path_template}:${entry.reason}`),
  ).toEqual([
    "/download/report.bin:non-json",
    "/health:non-json",
    "/status:non-json",
  ]);
  expect(mixed.limitations).toContain(
    "1 retained records without a usable request line are not represented in the manifest.",
  );
  expect(mixed.records.map((record) => record.content_type)).toEqual([
    "text/csv",
    "text/markdown",
    "application/vnd.api+json",
  ]);
});

it("names tools deterministically from literals, strips dotted labels and disambiguates collisions", () => {
  const projected = manifest(
    [],
    syntheticCapture([
      [
        "GET",
        "https://k8s.test/apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards/adf1",
      ],
      ["GET", "https://k8s.test/api/a.b/c"],
      ["GET", "https://k8s.test/api/a.c/c"],
      [
        "PATCH",
        "https://k8s.test/api/x/1/y/2",
        "application/json",
        '{"name":"n"}',
      ],
      ["GET", `https://k8s.test/api/${"segment-".repeat(12)}end`],
      ["GET", "https://k8s.test/api"],
      ["get", "https://k8s.test/api/lower"],
    ]),
  );
  const names = projected.tools.map((tool) => tool.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "get_dashboard_dashboards_adf1",
      "get_a_c",
      "get_a_c_2",
      "patch_x_y_by_id_id_2",
      "get",
      "get_lower",
    ]),
  );
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u);
  }
  const patch = projected.tools.find((tool) => tool.method === "PATCH");
  expect(patch).toMatchObject({
    path_template: "/api/x/{numeric}/y/{numeric}",
    params: [
      { index: 2, name: "id", observed_values: ["1"] },
      { index: 4, name: "id_2", observed_values: ["2"] },
    ],
    body_shape: { type: "object", properties: { name: "string" } },
  });
  expect(
    manifest([], syntheticCapture([["GET", "https://k8s.test/api/a.b/c"]]))
      .tools,
  ).toEqual(
    manifest([], syntheticCapture([["GET", "https://k8s.test/api/a.b/c"]]))
      .tools,
  );
});

it("merges identifier-like siblings at index two or later and never folds stop words", () => {
  const projected = manifest(
    ["sibling-variance"],
    syntheticCapture([
      ["GET", "https://s.test/api/users/7/search"],
      ["GET", "https://s.test/api/users/7/settings"],
      ["GET", "https://s.test/api/items/a1"],
      ["GET", "https://s.test/api/items/b2"],
      ["GET", "https://s.test/api/things/x"],
      ["GET", "https://s.test/api/things/y"],
      ["GET", "https://s.test/api/widgets/red-one"],
      ["GET", "https://s.test/api/widgets/blue-two"],
      ["GET", "https://s.test/api/widgets/green-three"],
      ["GET", "https://s.test/api/alpha"],
      ["GET", "https://s.test/api/beta1"],
      ["GET", "https://s.test/api/items/a1/versions"],
      ["GET", "https://s.test/api/items/a1/children"],
    ]),
  );
  expect(projected.tools.map((tool) => tool.path_template)).toEqual([
    "/api/alpha",
    "/api/beta1",
    "/api/items/a1/children",
    "/api/items/a1/versions",
    "/api/items/{item_id}",
    "/api/things/x",
    "/api/things/y",
    "/api/users/{numeric}/search",
    "/api/users/{numeric}/settings",
    "/api/widgets/{widget_id}",
  ]);
  expect(
    projected.tools.find(
      (tool) => tool.path_template === "/api/items/{item_id}",
    ),
  ).toMatchObject({
    name: "get_items_by_item_id",
    params: [
      {
        name: "item_id",
        rule: "sibling-variance",
        observed_values: ["a1", "b2"],
      },
    ],
    record_ordinals: [2, 3],
  });
  expect(
    projected.tools.find(
      (tool) => tool.path_template === "/api/widgets/{widget_id}",
    )?.params[0]?.observed_values,
  ).toEqual(["blue-two", "green-three", "red-one"]);
});

it("templates two adjacent literals after a plural literal as a pair when three pairs vary in both positions", () => {
  const projected = manifest(
    ["sibling-pair-variance"],
    syntheticCapture([
      [
        "GET",
        "https://g.test/api/v1/repos/lighthouse-rota/lamp-room-log/issues",
      ],
      ["GET", "https://g.test/api/v1/repos/granite-ledger/ledger-core/issues"],
      [
        "GET",
        "https://g.test/api/v1/repos/blue-heron-kitchen/recipe-book/issues",
      ],
      [
        "GET",
        "https://g.test/api/v1/repos/lighthouse-rota/tide-tables/issues/4",
      ],
      [
        "GET",
        "https://g.test/api/v1/repos/granite-ledger/audit-trail/issues/9",
      ],
      [
        "GET",
        "https://g.test/api/v1/repos/saltmarsh-depot/crate-tracker/issues/2",
      ],
      ["GET", "https://g.test/api/v1/teams/one/alpha/members"],
      ["GET", "https://g.test/api/v1/teams/two/beta/members"],
      ["GET", "https://g.test/api/v1/orgs/acme/x1/hooks"],
      ["GET", "https://g.test/api/v1/orgs/acme/x2/hooks"],
      ["GET", "https://g.test/api/v1/orgs/acme/x3/hooks"],
    ]),
  );
  expect(projected.tools.map((tool) => tool.path_template)).toEqual([
    "/api/v1/orgs/acme/x1/hooks",
    "/api/v1/orgs/acme/x2/hooks",
    "/api/v1/orgs/acme/x3/hooks",
    "/api/v1/repos/{repo_namespace}/{repo_name}/issues",
    "/api/v1/repos/{repo_namespace}/{repo_name}/issues/{numeric}",
    "/api/v1/teams/one/alpha/members",
    "/api/v1/teams/two/beta/members",
  ]);
  expect(
    projected.tools.find(
      (tool) =>
        tool.path_template ===
        "/api/v1/repos/{repo_namespace}/{repo_name}/issues",
    ),
  ).toMatchObject({
    name: "get_repos_issues_by_repo_namespace_repo_name",
    params: [
      {
        name: "repo_namespace",
        rule: "sibling-pair-variance",
        observed_values: [
          "blue-heron-kitchen",
          "granite-ledger",
          "lighthouse-rota",
        ],
      },
      {
        name: "repo_name",
        rule: "sibling-pair-variance",
        observed_values: ["lamp-room-log", "ledger-core", "recipe-book"],
      },
    ],
    record_ordinals: [0, 1, 2],
  });
  expect(
    projected.tools
      .find((tool) => tool.path_template.endsWith("/issues/{numeric}"))
      ?.params.map((param) => [param.name, param.rule]),
  ).toEqual([
    ["repo_namespace", "sibling-pair-variance"],
    ["repo_name", "sibling-pair-variance"],
    ["id", "numeric"],
  ]);
});

it("keeps a trailing pair literal because its second half names a sub-resource", () => {
  const projected = manifest(
    ["sibling-pair-variance"],
    syntheticCapture([
      ["GET", "https://g.test/api/v1/users/alice/followers"],
      ["GET", "https://g.test/api/v1/users/bob/following"],
      ["GET", "https://g.test/api/v1/users/carol/starred"],
    ]),
  );
  expect(projected.tools.map((tool) => tool.path_template)).toEqual([
    "/api/v1/users/alice/followers",
    "/api/v1/users/bob/following",
    "/api/v1/users/carol/starred",
  ]);
});

it("merges pairs before sibling-variance so the two rules compose", () => {
  const routes = syntheticCapture([
    ["GET", "https://g.test/api/repos/alice-1/common/issues"],
    ["GET", "https://g.test/api/repos/bob-2/common/issues"],
    ["GET", "https://g.test/api/repos/carol-3/other/issues"],
    ["GET", "https://g.test/api/repos/dave-4/third/issues"],
  ]);
  for (const rules of [
    ["sibling-pair-variance"],
    ["sibling-variance", "sibling-pair-variance"],
  ] as const)
    expect(
      manifest([...rules], routes).tools.map((tool) => tool.path_template),
    ).toEqual(["/api/repos/{repo_namespace}/{repo_name}/issues"]);
});

it("keeps each pair parameter's role when sibling-variance later templates the segment before the pair", () => {
  const projected = manifest(
    ["sibling-variance", "sibling-pair-variance"],
    syntheticCapture([
      ["GET", "https://g.test/api/root/group1s/alice-1/common/issues"],
      ["GET", "https://g.test/api/root/group1s/bob-2/ledger/issues"],
      ["GET", "https://g.test/api/root/group1s/carol-3/books/issues"],
      ["GET", "https://g.test/api/root/group2s/dave-4/x1/issues"],
      ["GET", "https://g.test/api/root/group2s/erin-5/x2/issues"],
      ["GET", "https://g.test/api/root/group2s/finn-6/x3/issues"],
    ]),
  );
  expect(projected.tools).toHaveLength(1);
  expect(
    projected.tools[0]?.params.map((param) => [param.name, param.rule]),
  ).toEqual([
    ["root_id", "sibling-variance"],
    ["namespace", "sibling-pair-variance"],
    ["name", "sibling-pair-variance"],
  ]);
});

it("never folds a literal sibling into a format-rule parameter", () => {
  const projected = manifest(
    ALL_RULES,
    syntheticCapture([
      ["GET", "https://t.test/api/teams/1"],
      ["GET", "https://t.test/api/teams/2"],
      ["GET", "https://t.test/api/teams/search"],
      ["GET", "https://t.test/api/teams/mine"],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "GET /api/teams/mine",
    "GET /api/teams/search",
    "GET /api/teams/{numeric}",
  ]);
  expect(projected.tools.map((tool) => tool.name)).toEqual([
    "get_teams_mine",
    "get_teams_search",
    "get_teams_by_id",
  ]);
  expect(projected.tools[2]).toMatchObject({
    api_surface_template: "/api/teams/{numeric}",
    params: [
      { index: 2, name: "id", rule: "numeric", observed_values: ["1", "2"] },
    ],
    record_ordinals: [0, 1],
  });
  expect(projected.templated_groups).toBe(1);
});

it("folds a literal sibling recorded before the templated token into the same parameter", () => {
  const literalFirst = [
    ["GET", "https://g.test/api/folders/general?accesscontrol=true"],
    ["GET", "https://g.test/api/folders/fg1jo91e57e2ob"],
  ] as const;
  const projected = manifest(ALL_RULES, syntheticCapture(literalFirst));
  expect(projected.tools).toHaveLength(1);
  expect(projected.tools[0]).toMatchObject({
    name: "get_folders_by_uid",
    path_template: "/api/folders/{uid}",
    api_surface_template: "/api/folders/general",
    params: [
      {
        index: 2,
        name: "uid",
        rule: "opaque-token",
        observed_values: ["fg1jo91e57e2ob", "general"],
      },
    ],
    query_parameter_names: ["accesscontrol"],
    record_ordinals: [0, 1],
  });
  expect(projected.templated_groups).toBe(1);
  const tokenFirst = manifest(
    ALL_RULES,
    syntheticCapture([literalFirst[1], literalFirst[0]]),
  ).tools[0]!;
  expect(tokenFirst.api_surface_template).toBe("/api/folders/fg1jo91e57e2ob");
  const { api_surface_template: _literal, ...literalTool } =
    projected.tools[0]!;
  const { api_surface_template: _token, ...tokenTool } = tokenFirst;
  expect(literalTool).toEqual(tokenTool);
});

it("derives body shapes only from JSON-typed request bodies and rejects repeated rules", () => {
  const projected = manifest(
    [],
    syntheticCapture([
      [
        "POST",
        "https://b.test/api/notes",
        "application/json",
        '{"text":"x"}',
        "text/plain",
      ],
      [
        "PUT",
        "https://b.test/api/notes",
        "application/json",
        '{"text":"x"}',
        "application/vnd.api+json",
      ],
    ]),
  );
  expect(projected.tools.map((tool) => [tool.method, tool.body_shape])).toEqual(
    [
      ["POST", null],
      ["PUT", { type: "object", properties: { text: "string" } }],
    ],
  );
  expect(
    analysisViewRequestSchema.safeParse({
      kind: "environment-manifest",
      template_rules: ["opaque-token", "opaque-token"],
    }).success,
  ).toBe(false);
  expect(
    analysisViewRequestSchema.parse({ kind: "environment-manifest" }),
  ).toEqual({
    kind: "environment-manifest",
    template_rules: [],
    include_query_parameter_names: true,
  });
});

it("selects the origin with the most JSON-like records and names it from the host", () => {
  const projected = manifest(
    [],
    syntheticCapture([
      ["GET", "https://pages.test/", "text/html"],
      ["GET", "https://pages.test/about", "text/html"],
      ["GET", "https://pages.test/team", "text/html"],
      ["GET", "https://api.example.test:8443/v1/items", "application/json"],
      [
        "POST",
        "https://api.example.test:8443/v1/items",
        "application/json",
        "[1,2]",
      ],
    ]),
  );
  expect(projected).toMatchObject({
    origin: "https://api.example.test:8443",
    name: "api-example-test-8443",
    templated_groups: 0,
  });
  expect(projected.tools.map(line)).toEqual([
    "GET /v1/items",
    "POST /v1/items",
  ]);
  expect(projected.tools[1]?.body_shape).toBeNull();
  expect(projected.excluded.map((entry) => entry.reason)).toEqual([
    "other-origin",
    "other-origin",
    "other-origin",
  ]);
  const empty = manifest(
    [],
    syntheticCapture([
      ["GET", "invalid URL"],
      ["GET", "data:,x"],
    ]),
  );
  expect(empty).toMatchObject({ origin: "", name: "", tools: [], records: [] });
  expect(empty.coverage).toMatchObject({
    status: "complete-within-view",
    total: 0,
  });
  expect(empty.limitations).toContain(
    "No retained record had a parseable origin; the manifest names no primary origin.",
  );
});

it("refuses non-HAR formats, sensitive parents, unsupported parents and malformed results", () => {
  const capture = environmentManifestCaptureFixture();
  for (const format of ["mitmproxy", "saz"] as const) {
    capture.format = format;
    expect(projectAnalysisView(parentOf(capture), view())).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisUnsupportedTargetError" },
    });
  }
  for (const parameters of [{ sensitive_value_count: 1 }, {}, null])
    expect(
      projectAnalysisView(
        parentOf(environmentManifestCaptureFixture(), parameters),
        view(ALL_RULES),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisUnsupportedTargetError",
        reason: "sensitive_values_unretained",
      },
    });
  const layout = analysisViewLayoutEvidence();
  expect(
    projectAnalysisView(
      {
        evidenceId: layout.evidence_id,
        operation: layout.operation,
        normalizedResult: layout.normalized_result,
        limitations: [],
      },
      view(),
    ),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisUnsupportedTargetError" },
  });
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (const normalizedResult of [{}, cyclic])
    expect(
      projectAnalysisView(
        {
          evidenceId: `ev_${"a".repeat(64)}`,
          operation: "inspect_web_network_capture",
          normalizedResult,
          limitations: [],
        },
        view(),
      ),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
});

it("refuses a path whose templated representation exceeds projection capacity", () => {
  const capture = syntheticCapture([
    ["GET", `https://api.example.test${"/1".repeat(800_000)}`],
  ]);
  expect(projectAnalysisView(parentOf(capture), view())).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError", resource: "memory" },
  });
});

it("preserves every own body key while publishing only its observed type", () => {
  const projected = manifest(
    [],
    syntheticCapture([
      [
        "POST",
        "https://b.test/api/items",
        "application/json",
        '{"__proto__":{"admin":true},"constructor":"c","name":1}',
      ],
    ]),
  );
  const shape = projected.tools[0]?.body_shape;
  expect(shape).toEqual({
    type: "object",
    properties: {
      ["__proto__"]: "object",
      constructor: "string",
      name: "number",
    },
  });
  expect(Object.getPrototypeOf(shape?.properties)).toBe(Object.prototype);
  expect(Object.hasOwn(shape!.properties, "__proto__")).toBe(true);
  expect(JSON.stringify(projected)).not.toContain("admin");
});

it("keeps a stop word literal after a uid literal instead of templating it", () => {
  const projected = manifest(
    ["after-uid-literal"],
    syntheticCapture([
      ["GET", "https://s.test/api/items/uid/abc"],
      ["GET", "https://s.test/api/items/uid/search"],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "GET /api/items/uid/search",
    "GET /api/items/uid/{uid}",
  ]);
  expect(projected.tools[1]?.params[0]?.observed_values).toEqual(["abc"]);
});

it("reads only the top-level key types of a deeply nested request body", () => {
  const nested = `${"[".repeat(2_500)}1${"]".repeat(2_500)}`;
  const projected = manifest(
    [],
    syntheticCapture([
      [
        "POST",
        "https://s.test/api/folders",
        "application/json",
        `{"title":"t","tree":${nested},"count":2,"meta":{"deep":${nested}}}`,
      ],
    ]),
  );
  expect(projected.tools[0]?.body_shape).toEqual({
    type: "object",
    properties: {
      count: "number",
      meta: "object",
      title: "string",
      tree: "array",
    },
  });
});

it("assigns collision suffixes in sequence and keeps every name unique", () => {
  const projected = manifest(
    [],
    syntheticCapture(
      Array.from(
        { length: 300 },
        (_, index) =>
          ["GET", `https://s.test/api/item.${String(index)}`] as const,
      ),
    ),
  );
  const names = projected.tools.map((tool) => tool.name);
  expect(new Set(names).size).toBe(300);
  expect([...names].sort()).toEqual(
    [
      "get_item",
      ...Array.from(
        { length: 299 },
        (_, index) => `get_item_${String(index + 2)}`,
      ),
    ].sort(),
  );
});

it("does not compare routes beyond the sibling-variance segment limit and says so", () => {
  const tail = Array.from(
    { length: 36 },
    (_, index) => `s${String(index)}`,
  ).join("/");
  const projected = manifest(
    ["sibling-variance"],
    syntheticCapture([
      ["GET", `https://s.test/api/items/a1/${tail}`],
      ["GET", `https://s.test/api/items/b2/${tail}`],
      ["GET", "https://s.test/api/things/c3"],
      ["GET", "https://s.test/api/things/d4"],
    ]),
  );
  expect(projected.tools.map((tool) => tool.path_template)).toEqual([
    `/api/items/a1/${tail}`,
    `/api/items/b2/${tail}`,
    "/api/things/{thing_id}",
  ]);
  expect(projected.limitations).toContain(
    "Routes with more than 32 segments are not compared by sibling-variance; they keep their grouped templates.",
  );
});

it("shares collision suffixes across bases that differ only past the name limit", () => {
  const stem = "x".repeat(70);
  const projected = manifest(
    [],
    syntheticCapture(
      Array.from(
        { length: 200 },
        (_, index) =>
          ["GET", `https://s.test/api/${stem}${String(index)}`] as const,
      ),
    ),
  );
  const names = projected.tools.map((tool) => tool.name);
  expect(new Set(names).size).toBe(200);
  expect(names.every((name) => name.length <= 60)).toBe(true);
  expect(names.filter((name) => /_\d+$/u.test(name))).toHaveLength(199);
});

it("folds many literal siblings into one opt-in parameter", () => {
  const projected = manifest(
    ["opaque-token", "sibling-variance"],
    syntheticCapture([
      ["GET", "https://s.test/api/items/abc123def456ghi"],
      ...Array.from(
        { length: 300 },
        (_, index) =>
          ["GET", `https://s.test/api/items/name-${String(index)}`] as const,
      ),
    ]),
  );
  expect(projected.tools).toHaveLength(1);
  expect(projected.tools[0]?.params[0]?.observed_values).toHaveLength(301);
});

it("treats a +json suffix as JSON only on application media types", () => {
  const projected = manifest(
    [],
    syntheticCapture([
      ["GET", "https://s.test/api/items", "application/vnd.api+json"],
      ["GET", "https://s.test/gallery/1", "image/example+json"],
      ["GET", "https://s.test/notes/1", "text/example+json"],
      [
        "POST",
        "https://s.test/api/items",
        "application/json",
        '{"title":"t"}',
        "text/example+json",
      ],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "GET /api/items",
    "POST /api/items",
  ]);
  expect(
    projected.excluded.map((entry) => [entry.path_template, entry.reason]),
  ).toEqual([
    ["/gallery/{numeric}", "ui-page-or-asset"],
    ["/notes/{numeric}", "non-json"],
  ]);
  expect(projected.tools[1]?.body_shape).toBeNull();
});

it("keeps a write answered with no body as a tool whatever its content type, but not one only redirected", () => {
  const capture = syntheticCapture([
    ["GET", "https://s.test/items/1", "application/json"],
    ["GET", "https://s.test/items/2", "application/json"],
    ["DELETE", "https://s.test/items/1", "text/html"],
    ["DELETE", "https://s.test/items/2", "text/html"],
    ["POST", "https://s.test/forms/1", "text/html"],
    ["PUT", "https://s.test/pages/1", "text/html"],
  ]);
  const answer = (index: number, status: number, text?: string): void => {
    const record = capture.records[index]!;
    record.reported = {
      ...(record.reported as Record<string, unknown>),
      response: {
        status,
        content: {
          mimeType: "text/html",
          ...(text === undefined ? {} : { text }),
        },
      },
    };
  };
  answer(2, 204);
  answer(3, 200, "");
  // A redirect is no answer, and a missing text may be a body the capture did not keep.
  answer(4, 302, "");
  answer(5, 200);
  const projected = manifest([], capture);
  expect(projected.tools.map(line)).toEqual([
    "DELETE /items/{numeric}",
    "GET /items/{numeric}",
  ]);
  expect(
    projected.excluded.map((entry) => [entry.path_template, entry.reason]),
  ).toEqual([
    ["/forms/{numeric}", "ui-page-or-asset"],
    ["/pages/{numeric}", "ui-page-or-asset"],
  ]);
});

it("keeps opaque or redacted empty response text unknown when selecting bodiless writes", () => {
  const capture = syntheticCapture([
    ["POST", "https://s.test/opaque/1", "text/html"],
    ["POST", "https://s.test/hidden/1", "text/html"],
    ["POST", "https://s.test/base64/1", "text/html"],
  ]);
  for (const [index, record] of capture.records.entries()) {
    record.reported = {
      ...(record.reported as Record<string, unknown>),
      response: {
        status: 200,
        content: {
          mimeType: "text/html",
          text: "",
          ...(index === 0 ? { encoding: "opaque" } : {}),
          ...(index === 2 ? { encoding: "base64" } : {}),
        },
      },
    };
    if (index === 1)
      record.redactions = [
        {
          pointer: "/response/content",
          reason: "explicit-sensitive-value",
          scope: "property-name",
        },
      ];
    if (index === 2)
      record.binary_fields = [
        {
          pointer: "/response/content/text",
          representation: "har-base64-content",
          state: "retained",
          content_base64: "",
          bytes: 0,
          sha256:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      ];
  }
  const projected = manifest([], capture);
  expect(projected.tools.map(line)).toEqual(["POST /base64/{numeric}"]);
  expect(projected.excluded.map((entry) => entry.path_template)).toEqual([
    "/hidden/{numeric}",
    "/opaque/{numeric}",
  ]);
});

it("refuses a parent whose subject is absent or names another digest", () => {
  const parent = parentOf();
  const refusal = {
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      issues: [{ path: ["source", "subject"], reason: "invalid_value" }],
    },
  };
  const { subject, ...withoutSubject } = parent;
  expect(projectAnalysisView(withoutSubject, view())).toMatchObject(refusal);
  expect(
    projectAnalysisView({ ...withoutSubject, subject: null }, view()),
  ).toMatchObject(refusal);
  if (subject == null) throw new Error("Fixture evidence carries a subject");
  expect(
    projectAnalysisView(
      {
        ...parent,
        subject: {
          ...subject,
          digest: { ...subject.digest, sha256: "0".repeat(64) },
        },
      },
      view(),
    ),
  ).toMatchObject(refusal);
  expect(projectAnalysisView(parent, view()).ok).toBe(true);
});

it("merges only the identifier-like siblings and keeps the other literals as their own tools", () => {
  const projected = manifest(
    ["sibling-variance"],
    syntheticCapture([
      ["GET", "https://s.test/api/items/a1"],
      ["GET", "https://s.test/api/items/b2"],
      ["GET", "https://s.test/api/items/mine"],
      ["GET", "https://s.test/api/items/search"],
      ["GET", "https://s.test/api/widgets/red-one"],
      ["GET", "https://s.test/api/widgets/blue-two"],
      ["GET", "https://s.test/api/widgets/green-three"],
      ["GET", "https://s.test/api/widgets/shared"],
    ]),
  );
  expect(projected.tools.map((tool) => tool.path_template)).toEqual([
    "/api/items/mine",
    "/api/items/search",
    "/api/items/{item_id}",
    "/api/widgets/shared",
    "/api/widgets/{widget_id}",
  ]);
  expect(
    projected.tools.find(
      (tool) => tool.path_template === "/api/items/{item_id}",
    )?.params[0]?.observed_values,
  ).toEqual(["a1", "b2"]);
});

it.each([
  {
    coded: ["a1", "b2"],
    hyphenated: ["red-one", "blue-two", "green-three"],
    eligible: ["a1", "b2", "red-one", "blue-two", "green-three"],
    literal: ["mine", "search"],
  },
  {
    coded: ["a1"],
    hyphenated: ["red-one", "blue-two", "green-three"],
    eligible: ["a1", "red-one", "blue-two", "green-three"],
    literal: ["mine", "search"],
  },
  {
    coded: ["a1", "b2"],
    hyphenated: ["red-one", "blue-two"],
    eligible: ["a1", "b2"],
    literal: ["mine", "search", "red-one", "blue-two"],
  },
])(
  "combines qualifying sibling cohorts without promoting a short hyphenated cohort: $coded / $hyphenated",
  ({ coded, hyphenated, eligible, literal }) => {
    const values = [...coded, ...hyphenated, "mine", "search"];
    const projected = manifest(
      ["sibling-variance"],
      syntheticCapture(
        values.map(
          (value) => ["GET", `https://s.test/api/items/${value}`] as const,
        ),
      ),
    );
    expect(
      projected.tools.find(
        (tool) => tool.path_template === "/api/items/{item_id}",
      )?.params[0]?.observed_values,
    ).toEqual([...eligible].sort());
    expect(
      projected.tools
        .filter((tool) => tool.params.length === 0)
        .map((tool) => tool.path_template)
        .sort(),
    ).toEqual(literal.map((value) => `/api/items/${value}`).sort());
    expect(projected.records).toHaveLength(values.length);
  },
);

it("templates a literal that another method's opt-in parameter observed at the same position, at any depth", () => {
  const routes = syntheticCapture([
    ["GET", "https://k.test/api/v1/collections/0RZ51AB"],
    ["GET", "https://k.test/api/v1/collections/0RZ52CD"],
    ["GET", "https://k.test/api/v1/collections/0RZ53EF"],
    ["PATCH", "https://k.test/api/v1/collections/0RZ53EF", null, "{}"],
    ["DELETE", "https://k.test/api/v1/collections/0RZ53EF", null],
    ["GET", "https://k.test/api/v1/collections/0RZ52CD/books"],
    ["GET", "https://k.test/api/v1/collections/layout"],
    ["POST", "https://k.test/api/v1/collections/search", null, "{}"],
  ]);
  const shared = manifest(["sibling-variance", "prefix-variance"], routes);
  expect(shared.tools.map(line)).toEqual([
    "GET /api/v1/collections/layout",
    "POST /api/v1/collections/search",
    "DELETE /api/v1/collections/{collection_id}",
    "GET /api/v1/collections/{collection_id}",
    "PATCH /api/v1/collections/{collection_id}",
    "GET /api/v1/collections/{collection_id}/books",
  ]);
  expect(shared.tools.find((tool) => tool.method === "PATCH")).toMatchObject({
    name: "patch_collections_by_collection_id",
    api_surface_template: "/api/v1/collections/0RZ53EF",
    params: [
      {
        index: 3,
        name: "collection_id",
        rule: "prefix-variance",
        basis: "inferred",
        observed_values: ["0RZ53EF"],
      },
    ],
    record_ordinals: [3],
  });
  expect(
    shared.tools.find((tool) => tool.path_template.endsWith("/books"))?.name,
  ).toBe("get_collections_books_by_collection_id");
  expect(manifest(["sibling-variance"], routes).tools.map(line)).toEqual([
    "GET /api/v1/collections/0RZ52CD/books",
    "DELETE /api/v1/collections/0RZ53EF",
    "PATCH /api/v1/collections/0RZ53EF",
    "GET /api/v1/collections/layout",
    "POST /api/v1/collections/search",
    "GET /api/v1/collections/{collection_id}",
  ]);
});

it("templates an unobserved literal only when it carries a digit and is spelled like an observed value", () => {
  const projected = manifest(
    ["sibling-variance", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://k.test/api/readlists/0RZ51KSZKA53J"],
      ["GET", "https://k.test/api/readlists/0RZ56NR37AC1T"],
      ["PATCH", "https://k.test/api/readlists/0RZ576R5KA57B", null, "{}"],
      ["PUT", "https://k.test/api/readlists/0rz576r5ka57b", null, "{}"],
      ["DELETE", "https://k.test/api/readlists/ABCDEFGHIJ", null],
      ["POST", "https://k.test/api/readlists/Metrics::12", null, "{}"],
      ["GET", "https://k.test/api/items/a1"],
      ["GET", "https://k.test/api/items/b2"],
      ["PUT", "https://k.test/api/items/v2", null, "{}"],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "PUT /api/items/v2",
    "GET /api/items/{item_id}",
    "PUT /api/readlists/0rz576r5ka57b",
    "DELETE /api/readlists/ABCDEFGHIJ",
    "POST /api/readlists/Metrics::12",
    "GET /api/readlists/{readlist_id}",
    "PATCH /api/readlists/{readlist_id}",
  ]);
});

it("merges tools whose routes now match and keeps the parameter a tool templated by its own rule", () => {
  const routes = syntheticCapture([
    ["GET", "https://b.test/api/boards/b-2/cards/c-3"],
    ["GET", "https://b.test/api/boards/b-1"],
    ["GET", "https://b.test/api/boards/b-2"],
    ["GET", "https://b.test/api/boards/b-1/cards/c-1"],
    ["GET", "https://b.test/api/boards/b-1/cards/c-2"],
    ["GET", "https://b.test/api/subjects/red-one"],
    ["GET", "https://b.test/api/subjects/blue-two"],
    ["GET", "https://b.test/api/subjects/green-three"],
    ["GET", "https://b.test/api/subjects/red-one/versions/1"],
    ["GET", "https://b.test/api/subjects/blue-two/versions/2"],
  ]);
  const projected = manifest(["sibling-variance", "prefix-variance"], routes);
  expect(projected.tools.map(line)).toEqual([
    "GET /api/boards/{board_id}",
    "GET /api/boards/{board_id}/cards/{card_id}",
    "GET /api/subjects/{subject_id}",
    "GET /api/subjects/{subject_id}/versions/{numeric}",
  ]);
  const params = (template: string) =>
    projected.tools
      .find((tool) => tool.path_template === template)
      ?.params.map((param) => [param.name, param.rule, param.observed_values]);
  expect(params("/api/boards/{board_id}/cards/{card_id}")).toEqual([
    ["board_id", "prefix-variance", ["b-1", "b-2"]],
    ["card_id", "sibling-variance", ["c-1", "c-2", "c-3"]],
  ]);
  expect(params("/api/subjects/{subject_id}/versions/{numeric}")).toEqual([
    ["subject_id", "prefix-variance", ["blue-two", "red-one"]],
    ["id", "numeric", ["1", "2"]],
  ]);
  expect(manifest(["sibling-variance"], routes).tools.map(line)).toEqual([
    "GET /api/boards/b-1/cards/{card_id}",
    "GET /api/boards/b-2/cards/c-3",
    "GET /api/boards/{board_id}",
    "GET /api/subjects/blue-two/versions/{numeric}",
    "GET /api/subjects/red-one/versions/{numeric}",
    "GET /api/subjects/{subject_id}",
  ]);
});

it("shares no format-rule position and compares no route beyond the segment limit", () => {
  const tail = Array.from(
    { length: 36 },
    (_, index) => `s${String(index)}`,
  ).join("/");
  const projected = manifest(
    ["sibling-variance", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://t.test/api/teams/1"],
      ["GET", "https://t.test/api/teams/2"],
      ["PATCH", "https://t.test/api/teams/t3", null, "{}"],
      ["GET", "https://t.test/api/items/a1"],
      ["GET", "https://t.test/api/items/b2"],
      ["GET", `https://t.test/api/items/b2/${tail}`],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    `GET /api/items/b2/${tail}`,
    "GET /api/items/{item_id}",
    "PATCH /api/teams/t3",
    "GET /api/teams/{numeric}",
  ]);
  expect(projected.limitations).toContain(
    "Routes with more than 32 segments are not compared by prefix-variance; they keep their grouped templates.",
  );
});

it("shares both halves of a templated pair and keeps each half's name", () => {
  const projected = manifest(
    ["sibling-pair-variance", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://g.test/api/repos/lighthouse-rota/lamp-log/issues"],
      ["GET", "https://g.test/api/repos/granite-ledger/ledger-core/issues"],
      ["GET", "https://g.test/api/repos/blue-heron/recipe-book/issues"],
      [
        "POST",
        "https://g.test/api/repos/granite-ledger/ledger-core/issues",
        null,
        "{}",
      ],
      ["DELETE", "https://g.test/api/repos/blue-heron/recipe-book", null],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "DELETE /api/repos/{repo_namespace}/{repo_name}",
    "GET /api/repos/{repo_namespace}/{repo_name}/issues",
    "POST /api/repos/{repo_namespace}/{repo_name}/issues",
  ]);
  expect(
    projected.tools[0]?.params.map((param) => [param.name, param.rule]),
  ).toEqual([
    ["repo_namespace", "prefix-variance"],
    ["repo_name", "prefix-variance"],
  ]);
});

it("templates a digit-free literal only as a member of a fixed-length identifier family", () => {
  const projected = manifest(
    ["sibling-variance", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://n.test/api/workflows/yDr9n16753TZr7Zc"],
      ["GET", "https://n.test/api/workflows/5LPA94ML1gYbgAQx"],
      ["PATCH", "https://n.test/api/workflows/FkMwxmXNGaGVsXFG", null, "{}"],
      ["DELETE", "https://n.test/api/workflows/listForAccounts", null],
      ["PUT", "https://n.test/api/workflows/fkmw-xmxn-gagv-x", null, "{}"],
      ["GET", "https://n.test/api/tags/a1"],
      ["GET", "https://n.test/api/tags/b22"],
      ["DELETE", "https://n.test/api/tags/cc", null],
      ["GET", "https://n.test/api/labels/ab12cd34"],
      ["GET", "https://n.test/api/labels/ef56gh78"],
      ["DELETE", "https://n.test/api/labels/abcdefgh", null],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "DELETE /api/labels/{label_id}",
    "GET /api/labels/{label_id}",
    "DELETE /api/tags/cc",
    "GET /api/tags/{tag_id}",
    "PUT /api/workflows/fkmw-xmxn-gagv-x",
    "DELETE /api/workflows/listForAccounts",
    "GET /api/workflows/{workflow_id}",
    "PATCH /api/workflows/{workflow_id}",
  ]);
});

it("shares a literal with the parameter that observed it when parameters of different rules share a position", () => {
  const projected = manifest(
    ["opaque-token", "sibling-variance", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://i.test/api/items/aaaa12bb34cc/details"],
      ["GET", "https://i.test/api/items/a1"],
      ["GET", "https://i.test/api/items/b2"],
      ["PATCH", "https://i.test/api/items/b2", null, "{}"],
    ]),
  );
  // The token parameter is earlier, but only the sibling parameter observed b2.
  expect(projected.tools.map(line)).toEqual([
    "GET /api/items/{item_id}",
    "PATCH /api/items/{item_id}",
    "GET /api/items/{uid}/details",
  ]);
  expect(
    projected.tools.map((tool) =>
      tool.params.map((param) => [param.name, param.rule]),
    ),
  ).toEqual([
    [["item_id", "sibling-variance"]],
    [["item_id", "prefix-variance"]],
    [["uid", "opaque-token"]],
  ]);
});

it("templates a digit-free literal in a fixed-length family that one opt-in parameter observed once", () => {
  const projected = manifest(
    ["opaque-token", "prefix-variance"],
    syntheticCapture([
      ["GET", "https://w.test/api/workflows/ydr9n16753tzr7zc"],
      ["PATCH", "https://w.test/api/workflows/fkmwxmxngagvsxfg", null, "{}"],
      ["DELETE", "https://w.test/api/workflows/notifications", null],
    ]),
  );
  expect(projected.tools.map(line)).toEqual([
    "DELETE /api/workflows/notifications",
    "GET /api/workflows/{uid}",
    "PATCH /api/workflows/{uid}",
  ]);
});
