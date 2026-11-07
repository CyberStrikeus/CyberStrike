import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const windowPrefix =
  "import {BrowserWindow} from 'electron'; import {fileURLToPath} from 'node:url';";

it.each([
  'class URL {constructor(input, base) {return new globalThis.URL("./actual.js", base);}}',
  "globalThis.URL = class {};",
  'import.meta.url = "file:///another/main.js";',
])(
  "retains a dynamic preload when source URL identity is unavailable: %s",
  (prefix) => {
    const analysis = analyzeJavaScriptStaticSource(`${windowPrefix}${prefix}
    new BrowserWindow({webPreferences:{preload:fileURLToPath(new URL("./decoy.js", import.meta.url))}});`);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: null },
    ]);
    expect(analysis.role_paths).toEqual([]);
  },
);

it.each([
  ["", "./native.js"],
  ["url.URL = class {};", null],
] as const)(
  "requires the native URL constructor identity after %s",
  (write, expected) => {
    const analysis = analyzeJavaScriptStaticSource(`${windowPrefix}
    import url from 'node:url';${write}
    new BrowserWindow({webPreferences:{preload:fileURLToPath(new (url.URL as typeof URL)("./native.js", import.meta.url))}});`);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: expected },
    ]);
  },
);

it.each([
  [
    "named import",
    "import {URL as Constructor} from 'node:url';",
    "./native.js",
  ],
  [
    "captured export",
    "import url from 'node:url'; const Constructor = url.URL;",
    "./native.js",
  ],
  [
    "replaced export",
    "import url from 'node:url'; url.URL = class {}; const Constructor = url.URL;",
    null,
  ],
  [
    "local constructor",
    "class Constructor {constructor(input, base) {return new globalThis.URL('./actual.js', base);}}",
    null,
  ],
] as const)(
  "uses the proven URL constructor identity for a %s alias",
  (_kind, declaration, expected) => {
    const analysis =
      analyzeJavaScriptStaticSource(`${windowPrefix}${declaration}
    new BrowserWindow({webPreferences:{preload:fileURLToPath(new Constructor('./native.js', import.meta.url))}});`);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: expected },
    ]);
    expect(analysis.role_paths.map(({ path }) => path)).toEqual(
      expected === null ? [] : [expected],
    );
  },
);

it.each([
  '["a", "b"].join("/")',
  'settings.join("/app", "preload.js")',
  'settings.fileURLToPath("file:///decoy.js")',
])("does not assign native path semantics to %s", (expression) => {
  const analysis =
    analyzeJavaScriptStaticSource(`import {BrowserWindow} from 'electron';
    const settings = {join() {}, fileURLToPath() {}};
    new BrowserWindow({webPreferences:{preload:${expression}}});`);
  expect(analysis.electron.browser_windows).toMatchObject([
    { preload_path: null },
  ]);
  expect(analysis.role_paths).toEqual([]);
});

it("recovers native aliases and emits preload roles only for their Electron owner", () => {
  const analysis = analyzeJavaScriptStaticSource(`${windowPrefix}
    import {join as append} from 'node:path';
    const unrelated = {preload: "./unrelated.js"};
    new BrowserWindow({webPreferences:{preload:append(__dirname, "preload.js")}});
    new BrowserWindow({webPreferences:{preload:fileURLToPath(new URL("./native.js", import.meta.url))}});`);
  expect(
    analysis.electron.browser_windows.map(({ preload_path }) => preload_path),
  ).toEqual(["preload.js", "./native.js"]);
  expect(analysis.role_paths.map(({ path }) => path)).toEqual([
    "preload.js",
    "./native.js",
  ]);
});

it.each(["localStorage", "sessionStorage"])(
  "requires browser identity for %s",
  (name) => {
    const local = analyzeJavaScriptStaticSource(
      `const ${name} = {setItem(key, value) {return value;}}; ${name}.setItem("ghost", "value");`,
    );
    expect(local.storage).toEqual([]);
    const global = analyzeJavaScriptStaticSource(
      `globalThis.${name}.setItem("real", "value");`,
    );
    expect(global.storage).toMatchObject([{ name: "real" }]);
    const overwritten = analyzeJavaScriptStaticSource(
      `globalThis.${name}.setItem = () => {}; ${name}.setItem("ghost", "value");`,
    );
    expect(overwritten.storage).toEqual([]);
  },
);

it("requires an intact Electron instance for renderer roles", () => {
  const local = analyzeJavaScriptStaticSource(
    `const cache = {loadFile(value) {return value;}};cache.loadFile("data.json");`,
  );
  expect(local.role_paths).toEqual([]);
  const native = analyzeJavaScriptStaticSource(
    `import {BrowserWindow as Win} from 'electron';const window = new Win(); window.loadFile("index.html");`,
  );
  expect(native.role_paths).toMatchObject([
    { role: "renderer", path: "index.html" },
  ]);
  const replaced = analyzeJavaScriptStaticSource(
    `import {BrowserWindow as Win} from 'electron';const window = new Win(); window.loadFile = () => {};window.loadFile("data.json");`,
  );
  expect(replaced.role_paths).toEqual([]);
});

it("keeps a reused renderer receiver uncertain after its native method call", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    import {BrowserWindow} from 'electron';
    const win = new BrowserWindow();
    win.loadFile("first.html");
    win.loadFile("later.html");
    new BrowserWindow().loadFile("independent.html");
  `);
  // Proven constructor/method identity does not establish that invoking native
  // code leaves this receiver unchanged: callbacks and hooks remain unknown.
  expect(analysis.role_paths.map(({ path }) => path)).toEqual([
    "first.html",
    "independent.html",
  ]);
});
