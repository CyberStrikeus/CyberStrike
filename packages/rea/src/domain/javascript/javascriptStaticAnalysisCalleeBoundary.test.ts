import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { aliasSelectionBudgetSource } from "../../../tests/fixtures/javascriptAliasSelectionBudget.js";

const expressionWrappers = [
  ["plain", (value: string) => value],
  ["asserted", (value: string) => `(${value} as any)`],
  ["non-null", (value: string) => `(${value}!)`],
  ["satisfies", (value: string) => `(${value} satisfies any)`],
] as const;

it.each([
  ["module.require = replacement;", true],
  [
    "const holder = { loader: module }; holder.loader.require = replacement;",
    true,
  ],
  [
    "const holder = {}; holder.loader = module; holder.loader.require = replacement;",
    true,
  ],
  ["const holder = [module]; holder[0].require = replacement;", true],
  ["Object.defineProperty(module, 'require', { value: replacement });", true],
  ["const api = module; Object.assign(api, { require: replacement });", true],
  ["const module = { require() {} }; module.require = replacement;", false],
  ["const api = module.exports; api.require = replacement;", false],
  [
    "const holder = { a: module }; const target = flag ? holder.a : holder; target.require = replacement;",
    true,
  ],
  [
    "const table = { x: {}, y: {}, z: module }; const target = flag ? table.x : table.y; target.require = replacement;",
    false,
  ],
])("keeps CommonJS delegate replacement unknown: %s", (write, changed) => {
  const analysis = analyzeJavaScriptStaticSource(
    `${write} require("./shared.cjs");`,
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([
    expect.objectContaining({
      kind: "require",
      specifier: changed ? null : "./shared.cjs",
    }),
  ]);
});

it("keeps a require capture before a later delegate replacement", () => {
  const analysis = analyzeJavaScriptStaticSource(
    'require("./shared.cjs"); const holder = { loader: module }; holder.loader.require = replacement;',
  );
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "./shared.cjs" }),
  ]);
});

it.each([
  ["const holder = {}; holder.loader = { require() {} }; holder.loader", false],
  [
    "const holder = { loader: module }; holder.loader = {}; holder.loader",
    false,
  ],
  [
    "const holder = {}; if (flag) holder.loader = { require() {} }; holder.loader",
    false,
  ],
  ["const holder = { loader: module }; holder.loader", true],
  ["const holder = { inner: { loader: module } }; holder.inner.loader", true],
  ["const holder = [module]; holder[0]", true],
  [
    "const holder = { loader: module }; const { loader } = holder; loader",
    true,
  ],
  [
    "const holder = { loader: module }; const loader = holder.loader; loader",
    true,
  ],
  [
    "const holder = { loader: module }; const alias = { ...holder }; alias.loader",
    true,
  ],
  ["const holder = { loader: module, loader: {} }; holder.loader", false],
  ["const holder = { loader: {} }; holder.loader", false],
  ["const holder = { loader: module.exports }; holder.loader", false],
  ["const holder = { loader: module }; holder.missing", false],
  [
    "const table = { a: { b: {}, d: module }, c: { d: {}, b: {} } }; const selected = flag ? table.a.b : table.c.d; selected",
    false,
  ],
  ["let holder = {}; while (flag) holder = holder.slot; holder", true],
  ["const holder = {}; holder.loader = module; holder.loader", true],
  ["const holder = {}; if (flag) holder.loader = module; holder.loader", true],
  [
    "const holder = {}; const alias = holder; alias.loader = module; holder.loader",
    true,
  ],
])(
  "tracks the selected module-object container slot: %s",
  (receiver, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${receiver}.require("./shared.cjs");`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it("bounds branching selector work and reports unknown ownership explicitly", () => {
  const analysis = analyzeJavaScriptStaticSource(aliasSelectionBudgetSource());
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.parse_status).toBe("partial");
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: null }),
  ]);
  expect(analysis.limitations).toContainEqual(
    expect.stringMatching(/Alias selection expansion.*512/u),
  );
});

it.each([
  ['const load = module.require.bind(module); load("./shared.cjs");', true],
  [
    'const api = module; const load = api.require.bind(api); load("./shared.cjs");',
    true,
  ],
  [
    'const load = module["require"][`bind`](module); load("./shared.cjs");',
    true,
  ],
  ['module.require.call(module, "./shared.cjs");', true],
  ['module.require.apply(module, ["./shared.cjs"]);', true],
  [
    'const load = module.require.bind.call(module.require, module); load("./shared.cjs");',
    true,
  ],
  [
    'const module = { require() {} }; const load = module.require.bind(module); load("./shared.cjs");',
    false,
  ],
  [
    'const api = module.exports; const load = api.require.bind(api); load("./shared.cjs");',
    false,
  ],
])(
  "retains unchecked module delegate invocation and capture: %s",
  (source, possibleModule) => {
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      possibleModule
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  ["const { api = module } = options;", true],
  ["const { api = module } = {};", true],
  ["const { api = module } = { api: {} };", false],
  ["const { api = module.exports } = options;", false],
  ["const { ...api } = module;", false],
])(
  "tracks active direct module defaults: %s",
  (declaration, possibleModule) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${declaration} api.require("./shared.cjs");`,
    );
    expect(analysis.references).toEqual(
      possibleModule
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  "const { exports: api } = module;",
  "const { exports: { api } } = module;",
  "const [api] = [module.exports];",
])(
  "keeps projected module members separate from the loader: %s",
  (declaration) => {
    const analysis = analyzeJavaScriptStaticSource(`${declaration}
    api.require = () => {}; api.require("./shared.cjs");`);
    expect(analysis.references).toEqual([]);
  },
);

it.each(["module", "local"])(
  "examines a repeated conditional alias graph once per source read for %s",
  (origin) => {
    const source = [`const a0 = ${origin === "module" ? "module" : "{}"};`];
    for (let index = 1; index <= 128; index += 1)
      source.push(
        `let a${index} = a${index - 1}; if (flag) a${index} = a${index - 1};`,
      );
    source.push('a128.require("./shared.cjs");');
    const analysis = analyzeJavaScriptStaticSource(source.join("\n"));
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      origin === "module"
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it("shares erased call-target names with endpoint consumers without inventing dynamic keys", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    (client.get as typeof client.get)("/api/items");
    (navigator as typeof navigator).sendBeacon("/api/telemetry", payload);
    (client[method] as typeof client.get)("/api/unknown");
    ((choose ? client.get : client.post) as typeof client.get)("/api/conditional");
  `);
  expect(analysis.parse_error_count).toBe(0);
  expect(
    analysis.endpoints.map(({ value, mechanism }) => [value, mechanism]),
  ).toEqual([
    ["/api/items", "call:client.get"],
    ["/api/telemetry", "call:navigator.sendBeacon"],
  ]);
});

it.each(expressionWrappers)(
  "excludes %s collection and configuration reads while retaining request candidates",
  (_label, wrap) => {
    const call = (receiver: string, method: string, value: string) =>
      `${wrap(`${wrap(receiver)}.${method}`)}(${JSON.stringify(value)});`;
    const workspace = `${wrap("vscode")}.workspace`;
    const configuration = `${wrap(`${wrap(workspace)}.getConfiguration`)}("editor")`;
    const analysis = analyzeJavaScriptStaticSource(`
    import * as vscode from "vscode";
    const settings = ${wrap(configuration)};
    let changed = ${wrap(configuration)};
    changed = client;
    const uncertain = flag ? ${wrap(configuration)} : client;
    ${call(`new ${wrap("Headers")}()`, "get", "content-type")}
    ${call(`new ${wrap("URLSearchParams")}()`, "delete", "q")}
    ${call(`new ${wrap("Map")}()`, "get", "setting")}
    ${call(`${wrap("response")}.headers`, "get", "authorization")}
    ${call(`${wrap("url")}.searchParams`, "delete", "token")}
    ${call(configuration, "get", "tabSize")}
    ${call("settings", "get", "wordWrap")}
    ${call(`${wrap("context")}.globalState`, "get", "lastSession")}
    ${call(`${wrap("context")}.workspaceState`, "get", "lastFile")}
    ${call("client", "get", "setting")}
    ${call(`new ${wrap("Headers")}()`, "get", "/api/header-shaped")}
    ${call("settings", "get", "https://api.example.test/config-shaped")}
    ${call("client", "get", "/api/items")}
    ${call("changed", "get", "changed-setting")}
    ${call("uncertain", "get", "conditional-setting")}
  `);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.parse_status).toBe("complete");
    expect(
      analysis.endpoints.map(({ value, interpretation }) => [
        value,
        interpretation ?? null,
      ]),
    ).toEqual([
      ["setting", "candidate"],
      ["/api/header-shaped", "candidate"],
      ["https://api.example.test/config-shaped", "candidate"],
      ["/api/items", "candidate"],
      ["changed-setting", "candidate"],
      ["conditional-setting", "candidate"],
    ]);
  },
);

it("retains uncertainty and module evidence for wrapped get receivers", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    const vscode = otherLibrary;
    const settings = vscode.workspace.getConfiguration("editor");
    (settings.get as any)("unproven-config");
    (context.globalState.get as any)("unproven-state");
    ((choose ? new Headers() : client).get as any)("uncertain-receiver");
    (client[method] as any)("unknown-method");
    ((choose ? client.get : client.post) as any)("unknown-target");
  `);
  expect(analysis.parse_error_count).toBe(0);
  expect(
    analysis.endpoints.map(({ value, interpretation }) => [
      value,
      interpretation,
    ]),
  ).toEqual([
    ["unproven-config", "candidate"],
    ["unproven-state", "candidate"],
    ["uncertain-receiver", "candidate"],
  ]);
});

it("retains lexical browser-open facts through erased call and receiver wrappers", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    ((window as any).open as any)(method, "browser-context");
    function local(window) {
      ((window as any).open as any)(method, "local-request");
    }
  `);
  expect(analysis.parse_error_count).toBe(0);
  expect(
    analysis.endpoints.map(({ value, interpretation }) => [
      value,
      interpretation,
    ]),
  ).toEqual([["local-request", "candidate"]]);
});

it.each(expressionWrappers)(
  "retains global and local identity through %s alias initializers",
  (_label, wrap) => {
    const analysis = analyzeJavaScriptStaticSource(`
    const browser = ${wrap("window")};
    (browser.open as any)(method, "browser-context");
    const database = ${wrap("indexedDB")};
    (database.open as any)("fixture-db", "2");
    const cache = ${wrap("caches")};
    (cache.open as any)("fixture-cache");
    {
      const indexedDB = ${wrap("caches")};
      const nested = ${wrap("indexedDB")};
      (nested.open as any)("nested-cache");
    }
    {
      const caches = ${wrap("indexedDB")};
      const nested = ${wrap("caches")};
      (nested.open as any)("nested-db", "2");
    }
    function local(window, indexedDB, caches) {
      const browser = ${wrap("window")};
      (browser.open as any)(method, "local-window");
      const database = ${wrap("indexedDB")};
      (database.open as any)("GET", "/local-db");
      const cache = ${wrap("caches")};
      (cache.open as any)("GET", "/local-cache");
    }
    let replaced = ${wrap("window")};
    replaced = client;
    (replaced.open as any)(method, "changed-window");
    const uncertain = ${wrap("flag ? window : client")};
    (uncertain.open as any)(method, "uncertain-window");
  `);
    expect(analysis.parse_error_count).toBe(0);
    expect
      .soft(
        analysis.endpoints.map(({ value, interpretation }) => [
          value,
          interpretation ?? null,
        ]),
      )
      .toEqual([
        ["local-window", "candidate"],
        ["/local-db", "candidate"],
        ["/local-cache", "candidate"],
        ["changed-window", "candidate"],
        ["uncertain-window", "candidate"],
      ]);
    expect(analysis.storage.map(({ kind, name }) => [kind, name])).toEqual([
      ["indexed-db", "fixture-db"],
      ["cache-storage", "fixture-cache"],
      ["cache-storage", "nested-cache"],
      ["indexed-db", "nested-db"],
    ]);
  },
);

it("retains endpoint observations for exact template and TypeScript member keys", () => {
  for (const [get, beacon] of [
    ['"get"', '"sendBeacon"'],
    ["`get`", "`sendBeacon`"],
    ['"get" as const', '"sendBeacon" as const'],
  ]) {
    const analysis = analyzeJavaScriptStaticSource(`
        import * as vscode from "vscode";
        client[${get}]("/api/items");
        navigator[${beacon}]("/api/telemetry", payload);
        client[${get}]("setting");
        new Headers()[${get}]("content-type");
        new URLSearchParams()[${get}]("q");
        vscode.workspace.getConfiguration("editor")[${get}]("tabSize");
      `);

    expect.soft(analysis.parse_error_count).toBe(0);
    expect.soft(analysis.parse_status).toBe("complete");
    expect
      .soft(
        analysis.endpoints.map(({ kind, value, mechanism, interpretation }) => [
          kind,
          value,
          mechanism,
          interpretation ?? null,
        ]),
      )
      .toEqual([
        ["network", "/api/items", "call:client.get", "candidate"],
        ["network", "/api/telemetry", "call:navigator.sendBeacon", null],
        ["network", "setting", "call:client.get", "candidate"],
      ]);
  }
});

it("preserves preload and utility paths through exact computed join members", () => {
  for (const key of ['"join"', "`join`", '"join" as const']) {
    const analysis = analyzeJavaScriptStaticSource(`
        const { BrowserWindow, utilityProcess } = require("electron");
        const path = require("node:path");
        new BrowserWindow({ webPreferences: {
          preload: path[${key}](__dirname, "preload.js")
        } });
        utilityProcess.fork(path[${key}](__dirname, "worker.js"), [], {
          serviceName: "kept"
        });
      `);

    expect.soft(analysis.parse_error_count).toBe(0);
    expect.soft(analysis.parse_status).toBe("complete");
    expect
      .soft(
        analysis.role_paths.map(
          ({ role, path, resolution_context, mechanism }) => [
            role,
            path,
            resolution_context,
            mechanism,
          ],
        ),
      )
      .toEqual([
        [
          "preload",
          "preload.js",
          "filesystem-expression",
          "BrowserWindow:webPreferences.preload",
        ],
      ]);
    expect
      .soft(
        analysis.electron.browser_windows.map(
          ({ location: _location, ...finding }) => finding,
        ),
      )
      .toEqual([
        {
          options_status: "object-literal",
          web_preferences_status: "object-literal",
          web_preferences: [
            {
              name: "preload",
              value: {
                status: "literal",
                value: "preload.js",
                expression: null,
              },
            },
          ],
          preload_path: "preload.js",
          preload_resolution_context: "filesystem-expression",
          module_key: null,
        },
      ]);
    expect
      .soft(
        analysis.electron.utility_processes.map(
          ({ location: _location, ...finding }) => finding,
        ),
      )
      .toEqual([
        {
          module_path: "worker.js",
          module_resolution_context: "filesystem-expression",
          module_expression: null,
          service_name: "kept",
          module_key: null,
        },
      ]);
  }
});

it("keeps dynamic, interpolated, and invalid template keys unresolved", () => {
  for (const { key, errors } of [
    { key: "method", errors: 0 },
    { key: "`join${suffix}`", errors: 0 },
    { key: ["`", String.raw`\unicode`, "`"].join(""), errors: 4 },
  ]) {
    const preload = `path[${key}](__dirname, "preload.js")`;
    const worker = `path[${key}](__dirname, "worker.js")`;
    const analysis = analyzeJavaScriptStaticSource(`
        const { BrowserWindow, utilityProcess } = require("electron");
        const path = require("node:path");
        client[${key}]("/api/items");
        navigator[${key}]("/api/telemetry", payload);
        new BrowserWindow({ webPreferences: { preload: ${preload} } });
        utilityProcess.fork(${worker}, [], { serviceName: "kept" });
      `);

    expect.soft(analysis.parse_error_count).toBe(errors);
    expect.soft(analysis.parse_status).toBe("partial");
    expect.soft(analysis.endpoints).toEqual([]);
    expect.soft(analysis.role_paths).toEqual([]);
    expect
      .soft(
        analysis.electron.browser_windows.map(
          ({ location: _location, ...finding }) => finding,
        ),
      )
      .toEqual([
        {
          options_status: "object-literal",
          web_preferences_status: "object-literal",
          web_preferences: [
            {
              name: "preload",
              value: { status: "dynamic", value: null, expression: preload },
            },
          ],
          preload_path: null,
          preload_resolution_context: null,
          module_key: null,
        },
      ]);
    expect
      .soft(
        analysis.electron.utility_processes.map(
          ({ location: _location, ...finding }) => finding,
        ),
      )
      .toEqual([
        {
          module_path: null,
          module_resolution_context: null,
          module_expression: worker,
          service_name: "kept",
          module_key: null,
        },
      ]);
  }
});

describe("static callee boundary matching", () => {
  it("matches complete callee members without suffix collisions", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      const {BrowserWindow} = require("electron");
      const win = new BrowserWindow();
      win.loadFile("./window.html");
      new BrowserWindow().loadURL("https://app.example.test");
      navigator.serviceWorker.register("./worker.js");
      loadFile("./bare.html");
      const optional = new BrowserWindow();
      optional?.loadURL("https://optional.example.test");

      uploadFile("./upload.html");
      preloadFile("./preload.html");
      downloadURL("https://download.example.test");
      reloadURL("https://reload.example.test");
      notloadURL("https://other.example.test");
      myserviceWorker.register("./not-worker.js");
    `);

    expect(
      analysis.role_paths.map(({ path, mechanism }) => [path, mechanism]),
    ).toEqual([
      ["./window.html", "call:win.loadFile"],
      ["https://app.example.test", "call:loadURL"],
      ["https://optional.example.test", "call:optional.loadURL"],
    ]);
    // The document base URL is unknown, so the script path stays unresolved.
    expect(
      analysis.references
        .filter(({ kind }) => kind === "service-worker")
        .map(({ specifier, expression }) => [specifier, expression]),
    ).toEqual([[null, 'navigator.serviceWorker.register("./worker.js")']]);
    expect(
      analysis.endpoints
        .filter(({ mechanism }) => mechanism.endsWith("loadURL"))
        .map(({ value }) => value),
    ).toEqual(["https://app.example.test", "https://optional.example.test"]);
  });
});
