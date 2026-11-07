import {
  projectAnalysisView,
  analysisViewRequestSchema,
} from "./analysisView/analysisView.js";
import { describe, expect, it } from "vitest";
import { createWebPageInspection } from "../../tests/support/browser/webPageInspection.js";

import { analyzeJavaScriptStaticSource } from "./javascript/javascriptStaticAnalysis.js";
import { analyzeCapturedWebScript } from "./webBundleAnalyzer.js";
import { analyzeWebBundleFixture } from "../../tests/support/browser/analyzeWebBundleFixture.js";
import { buildCapturedWebBundleAnalysis } from "./webBundleAnalyzerResult.js";
import { webBundleAnalysisSchema } from "./webBundleAnalysis.js";
import { isIncludedScript } from "./webBundleAnalyzerState.js";
import { webBundleScriptAnalysisSchema } from "./webBundleScriptAnalysis.js";
import { createWebTextArtifact } from "./webContentArtifact.js";

const origin = "https://app.example.test";

it("shares runtime module declarations with source analysis while retaining inline type side effects", () => {
  const source = `
    import type {T} from "./erased-import";
    export type {T} from "./erased-export";
    export type * from "./erased-all";
    import {type X} from "./inline-import";
    export {type Y} from "./inline-export";
    import "";
    export * from "./runtime";
    export const local = 1;
  `;
  const expected = ["./inline-import", "./inline-export", "", "./runtime"];
  const result = analyzeWebBundleFixture(inspection(source));
  expect(result.completeness.parse_failures).toBe(0);
  expect(
    result.observations.chunks.edges.map(({ specifier }) => specifier),
  ).toEqual(expected);
  expect(
    analyzeJavaScriptStaticSource(source)
      .references.filter(({ kind }) => kind === "static-import")
      .map(({ specifier }) => specifier),
  ).toEqual(expected);
});

it("retains standalone GraphQL Source operations in captured scripts", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
    const source = {
      body: "query GetUser { user { id } }",
      locationOffset: { line: 1, column: 1 },
    };
  `),
  );
  expect(result.observations.endpoints).toEqual([
    expect.objectContaining({ value: "GetUser", mechanism: "graphql:query" }),
  ]);
});

it.each([
  {
    kind: "recovered",
    source: "function legacy(a, a) { return a; } fetch('/partial');",
    parsed: 2,
    failures: 0,
    reason: "recovered",
    endpoints: ["/partial", "/complete"],
  },
  {
    kind: "failed",
    source: "function broken( {",
    parsed: 1,
    failures: 1,
    reason: "could not be parsed",
    endpoints: ["/complete"],
  },
])(
  "attributes $kind parse uncertainty only to its affected source",
  ({ source, parsed, failures, reason, endpoints }) => {
    const captured = inspection(source);
    const good = inspection("fetch('/complete');").scripts.items[0];
    if (good === undefined) throw new Error("Missing valid script fixture");
    captured.scripts.items.push({ ...good, script_key: "valid-script" });
    captured.scripts.total += 1;
    const result = analyzeWebBundleFixture(captured);
    expect(result.completeness).toMatchObject({
      status: "partial",
      parsed_scripts: parsed,
      parse_failures: failures,
    });
    expect(result.unknowns).toContainEqual({
      dimension: "javascript_ast",
      reason: expect.stringContaining(reason),
      affected_script_keys: [captured.scripts.items[0]?.script_key],
    });
    expect(result.observations.endpoints.map(({ value }) => value)).toEqual(
      endpoints,
    );
  },
);

it.each([
  [
    "const records = new Map(); const alias = records; alias.get('/accounts');",
    false,
  ],
  ["new Map().delete('/accounts');", false],
  [
    "const records = new Map(); records.get('/accounts'); records.delete('/accounts');",
    false,
  ],
  [
    "const records = new Map(); records.get = fetch; records.get('/accounts');",
    true,
  ],
  [
    "Object.getPrototypeOf = () => Map.prototype; Object.getPrototypeOf({}).get = fetch; new Map().get('/accounts');",
    true,
  ],
  ["client.get('/accounts');", true],
  ["eval('Map.prototype.get = fetch'); new Map().get('/accounts');", true],
] as const)(
  "shares Map receiver certainty with application analysis: %s",
  (source, candidate) => {
    const input = source + " fetch('/network');";
    const result = analyzeWebBundleFixture(inspection(input));
    expect(result.observations.endpoints.map(({ value }) => value)).toEqual([
      "/network",
    ]);
    expect(
      result.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value),
    ).toEqual(candidate ? ["/accounts"] : []);
    const staticResult = analyzeJavaScriptStaticSource(input);
    expect(
      staticResult.endpoints
        .map(({ value, interpretation }) => [value, interpretation ?? null])
        .sort(),
    ).toEqual(
      candidate
        ? [
            ["/accounts", "candidate"],
            ["/network", null],
          ]
        : [["/network", null]],
    );
  },
);

it("discloses widened returned-reference effects only for the affected script", () => {
  const captured = inspection(`
    function expose() { return Map.prototype; }
    let cursor = { target: expose };
    function walk(flag) {
      while (flag) cursor = cursor.next;
      patch(cursor.target());
    }
    new Map().get('/candidate');
    fetch('/preserved');
  `);
  const independent = inspection(
    "new Map().get('/intrinsic'); fetch('/independent');",
  ).scripts.items[0];
  if (independent === undefined) throw new Error("Missing independent script");
  captured.scripts.items.push({ ...independent, script_key: "independent" });
  captured.scripts.total += 1;
  const result = analyzeWebBundleFixture(captured);
  expect(result.completeness).toMatchObject({
    status: "partial",
    parsed_scripts: 2,
    parse_failures: 0,
  });
  expect(result.unknowns).toContainEqual({
    dimension: "javascript_ast",
    reason: expect.stringContaining("returned-reference projections"),
    affected_script_keys: [captured.scripts.items[0]?.script_key],
  });
  expect(result.observations.endpoints.map(({ value }) => value)).toEqual([
    "/preserved",
    "/independent",
  ]);
  expect(
    result.inferences
      .filter(({ kind }) => kind === "endpoint_candidate")
      .map(({ value }) => value),
  ).toEqual(["/candidate"]);
});

it.each([
  {
    label: "inline declaration and schema spreads",
    source: `document.modelContext.registerTool({
      ...{
        name: "spread-tool",
        description: "Copied from a literal",
        inputSchema: {
          ...{
            type: "object",
            properties: { query: { type: "string" } }
          }
        }
      }
    });`,
    name: "spread-tool",
    description: "Copied from a literal",
    properties: ["query"],
    coverage: "complete",
  },
  {
    label: "unrelated trailing literal spread",
    source: `document.modelContext.registerTool({
      name: "direct-tool",
      description: "Explicit metadata",
      inputSchema: { properties: { query: { type: "string" } } },
      ...{ timeout: 5 }
    });`,
    name: "direct-tool",
    description: "Explicit metadata",
    properties: ["query"],
    coverage: "complete",
  },
  {
    label: "null spread after explicit metadata",
    source: `document.modelContext.registerTool({
      name: "null-safe-tool",
      description: "Null spread is inert",
      inputSchema: { properties: { query: { type: "string" } } },
      ...null
    });`,
    name: "null-safe-tool",
    description: "Null spread is inert",
    properties: ["query"],
    coverage: "complete",
  },
  {
    label: "snake-case schema property from a spread",
    source: `document.modelContext.registerTool({
      ...{
        name: "snake-tool",
        description: "Snake-case schema",
        input_schema: { properties: { item_id: { type: "string" } } }
      }
    });`,
    name: "snake-tool",
    description: "Snake-case schema",
    properties: ["item_id"],
    coverage: "complete",
  },
])(
  "preserves WebMCP facts through $label",
  ({ source, name, description, properties, coverage }) => {
    const result = analyzeWebBundleFixture(inspection(source));

    expect(result.observations.webmcp_declarations).toEqual([
      expect.objectContaining({
        name,
        description,
        schema_property_names: properties,
        schema_property_names_coverage: coverage,
        trust: "page-declared-untrusted",
      }),
    ]);
    expect(result.completeness.status).toBe("complete");
  },
);

it.each([
  {
    label: "unknown spread after explicit facts",
    source: `document.modelContext.registerTool({
      name: "possibly-overridden",
      description: "Possibly overridden",
      inputSchema: { properties: { query: { type: "string" } } },
      ...dynamicOptions
    });`,
    name: null,
    description: null,
    properties: [],
    coverage: "unknown",
  },
  {
    label: "explicit facts after an unknown spread",
    source: `document.modelContext.registerTool({
      ...dynamicOptions,
      name: "known-after-spread",
      description: "Explicitly restored",
      inputSchema: { properties: { query: { type: "string" } } }
    });`,
    name: "known-after-spread",
    description: "Explicitly restored",
    properties: ["query"],
    coverage: "complete",
  },
])(
  "preserves rightmost uncertainty for $label",
  ({ source, name, description, properties, coverage }) => {
    const result = analyzeWebBundleFixture(inspection(source));

    expect(result.observations.webmcp_declarations).toEqual([
      expect.objectContaining({
        name,
        description,
        schema_property_names: properties,
        schema_property_names_coverage: coverage,
        trust: "page-declared-untrusted",
      }),
    ]);
    expect(result.completeness.status).toBe("complete");
  },
);

it.each([
  {
    label: "an unknown camel-case schema override",
    source: `document.modelContext.registerTool({
      ...dynamicOptions,
      inputSchema: { properties: { camel: {} } },
      ...anotherDynamicOptions,
      input_schema: { properties: { snake: {} } },
      name: "tool",
      description: "Explicit metadata"
    });`,
    name: "tool",
    properties: [],
    coverage: "unknown",
  },
  {
    label: "an explicit null camel-case schema",
    source: `document.modelContext.registerTool({
      name: "null-alias",
      description: "Fallback applies",
      inputSchema: null,
      input_schema: { properties: { snake: {} } }
    });`,
    name: "null-alias",
    properties: ["snake"],
    coverage: "complete",
  },
  {
    label: "literal property spreads",
    source: `document.modelContext.registerTool({
      name: "spread-properties",
      inputSchema: { properties: { ...{ query: {} }, direct: {} } }
    });`,
    name: "spread-properties",
    properties: ["direct", "query"],
    coverage: "complete",
  },
  {
    label: "prototype setters are not schema properties",
    source: `document.modelContext.registerTool({
      name: "prototype-properties",
      inputSchema: { properties: { __proto__: { hidden: {} }, direct: {}, ["__proto__"]: {} } }
    });`,
    name: "prototype-properties",
    properties: ["__proto__", "direct"],
    coverage: "complete",
  },
  {
    label: "own schema properties before a prototype setter",
    source: `document.modelContext.registerTool({
      name: "own-before-prototype",
      inputSchema: { properties: { known: {} }, __proto__: { properties: { inherited: {} } } }
    });`,
    name: "own-before-prototype",
    properties: ["known"],
    coverage: "complete",
  },
  {
    label: "own schema properties after a prototype setter",
    source: `document.modelContext.registerTool({
      name: "own-after-prototype",
      inputSchema: { __proto__: { properties: { inherited: {} } }, properties: { known: {} } }
    });`,
    name: "own-after-prototype",
    properties: ["known"],
    coverage: "complete",
  },
  {
    label: "an unresolved property spread",
    source: `document.modelContext.registerTool({
      name: "unknown-properties",
      inputSchema: { properties: { ...dynamicProperties, direct: {} } }
    });`,
    name: "unknown-properties",
    properties: ["direct"],
    coverage: "partial",
  },
  {
    label: "an unresolved computed property key",
    source: `document.modelContext.registerTool({
      name: "computed-properties",
      inputSchema: { properties: { [propertyName]: {}, direct: {} } }
    });`,
    name: "computed-properties",
    properties: ["direct"],
    coverage: "partial",
  },
])(
  "preserves WebMCP schema ownership for $label",
  ({ source, name, properties, coverage }) => {
    const result = analyzeWebBundleFixture(inspection(source));

    expect(result.observations.webmcp_declarations).toEqual([
      expect.objectContaining({
        name,
        schema_property_names: properties,
        schema_property_names_coverage: coverage,
        trust: "page-declared-untrusted",
      }),
    ]);
  },
);

describe("web bundle analyzer", () => {
  it("extracts graph, route, endpoint, vendor, and WebMCP evidence", () => {
    const source = `
      import { createApp } from "./chunk.js?token=secret";
      const lazy = import("./lazy.js");
      const routes = [{ path: "/users/:id?token=secret" }];
      fetch("/api/users?authorization=secret");
      document.modelContext.registerTool({
        name: "lookup-user",
        description: "Untrusted page declaration",
        inputSchema: {
          type: "object",
          properties: {
            userId: { type: "string" },
            verbose: { type: "boolean" }
          }
        }
      });
      const __webpack_require__ = () => createApp(routes, lazy);
    `;
    const result = analyzeWebBundleFixture(inspection(source));

    expect(result.observations.chunks.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "static_import",
          specifier: "./chunk.js?token=secret",
          resolved_url: `${origin}/assets/chunk.js?token=secret`,
        }),
        expect.objectContaining({
          kind: "dynamic_import",
          specifier: "./lazy.js",
        }),
      ]),
    );
    expect(result.observations.routes).toEqual([
      expect.objectContaining({ value: "/users/:id?token=secret" }),
    ]);
    expect(result.observations.endpoints).toEqual([
      expect.objectContaining({
        value: "/api/users?authorization=secret",
      }),
    ]);
    expect(result.observations.webmcp_declarations).toEqual([
      expect.objectContaining({
        name: "lookup-user",
        trust: "page-declared-untrusted",
        schema_property_names: ["userId", "verbose"],
        schema_property_names_coverage: "complete",
      }),
    ]);
    expect(result.inferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "webpack", confidence: "high" }),
        expect.objectContaining({ value: "Vue" }),
      ]),
    );
    expect(result.completeness.status).toBe("complete");
  });

  it("reports parser gaps without imposing a finding cap", () => {
    const malformed = inspection("function broken( {");
    const failed = analyzeWebBundleFixture(malformed);
    expect(failed.completeness).toMatchObject({
      status: "partial",
      parse_failures: 1,
    });
    expect(failed.unknowns[0]?.dimension).toBe("javascript_ast");

    const analyzed = analyzeWebBundleFixture(
      inspection("fetch('/one'); fetch('/two'); fetch('/three');"),
    );
    expect(analyzed.observations.endpoints).toHaveLength(3);
    expect(analyzed.completeness.status).toBe("complete");
  });

  it("analyzes AST nodes after the former fixed node ceiling", () => {
    const source = `${";".repeat(250_001)}fetch('/last');`;
    const result = analyzeWebBundleFixture(inspection(source));

    expect(result.observations.endpoints).toContainEqual(
      expect.objectContaining({ value: "/last" }),
    );
    expect(result.completeness.visited_ast_nodes).toBeGreaterThan(250_000);
    expect(result.completeness.status).toBe("complete");
  });

  it("retains complete long chunk and WebMCP declaration text", () => {
    const specifier = `./${"chunk".repeat(1_000)}.js`;
    const name = "tool".repeat(100);
    const description = "untrusted declaration ".repeat(150);
    const propertyName = "property".repeat(100);
    const result = analyzeWebBundleFixture(
      inspection(`
        import "${specifier}";
        document.modelContext.registerTool({
          name: "${name}",
          description: "${description}",
          inputSchema: { properties: { "${propertyName}": { type: "string" } } }
        });
      `),
    );

    expect(result.observations.chunks.edges[0]?.specifier).toBe(specifier);
    expect(result.observations.webmcp_declarations[0]).toMatchObject({
      name,
      description,
      schema_property_names: [propertyName],
      schema_property_names_coverage: "complete",
      trust: "page-declared-untrusted",
    });
  });
});

describe("web bundle source-map coverage", () => {
  it("reports unavailable source maps as partial without dropping requested maps", () => {
    const analysis = analyzeWebBundleFixture(inspection("export {};"), {
      status: "unavailable",
      requested: 1,
      processed: 1,
      items: [
        {
          script_key: `scr_${"1".repeat(64)}`,
          declared_url: "https://app.example.test/app.js.map",
          effective_url: null,
          status: "fetch_failed",
          artifact: null,
          original_sources: [],
          original_module_edges: [],
          mappings: [],
          limitation: "Source-map fetch failed.",
        },
      ],
    });

    expect(analysis.completeness.status).toBe("partial");
    expect(analysis.unknowns).toContainEqual({
      dimension: "source_maps",
      reason:
        "One or more requested source maps were unavailable or incomplete",
      affected_script_keys: [`scr_${"1".repeat(64)}`],
    });
  });

  it("keeps map-less captured source complete when no maps were requested", () => {
    const analysis = analyzeWebBundleFixture(inspection("export {};"), {
      status: "not_requested",
      requested: 0,
      processed: 0,
      items: [],
    });

    expect(analysis.completeness.status).toBe("complete");
    expect(analysis.unknowns).toEqual([]);
  });

  it("rejects inconsistent source-map coverage counts", () => {
    const result = analyzeWebBundleFixture(inspection("export {};"));
    expect(
      webBundleAnalysisSchema.safeParse({
        ...result,
        observations: {
          ...result.observations,
          source_maps: {
            ...result.observations.source_maps,
            requested: 1,
          },
        },
      }).success,
    ).toBe(false);
  });
});

describe("web bundle static-analysis parity", () => {
  it("qualifies network spellings through nested dynamic receivers", () => {
    const result = analyzeWebBundleFixture(
      inspection('window[recv].fetch("/nested-fetch");'),
    );
    expect(result.observations.endpoints).toEqual([]);
    expect(result.inferences).toContainEqual(
      expect.objectContaining({
        kind: "endpoint_candidate",
        value: "/nested-fetch",
        confidence: "low",
      }),
    );
  });

  it("reads open endpoints only from XMLHttpRequest method and URL pairs", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
        xhr.open("GET", "/xhr-get");
        xhr.open("post", "https://xhr.example.test/submit");
        dav.open("PROPFIND", "/dav/");
        fs.open("/tmp/data.txt", "r", done);
        window.open("https://help.example.test/", "_blank");
        xhr.open(method, "/dynamic-method");
        fs.open(path, "r", done);
        window.open(url, "_blank");
        window.open(url, "/preview");
        globalThis.open(url, "./frame");
        document.open("text/html", "/replace");
        parent.open("GET", "/parent-xhr");
        self.open("post", "/self-xhr");
        top.open("GET", "/top-target");
        opener.open("GET", "/opener-target");
        frames.open("GET", "/frames-target");
        globalThis.open("GET", "/global-target");
        document.open("GET", "/document-target");
        const parentWindow = parent;
        parentWindow.open("GET", "/alias-target");
        {
          const parent = new XMLHttpRequest();
          parent.open(method, "/shadowed-parent-xhr");
        }
        xhr.open(method, "api/relative");
        fs.open(path, "w+", done);
        popup.open(url, "_TOP");
      `),
    );
    expect(
      result.observations.endpoints.map(({ value }) => value).sort(),
    ).toEqual(["/shadowed-parent-xhr"]);
    expect(
      result.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual([
      "/dav/",
      "/dynamic-method",
      "/xhr-get",
      "api/relative",
      "https://xhr.example.test/submit",
    ]);
    expect(result.inferences).toContainEqual(
      expect.objectContaining({
        kind: "endpoint_candidate",
        value: "api/relative",
        confidence: "low",
      }),
    );
  });
});

describe("web bundle API classification parity", () => {
  it("reads storage open versions as storage rather than endpoints in both analyzers", () => {
    const source = `
      indexedDB.open(databaseName, "2");
      window.indexedDB.open(databaseName, "/v3");
      indexedDB.open("APP", "4");
      indexedDB.open("GET", "/storage-named-xhr");
    `;
    expect(
      analyzeWebBundleFixture(inspection(source))
        .inferences.filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value),
    ).toEqual(["/storage-named-xhr"]);
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.endpoints.map(({ value }) => value)).toEqual([
      "/storage-named-xhr",
    ]);
    expect(analysis.storage.map(({ kind }) => kind)).toEqual([
      "indexed-db",
      "indexed-db",
      "indexed-db",
      "indexed-db",
    ]);
  });

  it("uses lexical receiver facts for overloaded open calls", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
        const popup = window;
        popup.open(url, "/preview");
        {
          const indexedDB = { open() {} };
          indexedDB.open("PROPFIND", "/dav");
          indexedDB.open(databaseName, "2");
        }
        const xhr = new XMLHttpRequest();
        xhr.open(method, "/api");
      `),
    );
    expect(
      result.observations.endpoints.map(({ value }) => value).sort(),
    ).toEqual(["/api"]);
  });

  it("classifies optional and one-hop aliased open calls", () => {
    const source = `
      const popup = window;
      popup?.open(url, "/preview");
      const idb = indexedDB;
      idb.open(databaseName, "2");
      const xhr = new XMLHttpRequest();
      xhr?.open(method, "/api");
    `;
    const bundle = analyzeWebBundleFixture(inspection(source));
    expect(bundle.observations.endpoints.map(({ value }) => value)).toEqual([
      "/api",
    ]);
    const staticAnalysis = analyzeJavaScriptStaticSource(source);
    expect(staticAnalysis.endpoints.map(({ value }) => value)).toEqual([
      "/api",
    ]);
    expect(staticAnalysis.storage.map(({ kind }) => kind)).toEqual([
      "indexed-db",
    ]);
  });

  it("keeps HTTP-method-named reads of provable keyed collections out of endpoints", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
        axios.get("https://api.example.test/users");
        api.get("users");
        client.delete("cache-key");
        new Map().get("map-key");
        new URLSearchParams(location.search).get("q");
        new Headers(init).delete("x-trace");
        new FormData(form).get("file");
        response.headers.get("content-type");
        request?.headers.delete("cookie");
        new URL(location.href).searchParams.get("page");
        api.headers.post("/v1/headers");
        api.searchParams.request("/search");
        new Headers().get("/users");
        api.headers.get("https://api.example.test/headers");
        api.searchParams.delete("../search");
      `),
    );
    expect(
      result.observations.endpoints.map(({ value }) => value).sort(),
    ).toEqual([]);
    expect(
      result.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual([
      "../search",
      "/search",
      "/users",
      "/v1/headers",
      "cache-key",
      "https://api.example.test/headers",
      "https://api.example.test/users",
      "users",
    ]);
  });

  it("keeps undici header-store reads out of endpoint observations", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
        response.headersList.get("location", true);
        request.headersList.delete("authorization");
        request.headersList.get("/header-list");
        api.get("/api/users");
      `),
    );
    expect(result.observations.endpoints).toEqual([]);
    expect(
      result.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value),
    ).toEqual(["/header-list", "/api/users"]);
  });
});

describe("web bundle explicit request reference forms", () => {
  it("recognizes URL, path, query and fragment forms after excluding lookup receivers", () => {
    const references = [
      "http://api.example.test/users",
      "https://api.example.test/users?q=1#part",
      "ws://api.example.test/events",
      "wss://api.example.test/events",
      "http:api.example.test/users",
      "https:api.example.test/users?q=1&tag=a&tag=b#part",
      "https:api.example.test:443/a/../b?x=a+b&x=two#part",
      "ws:api.example.test/events",
      "wss:api.example.test/events",
      "HtTpS:/api.example.test/users",
      String.raw`https:\api.example.test\users`,
      "https://[invalid",
      "//api.example.test/users",
      "/api/users",
      "./users",
      "../users",
      "?",
      "?page=2&tag=a&tag=b#section",
      "#",
      "#section",
      "#frag?tag=a&tag=b",
    ];
    const ambiguous = [
      "",
      ".",
      "..",
      "users",
      "%23section",
      "%3Fpage=2",
      " #section",
      " https:api.example.test/users",
      "https:",
      "http:?page=2",
      "ws:#section",
      "https:[invalid",
      "https:api.example.test:99999",
      "ftp:api.example.test/users",
      "file:/users",
      "data:text/plain,users",
    ];
    const source = `
      ${references.map((value) => `api.get(${JSON.stringify(value)});`).join("\n")}
      ${ambiguous.map((value) => `api.get(${JSON.stringify(value)});`).join("\n")}
      xhr.open(method, "?view=1");
      xhr.open(method, "#view=1");
      xhr.open("GET", "#literal=1");
      xhr.open(method, "https:api.example.test/xhr");
      request("POST", target);
      snackBar.open(message, "X");
      new Map().get("?map-key");
      new Map().get("#map-key");
      new Map().get("https:api.example.test/map-key");
      new Headers().delete("?header-key");
      new Headers().delete("#header-key");
      new URLSearchParams().get("?parameter-key");
      new URLSearchParams().get("#parameter-key");
      response.headers.get("?response-key");
      response.headers.get("#response-key");
      const config = vscode.workspace.getConfiguration("git");
      config.get("?setting");
      config.get("#setting");
      config.get("https:api.example.test/setting");
      window.open(url, "?window-target");
      window.open(url, "#window-target");
      indexedDB.open(name, "?database-version");
      indexedDB.open(name, "#database-version");
      caches.open(name, "#cache-name");
      fs.open(path, "r");
    `;
    const expected: string[] = [];
    const expectedCandidates = [
      "?view=1",
      "#view=1",
      "#literal=1",
      "https:api.example.test/xhr",
      ...references,
      ...ambiguous,
      "POST",
      "X",
    ].sort();
    const web = analyzeWebBundleFixture(inspection(source));
    expect(web.observations.endpoints.map(({ value }) => value).sort()).toEqual(
      expected,
    );
    expect(
      web.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual(expectedCandidates);
    const analyzed = analyzeJavaScriptStaticSource(source);
    expect(
      analyzed.endpoints
        .filter(({ interpretation }) => interpretation === undefined)
        .map(({ value }) => value)
        .sort(),
    ).toEqual(expected);
    expect(
      analyzed.endpoints
        .filter(({ interpretation }) => interpretation === "candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual(expectedCandidates);
  });
});

describe("web bundle endpoint candidate classification", () => {
  it("keeps ambiguous HTTP-method arguments as candidates instead of endpoint observations", () => {
    const source = `
      fetch("login");
      api.get("/api/users");
      api.get("users");
      form.get("passwordControl");
      translate.get("ADDRESS_ADDED");
      cookieService.put("token", value);
      http.request("POST", target);
      snackBar.open(message, "X");
      xhr.open(method, "login");
      xhr.open("GET", "ping");
    `;
    const result = analyzeWebBundleFixture(inspection(source));
    expect(
      result.observations.endpoints.map(({ value }) => value).sort(),
    ).toEqual(["login"]);
    const candidates = result.inferences.filter(
      ({ kind }) => kind === "endpoint_candidate",
    );
    expect(candidates.map(({ value }) => value).sort()).toEqual([
      "/api/users",
      "ADDRESS_ADDED",
      "POST",
      "X",
      "login",
      "passwordControl",
      "ping",
      "token",
      "users",
    ]);
    expect(
      candidates.every(
        ({ confidence, basis }) =>
          confidence === "low" &&
          basis.length === 1 &&
          basis[0]?.artifact_sha256 ===
            createWebTextArtifact(source, "text/javascript").sha256 &&
          basis[0]?.line !== null &&
          basis[0]?.detector.startsWith("call:"),
      ),
    ).toBe(true);
    const staticEndpoints = analyzeJavaScriptStaticSource(source).endpoints;
    expect(
      staticEndpoints
        .filter(({ interpretation }) => interpretation === "candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual(candidates.map(({ value }) => value).sort());
    expect(
      staticEndpoints
        .filter(({ interpretation }) => interpretation === undefined)
        .map(({ value }) => value)
        .sort(),
    ).toEqual(result.observations.endpoints.map(({ value }) => value).sort());
    expect(webBundleAnalysisSchema.parse(result)).toEqual(result);
  });

  it("deduplicates repeated candidate sites while keeping script, value and detector identity", () => {
    const source = `${'form.get("name");\n'.repeat(5_000)}translate.get("name");\nform.get("other");`;
    const captured = inspection(source);
    const first = captured.scripts.items[0];
    if (first === undefined) throw new Error("Missing captured script fixture");
    const secondKey = `scr_${"2".repeat(64)}`;
    const result = analyzeWebBundleFixture({
      ...captured,
      scripts: {
        total: 2,
        items: [
          first,
          {
            ...first,
            script_key: secondKey,
            url: `${origin}/assets/second.js`,
          },
        ],
      },
    });
    const candidates = result.inferences.filter(
      ({ kind }) => kind === "endpoint_candidate",
    );
    expect(candidates).toHaveLength(6);
    for (const scriptKey of [first.script_key, secondKey]) {
      const local = candidates.filter(
        ({ basis }) => basis[0]?.script_key === scriptKey,
      );
      expect(
        local.map(({ value, basis }) => [value, basis[0]?.detector]),
      ).toEqual([
        ["name", "call:form.get:unverified-network-receiver"],
        ["name", "call:translate.get:unverified-network-receiver"],
        ["other", "call:form.get:unverified-network-receiver"],
      ]);
      expect(local[0]?.basis[0]).toMatchObject({
        line: 1,
        column: 0,
        artifact_sha256: createWebTextArtifact(source, "text/javascript")
          .sha256,
      });
    }
    expect(result.observations.endpoints).toEqual([]);
    expect(result.capture.source_artifacts).toHaveLength(2);
    expect(result.completeness).toMatchObject({
      status: "complete",
      parsed_scripts: 2,
    });
    expect(result.limitations).toContain(
      'Endpoint candidates are deduplicated by script, value and detector; basis retains only the first matching source coordinate. They are not a complete call-site inventory or a runtime occurrence count. completeness.status="complete" describes examination of captured source, not a call-site census.',
    );
  });
});

describe("web bundle configuration and navigation parity", () => {
  it("keeps configuration setting reads out of endpoints in both analyzers", () => {
    const source = `
      import vscodeDefault from "vscode";
      vscodeDefault.workspace.getConfiguration("git").get("default-setting");
      vscode.workspace.getConfiguration("git").get("autofetch");
      workspace.getConfiguration("git").get("enabled", true);
      const config = vscode.workspace.getConfiguration("git");
      config.get("autofetchPeriod", 180);
      config.get("/v1/settings");
      let c = Mt.workspace.getConfiguration("git", uri), l = c.get("timeline.date");
      let changed = vscode.workspace.getConfiguration("git");
      changed = api;
      changed.get("reassigned");
      const maybe = flag ? vscode.workspace.getConfiguration("git") : api;
      maybe.get("conditional");
      {
        const config = api;
        config.get("shadowed");
      }
      api.get("users");
      const client = getConfiguration("/api/v1");
      client.get("accounts");
      http.getConfiguration(baseUrl).get("orders");
      {
        const workspace = { getConfiguration: () => api };
        workspace.getConfiguration("/api").get("local-users");
      }
      {
        const vscode = { workspace: { getConfiguration: () => api } };
        vscode.workspace.getConfiguration("/api").get("local-orders");
      }
    `;
    const expected = [
      "/v1/settings",
      "accounts",
      "conditional",
      "local-orders",
      "local-users",
      "orders",
      "reassigned",
      "shadowed",
      "users",
    ];
    const web = analyzeWebBundleFixture(inspection(source));
    expect(web.observations.endpoints).toEqual([]);
    expect(
      web.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value)
        .sort(),
    ).toEqual(expected);
    expect(
      analyzeJavaScriptStaticSource(source)
        .endpoints.map(({ value }) => value)
        .sort(),
    ).toEqual(expected);
  });

  it("classifies proven VS Code extension state reads as non-endpoints", () => {
    const reads = `
      context.globalState.get("lastVersion");
      this.workspaceState.get("closedRepositories", []);
      context?.globalState.get("onboarded");
      context.globalState.get("/v1/state");
      context.secrets.get("token");
      api.get("users");
    `;
    const analyze = (source: string) => {
      const web = analyzeWebBundleFixture(inspection(source));
      const staticAnalysis = analyzeJavaScriptStaticSource(source);
      return {
        web: {
          endpoints: web.observations.endpoints
            .map(({ value }) => value)
            .sort(),
          candidates: web.inferences
            .filter(({ kind }) => kind === "endpoint_candidate")
            .map(({ value }) => value)
            .sort(),
        },
        application: {
          endpoints: staticAnalysis.endpoints
            .filter(({ interpretation }) => interpretation === undefined)
            .map(({ value }) => value)
            .sort(),
          candidates: staticAnalysis.endpoints
            .filter(({ interpretation }) => interpretation === "candidate")
            .map(({ value }) => value)
            .sort(),
        },
      };
    };
    const proven = {
      endpoints: [],
      candidates: ["/v1/state", "token", "users"],
    };
    expect(analyze(`const vscode = require("vscode");${reads}`)).toEqual({
      web: proven,
      application: proven,
    });
    expect(analyze(`import * as vscode from "vscode";${reads}`)).toEqual({
      web: proven,
      application: proven,
    });
    const unproven = {
      endpoints: [],
      candidates: [
        "/v1/state",
        "closedRepositories",
        "lastVersion",
        "onboarded",
        "token",
        "users",
      ],
    };
    expect(analyze(`const vscode = require("./vscode");${reads}`)).toEqual({
      web: unproven,
      application: unproven,
    });
  });

  it("keeps loadURL spelling without Electron receiver proof as a candidate", () => {
    const result = analyzeWebBundleFixture(
      inspection('window.win.loadURL("https://embedded.test/app");'),
    );
    expect(result.observations.endpoints).toEqual([]);
    expect(result.inferences).toContainEqual(
      expect.objectContaining({
        kind: "endpoint_candidate",
        value: "https://embedded.test/app",
        confidence: "low",
      }),
    );
  });
});

describe("web bundle artifact metadata", () => {
  it("retains only a validated HTTP target origin", () => {
    expect(
      analyzeWebBundleFixture(inspection("export {};")).capture.target_origin,
    ).toBe(origin);

    const nonHttp = inspection("export {};");
    nonHttp.target.url = "ftp://host/app";
    nonHttp.target.origin = "ftp://host";
    expect(analyzeWebBundleFixture(nonHttp).capture.target_origin).toBeNull();
  });

  it("preserves long provider media types in artifact summaries", () => {
    const result = analyzeWebBundleFixture(inspection("export {};"));
    const mediaType = `application/${"x".repeat(300)}`;
    const artifact = result.capture.source_artifacts[0] ?? {
      sha256: "0".repeat(64),
      bytes: 0,
      media_type: "application/javascript",
      charset: "utf-8" as const,
      text_available: true as const,
    };

    expect(
      webBundleAnalysisSchema.parse({
        ...result,
        capture: {
          ...result.capture,
          source_artifacts: [{ ...artifact, media_type: mediaType }],
        },
      }).capture.source_artifacts[0]?.media_type,
    ).toBe(mediaType);
  });
});

describe("deep captured web bundle syntax", () => {
  it("retains evidence after a parser-admitted deep property chain", () => {
    const source = `const value = root${".next".repeat(12_000)};\nimport "./last.js";\nfetch("/after");`;
    const result = analyzeWebBundleFixture(inspection(source));
    expect(result.completeness).toMatchObject({
      status: "complete",
      parsed_scripts: 1,
      parse_failures: 0,
    });
    expect(result.observations.chunks.edges).toContainEqual(
      expect.objectContaining({
        kind: "static_import",
        specifier: "./last.js",
        resolved_url: `${origin}/assets/last.js`,
        location: expect.objectContaining({ line: 2, column: 0 }),
      }),
    );
    expect(result.observations.endpoints).toContainEqual(
      expect.objectContaining({
        value: "/after",
        location: expect.objectContaining({ line: 3, column: 0 }),
      }),
    );
  });
});

const inspection = (source: string) =>
  createWebPageInspection([
    {
      source,
      scriptKey: `scr_${"1".repeat(64)}`,
      url: `${origin}/assets/app.js`,
      origin,
      cdpHash: "hash",
    },
  ]);

describe("per-script web bundle analysis", () => {
  it("keeps parser failures as analyzed outcomes with their own coverage", () => {
    const captured = inspection("function broken( {");
    const script = captured.scripts.items.find(isIncludedScript);
    if (script === undefined)
      throw new Error("Missing included script fixture");

    expect(analyzeCapturedWebScript(script)).toMatchObject({
      status: "analyzed",
      script_key: script.script_key,
      parse_status: "failed",
      visited_ast_nodes: 0,
      observations: {
        edges: [],
        routes: [],
        endpoints: [],
        webmcp_declarations: [],
      },
    });
  });

  it("merges out-of-order worker outcomes in capture order and preserves exact unavailable keys", () => {
    const firstCapture = inspection("import './first.js'; fetch('/first');");
    const secondCapture = inspection("import './second.js'; fetch('/second');");
    const first = firstCapture.scripts.items.find(isIncludedScript);
    const second = secondCapture.scripts.items.find(isIncludedScript);
    if (first === undefined || second === undefined)
      throw new Error("Missing included script fixtures");
    const captured = firstCapture;
    captured.scripts.items.push({ ...second, script_key: "second-script" });
    captured.scripts.total += 1;

    const result = buildCapturedWebBundleAnalysis(
      captured,
      {
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      },
      [
        {
          status: "unavailable",
          script_key: "second-script",
          reason: "deadline",
          detail: "Worker deadline expired.",
        },
        analyzeCapturedWebScript(first),
      ],
    );

    expect(
      result.observations.chunks.edges.map(({ specifier }) => specifier),
    ).toEqual(["./first.js"]);
    expect(result.observations.endpoints.map(({ value }) => value)).toEqual([
      "/first",
    ]);
    expect(result.unknowns).toContainEqual({
      dimension: "javascript_analysis",
      reason: expect.stringContaining("deadline"),
      affected_script_keys: ["second-script"],
    });
    expect(result.completeness).toMatchObject({
      status: "partial",
      parsed_scripts: 1,
      parse_failures: 0,
    });
  });

  it("does not count explicitly unstarted scripts as submitted and reports source budget omissions", () => {
    const captured = inspection("fetch('/started');");
    const script = captured.scripts.items.find(isIncludedScript);
    if (script === undefined)
      throw new Error("Missing included script fixture");
    const later = { ...script, script_key: "not-started-script" };
    captured.scripts.items.push(later);
    captured.scripts.total += 1;
    captured.completeness.excluded.push({
      section: "script_sources",
      reason: "resource_budget_exhausted",
      count: 2,
    });

    const result = buildCapturedWebBundleAnalysis(
      captured,
      {
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      },
      [
        analyzeCapturedWebScript(script),
        {
          status: "unavailable",
          script_key: "not-started-script",
          reason: "not_started",
        },
      ],
    );

    expect(result.capture.scripts_analyzed).toBe(1);
    expect(result.completeness.status).toBe("partial");
    expect(result.unknowns).toContainEqual({
      dimension: "script_source",
      reason: expect.stringContaining("omitted 2 script source artifacts"),
      affected_script_keys: [],
    });
    expect(result.unknowns).toContainEqual({
      dimension: "javascript_analysis",
      reason: expect.stringContaining("not_started"),
      affected_script_keys: ["not-started-script"],
    });
  });
});

describe("unavailable web bundle analysis outcomes", () => {
  it("preserves distinct unavailable reasons and details with their exact script keys", () => {
    const captured = inspection("fetch('/started');");
    const first = captured.scripts.items.find(isIncludedScript);
    if (first === undefined) throw new Error("Missing included script fixture");
    const keys = ["deadline-second", "deadline-different", "resource-failure"];
    for (const script_key of keys)
      captured.scripts.items.push({ ...first, script_key });
    captured.scripts.total += keys.length;

    const result = buildCapturedWebBundleAnalysis(
      captured,
      {
        status: "not_requested",
        requested: 0,
        processed: 0,
        items: [],
      },
      [
        {
          status: "unavailable",
          script_key: first.script_key,
          reason: "not_started",
          detail: "Total analysis deadline expired after 50 ms.",
        },
        {
          status: "unavailable",
          script_key: "deadline-second",
          reason: "not_started",
          detail: "Total analysis deadline expired after 50 ms.",
        },
        {
          status: "unavailable",
          script_key: "deadline-different",
          reason: "deadline",
          detail: "Per-script deadline expired after 10 ms.",
        },
        {
          status: "unavailable",
          script_key: "resource-failure",
          reason: "resource_constraint",
          detail: "Worker result exceeded its byte budget.",
        },
      ],
    );

    expect(
      result.unknowns.filter(
        ({ dimension }) => dimension === "javascript_analysis",
      ),
    ).toEqual([
      {
        dimension: "javascript_analysis",
        reason:
          'Analysis was unavailable for captured scripts (not_started); findings from those scripts are unknown. Worker detail: "Total analysis deadline expired after 50 ms."',
        affected_script_keys: [first.script_key, "deadline-second"],
      },
      {
        dimension: "javascript_analysis",
        reason:
          'Analysis was unavailable for captured scripts (deadline); findings from those scripts are unknown. Worker detail: "Per-script deadline expired after 10 ms."',
        affected_script_keys: ["deadline-different"],
      },
      {
        dimension: "javascript_analysis",
        reason:
          'Analysis was unavailable for captured scripts (resource_constraint); findings from those scripts are unknown. Worker detail: "Worker result exceeded its byte budget."',
        affected_script_keys: ["resource-failure"],
      },
    ]);
  });
});

it("requires every result reference to belong to its script key", () => {
  const captured = inspection(
    "import './module.js'; const routes = [{ path: '/known' }]; fetch('/api'); form.get('candidate'); document.modelContext.registerTool({ name: 'lookup' });",
  );
  const script = captured.scripts.items.find(isIncludedScript);
  if (script === undefined) throw new Error("Missing included script fixture");
  const outcome = analyzeCapturedWebScript(script);
  if (outcome.status !== "analyzed")
    throw new Error("Expected a completed script analysis fixture");
  const result = outcome;
  expect(webBundleScriptAnalysisSchema.parse(result)).toEqual(result);
  expect(result.observations.edges.length).toBeGreaterThan(0);
  expect(result.observations.routes.length).toBeGreaterThan(0);
  expect(result.observations.endpoints.length).toBeGreaterThan(0);
  expect(result.observations.webmcp_declarations.length).toBeGreaterThan(0);
  expect(result.inferences.length).toBeGreaterThan(0);

  const wrongEdgeSource = {
    ...result,
    observations: {
      ...result.observations,
      edges: result.observations.edges.map((edge, index) =>
        index === 0 ? { ...edge, from_script_key: "another-script" } : edge,
      ),
    },
  };
  const wrongEdgeLocation = {
    ...result,
    observations: {
      ...result.observations,
      edges: result.observations.edges.map((edge, index) =>
        index === 0
          ? {
              ...edge,
              location: { ...edge.location, script_key: "another-script" },
            }
          : edge,
      ),
    },
  };
  const wrongFindingLocation = {
    ...result,
    observations: {
      ...result.observations,
      endpoints: result.observations.endpoints.map((finding, index) =>
        index === 0
          ? {
              ...finding,
              location: {
                ...finding.location,
                script_key: "another-script",
              },
            }
          : finding,
      ),
    },
  };
  const wrongRouteLocation = {
    ...result,
    observations: {
      ...result.observations,
      routes: result.observations.routes.map((finding, index) =>
        index === 0
          ? {
              ...finding,
              location: {
                ...finding.location,
                script_key: "another-script",
              },
            }
          : finding,
      ),
    },
  };
  const wrongWebMcpLocation = {
    ...result,
    observations: {
      ...result.observations,
      webmcp_declarations: result.observations.webmcp_declarations.map(
        (declaration, index) =>
          index === 0
            ? {
                ...declaration,
                location: {
                  ...declaration.location,
                  script_key: "another-script",
                },
              }
            : declaration,
      ),
    },
  };
  const wrongInferenceBasis = {
    ...result,
    inferences: result.inferences.map((inference, inferenceIndex) =>
      inferenceIndex === 0
        ? {
            ...inference,
            basis: inference.basis.map((basis, basisIndex) =>
              basisIndex === 0
                ? { ...basis, script_key: "another-script" }
                : basis,
            ),
          }
        : inference,
    ),
  };

  expect(webBundleScriptAnalysisSchema.safeParse(wrongEdgeSource).success).toBe(
    false,
  );
  expect(
    webBundleScriptAnalysisSchema.safeParse(wrongEdgeLocation).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse(wrongFindingLocation).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse(wrongRouteLocation).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse(wrongWebMcpLocation).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse(wrongInferenceBasis).success,
  ).toBe(false);
});

it("rejects a failed parse that claims visited nodes or derived facts", () => {
  const malformed =
    inspection("function broken( {").scripts.items.find(isIncludedScript);
  const valid =
    inspection("fetch('/api');").scripts.items.find(isIncludedScript);
  if (malformed === undefined || valid === undefined)
    throw new Error("Missing parse result fixtures");
  const failedOutcome = analyzeCapturedWebScript(malformed);
  const parsedOutcome = analyzeCapturedWebScript(valid);
  if (
    failedOutcome.status !== "analyzed" ||
    parsedOutcome.status !== "analyzed"
  )
    throw new Error("Expected completed script analysis fixtures");
  const failed = failedOutcome;
  const parsed = parsedOutcome;

  expect(webBundleScriptAnalysisSchema.parse(failed)).toEqual(failed);
  expect(
    webBundleScriptAnalysisSchema.safeParse({
      ...failed,
      visited_ast_nodes: 1,
    }).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse({
      ...failed,
      widened_return_references: true,
    }).success,
  ).toBe(false);
  expect(
    webBundleScriptAnalysisSchema.safeParse({
      ...failed,
      observations: {
        ...failed.observations,
        endpoints: parsed.observations.endpoints,
      },
    }).success,
  ).toBe(false);
});

it("recognizes expression-free template literals as route properties", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
      const routes = [
        { path: \`score-board\`, component: ScoreBoard },
        { route: \`administration\`, component: Admin },
        { path: \`/user/\${name}\`, component: Dynamic },
      ];
    `),
  );

  expect(result.observations.routes.map(({ value }) => value)).toEqual([
    "score-board",
    "administration",
  ]);
});

it("uses the shared parser for decorated captured scripts", () => {
  const result = analyzeWebBundleFixture(
    inspection(`@sealed class Widget {} fetch('/decorated');`),
  );

  expect(result.completeness).toMatchObject({
    status: "complete",
    parsed_scripts: 1,
    parse_failures: 0,
  });
  expect(result.observations.endpoints).toEqual([
    expect.objectContaining({ value: "/decorated" }),
  ]);
});

it("keeps bare module locations unresolved without inventing URL-relative paths", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
    import "package-name";
    import("@scope/package");
    require("package-name");
    import "./actual.js";
    importScripts("worker.js");
  `),
  );
  const bareEdges = result.observations.chunks.edges.filter(
    ({ specifier }) =>
      specifier === "package-name" || specifier === "@scope/package",
  );
  expect(bareEdges).toHaveLength(3);
  expect(bareEdges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "static_import",
        specifier: "package-name",
        resolved_url: null,
      }),
      expect.objectContaining({
        kind: "dynamic_import",
        specifier: "@scope/package",
        resolved_url: null,
      }),
      expect.objectContaining({
        kind: "require",
        specifier: "package-name",
        resolved_url: null,
      }),
    ]),
  );
  expect(
    result.observations.chunks.edges.find(
      (edge) => edge.specifier === "./actual.js",
    )?.resolved_url,
  ).toBe(`${origin}/assets/actual.js`);
  expect(
    result.observations.chunks.edges.find(
      (edge) => edge.specifier === "worker.js",
    )?.resolved_url,
  ).toBe(`${origin}/assets/worker.js`);
});

it("retains each literal importScripts argument in source order", () => {
  const result = analyzeWebBundleFixture(
    inspection(
      'importScripts("first.js", dynamicValue, "second.js", "first.js");',
    ),
  );
  expect(
    result.observations.chunks.edges
      .filter(({ kind }) => kind === "worker_import")
      .map(({ specifier }) => specifier),
  ).toEqual(["first.js", "second.js"]);
});

describe("web metadata key semantics", () => {
  it("keeps computed metadata keys and overwrite order conservative", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
      const path = "description";
      const routes = [{ [path]: "/not-a-route" }, { ["path"]: "/real" }];
      document.modelContext.registerTool({
        name: "old", name: "new",
        inputSchema: { properties: { [name]: {}, literal: {} } }
      });
      document.modelContext.registerTool({ name: "old", ...dynamic });
      document.modelContext.registerTool({ name: "old", [name]: "dynamic" });
      document.modelContext.registerTool({ name: "old", get name() {} });
      document.modelContext.registerTool({ ...dynamic, ["name"]: "restored" });
      document.modelContext.registerTool({ name: "valid", [""]: 0 });
    `),
    );

    expect(result.observations.routes.map(({ value }) => value)).toEqual([
      "/real",
    ]);
    expect(result.observations.webmcp_declarations).toEqual([
      expect.objectContaining({
        name: "new",
        schema_property_names: ["literal"],
        schema_property_names_coverage: "partial",
      }),
      expect.objectContaining({
        name: null,
        schema_property_names_coverage: "unknown",
      }),
      expect.objectContaining({
        name: null,
        schema_property_names_coverage: "not_present",
      }),
      expect.objectContaining({
        name: "restored",
        schema_property_names_coverage: "unknown",
      }),
      expect.objectContaining({
        name: "valid",
        schema_property_names_coverage: "not_present",
      }),
    ]);
  });

  it("projects only exact input schema property names", () => {
    const result = analyzeWebBundleFixture(
      inspection(`
      document.modelContext.registerTool({
        name: "literal",
        inputSchema: {
          type: "object",
          properties: { type: {}, properties: {}, "": {}, [dynamicKey]: {}, ...dynamicProperties }
        }
      });
      document.modelContext.registerTool({ name: "missing properties", inputSchema: { type: "object" } });
      document.modelContext.registerTool({ name: "dynamic properties", inputSchema: { properties: dynamicProperties } });
      document.modelContext.registerTool({ name: "null properties", inputSchema: { properties: null } });
      document.modelContext.registerTool({ name: "missing schema" });
      document.modelContext.registerTool({ name: "dynamic schema", inputSchema: schema });
      document.modelContext.registerTool({ name: "null schema", inputSchema: null });
      document.modelContext.registerTool({ name: "spread schema", inputSchema: { ...schema } });
      document.modelContext.registerTool({
        name: "computed literal keys",
        ["inputSchema"]: { ["properties"]: { [""]: {}, ["literal"]: {}, [dynamicKey]: {} } }
      });
    `),
    );

    expect(
      result.observations.webmcp_declarations.map(
        ({ name, schema_property_names, schema_property_names_coverage }) => ({
          name,
          schema_property_names,
          schema_property_names_coverage,
        }),
      ),
    ).toEqual([
      {
        name: "literal",
        schema_property_names: ["", "properties", "type"],
        schema_property_names_coverage: "partial",
      },
      {
        name: "missing properties",
        schema_property_names: [],
        schema_property_names_coverage: "not_present",
      },
      {
        name: "dynamic properties",
        schema_property_names: [],
        schema_property_names_coverage: "unknown",
      },
      {
        name: "null properties",
        schema_property_names: [],
        schema_property_names_coverage: "unknown",
      },
      {
        name: "missing schema",
        schema_property_names: [],
        schema_property_names_coverage: "not_present",
      },
      {
        name: "dynamic schema",
        schema_property_names: [],
        schema_property_names_coverage: "unknown",
      },
      {
        name: "null schema",
        schema_property_names: [],
        schema_property_names_coverage: "not_present",
      },
      {
        name: "spread schema",
        schema_property_names: [],
        schema_property_names_coverage: "unknown",
      },
      {
        name: "computed literal keys",
        schema_property_names: ["", "literal"],
        schema_property_names_coverage: "partial",
      },
    ]);
  });

  it("keeps missing coverage absent when parsing historical observations", () => {
    const analyzed = analyzeWebBundleFixture(
      inspection(
        `document.modelContext.registerTool({ name: "legacy", inputSchema: { properties: {} } });`,
      ),
    );
    const declaration = analyzed.observations.webmcp_declarations[0];
    expect(declaration).toBeDefined();
    if (declaration === undefined) throw new Error("Expected declaration");
    const { schema_property_names_coverage: _coverage, ...legacyDeclaration } =
      declaration;
    const parsed = webBundleAnalysisSchema.parse({
      ...analyzed,
      observations: {
        ...analyzed.observations,
        webmcp_declarations: [legacyDeclaration],
      },
    });
    expect(
      Object.hasOwn(
        parsed.observations.webmcp_declarations[0] ?? {},
        "schema_property_names_coverage",
      ),
    ).toBe(false);
  });
});

it("retains WebMCP declarations through optional member and call chaining", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
      document.modelContext?.registerTool({ name: "optional member" });
      document.modelContext.registerTool?.({ name: "optional call" });
    `),
  );

  expect(result.observations.webmcp_declarations).toEqual([
    expect.objectContaining({
      name: "optional member",
      trust: "page-declared-untrusted",
    }),
    expect.objectContaining({
      name: "optional call",
      trust: "page-declared-untrusted",
    }),
  ]);
});

it("reads expression-free template dynamic imports as chunk edges", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
        import(\`./lazy.js\`);
        import("./quoted.js");
        import(\`./\${name}.js\`);
      `),
  );

  expect(result.observations.chunks.edges).toEqual([
    expect.objectContaining({
      kind: "dynamic_import",
      specifier: "./lazy.js",
      resolved_url: `${origin}/assets/lazy.js`,
    }),
    expect.objectContaining({
      kind: "dynamic_import",
      specifier: "./quoted.js",
    }),
  ]);
});

it("does not infer call names from dynamic computed identifiers", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
        const fetch = "render";
        const require = "render";
        const registerTool = "render";
        window[fetch]("/render-only");
        window[require]("./not-a-module.js");
        document.modelContext[registerTool]({ name: "not-a-tool" });
      `),
  );

  expect(result.observations.endpoints).toEqual([]);
  expect(result.observations.chunks.edges).toEqual([]);
  expect(result.observations.webmcp_declarations).toEqual([]);
});

it("retains direct and literal computed call names", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
        window.fetch("/direct");
        window["fetch"]("/literal");
    window[receiver].fetch("/nested-receiver");
        window.require("./direct.js");
        window["require"]("./literal.js");
        document.modelContext["registerTool"]({ name: "literal-tool" });
      `),
  );

  expect(result.observations.endpoints.map(({ value }) => value)).toEqual([
    "/direct",
    "/literal",
  ]);
  expect(
    result.observations.chunks.edges.map(({ specifier }) => specifier),
  ).toEqual(["./direct.js", "./literal.js"]);
  expect(result.observations.webmcp_declarations).toEqual([
    expect.objectContaining({ name: "literal-tool" }),
  ]);
});

it("requires WebMCP receiver and method names to occupy exact member segments", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
      navigator.modelContext.registerTool({ name: "navigator" });
      local.modelContext.registerTool({ name: "exact nested" });
      const appmodelContext = { registerTool() {} };
      appmodelContext.registerTool({ name: "receiver suffix" });
      const app = { analyticsmodelContext: { registerTool() {} } };
      app.analyticsmodelContext.registerTool({ name: "nested suffix" });
      window["modelContext.registerTool"]({ name: "dotted property" });
      window["modelContext"].registerTool({ name: "computed receiver" });
    `),
  );

  expect(result.observations.webmcp_declarations).toEqual([
    expect.objectContaining({ name: "navigator" }),
    expect.objectContaining({ name: "exact nested" }),
    expect.objectContaining({ name: "computed receiver" }),
  ]);
});

it("recognizes tRPC procedures and named GraphQL operations in captured scripts", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
      const n = createTRPCClient({ links: [httpBatchLink({ url: "/api/trpc" })] });
      e.invoice.list.useQuery({ competencia: "2026-09" });
      n.empresa.byCnpj.query("00000000000191");
      const q = "query ListarNotas($competencia: String!) { notas { id } }";
      this.client.query({ query: q });
    `),
  );
  expect(
    result.observations.endpoints.map(({ value, mechanism }) => ({
      value,
      mechanism,
    })),
  ).toEqual([
    { value: "/api/trpc", mechanism: "trpc:link:httpBatchLink" },
    { value: "invoice.list", mechanism: "trpc:procedure:useQuery" },
    { value: "empresa.byCnpj", mechanism: "trpc:procedure:query" },
    { value: "ListarNotas", mechanism: "graphql:query" },
  ]);
});

it("keeps RPC lexical identity and bundled factory recognition in captured scripts", () => {
  const longOperation = "Operation" + "x".repeat(512);
  const document =
    "#" +
    "comment".repeat(700) +
    "\nquery " +
    longOperation +
    " { users { id } }";
  const result = analyzeWebBundleFixture(
    inspection(`
    function first() { const c = createTRPCClient({}); }
    function unrelated(c) { c.users.query("select 1"); }
    const c = (0, t.createTRPCClient)({ links: [(0, t.httpBatchLink)({ url: "/api/rpc" })] });
    c.posts.query();
    const doc = ${JSON.stringify(document)};
  `),
  );
  expect(
    result.observations.endpoints.map(({ value, mechanism }) => ({
      value,
      mechanism,
    })),
  ).toEqual([
    { value: "/api/rpc", mechanism: "trpc:link:httpBatchLink" },
    { value: "posts", mechanism: "trpc:procedure:query" },
    { value: longOperation, mechanism: "graphql:query" },
  ]);
  expect(result.completeness.status).toBe("complete");
});

it("retains distinct WebMCP descriptions and names while deduplicating equivalent properties", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
      document.modelContext.registerTool({ name: "lookup", description: "first", inputSchema: { properties: { alpha: {} } } });
      document.modelContext.registerTool({ name: "lookup", description: "second", inputSchema: { properties: { alpha: {} } } });
      document.modelContext.registerTool({ name: "equivalent", inputSchema: { properties: { alpha: {}, beta: {} } } });
      document.modelContext.registerTool({ name: "equivalent", inputSchema: { properties: { beta: {}, alpha: {}, alpha: {} } } });
      document.modelContext.registerTool({ name: "empty-status", inputSchema: { properties: {} } });
      document.modelContext.registerTool({ name: "empty-status", inputSchema: { properties: dynamicProperties } });
      document.modelContext.registerTool({ description: "unnamed" });
      document.modelContext.registerTool({ name: "", description: "unnamed" });
    `),
  );

  expect(
    result.observations.webmcp_declarations.map(
      ({
        name,
        description,
        schema_property_names,
        schema_property_names_coverage,
      }) => ({
        name,
        description,
        schema_property_names,
        schema_property_names_coverage,
      }),
    ),
  ).toEqual([
    {
      name: "lookup",
      description: "first",
      schema_property_names: ["alpha"],
      schema_property_names_coverage: "complete",
    },
    {
      name: "lookup",
      description: "second",
      schema_property_names: ["alpha"],
      schema_property_names_coverage: "complete",
    },
    {
      name: "equivalent",
      description: null,
      schema_property_names: ["alpha", "beta"],
      schema_property_names_coverage: "complete",
    },
    {
      name: "empty-status",
      description: null,
      schema_property_names: [],
      schema_property_names_coverage: "complete",
    },
    {
      name: "empty-status",
      description: null,
      schema_property_names: [],
      schema_property_names_coverage: "unknown",
    },
    {
      name: null,
      description: "unnamed",
      schema_property_names: [],
      schema_property_names_coverage: "not_present",
    },
    {
      name: "",
      description: "unnamed",
      schema_property_names: [],
      schema_property_names_coverage: "not_present",
    },
  ]);
  expect(result.observations.webmcp_declarations[2]?.location).toEqual({
    script_key: `scr_${"1".repeat(64)}`,
    line: 4,
    column: 6,
  });
  expect(
    result.observations.webmcp_declarations.every(
      ({ trust }) => trust === "page-declared-untrusted",
    ),
  ).toBe(true);
});

it("keeps known capture omissions in compact route summaries and queryable gap facts", () => {
  const captured = inspection("createBrowserRouter([{path:'/reports'}]);");
  captured.completeness.excluded.push(
    { section: "scripts", reason: "resource_budget_exhausted", count: 3 },
    {
      section: "script_sources",
      reason: "resource_budget_exhausted",
      count: null,
    },
  );
  const report = analyzeWebBundleFixture(captured),
    parent = {
      evidenceId: `ev_${"a".repeat(64)}`,
      operation: "analyze_web_bundle",
      normalizedResult: report,
      limitations: report.limitations,
      subject: null,
    };
  const summary = projectAnalysisView(
    parent,
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      collection: "summary",
    }),
  );
  if (!summary.ok) throw summary.error;
  if (summary.value.kind !== "javascript-routes") throw new Error("Wrong view");
  expect(summary.value.source_coverage.candidate_enumeration).toBe("partial");
  expect(summary.value.summary!.reported_capture_omissions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ unit: "script-records", count: 3 }),
      expect.objectContaining({ unit: "script-sources", count: null }),
    ]),
  );
  const gaps = projectAnalysisView(
    parent,
    analysisViewRequestSchema.parse({
      kind: "javascript-routes",
      collection: "unknowns",
      where: { kinds: ["capture-omission"] },
      fields: ["capture_omission", "reason"],
    }),
  );
  if (!gaps.ok) throw gaps.error;
  if (gaps.value.kind !== "javascript-routes") throw new Error("Wrong view");
  expect(gaps.value.items).toHaveLength(2);
  for (const row of gaps.value.items)
    expect(row).toMatchObject({ source_id: null, provenance: null });
});

it("retains captured Next script identity while deriving decoded route patterns", () => {
  const url = `${origin}/base/_next/static/chunks/app/%28shop%29/blog/%5Bid%5D/page-abc.js`;
  const captured = createWebPageInspection([
    {
      source: "router.push('/help');",
      scriptKey: `scr_${"2".repeat(64)}`,
      url,
      origin,
      cdpHash: "hash",
    },
  ]);
  const result = analyzeWebBundleFixture(captured);
  expect(result.route_inventory?.routes.map(({ path }) => path)).toEqual([
    "/base/blog/:id",
    "/base/help",
  ]);
  expect(result.route_inventory?.sources).toEqual([
    expect.objectContaining({
      url,
      sha256: captured.scripts.items[0]?.source.included
        ? captured.scripts.items[0].source.artifact.sha256
        : null,
    }),
  ]);
  expect(result.route_inventory?.occurrences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        origin: "source-url",
        unprefixed_path: "/blog/:id",
        inferred_base_path: "/base",
      }),
      expect.objectContaining({
        origin: "source-syntax",
        unprefixed_path: "/help",
      }),
    ]),
  );
});

it("qualifies local browser API spellings while preserving intrinsic requests", () => {
  const result = analyzeWebBundleFixture(
    inspection(`
    const local = { fetch(x) { return x; }, sendBeacon(x) { return x; }, EventSource(x) { return x; } };
    local.fetch('/local-fetch'); local.sendBeacon('/local-beacon'); local.EventSource('/local-events');
    const other = { open(a,b) { return b; }, post(x) { return x; }, put(x) { return x; }, patch(x) { return x; }, request(x) { return x; } };
    other.open('GET', '/local-open'); other.post('/local-post'); other.put('/local-put'); other.patch('/local-patch'); other.request('/local-request');
    fetch('/intrinsic-fetch'); navigator.sendBeacon('/intrinsic-beacon'); new EventSource('/intrinsic-events');
  `),
  );
  expect(
    result.observations.endpoints.map(({ value }) => value).sort(),
  ).toEqual(["/intrinsic-beacon", "/intrinsic-events", "/intrinsic-fetch"]);
  expect(
    result.inferences
      .filter(({ kind }) => kind === "endpoint_candidate")
      .map(({ value }) => value)
      .sort(),
  ).toEqual([
    "/local-beacon",
    "/local-events",
    "/local-fetch",
    "/local-open",
    "/local-patch",
    "/local-post",
    "/local-put",
    "/local-request",
  ]);
});

it.each([
  ["", true],
  ["xhr.open = replacement;", false],
  ["XMLHttpRequest.prototype.open = replacement;", false],
  ["const alias = xhr; alias.open = replacement;", false],
  ["mutate(xhr);", false],
])(
  "preserves XHR receiver proof across visible mutation: %s",
  (mutation, observed) => {
    const source = `const xhr = new XMLHttpRequest(); ${mutation} xhr.open('GET', '/xhr');`;
    const result = analyzeWebBundleFixture(inspection(source));
    expect(result.observations.endpoints.map(({ value }) => value)).toEqual(
      observed ? ["/xhr"] : [],
    );
    expect(
      result.inferences
        .filter(({ kind }) => kind === "endpoint_candidate")
        .map(({ value }) => value),
    ).toEqual(observed ? [] : ["/xhr"]);
    expect(analyzeJavaScriptStaticSource(source).endpoints).toContainEqual(
      expect.objectContaining({
        value: "/xhr",
        ...(observed ? {} : { interpretation: "candidate" }),
      }),
    );
  },
);
